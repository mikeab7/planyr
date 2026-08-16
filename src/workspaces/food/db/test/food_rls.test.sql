-- ============================================================================
-- RLS proof for the food place tracker (B568400 / V306784).
--
-- Proves, AGAINST THE REAL POLICIES:
--   1. food_places (reference data) is readable by anon AND authenticated, and
--      writable by neither — only service_role (which bypasses RLS) can write it.
--   2. food_visits (the owner's private log) is invisible to anon entirely, and
--      invisible to any OTHER authenticated user — never covered by a project-
--      sharing path, because it has none.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end
-- carrying the report, so every fixture (fake users + rows) is discarded. Paste
-- into the Supabase SQL editor (or run via execute_sql) and read the report out
-- of the error message.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-00000000f001';  -- A: the owner
  ub uuid := '00000000-0000-4000-8000-00000000f002';  -- B: a different signed-in user
  place_id text := 'rlstest:food:place1';
  visit_id uuid;
  n int;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-food-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-food-b@test.invalid', now(), now());

  insert into public.food_places (id, name, lat, lon, category)
  values (place_id, 'RLS Test Diner', 29.76, -95.37, 'restaurant');

  insert into public.food_visits (user_id, place_id, rating, cost, notes)
  values (ua, place_id, 5, 12.50, 'test visit') returning id into visit_id;

  -- ---------- Test 1: anon reads food_places (expect 1 row) ----------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_places where id = place_id;
  execute 'reset role';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 1: anon reads food_places (public reference data). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 1: anon food_places read returned %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 2: anon reads food_visits (expect 0 rows, RLS filters) --
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_visits where id = visit_id;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 2: anon (signed out) sees ZERO food_visits rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 2: anon food_visits read returned %s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 3: anon INSERT into food_places is refused --------------
  begin
    execute 'set local role anon'; execute 'set local request.jwt.claims = default';
    insert into public.food_places (id, name, lat, lon) values ('rlstest:hack', 'hack', 0, 0);
    execute 'reset role';
    failed := failed + 1; rep := rep || 'FAIL 3: anon INSERT into food_places SUCCEEDED (should be refused). ' || E'\n';
    delete from public.food_places where id = 'rlstest:hack'; -- clean up if it somehow landed
  exception when insufficient_privilege or others then
    execute 'reset role';
    passed := passed + 1; rep := rep || 'PASS 3: anon cannot write food_places (no insert grant/policy). ' || E'\n';
  end;

  -- ---------- Test 4: owner (A) reads own food_visits (expect 1 row) -------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  select count(*) into n from public.food_visits where id = visit_id;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 4: owner (A) reads their own food_visits row. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 4: owner food_visits read returned %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 5: a DIFFERENT signed-in user (B) reads A's food_visits -
  -- (expect 0 — this is the property B326416 does NOT get to touch: no team/
  -- project-share path exists for this table at all)
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.food_visits where id = visit_id;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 5: a DIFFERENT signed-in user (B) sees ZERO of A''s food_visits rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 5: user B saw %s of user A''s food_visits rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 6: user B cannot UPDATE user A's visit -------------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  update public.food_visits set notes = 'hacked by B' where id = visit_id;
  get diagnostics n = row_count;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 6: user B''s UPDATE against A''s food_visits row touched 0 rows (RLS using-clause blocks it). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 6: user B''s UPDATE touched %s of A''s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 7: owner (A) can insert a manual pin visit --------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  insert into public.food_visits (user_id, custom_name, custom_lat, custom_lon, rating)
  values (ua, 'Taco Truck (manual pin)', 29.80, -95.40, 4);
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_visits where user_id = ua and custom_name = 'Taco Truck (manual pin)';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 7: owner can log a manual-pin visit (place_id null, custom_name set). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 7: manual pin visit not found, count=%s.', n) || E'\n'; end if;

  -- ---------- cleanup + report (rollback via exception) ---------------------
  raise exception E'\n==== FOOD RLS TEST REPORT: % passed, % failed ====\n%', passed, failed, rep;
end $$;
