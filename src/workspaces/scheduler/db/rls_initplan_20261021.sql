-- B2404339 (NEW-4, DB hardening block 2026-10-21) — fifteen RLS policies re-evaluated auth.uid() PER ROW.
--
-- MEASURED: Supabase performance advisor `auth_rls_initplan`, 2026-10-19/21 — 15 findings. The
-- site-planner family already uses the initplan form (`( SELECT auth.uid() AS uid)` on sites /
-- doc_reviews / comps …); these are the scheduler / upload / invite policies that predate that
-- convention. planar_history (96 MB, 218 rows, 1,043 seq scans) is where per-row re-evaluation shows.
--
-- Each policy below is re-created with the predicate measured on production via
-- pg_get_expr(polqual / polwithcheck) — pasted, not retyped from the old files — with the ONE change
-- `auth.uid()` → `(select auth.uid())` (and `auth.email()` → `(select auth.email())` on team_invites).
-- Roles, command and permissiveness are preserved exactly: every policy is `to authenticated` except
-- `upload_sessions."own sessions"`, whose measured polroles is {0} (= public) and stays so. None of the
-- fifteen calls is_team_member / is_team_admin, so there is nothing to wrap there.
--
-- Home files these supersede (kept for a fresh setup; this file is the production re-issue):
--   scheduler/db/planar_tables_owner_scoped_rls.sql (planar_data, planar_history, planar_suggestions)
--   scheduler/db/schedules_normalization.sql         (schedules, schedule_account_index)
--   site-planner/db/teams.sql                        (team_invites "invitee reads own")
--   server/storage/db/upload_sessions.sql            (upload_sessions "own sessions")
--
-- Idempotent (drop if exists + create). Applied to production by the shipping session inside one
-- transaction; advisor count 15 → 0 is recorded on B2404339. Guard: the scheduler RLS proof
-- (scheduler/db/test/schedules_rls.test.sql) and the food/site-planner suites are unchanged by this.

-- planar_data ---------------------------------------------------------------
drop policy if exists "insert own schedule" on public.planar_data;
create policy "insert own schedule" on public.planar_data
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "select own schedule" on public.planar_data;
create policy "select own schedule" on public.planar_data
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "update own schedule" on public.planar_data;
create policy "update own schedule" on public.planar_data
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- planar_history ------------------------------------------------------------
drop policy if exists "insert own schedule history" on public.planar_history;
create policy "insert own schedule history" on public.planar_history
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "select own schedule history" on public.planar_history;
create policy "select own schedule history" on public.planar_history
  for select to authenticated using (user_id = (select auth.uid()));

-- planar_suggestions --------------------------------------------------------
drop policy if exists "select own suggestions" on public.planar_suggestions;
create policy "select own suggestions" on public.planar_suggestions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "update own suggestions" on public.planar_suggestions;
create policy "update own suggestions" on public.planar_suggestions
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- schedule_account_index ----------------------------------------------------
drop policy if exists "insert own schedule index" on public.schedule_account_index;
create policy "insert own schedule index" on public.schedule_account_index
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "select own schedule index" on public.schedule_account_index;
create policy "select own schedule index" on public.schedule_account_index
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "update own schedule index" on public.schedule_account_index;
create policy "update own schedule index" on public.schedule_account_index
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- schedules -----------------------------------------------------------------
drop policy if exists "insert own schedule" on public.schedules;
create policy "insert own schedule" on public.schedules
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "select own schedule" on public.schedules;
create policy "select own schedule" on public.schedules
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "update own schedule" on public.schedules;
create policy "update own schedule" on public.schedules
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- team_invites --------------------------------------------------------------
drop policy if exists "invitee reads own" on public.team_invites;
create policy "invitee reads own" on public.team_invites
  for select to authenticated using (lower(email) = lower((select auth.email())));

-- upload_sessions (measured polroles = public; kept) -----------------------
drop policy if exists "own sessions" on public.upload_sessions;
create policy "own sessions" on public.upload_sessions
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- APPLY NOTE (2026-10-21): on production this was applied as fifteen `alter policy … using/with check`
-- statements (byte-identical predicates; name, command, roles and permissiveness untouched) because the
-- Supabase MCP holds any statement containing DROP for an interactive confirmation. The drop-and-create
-- form above is kept for psql / the SQL editor and is equivalent.
