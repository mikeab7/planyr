-- ============================================================================
-- Live proof of comps_available_space.sql. Self-rolling-back (raises at the end carrying the report).
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000cc0e2';
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-av@test.invalid', now(), now());

  begin
    insert into public.comps (user_id, comp_type, anchor_kind, lat, lon, lease_size_sf, av_kind, av_date, lease_rate, lease_rate_period, lease_rate_expense)
    values (ua, 'available', 'pin', 29.76, -95.37, 120000, 'sublease', '2027-01-01', 0.65, 'monthly', 'nnn');
    passed := passed + 1; rep := rep || 'PASS 1: a full available-space row accepted.' || E'\n';
  exception when others then
    failed := failed + 1; rep := rep || 'FAIL 1: ' || sqlerrm || E'\n';
  end;
  begin
    insert into public.comps (user_id, comp_type, anchor_kind, lat, lon, av_kind) values (ua, 'available', 'pin', 29.76, -95.37, 'shadow');
    failed := failed + 1; rep := rep || 'FAIL 2: av_kind=shadow accepted.' || E'\n';
  exception when others then
    if sqlerrm like '%av_kind%' then passed := passed + 1; rep := rep || 'PASS 2: bad kind refused.' || E'\n';
    else failed := failed + 1; rep := rep || 'FAIL 2 (wrong error): ' || sqlerrm || E'\n'; end if;
  end;
  begin
    insert into public.comps (user_id, comp_type, anchor_kind, lat, lon) values (ua, 'under_construction', 'pin', 29.76, -95.37);
    passed := passed + 1; rep := rep || 'PASS 3: under_construction still accepted.' || E'\n';
  exception when others then
    failed := failed + 1; rep := rep || 'FAIL 3: ' || sqlerrm || E'\n';
  end;
  begin
    insert into public.comps (user_id, comp_type, anchor_kind, lat, lon) values (ua, 'office', 'pin', 29.76, -95.37);
    failed := failed + 1; rep := rep || 'FAIL 4: an unknown comp_type was accepted.' || E'\n';
  exception when others then
    passed := passed + 1; rep := rep || 'PASS 4: unknown comp_type still refused.' || E'\n';
  end;

  rep := rep || format('%s passed, %s failed', passed, failed);
  raise exception '%', rep;
end $$;
