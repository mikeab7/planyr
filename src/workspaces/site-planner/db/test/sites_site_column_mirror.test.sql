-- ============================================================================
-- NEW-2 (2026-09-16) — sites_mirror_site_column / sites_site_column_mirror, AGAINST THE REAL
-- DATABASE. See db/sites_site_column_mirror.sql for the full reasoning (why a trigger rather than
-- a GENERATED column, why a new trigger rather than extending sites_preserve_rename_stamp, the
-- trigger-order proof against sites_enforce_version_monotonic).
--
-- Six cases (0-5), seven checks — case 3 carries its own precondition. Case 0 is a KNOWN-GOOD ARM
-- — it asserts an answer true independently of this trigger (an ordinary write that already keeps
-- both copies in sync stays in sync), so a run that "passes" because the probe is blind fails here
-- first (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6).
--    0. KNOWN-GOOD ARM — an ordinary write with both copies already agreeing lands unchanged.
--    1. INSERT with the COLUMN and the jsonb set to two DIFFERENT names → the column is corrected
--       to the jsonb's value. Untouched by sites_preserve_rename_stamp (UPDATE-only) and by
--       sites_stamp_rename_on_insert (siteRenamedAt only) — isolates this trigger specifically.
--    2. UPDATE carrying a GENUINE strictly-newer rename stamp (so sites_preserve_rename_stamp's
--       own case-3 "trust the caller" branch returns without touching site/data.site) that ALSO
--       sets the COLUMN to a value that disagrees with the jsonb it just wrote → the column is
--       still corrected. Isolates this trigger from sites_preserve_rename_stamp's own, narrower
--       correction (which never fires on this exact write shape).
--    3. UPDATE that touches ONLY the column (`data` completely unchanged) on an UNSTAMPED row (so
--       sites_preserve_rename_stamp's own no-op case — "if prior_at is null then return new" —
--       does nothing here either) → the column is still corrected back to the jsonb.
--    4. `new.data` present but with NO `site` key at all → the column is left exactly as the
--       statement proposed it (this trigger never invents a name — see the migration's own "WHAT
--       THIS DELIBERATELY DOES NOT DO").
--    5. TRIGGER ORDER, asserted directly rather than assumed: sites_site_column_mirror must sort
--       strictly after BOTH sites_enforce_version_monotonic and sites_preserve_rename_stamp among
--       this table's BEFORE UPDATE triggers.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and execute (or via the Supabase
-- MCP execute_sql tool). SELF-ROLLING-BACK — it ends by raising an exception carrying the report,
-- so every fixture row is discarded. It writes NOTHING that survives.
--
-- HOW TO PROVE IT RED (do this whenever the trigger is touched):
--   • DROP the sites_site_column_mirror trigger (or its function) entirely — cases 1, 2 and 3 must
--     FAIL (the column keeps whatever the statement proposed, disagreeing with the jsonb).
--   Restoring the trigger must turn them green again.
-- ============================================================================
do $$
declare
  p_good     text := 'zzscm-known-good';
  p_insmis   text := 'zzscm-insert-mismatch';
  p_rename   text := 'zzscm-rename-colmis';
  p_colonly  text := 'zzscm-column-only-unstamped';
  p_nokey    text := 'zzscm-no-site-key';
  at_new     bigint := 1787000000000;  -- a plausible, strictly-newer epoch-ms stamp
  rep        text := '';
  failed     int := 0;
  got_site   text;
  got_col    text;
  owner_uid  uuid;
  trig_order text[];
  pos_enforce int;
  pos_preserve int;
  pos_mirror  int;
