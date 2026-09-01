-- ============================================================================
-- RLS proof for the team-read storage policy on a site-plan overlay's raster
-- (B972512-HARDENING item 4).
--
-- Proves, AGAINST THE REAL FUNCTIONS:
--   1. a teammate CAN read the raster (can_read_shared_site_plan_raster), via
--      site_plan_overlays' OWN team_id — the same predicate its row-level SELECT policy uses.
--   2. a user NOT on the team cannot.
--   3. the OLD function (`can_read_shared_review_file`, gated on `doc_reviews.team_id` and the
--      review's own `sources` list) does NOT cover an overlay raster key — proving the gap this
--      migration closes was real, not hypothetical.
--   4. anon cannot execute the new function at all.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying the
-- report, so every fixture is discarded. Paste into the Supabase SQL editor (or run via
-- execute_sql) and read the report out of the error message.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000e0a01';
  ub uuid := '00000000-0000-4000-8000-0000000e0a02';
  uc uuid := '00000000-0000-4000-8000-0000000e0a03';
  team_id uuid;
  review_id text := 'rls-test-review-raster';
  overlay_id uuid;
  raster_key text;
  ok boolean;
  rep text := ''; passed int := 0; failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-raster-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-raster-b@test.invalid', now(), now()),
         (uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-raster-c@test.invalid', now(), now());
  insert into public.teams (name, created_by) values ('RLS Test Team (raster)', ua) returning id into team_id;
  insert into public.team_members (team_id, user_id, role, added_by) values (team_id, ua, 'admin', ua), (team_id, ub, 'member', ua);
  insert into public.doc_reviews (id, user_id, title, data) values (review_id, ua, 'RLS raster test', '{}'::jsonb);

  raster_key := ua::text || '/site-plan-overlays/fake-raster.jpg';
  insert into public.site_plan_overlays (user_id, team_id, review_id, page, img_w, img_h, raster_key)
  values (ua, team_id, review_id, 1, 100, 100, raster_key)
  returning id into overlay_id;

  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select public.can_read_shared_site_plan_raster(raster_key) into ok;
  execute 'reset role';
  if ok then passed := passed + 1; rep := rep || 'PASS 1: teammate can read the raster. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 1: teammate refused. ' || E'\n'; end if;

  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', uc, 'role', 'authenticated')::text);
  select public.can_read_shared_site_plan_raster(raster_key) into ok;
  execute 'reset role';
  if not ok then passed := passed + 1; rep := rep || 'PASS 2: outsider refused. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 2: outsider allowed. ' || E'\n'; end if;

  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select public.can_read_shared_review_file(raster_key) into ok;
  execute 'reset role';
  if not ok then passed := passed + 1; rep := rep || 'PASS 3: old can_read_shared_review_file correctly does NOT cover the raster key (confirms the original gap). ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 3: old function unexpectedly matched.' || E'\n'; end if;

  execute 'set local role anon'; execute 'set local request.jwt.claims = default';
  begin
    perform public.can_read_shared_site_plan_raster(raster_key);
    execute 'reset role';
    failed := failed + 1; rep := rep || 'FAIL 4: anon executed the function.' || E'\n';
  exception when insufficient_privilege then
    execute 'reset role';
    passed := passed + 1; rep := rep || 'PASS 4: anon refused execute. ' || E'\n';
  end;

  raise exception 'RLS raster-read proof complete — % passed, % failed. %', passed, failed, rep;
end $$;
