-- ============================================================================
-- B1777120 — schedules_enforce_version_monotonic, AGAINST THE REAL DATABASE.
--
-- Same shape as db/test/planar_data_version_monotonic_guard.test.sql, adapted for a REAL
-- bigint `rev` column (schedules is a new table, so there's no legacy jsonb-embedded __rev
-- to mirror — see schedules_version_monotonic_guard.sql's own header for why).
--
-- THROWAWAY ids only (900000001+, far above any real pid this account will ever mint) — never
-- one of the owner's real schedule ids (1,2,3,5,6,7,15,22,24,30 as of B1777120). Self-rolling-
-- back: runs inside a DO block and raises an exception at the end carrying the report, so
-- every fixture row (including any client_errors telemetry row) is discarded.
--
-- Eight cases (0-7). Case 0 is a KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 /
-- WRONG-CASE): it asserts an answer true independently of the guard, so a run that "passes"
-- on a blind probe fails here first.
--    0. KNOWN-GOOD ARM — a fresh row reads back exactly what it was inserted with.
--    1. A well-behaved write with a strictly higher rev succeeds.
--    2. THE EXPLOIT — the exact TOCTOU race this item closes: an update whose rev EQUALS the
--       row's already-stored rev (two tabs computing the same "cloudRev + 1" from a stale
--       shared read) is REFUSED: zero rows affected, row left exactly as it was.
--    3. A write carrying a LOWER rev than stored is refused the same way.
--    4. LOUD-FAILURE — case 2's refusal logs exactly one public.client_errors row.
--    5. A metadata-only write (team_id changes, `data` byte-identical) succeeds without
--       needing to advance rev — the content-unchanged exemption.
--    6. A soft-delete (deleted_at set, `data` byte-identical) succeeds without needing to
--       advance rev — same exemption, the actual real-world case it exists for.
--    7. A rev jump of MORE than 1 is accepted, not just an exact +1.
--
-- HOW TO RUN: paste into the Supabase SQL editor, or via the Supabase MCP execute_sql tool.
--
-- HOW TO PROVE IT RED: `drop trigger schedules_enforce_version_monotonic on public.schedules;`
-- — cases 2 and 3 must FAIL (the stale writes land), and case 4 must FAIL (nothing is logged,
-- because nothing was refused). Cases 0, 1, 5, 6 and 7 must stay green — the guard's absence
-- must not break anything it was never guarding. Then re-apply
-- schedules_version_monotonic_guard.sql to restore it.
-- ============================================================================
do $$
declare
  id_sane   bigint := 900000001;
  id_cas    bigint := 900000002;
  id_race   bigint := 900000003;
  id_lower  bigint := 900000004;
  id_meta   bigint := 900000005;
  id_del    bigint := 900000006;
  id_jump   bigint := 900000007;
  owner_uid uuid;
  got_rev   bigint;
  got_data  jsonb;
  rows_matched int;
  tel_count int;
  rep       text := '';
  failed    int := 0;