begin
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'site column mirror test: no auth user to hang the fixture off'; end if;

  -- ---- Case 0 — KNOWN-GOOD ARM: an ordinary, already-agreeing write lands unchanged -------------
  insert into public.sites (id, user_id, site, name, data) values
    (p_good, owner_uid, 'Agreeing', 'Concept A', jsonb_build_object('id', p_good, 'groupId', p_good, 'site', 'Agreeing'));
  select data->>'site', site into got_site, got_col from public.sites where id = p_good;
  if got_site is distinct from 'Agreeing' or got_col is distinct from 'Agreeing' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 0 (KNOWN-GOOD ARM): an already-agreeing write came back data.site=%s column=%s (want Agreeing/Agreeing)', got_site, got_col);
  end if;

  -- ---- Case 1 — INSERT with the column and jsonb set to two DIFFERENT names ---------------------
  insert into public.sites (id, user_id, site, name, data) values
    (p_insmis, owner_uid, 'Column Says This', 'Concept A',
     jsonb_build_object('id', p_insmis, 'groupId', p_insmis, 'site', 'Jsonb Says This'));
  select data->>'site', site into got_site, got_col from public.sites where id = p_insmis;
  if got_site is distinct from 'Jsonb Says This' or got_col is distinct from 'Jsonb Says This' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 1 (INSERT mismatch): data.site=%s column=%s (want Jsonb Says This/Jsonb Says This — the column must mirror the jsonb)', got_site, got_col);
  end if;

  -- ---- Case 2 — a GENUINE newer rename that also carries a mismatched column ---------------------
  -- Seed a stamped row first (a real rename target), then send a write sites_preserve_rename_stamp
  -- will treat as a genuine newer rename (case 3 of that trigger's own test file) — which returns
  -- WITHOUT touching site/data.site — while the SAME statement sets the column to a value that
  -- disagrees with what it just wrote to data.site. Only this new trigger can catch that.
  -- Bumps `version` too — this write must clear sites_enforce_version_monotonic (untouched by
  -- this item, and correctly still enforced) to even reach this trigger; a content-changing write
  -- that does NOT bump version is that OTHER guard's job and proves nothing about this one.
  insert into public.sites (id, user_id, site, name, data, version) values
    (p_rename, owner_uid, 'Before Rename', 'Concept A',
     jsonb_build_object('id', p_rename, 'groupId', p_rename, 'site', 'Before Rename', 'siteRenamedAt', 1785000000000::bigint), 1);
  update public.sites
     set site = 'Stale Column Value',
         data = jsonb_build_object('id', p_rename, 'groupId', p_rename, 'site', 'After Rename', 'siteRenamedAt', at_new),
         version = 2
   where id = p_rename;
  select data->>'site', site into got_site, got_col from public.sites where id = p_rename;
  if got_site is distinct from 'After Rename' or got_col is distinct from 'After Rename' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 2 (genuine rename + column mismatch): data.site=%s column=%s (want After Rename/After Rename)', got_site, got_col);
  end if;

  -- ---- Case 3 — a COLUMN-ONLY write on a genuinely UNSTAMPED row (sites_preserve_rename_stamp's
  --      own no-op case, "if prior_at is null then return new" — its correction never fires here
  --      either) ----------------------------------------------------------------------------------
  -- ⛔ A row is no longer unstamped by default — sites_stamp_rename_on_insert seeds every INSERT
  -- with no valid siteRenamedAt from its own updated_at (NEW-1, 2026-09-15), so an ordinary insert
  -- here would land ALREADY protected by sites_preserve_rename_stamp regardless of this trigger,
  -- exactly the false-pass this file's case 0 exists to catch elsewhere — caught here by first
  -- confirming (below) that it WOULD confound the case, then closing it the same way
  -- db/test/sites_rename_stamp_guard.test.sql's own case 5/14 fixture does: disable the birth-stamp
  -- trigger for one INSERT to produce the genuine legacy shape. Also bumps `version` — see the
  -- case-2 note: a column-only write that does not clear sites_enforce_version_monotonic tests
  -- THAT guard, not this one.
  alter table public.sites disable trigger sites_stamp_rename_on_insert;
  insert into public.sites (id, user_id, site, name, data, version) values
    (p_colonly, owner_uid, 'Legacy Name', 'Concept A', jsonb_build_object('id', p_colonly, 'groupId', p_colonly, 'site', 'Legacy Name'), 1);
  alter table public.sites enable trigger sites_stamp_rename_on_insert;
  if (select data ? 'siteRenamedAt' from public.sites where id = p_colonly) then
    failed := failed + 1;
    rep := rep || E'\n  FAIL case 3 precondition: the fixture row was not actually born unstamped — this case would confound with sites_preserve_rename_stamp''s own protection';
  end if;
  update public.sites set site = 'Attacker Column', version = 2 where id = p_colonly;
  select data->>'site', site into got_site, got_col from public.sites where id = p_colonly;
  if got_site is distinct from 'Legacy Name' or got_col is distinct from 'Legacy Name' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 3 (column-only write, unstamped row): data.site=%s column=%s (want Legacy Name/Legacy Name)', got_site, got_col);
  end if;

  -- ---- Case 4 — data present but with NO `site` key: the column is left as proposed --------------
  insert into public.sites (id, user_id, site, name, data) values
    (p_nokey, owner_uid, 'Whatever Was Proposed', 'Concept A', jsonb_build_object('id', p_nokey, 'groupId', p_nokey));
  select site into got_col from public.sites where id = p_nokey;
  if got_col is distinct from 'Whatever Was Proposed' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 4 (no site key in data): column=%s (want Whatever Was Proposed — a data with no site key must never blank or invent the column)', got_col);
  end if;

  -- ---- Case 5 — TRIGGER ORDER, asserted directly -------------------------------------------------
  select array_agg(tgname order by tgname) into trig_order
    from pg_trigger
   where tgrelid = 'public.sites'::regclass and not tgisinternal
     and tgtype & 19 = 19;  -- BEFORE (bit 1) + ROW (bit 0) + UPDATE (bit 4) = 1+2+16
  pos_enforce  := array_position(trig_order, 'sites_enforce_version_monotonic');
  pos_preserve := array_position(trig_order, 'sites_preserve_rename_stamp');
  pos_mirror   := array_position(trig_order, 'sites_site_column_mirror');
  if pos_mirror is null or pos_enforce is null or pos_preserve is null
     or pos_mirror < pos_enforce or pos_mirror < pos_preserve then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 5 (trigger order): BEFORE UPDATE order=%s (sites_site_column_mirror must sort after BOTH sites_enforce_version_monotonic and sites_preserve_rename_stamp)',
                         array_to_string(trig_order, ', '));
  end if;

  if failed > 0 then
    raise exception E'sites_site_column_mirror: % of 7 checks FAILED%\n(fixtures rolled back)', failed, rep;
  end if;
  raise exception E'sites_site_column_mirror: ALL 7 CHECKS PASSED\n(fixtures rolled back)';
end $$;
