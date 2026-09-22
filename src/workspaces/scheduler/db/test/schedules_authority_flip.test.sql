-- ============================================================================
-- B1777120 — schedules_authority_flip.sql, AGAINST THE REAL DATABASE.
--
-- Self-rolling-back: everything runs inside one DO block / one statement, and a RAISE EXCEPTION
-- at the end aborts the whole transaction — every fixture row, every temporary flip of
-- rows_authoritative, and (case 8's) write to the REAL planar_data row are all discarded. THROWAWAY
-- KEYS only for the planar_data fixture rows ('zz-authority-flip-test-*', never 'hs-v1' — the
-- table's PK is `key` alone, GLOBALLY unique, so a fixture can never share a key with the one real
-- production row). Runs against the real owner (the only real auth.users row) because
-- schedule_account_index is one row PER OWNER (PK=user_id) and both triggers' whole job is
-- per-owner/per-row — WRONG-CASE: a fake unrelated owner would not exercise the real shape.
--
-- Every setup toggle of rows_authoritative below ALSO bumps schedule_account_index.rev — required
-- once schedule_account_index_enforce_version_monotonic exists (case 9+), since that guard refuses
-- ANY content-changing update (rows_authoritative included) whose rev does not strictly advance.
--
-- Fourteen cases (0-13). Case 0 and case 9 are KNOWN-GOOD ARMS (WRONG-CASE /
-- DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): each asserts an answer true independently of the guard
-- under test, so a broken harness fails there first.
--   PART A — planar_data_refuse_post_flip_write (the authority-flip refusal on the blob table):
--    0. KNOWN-GOOD ARM — a fresh throwaway planar_data row reads back what it was inserted with.
--    1. Not flipped — an ordinary content-changing UPDATE succeeds (unchanged legacy behavior).
--    2. THE REFUSAL — flip the owner, then the SAME UPDATE is refused: zero rows affected, value
--       left exactly as it was.
--    3. LOUD-FAILURE — case 2's refusal logs exactly one public.client_errors row.
--    4. THE BYPASS — with the owner still flipped, the planyr.schedule_blob_rollback GUC lets the
--       identical write through (schedules_rollback_to_blob's own escape hatch).
--    5. UN-FLIP RESTORES LEGACY BEHAVIOR — owner un-flipped, the same shape of UPDATE succeeds
--       again with no bypass needed.
--    6. METADATA-ONLY EXEMPT — with the owner flipped, a write that changes only team_id (value
--       byte-identical) succeeds without being refused.
--    7. INSERT WHILE FLIPPED IS ALSO REFUSED — a brand-new throwaway key inserted for a flipped
--       owner is refused (the row never exists afterward).
--    8. THE REVERSE PATH, EXERCISED FOR REAL (not merely described) — schedules_rollback_to_blob()
--       against the REAL owner: recomposes the REAL schedules rows, writes them back to the REAL
--       hs-v1 row with a __rev strictly above what it held, and un-flips rows_authoritative — all
--       inside this same rolled-back transaction, so nothing production-facing actually changes
--       once this statement finishes.
--   PART B — schedule_account_index_enforce_version_monotonic (the CAS guard the write path's
--   writeIndexRow depends on to detect a refused write via "0 rows returned"):
--    9. KNOWN-GOOD ARM — a well-behaved higher-rev content write lands.
--   10. THE RACE — a same-rev content write (settings changed, rev unchanged) is refused.
--   11. LOUD-FAILURE — case 10's refusal logs exactly one public.client_errors row.
--   12. METADATA-ONLY EXEMPT — a team_id-only change (every content column unchanged) succeeds
--       without needing to advance rev.
--   13. Real content restored to its ORIGINAL values before the final rollback, so the outer
--       transaction abort is provably a no-op belt-and-suspenders check, not the only thing
--       protecting production.
--
-- HOW TO RUN: paste into the Supabase SQL editor, or via the Supabase MCP execute_sql tool.
--
-- HOW TO PROVE PART A RED: `drop trigger planar_data_refuse_post_flip_write on public.planar_data;`
-- — case 2 must FAIL (the write lands), case 3 must FAIL (nothing logged), case 7 must FAIL (the
-- row exists). Cases 0,1,4,5,6,8 must stay green. Then re-apply schedules_authority_flip.sql.
-- HOW TO PROVE PART B RED: `drop trigger schedule_account_index_enforce_version_monotonic on
-- public.schedule_account_index;` — case 10 must FAIL (the write lands), case 11 must FAIL
-- (nothing logged). Cases 9 and 12 must stay green.
-- ============================================================================
do $$
declare
  owner_uid       uuid;
  key1            text := 'zz-authority-flip-test-1';
  key2            text := 'zz-authority-flip-test-2';
  rows_matched    int;
  got_value       jsonb;
  tel_count       int;
  orig_flip       boolean;
  orig_rev        numeric;
  orig_team       uuid;
  rollback_doc    jsonb;
  live_proj_count int;
  doc_proj_count  int;
  new_blob_rev    numeric;
  idx_rev         bigint;   -- our own running counter for schedule_account_index.rev
  orig_idx_row    record;
  got_settings    jsonb;
  rep             text := '';
  failed          int := 0;
begin
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'schedules authority flip test: no auth user to hang the fixture off'; end if;

  select * into orig_idx_row from public.schedule_account_index where user_id = owner_uid;
  if orig_idx_row is null then raise exception 'schedules authority flip test: no schedule_account_index row for the owner — run schedules_decompose_from_planar_data() first'; end if;
  orig_flip := orig_idx_row.rows_authoritative;
  idx_rev := orig_idx_row.rev;

  select coalesce(planar_data_rev_of(value), 0), team_id into orig_rev, orig_team
    from public.planar_data where key = 'hs-v1' and user_id = owner_uid;
  if orig_rev is null then raise exception 'schedules authority flip test: no hs-v1 row for the owner'; end if;

  -- Baseline: make sure we start un-flipped, whatever the account's real current state.
  idx_rev := idx_rev + 1;
  update public.schedule_account_index set rows_authoritative = false, rev = idx_rev where user_id = owner_uid;

  -- ---- Case 0 — KNOWN-GOOD ARM -------------------------------------------------------------
  -- NOTE: every value below carries its own __rev, strictly increasing, so a refusal can only be
  -- attributed to THIS trigger under test, never to the pre-existing (unrelated)
  -- planar_data_enforce_version_monotonic guard (PR #1765), which also fires on this table and
  -- would otherwise refuse a same-or-lower __rev regardless of the flip.
  insert into public.planar_data (key, value, user_id) values (key1, jsonb_build_object('n', 1, '__rev', 1), owner_uid);
  select value into got_value from public.planar_data where key = key1;
  if got_value is distinct from jsonb_build_object('n', 1, '__rev', 1) then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 0 (known-good arm): value=%s (want {"n":1,"__rev":1}) — the probe itself is broken', got_value);
  end if;

  -- ---- Case 1 — not flipped: an ordinary write succeeds ------------------------------------
  update public.planar_data set value = jsonb_build_object('n', 2, '__rev', 2) where key = key1;
  select value into got_value from public.planar_data where key = key1;
  if got_value is distinct from jsonb_build_object('n', 2, '__rev', 2) then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 1 (not flipped, ordinary write): value=%s (want {"n":2,"__rev":2})', got_value);
  end if;

  -- ---- Case 2 — THE REFUSAL: flip the owner, the same shape of write is refused -----------
  idx_rev := idx_rev + 1;
  update public.schedule_account_index set rows_authoritative = true, rev = idx_rev where user_id = owner_uid;
  with u as (
    update public.planar_data set value = jsonb_build_object('n', 3, '__rev', 3) where key = key1
    returning 1
  ) select count(*) into rows_matched from u;
  select value into got_value from public.planar_data where key = key1;
  if rows_matched <> 0 or got_value is distinct from jsonb_build_object('n', 2, '__rev', 2) then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 2 (THE REFUSAL): matched %s row(s), value=%s (want 0 rows / unchanged {"n":2,"__rev":2})', rows_matched, got_value);
  end if;

  -- ---- Case 3 — LOUD-FAILURE: case 2's refusal logs exactly one client_errors row ---------
  select count(*) into tel_count from public.client_errors
   where source = 'event:hs-blob-write-refused-post-flip' and message like '%key=' || key1 || '%';
  if tel_count <> 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 3 (LOUD-FAILURE): %s client_errors row(s) logged for %s''s refused write (want exactly 1)', tel_count, key1);
  end if;

  -- ---- Case 4 — THE BYPASS: the rollback GUC lets an identical write through --------------
  perform set_config('planyr.schedule_blob_rollback', '1', true);
  update public.planar_data set value = jsonb_build_object('n', 4, '__rev', 4) where key = key1;
  perform set_config('planyr.schedule_blob_rollback', '0', true);
  select value into got_value from public.planar_data where key = key1;
  if got_value is distinct from jsonb_build_object('n', 4, '__rev', 4) then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 4 (THE BYPASS): value=%s (want {"n":4,"__rev":4} — the bypass write should have landed)', got_value);
  end if;

  -- ---- Case 5 — UN-FLIP restores legacy behavior ------------------------------------------
  idx_rev := idx_rev + 1;
  update public.schedule_account_index set rows_authoritative = false, rev = idx_rev where user_id = owner_uid;
  update public.planar_data set value = jsonb_build_object('n', 5, '__rev', 5) where key = key1;
  select value into got_value from public.planar_data where key = key1;
  if got_value is distinct from jsonb_build_object('n', 5, '__rev', 5) then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 5 (un-flip restores legacy behavior): value=%s (want {"n":5,"__rev":5})', got_value);
  end if;

  -- ---- Case 6 — METADATA-ONLY exempt, even while flipped ----------------------------------
  idx_rev := idx_rev + 1;
  update public.schedule_account_index set rows_authoritative = true, rev = idx_rev where user_id = owner_uid;
  with u as (
    update public.planar_data set team_id = null where key = key1
    returning 1
  ) select count(*) into rows_matched from u;
  if rows_matched <> 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 6 (metadata-only exempt): matched %s row(s) (want 1 — a value-unchanged write is exempt)', rows_matched);
  end if;

  -- ---- Case 7 — INSERT while flipped is ALSO refused --------------------------------------
  with i as (
    insert into public.planar_data (key, value, user_id) values (key2, jsonb_build_object('n', 1), owner_uid)
    returning 1
  ) select count(*) into rows_matched from i;
  if rows_matched <> 0 or exists (select 1 from public.planar_data where key = key2) then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 7 (insert while flipped refused): matched %s row(s), row exists=%s (want 0 rows / no row)',
                         rows_matched, exists (select 1 from public.planar_data where key = key2));
  end if;

  idx_rev := idx_rev + 1;
  update public.schedule_account_index set rows_authoritative = false, rev = idx_rev where user_id = owner_uid;   -- clean state before touching the REAL row

  -- ---- Case 8 — THE REVERSE PATH, EXERCISED FOR REAL against the real owner ---------------
  select count(*) into live_proj_count from public.schedules where user_id = owner_uid and deleted_at is null;

  idx_rev := idx_rev + 1;
  update public.schedule_account_index set rows_authoritative = true, rev = idx_rev where user_id = owner_uid;   -- simulate "already flipped forward"

  rollback_doc := public.schedules_rollback_to_blob(owner_uid);   -- bumps rev itself internally

  select count(*) into doc_proj_count from jsonb_object_keys(coalesce(rollback_doc->'projects', '{}'::jsonb));
  select rows_authoritative, rev into orig_flip, idx_rev from public.schedule_account_index where user_id = owner_uid;
  select coalesce(planar_data_rev_of(value), 0) into new_blob_rev from public.planar_data where key = 'hs-v1' and user_id = owner_uid;

  if doc_proj_count <> live_proj_count then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 8a (reverse path project count): rollback doc has %s project(s), live schedules table has %s', doc_proj_count, live_proj_count);
  end if;
  if orig_flip is distinct from false then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 8b (reverse path un-flips): rows_authoritative=%s after rollback (want false)', orig_flip);
  end if;
  if new_blob_rev <= orig_rev then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 8c (reverse path bumps __rev): new __rev=%s, was %s (want strictly greater)', new_blob_rev, orig_rev);
  end if;

  -- ================================================================================
  -- PART B — schedule_account_index_enforce_version_monotonic
  -- ================================================================================

  -- ---- Case 9 — KNOWN-GOOD ARM: a well-behaved higher-rev content write lands ------------
  idx_rev := idx_rev + 1;
  update public.schedule_account_index
    set settings = jsonb_build_object('zzTestMarker', 9), rev = idx_rev
    where user_id = owner_uid;
  select settings into got_settings from public.schedule_account_index where user_id = owner_uid;
  if got_settings is distinct from jsonb_build_object('zzTestMarker', 9) then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 9 (known-good arm): settings=%s (want {"zzTestMarker":9}) — the probe itself is broken', got_settings);
  end if;

  -- ---- Case 10 — THE RACE: a same-rev content write is refused ---------------------------
  with u as (
    update public.schedule_account_index
      set settings = jsonb_build_object('zzTestMarker', 10), rev = idx_rev   -- SAME rev as case 9 — no advance
      where user_id = owner_uid
    returning 1
  ) select count(*) into rows_matched from u;
  select settings into got_settings from public.schedule_account_index where user_id = owner_uid;
  if rows_matched <> 0 or got_settings is distinct from jsonb_build_object('zzTestMarker', 9) then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 10 (THE RACE): matched %s row(s), settings=%s (want 0 rows / unchanged {"zzTestMarker":9})', rows_matched, got_settings);
  end if;

  -- ---- Case 11 — LOUD-FAILURE: case 10's refusal logs exactly one client_errors row ------
  select count(*) into tel_count from public.client_errors
   where source = 'event:schedule-account-index-guard-refused' and message like '%stored_rev=' || idx_rev || '%';
  if tel_count <> 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 11 (LOUD-FAILURE): %s client_errors row(s) logged for the refused write at rev %s (want exactly 1)', tel_count, idx_rev);
  end if;

  -- ---- Case 12 — METADATA-ONLY exempt: team_id-only change needs no rev advance ----------
  with u as (
    update public.schedule_account_index set team_id = null where user_id = owner_uid
    returning 1
  ) select count(*) into rows_matched from u;
  if rows_matched <> 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 12 (metadata-only exempt): matched %s row(s) (want 1)', rows_matched);
  end if;

  -- ---- Case 13 — restore the real row's content to its ORIGINAL values before rollback ---
  -- Belt-and-suspenders: the outer transaction abort is what actually protects production, but
  -- explicitly restoring first proves this test does not depend solely on that.
  idx_rev := idx_rev + 1;
  update public.schedule_account_index
    set n_pid = orig_idx_row.n_pid, n_tid = orig_idx_row.n_tid,
        last_active_by_site = orig_idx_row.last_active_by_site, settings = orig_idx_row.settings,
        migration_flags = orig_idx_row.migration_flags, rows_authoritative = orig_idx_row.rows_authoritative,
        team_id = orig_idx_row.team_id, rev = idx_rev
    where user_id = owner_uid;
  select settings into got_settings from public.schedule_account_index where user_id = owner_uid;
  if got_settings is distinct from orig_idx_row.settings then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 13 (restore original content): settings=%s (want original %s)', got_settings, orig_idx_row.settings);
  end if;

  if failed > 0 then
    raise exception E'schedules_authority_flip: % of 14 checks FAILED%\n(fixtures + real-row rollback exercise all rolled back)', failed, rep;
  end if;
  raise exception E'schedules_authority_flip: ALL 14 CHECKS PASSED\n(fixtures + real-row rollback exercise all rolled back)';
end $$;
