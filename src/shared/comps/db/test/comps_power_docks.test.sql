-- ============================================================================
-- Live proof of comps_power_docks.sql's constraints (NEW-2). Proves each REJECTS the bad value it exists for and ACCEPTS a good one,
-- against the real constraints — not inferred from the DDL text.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying the
-- report, so every fixture (fake user/comp) is discarded. Paste into the Supabase SQL editor (or
-- run via execute_sql).
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000cc0d1';
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-power-docks@test.invalid', now(), now());

  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, power_phase)
    values (ua, 'building_sale', '2026-08-01', 'pin', 29.76, -95.37, 2);
    failed := failed + 1; rep := rep || 'FAIL 1: power_phase=2 was accepted.' || E'\n';
  exception when others then
    if sqlerrm like '%power_phase%' then
      passed := passed + 1; rep := rep || 'PASS 1: power_phase=2 refused.' || E'\n';
    else
      failed := failed + 1; rep := rep || 'FAIL 1 (wrong error): ' || sqlerrm || E'\n';
    end if;
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, power_amps, power_volts, power_phase, dock_doors)
    values (ua, 'building_sale', '2026-08-01', 'pin', 29.76, -95.37, 2000, 480, 3, 12);
    passed := passed + 1; rep := rep || 'PASS 1b: a full 2000A/480V/3-phase/12-door set accepted.' || E'\n';
  exception when others then
    failed := failed + 1; rep := rep || 'FAIL 1b: a full 2000A/480V/3-phase/12-door set was rejected: ' || sqlerrm || E'\n';
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, power_phase)
    values (ua, 'building_sale', '2026-08-01', 'pin', 29.76, -95.37, 1);
    passed := passed + 1; rep := rep || 'PASS 1c: power_phase=1 accepted.' || E'\n';
  exception when others then
    failed := failed + 1; rep := rep || 'FAIL 1c: power_phase=1 was rejected: ' || sqlerrm || E'\n';
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, power_amps)
    values (ua, 'building_sale', '2026-08-01', 'pin', 29.76, -95.37, -1);
    failed := failed + 1; rep := rep || 'FAIL 2: negative power_amps was accepted.' || E'\n';
  exception when others then
    if sqlerrm like '%non_negative%' then
      passed := passed + 1; rep := rep || 'PASS 2: negative power_amps refused.' || E'\n';
    else
      failed := failed + 1; rep := rep || 'FAIL 2 (wrong error): ' || sqlerrm || E'\n';
    end if;
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, dock_doors)
    values (ua, 'building_sale', '2026-08-01', 'pin', 29.76, -95.37, -3);
    failed := failed + 1; rep := rep || 'FAIL 3: negative dock_doors was accepted.' || E'\n';
  exception when others then
    if sqlerrm like '%non_negative%' then
      passed := passed + 1; rep := rep || 'PASS 3: negative dock_doors refused.' || E'\n';
    else
      failed := failed + 1; rep := rep || 'FAIL 3 (wrong error): ' || sqlerrm || E'\n';
    end if;
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, power_volts)
    values (ua, 'building_sale', '2026-08-01', 'pin', 29.76, -95.37, -480);
    failed := failed + 1; rep := rep || 'FAIL 4: negative power_volts was accepted.' || E'\n';
  exception when others then
    if sqlerrm like '%non_negative%' then
      passed := passed + 1; rep := rep || 'PASS 4: negative power_volts refused.' || E'\n';
    else
      failed := failed + 1; rep := rep || 'FAIL 4 (wrong error): ' || sqlerrm || E'\n';
    end if;
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, dock_doors)
    values (ua, 'building_sale', '2026-08-01', 'pin', 29.76, -95.37, 0);
    passed := passed + 1; rep := rep || 'PASS 5: dock_doors=0 (a real answer, not blank) accepted.' || E'\n';
  exception when others then
    failed := failed + 1; rep := rep || 'FAIL 5: dock_doors=0 (a real answer, not blank) was rejected: ' || sqlerrm || E'\n';
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, power_amps)
    values (ua, 'building_sale', '2026-08-01', 'pin', 29.76, -95.37, null);
    passed := passed + 1; rep := rep || 'PASS 6: all four blank accepted.' || E'\n';
  exception when others then
    failed := failed + 1; rep := rep || 'FAIL 6: all four blank was rejected: ' || sqlerrm || E'\n';
  end;

  raise exception 'comps_power_docks proof complete — % passed, % failed. %', passed, failed, rep;
end $$;
