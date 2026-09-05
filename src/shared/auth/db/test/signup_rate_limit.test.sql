-- ============================================================================
-- Server-side signup rate limit proof (B1160721, NEW-2).
--
-- Proves, AGAINST THE REAL TRIGGER on auth.users:
--   1. Signups under the configured per-hour cap succeed normally.
--   2. The next signup once the cap is reached is BLOCKED (the insert fails, no row
--      created). (Blocked attempts are NOT expected to appear in signup_attempts_log —
--      see that table's own comment in signup_rate_limit.sql for why a BEFORE-trigger
--      RAISE can never leave a row behind from the same invocation; visibility for that
--      case comes from client_errors + Supabase's own Auth logs instead.)
--   3. MUTATION CHECK: raising the cap makes the identical, previously-blocked signup
--      succeed — proving the block is driven by the config value, not a hardcoded
--      always-block, and that the earlier "blocked" assertion would fail (a false
--      positive) if the enforcement code regressed to always letting rows through.
--   4. Disabling the limit (`enabled = false`, the one-statement reversal) lets a
--      signup through regardless of count, even against an impossible cap of 0.
--   5. FAIL-OPEN: with the config row entirely missing, a signup still succeeds —
--      a broken/missing config can never brick account creation.
--
-- The whole thing runs against the CURRENT real hour count (read as a baseline, never
-- assumed to be zero) so it is correct however many real signups happened in the last
-- hour, and is self-rolling-back: every dummy user, every config edit and every log row
-- is undone by the final RAISE EXCEPTION aborting the transaction. Run via the Supabase
-- MCP execute_sql tool and read the report out of the error message. Same shape as
-- problem_reports_rls.test.sql / comp_import_drafts_rls.test.sql.
-- ============================================================================
do $$
declare
  u1 uuid := '00000000-0000-4000-8000-0000000f1101';
  u2 uuid := '00000000-0000-4000-8000-0000000f1102';
  u3 uuid := '00000000-0000-4000-8000-0000000f1103';
  u4 uuid := '00000000-0000-4000-8000-0000000f1104';
  u5 uuid := '00000000-0000-4000-8000-0000000f1105';
  dom text := 'ratelimittest.invalid';
  base_hour int;
  n int;
  ok1 boolean; ok2 boolean; ok3 boolean; ok3b boolean; ok4 boolean; ok5 boolean;
  rep text := '';
  passed int := 0;
  failed int := 0;
begin
  select count(*) into base_hour from auth.users where created_at > now() - interval '1 hour';

  -- Isolate the HOUR limit: day limit set far out of reach so only the hour cap can trip.
  update public.signup_rate_limit_config
     set enabled = true, per_hour_limit = base_hour + 2, per_day_limit = 1000000, updated_at = now()
   where id = true;

  -- ---------- Test 1: two signups under the cap both succeed ------------------
  begin
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values (u1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u1@' || dom, now(), now());
    ok1 := true;
  exception when others then ok1 := false;
  end;
  begin
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u2@' || dom, now(), now());
    ok2 := true;
  exception when others then ok2 := false;
  end;
  if ok1 and ok2 then passed := passed + 1; rep := rep || 'PASS 1: two signups under the cap both succeed. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 1: expected both to succeed, got ok1=%s ok2=%s.', ok1, ok2) || E'\n'; end if;

  -- ---------- Test 2: the cap-reaching signup is BLOCKED -----------------------
  begin
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values (u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u3@' || dom, now(), now());
    ok3 := true;
  exception when others then ok3 := false;
  end;
  if not ok3 then passed := passed + 1; rep := rep || 'PASS 2: the signup that would exceed the hourly cap is blocked. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 2: a signup past the configured hourly cap was allowed through.' || E'\n'; end if;

  select count(*) into n from auth.users where id in (u1, u2, u3);
  if n = 2 then passed := passed + 1; rep := rep || 'PASS 3: exactly the 2 under-cap users exist; the blocked 3rd never landed a row. ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 3: expected 2 rows among u1..u3, found %s.', n) || E'\n'; end if;

  select count(*) into n from public.signup_attempts_log where email_domain = dom and outcome = 'created';
  if n = 2 then passed := passed + 1; rep := rep || 'PASS 4: both successful signups were logged (domain only, outcome created). ' || E'\n';
  else failed := failed + 1; rep := rep || format('FAIL 4: expected 2 created log rows for %s, found %s.', dom, n) || E'\n'; end if;

  -- ---------- Test 5: MUTATION CHECK — raising the cap lifts the block --------
  update public.signup_rate_limit_config set per_hour_limit = base_hour + 10, updated_at = now() where id = true;
  begin
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values (u3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u3@' || dom, now(), now());
    ok3b := true;
  exception when others then ok3b := false;
  end;
  if ok3b then passed := passed + 1; rep := rep || 'PASS 5 (mutation check): the SAME signup that was blocked now succeeds once the cap is raised — the block is config-driven, not a hardcoded refusal, so a regression that always-blocks OR never-blocks would show up here as the opposite of PASS 2. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 5: raising the cap did not lift the block — the earlier "PASS 2" assertion would be indistinguishable from a hardcoded always-block if this ever regresses.' || E'\n'; end if;

  -- ---------- Test 6: disabling the limit (the one-SQL-statement reversal) ----
  -- Force an impossible cap first (0/0), to prove it's the `enabled` flag doing the
  -- work, not merely still having room under a generous cap.
  update public.signup_rate_limit_config set enabled = false, per_hour_limit = 0, per_day_limit = 0, updated_at = now() where id = true;
  begin
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values (u4, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u4@' || dom, now(), now());
    ok4 := true;
  exception when others then ok4 := false;
  end;
  if ok4 then passed := passed + 1; rep := rep || 'PASS 6: with enabled=false (and an impossible cap of 0), a signup still succeeds — one UPDATE statement fully disables enforcement. ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 6: a signup was blocked even with enabled=false — the reversal is not actually one statement.' || E'\n'; end if;

  -- ---------- Test 7: FAIL-OPEN when the config row is missing entirely -------
  delete from public.signup_rate_limit_config where id = true;
  begin
    insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values (u5, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u5@' || dom, now(), now());
    ok5 := true;
  exception when others then ok5 := false;
  end;
  if ok5 then passed := passed + 1; rep := rep || 'PASS 7: with no config row at all, a signup still succeeds (fail-open — a broken config can never brick account creation). ' || E'\n';
  else failed := failed + 1; rep := rep || 'FAIL 7: a missing config row blocked a signup — this violates the "never lock Michael out" safety requirement.' || E'\n'; end if;

  raise exception E'\n=== signup_rate_limit proof: % passed, % failed (baseline hour count was %) ===\n%', passed, failed, base_hour, rep;
end $$;
