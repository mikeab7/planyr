-- ============================================================================
-- B2404336 (NEW-1, 2026-10-21) — owner-column guard proof, against the REAL policies + triggers.
--
-- Proves that a TEAM MEMBER cannot reassign `user_id` on a shared plan / review / file-facts row
-- (the hole measured on production 2026-10-19: RLS WITH CHECK cannot see OLD, and no BEFORE UPDATE
-- trigger pinned the owner column), that the OWNER still edits / shares / locks / transfers, and —
-- red-proof — that disabling the trigger lets the hijack land again.
--
-- Every assertion is a real statement issued as a real `authenticated` role with a real JWT subject,
-- so it exercises RLS + triggers exactly as PostgREST does.
--
-- HOW TO RUN: paste into the Supabase SQL editor / run via the Supabase MCP `execute_sql`, or
-- `node scripts/run-db-tests.mjs --dir src/workspaces/site-planner/db/test`. SELF-ROLLING-BACK — it
-- ends by raising an exception carrying the report, so every fixture (users, team, rows) AND the
-- red-proof `disable trigger` are discarded. It writes NOTHING that survives.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000c0c01';  -- A: owner, team admin
  ub uuid := '00000000-0000-4000-8000-0000000c0c02';  -- B: A's teammate (member)
  uc uuid := '00000000-0000-4000-8000-0000000c0c03';  -- C: a third party on no team
  tm uuid := '00000000-0000-4000-8000-0000000c0c04';  -- the team
  site_id text := 'ocgtest-site-1';
  rev_id  text := 'ocgtest-review-1';
  ff_id   text := 'ocgtest-facts-1';
  rep text := '';
  n int;
  owner_now uuid;
  passed int := 0;
  failed int := 0;
  trg_count int;
