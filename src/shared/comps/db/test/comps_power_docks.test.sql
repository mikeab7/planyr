-- ============================================================================
-- Live proof of comps_power_docks.sql (NEW-2, comps records search): each constraint REJECTS the bad
-- value it exists for and ACCEPTS a good one. Self-rolling-back: runs in a DO block and raises an
-- exception at the end carrying the report (a negative value may trip either comps_power_docks_non_negative or the wider comps_amounts_non_negative, both are right), so every fixture is discarded.
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000cc0d1';
  rep text := '';
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-power-docks@test.invalid', now(), now());

  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, power_phase) values (ua, 'lease', '2026-08-01', 'pin', 29.76, -95.37, 2);
    rep := rep || 'FAIL 1: phase 2 accepted.' || E'\n';
  exception when others then
    rep := rep || case when sqlerrm like '%comps_power_phase_1_or_3%' then 'PASS 1: phase 2 refused.' else 'FAIL 1 (wrong error): ' || sqlerrm end || E'\n';
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, power_phase, power_amps, power_volts, dock_doors) values (ua, 'lease', '2026-08-01', 'pin', 29.76, -95.37, 3, 2000, 480, 24);
    rep := rep || 'PASS 2: 3-phase 2000A 480V 24 docks accepted.' || E'\n';
  exception when others then rep := rep || 'FAIL 2: ' || sqlerrm || E'\n';
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, dock_doors) values (ua, 'lease', '2026-08-01', 'pin', 29.76, -95.37, -1);
    rep := rep || 'FAIL 3: negative dock_doors accepted.' || E'\n';
  exception when others then
    rep := rep || case when sqlerrm like '%non_negative%' then 'PASS 3: negative dock_doors refused.' else 'FAIL 3 (wrong error): ' || sqlerrm end || E'\n';
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, power_amps) values (ua, 'lease', '2026-08-01', 'pin', 29.76, -95.37, -5);
    rep := rep || 'FAIL 4: negative power_amps accepted.' || E'\n';
  exception when others then
    rep := rep || case when sqlerrm like '%non_negative%' then 'PASS 4: negative power_amps refused.' else 'FAIL 4 (wrong error): ' || sqlerrm end || E'\n';
  end;
  begin
    insert into public.comps (user_id, comp_type, comp_date, anchor_kind, lat, lon, power_amps, dock_doors) values (ua, 'lease', '2026-08-01', 'pin', 29.76, -95.37, null, 0);
    rep := rep || 'PASS 5: blank amps and 0 docks both accepted (blank is not 0).' || E'\n';
  exception when others then rep := rep || 'FAIL 5: ' || sqlerrm || E'\n';
  end;
  raise exception E'REPORT\n%', rep;
end $$;
