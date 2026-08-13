-- ============================================================================
-- Sharing answers three questions instead of returning one ambiguous integer,
-- and it stops keying on a mirror column that is known to drift (NEW-1 · NEW-3).
-- Run ONCE in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi), AFTER
-- db/team_share_default.sql. Idempotent; safe to re-run.
--
-- ADDITIVE + ONE BODY FIX. It adds a function and replaces the BODY of
-- set_project_team (same name, same arguments, same integer return, so every
-- deployed client keeps working). It changes no table, no column, no policy and
-- no trigger, and it writes no row's team_id. Nothing's visibility changes when
-- this runs.
--
-- ---------------------------------------------------------------------------
-- NEW-1 — WHY THE INTEGER WAS NOT ENOUGH: "0 ROWS CHANGED" WAS READ AS
--         "0 ROWS EXIST", AND THAT MESSAGE CAN NEVER BE TRUE HERE.
--
-- set_project_team returns `row_count` from an UPDATE carrying
-- `and team_id is distinct from p_team_id`. Re-sharing a project to the team it
-- is ALREADY shared with therefore changes nothing and returns 0 — and the
-- client read 0 as "this project isn't in the cloud yet", which is the case
-- where the message is most wrong. Reported against "8 South" (group
-- smqiljx5fngg) at version 587, shared to team 454aa114 for weeks.
--
-- Worse, on THIS database that message is unreachable-when-true: the genuine
-- not-in-cloud case never reaches the `return` at all, because the function
-- raises 'No project of yours with that id.' first. So post-migration a 0 means
-- EXACTLY "already in that state" and the string is false 100% of the time it
-- is shown.
--
-- The codebase already knew this idiom matters — storage.js documents that
-- cloudDelete returning removed:0 means RLS REFUSED rather than "nothing was
-- there". The share path just never got the same care. So the answer is now a
-- jsonb with the three cases NAMED at the source, and the caller does no
-- guessing: 'not-found' · 'changed' · 'already'.
--
-- ---------------------------------------------------------------------------
-- NEW-3 — THE GROUP KEY WAS THE DRIFTING MIRROR, WHICH IS THE RENAME BUG AGAIN.
--
-- Both functions used to match `coalesce(group_id, id)` — the group_id COLUMN.
-- db/rename_site_group.sql exists because that column is a denormalized mirror
-- known to drift from the jsonb, and its header says outright: "matching on it
-- would rename the wrong set. Do not 'optimise' this onto the column." Sharing
-- was matching on exactly that column while the CLIENT passes a group id read
-- out of the jsonb (`groupOf()` → `data->>'groupId'`), so the two disagree
-- whenever the mirror has drifted — and the drift is real in this database
-- today (row 'e2e-fixture-testfit' has group_id 'e2e-fixture' against
-- data->>'groupId' 'e2e-fixture-testfit').
--
-- Consequence, in both directions: a plan whose column disagrees is MISSED (it
-- keeps whatever sharing it had, so a "shared" project is only partly shared,
-- or an "unshared" one leaves a collaborator with access the owner believes he
-- revoked), and a foreign plan whose column happens to name the group is swept
-- IN. The key is now `coalesce(data->>'groupId', id)` — byte-identical to
-- rename_site_group.sql and to the client's own groupOf(), so all three read
-- one grouping.
--
-- Sharing already reaches plans this browser has never opened, and that was
-- never in doubt: it is ONE server-side UPDATE over the group, not a
-- client-side loop over locally-cached plans (which is what half-landed the
-- rename). This fixes WHICH rows that statement selects, not whether it is
-- atomic. Postgres applies a single UPDATE atomically, so it cannot half-land.
-- ============================================================================

