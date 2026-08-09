-- ============================================================================
-- RLS scope test for default team sharing (B326419 / V124976).
--
-- Proves, AGAINST THE REAL POLICIES, the single highest-risk property of the
-- default-sharing feature:
--
--     A PROJECT THAT ALREADY EXISTS NEVER BECOMES VISIBLE TO A TEAMMATE.
--
-- This tests the DATABASE, not the UI. Every assertion is a real query issued as a
-- real `authenticated` role with a real JWT subject, so it exercises the policies
-- and triggers exactly as the browser does. UI filtering is not consulted and would
-- not help: the whole point is that a teammate cannot read the row by calling the
-- API directly, guessing an id, or replaying a stale client cache.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and execute.
--   It is SELF-ROLLING-BACK — it ends by raising an exception carrying the report,
--   so every fixture (users, team, sites) is discarded. It writes NOTHING that
--   survives. Read the report out of the error message.
--
-- HOW TO PROVE IT RED (do this whenever the guard is touched):
--   Re-point the trigger at the OLD, permissive guard and re-run —
--     drop trigger if exists sites_team_share_guard on public.sites;
--     create trigger sites_team_rehome_guard before update on public.sites
--       for each row execute function public.guard_team_rehome();
--   Test 2 and Test 3 must FAIL (an ordinary owner UPDATE shares the old project,
--   and the teammate can then read it). Restoring the guard must turn them green.
--   A guard nobody has watched fail is a guard that has rotted green.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-00000000a001';  -- A: owns projects, on the team
  ub uuid := '00000000-0000-4000-8000-00000000b001';  -- B: A's teammate
  uc uuid := '00000000-0000-4000-8000-00000000c001';  -- C: solo, on no team at all
  tm uuid := '00000000-0000-4000-8000-00000000d001';  -- the team
  old_site text := 'rlstest-old-private';   -- a project that EXISTED before the feature
  new_site text := 'rlstest-new-shared';    -- a project created AFTER it
  solo_site text := 'rlstest-solo';
  rep text := '';
  n int;
  failed int := 0;
  passed int := 0;
  procname text;
