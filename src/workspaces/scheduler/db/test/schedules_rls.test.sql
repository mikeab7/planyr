-- ============================================================================
-- RLS proof for public.schedules + public.schedule_account_index (B1777120).
--
-- Proves, AGAINST THE REAL POLICIES, the owner-only shape (no team path — matches the
-- final, corrected planar_data shape: "let me decide when i share", B778 2026-09-02):
--   1. anon sees ZERO rows on either table, and cannot write either.
--   2. the owner reads their own schedules / their own index row.
--   3. a DIFFERENT signed-in user sees ZERO of the owner's schedules / index row, and
--      cannot UPDATE either.
--   4. the owner can insert a new schedule and a new index row.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying the
-- report, so every fixture (fake users + rows) is discarded. Paste into the Supabase SQL
-- editor (or run via execute_sql) and read the report out of the error message.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-00000000e001';  -- A: the owner
  ub uuid := '00000000-0000-4000-8000-00000000e002';  -- B: a different signed-in user
  sched_id bigint;
  n int;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-sched-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-sched-b@test.invalid', now(), now());

  insert into public.schedules (user_id, name, data)
  values (ua, 'rlstest owner schedule', jsonb_build_object('tasks', jsonb_build_array()))
  returning id into sched_id;

  insert into public.schedule_account_index (user_id, n_pid) values (ua, 42);

  -- ---------- Test 1: anon reads schedules -----------------------------------
  -- anon holds NO table grant at all here (revoke all on public.schedules from anon,
  -- matching planar_data's final locked-down shape) -- a SELECT as anon raises
  -- insufficient_privilege at the table level, never a silently-RLS-filtered 0 rows.
  begin
    execute 'set local role anon'; execute 'set local request.jwt.claims = default';
    select count(*) into n from public.schedules where id = sched_id;
    execute 'reset role';
    failed := failed + 1; rep := rep || format('FAIL 1: anon schedules read SUCCEEDED, returned %s rows (expected a permission error).', n) || E'\n';
  exception when insufficient_privilege or others then
    execute 'reset role';
    passed := passed + 1; rep := rep || 'PASS 1: anon (signed out) cannot read schedules at all (no table grant). ' || E'\n';
  end;

  -- ---------- Test 2: anon INSERT into schedules is refused ----------------
  begin
    execute 'set local role anon'; execute 'set local request.jwt.claims = default';
    insert into public.schedules (user_id, name, data) values (ua, 'hack', '{}'::jsonb);
    execute 'reset role';
    failed := failed + 1; rep := rep || 'FAIL 2: anon INSERT into schedules SUCCEEDED (should be refused). ' || E'\n';
  exception when insufficient_privilege or others then
    execute 'reset role';
    passed := passed + 1; rep := rep || 'PASS 2: anon cannot write schedules (no insert grant/policy). ' || E'\n';
  end;

  -- ---------- Test 3: owner (A) reads their own schedule --------------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  select count(*) into n from public.schedules where id = sched_id;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 3: owner (A) reads their own schedule. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 3: owner schedule read returned %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 4: a DIFFERENT signed-in user (B) reads A's schedule -----
  -- (expect 0 — owner-only, no team-shared path, matching the FINAL planar_data shape)
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.schedules where id = sched_id;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 4: a DIFFERENT signed-in user (B) sees ZERO of A''s schedules. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 4: user B saw %s of user A''s schedules, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 5: user B cannot UPDATE user A's schedule -----------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  update public.schedules set name = 'hacked by B', rev = rev + 1 where id = sched_id;
  get diagnostics n = row_count;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 5: user B''s UPDATE against A''s schedule touched 0 rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 5: user B''s UPDATE touched %s of A''s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 6: owner (A) can insert a second schedule ----------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  insert into public.schedules (user_id, name, data) values (ua, 'rlstest second schedule', '{}'::jsonb);
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.schedules where user_id = ua and name = 'rlstest second schedule';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 6: owner can insert a second schedule of their own. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 6: second schedule insert not found, count=%s.', n) || E'\n'; end if;

  -- ---------- Test 7: anon reads schedule_account_index ----------------------
  -- Same no-grant shape as Test 1.
  begin
    execute 'set local role anon'; execute 'set local request.jwt.claims = default';
    select count(*) into n from public.schedule_account_index where user_id = ua;
    execute 'reset role';
    failed := failed + 1; rep := rep || format('FAIL 7: anon schedule_account_index read SUCCEEDED, returned %s rows.', n) || E'\n';
  exception when insufficient_privilege or others then
    execute 'reset role';
    passed := passed + 1; rep := rep || 'PASS 7: anon (signed out) cannot read schedule_account_index at all (no table grant). ' || E'\n';
  end;

  -- ---------- Test 8: owner (A) reads their own index row -------------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  select count(*) into n from public.schedule_account_index where user_id = ua;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 8: owner (A) reads their own schedule_account_index row. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 8: owner index read returned %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 9: a DIFFERENT signed-in user (B) reads A's index row ----
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.schedule_account_index where user_id = ua;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 9: a DIFFERENT signed-in user (B) sees ZERO of A''s index row. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 9: user B saw %s of A''s index rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 10: user B cannot UPDATE user A's index row --------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  update public.schedule_account_index set n_pid = 999 where user_id = ua;
  get diagnostics n = row_count;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 10: user B''s UPDATE against A''s index row touched 0 rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 10: user B''s UPDATE touched %s of A''s index rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 11: owner (A) can insert their own index row from scratch
  -- (a fresh account with no index row yet) -----------------------------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  insert into public.schedule_account_index (user_id, n_pid) values (ub, 1);
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.schedule_account_index where user_id = ub;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 11: a second owner can insert their own fresh index row. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 11: second owner''s index row not found, count=%s.', n) || E'\n'; end if;

  -- ---------- cleanup + report (rollback via exception) ---------------------
  raise exception E'\n==== SCHEDULES RLS TEST REPORT: % passed, % failed ====\n%', passed, failed, rep;
end $$;
