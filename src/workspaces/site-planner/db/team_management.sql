-- Team management helpers (B-TEAM fix) — run ONCE in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi), AFTER db/teams.sql. Idempotent; safe to re-run.
--
-- WHY this exists: the browser used to read "my teams" with a PostgREST embedded join
--   from("team_members").select("role, team:teams(...)")
-- which depends on PostgREST's foreign-key *relationship cache*. Right after the team
-- tables are (re)created, that cache can transiently 404 the relationship (PGRST200),
-- so a team you JUST created appears to not exist ("You're not on a team yet"). This
-- SECURITY DEFINER function does the join in SQL — no relationship cache, no RLS recursion —
-- so listing is reliable the instant a membership row exists. Mirrors list_team_members.

create or replace function public.list_my_teams()
returns table (id uuid, name text, role text, created_by uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, m.role, t.created_by, t.created_at
  from public.team_members m
  join public.teams t on t.id = m.team_id
  where m.user_id = auth.uid()
  order by t.created_at desc;
$$;

revoke all on function public.list_my_teams() from public;
grant execute on function public.list_my_teams() to authenticated;

-- Rename + delete are plain client UPDATE/DELETE in lib/teams.js, gated by the existing
-- "admins update team" / "admins delete team" RLS policies from db/teams.sql — no new SQL needed.
-- Project sharing reuses the team_id columns + RLS from db/team_sharing.sql — no new SQL needed.
