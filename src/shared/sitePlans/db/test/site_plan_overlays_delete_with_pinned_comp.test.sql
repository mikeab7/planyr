-- ============================================================================
-- Live proof of the delete-overlay-while-a-comp-is-pinned-to-it fix (B1114992).
--
-- ⛔ SUPERSEDES the version of this file that proved the OLD (broken) behavior — that version
-- asserted the delete was REFUSED, which was correct for the code at the time
-- (B972512-HARDENING item 5's app-level `blockedByPinnedComps` block) but is no longer the
-- decision this repo made. B1114992 picked candidate (a) from the three the adversarial review
-- posed: a comp SURVIVES the deletion of the site plan it's pinned to, reverting to a plain
-- 'pin' anchor at its already-current lat/lon, rather than the delete being refused. See
-- comps_site_plan_overlay_delete_reverts_to_pin.sql for the full reasoning and mechanism (a
-- SECURITY DEFINER `BEFORE DELETE` trigger for the real-DELETE path, and a matching
-- `soft_delete_site_plan_overlay` RPC for the app's ordinary soft-delete path).
--
-- Proves, AGAINST THE REAL CONSTRAINTS AND FUNCTIONS on production:
--   1. `DELETE FROM site_plan_overlays` while a comp is pinned to it now SUCCEEDS (no CHECK
--      abort) — the row is actually gone afterward.
--   2. The comp that was pinned to it SURVIVES, with `anchor_kind` flipped to 'pin',
--      `site_plan_overlay_id`/`site_plan_point` both null, and `lat`/`lon` UNCHANGED from
--      their pre-delete value (the fallback location, not a fresh/derived one).
--   3. TWO comps pinned to the same overlay both get detached by the same delete (not just the
--      first match).
--   4. A THIRD comp anchored as a plain 'pin' (never pinned to any overlay) is completely
--      untouched by the delete — the detach is scoped to `site_plan_overlay_id = <the deleted
--      overlay>`, never a blanket rewrite.
--   5. `soft_delete_site_plan_overlay` (the app's ordinary "Delete site plan…" RPC) does the
--      identical detach for a comp pinned to an overlay it soft-deletes (an UPDATE, not a real
--      DELETE — the trigger from proof 1-4 never fires for this path, so this is a genuinely
--      separate code path and needs its own proof) — and the overlay row itself survives
--      (`deleted_at` set), matching the soft-delete contract.
--   6. `soft_delete_site_plan_overlay` refuses to touch an overlay it doesn't own (42501).
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying the
-- report, so every fixture (fake users/review/overlays/comps) is discarded. Paste into the
-- Supabase SQL editor (or run via execute_sql).
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000d0b01';  -- overlay A's owner
  ub uuid := '00000000-0000-4000-8000-0000000d0b02';  -- overlay B's owner (soft-delete proof) — also a teammate comp owner for A
  review_id text := 'rls-test-review-delete-pinned-2';
  overlay_a uuid; overlay_b uuid;
  comp1 uuid; comp2 uuid; comp_plain_pin uuid; comp_soft uuid;
  n int;
  row_anchor text; row_overlay uuid; row_point jsonb; row_lat double precision; row_lon double precision;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  -- ---------- fixtures, as postgres (RLS bypassed) -------------------------
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-del-pinned2-a@test.invalid', now(), now()),
    (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-del-pinned2-b@test.invalid', now(), now());

  insert into public.doc_reviews (id, user_id, title, data) values (review_id, ua, 'RLS test brochure (delete-pinned-2)', '{}'::jsonb);

  insert into public.site_plan_overlays (user_id, review_id, page, img_w, img_h, center_lat, center_lon, ft_per_px, rotation_deg)
  values (ua, review_id, 1, 800, 600, 29.76, -95.37, 2.0, 0)
  returning id into overlay_a;
  insert into public.site_plan_overlays (user_id, review_id, page, img_w, img_h, center_lat, center_lon, ft_per_px, rotation_deg)
  values (ub, review_id, 2, 800, 600, 29.77, -95.38, 2.0, 0)
  returning id into overlay_b;

  -- comp1: owned by A, pinned to overlay A
  insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, site_plan_overlay_id, site_plan_point, land_price, land_size_value, land_size_unit)
  values (ua, 'land', '2026-08-01', 'site_plan', 29.761, -95.371, overlay_a, jsonb_build_object('x', 400, 'y', 300), 100000, 1, 'ac')
  returning id into comp1;
  -- comp2: owned by B (a TEAMMATE relative to overlay A's owner), also pinned to overlay A — proves the SECURITY DEFINER cross-owner detach
  insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, site_plan_overlay_id, site_plan_point, land_price, land_size_value, land_size_unit)
  values (ub, 'land', '2026-08-02', 'site_plan', 29.762, -95.372, overlay_a, jsonb_build_object('x', 120, 'y', 90), 200000, 2, 'ac')
  returning id into comp2;
  -- comp_plain_pin: owned by A, a PLAIN pin anchor, never pinned to any overlay — the control arm
  insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon)
  values (ua, 'land', '2026-08-03', 'pin', 30.0, -95.5)
  returning id into comp_plain_pin;
  -- comp_soft: owned by B, pinned to overlay B (the soft-delete proof)
  insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, site_plan_overlay_id, site_plan_point, land_price, land_size_value, land_size_unit)
  values (ub, 'land', '2026-08-04', 'site_plan', 29.771, -95.381, overlay_b, jsonb_build_object('x', 50, 'y', 60), 300000, 3, 'ac')
  returning id into comp_soft;

  -- ---------- Test 1: hard-deleting overlay A (with two pinned comps, one cross-owner) SUCCEEDS ---------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  begin
    delete from public.site_plan_overlays where id = overlay_a;
    execute 'reset role';
    passed := passed + 1; rep := rep || 'PASS 1: delete succeeded with two comps (one cross-owner) still pinned. ' || E'\n';
  exception when others then
    execute 'reset role';
    failed := failed + 1; rep := rep || 'FAIL 1: delete raised instead of succeeding: ' || sqlerrm || E'\n';
  end;

  select count(*) into n from public.site_plan_overlays where id = overlay_a;
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 2: overlay row is actually gone (real DELETE, not a no-op). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 2: expected the overlay row gone, found %s.', n) || E'\n'; end if;

  -- comp1 (own-owner) reverted to 'pin', link cleared, lat/lon UNCHANGED
  select anchor_kind, site_plan_overlay_id, site_plan_point, lat, lon into row_anchor, row_overlay, row_point, row_lat, row_lon from public.comps where id = comp1;
  if row_anchor = 'pin' and row_overlay is null and row_point is null and row_lat = 29.761 and row_lon = -95.371 then
    passed := passed + 1; rep := rep || 'PASS 3: comp1 (own-owner) reverted to pin anchor, lat/lon unchanged. ' || E'\n';
  else
    failed := failed + 1; rep := rep || format('FAIL 3: comp1 state wrong — anchor=%s overlay=%s point=%s lat=%s lon=%s', row_anchor, row_overlay, row_point, row_lat, row_lon) || E'\n';
  end if;

  -- comp2 (CROSS-owner, deleting user is A, comp2 is owned by B) ALSO reverted — proves SECURITY DEFINER worked
  select anchor_kind, site_plan_overlay_id, site_plan_point, lat, lon into row_anchor, row_overlay, row_point, row_lat, row_lon from public.comps where id = comp2;
  if row_anchor = 'pin' and row_overlay is null and row_point is null and row_lat = 29.762 and row_lon = -95.372 then
    passed := passed + 1; rep := rep || 'PASS 4: comp2 (CROSS-owner, teammate B''s comp) also reverted to pin — SECURITY DEFINER cross-owner detach confirmed. ' || E'\n';
  else
    failed := failed + 1; rep := rep || format('FAIL 4: comp2 (cross-owner) state wrong — anchor=%s overlay=%s point=%s lat=%s lon=%s', row_anchor, row_overlay, row_point, row_lat, row_lon) || E'\n';
  end if;

  -- comp_plain_pin (never pinned to anything) is byte-identical — the detach is scoped correctly
  select anchor_kind, site_plan_overlay_id, lat, lon into row_anchor, row_overlay, row_lat, row_lon from public.comps where id = comp_plain_pin;
  if row_anchor = 'pin' and row_overlay is null and row_lat = 30.0 and row_lon = -95.5 then
    passed := passed + 1; rep := rep || 'PASS 5: the unrelated plain-pin comp is completely untouched. ' || E'\n';
  else
    failed := failed + 1; rep := rep || format('FAIL 5: unrelated comp was touched — anchor=%s overlay=%s lat=%s lon=%s', row_anchor, row_overlay, row_lat, row_lon) || E'\n';
  end if;

  -- ---------- Test 6: soft_delete_site_plan_overlay (owner B) detaches comp_soft, overlay B SURVIVES ---------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  begin
    perform public.soft_delete_site_plan_overlay(overlay_b);
    execute 'reset role';
    passed := passed + 1; rep := rep || 'PASS 6: soft_delete_site_plan_overlay succeeded for its own overlay. ' || E'\n';
  exception when others then
    execute 'reset role';
    failed := failed + 1; rep := rep || 'FAIL 6: soft_delete_site_plan_overlay raised: ' || sqlerrm || E'\n';
  end;

  select count(*) into n from public.site_plan_overlays where id = overlay_b and deleted_at is not null;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 7: overlay B still exists, soft-deleted (deleted_at set) — not a real DELETE. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 7: overlay B is not in the expected soft-deleted state.' || E'\n'; end if;

  select anchor_kind, site_plan_overlay_id, site_plan_point, lat, lon into row_anchor, row_overlay, row_point, row_lat, row_lon from public.comps where id = comp_soft;
  if row_anchor = 'pin' and row_overlay is null and row_point is null and row_lat = 29.771 and row_lon = -95.381 then
    passed := passed + 1; rep := rep || 'PASS 8: comp_soft reverted to pin anchor via the soft-delete RPC, lat/lon unchanged. ' || E'\n';
  else
    failed := failed + 1; rep := rep || format('FAIL 8: comp_soft state wrong — anchor=%s overlay=%s point=%s lat=%s lon=%s', row_anchor, row_overlay, row_point, row_lat, row_lon) || E'\n';
  end if;

  -- ---------- Test 9: soft_delete_site_plan_overlay refuses a non-owned overlay (42501) ---------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);
  begin
    perform public.soft_delete_site_plan_overlay(overlay_b); -- overlay_b belongs to ub, caller is ua
    execute 'reset role';
    failed := failed + 1; rep := rep || 'FAIL 9: soft_delete_site_plan_overlay let a non-owner soft-delete someone else''s overlay.' || E'\n';
  exception when others then
    execute 'reset role';
    if sqlerrm like '%you can only remove site plans you uploaded%' then
      passed := passed + 1; rep := rep || 'PASS 9: soft_delete_site_plan_overlay correctly refused a non-owner. ' || E'\n';
    else
      failed := failed + 1; rep := rep || 'FAIL 9 (wrong error): ' || sqlerrm || E'\n';
    end if;
  end;

  raise exception 'delete-overlay-with-pinned-comp (choice A: revert-to-pin) proof complete — % passed, % failed. %', passed, failed, rep;
end $$;
