-- ============================================================================
-- B1629618 — planar_data_enforce_version_monotonic, AGAINST THE REAL DATABASE.
--
-- Pins the fix for "a stale tab can silently overwrite every schedule in the account, and the
-- __rev counter can collide without ever going backwards": public.planar_data embeds a revision
-- token inside its jsonb (value->>'__rev'), and the client (public/sequence/index.html's
-- `_rawSet`) already reads-then-writes against it, but nothing at the DATABASE compared the
-- incoming rev against the stored one before this item. Every fixture here uses THROWAWAY keys
-- (zzpdvmg-*) — never 'hs-v1', the owner's one real schedule document — per B822 (a live check
-- runs on a throwaway duplicate, never one of Michael's real rows), and there is only ONE real row
-- for the whole account, so there is no "duplicate plan" to test against here at all.
--
-- Ten cases (0-9). Case 0 is a KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 / WRONG-CASE):
-- it asserts an answer true independently of the guard, so a run that "passes" on a blind probe
-- fails here first.
--    0. KNOWN-GOOD ARM — a fresh row reads back exactly what it was inserted with.
--    1. A well-behaved write with a strictly higher __rev succeeds.
--    2. THE EXPLOIT — the exact TOCTOU race this item closes: an unconditional write whose __rev
--       EQUALS the row's already-stored __rev (two tabs computing the same "cloudRev + 1" from a
--       stale shared read) is REFUSED: zero rows affected, row left exactly as it was.
--    3. A write carrying a LOWER __rev than stored is refused the same way.
--    4. NEW.value has NO __rev at all — treated as 0, refused against any existing positive rev.
--    5. NEW.value's __rev is a JSON STRING, not a number — treated as 0 (non-numeric), refused.
--    6. OLD.value has NO __rev at all (a hypothetical pre-migration row) — treated as 0, so a
--       write carrying __rev:1 succeeds.
--    7. LOUD-FAILURE — a refusal (case 2) logs exactly one public.client_errors row.
--    8. A write that changes NO content at all (value byte-identical; only user_id re-affirmed)
--       succeeds without needing to advance __rev — the metadata-only exemption.
--    9. A __rev jump of MORE than 1 is accepted, not just an exact +1.
--
-- HOW TO RUN: paste into the Supabase SQL editor, or via the Supabase MCP execute_sql tool. It is
-- SELF-ROLLING-BACK — it raises an exception carrying the report at the end, so every fixture row
-- (including any client_errors telemetry row) is discarded. It writes NOTHING that survives.
--
-- HOW TO PROVE IT RED: `drop trigger planar_data_enforce_version_monotonic on public.planar_data;`
-- — cases 2, 3, 4 and 5 must FAIL (the stale/malformed writes land), and case 7 must FAIL (nothing
-- is logged, because nothing was refused). Cases 0, 1, 6, 8 and 9 must stay green — the guard's
-- absence must not break anything it was never guarding.
-- ============================================================================
do $$
declare
  p_sane     text := 'zzpdvmg-sane';
  p_cas      text := 'zzpdvmg-cas-ok';
  p_race     text := 'zzpdvmg-toctou-race';
  p_lower    text := 'zzpdvmg-lower-rev';
  p_norev    text := 'zzpdvmg-new-no-rev';
  p_strrev   text := 'zzpdvmg-new-string-rev';
  p_oldnorev text := 'zzpdvmg-old-no-rev';
  p_meta     text := 'zzpdvmg-metadata-only';
  p_jump     text := 'zzpdvmg-rev-jump';
  owner_uid  uuid;
  got_rev    numeric;
  got_val    jsonb;
  rows_matched int;
  tel_count  int;
  rep        text := '';
  failed     int := 0;
