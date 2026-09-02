-- ============================================================================
-- Live proof of the delete-overlay-while-a-comp-is-pinned-to-it hazard the owner asked about
-- (B850432 acceptance criteria): `site_plan_overlays_id` is `on delete set null`, while the
-- 'site_plan' branch of `comps_parcel_anchor_has_identity` (comps_site_plan_anchor.sql) requires
-- a non-null `site_plan_overlay_id` — a naive read of those two facts side by side looks like a
-- delete could either corrupt a comp (silently drop its anchor) or abort mid-transaction.
--
-- Proves, AGAINST THE REAL CONSTRAINTS:
--   1. `DELETE FROM site_plan_overlays` while a comp is still pinned to it FAILS outright
--      (the FK's cascading `SET NULL` on the comp trips the CHECK immediately) — it does NOT
--      silently null out the comp's anchor, and it does not partially apply.
--   2. The failed delete is a no-op: the overlay row still exists afterward, and the pinned
--      comp's `site_plan_overlay_id`/`site_plan_point` are byte-identical to before the attempt.
--   3. Once the pinned comp is removed first (the path the app's own `blockedByPinnedComps`
--      proactive check steers the user toward), the SAME delete succeeds cleanly.
--
-- This is DB-level confirmation of the app-level guard already shipped
-- (SitePlansSection.jsx's `blockedByPinnedComps`, called before every delete attempt) and its
-- race-window fallback (overlayErrors.js's `comps_parcel_anchor_has_identity` translation) — see
-- both files' own headers (B972512-HARDENING item 5). Nothing here changes behavior; it measures
-- the constraint the report flagged as "filed and unfixed" and records what actually happens.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying the
-- report, so every fixture (fake user/review/overlay/comp) is discarded. Paste into the
-- Supabase SQL editor (or run via execute_sql).
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000d0b01';  -- the overlay's owner
  review_id text := 'rls-test-review-delete-pinned';
  overlay_id uuid;
  comp_id uuid;
  n int;
  saved_overlay_id uuid; saved_point jsonb;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-del-pinned-a@test.invalid', now(), now());

  insert into public.doc_reviews (id, user_id, title, data) values (review_id, ua, 'RLS test brochure (delete-pinned)', '{}'::jsonb);

  insert into public.site_plan_overlays (user_id, review_id, page, img_w, img_h, center_lat, center_lon, ft_per_px, rotation_deg)
  values (ua, review_id, 1, 800, 600, 29.76, -95.37, 2.0, 0)
  returning id into overlay_id;

  insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, site_plan_overlay_id, site_plan_point, land_price, land_size_value, land_size_unit)
  values (ua, 'land', '2026-08-01', 'site_plan', 29.76, -95.37, overlay_id, jsonb_build_object('x', 400, 'y', 300), 100000, 1, 'ac')
  returning id into comp_id;

  -- ---------- Test 1: deleting the overlay while the comp is pinned FAILS ---------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  begin
    delete from public.site_plan_overlays where id = overlay_id;
    execute 'reset role';
    failed := failed + 1; rep := rep || 'FAIL 1: delete SUCCEEDED with a comp still pinned — this should never happen.' || E'\n';
  exception when others then
    execute 'reset role';
    if sqlerrm like '%comps_parcel_anchor_has_identity%' then
      passed := passed + 1; rep := rep || 'PASS 1: delete refused by comps_parcel_anchor_has_identity: ' || sqlerrm || E'\n';
    else
      failed := failed + 1; rep := rep || 'FAIL 1 (wrong error): ' || sqlerrm || E'\n';
    end if;
  end;

  -- ---------- Test 2: the failed delete left BOTH rows exactly as they were -------
  select count(*) into n from public.site_plan_overlays where id = overlay_id;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 2a: overlay row still exists after the failed delete. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 2a: expected the overlay row to survive, found %s.', n) || E'\n'; end if;

  select site_plan_overlay_id, site_plan_point into saved_overlay_id, saved_point from public.comps where id = comp_id;
  if saved_overlay_id = overlay_id and saved_point = jsonb_build_object('x', 400, 'y', 300) then
    passed := passed + 1; rep := rep || 'PASS 2b: pinned comp''s anchor is untouched — not silently nulled. ' || E'\n';
  else
    failed := failed + 1; rep := rep || format('FAIL 2b: comp anchor changed — overlay_id=%s point=%s', saved_overlay_id, saved_point) || E'\n';
  end if;

  -- ---------- Test 3: delete the comp first, THEN the overlay deletes cleanly -----
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  delete from public.comps where id = comp_id;
  delete from public.site_plan_overlays where id = overlay_id;
  execute 'reset role';
  select count(*) into n from public.site_plan_overlays where id = overlay_id;
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 3: once unpinned, the overlay deletes cleanly. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 3: overlay still present after its own comp was removed first.' || E'\n'; end if;

  raise exception 'delete-overlay-with-pinned-comp proof complete — % passed, % failed. %', passed, failed, rep;
end $$;
