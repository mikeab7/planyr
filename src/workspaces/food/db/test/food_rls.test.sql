-- ============================================================================
-- RLS proof for the food place tracker (B568400 / V306784).
--
-- Proves, AGAINST THE REAL POLICIES:
--   1. food_places (reference data) is readable by anon AND authenticated, and
--      writable by neither — only service_role (which bypasses RLS) can write it.
--   2. food_visits (the owner's private log) is invisible to anon entirely, and
--      invisible to any OTHER authenticated user — never covered by a project-
--      sharing path, because it has none.
--   3. food_wishlist ("want to try" flags, B669312) has the identical owner-only
--      shape as food_visits: invisible to anon, invisible to any other user, and
--      the (user, place) uniqueness is enforced at the database.
--   4. food_dish_wishlist (dish-level "want to try" on a visited place, NEW-3
--      2026-08-23) has the identical owner-only shape, PLUS an update policy
--      (striking a dish done is an in-place update, not delete+reinsert), and
--      the (user, place, dish) uniqueness is enforced at the database.
--   5. food_lists + food_list_items (named restaurant lists, NEW-1 / B2088288) have the
--      identical owner-only shape: invisible to anon, invisible to another signed-in user,
--      not renameable/deletable/extendable by another user (the composite (list_id, user_id)
--      foreign key refuses an item on someone else's list), list names unique per user
--      case-insensitively, and deleting a list removes ITS items only — never a visit, a
--      wishlist flag or the place.
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
  -- Named test_place_id rather than place_id: food_wishlist (added B669312) has a REAL COLUMN
  -- named place_id, and a PL/pgSQL variable sharing a column's name makes any query against
  -- that table ambiguous the moment both are referenced together.
  test_place_id text := 'rlstest:food:place1';
  visit_id uuid;
  dish_id uuid;
  dish_place text;
  list_a uuid;
  item_a uuid;
  visit2_id uuid;
  n int;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-food-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-food-b@test.invalid', now(), now());

  -- metro is not-null (added by a later migration, backfilled 'Houston' for pre-existing rows —
  -- see db/food.sql's metro section); this fixture predates that column, so it's supplied here
  -- explicitly rather than left to a default that no longer exists.
  insert into public.food_places (id, name, lat, lon, category, metro)
  values (test_place_id, 'RLS Test Diner', 29.76, -95.37, 'restaurant', 'Houston');

  insert into public.food_visits (user_id, place_id, rating, cost, notes)
  values (ua, test_place_id, 5, 12.50, 'test visit') returning id into visit_id;

  -- ---------- Test 1: anon reads food_places (expect 1 row) ----------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_places where id = test_place_id;
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

  -- ---------- Test 8: owner (A) can flag a place as want-to-try -------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  insert into public.food_wishlist (user_id, place_id) values (ua, test_place_id);
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_wishlist where user_id = ua and place_id = test_place_id;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 8: owner can flag a snapshot place as want-to-try. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 8: wishlist flag not found, count=%s.', n) || E'\n'; end if;

  -- ---------- Test 9: anon reads food_wishlist (expect 0 rows) -------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_wishlist where place_id = test_place_id;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 9: anon (signed out) sees ZERO food_wishlist rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 9: anon food_wishlist read returned %s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 10: a DIFFERENT signed-in user (B) reads A's food_wishlist
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.food_wishlist where user_id = ua;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 10: a DIFFERENT signed-in user (B) sees ZERO of A''s food_wishlist rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 10: user B saw %s of user A''s food_wishlist rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 11: a second flag on the SAME (user, place) is refused ---
  -- (the unique index, not just the UI, is what prevents a duplicate)
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
    insert into public.food_wishlist (user_id, place_id) values (ua, test_place_id);
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    failed := failed + 1; rep := rep || 'FAIL 11: a duplicate (user, place) wishlist row was accepted (should violate the unique index). ' || E'\n';
  exception when unique_violation then
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    passed := passed + 1; rep := rep || 'PASS 11: a duplicate (user, place) wishlist flag is refused by the unique index. ' || E'\n';
  end;

  -- ---------- Test 12: owner (A) can add a wanted dish at a place he's visited
  -- (NEW-3, 2026-08-23 — food_dish_wishlist, same owner-only shape proved above)
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  insert into public.food_dish_wishlist (user_id, place_id, dish_name) values (ua, test_place_id, 'Pad Thai');
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_dish_wishlist where user_id = ua and place_id = test_place_id and dish_name = 'Pad Thai';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 12: owner can add a wanted dish at a visited place. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 12: dish wishlist row not found, count=%s.', n) || E'\n'; end if;

  -- ---------- Test 13: anon reads food_dish_wishlist (expect 0 rows) --------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_dish_wishlist where place_id = test_place_id;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 13: anon (signed out) sees ZERO food_dish_wishlist rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 13: anon food_dish_wishlist read returned %s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 14: a DIFFERENT signed-in user (B) reads A's dish wishlist
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.food_dish_wishlist where user_id = ua;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 14: a DIFFERENT signed-in user (B) sees ZERO of A''s dish-wishlist rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 14: user B saw %s of A''s dish-wishlist rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 15: owner (A) can mark a dish done IN PLACE (an UPDATE,
  -- not a delete+reinsert — history/created_at survives) ---------------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  update public.food_dish_wishlist set done = true where user_id = ua and place_id = test_place_id and dish_name = 'Pad Thai';
  get diagnostics n = row_count;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 15: owner can strike a dish done via UPDATE (not delete+reinsert). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 15: marking a dish done touched %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 16: a second identical dish on the SAME place is refused
  -- (the unique index, not just the UI, is what prevents a duplicate; case/whitespace-insensitive)
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
    insert into public.food_dish_wishlist (user_id, place_id, dish_name) values (ua, test_place_id, '  pad thai  ');
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    failed := failed + 1; rep := rep || 'FAIL 16: a duplicate (user, place, dish) row was accepted (should violate the unique index). ' || E'\n';
  exception when unique_violation then
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    passed := passed + 1; rep := rep || 'PASS 16: a duplicate dish (case/whitespace-insensitive) is refused by the unique index. ' || E'\n';
  end;

  -- ---------- Test 17: owner (A) can add a dish under their own visit, and
  -- place_id is AUTO-SYNCED from the visit by food_dishes_before_write() —
  -- never trusted from the client (B1873008, 2026-09-27) --------------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  insert into public.food_dishes (user_id, visit_id, name, score) values (ua, visit_id, 'Queso', 8.5) returning id into dish_id;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select place_id into dish_place from public.food_dishes where id = dish_id;
  if dish_place = test_place_id then passed := passed + 1; rep := rep || 'PASS 17: owner adds a dish; place_id auto-synced from the visit (never client-supplied). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 17: dish place_id = %s, expected %s.', dish_place, test_place_id) || E'\n'; end if;

  -- ---------- Test 18: a QUARTER-point score (8.3) is refused; HALF-point
  -- (already inserted above, 8.5) is the scale this table actually uses ------
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
    insert into public.food_dishes (user_id, visit_id, name, score) values (ua, visit_id, 'Bad Score Dish', 8.3);
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    failed := failed + 1; rep := rep || 'FAIL 18: a quarter-point dish score (8.3) was accepted (should violate the half-point check). ' || E'\n';
  exception when check_violation then
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    passed := passed + 1; rep := rep || 'PASS 18: a quarter-point dish score (8.3) is refused by the half-point CHECK constraint. ' || E'\n';
  end;

  -- ---------- Test 19: anon reads food_dishes (expect 0 rows) --------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_dishes where id = dish_id;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 19: anon (signed out) sees ZERO food_dishes rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 19: anon food_dishes read returned %s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 20: a DIFFERENT signed-in user (B) reads A's food_dishes -
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.food_dishes where id = dish_id;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 20: a DIFFERENT signed-in user (B) sees ZERO of A''s food_dishes rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 20: user B saw %s of A''s food_dishes rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 21: user B cannot mint a dish against A's visit_id, even
  -- naming themself as user_id — B's own RLS can't see A's visit at all, so
  -- food_dishes_before_write() finds no row and raises LOUDLY (never a silent
  -- null/wrong place_id) ------------------------------------------------------
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
    insert into public.food_dishes (user_id, visit_id, name, score) values (ub, visit_id, 'Hijacked Dish', 6);
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    failed := failed + 1; rep := rep || 'FAIL 21: user B inserted a dish against A''s visit_id (should be refused). ' || E'\n';
  exception when others then
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    passed := passed + 1; rep := rep || 'PASS 21: user B cannot attach a dish to A''s visit_id — the ownership trigger refuses it. ' || E'\n';
  end;

  -- ---------- Test 22: owner (A) can mark a dish DONE — an in-place UPDATE,
  -- proving the update policy + the updated_at touch trigger both fire -------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  update public.food_dishes set score = 9.0, order_again = 'yes' where id = dish_id;
  get diagnostics n = row_count;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 22: owner can edit their own dish (score/order_again) via UPDATE. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 22: dish edit touched %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 23: deleting the visit CASCADES to its dishes ------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  delete from public.food_visits where id = visit_id;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_dishes where id = dish_id;
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 23: deleting a visit cascades to its dishes (on delete cascade). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 23: %s dish row(s) survived deleting their visit, expected 0.', n) || E'\n'; end if;


  -- ================= restaurant lists (NEW-1 / B2088288) =======================
  -- fixtures as postgres: A's list "Lunch @ Work" holding the test place, plus a visit and a
  -- want-to-try flag at the same place (to prove deleting a LIST touches neither)
  insert into public.food_lists (user_id, name, color, position) values (ua, 'Lunch @ Work', '#0E8A8A', 0) returning id into list_a;
  insert into public.food_list_items (user_id, list_id, place_id) values (ua, list_a, test_place_id) returning id into item_a;
  insert into public.food_visits (user_id, place_id, rating, notes) values (ua, test_place_id, 7, 'list test visit') returning id into visit2_id;
  insert into public.food_wishlist (user_id, place_id) values (ua, test_place_id);

  -- ---------- Test 24: anon reads food_lists + food_list_items (expect 0 rows) -
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_lists where id = list_a;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 24: anon (signed out) sees ZERO food_lists rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 24: anon food_lists read returned %s rows, expected 0.', n) || E'\n'; end if;
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_list_items where id = item_a;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 25: anon (signed out) sees ZERO food_list_items rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 25: anon food_list_items read returned %s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 26: a DIFFERENT signed-in user (B) reads A's lists and items -
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.food_lists where id = list_a;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 26: a DIFFERENT signed-in user (B) sees ZERO of A''s food_lists rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 26: user B saw %s of A''s food_lists rows, expected 0.', n) || E'\n'; end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.food_list_items where id = item_a;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 27: user B sees ZERO of A''s food_list_items rows. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 27: user B saw %s of A''s food_list_items rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 28: B cannot ADD an item to A's list, naming themself as the owner ----
  -- (RLS alone passes user_id = B; the composite FK (list_id, user_id) is what refuses it)
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
    insert into public.food_list_items (user_id, list_id, place_id) values (ub, list_a, test_place_id);
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    failed := failed + 1; rep := rep || 'FAIL 28: user B added an item to A''s list (should be refused). ' || E'\n';
  exception when foreign_key_violation then
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    passed := passed + 1; rep := rep || 'PASS 28: user B cannot add an item to A''s list (composite list/owner foreign key refuses it). ' || E'\n';
  end;

  -- ---------- Test 29: B cannot insert a row claiming A as the owner (RLS with check) ----
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
    insert into public.food_list_items (user_id, list_id, place_id) values (ua, list_a, test_place_id);
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    failed := failed + 1; rep := rep || 'FAIL 29: user B inserted a list item as user A (should be refused). ' || E'\n';
  exception when others then
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    passed := passed + 1; rep := rep || 'PASS 29: user B cannot insert a list item claiming A as owner. ' || E'\n';
  end;

  -- ---------- Test 30: B cannot rename or delete A's list (0 rows touched) ---------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  update public.food_lists set name = 'Hijacked' where id = list_a;
  get diagnostics n = row_count;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 30: user B cannot rename A''s list (0 rows updated). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 30: user B renamed %s of A''s lists, expected 0.', n) || E'\n'; end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  delete from public.food_lists where id = list_a;
  get diagnostics n = row_count;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 31: user B cannot delete A''s list (0 rows deleted). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 31: user B deleted %s of A''s lists, expected 0.', n) || E'\n'; end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  delete from public.food_list_items where id = item_a;
  get diagnostics n = row_count;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 32: user B cannot remove an item from A''s list (0 rows deleted). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 32: user B deleted %s of A''s list items, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 33: the owner reads, renames and recolours their own list ---------------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  update public.food_lists set name = 'Lunch at Work', color = '#7A4FD6' where id = list_a;
  get diagnostics n = row_count;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 33: owner can rename + recolour their own list. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 33: owner rename touched %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 34: list names are unique per user, case-insensitively -----------------
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
    insert into public.food_lists (user_id, name, color) values (ua, '  LUNCH AT WORK ', '#0E8A8A');
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    failed := failed + 1; rep := rep || 'FAIL 34: a second list named "LUNCH AT WORK" was accepted (should be refused). ' || E'\n';
  exception when unique_violation then
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    passed := passed + 1; rep := rep || 'PASS 34: a second list with the same name (any case/padding) is refused. ' || E'\n';
  end;
  -- ...but ANOTHER user may use the same name
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
    insert into public.food_lists (user_id, name, color) values (ub, 'Lunch at Work', '#0E8A8A');
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    passed := passed + 1; rep := rep || 'PASS 35: another user may use the same list name (uniqueness is per user). ' || E'\n';
  exception when others then
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    failed := failed + 1; rep := rep || 'FAIL 35: user B could not use a name A already has. ' || E'\n';
  end;

  -- ---------- Test 36: the same place cannot be on the same list twice --------------------
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
    insert into public.food_list_items (user_id, list_id, place_id) values (ua, list_a, test_place_id);
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    failed := failed + 1; rep := rep || 'FAIL 36: the same place was added to the same list twice. ' || E'\n';
  exception when unique_violation then
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    passed := passed + 1; rep := rep || 'PASS 36: one row per (user, list, place) — a duplicate add is refused by the unique index. ' || E'\n';
  end;

  -- ---------- Test 37: a manual-pin item keeps the 4dp identity (a few feet apart = same pin) ----
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
    insert into public.food_list_items (user_id, list_id, custom_name, custom_lat, custom_lon) values (ua, list_a, 'Taco Truck', 29.76041, -95.36991);
    insert into public.food_list_items (user_id, list_id, custom_name, custom_lat, custom_lon) values (ua, list_a, 'Taco Truck', 29.76043, -95.36989);
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    failed := failed + 1; rep := rep || 'FAIL 37: the same manual pin (a few feet apart) was added twice. ' || E'\n';
  exception when unique_violation then
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    passed := passed + 1; rep := rep || 'PASS 37: a manual pin is one membership at 4dp rounding (second press refused). ' || E'\n';
  end;

  -- ---------- Test 38: an item must be a place OR a complete manual pin ---------------------
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
    insert into public.food_list_items (user_id, list_id, custom_name) values (ua, list_a, 'No Location Cafe');
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    failed := failed + 1; rep := rep || 'FAIL 38: a list item with a typed name but no location was accepted. ' || E'\n';
  exception when check_violation then
    execute 'reset role'; execute 'set local request.jwt.claims = default';
    passed := passed + 1; rep := rep || 'PASS 38: a restaurant cannot be minted from a typed name alone (needs a place or coordinates). ' || E'\n';
  end;

  -- ---------- Test 39: deleting a LIST removes ITS items only — never the visit, the wishlist flag or the place
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  delete from public.food_lists where id = list_a;
  execute 'reset role'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.food_list_items where list_id = list_a;
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 39a: deleting a list removes its item rows (cascade on list_id). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 39a: %s item row(s) survived deleting their list.', n) || E'\n'; end if;
  select count(*) into n from public.food_visits where id = visit2_id;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 39b: the visit at the listed place survived deleting the list. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 39b: deleting a list removed a visit.' || E'\n'; end if;
  select count(*) into n from public.food_wishlist where user_id = ua and place_id = test_place_id;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 39c: the want-to-try flag survived deleting the list. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 39c: deleting a list removed a wishlist flag.' || E'\n'; end if;
  select count(*) into n from public.food_places where id = test_place_id;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 39d: the place itself survived deleting the list. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 39d: deleting a list removed a place.' || E'\n'; end if;

  -- ---------- cleanup + report (rollback via exception) ---------------------
  raise exception E'\n==== FOOD RLS TEST REPORT: % passed, % failed ====\n%', passed, failed, rep;
end $$;
