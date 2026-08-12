-- ============================================================================
-- B1341 STAGE 2 — group-CAS test, AGAINST THE REAL DATABASE.
--
-- Proves the single property stage 2 exists for:
--
--     A CALL WHOSE ASSEMBLY HAS MOVED WRITES NOTHING AT ALL.
--
-- and the three properties that make that safe to ship: an unmoved group still
-- applies, a call that does not opt in is byte-for-byte its old self, and a
-- tombstoned member is not part of the group.
--
-- This tests the DATABASE, not the client. The digest is computed by the shipped
-- `assembly_digest` function over real rows with a real generated `assembly_id`,
-- so it exercises stage 1 and stage 2 together, exactly as the browser will.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and execute.
--   It is SELF-ROLLING-BACK — it ends by raising an exception carrying the report,
--   so every fixture row is discarded. It writes NOTHING that survives. Read the
--   report out of the error message. (Same shape as team_share_scope.test.sql.)
--
-- HOW TO PROVE IT RED (do this whenever the guard is touched — a guard nobody has
-- watched fail is a guard that has rotted green):
--   Make the group check permissive and re-run —
--     …replace `if v_have is distinct from v_want then` with `if false then`…
--   Tests 2 and 3 must FAIL: the stale call is accepted and the host row moves.
--   Restoring the check must turn them green.
-- ============================================================================
do $$
declare
  site   text := 'gcas-test-site';
  host   text := 'gcas-host';
  kidA   text := 'gcas-kid-a';
  kidB   text := 'gcas-kid-b';
  d0     text;
  d1     text;
  res    jsonb;
  rep    text := '';
  failed int := 0;
  n      bigint;
  t      text;
  owner_uid uuid;

