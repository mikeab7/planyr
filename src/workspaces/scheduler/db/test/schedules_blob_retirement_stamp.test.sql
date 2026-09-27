-- ============================================================================
-- B1927952 — schedules_blob_retirement_stamp.sql, AGAINST THE REAL DATABASE.
--
-- Self-rolling-back: everything runs inside one DO block, and a RAISE EXCEPTION at the end aborts
-- the whole transaction — every fixture row, every temporary flip of rows_authoritative, and every
-- write to the REAL owner's planar_data row are all discarded. Runs against the real owner (the
-- only real auth.users row) because schedule_account_index/schedules are one row PER OWNER and
-- schedules_stamp_retired_blob's whole job is per-owner.
--
-- ⛔ NOT RUN BY THE SESSION THAT WROTE THIS FILE — that session's dispatch was explicit
-- ("READ-ONLY on production; no writes ... to his data"), so this is shipped for a future session
-- or the owner to run via the Supabase MCP / SQL editor, not exercised here. See BACKLOG.md
-- B1927952 for that stated blocker.
--
-- Eight cases (0-7). Case 0 is a KNOWN-GOOD ARM (WRONG-CASE / DRIVER-SCROLL-IS-NOT-APP-SCROLL §6):
-- it asserts an answer true independently of the function under test, so a broken harness fails
-- there first.
--    0. KNOWN-GOOD ARM — a fresh throwaway planar_data row reads back what it was inserted with.
--    1. REFUSAL ON AN UNFLIPPED OWNER — calling schedules_stamp_retired_blob on an owner whose
--       rows_authoritative is false raises an exception; the real hs-v1 row is untouched.
--    2. THE STAMP — flip the owner (real schedule_account_index row); the real hs-v1 row's
--       `projects`/etc. are unchanged, `__rev` advances by exactly 1 (required by the PRE-EXISTING
--       planar_data_enforce_version_monotonic guard on this table — a write that doesn't advance
--       __rev is refused independently of this file's own bypass), and the two new keys read back
--       exactly (_retiredAt parses as a timestamp, _supersededBy = 'schedules').
--    3. IDEMPOTENT — calling it again returns the SAME value (same _retiredAt), not a fresh one.
--    4. NO BLOB FOR THIS OWNER — a throwaway owner scenario is not reachable (schedules/
--       schedule_account_index are one row per real auth.users row), so this is proven instead
--       against the real owner with the real hs-v1 row temporarily renamed out of the way inside
--       this same transaction (an UPDATE ... key = 'zz-stamp-test-moved', restored before rollback
--       regardless) — the function must return null, never throw, never insert a new row.
--    5. THE BYPASS IS SCOPED — with the owner flipped and the admin-stamp GUC NOT set, an ordinary
--       content-changing UPDATE to hs-v1 is still refused by planar_data_refuse_post_flip_write
--       (proves case 2's write went through BECAUSE of the function's own bypass, not because the
--       trigger stopped refusing writes generally).
--    6. THE ROLLBACK BYPASS STILL WORKS — planyr.schedule_blob_rollback (the ORIGINAL bypass) is
--       untouched by this file's addition of the second GUC; schedules_rollback_to_blob still
--       writes through it.
--    7. Real content restored to its ORIGINAL values (owner un-flipped, index rev/blob value put
--       back) before the final rollback, so the outer transaction abort is provably a no-op
--       belt-and-suspenders check, not the only thing protecting production.
--
-- HOW TO RUN: paste into the Supabase SQL editor, or via the Supabase MCP execute_sql tool.
--
-- HOW TO PROVE RED: comment out the `if not public.schedule_rows_authoritative(...)` guard in
-- schedules_stamp_retired_blob — case 1 must FAIL (no exception, the blob gets stamped anyway).
-- Comment out the `cur_value ? '_retiredAt'` early-return — case 3 must FAIL (a second, different
-- _retiredAt is written). Drop the `planyr.schedule_blob_admin_stamp` check from
-- planar_data_refuse_post_flip_write — case 2 must FAIL (the stamp write is refused, logged as a
-- suspicious post-flip write instead of landing).
-- ============================================================================
do $$
declare
  v_owner uuid;
  v_orig_index record;
  v_orig_blob jsonb;
  v_orig_blob_rev numeric;
  v_case0_key text := 'zz-stamp-test-known-good';
  v_case4_key text := 'zz-stamp-test-moved-hs-v1';
  v_result jsonb;
  v_result2 jsonb;
  v_failures text := '';
begin
  select id into v_owner from auth.users limit 1;
  if v_owner is null then
    raise exception 'no auth.users row found -- cannot run this proof';
  end if;

  select * into v_orig_index from public.schedule_account_index where user_id = v_owner;
  select value into v_orig_blob from public.planar_data where key = 'hs-v1' and user_id = v_owner;
  v_orig_blob_rev := coalesce(public.planar_data_rev_of(v_orig_blob), 0);

  -- CASE 0 — KNOWN-GOOD ARM.
  insert into public.planar_data (key, value, user_id) values (v_case0_key, '{"__rev":1,"projects":{}}'::jsonb, v_owner);
  if (select value->>'__rev' from public.planar_data where key = v_case0_key and user_id = v_owner) is distinct from '1' then
    v_failures := v_failures || 'CASE 0 (known-good arm) failed -- the harness itself is broken; ';
  end if;
  delete from public.planar_data where key = v_case0_key and user_id = v_owner;

  if v_orig_index.user_id is null then
    raise exception 'no schedule_account_index row for owner % -- cannot run cases 1-7 (this account has never run schedules_decompose_from_planar_data)', v_owner;
  end if;
  if v_orig_blob is null then
    raise exception 'no planar_data (key=hs-v1) row for owner % -- cannot run cases 1-7', v_owner;
  end if;

  -- CASE 1 — REFUSAL ON AN UNFLIPPED OWNER.
  update public.schedule_account_index set rows_authoritative = false, rev = rev + 1 where user_id = v_owner;
  begin
    perform public.schedules_stamp_retired_blob(v_owner);
    v_failures := v_failures || 'CASE 1 (unflipped refusal) failed -- no exception was raised; ';
  exception when others then
    if sqlerrm not like '%not rows_authoritative%' then
      v_failures := v_failures || format('CASE 1 raised the wrong error: %s; ', sqlerrm);
    end if;
  end;
  if (select value ? '_retiredAt' from public.planar_data where key = 'hs-v1' and user_id = v_owner) then
    v_failures := v_failures || 'CASE 1 failed -- the real hs-v1 row was stamped despite being unflipped; ';
  end if;

  -- CASE 2 — THE STAMP.
  update public.schedule_account_index set rows_authoritative = true, rev = rev + 1 where user_id = v_owner;
  v_result := public.schedules_stamp_retired_blob(v_owner);
  if v_result is null or not (v_result ? '_retiredAt') or v_result->>'_supersededBy' is distinct from 'schedules' then
    v_failures := v_failures || 'CASE 2 (the stamp) failed -- missing _retiredAt/_supersededBy in the return value; ';
  end if;
  if (v_result - '_retiredAt' - '_supersededBy' - '__rev') is distinct from (v_orig_blob - '__rev') then
    v_failures := v_failures || 'CASE 2 failed -- stamping changed a key besides _retiredAt/_supersededBy/__rev; ';
  end if;
  if coalesce((v_result->>'__rev')::numeric, 0) <> v_orig_blob_rev + 1 then
    v_failures := v_failures || format('CASE 2 failed -- __rev did not advance by exactly 1 (was %s, now %s); ', v_orig_blob_rev, v_result->>'__rev');
  end if;
  if (select value->>'_supersededBy' from public.planar_data where key = 'hs-v1' and user_id = v_owner) is distinct from 'schedules' then
    v_failures := v_failures || 'CASE 2 failed -- the real row was not actually updated; ';
  end if;

  -- CASE 3 — IDEMPOTENT.
  v_result2 := public.schedules_stamp_retired_blob(v_owner);
  if v_result2->>'_retiredAt' is distinct from v_result->>'_retiredAt' then
    v_failures := v_failures || 'CASE 3 (idempotent) failed -- a second call produced a DIFFERENT _retiredAt; ';
  end if;

  -- CASE 4 — NO BLOB FOR THIS OWNER (real hs-v1 row moved out of the way, restored unconditionally).
  update public.planar_data set key = v_case4_key where key = 'hs-v1' and user_id = v_owner;
  begin
    if public.schedules_stamp_retired_blob(v_owner) is not null then
      v_failures := v_failures || 'CASE 4 (no blob) failed -- expected null; ';
    end if;
  exception when others then
    v_failures := v_failures || format('CASE 4 raised unexpectedly: %s; ', sqlerrm);
  end;
  update public.planar_data set key = 'hs-v1' where key = v_case4_key and user_id = v_owner;
  if (select count(*) from public.planar_data where key = 'hs-v1' and user_id = v_owner) <> 1 then
    v_failures := v_failures || 'CASE 4 failed to restore the real hs-v1 row -- ABORTING before rollback is relied on alone; ';
    raise exception '%', v_failures;
  end if;

  -- CASE 5 — THE BYPASS IS SCOPED (owner still flipped from case 2; GUC not set here). The probe
  -- ALSO advances __rev, so this exercises specifically the FLIP-REFUSAL trigger, not the
  -- separate rev-CAS guard (which alphabetically runs first and would refuse an un-bumped write
  -- for an unrelated reason, masking what this case is meant to prove).
  begin
    update public.planar_data
      set value = (value || jsonb_build_object('probe', true))
                   || jsonb_build_object('__rev', coalesce(public.planar_data_rev_of(value), 0) + 1)
      where key = 'hs-v1' and user_id = v_owner;
    if (select value ? 'probe' from public.planar_data where key = 'hs-v1' and user_id = v_owner) then
      v_failures := v_failures || 'CASE 5 (bypass scoped) failed -- an ordinary, rev-advancing write landed on a flipped owner without the admin-stamp GUC; ';
    end if;
  exception when others then
    v_failures := v_failures || format('CASE 5 raised unexpectedly (expected a silent 0-row refusal, not an exception): %s; ', sqlerrm);
  end;

  -- CASE 6 — THE ROLLBACK BYPASS STILL WORKS. Also advances __rev — the rollback GUC bypasses
  -- ONLY planar_data_refuse_post_flip_write; the separate rev-CAS guard (planar_data_
  -- enforce_version_monotonic) is satisfied by an actual rev bump here, same as the real
  -- schedules_rollback_to_blob() does, never by a GUC.
  perform set_config('planyr.schedule_blob_rollback', '1', true);
  update public.planar_data
    set value = (value || jsonb_build_object('rollbackProbe', true))
                 || jsonb_build_object('__rev', coalesce(public.planar_data_rev_of(value), 0) + 1)
    where key = 'hs-v1' and user_id = v_owner;
  perform set_config('planyr.schedule_blob_rollback', '0', true);
  if not (select value ? 'rollbackProbe' from public.planar_data where key = 'hs-v1' and user_id = v_owner) then
    v_failures := v_failures || 'CASE 6 (rollback bypass) failed -- the original GUC no longer lets a write through; ';
  end if;

  -- CASE 7 — RESTORE REAL CONTENT before the final rollback (belt-and-suspenders, per convention).
  perform set_config('planyr.schedule_blob_rollback', '1', true);
  update public.planar_data
    set value = v_orig_blob || jsonb_build_object('__rev', coalesce(public.planar_data_rev_of(value), 0) + 1)
    where key = 'hs-v1' and user_id = v_owner;
  perform set_config('planyr.schedule_blob_rollback', '0', true);
  update public.schedule_account_index
    set rows_authoritative = v_orig_index.rows_authoritative, rev = v_orig_index.rev
    where user_id = v_owner;

  if v_failures <> '' then
    raise exception 'FAILURES: %', v_failures;
  end if;

  raise exception 'ALL 8 CHECKS PASSED (self-rolling-back — this exception discards every write above)';
end $$;
