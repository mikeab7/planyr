-- Element-level sync, phase 1 (B666) — the `site_elements` table: one row per drawn
-- Site Planner element (els / markups / measures / callouts / parcels) instead of one
-- jsonb blob per site. Run ONCE in the Supabase SQL editor (project `lyeqzkuiwngunutlkkmi`)
-- or via the Supabase MCP. Idempotent; safe to re-run. AFTER this file, run
-- db/site_elements_backfill.sql to explode existing blobs into rows.
--
-- Design notes (B666):
--  • PK is (site_id, kind, id): ids are reused VERBATIM, but a legacy pre-salt id ("e6327",
--    minted before the B591 per-tab salt) can be reused ACROSS collections within one site —
--    live prod has exactly one such case (an el and a markup share e6327 on one site). Keying
--    by (site_id, id) would have to drop one; (site_id, kind, id) keeps both. This is also the
--    truer model — an id is unique within its own collection, not necessarily across them.
--    The op payload always carries `kind`, so the RPC/realtime/client changes are mechanical.
--  • `kind` = the source collection ('el'|'markup'|'measure'|'callout'|'parcel'), or
--    'tombstone' for a deletion migrated from the blob's deletedIds (collection unknown — the
--    blob kept only the id). A phase-2+ delete tombstones the element's OWN row (keeping its
--    real kind); 'tombstone' rows exist only for migrated legacy deletedIds.
--  • Deletion = a TOMBSTONE UPDATE (deleted_at/deleted_by set, data retained to aid Restore),
--    never a row DELETE — so deletion syncs as a fact instead of an absence, and the
--    resurrection class (B276/B556/B612) is dead by construction. Hard DELETE is reserved
--    for a future purge and gated to the owner / a team admin.
--  • `rev` is the optimistic-concurrency token: every client commit sends the rev it last
--    saw; the guarded UPDATE applies only `where rev = expected` and bumps it. Zero rows
--    back = conflict (see commit_elements below).
--  • `z_index` is the WITHIN-TYPE-LAYER stacking tiebreak (the client's Z_LAYER type table
--    still dominates paint order); migrated rows get array_index * 1024 so reorders can
--    insert between neighbors without renumbering.
--  • REPLICA IDENTITY stays the default (PK): realtime subscribers only ever need the NEW
--    row image (INSERT/UPDATE carry it; tombstones ARE updates). Old-record payloads —
--    the one thing REPLICA IDENTITY FULL buys — are never used.

-- 1) Table ---------------------------------------------------------------------
create table if not exists public.site_elements (
  site_id    text        not null references public.sites(id) on delete cascade,
  id         text        not null,  -- element id verbatim (e<n><salt>; legacy e<n>; p<siteId>_<i>)
  kind       text        not null,  -- 'el'|'markup'|'measure'|'callout'|'parcel'|'tombstone'
  data       jsonb,                 -- the element object verbatim; null only on tombstones
  z_index    double precision not null default 0,
  rev        bigint      not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,           -- null = live; set = tombstone (soft-deleted, retained)
  deleted_by uuid,
  primary key (site_id, kind, id),
  constraint site_elements_kind_check check
    (kind in ('el','markup','measure','callout','parcel','tombstone')),
  constraint site_elements_data_or_tombstone check
    (deleted_at is not null or data is not null)
);

-- Live-rows-per-site is THE query shape (load + realtime refetch): partial index.
create index if not exists site_elements_live_idx
  on public.site_elements (site_id) where deleted_at is null;

-- 2) RLS — mirror the PARENT SITE's access predicate exactly ---------------------
-- Access to an element row is exactly access to its site (own row OR a row shared with a
-- team you belong to — team_sharing.sql). The exists-subquery runs under sites' own RLS
-- too (defense in depth; predicates agree). Tombstoning is an UPDATE, so any site member
-- can delete an element (matches the sites update policy); hard row DELETE (purge) is
-- owner / team-admin only (matches the sites delete policy).
alter table public.site_elements enable row level security;

drop policy if exists "select elements via parent site" on public.site_elements;
drop policy if exists "insert elements via parent site" on public.site_elements;
drop policy if exists "update elements via parent site" on public.site_elements;
drop policy if exists "purge elements owner or team-admin" on public.site_elements;

create policy "select elements via parent site" on public.site_elements
  for select to authenticated
  using ( exists (select 1 from public.sites s
                  where s.id = site_elements.site_id
                    and (s.user_id = (select auth.uid())
                         or (s.team_id is not null and public.is_team_member(s.team_id)))) );

