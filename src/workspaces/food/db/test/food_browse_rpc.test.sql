-- ============================================================================
-- Guard for the Food map's browse RPC (B<PENDING>, 2026-10-04).
--
-- Proves, AGAINST THE REAL FUNCTION:
--   1. food_places_in_bounds_sampled runs WITHOUT ERROR on a small downtown-Houston box and
--      returns rows (this is the check that is RED on the pre-fix live definition: it raised
--      42883 "operator does not exist: extensions.geography && extensions.geography").
--   2. It also runs, as the real `anon` role, the way the signed-out map calls it.
--   3. SWEEP: no public function with a pinned search_path that omits `extensions` still uses a
--      bare PostGIS `&&` operator in its body (the class of defect that broke #1).
--
-- Self-rolling-back (read-only anyway): raises one exception carrying the report.
-- ============================================================================
do $$
declare
  passed int := 0; failed int := 0; rep text := ''; n int; bad text;
begin
  begin
    select count(*) into n from public.food_places_in_bounds_sampled(29.74, -95.38, 29.77, -95.35, 2000, 8);
    if n > 0 then passed := passed + 1; rep := rep || format('PASS 1: downtown Houston box returns %s rows, no error. ', n) || E'\n';
    else failed := failed + 1; rep := rep || 'FAIL 1: downtown Houston box returned 0 rows (is food_places loaded?). ' || E'\n'; end if;
  exception when others then
    failed := failed + 1; rep := rep || format('FAIL 1: browse RPC raised %s: %s. ', sqlstate, sqlerrm) || E'\n';
  end;

  begin
    execute 'set local role anon';
    select count(*) into n from public.food_places_in_bounds_sampled(29.78, -95.42, 29.81, -95.38, 2000, 8);
    execute 'reset role';
    if n > 0 then passed := passed + 1; rep := rep || format('PASS 2: anon role gets %s rows from the Heights box. ', n) || E'\n';
    else failed := failed + 1; rep := rep || 'FAIL 2: anon got 0 rows from the Heights box. ' || E'\n'; end if;
  exception when others then
    execute 'reset role';
    failed := failed + 1; rep := rep || format('FAIL 2: anon browse call raised %s: %s. ', sqlstate, sqlerrm) || E'\n';
  end;

  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.prokind = 'f'
    and p.proconfig::text ~ 'search_path=' and p.proconfig::text !~ 'search_path=[^"]*extensions'
    and p.prosrc ~ '&&' and p.prosrc !~ 'OPERATOR\(extensions\.&&\)';
  if bad is null then passed := passed + 1; rep := rep || 'PASS 3: no pinned-search_path function uses a bare && operator. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 3: pinned-search_path functions with a bare && operator: %s. ', bad) || E'\n'; end if;

  raise exception E'\n==== FOOD BROWSE RPC TEST REPORT: % passed, % failed ====\n%', passed, failed, rep;
end $$;
