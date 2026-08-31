-- ============================================================================
-- B966629 (NEW-6) — parcel_deleted_inactive trigger test, AGAINST THE REAL DATABASE.
--
-- Proves the single property: A SOFT-DELETED PARCEL CAN NEVER ALSO READ active:true.
--
-- Three cases: (1) a live active parcel soft-deleted via UPDATE is forced inactive;
-- (2) a row INSERTed already carrying both deleted_at and active:true is corrected on the way
-- in, not just on a later update; (3) an ordinary live parcel (no deleted_at) is UNTOUCHED —
-- the trigger must never flip a live parcel inactive on an unrelated write.
--
-- HOW TO RUN: paste the whole file into the Supabase SQL editor and execute.
--   It is SELF-ROLLING-BACK — it ends by raising an exception carrying the report, so every
--   fixture row is discarded. It writes NOTHING that survives.
--
-- HOW TO PROVE IT RED (do this whenever the guard is touched):
--   `drop trigger parcel_deleted_inactive on public.site_elements;` and re-run — cases 1 and 2
--   must FAIL (the row keeps active:true after being soft-deleted). Restoring the trigger must
--   turn them green again.
-- ============================================================================
do $$
declare
  site      text := 'pdiv-test-site';
  p1        text := 'pdiv-parcel-update';
  p2        text := 'pdiv-parcel-insert';
  p3        text := 'pdiv-parcel-live';
  rep       text := '';
  failed    int := 0;
  active_after text;
  owner_uid uuid;
begin
  select id into owner_uid from auth.users order by created_at limit 1;
  if owner_uid is null then raise exception 'parcel_active_deleted_invariant test: no auth user to hang the fixture off'; end if;

  insert into public.sites (id, user_id, site, name, data)
  values (site, owner_uid, 'PDIV', 'parcel-deleted-inactive test', '{}'::jsonb);

  -- Case 1: a live active parcel, then soft-deleted via UPDATE.
  insert into public.site_elements (site_id, id, kind, data, z_index, rev)
  values (site, p1, 'parcel', jsonb_build_object('id', p1, 'active', true, 'points', '[]'::jsonb), 0, 1);
  update public.site_elements set deleted_at = now() where site_id = site and id = p1;
  select data->>'active' into active_after from public.site_elements where site_id = site and id = p1;
  if active_after is distinct from 'false' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 1: soft-deleting an active parcel left active=%s (want false)', active_after);
  end if;

  -- Case 2: INSERTed already carrying both deleted_at and active:true at once.
  insert into public.site_elements (site_id, id, kind, data, z_index, rev, deleted_at)
  values (site, p2, 'parcel', jsonb_build_object('id', p2, 'active', true, 'points', '[]'::jsonb), 1, 1, now());
  select data->>'active' into active_after from public.site_elements where site_id = site and id = p2;
  if active_after is distinct from 'false' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 2: inserting a pre-deleted parcel left active=%s (want false)', active_after);
  end if;

  -- Case 3: an ordinary LIVE parcel must be untouched by an unrelated write.
  insert into public.site_elements (site_id, id, kind, data, z_index, rev)
  values (site, p3, 'parcel', jsonb_build_object('id', p3, 'active', true, 'points', '[]'::jsonb), 2, 1);
  update public.site_elements set rev = 2 where site_id = site and id = p3; -- unrelated write, no delete
  select data->>'active' into active_after from public.site_elements where site_id = site and id = p3;
  if active_after is distinct from 'true' then
    failed := failed + 1;
    rep := rep || format(E'\n  FAIL case 3: an ordinary live parcel was flipped to active=%s on an unrelated write', active_after);
  end if;

  if failed = 0 then
    raise exception 'parcel_active_deleted_invariant: ALL 3 CASES PASSED (rolled back, nothing written)';
  else
    raise exception 'parcel_active_deleted_invariant: % of 3 cases FAILED:%', failed, rep;
  end if;
end $$;
