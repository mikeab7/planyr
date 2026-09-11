-- ============================================================================
-- B1517888 — sites_block_delete_live_group trigger test, AGAINST THE REAL DATABASE.
--
-- Proves the single property: A sites ROW CANNOT BE HARD-DELETED WHILE ITS PROJECT GROUP STILL
-- HAS A LIVE (deleted_at IS NULL) SIBLING PLAN — regardless of which client (or client vintage)
-- issues the DELETE, because the guard is a BEFORE DELETE trigger, not client code.
--
-- Six cases:
--   0. KNOWN-GOOD ARM — an isolated, already soft-deleted plan with no siblings deletes cleanly.
--      (Proves the instrument can see a delete SUCCEED before trusting it on a refusal —
--      DRIVER-SCROLL-IS-NOT-APP-SCROLL §6.)
--   1. THE smshwnnijjfi SHAPE — one soft-deleted plan, four LIVE siblings in the same group
--      (linked only via data->>'groupId'): the DELETE is refused, and the row still exists after.
--   2. Confirms case 1's fixture never set the `group_id` COLUMN at all — the refusal in case 1
--      could only have come from the jsonb key, not the documented-to-drift mirror column.
--   3. A genuinely DEAD group — every plan in it already soft-deleted — purges every row cleanly,
--      issued as separate single-row DELETEs (the app's own `Promise.all` shape), deleted in the
--      opposite order from how they were created.
--   4. A row that was never soft-deleted at all (deleted_at IS NULL) is refused even with no
--      siblings at all — the belt-and-suspenders half of the guard.
--   5. Soft-deleting the four live siblings from case 1 (the group has now gone fully dead) makes
--      the SAME plan's delete succeed — proves the guard reads a live fact, not a cached verdict.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and execute.
--   SELF-ROLLING-BACK — ends by raising an exception carrying the report, so every fixture row
--   (and every real delete performed by cases 0/3/5) is discarded. It writes NOTHING that
--   survives.
--
-- HOW TO PROVE IT RED (do this whenever the guard is touched):
--   `drop trigger sites_block_delete_live_group on public.sites;` and re-run — cases 1, 2 and 4
--   must FAIL (a delete that should have been refused instead succeeds, or the fixture assumption
--   itself is wrong). Restoring the trigger must turn them green again.
-- ============================================================================
do $$
declare
  grp        text := 'zzbdlg-test-group';
  dead_grp   text := 'zzbdlg-dead-group';
  p_solo     text := 'zzbdlg-solo';
  p_target   text := 'zzbdlg-target';         -- the smshwnnijjfi-shaped plan
  p_live1    text := 'zzbdlg-live1';
  p_live2    text := 'zzbdlg-live2';
  p_live3    text := 'zzbdlg-live3';
  p_live4    text := 'zzbdlg-live4';
  p_dead1    text := 'zzbdlg-dead1';
  p_dead2    text := 'zzbdlg-dead2';
  p_never    text := 'zzbdlg-never-deleted';
  rep        text := '';
  failed     int := 0;
  owner_uid  uuid;
  raised     boolean;
  err        text;
  still_here boolean;
  col_set    boolean;
begin
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'sites_block_delete_live_group test: no auth user to hang the fixture off'; end if;

  -- ---- Case 0 — KNOWN-GOOD ARM: an isolated, already soft-deleted plan deletes cleanly --------
  insert into public.sites (id, user_id, site, name, data, deleted_at) values
    (p_solo, owner_uid, 'Solo', 'Concept A', jsonb_build_object('id', p_solo, 'site', 'Solo'), now());
  begin
    delete from public.sites where id = p_solo;
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  select exists(select 1 from public.sites where id = p_solo) into still_here;
  if raised or still_here then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 0: an isolated soft-deleted plan with no siblings was NOT deleted cleanly — raised=%s err=%s still_here=%s', raised, coalesce(err, '<none>'), still_here);
  end if;

  -- ---- fixtures for cases 1/2/3/4/5: a live group of 5 (1 target + 4 live), a dead group of 2,
  --      and one never-soft-deleted row. `group_id` COLUMN is deliberately left NULL throughout —
  --      every sibling link here exists ONLY in data->>'groupId'. --------------------------------
  insert into public.sites (id, user_id, site, name, data, deleted_at) values
    (p_target, owner_uid, 'Bain', 'Concept A - Quiddity V1', jsonb_build_object('id', p_target, 'groupId', grp, 'site', 'Bain'), now()),
    (p_live1,  owner_uid, 'Bain', 'Concept B', jsonb_build_object('id', p_live1, 'groupId', grp, 'site', 'Bain'), null),
    (p_live2,  owner_uid, 'Bain', 'Concept C', jsonb_build_object('id', p_live2, 'groupId', grp, 'site', 'Bain'), null),
    (p_live3,  owner_uid, 'Bain', 'Concept D', jsonb_build_object('id', p_live3, 'groupId', grp, 'site', 'Bain'), null),
    (p_live4,  owner_uid, 'Bain', 'Concept E', jsonb_build_object('id', p_live4, 'groupId', grp, 'site', 'Bain'), null),
    (p_dead1,  owner_uid, 'Dead Co', 'Concept A', jsonb_build_object('id', p_dead1, 'groupId', dead_grp, 'site', 'Dead Co'), now()),
    (p_dead2,  owner_uid, 'Dead Co', 'Concept B', jsonb_build_object('id', p_dead2, 'groupId', dead_grp, 'site', 'Dead Co'), now()),
    (p_never,  owner_uid, 'Never', 'Concept A', jsonb_build_object('id', p_never, 'site', 'Never'), null);

  -- ---- Case 1 — the smshwnnijjfi shape: refused, row survives ----------------------------------
  begin
    delete from public.sites where id = p_target;
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  select exists(select 1 from public.sites where id = p_target) into still_here;
  if not raised or not still_here or err not like '%live plan%' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 1: the smshwnnijjfi-shaped delete was NOT refused — raised=%s err=%s still_here=%s', raised, coalesce(err, '<none>'), still_here);
  end if;

  -- ---- Case 2 — KNOWN-GOOD ARM on the fixture itself: the group_id COLUMN was never set --------
  select group_id is not null into col_set from public.sites where id = p_target;
  if col_set then
    failed := failed + 1;
    rep := rep || E'\n  FAIL case 2: the fixture unexpectedly set group_id — case 1 does not prove the guard reads the jsonb key';
  end if;

  -- ---- Case 3 — a genuinely dead group purges cleanly, both rows, in either order --------------
  begin
    delete from public.sites where id = p_dead2;  -- delete the SECOND-created row first, deliberately
    delete from public.sites where id = p_dead1;
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  if raised or exists (select 1 from public.sites where id in (p_dead1, p_dead2)) then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 3: a genuinely dead group did NOT purge cleanly — raised=%s err=%s', raised, coalesce(err, '<none>'));
  end if;

  -- ---- Case 4 — a row that was never soft-deleted is refused even with no siblings -------------
  begin
    delete from public.sites where id = p_never;
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  select exists(select 1 from public.sites where id = p_never) into still_here;
  if not raised or not still_here or err not like '%not in the trash%' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 4: a live (never soft-deleted) row was NOT refused — raised=%s err=%s still_here=%s', raised, coalesce(err, '<none>'), still_here);
  end if;

  -- ---- Case 5 — soft-delete the four live siblings; NOW the same target purges cleanly ---------
  update public.sites set deleted_at = now() where id in (p_live1, p_live2, p_live3, p_live4);
  begin
    delete from public.sites where id = p_target;
    delete from public.sites where id = p_live1;
    delete from public.sites where id = p_live2;
    delete from public.sites where id = p_live3;
    delete from public.sites where id = p_live4;
    raised := false;
  exception when others then
    raised := true; err := sqlerrm;
  end;
  if raised or exists (select 1 from public.sites where id in (p_target, p_live1, p_live2, p_live3, p_live4)) then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 5: the group did not purge cleanly once every sibling was soft-deleted — raised=%s err=%s', raised, coalesce(err, '<none>'));
  end if;

  if failed > 0 then
    raise exception E'sites_block_delete_live_group: % of 6 checks FAILED%\n(fixtures rolled back)', failed, rep;
  end if;
  raise exception E'sites_block_delete_live_group: ALL 6 CHECKS PASSED\n(fixtures rolled back)';
end $$;
