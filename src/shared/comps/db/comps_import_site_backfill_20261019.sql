-- NEW-2 (owner report 2026-10-16) — ONE-TIME BACKFILL: give the 34 comps imported from
-- "N Houston Lease Comps.xlsx" (via the KML/KMZ promote path, which before NEW-2 never linked a
-- tracked market site) the same site link a hand-entered comp gets. Run ONCE in the Supabase SQL
-- editor (project lyeqzkuiwngunutlkkmi). HISTORICAL RECORD of what was executed 2026-10-19; it is
-- idempotent by construction, so a re-run is harmless (it only ever selects a comp whose
-- project_id is still NULL).
--
-- It runs the SAME rule the app runs on save (`resolveOrCreateTrackedSiteForComp` +
-- shared/comps/lib/compSiteMatch.js `findMatchingSite`), comp by comp in creation order, exactly
-- the way the paste grid's batch save does:
--   1. LOCATION — the closest live site of ANY role (pursuit or tracked) owned by the same user
--      whose `origin` is within 0.5 mi (SITE_MATCH_MILES) → attach.
--   2. NAME — else a live site whose name equals the comp title once both are normalised
--      (projectModel.normalizeProjectName: lowercase, non-alphanumerics → one space) → attach.
--   3. Else CREATE a "tracked" (market-record) site named after the comp title at the comp's own
--      point and county — the shape storage.js writes — and attach. A site created for an earlier
--      comp in this run is visible to the next one, so two comps on one property share a site.
--
-- ADDITIVE ONLY: inserts `sites` rows and sets `comps.project_id` where it is NULL. Never edits a
-- comp value, never touches an existing site, never deletes. The before-state of every comp it
-- links is snapshotted first (`create table if not exists`, so a re-run can't overwrite it).

create table if not exists public.recovery_20261019_import_comps_link as
  select id, project_id, now() as snapshot_at from public.comps
  where deleted_at is null and project_id is null and notes ilike '%source: N Houston Lease Comps.xlsx%';

do $$
declare
  c record;
  gid text;
  new_id text;
  match_miles constant double precision := 0.5;
  n_loc int := 0; n_name int := 0; n_created int := 0;
  norm_title text;
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  for c in
    select id, title, lat, lon, county, user_id
    from public.comps
    where deleted_at is null and project_id is null
      and notes ilike '%source: N Houston Lease Comps.xlsx%'
    order by created_at, id
  loop
    gid := null;
    select coalesce(s.group_id, s.data->>'groupId', s.id) into gid
    from public.sites s
    where s.deleted_at is null and s.user_id = c.user_id
      and s.data #>> '{origin,lat}' is not null and s.data #>> '{origin,lon}' is not null
      and 3959 * acos(least(1.0, greatest(-1.0,
            cos(radians(c.lat)) * cos(radians((s.data #>> '{origin,lat}')::float8)) *
            cos(radians((s.data #>> '{origin,lon}')::float8) - radians(c.lon)) +
            sin(radians(c.lat)) * sin(radians((s.data #>> '{origin,lat}')::float8))))) <= match_miles
    order by 3959 * acos(least(1.0, greatest(-1.0,
            cos(radians(c.lat)) * cos(radians((s.data #>> '{origin,lat}')::float8)) *
            cos(radians((s.data #>> '{origin,lon}')::float8) - radians(c.lon)) +
            sin(radians(c.lat)) * sin(radians((s.data #>> '{origin,lat}')::float8)))))
    limit 1;
    if gid is not null then
      update public.comps set project_id = gid where id = c.id and project_id is null;
      n_loc := n_loc + 1;
      continue;
    end if;

    norm_title := trim(regexp_replace(lower(trim(coalesce(c.title, ''))), '[^a-z0-9]+', ' ', 'g'));
    if norm_title <> '' then
      select coalesce(s.group_id, s.data->>'groupId', s.id) into gid
      from public.sites s
      where s.deleted_at is null and s.user_id = c.user_id
        and trim(regexp_replace(lower(trim(coalesce(s.site, s.data->>'site', ''))), '[^a-z0-9]+', ' ', 'g')) = norm_title
      order by s.created_at
      limit 1;
      if gid is not null then
        update public.comps set project_id = gid where id = c.id and project_id is null;
        n_name := n_name + 1;
        continue;
      end if;
    end if;

    new_id := 'trk' || substr(md5(c.id::text || clock_timestamp()::text || random()::text), 1, 12);
    insert into public.sites (id, user_id, group_id, site, name, county, updated_at, data, version)
    values (
      new_id, c.user_id, new_id,
      coalesce(nullif(trim(c.title), ''), 'Tracked property'), 'Market record', c.county, now(),
      jsonb_build_object(
        'schemaVersion', 15, 'id', new_id, 'groupId', new_id,
        'site', coalesce(nullif(trim(c.title), ''), 'Tracked property'), 'name', 'Market record',
        'role', 'tracked', 'status', 'pursuit', 'updatedAt', now_ms, 'siteRenamedAt', now_ms,
        'origin', jsonb_build_object('lat', c.lat, 'lon', c.lon), 'county', c.county,
        'els', '[]'::jsonb, 'measures', '[]'::jsonb, 'settings', '{}'::jsonb, 'elementsInRows', true
      ),
      1
    );
    update public.comps set project_id = new_id where id = c.id and project_id is null;
    n_created := n_created + 1;
  end loop;
  raise notice 'comps_import_site_backfill: % linked by location, % linked by name, % new tracked sites created', n_loc, n_name, n_created;
end $$;

-- Verify (read-only):
--   select count(*) filter (where project_id is not null) linked, count(*) total from public.comps
--   where deleted_at is null and notes ilike '%source: N Houston Lease Comps.xlsx%';