begin
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'planar_data version monotonic guard test: no auth user to hang the fixture off'; end if;

  -- ---- fixtures ---------------------------------------------------------------------------
  insert into public.planar_data (key, value, user_id) values
    (p_sane,     jsonb_build_object('__rev', 1, 'projects', jsonb_build_object()), owner_uid),
    (p_cas,      jsonb_build_object('__rev', 5, 'projects', jsonb_build_object('a', 1)), owner_uid),
    (p_race,     jsonb_build_object('__rev', 10, 'projects', jsonb_build_object('a', 1)), owner_uid),
    (p_lower,    jsonb_build_object('__rev', 44, 'projects', jsonb_build_object()), owner_uid),
    (p_norev,    jsonb_build_object('__rev', 8, 'projects', jsonb_build_object()), owner_uid),
    (p_strrev,   jsonb_build_object('__rev', 3, 'projects', jsonb_build_object()), owner_uid),
    (p_oldnorev, jsonb_build_object('projects', jsonb_build_object()), owner_uid),  -- no __rev key at all
    (p_meta,     jsonb_build_object('__rev', 9, 'projects', jsonb_build_object('x', 1)), owner_uid),
    (p_jump,     jsonb_build_object('__rev', 1, 'projects', jsonb_build_object()), owner_uid);

  -- ---- Case 0 — KNOWN-GOOD ARM: a fresh row reads back exactly what it was inserted with -----
  select (value->>'__rev')::numeric into got_rev from public.planar_data where key = p_sane;
  if got_rev is distinct from 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 0 (known-good arm): rev=%s (want 1) — the probe itself is broken', got_rev);
  end if;

  -- ---- Case 1 — a well-behaved write with a strictly higher rev succeeds ---------------------
  update public.planar_data set value = jsonb_build_object('__rev', 6, 'projects', jsonb_build_object('a', 1, 'b', 2)) where key = p_cas;
  select (value->>'__rev')::numeric into got_rev from public.planar_data where key = p_cas;
  if got_rev is distinct from 6 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 1: a well-behaved higher-rev write did not land — rev=%s (want 6)', got_rev);
  end if;

  -- ---- Case 2 — THE EXPLOIT: the TOCTOU race — new rev EQUALS the stored rev -----------------
  with u as (
    update public.planar_data set value = jsonb_build_object('__rev', 10, 'projects', jsonb_build_object('a', 1, 'stolen', true)) where key = p_race
    returning 1
  ) select count(*) into rows_matched from u;
  select value into got_val from public.planar_data where key = p_race;
  if rows_matched <> 0 or (got_val ? 'stolen') then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 2 (THE EXPLOIT / TOCTOU race): matched %s row(s), value=%s (want 0 rows, no "stolen" key — the race write must be refused)',
                         rows_matched, got_val);
  end if;

  -- ---- Case 3 — a write carrying a LOWER rev than stored is refused --------------------------
  with u as (
    update public.planar_data set value = jsonb_build_object('__rev', 43, 'projects', jsonb_build_object()) where key = p_lower
    returning 1
  ) select count(*) into rows_matched from u;
  select (value->>'__rev')::numeric into got_rev from public.planar_data where key = p_lower;
  if rows_matched <> 0 or got_rev is distinct from 44 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 3 (lower rev): matched %s row(s), left rev=%s (want 0 rows / 44 — unchanged)', rows_matched, got_rev);
  end if;

  -- ---- Case 4 — NEW.value has NO __rev at all — treated as 0, refused ------------------------
  with u as (
    update public.planar_data set value = jsonb_build_object('projects', jsonb_build_object('hacked', true)) where key = p_norev
    returning 1
  ) select count(*) into rows_matched from u;
  select (value->>'__rev')::numeric into got_rev from public.planar_data where key = p_norev;
  if rows_matched <> 0 or got_rev is distinct from 8 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 4 (new value missing __rev): matched %s row(s), left rev=%s (want 0 rows / 8 — unchanged)', rows_matched, got_rev);
  end if;

  -- ---- Case 5 — NEW.value's __rev is a STRING, not a number — treated as 0, refused ----------
  with u as (
    update public.planar_data set value = jsonb_build_object('__rev', '4', 'projects', jsonb_build_object('hacked', true)) where key = p_strrev
    returning 1
  ) select count(*) into rows_matched from u;
  select (value->>'__rev')::numeric into got_rev from public.planar_data where key = p_strrev;
  if rows_matched <> 0 or got_rev is distinct from 3 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 5 (new __rev is a JSON string): matched %s row(s), left rev=%s (want 0 rows / 3 — unchanged)', rows_matched, got_rev);
  end if;

  -- ---- Case 6 — OLD.value has NO __rev at all — treated as 0, so rev:1 succeeds ---------------
  with u as (
    update public.planar_data set value = jsonb_build_object('__rev', 1, 'projects', jsonb_build_object('seeded', true)) where key = p_oldnorev
    returning 1
  ) select count(*) into rows_matched from u;
  select (value->>'__rev')::numeric into got_rev from public.planar_data where key = p_oldnorev;
  if rows_matched <> 1 or got_rev is distinct from 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 6 (old value missing __rev, treated as 0): matched %s row(s), rev=%s (want 1 row / 1)', rows_matched, got_rev);
  end if;

  -- ---- Case 7 — LOUD-FAILURE: case 2's refusal logs exactly one client_errors row -------------
  select count(*) into tel_count from public.client_errors
   where source = 'event:hs-version-guard-refused' and message like '%' || p_race || '%';
  if tel_count <> 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 7 (LOUD-FAILURE): %s client_errors row(s) logged for %s''s refused write (want exactly 1)', tel_count, p_race);
  end if;

  -- ---- Case 8 — a write that changes NO content (value untouched) succeeds, no rev bump owed --
  with u as (
    update public.planar_data set user_id = owner_uid where key = p_meta
    returning 1
  ) select count(*) into rows_matched from u;
  select (value->>'__rev')::numeric into got_rev from public.planar_data where key = p_meta;
  if rows_matched <> 1 or got_rev is distinct from 9 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 8 (metadata-only, exempt): matched %s row(s), rev=%s (want 1 row / 9 — unbumped)', rows_matched, got_rev);
  end if;

  -- ---- Case 9 — a rev jump of MORE than 1 is accepted, not just an exact +1 -------------------
  with u as (
    update public.planar_data set value = jsonb_build_object('__rev', 50, 'projects', jsonb_build_object('a', 1)) where key = p_jump
    returning 1
  ) select count(*) into rows_matched from u;
  select (value->>'__rev')::numeric into got_rev from public.planar_data where key = p_jump;
  if rows_matched <> 1 or got_rev is distinct from 50 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 9 (rev jump > 1 accepted): matched %s row(s), rev=%s (want 1 row / 50)', rows_matched, got_rev);
  end if;

  if failed > 0 then
    raise exception E'planar_data_enforce_version_monotonic: % of 10 checks FAILED%\n(fixtures rolled back)', failed, rep;
  end if;
  raise exception E'planar_data_enforce_version_monotonic: ALL 10 CHECKS PASSED\n(fixtures rolled back)';
end $$;
