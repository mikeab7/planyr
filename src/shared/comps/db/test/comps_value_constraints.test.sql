-- ============================================================================
-- Live proof of comps_value_constraints.sql's three new CHECK constraints (adversarial review
-- NEW-4, 2026-09-02). Proves each one REJECTS the bad value it exists for and ACCEPTS a good one,
-- against the real constraints — not inferred from the DDL text.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying the
-- report, so every fixture (fake user/comp) is discarded. Paste into the Supabase SQL editor (or
-- run via execute_sql).
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000cc001';
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-value-constraints@test.invalid', now(), now());

  -- ---------- 1. lease_rate requires lease_rate_period -----------------------------------
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, lease_rate)
    values (ua, 'lease', '2026-08-01', 'pin', 29.76, -95.37, 5.00);
    failed := failed + 1; rep := rep || 'FAIL 1: a lease_rate with no period was accepted.' || E'\n';
  exception when others then
    if sqlerrm like '%comps_lease_rate_requires_period%' then
      passed := passed + 1; rep := rep || 'PASS 1: rate-without-period refused: ' || sqlerrm || E'\n';
    else
      failed := failed + 1; rep := rep || 'FAIL 1 (wrong error): ' || sqlerrm || E'\n';
    end if;
  end;
  -- ...and a rate WITH a period is accepted.
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, lease_rate, lease_rate_period)
    values (ua, 'lease', '2026-08-01', 'pin', 29.76, -95.37, 5.00, 'annual');
    passed := passed + 1; rep := rep || 'PASS 1b: rate-with-period accepted.' || E'\n';
  exception when others then
    failed := failed + 1; rep := rep || 'FAIL 1b: a valid rate+period was rejected: ' || sqlerrm || E'\n';
  end;

  -- ---------- 2. non-negative amounts -----------------------------------------------------
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, land_price)
    values (ua, 'land', '2026-08-01', 'pin', 29.76, -95.37, -100000);
    failed := failed + 1; rep := rep || 'FAIL 2: a negative land_price was accepted.' || E'\n';
  exception when others then
    if sqlerrm like '%comps_amounts_non_negative%' then
      passed := passed + 1; rep := rep || 'PASS 2: negative land_price refused: ' || sqlerrm || E'\n';
    else
      failed := failed + 1; rep := rep || 'FAIL 2 (wrong error): ' || sqlerrm || E'\n';
    end if;
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, land_price, land_size_value, land_size_unit)
    values (ua, 'land', '2026-08-01', 'pin', 29.76, -95.37, 100000, 5, 'ac');
    passed := passed + 1; rep := rep || 'PASS 2b: a positive land_price accepted.' || E'\n';
  exception when others then
    failed := failed + 1; rep := rep || 'FAIL 2b: a valid positive land_price was rejected: ' || sqlerrm || E'\n';
  end;

  -- ---------- 3. cap rate range (stored as a fraction, 0 < x <= 1) ------------------------
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, bldg_cap_rate)
    values (ua, 'building_sale', '2026-08-01', 'pin', 29.76, -95.37, 7.5);
    failed := failed + 1; rep := rep || 'FAIL 3: bldg_cap_rate=7.5 (a 100x scale error) was accepted.' || E'\n';
  exception when others then
    if sqlerrm like '%comps_cap_rate_range%' then
      passed := passed + 1; rep := rep || 'PASS 3: out-of-range cap rate refused: ' || sqlerrm || E'\n';
    else
      failed := failed + 1; rep := rep || 'FAIL 3 (wrong error): ' || sqlerrm || E'\n';
    end if;
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, bldg_cap_rate)
    values (ua, 'building_sale', '2026-08-01', 'pin', 29.76, -95.37, 0.075);
    passed := passed + 1; rep := rep || 'PASS 3b: a correctly-scaled cap rate (0.075 = 7.5%) accepted.' || E'\n';
  exception when others then
    failed := failed + 1; rep := rep || 'FAIL 3b: a valid cap rate fraction was rejected: ' || sqlerrm || E'\n';
  end;

  raise exception 'comps_value_constraints proof complete — % passed, % failed. %', passed, failed, rep;
end $$;
