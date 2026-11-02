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
-- The legitimate join paths (create_team / redeem_invite_link / respond_to_invite) run
-- SECURITY DEFINER and bypass RLS, so they are unaffected.

drop policy if exists "self add via claim"  on public.team_members;
drop policy if exists "self join via invite" on public.team_members;
-- NEW-1 (2026-11-02): the replacement "self join via invite" policy this file used to create is GONE as well —
-- it matched on the account's address, which is not proof of the mailbox while email confirmation is off.
-- See db/team_invite_proof.sql.
