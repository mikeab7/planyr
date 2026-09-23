-- ============================================================================
-- B1853664 (NEW-3, security-definer audit dispatch, 2026-09-23) — redact the
-- `plans`/`foreign` counts `set_project_team_state` returns for a group the
-- caller owns NO plan in. Run ONCE in the Supabase SQL editor (project
-- lyeqzkuiwngunutlkkmi), after db/team_share_state.sql. Idempotent; safe to
-- re-run. BODY-ONLY replace — same name, same arguments, same jsonb shape, so
-- every deployed client keeps working unchanged.
--
-- ⛔ THIS FILE IS DELIBERATELY NOT APPLIED TO PRODUCTION FROM THE SESSION THAT
-- WROTE IT — the dispatch that produced this fix explicitly said not to touch
-- production schema/data this session ("Do not apply schema or data changes to
-- production from inside this session"). A human or a later Claude Code session
-- must run this (Supabase SQL editor, or `apply_migration` against project
-- lyeqzkuiwngunutlkkmi) before the fix is live. Until then the leak below is
-- still reachable on production.
--
-- ----------------------------------------------------------------------------
-- WHAT WAS FOUND, AND WHY IT IS A REAL (MINOR) HOLE.
--
-- `set_project_team_state` is `SECURITY DEFINER`, so it reasons over EVERY row
-- in the target group_id regardless of the caller's RLS visibility — that is
-- necessary for its job (it has to know whether ANY of the group's plans are
-- the caller's). Its NOT-FOUND branch (the caller owns zero plans in the
-- group — either the group doesn't exist, or it belongs entirely to someone
-- else) used to return:
--
--     'plans', v_plans, 'foreign', v_plans
--
-- where `v_plans` is a COUNT ACROSS EVERY OWNER in that group, computed before
-- any ownership check. So any authenticated caller who knows (or guesses) a
-- group_id they have NO relationship to — not a member, not a teammate, not
-- ever shared with — can call this RPC directly (bypassing the app's own UI,
-- which never reaches this branch for its own reads — see MapFinder.jsx's
-- `doShare`, which returns immediately on `outcome === "not-found"` and never
-- looks at `.plans`/`.foreign` in that case) and learn how many LIVE plans
-- exist in a project that is not theirs. That is a genuine cross-tenant
-- information disclosure through a SECURITY DEFINER function bypassing RLS —
-- small (an aggregate count, no names, no content), but real, and it is
-- exactly the class of hole B283 (`sites_referencing_storage_key`, see
-- docs/archive/BACKLOG-DONE.md) was fixed for once already.
--
-- The mutation half of this function was ALREADY SAFE — every UPDATE and every
-- non-zero `v_mine`/`v_already` count is filtered on `user_id = v_uid`, so a
-- non-owner could never move a foreign row. Only the READ, in the one branch
-- where the caller owns nothing in the group, over-shared.
--
-- THE FIX: redact `plans`/`foreign` to 0 in the not-found branch. The caller
-- has no legitimate need-to-know for a project they share nothing with. The
-- ALREADY-SHARES-SOME-PLANS branches (outcome `changed`/`already`) are
-- untouched — that is the case `doShare`'s "Shared your N of M plans — the
-- rest belong to a teammate" message legitimately needs, and it only fires
-- when `v_mine > 0`, i.e. the caller already has a real stake in the group.
-- ============================================================================

create or replace function public.set_project_team_state(p_group_id text, p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid    := auth.uid();
  v_mine    integer := 0;
  v_already integer := 0;
  v_plans   integer := 0;
  v_changed integer := 0;
  v_left    integer := 0;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_group_id is null or p_group_id = '' then raise exception 'Which project?' using errcode = '22023'; end if;

  if p_team_id is not null and not public.is_team_member(p_team_id) then
    raise exception 'You are not a member of that team.' using errcode = '42501';
  end if;

  select count(*),
         count(*) filter (where user_id = v_uid),
         count(*) filter (where user_id = v_uid and team_id is not distinct from p_team_id)
    into v_plans, v_mine, v_already
    from public.sites
   where coalesce(data->>'groupId', id) = p_group_id and deleted_at is null;

  if v_mine = 0 then
    -- B1853664 (NEW-3): a caller with NO plan in this group gets no count
    -- either — `v_plans` above is a global (every-owner) count and would
    -- otherwise leak how many live plans a foreign project holds.
    return jsonb_build_object('outcome', 'not-found', 'matched', 0, 'changed', 0, 'already', 0,
      'plans', 0, 'foreign', 0, 'mismatched', 0, 'team_id', p_team_id);
  end if;

  perform set_config('planyr.share_intent', '1', true);
  update public.sites set team_id = p_team_id
   where coalesce(data->>'groupId', id) = p_group_id and user_id = v_uid and deleted_at is null
     and team_id is distinct from p_team_id;
  get diagnostics v_changed = row_count;
  perform set_config('planyr.share_intent', '0', true);

  select count(*) into v_left from public.sites
   where coalesce(data->>'groupId', id) = p_group_id and user_id = v_uid and deleted_at is null
     and team_id is distinct from p_team_id;

  return jsonb_build_object(
    'outcome',    case when v_changed > 0 then 'changed' else 'already' end,
    'matched',    v_mine,
    'changed',    v_changed,
    'already',    v_already,
    'plans',      v_plans,
    'foreign',    v_plans - v_mine,
    'mismatched', v_left,
    'team_id',    p_team_id);
end;
$$;

comment on function public.set_project_team_state(text, uuid) is
  'B1853664 (NEW-3) — shares a project (site group) with a team or makes it private, returning a named outcome. The not-found branch (caller owns nothing in the group) redacts plans/foreign to 0 rather than leaking a cross-owner plan count.';