create policy "insert elements via parent site" on public.site_elements
  for insert to authenticated
  with check ( exists (select 1 from public.sites s
                       where s.id = site_elements.site_id
                         and (s.user_id = (select auth.uid())
                              or (s.team_id is not null and public.is_team_member(s.team_id)))) );

create policy "update elements via parent site" on public.site_elements
  for update to authenticated
  using ( exists (select 1 from public.sites s
                  where s.id = site_elements.site_id
                    and (s.user_id = (select auth.uid())
                         or (s.team_id is not null and public.is_team_member(s.team_id)))) )
  with check ( exists (select 1 from public.sites s
                       where s.id = site_elements.site_id
                         and (s.user_id = (select auth.uid())
                              or (s.team_id is not null and public.is_team_member(s.team_id)))) );

create policy "purge elements owner or team-admin" on public.site_elements
  for delete to authenticated
  using ( exists (select 1 from public.sites s
                  where s.id = site_elements.site_id
                    and (s.user_id = (select auth.uid())
                         or (s.team_id is not null and public.is_team_admin(s.team_id)))) );

-- 3) Realtime publication --------------------------------------------------------
-- Streams row changes to subscribed clients; Supabase applies the SELECT RLS above to
-- every delivered event. Guarded: `alter publication` has no IF NOT EXISTS.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'site_elements') then
    alter publication supabase_realtime add table public.site_elements;
  end if;
end $$;

-- 4) commit_elements — the batched, rev-guarded write RPC -------------------------
-- One call = one transaction: a group move / parking fill / pasted group can't half-apply.
-- SECURITY INVOKER so every statement runs under the caller's RLS; updated_by/deleted_by
-- are stamped server-side from auth.uid() (never trusted from the payload).
--
-- p_ops: jsonb array of ops:
--   { "op": "create"|"update"|"delete"|"restore",
--     "id": "<element id>", "kind": "el"|…, "z": <number, optional>,
--     "expected": <rev the client last saw — update/delete only>,
--     "data": { …the element object… }  (create/update/restore) }
--
-- Returns a jsonb array, one result per op, SAME order. A concurrency miss NEVER raises —
-- it reports, carrying the CURRENT row so the client needs no follow-up fetch:
--   { "id": …, "status": "ok",       "rev": <new rev> }
--   { "id": …, "status": "conflict", "row": {…} }  -- rev mismatch; row = current live row
--   { "id": …, "status": "deleted",  "row": {…} }  -- update hit a tombstone
--   { "id": …, "status": "exists",   "row": {…} }  -- create hit a LIVE row (assert-worthy:
--                                                     per-tab salted ids make this impossible)
--   { "id": …, "status": "missing" }               -- update/delete/restore on an absent row
-- Notes: create over a TOMBSTONE auto-restores (the undo-of-delete path) → 'ok'.
--        delete of an already-tombstoned row is idempotent → 'ok'.
--        Malformed ops RAISE (programming error → whole batch rolls back, loudly).
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

    -- kind is part of the PK, so every op must name it (the client always knows the collection).
    if v_op is null or v_id is null or v_kind is null then
      raise exception 'commit_elements: every op needs "op", "id" and "kind" (got %)', op;
    end if;

    if v_op = 'create' then
      if v_data is null or jsonb_typeof(v_data) <> 'object' then
        raise exception 'commit_elements: create % needs object "data"', v_id;
      end if;
      insert into public.site_elements (site_id, id, kind, data, z_index, rev, updated_at, updated_by)
      values (p_site, v_id, v_kind, v_data, coalesce(v_z, 0), 1, now(), auth.uid())
      on conflict (site_id, kind, id) do nothing
      returning * into r;
      if found then
        results := results || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'ok', 'rev', r.rev));
      else
        -- Same (site,kind,id) already exists. Over a tombstone, a create IS a restore (undo-of-delete).
        update public.site_elements t
           set data = v_data, z_index = coalesce(v_z, t.z_index),
               deleted_at = null, deleted_by = null,
               rev = t.rev + 1, updated_at = now(), updated_by = auth.uid()
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
             rev = t.rev + 1, updated_at = now(), updated_by = auth.uid()
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
             rev = t.rev + 1, updated_at = now(), updated_by = auth.uid()
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
          -- rev (delete wins, per the B669 policy matrix) and surfaces the supersede notice.
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
             rev = t.rev + 1, updated_at = now(), updated_by = auth.uid()
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
