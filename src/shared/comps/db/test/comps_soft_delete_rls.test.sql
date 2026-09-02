-- ============================================================================
-- RLS proof for comps soft delete (comps_soft_delete.sql), mirroring comps_rls.test.sql's
-- self-rolling-back shape.
--
-- Proves, AGAINST THE REAL POLICIES (owner-only UPDATE/DELETE — profiles.sql's plain shape,
-- comps.sql's deliberate departure from team_sharing.sql's any-member-may-edit shape):
--   1. Soft-deleting a comp (deleted_at set) as its OWNER succeeds.
--   2. A soft-deleted comp drops out of the "live" query (deleted_at is null) — fetchAllComps'
--      own filter — and appears in the "trash" query (deleted_at is not null) —
--      fetchDeletedComps' own filter.
--   3. A TEAMMATE (not the owner) cannot restore it — restoreComp's UPDATE affects 0 rows,
--      exactly the "Not restored — you can only restore comps you entered" path the store
--      surfaces to a caller who tries anyway.
--   4. The OWNER can restore it — the comp reappears in the live query.
--   5. A teammate cannot permanently delete it either — permanentlyDeleteComp's DELETE affects
--      0 rows.
--   6. The owner CAN permanently delete it.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying the
-- report, so every fixture (fake users/team/rows) is discarded regardless of outcome. Paste into
-- the Supabase SQL editor (or run via execute_sql) and read the report out of the error message.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000c0b01';  -- A: the comp's creator, on the team
  ub uuid := '00000000-0000-4000-8000-0000000c0b02';  -- B: a teammate (not the creator)
  team_id uuid;
  comp_id uuid;
  n int;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-comps-sd-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-comps-sd-b@test.invalid', now(), now());

  insert into public.teams (name, created_by) values ('RLS Test Team (comps soft delete)', ua) returning id into team_id;
  insert into public.team_members (team_id, user_id, role, added_by) values
    (team_id, ua, 'admin', ua), (team_id, ub, 'member', ua);

  insert into public.comps (user_id, team_id, comp_type, comp_date, anchor_kind, lat, lon, land_price, land_size_value, land_size_unit)
  values (ua, team_id, 'land', '2026-09-02', 'pin', 29.76, -95.37, 435600, 1, 'ac') returning id into comp_id;

  -- ---------- Test 1: owner soft-deletes (deleteComp's own UPDATE) ---------
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  update public.comps set deleted_at = now() where id = comp_id;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 1: owner soft-delete affects 1 row' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 1: owner soft-delete affected ' || n || ' rows, expected 1' || E'\n'; end if;

  -- ---------- Test 2: the live/trash split (fetchAllComps / fetchDeletedComps' own filters) ---
  select count(*) into n from public.comps where id = comp_id and deleted_at is null;
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 2a: soft-deleted comp absent from the live (deleted_at is null) query' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 2a: soft-deleted comp still in the live query' || E'\n'; end if;

  select count(*) into n from public.comps where id = comp_id and deleted_at is not null;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 2b: soft-deleted comp present in the trash (deleted_at is not null) query' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 2b: soft-deleted comp missing from the trash query' || E'\n'; end if;

  -- ---------- Test 3: a TEAMMATE cannot restore it (restoreComp's UPDATE, owner-only policy) ---
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  update public.comps set deleted_at = null where id = comp_id;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 3: teammate restore affects 0 rows (owner-only UPDATE policy holds)' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 3: teammate restore affected ' || n || ' rows — should be 0' || E'\n'; end if;

  -- still soft-deleted (test 3's attempted restore must not have landed)
  select count(*) into n from public.comps where id = comp_id and deleted_at is not null;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 3b: comp still soft-deleted after the refused teammate restore' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 3b: comp state changed despite the refused restore' || E'\n'; end if;

  -- ---------- Test 4: the OWNER can restore it ------------------------------
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  update public.comps set deleted_at = null where id = comp_id;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 4: owner restore affects 1 row' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 4: owner restore affected ' || n || ' rows, expected 1' || E'\n'; end if;

  select count(*) into n from public.comps where id = comp_id and deleted_at is null;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 4b: restored comp back in the live query' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 4b: restored comp not back in the live query' || E'\n'; end if;

  -- ---------- Test 5: a teammate cannot permanently delete it (permanentlyDeleteComp) ---------
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  delete from public.comps where id = comp_id;
  get diagnostics n = row_count;
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 5: teammate permanent delete affects 0 rows (owner-only DELETE policy holds)' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 5: teammate permanent delete affected ' || n || ' rows — should be 0' || E'\n'; end if;

  -- ---------- Test 6: the owner CAN permanently delete it -------------------
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  delete from public.comps where id = comp_id;
  get diagnostics n = row_count;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 6: owner permanent delete affects 1 row' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 6: owner permanent delete affected ' || n || ' rows, expected 1' || E'\n'; end if;

  raise exception E'\n=== comps_soft_delete_rls report: % passed, % failed ===\n%', passed, failed, rep;
end $$;
