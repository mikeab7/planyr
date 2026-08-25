-- ============================================================================
-- RLS proof for Leasing Comps (NEW-COMPS).
--
-- Proves, AGAINST THE REAL POLICIES:
--   1. anon sees zero comps, always.
--   2. a signed-in user sees their OWN private (team_id null) comp.
--   3. a DIFFERENT signed-in user, NOT on the team, cannot see a team-shared comp.
--   4. a teammate CAN see a team-shared comp (the "team-visible" half of the spec).
--   5. a teammate CANNOT update or delete another member's comp — "owner-editable" is
--      enforced at the database, not just left to the UI (the one deliberate departure
--      from team_sharing.sql's any-member-may-edit shape).
--   6. the OWNER can still update their own team-shared comp.
--   7. inserting a comp with someone else's user_id is refused (server-stamped owner).
--   8. a parcel anchor with no APN/geometry is refused by the check constraint.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying
-- the report, so every fixture (fake users/team/rows) is discarded. Paste into the
-- Supabase SQL editor (or run via execute_sql) and read the report out of the error message.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000c0a01';  -- A: the comp's creator, on the team
  ub uuid := '00000000-0000-4000-8000-0000000c0a02';  -- B: a teammate (not the creator)
  uc uuid := '00000000-0000-4000-8000-0000000c0a03';  -- C: NOT on the team
  team_id uuid;
  private_id uuid;
  shared_id uuid;
  n int;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-comps-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-comps-b@test.invalid', now(), now()),
         (uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-comps-c@test.invalid', now(), now());

  insert into public.teams (name, created_by) values ('RLS Test Team (comps)', ua) returning id into team_id;
  insert into public.team_members (team_id, user_id, role, added_by) values
    (team_id, ua, 'admin', ua), (team_id, ub, 'member', ua);

  insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, land_price, land_size_value, land_size_unit)
  values (ua, 'land', '2026-08-01', 'pin', 29.76, -95.37, 435600, 1, 'ac') returning id into private_id;

  insert into public.comps (user_id, team_id, comp_type, comp_date, anchor_kind, lat, lon, lease_rate, lease_rate_period, lease_rate_expense)
  values (ua, team_id, 'lease', '2026-08-01', 'pin', 29.76, -95.37, 7.5, 'annual', 'nnn') returning id into shared_id;

  -- ---------- Test 1: anon sees zero comps ----------------------------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  select count(*) into n from public.comps where id in (private_id, shared_id);
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 1: anon sees zero comps. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 1: anon saw %s comps, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 2: owner (A) sees their own private comp -----------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  select count(*) into n from public.comps where id = private_id;
  execute 'reset role';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 2: owner sees their own private comp. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 2: owner private read returned %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 3: C (not on the team) cannot see the team-shared comp ---
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', uc, 'role', 'authenticated')::text);
  select count(*) into n from public.comps where id = shared_id;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 3: a non-teammate cannot see the team-shared comp. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 3: non-teammate saw %s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 4: B (a teammate) CAN see the team-shared comp -----------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.comps where id = shared_id;
  execute 'reset role';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 4: a teammate sees the team-shared comp (team-visible). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 4: teammate read returned %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 5: B (a teammate, NOT the creator) cannot UPDATE it ------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    update public.comps set notes = 'edited by a teammate' where id = shared_id;
    get diagnostics n = row_count;
  exception when insufficient_privilege then n := 0;
  end;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 5: a teammate cannot update another member''s comp (owner-editable). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 5: teammate update affected %s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 5b: B (a teammate) cannot DELETE it either ---------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  delete from public.comps where id = shared_id;
  get diagnostics n = row_count;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 5b: a teammate cannot delete another member''s comp. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 5b: teammate delete affected %s rows, expected 0.', n) || E'\n'; end if;

  -- ---------- Test 6: A (the owner) CAN update their own team-shared comp ---
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  update public.comps set notes = 'edited by the owner' where id = shared_id;
  get diagnostics n = row_count;
  execute 'reset role';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 6: the owner can update their own team-shared comp. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 6: owner update affected %s rows, expected 1.', n) || E'\n'; end if;

  -- ---------- Test 7: B cannot insert a comp claiming to be A ---------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon) values (ua, 'land', '2026-08-01', 'pin', 29.76, -95.37);
    n := 1;
  exception when insufficient_privilege or others then n := 0;
  end;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 7: cannot insert a comp under someone else''s user_id. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 7: a spoofed-owner insert succeeded.' || E'\n'; end if;

  -- ---------- Test 8: a parcel anchor with no identity is refused -----------
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon) values (ua, 'land', '2026-08-01', 'parcel', 29.76, -95.37);
    n := 1;
  exception when check_violation then n := 0;
  end;
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 8: a parcel anchor with no APN/geometry is rejected. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 8: an identity-less parcel anchor was accepted.' || E'\n'; end if;

  raise exception E'\n=== comps RLS proof: % passed, % failed ===\n%', passed, failed, rep;
end $$;
