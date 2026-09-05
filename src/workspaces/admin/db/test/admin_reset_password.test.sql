-- ============================================================================
-- RLS + behavior proof for admin password reset (B1160722, NEW-3).
--
-- Proves, AGAINST THE REAL FUNCTIONS:
--   1. A non-admin signed-in user calling admin_reset_user_password() is REJECTED
--      (server-side is_admin() check, not a hidden button).
--   2. The real admin CAN reset a target user's password and gets back a new password.
--   3. The returned plaintext genuinely verifies against the stored hash (crypt(returned,
--      stored) = stored) — proving a real, working bcrypt hash was written, not a stub.
--   4. The reset is recorded (who reset whom, when) in admin_password_resets.
--   5. A non-admin gets zero rows from admin_list_users() / admin_list_password_resets();
--      the real admin sees the test user / the test reset via both.
--   6. Resetting a user id that doesn't exist is refused.
--
-- Self-rolling-back: runs inside a DO block and raises an exception at the end carrying
-- the report, so every fixture row (users, reset record) is discarded. Run via the
-- Supabase MCP execute_sql tool and read the report out of the error message. Same shape
-- as problem_reports_rls.test.sql.
-- ============================================================================
do $$
declare
  target_uid uuid := '00000000-0000-4000-8000-0000000f2201';
  nonadmin_uid uuid := '00000000-0000-4000-8000-0000000f2202';
  admin_uid uuid := 'b147d90d-b610-423d-af65-7e004f0ad72f'; -- the real seeded admin (admin_users.sql)
  n int;
  new_pw text;
  stored_hash text;
  ok boolean;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values
    (target_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-reset-target@test.invalid', extensions.crypt('original-password', extensions.gen_salt('bf')), now(), now()),
    (nonadmin_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-reset-nonadmin@test.invalid', extensions.crypt('whatever', extensions.gen_salt('bf')), now(), now())
  on conflict (id) do nothing;

  -- ---------- Test 1: a non-admin is rejected, server-side -------------------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', nonadmin_uid, 'role', 'authenticated')::text);
  begin
    perform public.admin_reset_user_password(target_uid);
    ok := true;
  exception when others then ok := false;
  end;
  execute 'reset role';
  if not ok then passed := passed + 1; rep := rep || 'PASS 1: a non-admin caller is rejected by the RPC itself. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 1: a non-admin successfully reset a password — server-side gate is not working.' || E'\n'; end if;

  -- ---------- Test 2: the real admin CAN reset it, and gets a new password ---
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', admin_uid, 'role', 'authenticated')::text);
  select public.admin_reset_user_password(target_uid) into new_pw;
  execute 'reset role';
  if new_pw is not null and length(new_pw) >= 16 then passed := passed + 1; rep := rep || format('PASS 2: the admin reset the password and received a new one (length %s). ', length(new_pw)) || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 2: the admin reset did not return a real new password.' || E'\n'; end if;

  -- ---------- Test 3: the returned plaintext verifies against the stored hash -
  select encrypted_password into stored_hash from auth.users where id = target_uid;
  if stored_hash is not null and stored_hash = extensions.crypt(new_pw, stored_hash) then
    passed := passed + 1; rep := rep || 'PASS 3: the returned password verifies against the stored bcrypt hash. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 3: the returned password does NOT verify against what got stored.' || E'\n'; end if;

  -- ---------- Test 4: it never fell back to the ORIGINAL password ------------
  if stored_hash is not null and stored_hash != extensions.crypt('original-password', stored_hash) then
    passed := passed + 1; rep := rep || 'PASS 4: the ORIGINAL password no longer verifies — it was genuinely replaced. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 4: the original password still verifies — the hash was not actually changed.' || E'\n'; end if;

  -- ---------- Test 5: the reset is recorded (who / whom / when) --------------
  select count(*) into n from public.admin_password_resets where admin_id = admin_uid and target_user_id = target_uid;
  if n >= 1 then passed := passed + 1; rep := rep || 'PASS 5: the reset was recorded with the admin and target ids. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 5: no admin_password_resets row was written.' || E'\n'; end if;

  -- ---------- Test 6: a non-admin gets zero rows from both read RPCs ---------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', nonadmin_uid, 'role', 'authenticated')::text);
  select count(*) into n from public.admin_list_users();
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 6: a non-admin gets zero rows from admin_list_users(). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 6: non-admin saw %s users — CROSS-USER READ LEAK.', n) || E'\n'; end if;

  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', nonadmin_uid, 'role', 'authenticated')::text);
  select count(*) into n from public.admin_list_password_resets();
  execute 'reset role';
  if n = 0 then passed := passed + 1; rep := rep || 'PASS 7: a non-admin gets zero rows from admin_list_password_resets(). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 7: non-admin saw %s reset records — CROSS-USER READ LEAK.', n) || E'\n'; end if;

  -- ---------- Test 8: the real admin sees the test user + the test reset -----
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', admin_uid, 'role', 'authenticated')::text);
  select count(*) into n from public.admin_list_users() where id = target_uid;
  execute 'reset role';
  if n = 1 then passed := passed + 1; rep := rep || 'PASS 8: the admin sees the test user via admin_list_users(). ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 8: the admin RPC did not return the test user.' || E'\n'; end if;

  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', admin_uid, 'role', 'authenticated')::text);
  select count(*) into n from public.admin_list_password_resets() where target_email = 'admin-reset-target@test.invalid';
  execute 'reset role';
  if n >= 1 then passed := passed + 1; rep := rep || 'PASS 9: the admin sees the test reset via admin_list_password_resets(). ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 9: the admin RPC did not return the test reset record.' || E'\n'; end if;

  -- ---------- Test 10: resetting a user that doesn't exist is refused --------
  execute format('set local role authenticated; set local request.jwt.claims = %L', json_build_object('sub', admin_uid, 'role', 'authenticated')::text);
  begin
    perform public.admin_reset_user_password('00000000-0000-4000-8000-0000000fffff'::uuid);
    ok := true;
  exception when others then ok := false;
  end;
  execute 'reset role';
  if not ok then passed := passed + 1; rep := rep || 'PASS 10: resetting a non-existent user id is refused. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 10: resetting a non-existent user id was NOT refused.' || E'\n'; end if;

  raise exception E'\n=== admin_reset_password proof: % passed, % failed ===\n%', passed, failed, rep;
end $$;