begin
  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ocg-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ocg-b@test.invalid', now(), now()),
         (uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ocg-c@test.invalid', now(), now());
  insert into public.teams (id, name, created_by) values (tm, 'OCG Test Team', ua);
  insert into public.team_members (team_id, user_id, role, added_by)
  values (tm, ua, 'admin', ua), (tm, ub, 'member', ua);

  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id)
  values (site_id, ua, site_id, 'OCG shared project', 'Concept A', now(), '{"id":"ocgtest-site-1"}'::jsonb, tm);
  insert into public.doc_reviews (id, user_id, title, data, team_id)
  values (rev_id, ua, 'OCG review', '{"id":"ocgtest-review-1"}'::jsonb, tm);
  insert into public.file_facts (id, user_id, team_id, project_id)
  values (ff_id, ua, tm, site_id);

  -- ---------- 0. the trigger exists on all three tables ----------------------
  select count(*) into trg_count from pg_trigger
   where tgname in ('sites_owner_column_guard','doc_reviews_owner_column_guard','file_facts_owner_column_guard');
  if trg_count = 3 then passed := passed + 1; rep := rep || E'PASS  0. owner-column guard trigger present on sites, doc_reviews, file_facts\n';
  else failed := failed + 1; rep := rep || format(E'FAIL  0. expected 3 owner-column guard triggers, found %s\n', trg_count); end if;

  -- ---------- 1. member B cannot take ownership of A's shared SITE -----------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    update public.sites set user_id = ub where id = site_id;
    get diagnostics n = row_count;
    failed := failed + 1; rep := rep || format(E'FAIL  1. member REASSIGNED user_id on the shared site (%s row) — HIJACK\n', n);
  exception when others then
    if sqlstate = '42501' and sqlerrm like 'Only the project owner can transfer a plan.%' then
      passed := passed + 1; rep := rep || format(E'PASS  1. member user_id reassignment on sites refused 42501: %s\n', sqlerrm);
    else
      failed := failed + 1; rep := rep || format(E'FAIL  1. refused but with the wrong code/message: [%s] %s\n', sqlstate, sqlerrm);
    end if;
  end;
  -- … nor hand it to a third party through the policy's second branch
  begin
    update public.sites set user_id = uc where id = site_id;
    get diagnostics n = row_count;
    failed := failed + 1; rep := rep || format(E'FAIL  1b. member handed the shared site to a THIRD PARTY (%s row)\n', n);
  exception when others then
    if sqlstate = '42501' then passed := passed + 1; rep := rep || E'PASS  1b. member cannot hand the site to a third party (42501)\n';
    else failed := failed + 1; rep := rep || format(E'FAIL  1b. wrong code: [%s] %s\n', sqlstate, sqlerrm); end if;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select user_id into owner_now from public.sites where id = site_id;
  if owner_now = ua then passed := passed + 1; rep := rep || E'PASS  1c. the site still belongs to A\n';
  else failed := failed + 1; rep := rep || format(E'FAIL  1c. the site now belongs to %s\n', owner_now); end if;

  -- ---------- 2. same on DOC_REVIEWS ----------------------------------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    update public.doc_reviews set user_id = ub where id = rev_id;
    get diagnostics n = row_count;
    failed := failed + 1; rep := rep || format(E'FAIL  2. member REASSIGNED user_id on the shared review (%s row) — HIJACK\n', n);
  exception when others then
    if sqlstate = '42501' then passed := passed + 1; rep := rep || E'PASS  2. member user_id reassignment on doc_reviews refused (42501)\n';
    else failed := failed + 1; rep := rep || format(E'FAIL  2. wrong code: [%s] %s\n', sqlstate, sqlerrm); end if;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select user_id into owner_now from public.doc_reviews where id = rev_id;
  if owner_now = ua then passed := passed + 1; rep := rep || E'PASS  2b. the review still belongs to A\n';
  else failed := failed + 1; rep := rep || format(E'FAIL  2b. the review now belongs to %s\n', owner_now); end if;

  -- ---------- 3. same on FILE_FACTS -----------------------------------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    update public.file_facts set user_id = ub where id = ff_id;
    get diagnostics n = row_count;
    failed := failed + 1; rep := rep || format(E'FAIL  3. member REASSIGNED user_id on the shared file_facts row (%s row) — HIJACK\n', n);
  exception when others then
    if sqlstate = '42501' then passed := passed + 1; rep := rep || E'PASS  3. member user_id reassignment on file_facts refused (42501)\n';
    else failed := failed + 1; rep := rep || format(E'FAIL  3. wrong code: [%s] %s\n', sqlstate, sqlerrm); end if;
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select user_id into owner_now from public.file_facts where id = ff_id;
  if owner_now = ua then passed := passed + 1; rep := rep || E'PASS  3b. the file_facts row still belongs to A\n';
  else failed := failed + 1; rep := rep || format(E'FAIL  3b. the file_facts row now belongs to %s\n', owner_now); end if;

  -- ---------- 4. the OWNER still edits content on all three ----------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  update public.sites set name = 'Concept A (renamed by owner)', version = version + 1 where id = site_id;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  4. owner can still edit the site\n';
  else failed := failed + 1; rep := rep || E'FAIL  4. owner edit of the site changed no row\n'; end if;
  update public.doc_reviews set title = 'OCG review (edited)' where id = rev_id;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  4b. owner can still edit the review\n';
  else failed := failed + 1; rep := rep || E'FAIL  4b. owner edit of the review changed no row\n'; end if;
  update public.file_facts set sheet_title = 'edited' where id = ff_id;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  4c. owner can still edit the file_facts row\n';
  else failed := failed + 1; rep := rep || E'FAIL  4c. owner edit of file_facts changed no row\n'; end if;
  -- … and a TEAMMATE still edits CONTENT (the feature must keep working, or "refused" is trivially true)
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  update public.sites set name = 'Concept A (edited by teammate)', version = version + 1 where id = site_id;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; rep := rep || E'PASS  4d. teammate can still edit an unlocked shared plan''s content\n';
  else failed := failed + 1; rep := rep || E'FAIL  4d. teammate lost content edit on an unlocked shared plan\n'; end if;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- 5. the owner's SECURITY DEFINER share / lock RPCs still work --
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  -- (unshare, then re-share: set_project_team only counts rows whose team_id actually CHANGES, so
  -- re-sharing an already-shared plan honestly returns 0 — measured 2026-10-21, not a guard refusal)
  begin
    select public.set_project_team(site_id, null) into n;
    if n = 1 then passed := passed + 1; rep := rep || E'PASS  5. owner set_project_team (unshare) still works through the guard\n';
    else failed := failed + 1; rep := rep || format(E'FAIL  5. set_project_team (unshare) changed %s row(s), expected 1\n', n); end if;
    select public.set_project_team(site_id, tm) into n;
    if n = 1 then passed := passed + 1; rep := rep || E'PASS  5a. owner set_project_team (re-share) still works through the guard\n';
    else failed := failed + 1; rep := rep || format(E'FAIL  5a. set_project_team (re-share) changed %s row(s), expected 1\n', n); end if;
  exception when others then
    failed := failed + 1; rep := rep || format(E'FAIL  5. set_project_team raised: [%s] %s\n', sqlstate, sqlerrm);
  end;
  begin
    perform public.set_plan_lock(site_id, true);
    passed := passed + 1; rep := rep || E'PASS  5b. owner set_plan_lock still works through the guard\n';
  exception when others then
    failed := failed + 1; rep := rep || format(E'FAIL  5b. set_plan_lock raised: [%s] %s\n', sqlstate, sqlerrm);
  end;
  perform public.set_plan_lock(site_id, false);
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ---------- 6. the CURRENT OWNER may deliberately transfer ---------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  begin
    update public.sites set user_id = ub where id = site_id;
    get diagnostics n = row_count;
    if n = 1 then passed := passed + 1; rep := rep || E'PASS  6. the current owner CAN transfer the plan to a teammate\n';
    else failed := failed + 1; rep := rep || E'FAIL  6. owner transfer changed no row\n'; end if;
  exception when others then
    failed := failed + 1; rep := rep || format(E'FAIL  6. owner transfer raised: [%s] %s\n', sqlstate, sqlerrm);
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  update public.sites set user_id = ua where id = site_id;   -- put it back (as postgres, allowed)

  -- ---------- 7. RED-PROOF — without the trigger the hijack LANDS ----------
  -- (DDL inside this block; rolled back with everything else by the final raise. DISABLE rather
  -- than DROP on purpose: the Supabase MCP holds any statement containing DROP for a confirmation
  -- an unattended session can never give — measured 2026-10-21, 60 s timeouts — and the effect
  -- inside this transaction is identical.)
  alter table public.sites disable trigger sites_owner_column_guard;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    update public.sites set user_id = ub where id = site_id;
    get diagnostics n = row_count;
    if n = 1 then passed := passed + 1; rep := rep || E'PASS  7. red-proof: with the trigger disabled, the member hijack LANDS (the guard is what stops it)\n';
    else failed := failed + 1; rep := rep || E'FAIL  7. red-proof: trigger disabled yet the hijack changed no row — the test cannot see the hole it guards\n'; end if;
  exception when others then
    failed := failed + 1; rep := rep || format(E'FAIL  7. red-proof: trigger disabled yet refused: [%s] %s\n', sqlstate, sqlerrm);
  end;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select user_id into owner_now from public.sites where id = site_id;
  if owner_now = ub then passed := passed + 1; rep := rep || E'PASS  7b. red-proof: row owner is now B (would be the real outage)\n';
  else failed := failed + 1; rep := rep || E'FAIL  7b. red-proof: owner unchanged with the trigger disabled\n'; end if;

  -- ---------- report + rollback -------------------------------------------
  raise exception E'\n%\n---- % passed, % FAILED ----\n(this exception is deliberate: it rolls the whole test back, the disabled trigger included)',
    rep, passed, failed;
end $$;
