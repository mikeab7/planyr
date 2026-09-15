-- ============================================================================
-- NEW-1 — sites_enforce_version_monotonic, AGAINST THE REAL DATABASE.
--
-- Pins the fix for "a stale tab can silently overwrite a whole plan, and the version counter
-- can move backwards": public.sites has an integer `version` column
-- (db/optimistic_concurrency.sql) and a client-side conditional write
-- (shared/cloud/optimisticUpsert.js), but nothing at the DATABASE compared the incoming version
-- against the stored one — an UNCONDITIONAL update (an old cached bundle, a hand-built request)
-- could roll the counter backwards and silently clobber newer content. Reproduced live in a
-- rolled-back transaction against planyr_production, 2026-09-15, on a throwaway row: a legitimate
-- WHERE-guarded CAS save advanced version 1→2 and el-count 3→4; an UNCONDITIONAL write with no
-- version filter then landed cleanly, driving version back to 1 and el-count back to 3.
--
-- Ten cases (0-9). Case 0 is a KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 / WRONG-CASE):
-- it asserts an answer true independently of the guard, so a run that "passes" on a blind probe
-- fails here first.
--    0. KNOWN-GOOD ARM — an ordinary insert lands at whatever version it was given; sanity only.
--    1. A well-behaved WHERE-guarded CAS write (version = expected → expected+1) still succeeds.
--    2. THE EXPLOIT — an UNCONDITIONAL update (no version filter, version left at its stale
--       value) that changes `data` is REFUSED: zero rows affected, row left exactly as it was.
--    3. The exploit variant from the actual production symptom — a write that explicitly sets a
--       LOWER version than what is stored (44 → 43) is refused the same way.
--    4. An EQUAL version (a write that doesn't advance the counter at all) is refused too — a
--       tie loses, same convention as sites_preserve_rename_stamp.
--    5. LOUD-FAILURE — a refusal logs exactly one public.client_errors row naming the site.
--    6. A write that changes ONLY the mirrored `site` column (no `data` change) is held to the
--       same rule — refused without a version advance.
--    7. Soft delete (`deleted_at` only, no version bump) still succeeds — the deliberately
--       exempt path `cloudDelete`/`cloudDeleteGroup` depend on.
--    8. Restore (`deleted_at` cleared, no version bump) still succeeds, same exemption.
--    9. A write that jumps the version by MORE than 1 (a legitimate future repair/reconcile
--       shape) is accepted, not just an exact +1 — matches the file's own stated design.
--
-- HOW TO RUN: paste into the Supabase SQL editor, or via the Supabase MCP execute_sql tool. It is
-- SELF-ROLLING-BACK — it raises an exception carrying the report at the end, so every fixture row
-- (including any client_errors telemetry row) is discarded. It writes NOTHING that survives.
--
-- HOW TO PROVE IT RED: `drop trigger sites_enforce_version_monotonic on public.sites;` (or revert
-- the function body to `return new;` unconditionally) — cases 2, 3, 4 and 6 must FAIL (the stale
-- writes land), and case 5 must FAIL (nothing is logged, because nothing was refused). Cases 0, 1,
-- 7, 8 and 9 must stay green — the guard's absence must not break anything it was never guarding.
-- Confirmed red against the pre-fix schema (no such trigger) on 2026-09-15, in the ad hoc
-- rolled-back reproduction this file formalizes; re-confirmed by actually dropping the shipped
-- trigger and re-running this file before committing it.
-- ============================================================================
do $$
declare
  p_sane     text := 'zzvmg-sane';
  p_cas      text := 'zzvmg-cas-ok';
  p_uncond   text := 'zzvmg-unconditional';
  p_lower    text := 'zzvmg-lower-version';
  p_equal    text := 'zzvmg-equal-version';
  p_siteonly text := 'zzvmg-site-only';
  p_soft     text := 'zzvmg-soft-delete';
  p_restore  text := 'zzvmg-restore';
  p_jump     text := 'zzvmg-version-jump';
  owner_uid  uuid;
  got_version int;
  got_els    int;
  got_site   text;
  got_deleted boolean;
  rows_matched int;
  tel_count  int;
  rep        text := '';
  failed     int := 0;
begin
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'version monotonic guard test: no auth user to hang the fixture off'; end if;

  -- ---- fixtures ---------------------------------------------------------------------------
  insert into public.sites (id, user_id, site, name, county, data, version) values
    (p_sane,     owner_uid, 'Sane',     'Sane',     'harris', jsonb_build_object('id', p_sane,     'els', jsonb_build_array()), 1),
    (p_cas,      owner_uid, 'Cas',      'Cas',      'harris', jsonb_build_object('id', p_cas,      'els', jsonb_build_array('a','b','c')), 5),
    (p_uncond,   owner_uid, 'Uncond',   'Uncond',   'harris', jsonb_build_object('id', p_uncond,   'els', jsonb_build_array('a','b','c','d')), 2),
    (p_lower,    owner_uid, 'Lower',    'Lower',    'harris', jsonb_build_object('id', p_lower,    'els', jsonb_build_array('a','b','c')), 44),
    (p_equal,    owner_uid, 'Equal',    'Equal',    'harris', jsonb_build_object('id', p_equal,    'els', jsonb_build_array('a')), 7),
    (p_siteonly, owner_uid, 'Original', 'Original', 'harris', jsonb_build_object('id', p_siteonly, 'els', jsonb_build_array()), 3),
    (p_soft,     owner_uid, 'Soft',     'Soft',     'harris', jsonb_build_object('id', p_soft,     'els', jsonb_build_array('a')), 9),
    (p_restore,  owner_uid, 'Restore',  'Restore',  'harris', jsonb_build_object('id', p_restore,  'els', jsonb_build_array('a')), 9),
    (p_jump,     owner_uid, 'Jump',     'Jump',     'harris', jsonb_build_object('id', p_jump,     'els', jsonb_build_array('a')), 1);
  update public.sites set deleted_at = now() where id = p_restore; -- pre-deleted, for case 8's restore

  -- ---- Case 0 — KNOWN-GOOD ARM: a fresh row reads back exactly what it was inserted with -----
  select version, jsonb_array_length(data->'els') into got_version, got_els from public.sites where id = p_sane;
  if got_version is distinct from 1 or got_els is distinct from 0 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 0 (known-good arm): version=%s els=%s (want 1/0) — the probe itself is broken', got_version, got_els);
  end if;

  -- ---- Case 1 — a well-behaved WHERE-guarded CAS write still succeeds ------------------------
  update public.sites set data = jsonb_build_object('id', p_cas, 'els', jsonb_build_array('a','b','c','d')), version = 5 + 1
   where id = p_cas and version = 5;
  select version, jsonb_array_length(data->'els') into got_version, got_els from public.sites where id = p_cas;
  if got_version is distinct from 6 or got_els is distinct from 4 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 1: a well-behaved CAS write did not land — version=%s els=%s (want 6/4)', got_version, got_els);
  end if;

  -- ---- Case 2 — THE EXPLOIT: an UNCONDITIONAL write (no version filter, stale version) --------
  with u as (
    update public.sites set data = jsonb_build_object('id', p_uncond, 'els', jsonb_build_array('a','b','c')), version = 2
     where id = p_uncond
    returning 1
  ) select count(*) into rows_matched from u;
  select version, jsonb_array_length(data->'els') into got_version, got_els from public.sites where id = p_uncond;
  if rows_matched <> 0 or got_version is distinct from 2 or got_els is distinct from 4 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 2 (THE EXPLOIT): unconditional stale write matched %s row(s), left version=%s els=%s (want 0 rows / 2 / 4 — unchanged)',
                         rows_matched, got_version, got_els);
  end if;

  -- ---- Case 3 — the production symptom shape: an explicit LOWER version (44 -> 43) ------------
  with u as (
    update public.sites set data = jsonb_build_object('id', p_lower, 'els', jsonb_build_array()), version = 43
     where id = p_lower
    returning 1
  ) select count(*) into rows_matched from u;
  select version, jsonb_array_length(data->'els') into got_version, got_els from public.sites where id = p_lower;
  if rows_matched <> 0 or got_version is distinct from 44 or got_els is distinct from 3 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 3 (44->43 shape): matched %s row(s), left version=%s els=%s (want 0 rows / 44 / 3 — unchanged)',
                         rows_matched, got_version, got_els);
  end if;

  -- ---- Case 4 — an EQUAL version (no advance at all) is refused too, a tie loses --------------
  with u as (
    update public.sites set data = jsonb_build_object('id', p_equal, 'els', jsonb_build_array('a','x')), version = 7
     where id = p_equal
    returning 1
  ) select count(*) into rows_matched from u;
  select version, jsonb_array_length(data->'els') into got_version, got_els from public.sites where id = p_equal;
  if rows_matched <> 0 or got_version is distinct from 7 or got_els is distinct from 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 4 (equal version): matched %s row(s), left version=%s els=%s (want 0 rows / 7 / 1 — unchanged)',
                         rows_matched, got_version, got_els);
  end if;

  -- ---- Case 5 — LOUD-FAILURE: a refusal logs exactly one client_errors row --------------------
  select count(*) into tel_count from public.client_errors
   where source = 'event:version-guard-refused' and message like '%' || p_uncond || '%';
  if tel_count <> 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 5 (LOUD-FAILURE): %s client_errors row(s) logged for %s''s refused write (want exactly 1)', tel_count, p_uncond);
  end if;

  -- ---- Case 6 — a write that changes ONLY the mirrored `site` column, version unchanged -------
  with u as (
    update public.sites set site = 'Attacker Name' where id = p_siteonly
    returning 1
  ) select count(*) into rows_matched from u;
  select site, version into got_site, got_version from public.sites where id = p_siteonly;
  if rows_matched <> 0 or got_site is distinct from 'Original' or got_version is distinct from 3 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 6 (site-only write): matched %s row(s), left site=%s version=%s (want 0 rows / Original / 3 — unchanged)',
                         rows_matched, got_site, got_version);
  end if;

  -- ---- Case 7 — soft delete (deleted_at only) succeeds WITHOUT a version bump -----------------
  with u as (
    update public.sites set deleted_at = now() where id = p_soft
    returning 1
  ) select count(*) into rows_matched from u;
  select version, (deleted_at is not null) into got_version, got_deleted from public.sites where id = p_soft;
  if rows_matched <> 1 or not got_deleted or got_version is distinct from 9 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 7 (soft delete exempt): matched %s row(s), deleted=%s version=%s (want 1 row / true / 9 — unbumped)',
                         rows_matched, got_deleted, got_version);
  end if;

  -- ---- Case 8 — restore (deleted_at cleared) succeeds WITHOUT a version bump ------------------
  with u as (
    update public.sites set deleted_at = null where id = p_restore
    returning 1
  ) select count(*) into rows_matched from u;
  select version, (deleted_at is not null) into got_version, got_deleted from public.sites where id = p_restore;
  if rows_matched <> 1 or got_deleted or got_version is distinct from 9 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 8 (restore exempt): matched %s row(s), deleted=%s version=%s (want 1 row / false / 9 — unbumped)',
                         rows_matched, got_deleted, got_version);
  end if;

  -- ---- Case 9 — a version jump of MORE than 1 is accepted, not just an exact +1 ---------------
  with u as (
    update public.sites set data = jsonb_build_object('id', p_jump, 'els', jsonb_build_array('a','b')), version = 50
     where id = p_jump
    returning 1
  ) select count(*) into rows_matched from u;
  select version, jsonb_array_length(data->'els') into got_version, got_els from public.sites where id = p_jump;
  if rows_matched <> 1 or got_version is distinct from 50 or got_els is distinct from 2 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 9 (version jump > 1 accepted): matched %s row(s), left version=%s els=%s (want 1 row / 50 / 2)',
                         rows_matched, got_version, got_els);
  end if;

  if failed > 0 then
    raise exception E'sites_enforce_version_monotonic: % of 10 checks FAILED%\n(fixtures rolled back)', failed, rep;
  end if;
  raise exception E'sites_enforce_version_monotonic: ALL 10 CHECKS PASSED\n(fixtures rolled back)';
end $$;