begin
  -- helper: record a result -------------------------------------------------
  -- (inline, because a DO block cannot declare functions)

  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@test.invalid', now(), now()),
         (uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-c@test.invalid', now(), now());

  insert into public.teams (id, name, created_by) values (tm, 'RLS Test Team', ua);
  insert into public.team_members (team_id, user_id, role, added_by)
  values (tm, ua, 'admin', ua), (tm, ub, 'member', ua);

  -- A's PRE-EXISTING private project. team_id NULL — exactly what every one of the
  -- owner's real projects looks like today.
  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id)
  values (old_site, ua, old_site, 'Old private project', 'Concept A', now(), '{"id":"rlstest-old-private"}'::jsonb, null);
  insert into public.site_elements (site_id, id, kind, data)
  values (old_site, 'e1', 'el', '{"id":"e1"}'::jsonb);

  -- C is solo: a project with no team, and C is on no team.
  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id)
  values (solo_site, uc, solo_site, 'Solo project', 'Concept A', now(), '{"id":"rlstest-solo"}'::jsonb, null);

  -- ---------- TEST 1 — the old project is invisible to the teammate --------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.sites where id = old_site;
  if n = 0 then passed := passed + 1; rep := rep || E'PASS  1. teammate cannot see A''s pre-existing private project\n';
  else failed := failed + 1; rep := rep || format(E'FAIL  1. teammate SAW %s pre-existing private row(s)\n', n); end if;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- TEST 2 — an ordinary owner UPDATE cannot share it ------------
  -- THE scope guard. A is the OWNER, so RLS and the old rehome guard both allow this
  -- write; only deny-by-default stops it. This is the exact shape a client bug, a
  -- stale in-memory model or a replayed cache write would take.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  begin
    update public.sites set team_id = tm where id = old_site;
    get diagnostics n = row_count;
    if n = 0 then passed := passed + 1; rep := rep || E'PASS  2. ordinary UPDATE of team_id changed no row\n';
    else failed := failed + 1; rep := rep || format(E'FAIL  2. ordinary UPDATE SHARED %s pre-existing row(s) — SCOPE BREACH\n', n); end if;
  exception when others then
    passed := passed + 1;
    rep := rep || format(E'PASS  2. ordinary UPDATE of team_id refused: %s\n', sqlerrm);
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- TEST 3 — and it is STILL invisible afterwards ----------------
  -- Test 2 could pass on a technicality (an error raised after the row changed).
  -- This asks the question that actually matters, from the teammate's side.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.sites where id = old_site;
  if n = 0 then passed := passed + 1; rep := rep || E'PASS  3. after the attempt, teammate still cannot see it\n';
  else failed := failed + 1; rep := rep || E'FAIL  3. teammate CAN NOW SEE the pre-existing project — SCOPE BREACH\n'; end if;
  select count(*) into n from public.site_elements where site_id = old_site;
  if n = 0 then passed := passed + 1; rep := rep || E'PASS  3b. nor its drawing (site_elements)\n';
  else failed := failed + 1; rep := rep || format(E'FAIL  3b. teammate can read %s element row(s) of it\n', n); end if;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- TEST 4 — a NEW project IS born shared ------------------------
  -- The feature must actually work, or "nothing leaked" is trivially true.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id)
  values (new_site, ua, new_site, 'New shared project', 'Concept A', now(), '{"id":"rlstest-new-shared"}'::jsonb, tm);
  insert into public.site_elements (site_id, id, kind, data) values (new_site, 'e2', 'el', '{"id":"e2"}'::jsonb);
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.sites where id = new_site;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  4. teammate CAN see a newly created shared project\n';
  else failed := failed + 1; rep := rep || E'FAIL  4. the feature does not work — teammate cannot see the new shared project\n'; end if;

  -- ---------- TEST 5 — teammate has FULL EDIT while unlocked ---------------
  update public.sites set site = 'edited by teammate' where id = new_site;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  5. teammate can EDIT an unlocked shared plan\n';
  else failed := failed + 1; rep := rep || E'FAIL  5. teammate cannot edit an unlocked shared plan (should have full edit)\n'; end if;
  update public.site_elements set data = '{"id":"e2","moved":true}'::jsonb where site_id = new_site;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  5b. …including its drawing\n';
  else failed := failed + 1; rep := rep || E'FAIL  5b. teammate cannot edit the drawing of an unlocked shared plan\n'; end if;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- TEST 6 — the owner's lock makes it view-only -----------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  update public.sites set share_locked = true where id = new_site;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.sites where id = new_site;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  6. a locked plan is still READABLE by the teammate\n';
  else failed := failed + 1; rep := rep || E'FAIL  6. locking hid the plan (it should stay readable)\n'; end if;

  update public.sites set site = 'teammate edit while locked' where id = new_site;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; rep := rep || E'PASS  6b. teammate CANNOT write a locked plan\n';
  else failed := failed + 1; rep := rep || E'FAIL  6b. teammate wrote a LOCKED plan\n'; end if;

  update public.site_elements set data = '{"id":"e2","moved":"again"}'::jsonb where site_id = new_site;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; rep := rep || E'PASS  6c. …nor its drawing\n';
  else failed := failed + 1; rep := rep || E'FAIL  6c. teammate MOVED ELEMENTS on a locked plan\n'; end if;

  -- a teammate must not be able to simply unlock it
  begin
    update public.sites set share_locked = false where id = new_site;
    get diagnostics n = row_count;
    if n = 0 then passed := passed + 1; rep := rep || E'PASS  6d. teammate cannot unlock it\n';
    else failed := failed + 1; rep := rep || E'FAIL  6d. teammate UNLOCKED the plan\n'; end if;
  exception when others then
    passed := passed + 1; rep := rep || format(E'PASS  6d. teammate cannot unlock it: %s\n', sqlerrm);
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- TEST 7 — the solo user is untouched --------------------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', uc, 'role', 'authenticated')::text);
  select count(*) into n from public.sites where id = solo_site;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  7. a solo user still sees their own project\n';
  else failed := failed + 1; rep := rep || E'FAIL  7. a solo user lost sight of their own project\n'; end if;
  select count(*) into n from public.sites where id in (old_site, new_site);
  if n = 0 then passed := passed + 1; rep := rep || E'PASS  7b. and sees nobody else''s\n';
  else failed := failed + 1; rep := rep || format(E'FAIL  7b. solo user can read %s row(s) belonging to others\n', n); end if;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- TEST 8 — the explicit share RPC is the ONE way in ------------
  -- A deliberate share of the old project must WORK (the owner keeps control) …
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  begin
    select public.set_project_team(old_site, tm) into n;
    if n = 1 then passed := passed + 1; rep := rep || E'PASS  8. the owner CAN still deliberately share an old project (RPC)\n';
    else failed := failed + 1; rep := rep || format(E'FAIL  8. deliberate share changed %s row(s), expected 1\n', n); end if;
  exception when others then
    failed := failed + 1; rep := rep || format(E'FAIL  8. deliberate share raised: %s\n', sqlerrm);
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- … and a NON-owner must not be able to share someone else's project.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    select public.set_project_team(solo_site, tm) into n;
    failed := failed + 1; rep := rep || format(E'FAIL  9. a non-owner shared someone else''s project (%s rows)\n', n);
  exception when others then
    passed := passed + 1; rep := rep || format(E'PASS  9. a non-owner cannot share a project they do not own: %s\n', sqlerrm);
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- report + rollback -------------------------------------------
  raise exception E'\n%\n---- % passed, % FAILED ----\n(this exception is deliberate: it rolls the whole test back)',
    rep, passed, failed;
end $$;
