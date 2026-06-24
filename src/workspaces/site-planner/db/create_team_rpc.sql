-- Atomic team creation (B-TEAM fix) — run ONCE in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi), AFTER db/teams.sql. Idempotent; safe to re-run.
--
-- WHY this exists: the browser previously created a team in two steps —
--   1) INSERT into public.teams ... RETURNING id   (to learn the new id)
--   2) INSERT the creator's row into public.team_members as 'admin'
-- Step 1's RETURNING/SELECT is filtered by the teams SELECT policy
-- ("members read team" → is_team_member(id)), but the creator is NOT a member
-- yet (that's step 2). Postgres therefore rejects step 1 with
--   "new row violates row-level security policy for table teams"
-- on EVERY attempt, regardless of how the migration ran.
--
-- This SECURITY DEFINER function runs as the function owner (RLS bypassed for
-- the inserts inside it), creates the team AND the owner's admin membership in
-- one transaction, and returns the new id directly — no client-side
-- RETURNING-through-RLS. auth.uid() resolves to the caller because supabase-js
-- sends the signed-in user's token with the rpc() call (same pattern as
-- claim_team_invites / list_team_members in db/teams.sql).

create or replace function public.create_team(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if v_name = '' then
    raise exception 'Team name is required' using errcode = '22023';
  end if;

  insert into public.teams (name, created_by)
    values (v_name, v_uid)
    returning id into v_id;

  insert into public.team_members (team_id, user_id, role, added_by)
    values (v_id, v_uid, 'admin', v_uid)
    on conflict (team_id, user_id) do nothing;

  return v_id;
end;
$$;

revoke all on function public.create_team(text) from public;
grant execute on function public.create_team(text) to authenticated;
