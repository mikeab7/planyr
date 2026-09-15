-- ============================================================================
-- NEW-1 (B1584512, 2026-09-12) — sites_preserve_rename_stamp / rename_stamp / rename_site_group,
-- AGAINST THE REAL DATABASE. Supersedes the 2026-09-10 version of this file (8 cases) with cases
-- for the two exploits found live on 2026-09-12, plus the tightened rename_stamp and the
-- authoritative-stamp fix in rename_site_group that keeps the tightened guard from splitting a
-- genuine group rename.
--
-- ⛔ EXTENDED 2026-09-15 (NEW-1, "the hole the backfill could not close") — cases 16-18b pin
-- `sites_stamp_rename_on_insert`, the BEFORE INSERT trigger that seeds a birth stamp on a row
-- carrying none, so `sites_preserve_rename_stamp` (above) is never again handed a row it has
-- nothing to compare against. See db/sites_rename_stamp_guard.sql's own "EXTENDED 2026-09-15"
-- header for the production measurement (row `smu1z3h60nbu`, created three days after the
-- 2026-09-12 backfill, the only unstamped row of 127) and why this is a separate INSERT trigger
-- rather than a change to the UPDATE guard.
--
-- THE TWO EXPLOITS THIS FILE PINS, both reproduced live in a rolled-back transaction before either
-- fix was written:
--   (a) OLDER STAMP WINS — the guard used to return early on "does NEW carry ANY real stamp",
--       presence not recency. A write carrying a stamp of `1` (or any real-but-OLDER stamp) plus a
--       stale name passed outright and overwrote a row whose stored stamp was current.
--   (b) COLUMN-ONLY WRITES WERE UNGUARDED — the revert branch only fired when the JSONB copy of
--       `site` had changed; a write that changed only the `site` COLUMN sailed through, leaving the
--       column and the jsonb disagreeing about the project's name.
-- Plus: `rename_stamp` itself accepted numeric STRINGS and ANY positive number, so `"1"` (or the
-- number `1`) read as a "real" rename time.
--
-- Nineteen cases (0-18). Cases 0 and 4 are KNOWN-GOOD ARMS — they assert answers that are true independently
-- of the guard, so a run in which everything "passes" because the probe is blind fails here first
-- (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6: prove the instrument can see a known answer before trusting
-- it on the unknown one).
--    0. rename_stamp() reports the known answer for every known input — INCLUDING the two now
--       tightened away: a numeric STRING and the implausibly small number `1`.
--    1. a document write carrying `"siteRenamedAt": null` over a stamped row  → stamp PRESERVED.
--    2. a document write that OMITS the key over a stamped row                → stamp PRESERVED.
--    3. an unstamped write that also changes the NAME                          → name AND stamp kept.
--    4. a real rename (name + a numeric stamp)                                 → BOTH land, untouched.
--    5. a row with NO stamp at all                                             → untouched; an
--       unstamped write may still change its name (the legacy majority tier must not be frozen).
--    6. an ordinary content save on a stamped row                              → nothing corrected,
--       and (6b) NOTHING LOGGED — this is the overwhelmingly common shape of every post-rename
--       autosave (same name, same stamp, carried forward), and it must stay silent or the guard
--       would flood client_errors on ordinary use, not just on an attack.
--    7. rename_site_group(…, null) is refused BY NAME.
--    8. EXPLOIT (a), OLDER real stamp — a write carrying a real stamp OLDER than the row's own
--       stored stamp, plus a new name → REFUSED, name and stamp both kept.
--    9. EXPLOIT (a), EQUAL real stamp — a write carrying the row's OWN CURRENT stamp verbatim,
--       plus a new name → REFUSED (ties lose too, they do not win).
--   10. EXPLOIT (b), COLUMN-ONLY write — `update … set site = …` with `data` UNTOUCHED → the
--       column is corrected back; the jsonb (already agreeing) is left alone.
--   11. EXPLOIT (b) variant — a write that touches BOTH copies to two DIFFERENT wrong names →
--       both corrected back to the same effective name; they never end up disagreeing.
--   12. rename_stamp tightening — the number `1` (a positive, technically-parseable-by-the-OLD-rule
--       value) is UNKNOWN, not a stamp: an update carrying it, plus a new name, over a stamped
--       row → refused, same as case 8/9's shape but via the tightened parse rather than the
--       recency compare (defense in depth — this must hold even if a future change ever loosened
--       the recency check back).
--   13. rename_stamp range — an absurd far-future number is UNKNOWN too.
--   14. THE COMPOSABILITY CLAUSE — a row with NO valid stamp (prior_at unknown) is correctly left
--       unguarded by an ordinary write, exactly like case 5, so a future NEW-2 backfill that gives
--       such a row a real stamp is what starts protecting it — never invented here.
--   15. rename_site_group's AUTHORITATIVE STAMP — called with a caller-supplied timestamp that is
--       LOWER than a stamp already sitting on one member of the group (the "stale local cache"
--       case the strict guard would otherwise split), the RPC still renames the WHOLE group to one
--       consistent, strictly-newer stamp. Without the fix in rename_site_group.sql, this case
--       reproduces a NEW split-name defect the strict guard would otherwise introduce.
--   16. NEW-1 (2026-09-15) — a brand-new INSERT carrying NO `siteRenamedAt` key at all comes back
--       with a valid stamp, and that stamp is exactly its own `updated_at` in epoch ms — the same
--       Tier-2 convention the 2026-09-12 backfill used, not a second one.
--   17. NEW-1 — an INSERT that already carries a real stamp (the shape `duplicatePlan` produces
--       when it inherits a group's existing rename) is left completely alone; the birth-stamp
--       trigger never overwrites a stamp a caller already supplied.
--   18. NEW-1 — THE ATTACK, DEMONSTRATED END TO END on the row case 16 just created: the exact
--       column+jsonb write that landed cleanly pre-fix (reproduced live against `smu1z3h60nbu`
--       2026-09-15 before this trigger existed) is now refused on a row that is mere moments old,
--       because it was born with a stamp for `sites_preserve_rename_stamp` to protect. (18b) and
--       LOUD-FAILURE fires for it too.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and execute (or via the Supabase
-- MCP execute_sql tool). It is SELF-ROLLING-BACK — it ends by raising an exception carrying the
-- report, so every fixture row (including any client_errors telemetry row) is discarded. It writes
-- NOTHING that survives.
--
-- HOW TO PROVE IT RED (do this whenever the guard is touched):
--   • Revert `sites_preserve_rename_stamp` to its pre-2026-09-12 body (presence-only, column-only
--     branch) — cases 8, 9, 10 and 11 must FAIL.
--   • Revert `rename_stamp` to its pre-2026-09-12 body (numeric strings + any positive value
--     accepted) — case 0 (the string/`1`/range assertions) and case 12 must FAIL.
--   • Revert `rename_site_group` to its pre-2026-09-12 body (writes the caller's value verbatim,
--     no group-max) — case 15 must FAIL (the group ends up split).
--   • DROP the `sites_stamp_rename_on_insert` trigger (or its function) entirely — cases 16, 18
--     and 18b must FAIL: a fresh INSERT comes back with no stamp at all, and the case-18 attack
--     lands cleanly on it exactly as it did on `smu1z3h60nbu` pre-fix.
--   Restoring each function must turn its cases green again. Confirmed red against the exact
--   pre-fix bodies on 2026-09-12 (cases 0/8/9/10/11/12/15) and 2026-09-15 (cases 16/18/18b, with
--   the trigger dropped), before any fix in this pair of files was written.
-- ============================================================================
do $$
declare
  grp        text := 'zzrsg-test-group';
  grp2       text := 'zzrsg-group2';
  p_null     text := 'zzrsg-null-marker';
  p_absent   text := 'zzrsg-absent-marker';
  p_rename   text := 'zzrsg-name-change';
  p_col      text := 'zzrsg-content-save';
  p_real     text := 'zzrsg-real-rename';
  p_unstamp  text := 'zzrsg-never-stamped';
  p_wipe     text := 'zzrsg-null-arg';
  p_older    text := 'zzrsg-older-stamp';
  p_equal    text := 'zzrsg-equal-stamp';
  p_colonly  text := 'zzrsg-column-only';
  p_bothcopy text := 'zzrsg-both-copies';
  p_tiny     text := 'zzrsg-tiny-stamp';
  p_g2a      text := 'zzrsg-group2-hi';
  p_g2b      text := 'zzrsg-group2-lo';
  p_newborn  text := 'zzrsg-newborn';           -- NEW-1 (2026-09-15): INSERT-time stamping
  p_inherit  text := 'zzrsg-newborn-inherited';
  at1        bigint := 1785525795307;   -- the real Silvestri stamp, 2026-07-31T19:23:15.307Z
  at2        bigint := 1786655992552;
  at_older   bigint := at1 - 1000;
  at_hi      bigint := at1 + 5000000;
  at_lo      bigint := at1 - 200;
  rep        text := '';
  failed     int := 0;
  got_at     text;
  got_site   text;
  got_col    text;
  owner_uid  uuid;
  raised     boolean := false;
  err        text := '';
  tel_count  int;
  newborn_at   bigint;
  newborn_want bigint;
begin
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'rename stamp guard test: no auth user to hang the fixture off'; end if;

  -- ---- Case 0 — KNOWN-GOOD ARM: the parse reports known answers, INCLUDING the tightened ones ---
  if public.rename_stamp(to_jsonb(at1)) is distinct from at1 then
    failed := failed + 1; rep := rep || E'\n  FAIL case 0a: rename_stamp(number) did not round-trip';
  end if;
  if public.rename_stamp('"1785525795307"'::jsonb) is not null then
    failed := failed + 1; rep := rep || E'\n  FAIL case 0b: rename_stamp(numeric STRING) parsed — tightening to ONE representation (number-only) did not take';
  end if;
  if public.rename_stamp('null'::jsonb) is not null
     or public.rename_stamp(null::jsonb) is not null
     or public.rename_stamp('"nope"'::jsonb) is not null
     or public.rename_stamp('0'::jsonb) is not null
     or public.rename_stamp('-5'::jsonb) is not null then
    failed := failed + 1; rep := rep || E'\n  FAIL case 0c: rename_stamp read an EMPTY marker as a stamp';
  end if;
  if public.rename_stamp('1'::jsonb) is not null then
    failed := failed + 1; rep := rep || E'\n  FAIL case 0d: rename_stamp(1) parsed — an implausibly small "stamp" must read as UNKNOWN';
  end if;
  if public.rename_stamp('9999999999999'::jsonb) is not null then
    failed := failed + 1; rep := rep || E'\n  FAIL case 0e: rename_stamp(far-future number) parsed — the plausibility ceiling did not take';
  end if;
  if public.rename_stamp(to_jsonb(1785525795307.5)) is not null then
    failed := failed + 1; rep := rep || E'\n  FAIL case 0f: rename_stamp(non-integral number) parsed';
  end if;

  -- ---- fixtures: five stamped plans in one group, plus one never-stamped, plus new attack fixtures
  --
  -- ⛔ NEW-1 (2026-09-15) — `sites_stamp_rename_on_insert` now birth-stamps EVERY insert with no
  -- valid stamp, so `p_unstamp` (cases 5/14's LEGACY never-stamped fixture — the majority-tier
  -- invariant those cases exist to protect) can no longer be produced by an ordinary INSERT. That
  -- is the fix working as intended, not a test bug — but the legacy shape (a row that predates
  -- this trigger) still needs to exist to prove the majority tier stays correct for it, so this one
  -- bulk insert disables the new trigger for its own duration. Every OTHER row in this statement
  -- already carries an explicit `siteRenamedAt`, so disabling it here changes nothing for them —
  -- the trigger would have been a no-op on each regardless.
  alter table public.sites disable trigger sites_stamp_rename_on_insert;
  insert into public.sites (id, user_id, site, name, data) values
    (p_null,     owner_uid, 'Silvestri', 'Concept A', jsonb_build_object('id', p_null,     'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1)),
    (p_absent,   owner_uid, 'Silvestri', 'Concept B', jsonb_build_object('id', p_absent,   'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1)),
    (p_rename,   owner_uid, 'Silvestri', 'Concept C', jsonb_build_object('id', p_rename,   'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1)),
    (p_col,      owner_uid, 'Silvestri', 'Concept D', jsonb_build_object('id', p_col,      'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1)),
    (p_real,     owner_uid, 'Silvestri', 'Concept E', jsonb_build_object('id', p_real,     'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1)),
    (p_unstamp,  owner_uid, 'Legacy',    'Concept A', jsonb_build_object('id', p_unstamp,  'groupId', p_unstamp, 'site', 'Legacy')),
    (p_wipe,     owner_uid, 'Wipe',      'Concept A', jsonb_build_object('id', p_wipe,     'groupId', p_wipe,    'site', 'Wipe')),
    (p_older,    owner_uid, 'Original',  'Concept A', jsonb_build_object('id', p_older,    'groupId', p_older,   'site', 'Original',  'siteRenamedAt', at1)),
    (p_equal,    owner_uid, 'Original',  'Concept A', jsonb_build_object('id', p_equal,    'groupId', p_equal,   'site', 'Original',  'siteRenamedAt', at1)),
    (p_colonly,  owner_uid, 'Original',  'Concept A', jsonb_build_object('id', p_colonly,  'groupId', p_colonly, 'site', 'Original',  'siteRenamedAt', at1)),
    (p_bothcopy, owner_uid, 'Original',  'Concept A', jsonb_build_object('id', p_bothcopy, 'groupId', p_bothcopy,'site', 'Original',  'siteRenamedAt', at1)),
    (p_tiny,     owner_uid, 'Original',  'Concept A', jsonb_build_object('id', p_tiny,     'groupId', p_tiny,    'site', 'Original',  'siteRenamedAt', at1)),
    (p_g2a,      owner_uid, 'Two',       'Concept A', jsonb_build_object('id', p_g2a,      'groupId', grp2,      'site', 'Two',       'siteRenamedAt', at_hi)),
    (p_g2b,      owner_uid, 'Two',       'Concept B', jsonb_build_object('id', p_g2b,      'groupId', grp2,      'site', 'Two',       'siteRenamedAt', at_lo));
  alter table public.sites enable trigger sites_stamp_rename_on_insert;

  -- ---- Case 1 — the exact shape that shipped: a document push asserting an empty marker --------
  update public.sites
     set data = jsonb_build_object('id', p_null, 'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', null::jsonb, 'els', '[]'::jsonb)
   where id = p_null;
  select data->>'siteRenamedAt' into got_at from public.sites where id = p_null;
  if got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 1: a null-marker document write left siteRenamedAt = %s (want %s)', coalesce(got_at, '<empty>'), at1);
  end if;

  -- ---- Case 2 — the post-fix client shape: the key is OMITTED (still erases, without a guard) --
  update public.sites
     set data = jsonb_build_object('id', p_absent, 'groupId', grp, 'site', 'Silvestri', 'els', '[]'::jsonb)
   where id = p_absent;
  select data->>'siteRenamedAt' into got_at from public.sites where id = p_absent;
  if got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 2: an omitted-marker document write left siteRenamedAt = %s (want %s)', coalesce(got_at, '<empty>'), at1);
  end if;

  -- ---- Case 3 — an unstamped write may not move a stamped row's NAME --------------------------
  update public.sites
     set site = 'Sylvestri',
         data = jsonb_build_object('id', p_rename, 'groupId', grp, 'site', 'Sylvestri', 'siteRenamedAt', null::jsonb)
   where id = p_rename;
  select data->>'site', site, data->>'siteRenamedAt' into got_site, got_col, got_at from public.sites where id = p_rename;
  if got_site is distinct from 'Silvestri' or got_col is distinct from 'Silvestri' or got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 3: an unstamped write moved a stamped name — data.site=%s column=%s stamp=%s (want Silvestri/Silvestri/%s)',
                         got_site, got_col, coalesce(got_at, '<empty>'), at1);
  end if;

  -- ---- Case 6 — an ordinary content save on a stamped row is left completely alone ------------
  update public.sites
     set data = jsonb_build_object('id', p_col, 'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at1, 'els', '[{"id":"b1"}]'::jsonb)
   where id = p_col;
  select data->>'site', data->'els'->0->>'id', data->>'siteRenamedAt' into got_site, got_col, got_at from public.sites where id = p_col;
  if got_site is distinct from 'Silvestri' or got_col is distinct from 'b1' or got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 6: an ordinary content save was altered — site=%s first-el=%s stamp=%s', got_site, got_col, coalesce(got_at, '<empty>'));
  end if;
  -- NOT A FALSE POSITIVE: an ordinary save that already agrees with the stamped state (the
  -- overwhelmingly common shape of every post-rename autosave) must stay SILENT — it must never
  -- log a refusal, or every routine save on a renamed project would flood client_errors.
  select count(*) into tel_count from public.client_errors
   where source = 'event:rename-guard-refused' and message like '%' || p_col || '%';
  if tel_count > 0 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 6b (false-positive guard): an ordinary matching save on %s logged % refusal row(s) — it must log ZERO', p_col, tel_count);
  end if;

  -- ---- Case 4 — KNOWN-GOOD ARM: a REAL rename still lands, untouched -------------------------
  perform public.rename_site_group(grp, 'Woods Road', at2);
  select data->>'site', site, data->>'siteRenamedAt' into got_site, got_col, got_at from public.sites where id = p_real;
  if got_site is distinct from 'Woods Road' or got_col is distinct from 'Woods Road' or got_at is distinct from at2::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 4: a genuine rename was blocked — data.site=%s column=%s stamp=%s (want Woods Road/Woods Road/%s)',
                         got_site, got_col, coalesce(got_at, '<empty>'), at2);
  end if;

  -- ---- Case 5 — a never-stamped row is NOT frozen ---------------------------------------------
  update public.sites
     set site = 'Legacy Renamed',
         data = jsonb_build_object('id', p_unstamp, 'groupId', p_unstamp, 'site', 'Legacy Renamed')
   where id = p_unstamp;
  select data->>'site', site into got_site, got_col from public.sites where id = p_unstamp;
  if got_site is distinct from 'Legacy Renamed' or got_col is distinct from 'Legacy Renamed' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 5: an UNSTAMPED row was frozen — data.site=%s column=%s (want Legacy Renamed)', got_site, got_col);
  end if;

  -- ---- Case 7 — a null stamp is REFUSED, never written as a blanked `data` --------------------
  begin
    perform public.rename_site_group(p_wipe, 'Anything', null);
  exception when others then
    raised := true; err := sqlerrm;
  end;
  select data::text into got_site from public.sites where id = p_wipe;
  if not raised or got_site is null or err not like '%p_renamed_at%' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 7: rename_site_group(…, null) raised=%s err=%s data=%s (want a refusal naming p_renamed_at, data intact)',
                         raised, coalesce(nullif(err, ''), '<none>'), coalesce(got_site, '<NULL>'));
  end if;

  -- ---- Case 8 — EXPLOIT (a): a real but OLDER stamp must NOT beat a newer stored one -----------
  update public.sites
     set data = jsonb_build_object('id', p_older, 'groupId', p_older, 'site', 'Attacker Name', 'siteRenamedAt', at_older)
   where id = p_older;
  select data->>'site', site, data->>'siteRenamedAt' into got_site, got_col, got_at from public.sites where id = p_older;
  if got_site is distinct from 'Original' or got_col is distinct from 'Original' or got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 8 (EXPLOIT a — older stamp): site=%s column=%s stamp=%s (want Original/Original/%s — older stamp must lose)',
                         got_site, got_col, coalesce(got_at, '<empty>'), at1);
  end if;

  -- ---- Case 9 — EXPLOIT (a) variant: an EQUAL stamp must also lose, not win --------------------
  update public.sites
     set data = jsonb_build_object('id', p_equal, 'groupId', p_equal, 'site', 'Attacker Name', 'siteRenamedAt', at1)
   where id = p_equal;
  select data->>'site', site, data->>'siteRenamedAt' into got_site, got_col, got_at from public.sites where id = p_equal;
  if got_site is distinct from 'Original' or got_col is distinct from 'Original' or got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 9 (EXPLOIT a — equal stamp): site=%s column=%s stamp=%s (want Original/Original/%s — a tie must lose)',
                         got_site, got_col, coalesce(got_at, '<empty>'), at1);
  end if;

  -- ---- Case 10 — EXPLOIT (b): a COLUMN-ONLY write must be corrected too ------------------------
  update public.sites set site = 'Attacker Name' where id = p_colonly;
  select data->>'site', site, data->>'siteRenamedAt' into got_site, got_col, got_at from public.sites where id = p_colonly;
  if got_site is distinct from 'Original' or got_col is distinct from 'Original' or got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 10 (EXPLOIT b — column-only write): site=%s column=%s stamp=%s (want Original/Original/%s)',
                         got_site, got_col, coalesce(got_at, '<empty>'), at1);
  end if;
  -- LOUD-FAILURE — this refusal must have logged a telemetry row.
  select count(*) into tel_count from public.client_errors
   where source = 'event:rename-guard-refused' and message like '%' || p_colonly || '%';
  if tel_count < 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 10b (LOUD-FAILURE): no client_errors row logged for the refused write on %s', p_colonly);
  end if;

  -- ---- Case 11 — EXPLOIT (b) variant: BOTH copies changed to DIFFERENT wrong names -------------
  update public.sites
     set site = 'Column Lie',
         data = jsonb_build_object('id', p_bothcopy, 'groupId', p_bothcopy, 'site', 'Jsonb Lie', 'siteRenamedAt', null::jsonb)
   where id = p_bothcopy;
  select data->>'site', site, data->>'siteRenamedAt' into got_site, got_col, got_at from public.sites where id = p_bothcopy;
  if got_site is distinct from 'Original' or got_col is distinct from 'Original' or got_at is distinct from at1::text or got_site is distinct from got_col then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 11 (EXPLOIT b — both copies disagree): data.site=%s column=%s stamp=%s (want Original/Original/%s, and equal to each other)',
                         got_site, got_col, coalesce(got_at, '<empty>'), at1);
  end if;

  -- ---- Case 12 — rename_stamp tightening: the number `1` must not count as a rename ------------
  update public.sites
     set data = jsonb_build_object('id', p_tiny, 'groupId', p_tiny, 'site', 'Attacker Name', 'siteRenamedAt', 1)
   where id = p_tiny;
  select data->>'site', site, data->>'siteRenamedAt' into got_site, got_col, got_at from public.sites where id = p_tiny;
  if got_site is distinct from 'Original' or got_col is distinct from 'Original' or got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 12 (tightened rename_stamp — "1"): site=%s column=%s stamp=%s (want Original/Original/%s)',
                         got_site, got_col, coalesce(got_at, '<empty>'), at1);
  end if;

  -- ---- Case 13 — rename_stamp range: an absurd far-future number is UNKNOWN too ----------------
  -- (covered structurally by case 0e against the pure function; re-asserted here through the
  -- trigger so the composed behaviour, not just the parser, is proven.)
  update public.sites
     set data = jsonb_build_object('id', p_tiny, 'groupId', p_tiny, 'site', 'Attacker Name Two', 'siteRenamedAt', 99999999999999::bigint)
   where id = p_tiny;
  select data->>'site', data->>'siteRenamedAt' into got_site, got_at from public.sites where id = p_tiny;
  if got_site is distinct from 'Original' or got_at is distinct from at1::text then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 13 (tightened rename_stamp — far future): site=%s stamp=%s (want Original/%s)', got_site, coalesce(got_at, '<empty>'), at1);
  end if;

  -- ---- Case 14 — composability with NEW-2 (the future backfill): an UNKNOWN-stamp row is left --
  --      unguarded (exactly case 5's shape) — never treated as "free to overwrite" in a way that
  --      would make backfilling it later a no-op, and never invented here either.
  if public.rename_stamp((select data -> 'siteRenamedAt' from public.sites where id = p_unstamp)) is not null then
    failed := failed + 1;
    rep := rep || E'\n  FAIL case 14: an unstamped row somehow reads a real stamp — NEW-2''s backfill precondition would be violated';
  end if;

  -- ---- Case 15 — rename_site_group's AUTHORITATIVE STAMP: a caller-supplied value LOWER than a
  --      stamp already sitting on one group member must not split the group.
  perform public.rename_site_group(grp2, 'Two Renamed', at1);   -- caller's value (at1) < p_g2a's at_hi
  select data->>'site', data->>'siteRenamedAt' into got_site, got_at from public.sites where id = p_g2a;
  if got_site is distinct from 'Two Renamed' or got_at::bigint <= at_hi then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 15a: the HIGH-stamped member of group2 was not renamed with a strictly-newer stamp — site=%s stamp=%s (want Two Renamed / > %s)',
                         got_site, coalesce(got_at, '<empty>'), at_hi);
  end if;
  select data->>'site', data->>'siteRenamedAt' into got_col, got_at from public.sites where id = p_g2b;
  if got_col is distinct from 'Two Renamed' or got_col is distinct from got_site then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 15b: group2 SPLIT — p_g2a=%s p_g2b=%s (a caller-supplied stamp below the group''s true max must still rename the WHOLE group consistently)',
                         got_site, got_col);
  end if;

  -- ---- Case 16 — NEW-1 (2026-09-15): a brand-new INSERT with NO siteRenamedAt key at all --------
  -- MUTATION PROOF: drop sites_stamp_rename_on_insert (or its function) and this goes RED — the
  -- row comes back with no stamp, exactly like smu1z3h60nbu measured 2026-09-15 pre-fix.
  insert into public.sites (id, user_id, site, name, data) values
    (p_newborn, owner_uid, 'Untitled site', 'Concept A',
     jsonb_build_object('id', p_newborn, 'groupId', p_newborn, 'site', 'Untitled site'));
  select public.rename_stamp(data -> 'siteRenamedAt'), floor(extract(epoch from updated_at) * 1000)::bigint
    into newborn_at, newborn_want
    from public.sites where id = p_newborn;
  if newborn_at is null or newborn_at is distinct from newborn_want then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 16 (NEW-1 — INSERT-time stamping): a brand-new row with no siteRenamedAt key came back stamp=%s (want a valid stamp = %s, its own updated_at in epoch ms)',
                         coalesce(newborn_at::text, '<none>'), newborn_want);
  end if;

  -- ---- Case 17 — NEW-1: an INSERT that already carries a real stamp is left alone ---------------
  -- (the shape duplicatePlan produces when a plan inherits its group's existing rename stamp)
  insert into public.sites (id, user_id, site, name, data) values
    (p_inherit, owner_uid, 'Silvestri', 'Concept F',
     jsonb_build_object('id', p_inherit, 'groupId', grp, 'site', 'Silvestri', 'siteRenamedAt', at2));
  select public.rename_stamp(data -> 'siteRenamedAt') into newborn_at from public.sites where id = p_inherit;
  if newborn_at is distinct from at2 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 17: an INSERT that already carried a real stamp (%s) was overwritten by birth-stamping (%s)',
                         at2, coalesce(newborn_at::text, '<none>'));
  end if;

  -- ---- Case 18 — NEW-1: THE ATTACK, demonstrated end to end on the row case 16 just created ------
  -- The exact write that landed cleanly on smu1z3h60nbu pre-fix (measured live 2026-09-15) must now
  -- be refused on a row that is mere moments old.
  update public.sites
     set site = 'Attacker Name',
         data = jsonb_set(data, '{site}', to_jsonb('Attacker Name'::text))
   where id = p_newborn;
  select data->>'site', site into got_site, got_col from public.sites where id = p_newborn;
  if got_site is distinct from 'Untitled site' or got_col is distinct from 'Untitled site' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 18 (NEW-1 — the attack, on a row seconds old): data.site=%s column=%s (want Untitled site/Untitled site)', got_site, got_col);
  end if;
  -- LOUD-FAILURE — this refusal must have logged a telemetry row too.
  select count(*) into tel_count from public.client_errors
   where source = 'event:rename-guard-refused' and message like '%' || p_newborn || '%';
  if tel_count < 1 then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 18b (LOUD-FAILURE): no client_errors row logged for the refused write on the newborn row %s', p_newborn);
  end if;

  if failed > 0 then
    raise exception E'sites_preserve_rename_stamp: % of 28 checks FAILED%\n(fixtures rolled back)', failed, rep;
  end if;
  raise exception E'sites_preserve_rename_stamp: ALL 28 CHECKS PASSED\n(fixtures rolled back)';
end $$;
