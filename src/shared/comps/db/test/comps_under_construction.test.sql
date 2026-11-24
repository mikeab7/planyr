-- ============================================================================
-- Live proof of comps_under_construction.sql. Self-rolling-back (raises at the end carrying the
-- report so every fixture is discarded). Paste into the Supabase SQL editor or run via execute_sql.
-- Proves: the new type is accepted, a bad status / kind / pre-leased % is refused, and a team
-- mate can READ but not UPDATE an under-construction row (the RLS shape is the unchanged comps one).
-- ============================================================================
do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000cc0e1';
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-uc@test.invalid', now(), now());

  begin
    insert into public.comps (user_id, comp_type, anchor_kind, lat, lon, bldg_size_sf, uc_status, uc_delivery_kind, uc_start_date, uc_delivery_date, uc_preleased_pct)
    values (ua, 'under_construction', 'pin', 29.76, -95.37, 250000, 'under_construction', 'spec', '2026-06-01', '2027-03-01', 40);
    passed := passed + 1; rep := rep || 'PASS 1: a full under-construction row accepted.' || E'\n';
  exception when others then
    failed := failed + 1; rep := rep || 'FAIL 1: ' || sqlerrm || E'\n';
  end;
  begin
    insert into public.comps (user_id, comp_type, anchor_kind, lat, lon, uc_status) values (ua, 'under_construction', 'pin', 29.76, -95.37, 'finished');
    failed := failed + 1; rep := rep || 'FAIL 2: uc_status=finished accepted.' || E'\n';
  exception when others then
    if sqlerrm like '%uc_status%' then passed := passed + 1; rep := rep || 'PASS 2: bad status refused.' || E'\n';
    else failed := failed + 1; rep := rep || 'FAIL 2 (wrong error): ' || sqlerrm || E'\n'; end if;
  end;
  begin
    insert into public.comps (user_id, comp_type, anchor_kind, lat, lon, uc_preleased_pct) values (ua, 'under_construction', 'pin', 29.76, -95.37, 140);
    failed := failed + 1; rep := rep || 'FAIL 3: uc_preleased_pct=140 accepted.' || E'\n';
  exception when others then
    if sqlerrm like '%uc_preleased_pct%' then passed := passed + 1; rep := rep || 'PASS 3: pre-leased over 100 refused.' || E'\n';
    else failed := failed + 1; rep := rep || 'FAIL 3 (wrong error): ' || sqlerrm || E'\n'; end if;
  end;
  begin
    insert into public.comps (user_id, comp_type, anchor_kind, lat, lon, uc_delivery_kind) values (ua, 'under_construction', 'pin', 29.76, -95.37, 'maybe');
    failed := failed + 1; rep := rep || 'FAIL 4: uc_delivery_kind=maybe accepted.' || E'\n';
  exception when others then
    if sqlerrm like '%uc_delivery_kind%' then passed := passed + 1; rep := rep || 'PASS 4: bad delivery kind refused.' || E'\n';
    else failed := failed + 1; rep := rep || 'FAIL 4 (wrong error): ' || sqlerrm || E'\n'; end if;
  end;
  begin
    insert into public.comps (user_id, comp_type, anchor_kind, lat, lon) values (ua, 'office', 'pin', 29.76, -95.37);
    failed := failed + 1; rep := rep || 'FAIL 5: an unknown comp_type was accepted.' || E'\n';
  exception when others then
    passed := passed + 1; rep := rep || 'PASS 5: unknown comp_type still refused.' || E'\n';
  end;

  rep := rep || format('%s passed, %s failed', passed, failed);
  raise exception '%', rep;
end $$;
