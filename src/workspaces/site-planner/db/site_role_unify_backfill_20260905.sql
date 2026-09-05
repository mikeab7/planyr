-- B843792 (NEW-1) — ONE-TIME DATA MIGRATION: collapse the Site/Comp split for the three live
-- comps that predate the site-role model. Run ONCE in the Supabase SQL editor (project
-- lyeqzkuiwngunutlkkmi), AFTER comps.sql, sites_soft_delete.sql and set_site_group_role.sql. This
-- file is a HISTORICAL RECORD of what was executed on 2026-09-05, not a reusable "run me anytime"
-- migration — but it is idempotent by construction (see below), so a re-run is harmless.
--
-- THE IDEA, from the owner: a site plan and a comp are currently two separate lists, but they are
-- the same thing — there is really only a SITE, and on a site you can plan it, place a deal on it,
-- or just write down what you know about it (a comp, or a note like "quoting $6/ft, nothing has
-- transacted"). This migration is the data-layer half of that: it does NOT touch site-planner/
-- lib/siteModel.js's `role` field (that ships in the same PR, additive, no backfill needed — every
-- existing site defaults to "pursuit" with zero bytes written, see siteStatus.js's own comment for
-- why). It only closes the OTHER half: giving each of the three live, unattached comps an owning
-- site.
--
-- WHAT THIS DOES, per live (deleted_at is null), unattached (project_id is null) comp:
--   1. Look for an existing PURSUIT site (any live plan in the group, same account) whose geo
--      `origin` sits within LOCATION_MATCH_MILES of the comp's own lat/lon. If found, attach the
--      comp to that site (`comps.project_id = <that site's group id>`) — no new site is created.
--   2. Otherwise, create a brand-new site with role "tracked" — location = the comp's own
--      lat/lon, name = the comp's own title (or "Tracked property" if it has none), county = the
--      comp's own county — and attach the comp to it.
-- Each comp is judged INDEPENDENTLY, per NEW-1's own instruction ("for EACH of the three live
-- comps"): two comps that happen to sit near EACH OTHER but not near any existing site each get
-- their OWN new tracked site — this migration never merges them on a guess. A later merge (e.g.
-- the owner deciding two Tesla comps belong on one tracked site) is a NEW-2+ product decision with
-- a UI to drive it, not something this one-time script should infer.
--
-- SAFETY (this touches live owner data — 30+ sites, 3 live comps, all real):
--   • Recovery snapshots of BOTH tables are taken FIRST, unconditionally, before anything else
--     runs — `create table if not exists`, so a second run of this file can never overwrite the
--     true pre-migration snapshot with an already-migrated state.
--   • Soft-delete-only elsewhere in this codebase is not implicated: this script never deletes,
--     un-deletes, or hand-writes a resurrection. It only INSERTs new `sites` rows and UPDATEs
--     `comps.project_id` on rows that currently read NULL there — no existing field on any
--     existing site or comp is touched, so every pre-existing row reads back byte-identical
--     except the three comps' new `project_id`.
--   • Idempotent: the loop only ever selects a comp whose `project_id` is still NULL, so re-running
--     this file after a successful run does nothing (0 rows match), and it can never create a
--     second tracked site for a comp that already has one.
--   • LOCATION_MATCH_MILES = 0.5 — generous enough to cover "same property, a slightly different
--     pin" (measured live: the owner's own site-plan pin for the Airtex flyer sits ~0.11 mi from
--     his "Core 5 - West Hardy" comp's own pin) without falsely matching a genuinely different
--     nearby property. Verified against production 2026-09-05 BEFORE writing this script: none of
--     the three live comps matched any existing site's origin within this radius (the closest was
--     ~0.95 mi, Richey to "Core 5 - West Hardy") — so all three created new tracked sites this run.
--     The matching branch is real, exercised-by-design code for the NEXT comp that genuinely sits
--     on an existing site, not dead code kept only because it didn't fire this time.

create table if not exists public.recovery_20260905_sites_snapshot as table public.sites;
create table if not exists public.recovery_20260905_comps_snapshot as table public.comps;

do $$
declare
  c record;
  matched_group text;
  new_id text;
  match_miles constant double precision := 0.5;
  n_attached int := 0;
  n_created int := 0;
begin
  for c in
    select id, title, comp_type, lat, lon, county, user_id
    from public.comps
    where deleted_at is null and project_id is null
    order by created_at
  loop
    matched_group := null;

    select coalesce(s.data->>'groupId', s.id) into matched_group
    from public.sites s
    where s.deleted_at is null
      and s.user_id = c.user_id
      and coalesce(s.data->>'role', 'pursuit') = 'pursuit'
      and s.data #>> '{origin,lat}' is not null
      and s.data #>> '{origin,lon}' is not null
      and (
        3959 * acos(least(1.0, greatest(-1.0,
          cos(radians(c.lat)) * cos(radians((s.data #>> '{origin,lat}')::double precision)) *
          cos(radians((s.data #>> '{origin,lon}')::double precision) - radians(c.lon)) +
          sin(radians(c.lat)) * sin(radians((s.data #>> '{origin,lat}')::double precision))
        )))
      ) <= match_miles
    order by 1
    limit 1;

    if matched_group is not null then
      update public.comps set project_id = matched_group where id = c.id;
      n_attached := n_attached + 1;
    else
      new_id := 'trk' || substr(md5(c.id::text || clock_timestamp()::text || random()::text), 1, 10);
      insert into public.sites (id, user_id, group_id, site, name, county, updated_at, data, version)
      values (
        new_id, c.user_id, new_id,
        coalesce(nullif(trim(c.title), ''), 'Tracked property'),
        'Market record',
        c.county,
        now(),
        jsonb_build_object(
          'schemaVersion', 15,
          'id', new_id,
          'groupId', new_id,
          'site', coalesce(nullif(trim(c.title), ''), 'Tracked property'),
          'name', 'Market record',
          'role', 'tracked',
          'updatedAt', (extract(epoch from now()) * 1000)::bigint,
          'origin', jsonb_build_object('lat', c.lat, 'lon', c.lon),
          'county', c.county
        ),
        1
      );
      update public.comps set project_id = new_id where id = c.id;
      n_created := n_created + 1;
    end if;
  end loop;

  raise notice 'site_role_unify_backfill: % comp(s) attached to an existing site, % new tracked site(s) created', n_attached, n_created;
end $$;

-- Verify (read-only; safe to run any time) -------------------------------------------------------
--   select id, title, project_id from public.comps where deleted_at is null order by created_at;
--   select id, site, county, data->>'role' as role from public.sites where id in
--     (select project_id from public.comps where deleted_at is null);
