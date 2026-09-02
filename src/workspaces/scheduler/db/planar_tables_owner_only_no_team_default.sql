-- CORRECTION to planar_tables_owner_scoped_rls.sql (same session, minutes later) — owner
-- decision, verbatim: "let me decide when i share." The prior migration's RLS predicate was
-- "owner OR same team", copying public.sites' team-shared default onto schedules without being
-- asked. That is wrong for this entity: a schedule is PRIVATE BY DEFAULT, visible to nobody but
-- its owner, until the owner performs a deliberate, explicit share action (a future feature,
-- NOT built yet, and not designed here — see BACKLOG.md NEW-2, blocked on this item). team_id
-- stays on the table as a column for that future feature to use, but participates in NO policy
-- here — not select, not insert, not update.
--
-- Also un-shares the one real row: the 2026-09-02 migration backfilled planar_data/_history/
-- _suggestions' team_id to HIP Houston (454aa114-1318-462d-8f78-ffad6ac01cac), which made the
-- existing schedule readable by Michael's two Hillwood teammates. That is exactly the implicit
-- team-inherited sharing the owner just ruled out, so it is undone: team_id is cleared back to
-- NULL and ownership is Michael alone (b147d90d-b610-423d-af65-7e004f0ad72f) — matching the fact
-- that this "hs-v1" blob's contents were never a shared/mixed multi-person document (its
-- "projects" are HIP Houston's individual construction DEALS — Goose Creek, Kilgore, etc — the
-- same project-naming convention as everywhere else in this app; not multiple different
-- people's personal schedules requiring an ownership judgment call).
--
-- CONSEQUENCE TO KNOW: the two Hillwood teammates (michael.butler@hillwood.com,
-- bryndan.nerren@hillwood.com) who could read/write this schedule under the prior migration
-- lose that access under this one, until Michael explicitly shares it via the (unbuilt) NEW-2
-- feature. This is the owner's own explicit instruction, not an oversight.
--
-- Applied directly to production (lyeqzkuiwngunutlkkmi) via the Supabase MCP `apply_migration`
-- tool on 2026-09-02, immediately after planar_tables_owner_scoped_rls.sql. This file is the
-- committed record; re-running both files in order is idempotent.
--
-- Live-verified after this correction (same role/JWT-claim simulation as the first migration):
--   anon SELECT                                        42501 permission denied (unchanged)
--   Michael (owner, authenticated)                      SELECT + UPDATE both succeed
--   HIP Houston teammate (real account, no longer owner) SELECT returns 0 rows (was visible before this fix)
--   unrelated signed-in stranger                        SELECT returns 0 rows (unchanged)

update public.planar_data set team_id = null where team_id is not null;
update public.planar_history set team_id = null where team_id is not null;
update public.planar_suggestions set team_id = null where team_id is not null;

drop policy if exists "select own or team schedule" on public.planar_data;
drop policy if exists "insert own schedule" on public.planar_data;
drop policy if exists "update own or team schedule" on public.planar_data;
drop policy if exists "select own or team schedule history" on public.planar_history;
drop policy if exists "insert own schedule history" on public.planar_history;
drop policy if exists "select own or team suggestions" on public.planar_suggestions;
drop policy if exists "update own or team suggestions" on public.planar_suggestions;

create policy "select own schedule" on public.planar_data
  for select to authenticated
  using (user_id = auth.uid());

create policy "insert own schedule" on public.planar_data
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "update own schedule" on public.planar_data
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "select own schedule history" on public.planar_history
  for select to authenticated
  using (user_id = auth.uid());

create policy "insert own schedule history" on public.planar_history
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "select own suggestions" on public.planar_suggestions
  for select to authenticated
  using (user_id = auth.uid());

create policy "update own suggestions" on public.planar_suggestions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
