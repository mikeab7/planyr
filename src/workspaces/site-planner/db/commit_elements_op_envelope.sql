-- NEW-2 (B712225) — WIRE THE OPERATION ENVELOPE INTO THE WRITE PATH.
--
-- WHY THIS EXISTS
-- ---------------
-- `lib/operationEnvelope.js` (B472048/B472049, shipped #1031) was built, tested, and never
-- imported anywhere outside its own test — `grep -rn operationEnvelope src/` had exactly one hit
-- outside the module itself (a prose comment in splitIntegrity.js). Every production row's
-- `op_id` / `op_kind` / `actor_session_id` / `client_ts` was NULL, because nothing ever set them.
--
-- ⛔ THE COLUMNS ALREADY EXIST ON `site_elements` IN PRODUCTION, WITH NO COMMITTED MIGRATION FOR
-- THEM. Measured directly against project `lyeqzkuiwngunutlkkmi`
-- (`information_schema.columns`): `op_id text`, `op_kind text`, `actor_session_id text`,
-- `client_ts timestamptz` — all plain, nullable, never generated, already there. No file in this
-- repo created them (this file's `add column if not exists` below is therefore a no-op against
-- current production and exists so the repo's schema history matches reality, and so a fresh
-- project bootstrapped from `db/site_elements.sql` onward gets the same columns). This corrects
-- B711792's note, which claimed adding a causal-unit id "is a schema change … out of scope" —
-- see the amendment on that item.
--
-- WHAT THIS ADDS
-- --------------
-- `commit_elements(p_site, p_ops)` — the base 2-arg form every other overload delegates to
-- (`commit_elements_atomic.sql`'s 3-arg form calls `public.commit_elements(p_site, p_ops)`
-- internally when `p_atomic` is false, and its true-path calls the 2-arg form via `results :=
-- public.commit_elements(p_site, p_ops)`; the 4-arg group-CAS form delegates the same way) — now
-- reads four OPTIONAL keys off each op and persists them alongside `data`/`rev`:
--     { …the existing op shape…, "op_id": "...", "op_kind": "...", "actor_session_id": "...",
--       "client_ts": "2026-08-23T23:03:09.019Z" }
-- All four are OMITTABLE (an op with none of them behaves byte-for-byte as before this file —
-- every column stays NULL, exactly today's production state) and UNVALIDATED against the closed
-- `OP_KINDS` vocabulary in `operationEnvelope.js` — the client is the one place that vocabulary is
-- enforced (`isOpKind`); the column is plain text here, same as it already was.
--
-- Because every overload funnels through this one function, wiring it once here wires all three.
--
-- HOW TO APPLY
-- ------------
-- Run this whole file once in the Supabase SQL editor (or via the Supabase MCP). Idempotent:
-- `add column if not exists` + `create or replace function` — safe to re-run, safe on a project
-- that already has the columns (today's production), safe on one that has neither.

alter table public.site_elements add column if not exists op_id text;
alter table public.site_elements add column if not exists op_kind text;
alter table public.site_elements add column if not exists actor_session_id text;
alter table public.site_elements add column if not exists client_ts timestamptz;

comment on column public.site_elements.op_id is
  'NEW-2 (B712225) — the causal-unit id minted client-side for the user gesture this write was '
  'part of (operationEnvelope.js mintOpId). Multiple rows can share one op_id (a drag moves a '
  'building and its bonded assembly in one commit); NULL on any row written before this shipped.';
comment on column public.site_elements.op_kind is
  'NEW-2 (B712225) — what the user was DOING (create/delete/move/…/merge/split/replace/unknown), '
  'from the closed OP_KINDS vocabulary in operationEnvelope.js. Not validated server-side.';
comment on column public.site_elements.actor_session_id is
  'NEW-2 (B712225) — the writing TAB''s per-session id (elementJournal.journalSessionId, promoted, '
  'not minted), the load-bearing half: answers "was that my other tab, or me" when two sessions '
  'share one account and updated_by/deleted_by cannot tell them apart.';
comment on column public.site_elements.client_ts is
  'NEW-2 (B712225) — the writing tab''s OWN clock at write time. Evidence only, never used to '
  'order anything (updated_at, server-stamped, stays authoritative for ordering).';

create or replace function public.commit_elements(p_site text, p_ops jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  results  jsonb := '[]'::jsonb;
  op       jsonb;
  v_op     text;
  v_id     text;
  v_kind   text;
  v_data   jsonb;
  v_expected bigint;
  v_z      double precision;
  v_op_id  text;
  v_op_kind text;
  v_actor_sid text;
  v_client_ts timestamptz;
  r        public.site_elements%rowtype;
begin
  if p_site is null or p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'commit_elements: p_site and a jsonb ARRAY of ops are required';
  end if;

  for op in select value from jsonb_array_elements(p_ops) loop
    v_op       := op->>'op';
    v_id       := op->>'id';
    v_kind     := op->>'kind';
    v_data     := op->'data';
    v_expected := (op->>'expected')::bigint;
    v_z        := (op->>'z')::double precision;
    -- NEW-2 (B712225) — optional envelope fields; absent/null on every op sent by a caller that
    -- has not wired operationEnvelope.js, which is exactly today's production behaviour.
    v_op_id     := op->>'op_id';
    v_op_kind   := op->>'op_kind';
    v_actor_sid := op->>'actor_session_id';
    v_client_ts := (op->>'client_ts')::timestamptz;

    -- kind is part of the PK, so every op must name it (the client always knows the collection).
    if v_op is null or v_id is null or v_kind is null then
      raise exception 'commit_elements: every op needs "op", "id" and "kind" (got %)', op;
    end if;

    if v_op = 'create' then
      if v_data is null or jsonb_typeof(v_data) <> 'object' then
        raise exception 'commit_elements: create % needs object "data"', v_id;
      end if;
      insert into public.site_elements (site_id, id, kind, data, z_index, rev, updated_at, updated_by,
                                         op_id, op_kind, actor_session_id, client_ts)
      values (p_site, v_id, v_kind, v_data, coalesce(v_z, 0), 1, now(), auth.uid(),
              v_op_id, v_op_kind, v_actor_sid, v_client_ts)
      on conflict (site_id, kind, id) do nothing
      returning * into r;
      if found then
        results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'ok', 'rev', r.rev));
      else
        -- Same (site,kind,id) already exists. Over a tombstone, a create IS a restore (undo-of-delete).
        update public.site_elements t
           set data = v_data, z_index = coalesce(v_z, t.z_index),
               deleted_at = null, deleted_by = null,
               rev = t.rev + 1, updated_at = now(), updated_by = auth.uid(),
               op_id = v_op_id, op_kind = v_op_kind, actor_session_id = v_actor_sid, client_ts = v_client_ts
         where t.site_id = p_site and t.kind = v_kind and t.id = v_id and t.deleted_at is not null
        returning * into r;
        if found then
          results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'ok', 'rev', r.rev));
        else
          select * into r from public.site_elements t
            where t.site_id = p_site and t.kind = v_kind and t.id = v_id;
          results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'exists', 'row', to_jsonb(r)));
        end if;
      end if;

    elsif v_op = 'update' then
      if v_data is null or jsonb_typeof(v_data) <> 'object' then
        raise exception 'commit_elements: update % needs object "data"', v_id;
      end if;
      if v_expected is null then
        raise exception 'commit_elements: update % needs "expected" rev', v_id;
      end if;
      update public.site_elements t
         set data = v_data, z_index = coalesce(v_z, t.z_index),
             rev = t.rev + 1, updated_at = now(), updated_by = auth.uid(),
             op_id = v_op_id, op_kind = v_op_kind, actor_session_id = v_actor_sid, client_ts = v_client_ts
       where t.site_id = p_site and t.kind = v_kind and t.id = v_id and t.rev = v_expected and t.deleted_at is null
      returning * into r;
      if found then
        results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'ok', 'rev', r.rev));
      else
        select * into r from public.site_elements t
          where t.site_id = p_site and t.kind = v_kind and t.id = v_id;
        if not found then
          results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'missing'));
        elsif r.deleted_at is not null then
          results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'deleted', 'row', to_jsonb(r)));
        else
          results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'conflict', 'row', to_jsonb(r)));
        end if;
      end if;

    elsif v_op = 'delete' then
      if v_expected is null then
        raise exception 'commit_elements: delete % needs "expected" rev', v_id;
      end if;
      update public.site_elements t
         set deleted_at = now(), deleted_by = auth.uid(),
             rev = t.rev + 1, updated_at = now(), updated_by = auth.uid(),
             op_id = v_op_id, op_kind = v_op_kind, actor_session_id = v_actor_sid, client_ts = v_client_ts
       where t.site_id = p_site and t.kind = v_kind and t.id = v_id and t.rev = v_expected and t.deleted_at is null
      returning * into r;
      if found then
        results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'ok', 'rev', r.rev));
      else
        select * into r from public.site_elements t
          where t.site_id = p_site and t.kind = v_kind and t.id = v_id;
        if not found then
          results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'missing'));
        elsif r.deleted_at is not null then
          -- already tombstoned (deleted twice) — idempotent success
          results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'ok', 'rev', r.rev));
        else
          -- live but newer: delete-vs-edit — the client re-applies the delete at the fresh
          -- rev (delete wins, per the B673 policy matrix) and surfaces the supersede notice.
          results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'conflict', 'row', to_jsonb(r)));
        end if;
      end if;

    elsif v_op = 'restore' then
      if v_data is null or jsonb_typeof(v_data) <> 'object' then
        raise exception 'commit_elements: restore % needs object "data"', v_id;
      end if;
      update public.site_elements t
         set data = v_data, z_index = coalesce(v_z, t.z_index),
             deleted_at = null, deleted_by = null,
             rev = t.rev + 1, updated_at = now(), updated_by = auth.uid(),
             op_id = v_op_id, op_kind = v_op_kind, actor_session_id = v_actor_sid, client_ts = v_client_ts
       where t.site_id = p_site and t.kind = v_kind and t.id = v_id and t.deleted_at is not null
      returning * into r;
      if found then
        results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'ok', 'rev', r.rev));
      else
        select * into r from public.site_elements t
          where t.site_id = p_site and t.kind = v_kind and t.id = v_id;
        if not found then
          results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'missing'));
        else
          -- already live: someone restored/edited it first — current row is the truth
          results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'conflict', 'row', to_jsonb(r)));
        end if;
      end if;

    else
      raise exception 'commit_elements: unknown op "%" (id %)', v_op, v_id;
    end if;
  end loop;

  return results;
end;
$$;

revoke execute on function public.commit_elements(text, jsonb) from public, anon;
grant execute on function public.commit_elements(text, jsonb) to authenticated;

comment on function public.commit_elements(text, jsonb) is
  'B670 base write RPC, extended by NEW-2 (B712225) to persist the operation envelope '
  '(op_id/op_kind/actor_session_id/client_ts) when a caller sends it. The 3-arg (p_atomic) and '
  '4-arg (p_groups) overloads in commit_elements_atomic.sql / commit_elements_group_cas.sql '
  'delegate here, so wiring this one function wires all three.';

-- ---- ROLLBACK (uncomment to reverse) --------------------------------------------------------
-- The function rollback restores the pre-NEW-2 body verbatim from db/site_elements.sql — do not
-- drop the columns without checking `lib/operationEnvelope.js`'s test suite and any activity-view
-- consumer added after this file; they are additive and safe to leave even if the write path is
-- reverted.
-- alter table public.site_elements drop column if exists op_id;
-- alter table public.site_elements drop column if exists op_kind;
-- alter table public.site_elements drop column if exists actor_session_id;
-- alter table public.site_elements drop column if exists client_ts;
