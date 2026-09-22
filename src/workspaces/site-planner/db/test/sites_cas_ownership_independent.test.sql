-- B1791057 ("confirm what is actually refusing the cross-user write") — self-rolling-back, run live
-- against production via the Supabase MCP. Paste into the Supabase SQL editor (or run via
-- execute_sql) and read the report out of the raised exception — the whole thing rolls back
-- regardless of outcome. Mirrors the shape of sites_soft_delete_rls.test.sql /
-- sites_version_monotonic_guard.test.sql.
--
-- ============================================================================================
-- WHY THIS EXISTS
-- ============================================================================================
-- B1791056 found a client re-firing `event:cloud-conflict` ("stale write rejected twice (sites
-- CAS)", reason cas-409) for 17+ days against a `sites` row owned by a DIFFERENT account. The
-- `cas-409` reason name suggests the optimistic-concurrency version check is what refuses the
-- write — but `casUpsert`'s conditional UPDATE (`shared/cloud/optimisticUpsert.js`) filters on
-- `(id, version)` ONLY; ownership is enforced separately, by RLS's `USING` clause on the `update
-- own or team sites` policy (`db/team_sharing.sql`): `user_id = auth.uid() OR (team_id is not
-- null AND is_team_member(team_id) AND not share_locked)`. That clause names nothing about
-- version. So the open question this file answers, empirically rather than by reading the SQL:
-- does ownership ACTUALLY refuse a non-owner's write independent of version, or would a
-- non-owner who happened to send the exact correct version slip through? If the latter, that is a
-- security hole — the version match, not ownership, would be the only real barrier.
--
-- ============================================================================================
-- THE ANSWER, measured 2026-09-22 against planyr_production (all 4 checks PASS)
-- ============================================================================================
-- Ownership refuses the write independently of version. A non-owner sending the EXACT CURRENT
-- version (the well-formed CAS shape casUpsert itself would send) is refused (0 rows) exactly as
-- a non-owner sending no version predicate at all is refused (0 rows) — the version clause is
-- inert for a non-owner because RLS's USING clause already excludes the row before the version
-- equality is ever evaluated. The control (the real owner, same version, same shape) succeeds,
-- proving the harness can see a positive result and isn't merely failing for an unrelated reason
-- (WRONG-CASE). This is NOT a security finding: ownership (RLS), not the client's version filter,
-- is what actually stands between one account and another account's `sites` row.
--
-- Run again any time this table's RLS policies change, to confirm the property still holds.

do $$
declare
  ua uuid := '00000000-0000-4000-8000-0000000e0e01';  -- A: owns the row
  ub uuid := '00000000-0000-4000-8000-0000000e0e02';  -- B: unrelated, no team, no relation to A
  sid text := 'rlstest-cas-e0e01';
  n int;
  cur_version int;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  -- fixtures, as postgres (RLS bypassed)
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (ua, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-cas-a@test.invalid', now(), now()),
         (ub, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-cas-b@test.invalid', now(), now());

  insert into public.sites (id, user_id, group_id, site, name, updated_at, data, team_id, version)
  values (sid, ua, sid, 'RLS CAS test', 'Concept A', now(), '{"id":"rlstest-cas-e0e01"}'::jsonb, null, 7);

  select version into cur_version from public.sites where id = sid;

  -- ===== TEST 1: B attempts the EXACT client-shape CAS write, with the CORRECT current version,
  -- against A's row. If ownership were NOT independently enforced, this would succeed. =====
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);

  update public.sites
     set data = '{"id":"rlstest-cas-e0e01","tampered":true}'::jsonb, version = cur_version + 1
   where id = sid and version = cur_version;
  get diagnostics n = row_count;

  if n = 0 then
    passed := passed + 1;
    rep := rep || format(E'PASS  1. non-owner B, CORRECT version (%s), 0 rows updated — RLS ownership blocks it independently of version\n', cur_version);
  else
    failed := failed + 1;
    rep := rep || format(E'FAIL  1. non-owner B updated %s row(s) with a correct version — SECURITY HOLE: version match alone is enough\n', n);
  end if;

  execute 'reset role'; execute 'set local request.jwt.claims = default';

  select version into cur_version from public.sites where id = sid;
  if cur_version = 7 then
    passed := passed + 1; rep := rep || E'PASS  1b. row version is still 7 — untouched by B''s attempt\n';
  else
    failed := failed + 1; rep := rep || format(E'FAIL  1b. row version is now %s — B''s write partially landed\n', cur_version);
  end if;

  -- ===== TEST 2 (control / WRONG-CASE guard): the SAME shape, as the real owner A, with the
  -- correct version, must SUCCEED — proves the harness can see a positive result too. =====
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ua, 'role', 'authenticated')::text);

  update public.sites
     set data = '{"id":"rlstest-cas-e0e01","ownerEdit":true}'::jsonb, version = cur_version + 1
   where id = sid and version = cur_version;
  get diagnostics n = row_count;
  if n = 1 then
    passed := passed + 1; rep := rep || E'PASS  2. owner A, correct version, 1 row updated (control — the harness CAN see success)\n';
  else
    failed := failed + 1; rep := rep || format(E'FAIL  2. owner A''s own correctly-versioned write affected %s row(s)\n', n);
  end if;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  -- ===== TEST 3: B attempts an UNVERSIONED (no WHERE version=) update — confirms RLS fires with
  -- NO version predicate at all, i.e. the client's own WHERE-clause version filter is not what is
  -- doing the work. =====
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims = %L', json_build_object('sub', ub, 'role', 'authenticated')::text);
  update public.sites set data = '{"id":"rlstest-cas-e0e01","noVersionAtAll":true}'::jsonb where id = sid;
  get diagnostics n = row_count;
  if n = 0 then
    passed := passed + 1; rep := rep || E'PASS  3. non-owner B, NO version predicate at all, 0 rows updated — ownership (RLS USING) is the actual barrier\n';
  else
    failed := failed + 1; rep := rep || format(E'FAIL  3. non-owner B updated %s row(s) with no version filter\n', n);
  end if;
  execute 'reset role'; execute 'set local request.jwt.claims = default';

  raise exception E'\n%\n---- % passed, % FAILED ----\n(this exception is deliberate: it rolls the whole test back)',
    rep, passed, failed;
end $$;
