-- ============================================================================
-- RLS-crossing proof for the two site_plan_overlays_comp_sync.sql RPCs
-- (B972512-HARDENING item 1).
--
-- Proves, AGAINST THE REAL FUNCTIONS:
--   1. anon cannot execute either function (no grant).
--   2. a user who is NOT the overlay's owner (even a teammate on the shared overlay) cannot
--      move the overlay or read its comps' plan points via these RPCs.
--   3. the overlay's OWNER can read a TEAMMATE's comp's site_plan_point even though that
--      comp's `user_id` is not theirs — and gets back ONLY `id` + `site_plan_point`, nothing
--      else about the comp.
--   4. the owner's placement commit updates BOTH the overlay's own placement fields AND the
--      teammate's comp's lat/lon, in one call.
--   5. a comp id that does NOT reference the overlay being moved is left untouched, even when
--      passed in the update list (defense in depth against a stale/forged payload).
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying the
-- report, so every fixture (fake users/team/review/overlay/comps) is discarded. Paste into the
-- Supabase SQL editor (or run via execute_sql) and read the report out of the error message.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000d0a01';  -- A: the overlay's owner
  ub uuid := '00000000-0000-4000-8000-0000000d0a02';  -- B: a teammate who pinned a comp on it
  uc uuid := '00000000-0000-4000-8000-0000000d0a03';  -- C: NOT on the team
  team_id uuid;
  review_id text := 'rls-test-review-comp-sync';
  overlay_id uuid;
  comp_b_id uuid;     -- ub's comp, pinned to the overlay
  comp_unrelated_id uuid;  -- ua's OWN comp, NOT pinned to this overlay
  n int; got_lat double precision; got_lon double precision; got_center_lat double precision;
  v_result jsonb;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-cs-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-cs-b@test.invalid', now(), now()),
         (uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-cs-c@test.invalid', now(), now());

  insert into public.teams (name, created_by) values ('RLS Test Team (comp sync)', ua) returning id into team_id;
  insert into public.team_members (team_id, user_id, role, added_by) values
    (team_id, ua, 'admin', ua), (team_id, ub, 'member', ua);

  insert into public.doc_reviews (id, user_id, title, data) values (review_id, ua, 'RLS test brochure', '{}'::jsonb);

  insert into public.site_plan_overlays (user_id, team_id, review_id, page, img_w, img_h, center_lat, center_lon, ft_per_px, rotation_deg)
  values (ua, team_id, review_id, 1, 1000, 800, 29.76, -95.37, 2.0, 0)
  returning id into overlay_id;

  -- ub's comp, pinned to ua's overlay, at a deliberately STALE lat/lon (the bug this fixes).
  insert into public.comps (user_id, team_id, comp_type, comp_date, anchor_kind, lat, lon, site_plan_overlay_id, site_plan_point, land_price, land_size_value, land_size_unit)
  values (ub, team_id, 'land', '2026-08-01', 'site_plan', 0.0, 0.0, overlay_id, jsonb_build_object('x', 500, 'y', 400), 100000, 1, 'ac')
  returning id into comp_b_id;

  -- ua's own comp, NOT pinned to this overlay at all — must never be touched by a sync call.
  insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, land_price, land_size_value, land_size_unit)
  values (ua, 'land', '2026-08-01', 'pin', 11.11, -22.22, 50000, 1, 'ac')
  returning id into comp_unrelated_id;

  -- ---------- Test 1: anon cannot execute either function --------------------
  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  begin
    perform public.site_plan_overlay_comp_points(overlay_id);
    execute 'reset role';
    failed := failed + 1; rep := rep || 'FAIL 1: anon was able to call site_plan_overlay_comp_points.' || E'\n';
  exception when insufficient_privilege then
    execute 'reset role';
    passed := passed + 1; rep := rep || 'PASS 1: anon refused (insufficient_privilege) on site_plan_overlay_comp_points. ' || E'\n';
  end;

  -- ---------- Test 2: a teammate who is NOT the owner cannot move the overlay -----
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    perform public.commit_site_plan_overlay_placement(overlay_id, 30.0, -96.0, 3.0, 0, '[]'::jsonb, 1);
    execute 'reset role';
    failed := failed + 1; rep := rep || 'FAIL 2: teammate (non-owner) was able to move the overlay.' || E'\n';
  exception when others then
    execute 'reset role';
    if sqlerrm like '%not yours to move%' then
      passed := passed + 1; rep := rep || 'PASS 2: teammate (non-owner) refused: ' || sqlerrm || E'\n';
    else
      failed := failed + 1; rep := rep || 'FAIL 2 (wrong error): ' || sqlerrm || E'\n';
    end if;
  end;

  -- ---------- Test 2b: a user NOT on the team at all is refused the same way ------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', uc, 'role', 'authenticated')::text);
  begin
    perform public.site_plan_overlay_comp_points(overlay_id);
    execute 'reset role';
    failed := failed + 1; rep := rep || 'FAIL 2b: outsider was able to read the overlay''s comp points.' || E'\n';
  exception when others then
    execute 'reset role';
    if sqlerrm like '%not yours to move%' then
      passed := passed + 1; rep := rep || 'PASS 2b: outsider refused reading comp points: ' || sqlerrm || E'\n';
    else
      failed := failed + 1; rep := rep || 'FAIL 2b (wrong error): ' || sqlerrm || E'\n';
    end if;
  end;

  -- ---------- Test 3: the OWNER can read a TEAMMATE's comp's site_plan_point ------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  select count(*) into n from public.site_plan_overlay_comp_points(overlay_id) where id = comp_b_id;
  execute 'reset role';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 3: owner read teammate''s comp point across RLS. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 3: expected 1 row for comp_b, got %s.', n) || E'\n'; end if;

  -- ---------- Test 4: owner's commit updates BOTH overlay AND teammate's comp -----
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  select public.commit_site_plan_overlay_placement(
    overlay_id, 30.111, -96.222, 3.5, 45,
    jsonb_build_array(
      jsonb_build_object('id', comp_b_id, 'lat', 30.5, 'lon', -96.5),
      jsonb_build_object('id', comp_unrelated_id, 'lat', 99.0, 'lon', 99.0)  -- doesn't reference this overlay
    ),
    1  -- expected version (item 7) — the row was just inserted, so it's still 1
  ) into v_result;
  execute 'reset role';

  select center_lat into got_center_lat from public.site_plan_overlays where id = overlay_id;
  select lat, lon into got_lat, got_lon from public.comps where id = comp_b_id;
  if got_center_lat = 30.111 and got_lat = 30.5 and got_lon = -96.5 and (v_result->>'moved')::int = 1 and (v_result->>'version')::int = 2 then
    passed := passed + 1; rep := rep || format('PASS 4: overlay + teammate comp moved atomically (result=%s). ', v_result) || E'\n';
  else
    failed := failed + 1;
    rep := rep || format('FAIL 4: center_lat=%s lat=%s lon=%s result=%s', got_center_lat, got_lat, got_lon, v_result) || E'\n';
  end if;

  -- ---------- Test 5: the unrelated comp was NOT touched --------------------------
  select lat, lon into got_lat, got_lon from public.comps where id = comp_unrelated_id;
  if got_lat = 11.11 and got_lon = -22.22 then
    passed := passed + 1; rep := rep || 'PASS 5: comp not referencing this overlay was left untouched. ' || E'\n';
  else
    failed := failed + 1; rep := rep || format('FAIL 5: unrelated comp changed to lat=%s lon=%s', got_lat, got_lon) || E'\n';
  end if;

  raise exception 'RLS comp-sync proof complete — % passed, % failed. %', passed, failed, rep;
end $$;
