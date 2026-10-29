-- ============================================================================
-- project_layer_opacity — a PROJECT's per-layer opacity, ONE row per project (B2448033).
--
-- Owner decision 2026-10-29: "each plan should remember each layer's opacity. Or like each project,
-- or each project more so. It should be default within the site." So a GIS layer's opacity belongs to
-- the PROJECT (the site group); every plan of the project draws the layer at that opacity; on/off
-- stays per plan (`layerOverrides`, untouched).
--
-- WHY A TABLE AND NOT A FIELD ON THE PLANS. A project has no row of its own — it is the set of plan
-- rows sharing `coalesce(data->>'groupId', id)`. Every project-level fact stored on the plans (name,
-- role, team) is a copy held in N rows with a stamp or an RPC to keep them level, and that is the
-- shape behind the project-name split (B1415–B1418, B1440976): a stale plan re-publishes the old value.
-- This is the smallest single-authority home instead: one row per project, written only through
-- set_project_layer_opacity(), never copied onto a plan.
--
-- KEY. (owner_id, group_id) where group_id = coalesce(data->>'groupId', id) of the plan the caller
-- names — NEVER the `group_id` column, which drifts — and owner_id is that PLAN's user_id. Both are
-- derived server-side from a plan the caller can actually reach, so nobody can write into someone
-- else's project by naming a group id (`data.groupId` is writable by anyone on their own plans).
--
-- MERGE RULE (a stale device cannot overwrite a newer value). The client never sends the whole map.
-- It sends a PATCH of only the layers it changed — `{ "fema": 0.6 }` sets, `{ "fema": null }` returns
-- the layer to its default — and the server applies it in ONE atomic statement against the CURRENT
-- row. A device holding an old copy and touching one layer therefore cannot revert any other layer,
-- and there is no client-side read-modify-write to race. Absent key = the layer's own default, so
-- every existing project opens exactly as it does today (no backfill, no data migration).
--
-- ACCESS follows the plan's own sharing (owner constraint #21's spirit): the owner, and anyone on the
-- plan's team, may READ; the owner, and a teammate while the plan is not share_locked, may WRITE.
-- The table itself has RLS on and NO policies — the two SECURITY DEFINER functions below are the only
-- door, and each begins with an auth.uid() guard and an access check on the named plan.
--
-- Additive + idempotent: safe to re-run. A client built before this ran simply fails to find the
-- function and keeps opacity device-local (it reports once), exactly as today.
-- ============================================================================

create table if not exists public.project_layer_opacity (
  owner_id   uuid        not null references auth.users(id) on delete cascade,
  group_id   text        not null,
  opacity    jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, group_id),
  constraint project_layer_opacity_is_object check (jsonb_typeof(opacity) = 'object')
);

comment on table public.project_layer_opacity is
  'B2448033 — a project''s per-layer opacity, sparse {layerKey: 0..1} holding only layers that differ from their registry default. One row per (owner, site group); written only through set_project_layer_opacity().';

alter table public.project_layer_opacity enable row level security;
revoke all on table public.project_layer_opacity from public, anon, authenticated;

-- READ. Returns the project's sparse map, or SQL NULL when the plan is not visible to the caller (not in
-- the cloud yet / not theirs / deleted) — the client treats NULL as "keep what I hold", never as "none".
create or replace function public.get_project_layer_opacity(p_site_id text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_owner uuid; v_group text;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select s.user_id, coalesce(s.data->>'groupId', s.id) into v_owner, v_group
    from public.sites s
   where s.id = p_site_id and s.deleted_at is null
     and (s.user_id = v_uid or (s.team_id is not null and public.is_team_member(s.team_id)));
  if v_owner is null then return null; end if;
  return coalesce((select p.opacity from public.project_layer_opacity p
                    where p.owner_id = v_owner and p.group_id = v_group), '{}'::jsonb);
end;
$$;
revoke all on function public.get_project_layer_opacity(text) from public, anon;
grant execute on function public.get_project_layer_opacity(text) to authenticated;

-- WRITE. Applies a PATCH to the project's map in one statement and returns the merged result.
-- Values: a number in [0,1] sets the layer; JSON null removes it (back to the default).
create or replace function public.set_project_layer_opacity(p_site_id text, p_patch jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_owner uuid; v_group text; v_out jsonb; v_can boolean; kv record; v_n integer := 0;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Patch must be a JSON object' using errcode = '22023';
  end if;
  for kv in select key, value from jsonb_each(p_patch) loop
    v_n := v_n + 1;
    if v_n > 200 or kv.key !~ '^[A-Za-z0-9_.-]{1,64}$' then
      raise exception 'Bad layer key' using errcode = '22023';
    end if;
    if jsonb_typeof(kv.value) = 'null' then continue; end if;
    if jsonb_typeof(kv.value) <> 'number' or (kv.value #>> '{}')::numeric < 0 or (kv.value #>> '{}')::numeric > 1 then
      raise exception 'Opacity must be a number from 0 to 1' using errcode = '22023';
    end if;
  end loop;

  select s.user_id, coalesce(s.data->>'groupId', s.id),
         (s.user_id = v_uid or (s.team_id is not null and not coalesce(s.share_locked, false)))
    into v_owner, v_group, v_can
    from public.sites s
   where s.id = p_site_id and s.deleted_at is null
     and (s.user_id = v_uid or (s.team_id is not null and public.is_team_member(s.team_id)));
  -- P0002: the plan is not visible to the caller at all (typically a brand-new plan not pushed yet) — the
  -- client keeps its pending change and retries. 42501: visible but view-only (locked team plan) — refused.
  if v_owner is null then raise exception 'That plan is not in the cloud yet.' using errcode = 'P0002'; end if;
  if not v_can then raise exception 'That plan is view-only for you.' using errcode = '42501'; end if;

  insert into public.project_layer_opacity as p (owner_id, group_id, opacity)
  values (v_owner, v_group, jsonb_strip_nulls(p_patch))
  on conflict (owner_id, group_id) do update
     set opacity = jsonb_strip_nulls(p.opacity || p_patch), updated_at = now()
  returning p.opacity into v_out;
  return v_out;
end;
$$;
revoke all on function public.set_project_layer_opacity(text, jsonb) from public, anon;
grant execute on function public.set_project_layer_opacity(text, jsonb) to authenticated;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select relrowsecurity from pg_class where oid = 'public.project_layer_opacity'::regclass;   -- true
--   select count(*) from pg_policy where polrelid = 'public.project_layer_opacity'::regclass;    -- 0 (no direct door)
--   select proname, prosecdef from pg_proc where proname in ('get_project_layer_opacity','set_project_layer_opacity'); -- 2 rows, true
