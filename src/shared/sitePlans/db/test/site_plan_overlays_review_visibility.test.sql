-- ============================================================================
-- RLS proof for derived doc_reviews visibility via a shared site-plan overlay
-- (B972512-HARDENING new finding 3, corrected direction).
--
-- Proves, AGAINST THE REAL FUNCTIONS/POLICIES:
--   1. an overlay keeps the user's CHOSEN team_id at insert — NOT silently forced to match
--      doc_reviews.team_id (the regression an earlier, wrong-direction trigger caused, caught
--      live before shipping).
--   2. a teammate on the OVERLAY's team can open the source brochure (doc_reviews row) even
--      though doc_reviews.team_id itself is null — the two no longer need to independently agree.
--   3. a user NOT on the team still cannot.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying the
-- report, so every fixture is discarded. Paste into the Supabase SQL editor (or run via
-- execute_sql) and read the report out of the error message.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000001a0a01';
  ub uuid := '00000000-0000-4000-8000-0000001a0a02';
  uc uuid := '00000000-0000-4000-8000-0000001a0a03';
  team_a uuid;
  review_id text := 'rls-test-review-findings3-corrected';
  overlay_id uuid;
  got_team uuid;
  n int;
  rep text := ''; passed int := 0; failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-f3c-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-f3c-b@test.invalid', now(), now()),
         (uc, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-f3c-c@test.invalid', now(), now());
  insert into public.teams (name, created_by) values ('RLS Test Team (findings3 corrected)', ua) returning id into team_a;
  insert into public.team_members (team_id, user_id, role, added_by) values (team_a, ua, 'admin', ua), (team_a, ub, 'member', ua);

  insert into public.doc_reviews (id, user_id, title, data) values (review_id, ua, 'findings3 corrected test', '{}'::jsonb);

  insert into public.site_plan_overlays (user_id, team_id, review_id, page, img_w, img_h)
  values (ua, team_a, review_id, 1, 100, 100)
  returning id, team_id into overlay_id, got_team;

  if got_team = team_a then passed := passed + 1; rep := rep || 'PASS 1: overlay keeps the user''s CHOSEN team_id (not silently overwritten). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 1: overlay team_id = %s, expected %s', got_team, team_a) || E'\n'; end if;

  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  select count(*) into n from public.doc_reviews where id = review_id;
  execute 'reset role';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 2: teammate can open the source brochure via the overlay''s own team, even though doc_reviews.team_id is null. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 2: teammate could NOT read the doc_reviews row.' || E'\n'; end if;

  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', uc, 'role', 'authenticated')::text);
  select count(*) into n from public.doc_reviews where id = review_id;
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 3: outsider still refused. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 3: outsider could read the doc_reviews row.' || E'\n'; end if;

  raise exception 'findings3-corrected proof complete — % passed, % failed. %', passed, failed, rep;
end $$;