-- 1) The corrected group key on the existing integer RPC ---------------------
-- Same signature and same return type on purpose: an already-deployed client
-- (the owner's open tab, until it reloads) keeps calling this and keeps getting
-- the integer it expects. Only the row-matching key changes.
create or replace function public.set_project_team(p_group_id text, p_team_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_count integer := 0;
  v_mine  integer := 0;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_group_id is null or p_group_id = '' then raise exception 'Which project?' using errcode = '22023'; end if;

  if p_team_id is not null and not public.is_team_member(p_team_id) then
    raise exception 'You are not a member of that team.' using errcode = '42501';
  end if;

  select count(*) into v_mine from public.sites
    where coalesce(data->>'groupId', id) = p_group_id and user_id = v_uid and deleted_at is null;
  if v_mine = 0 then raise exception 'No project of yours with that id.' using errcode = '42501'; end if;

  perform set_config('planyr.share_intent', '1', true);   -- transaction-local; cannot leak
  update public.sites set team_id = p_team_id
    where coalesce(data->>'groupId', id) = p_group_id and user_id = v_uid and deleted_at is null
      and team_id is distinct from p_team_id;
  get diagnostics v_count = row_count;
  perform set_config('planyr.share_intent', '0', true);

  return v_count;
end;
$$;
revoke all on function public.set_project_team(text, uuid) from public;
grant execute on function public.set_project_team(text, uuid) to authenticated;

-- 2) The three-answer RPC the client now prefers ----------------------------
-- SECURITY DEFINER so it can set the intent flag the guard trigger looks for,
-- and it re-checks sign-in + team membership ITSELF, exactly as its sibling
-- does — running as owner means RLS is not doing that for us, so nothing here
-- may be left implicit. It can never grant access the database would refuse.
create or replace function public.set_project_team_state(p_group_id text, p_team_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid    := auth.uid();
  v_mine    integer := 0;   -- live plans in this group that are MINE (the rows this can move)
  v_already integer := 0;   -- ...of those, how many already carried the target team
  v_plans   integer := 0;   -- live plans in the group, whoever owns them
  v_changed integer := 0;   -- rows this call actually wrote
  v_left    integer := 0;   -- MINE still not carrying the target AFTER the write (must be 0)
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_group_id is null or p_group_id = '' then raise exception 'Which project?' using errcode = '22023'; end if;

  -- Sharing INTO a team requires you to be in it. Without this check a
  -- SECURITY DEFINER function would happily publish a project to strangers.
  if p_team_id is not null and not public.is_team_member(p_team_id) then
    raise exception 'You are not a member of that team.' using errcode = '42501';
  end if;

  -- One pass. `already` is only meaningful for rows this call could actually move, so it is scoped
  -- to mine — same scope as the UPDATE below, so the counts and the write cannot disagree.
  select count(*),
         count(*) filter (where user_id = v_uid),
         count(*) filter (where user_id = v_uid and team_id is not distinct from p_team_id)
    into v_plans, v_mine, v_already
    from public.sites
   where coalesce(data->>'groupId', id) = p_group_id and deleted_at is null;

  -- ⛔ NEW-1: "no rows of mine" is an ANSWER, not an error and not a zero. It is the ONLY case in
  -- which "this project isn't in the cloud yet" is a true thing to say, so it is the only case that
  -- reports it — named, so the caller cannot confuse it with a no-op write.
  if v_mine = 0 then
    return jsonb_build_object('outcome', 'not-found', 'matched', 0, 'changed', 0, 'already', 0,
      'plans', v_plans, 'foreign', v_plans, 'mismatched', 0, 'team_id', p_team_id);
  end if;

  -- ONE statement over the whole group, so it reaches every plan including ones the calling browser
  -- has never opened. Only the caller's OWN plans move: a group containing someone else's plan is
  -- not an error, but their rows are left exactly as they were (reported as `foreign`).
  perform set_config('planyr.share_intent', '1', true);   -- transaction-local; cannot leak
  update public.sites set team_id = p_team_id
   where coalesce(data->>'groupId', id) = p_group_id and user_id = v_uid and deleted_at is null
     and team_id is distinct from p_team_id;
  get diagnostics v_changed = row_count;
  perform set_config('planyr.share_intent', '0', true);

  -- NEW-3, LOUD-FAILURE: re-ask the question after writing rather than trusting the write. A
  -- half-shared project is worse than an unshared one — on the unshare side a collaborator would
  -- keep access the owner believes he revoked — so the call reports its own completeness and the
  -- client says so out loud instead of quietly patching.
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
revoke all on function public.set_project_team_state(text, uuid) from public;
grant execute on function public.set_project_team_state(text, uuid) to authenticated;

comment on function public.set_project_team_state(text, uuid) is
  'Share/unshare a project (site group) with a team and return the OUTCOME, not a row count: '
  '{outcome: not-found|changed|already, matched, changed, already, plans, foreign, mismatched}. '
  'Groups by coalesce(data->>''groupId'', id) — the same key as rename_site_group and the client''s '
  'groupOf(); the group_id COLUMN is a mirror known to drift and must not be used. mismatched > 0 '
  'means the share half-landed and the caller must report it loudly.';

-- After running:
--   • Re-sharing an already-shared project answers outcome:'already' (a success), never a false
--     "isn't in the cloud yet".
--   • A genuinely absent project answers outcome:'not-found' — the one case that message fits.
--   • Both share and unshare select rows by the same group key the client and the rename use, so a
--     drifted group_id mirror can no longer leave a plan behind in either direction.
--   • Every existing project keeps exactly the visibility it had. Nothing is back-filled.
