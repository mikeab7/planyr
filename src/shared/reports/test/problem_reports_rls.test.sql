-- ============================================================================
-- RLS proof for problem reports (B842866).
--
-- Proves, AGAINST THE REAL POLICIES:
--   1. anon sees zero reports via a direct SELECT (no SELECT policy at all).
--   2. anon CAN insert a report with no user_id (the real signed-out "report a problem" path).
--   3. anon inserting a report that FORGES someone else's user_id is refused.
--   4. a signed-in, non-admin user sees zero rows via a direct SELECT either.
--   5. that same non-admin user gets zero rows from admin_list_problem_reports() (is_admin() false).
--   6. the real admin (seeded in admin_users) sees the report via admin_list_problem_reports().
--   7. a non-admin authenticated user CAN insert their own report (the signed-in path).
--   8. a signed-in user inserting under someone else's user_id is refused (server-checked owner).
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying the
-- report, so every fixture row is discarded. Run via the Supabase MCP execute_sql tool and read
-- the report out of the error message. Same shape as comp_import_drafts_rls.test.sql.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000e0a01';  -- A: an ordinary signed-in reporter
  ub uuid := '00000000-0000-4000-8000-0000000e0a02';  -- B: another ordinary signed-in user
  admin_uid uuid := 'b147d90d-b610-423d-af65-7e004f0ad72f'; -- the real seeded admin (admin_users.sql)
  n int;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-report-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-report-b@test.invalid', now(), now())
  on conflict (id) do nothing;

  -- ---------- Test 1: anon sees zero reports via direct SELECT ----------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.problem_reports;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 1: anon SELECT sees zero reports. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 1: anon SELECT saw %s reports, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 2: anon CAN insert a report with no user_id ----------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  begin
    insert into public.problem_reports (category, description, context, build, route)
    values ('slow', null, '{"route":"site-planner"}'::jsonb, 'rls-test', 'site-planner');
    n := 1;
  exception when insufficient_privilege or others then n := 0;
  end;
  execute 'reset role';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 2: anon can file a signed-out report. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 2: an anonymous report insert was refused.' || E'\n'; end if;

  -- ---------- Test 3: anon forging someone else's user_id is refused ----------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  begin
    insert into public.problem_reports (category, user_id) values ('problem', ua);
    n := 1;
  exception when insufficient_privilege or others then n := 0;
  end;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 3: anon cannot forge a user_id. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 3: an anon forged-owner insert succeeded.' || E'\n'; end if;

  -- ---------- Test 4: a non-admin signed-in user sees zero rows via SELECT ----
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  select count(*) into n from public.problem_reports;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 4: a non-admin signed-in user sees zero reports via SELECT. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 4: non-admin SELECT saw %s reports, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 5: that same user gets zero rows from the admin RPC --------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  select count(*) into n from public.admin_list_problem_reports();
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 5: a non-admin gets zero rows from admin_list_problem_reports(). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 5: non-admin RPC call saw %s reports, expected 0 — CROSS-USER READ LEAK.', n) || E'\n'; end if;

  -- ---------- Test 6: the real admin sees the report via the RPC --------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', admin_uid, 'role', 'authenticated')::text);
  select count(*) into n from public.admin_list_problem_reports() where build = 'rls-test';
  execute 'reset role';
  if n >= 1 then passed := passed + 1; rep := rep || format('PASS 6: the real admin sees the %s test report(s) via the RPC. ', n) || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 6: the admin RPC did not return the test report.' || E'\n'; end if;

  -- ---------- Test 7: a non-admin signed-in user CAN insert their own report --
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    insert into public.problem_reports (category, description, build, route)
    values ('problem', 'signed-in report', 'rls-test', 'notes');
    n := 1;
  exception when insufficient_privilege or others then n := 0;
  end;
  execute 'reset role';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 7: a signed-in user can file their own report. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 7: a signed-in user''s own report insert was refused.' || E'\n'; end if;

  -- ---------- Test 8: B cannot insert a report claiming to be A ---------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    insert into public.problem_reports (category, user_id) values ('problem', ua);
    n := 1;
  exception when insufficient_privilege or others then n := 0;
  end;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 8: a signed-in user cannot forge another user''s id. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 8: a spoofed-owner insert succeeded.' || E'\n'; end if;

  raise exception E'\n=== problem_reports RLS proof: % passed, % failed ===\n%', passed, failed, rep;
end $$;
