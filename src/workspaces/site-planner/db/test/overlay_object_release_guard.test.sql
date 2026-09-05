-- ============================================================================
-- Proof for B1183152/B1183153 (security-advisor sweep), AGAINST THE REAL FUNCTIONS.
--
-- Proves:
--   1. sites_referencing_storage_key() is NOT reachable by the anon role over the API
--      (was: has_function_privilege('anon', oid, 'EXECUTE') = true, no auth guard at all).
--   2. The guard trigger's holder check is still GLOBAL across owners (deliberate — see
--      overlay_object_release_guard.sql's header) — a plan belonging to a DIFFERENT owner
--      still blocks the delete.
--   3. The guard's error message reveals the CALLER's own plan name but redacts a holder
--      plan the caller does not own (never leaks another tenant's plan name).
--   4. The delete is still genuinely refused (LOUD-FAILURE, object survives) while any
--      holder — owned or not — remains.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying
-- the report, so every fixture row (users, sites, the storage object) is discarded. Run
-- via the Supabase MCP execute_sql tool and read the report out of the error message.
-- Same shape as admin_reset_password.test.sql / problem_reports_rls.test.sql.
-- ============================================================================
do $$
declare
  owner_a uuid := '00000000-0000-4000-8000-0000000f2301'; -- the path owner / caller in test 3
  owner_b uuid := '00000000-0000-4000-8000-0000000f2302'; -- a different owner whose plan also holds the key
  test_key text := owner_a::text || '/site-overlays/smtestguardxx/e_test_guard.pdf';
  n int;
  ok boolean;
  msg text;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guard-test-owner-a@test.invalid', extensions.crypt('x', extensions.gen_salt('bf')), now(), now()),
    (owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'guard-test-owner-b@test.invalid', extensions.crypt('x', extensions.gen_salt('bf')), now(), now())
  on conflict (id) do nothing;

  insert into public.sites (id, user_id, name, data)
  values
    ('smtestguardxx', owner_a, 'Guard Test — Owner A Plan',
     jsonb_build_object('sheetOverlays', jsonb_build_array(jsonb_build_object('storageKey', test_key)))),
    ('smtestguardyy', owner_b, 'Guard Test — Owner B Plan (should be redacted)',
     jsonb_build_object('sheetOverlays', jsonb_build_array(jsonb_build_object('storageKey', test_key))))
  on conflict (id) do update set user_id = excluded.user_id, name = excluded.name, data = excluded.data;

  insert into storage.objects (bucket_id, name, owner)
  values ('doc-review-files', test_key, owner_a)
  on conflict (bucket_id, name) do nothing;

  -- storage.objects carries its OWN statement-level guard (storage.protect_delete(), a
  -- Supabase default unrelated to this file) that refuses any direct SQL DELETE unless this
  -- is set — local to this transaction, so it never survives past this DO block's rollback.
  perform set_config('storage.allow_delete_query', 'true', true);

  -- ---------- Test 1: anon cannot call the RPC at all -------------------------
  execute 'set local role anon';
  begin
    perform public.sites_referencing_storage_key(test_key);
    ok := true;
  exception when others then ok := false;
  end;
  execute 'reset role';
  if not ok then passed := passed + 1; rep := rep || 'PASS 1: anon is denied EXECUTE on sites_referencing_storage_key(). ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 1: anon successfully called sites_referencing_storage_key() — still exposed.' || E'\n'; end if;

  -- ---------- Test 2: the holder check is GLOBAL (both owners' plans count) --
  select count(*) into n from public.sites_referencing_storage_key(test_key);
  if n = 2 then passed := passed + 1; rep := rep || 'PASS 2: both plans (owner A and owner B) are reported as holders — deliberately global. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 2: expected 2 holders, got %s.', n) || E'\n'; end if;

  -- ---------- Test 3: owner A (the path/RLS owner) attempts the delete -------
  -- Owner A owns the storage path, so Storage's own RLS lets the DELETE reach our
  -- trigger; the trigger must still refuse it (owner B's plan is also a holder) and
  -- must reveal owner A's OWN plan name while redacting owner B's.
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', owner_a, 'role', 'authenticated')::text);
  begin
    delete from storage.objects where bucket_id = 'doc-review-files' and name = test_key;
    ok := true;
    msg := null;
  exception when others then
    ok := false;
    msg := sqlerrm;
  end;
  execute 'reset role';

  if not ok then passed := passed + 1; rep := rep || 'PASS 3: the delete was refused while a holder remains. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 3: the delete SUCCEEDED — the guard did not fire.' || E'\n'; end if;

  if msg is not null and msg like '%Guard Test — Owner A Plan%' then
    passed := passed + 1; rep := rep || 'PASS 4: the caller''s own plan name is shown in the error. ' || E'\n';
  else
    failed := failed + 1; rep := rep || format('FAIL 4: caller''s own plan name missing from message: %s', coalesce(msg, '<none>')) || E'\n';
  end if;

  if msg is not null and msg like '%a plan you do not own%' and msg not like '%Owner B Plan%' then
    passed := passed + 1; rep := rep || 'PASS 5: owner B''s plan name is redacted, never leaked. ' || E'\n';
  else
    failed := failed + 1; rep := rep || format('FAIL 5: owner B''s plan name was NOT redacted: %s', coalesce(msg, '<none>')) || E'\n';
  end if;

  -- ---------- Test 6: the object genuinely still exists (LOUD-FAILURE) -------
  select count(*) into n from storage.objects where bucket_id = 'doc-review-files' and name = test_key;
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 6: the storage object still exists — nothing was silently released. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 6: the storage object is gone despite the refusal.' || E'\n'; end if;

  raise exception E'\n=== overlay_object_release_guard proof: % passed, % failed ===\n%', passed, failed, rep;
end $$;