begin
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'schedules version monotonic guard test: no auth user to hang the fixture off'; end if;

  -- ---- fixtures ---------------------------------------------------------------------------
  insert into public.schedules (id, user_id, name, data, rev) values
    (id_sane,  owner_uid, 'rlstest sane',  jsonb_build_object('tasks', jsonb_build_array()), 1),
    (id_cas,   owner_uid, 'rlstest cas',   jsonb_build_object('tasks', jsonb_build_array('a')), 5),
    (id_race,  owner_uid, 'rlstest race',  jsonb_build_object('tasks', jsonb_build_array('a')), 10),
    (id_lower, owner_uid, 'rlstest lower', jsonb_build_object('tasks', jsonb_build_array('orig')), 44),
    (id_meta,  owner_uid, 'rlstest meta',  jsonb_build_object('tasks', jsonb_build_array('x')), 9),
    (id_del,   owner_uid, 'rlstest del',   jsonb_build_object('tasks', jsonb_build_array('y')), 3),
    (id_jump,  owner_uid, 'rlstest jump',  jsonb_build_object('tasks', jsonb_build_array()), 1);

  -- ---- Case 0 — KNOWN-GOOD ARM: a fresh row reads back exactly what it was inserted with ---
  select rev into got_rev from public.schedules where id = id_sane;
  if got_rev is distinct from 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 0 (known-good arm): rev=%s (want 1) — the probe itself is broken', got_rev);
  end if;

  -- ---- Case 1 — a well-behaved write with a strictly higher rev succeeds -------------------
  update public.schedules set data = jsonb_build_object('tasks', jsonb_build_array('a','b')), rev = 6 where id = id_cas;
  select rev into got_rev from public.schedules where id = id_cas;
  if got_rev is distinct from 6 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 1: a well-behaved higher-rev write did not land — rev=%s (want 6)', got_rev);
  end if;

  -- ---- Case 2 — THE EXPLOIT: the TOCTOU race — new rev EQUALS the stored rev ---------------
  with u as (
    update public.schedules set data = jsonb_build_object('tasks', jsonb_build_array('a', 'stolen')), rev = 10 where id = id_race
    returning 1
  ) select count(*) into rows_matched from u;
  select data into got_data from public.schedules where id = id_race;
  if rows_matched <> 0 or (got_data->'tasks' ? 'stolen') then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 2 (THE EXPLOIT / TOCTOU race): matched %s row(s), data=%s (want 0 rows, no "stolen" entry)',
                         rows_matched, got_data);
  end if;

  -- ---- Case 3 — a write carrying a LOWER rev than stored is refused ------------------------
  with u as (
    update public.schedules set data = jsonb_build_object('tasks', jsonb_build_array()), rev = 43 where id = id_lower
    returning 1
  ) select count(*) into rows_matched from u;
  select rev into got_rev from public.schedules where id = id_lower;
  if rows_matched <> 0 or got_rev is distinct from 44 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 3 (lower rev): matched %s row(s), left rev=%s (want 0 rows / 44 — unchanged)', rows_matched, got_rev);
  end if;

  -- ---- Case 4 — LOUD-FAILURE: case 2's refusal logs exactly one client_errors row ----------
  select count(*) into tel_count from public.client_errors
   where source = 'event:schedules-version-guard-refused' and message like '%id=' || id_race || '%';
  if tel_count <> 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 4 (LOUD-FAILURE): %s client_errors row(s) logged for schedule %s''s refused write (want exactly 1)', tel_count, id_race);
  end if;

  -- ---- Case 5 — a metadata-only write (team_id, data untouched) succeeds, no rev bump owed -
  with u as (
    update public.schedules set team_id = null where id = id_meta
    returning 1
  ) select count(*) into rows_matched from u;
  select rev into got_rev from public.schedules where id = id_meta;
  if rows_matched <> 1 or got_rev is distinct from 9 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 5 (metadata-only, exempt): matched %s row(s), rev=%s (want 1 row / 9 — unbumped)', rows_matched, got_rev);
  end if;

  -- ---- Case 6 — a soft-delete (deleted_at set, data untouched) succeeds, no rev bump owed --
  with u as (
    update public.schedules set deleted_at = now() where id = id_del
    returning 1
  ) select count(*) into rows_matched from u;
  select rev into got_rev from public.schedules where id = id_del;
  if rows_matched <> 1 or got_rev is distinct from 3 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 6 (soft-delete, exempt): matched %s row(s), rev=%s (want 1 row / 3 — unbumped)', rows_matched, got_rev);
  end if;

  -- ---- Case 7 — a rev jump of MORE than 1 is accepted, not just an exact +1 ----------------
  with u as (
    update public.schedules set data = jsonb_build_object('tasks', jsonb_build_array('a')), rev = 50 where id = id_jump
    returning 1
  ) select count(*) into rows_matched from u;
  select rev into got_rev from public.schedules where id = id_jump;
  if rows_matched <> 1 or got_rev is distinct from 50 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 7 (rev jump > 1 accepted): matched %s row(s), rev=%s (want 1 row / 50)', rows_matched, got_rev);
  end if;

  if failed > 0 then
    raise exception E'schedules_enforce_version_monotonic: % of 8 checks FAILED%\n(fixtures rolled back)', failed, rep;
  end if;
  raise exception E'schedules_enforce_version_monotonic: ALL 8 CHECKS PASSED\n(fixtures rolled back)';
end $$;
