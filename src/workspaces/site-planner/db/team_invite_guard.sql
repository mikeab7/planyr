-- Team-join hardening (security fix) — run ONCE in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi), AFTER db/teams.sql. Idempotent; safe to re-run.
--
-- WHY: the previous team_members INSERT policy "self add via claim" checked only
--   user_id = auth.uid()  — i.e. "are you adding yourself?" — but NOT "were you invited?".
-- A signed-in user who obtained any team's id could therefore craft a raw insert to add
-- themselves to that team at any role (including admin) = full team takeover. Team ids are
-- non-public UUIDs (a non-member can't read them anywhere), so it wasn't practically
-- exploitable, but it isn't a real boundary. This replaces that policy with one that requires
-- an UNCLAIMED invite for the caller's verified email AT THE SAME ROLE being inserted.
--
-- The legitimate join paths (create_team / claim_team_invites / handle_new_user) run
-- SECURITY DEFINER and bypass RLS, so they are unaffected.

drop policy if exists "self add via claim"  on public.team_members;
drop policy if exists "self join via invite" on public.team_members;
create policy "self join via invite" on public.team_members
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.team_invites i
      where i.team_id = team_members.team_id
        and lower(i.email) = lower((select auth.email()))
        and i.claimed_at is null
        and i.role = team_members.role
    )
  );