begin
  -- ---- fixture: one bonded assembly, host + two children ------------------
  -- `site_elements.site_id` is FK'd to `sites`, and `sites.user_id` is FK'd to `auth.users`, so the
  -- fixture has to hang off a REAL account — a synthetic uuid is rejected by the constraint. Any
  -- existing user works; everything here is rolled back, and nothing touches a real plan (the site
  -- id is a literal that no plan uses). Swap in your own uid if this account is gone.
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'group-cas test: no auth user to hang the fixture off'; end if;

  insert into public.sites (id, user_id, site, name, data)
  values (site, owner_uid, 'GCAS', 'group-cas test', '{}'::jsonb);

  insert into public.site_elements (site_id, id, kind, data, z_index, rev)
  values
    (site, host, 'el', jsonb_build_object('id', host, 'type', 'building'), 0, 1),
    (site, kidA, 'el', jsonb_build_object('id', kidA, 'type', 'paving',  'attachedTo', host), 1, 1),
    (site, kidB, 'el', jsonb_build_object('id', kidB, 'type', 'trailer', 'attachedTo', host), 2, 1);

  -- stage 1's generated column must actually group them, or stage 2 has nothing to stand on
  select count(*) into n from public.site_elements
   where site_id = site and assembly_id = host and deleted_at is null;
  if n = 3 then rep := rep || E'\n  ok  0. assembly_id groups host + 2 children (stage 1 holds)';
  else failed := failed + 1; rep := rep || format(E'\n  FAIL 0. assembly_id grouped %s rows, expected 3', n); end if;

  d0 := public.assembly_digest(site, host);
  if d0 = 'gcas-host:1,gcas-kid-a:1,gcas-kid-b:1' then
    rep := rep || E'\n  ok  1. digest is id:rev pairs, sorted by id, comma-joined';
  else
    failed := failed + 1; rep := rep || format(E'\n  FAIL 1. digest was %L', d0);
  end if;

  -- ---- 2. THE POINT OF THE WHOLE STAGE ------------------------------------
  -- Another writer bumps ONE child. Our digest is now stale. A call naming the
  -- group must be refused WHOLE — including the op targeting the host, whose own
  -- per-row rev guard would have passed.
  update public.site_elements set rev = rev + 1
   where site_id = site and id = kidB;

  res := public.commit_elements(site, jsonb_build_array(
           jsonb_build_object('op','update','id',host,'kind','el','expected',1,
                              'data', jsonb_build_object('id',host,'type','building','cx',999))
         ), true, jsonb_build_array(jsonb_build_object('assembly', host, 'expected', d0)));

  if (res->>'applied') = 'false' and jsonb_array_length(res->'groupConflict') = 1
     and (res->'groupConflict'->0->>'assembly') = host
     and (res->'groupConflict'->0->>'expected') = d0
     and (res->'groupConflict'->0->>'actual') = public.assembly_digest(site, host)
  then rep := rep || E'\n  ok  2. a moved group is REFUSED, naming expected vs actual';
  else failed := failed + 1; rep := rep || format(E'\n  FAIL 2. %s', res); end if;

  -- …and NOTHING was written. This is the assertion that matters: the op above
  -- held a valid per-row rev, so under B1117 alone it would have landed.
  select rev, data->>'cx' into n, t from public.site_elements where site_id = site and id = host;
  if n = 1 and t is null then rep := rep || E'\n  ok  3. the refused call wrote NOTHING (host still rev 1, un-moved)';
  else failed := failed + 1; rep := rep || format(E'\n  FAIL 3. host is rev %s cx %s — the refusal leaked a write', n, t); end if;

  -- ---- 4. re-read and re-commit: the client''s recovery path works ---------
  d1 := public.assembly_digest(site, host);
  res := public.commit_elements(site, jsonb_build_array(
           jsonb_build_object('op','update','id',host,'kind','el','expected',1,
                              'data', jsonb_build_object('id',host,'type','building','cx',999))
         ), true, jsonb_build_array(jsonb_build_object('assembly', host, 'expected', d1)));

  select rev, data->>'cx' into n, t from public.site_elements where site_id = site and id = host;
  if (res->>'applied') = 'true' and n = 2 and t = '999'
  then rep := rep || E'\n  ok  4. at the CURRENT digest the same call applies';
  else failed := failed + 1; rep := rep || format(E'\n  FAIL 4. res=%s host rev=%s cx=%s', res, n, t); end if;

  -- ---- 5. opting OUT is unchanged behaviour -------------------------------
  -- Null groups must delegate to the 3-arg form. If this ever stops being true,
  -- every client in the wild changes behaviour on a migration.
  res := public.commit_elements(site, jsonb_build_array(
           jsonb_build_object('op','update','id',host,'kind','el','expected',2,
                              'data', jsonb_build_object('id',host,'type','building','cx',1000))
         ), true, null);
  if (res->>'applied') = 'true' then rep := rep || E'\n  ok  5. null p_groups delegates to the 3-arg form';
  else failed := failed + 1; rep := rep || format(E'\n  FAIL 5. %s', res); end if;

  res := public.commit_elements(site, jsonb_build_array(
           jsonb_build_object('op','update','id',host,'kind','el','expected',3,
                              'data', jsonb_build_object('id',host,'type','building','cx',1001))
         ), true, '[]'::jsonb);
  if (res->>'applied') = 'true' then rep := rep || E'\n  ok  6. empty p_groups delegates too';
  else failed := failed + 1; rep := rep || format(E'\n  FAIL 6. %s', res); end if;

  -- ---- 7. a TOMBSTONE is not a member -------------------------------------
  -- Live rows only, on both sides. Counting a tombstone would make one delete
  -- look like a change to every sibling and reject every later group call.
  update public.site_elements set deleted_at = now() where site_id = site and id = kidA;
  if public.assembly_digest(site, host) not like '%gcas-kid-a%'
  then rep := rep || E'\n  ok  7. a tombstoned member drops out of the digest';
  else failed := failed + 1; rep := rep || format(E'\n  FAIL 7. digest still names the tombstone: %L', public.assembly_digest(site, host)); end if;

  -- ---- 8. an assembly nobody has written is the empty digest --------------
  if public.assembly_digest(site, 'no-such-assembly') = ''
  then rep := rep || E'\n  ok  8. an unknown assembly digests to the empty string, not null';
  else failed := failed + 1; rep := rep || E'\n  FAIL 8. unknown assembly did not digest to empty'; end if;

  -- ---- report + ROLL EVERYTHING BACK --------------------------------------
  -- ⚠ RAISE's placeholder is a bare `%`, never `%s` — a `%s` prints the value then a literal 's'.
  raise exception E'\n=== B1341 stage 2 — group CAS ===%\n\n% (fixtures rolled back, nothing written)',
    rep, case when failed = 0 then 'ALL PASS' else format('%s FAILED', failed) end;
end $$;
