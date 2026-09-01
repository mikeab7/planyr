-- Comps — extend anchor_kind with a third anchor: a point on an uploaded, georeferenced site
-- plan (B848848). ADDITIVE migration; run once in the Supabase SQL editor AFTER comps.sql
-- and sitePlans/db/site_plan_overlays.sql. Idempotent.
--
-- `lat`/`lon` stay NOT NULL on every comp, per the existing contract every map view/list/filter
-- already relies on (comps.sql) — but for a 'site_plan' anchor they are a DERIVED CACHE, not the
-- source of truth: `site_plan_point` (the {x,y} image-pixel point on the overlay the user
-- actually clicked) is authoritative, and lat/lon is that point run through the overlay's
-- CURRENT placement transform (shared/sitePlans/lib/overlayGeoref.js). See comps.js's
-- `validAnchor` for the full B972512-HARDENING item 2 writeup and
-- site_plan_overlays_comp_sync.sql for the mechanism (a SECURITY DEFINER RPC pair) that keeps
-- lat/lon in sync every time the overlay moves, including for a comp its own owner can't
-- normally write (comps' own UPDATE policy below is owner-only).
--
-- Coordination note: another session may be reworking `anchor_kind`'s switch in application
-- code (lib/comps.js) to be open-ended rather than an exhaustive two-way branch — this
-- migration only touches the DATABASE constraint and adds columns; it does not remove or
-- rename anything an in-flight branch could be relying on.

alter table public.comps add column if not exists site_plan_overlay_id uuid references public.site_plan_overlays(id) on delete set null;
alter table public.comps add column if not exists site_plan_point jsonb; -- {x,y} image-px point on the overlay; 'site_plan' anchor only

alter table public.comps drop constraint if exists comps_anchor_kind_check;
alter table public.comps add constraint comps_anchor_kind_check
  check (anchor_kind in ('pin', 'parcel', 'site_plan'));

alter table public.comps drop constraint if exists comps_parcel_anchor_has_identity;
alter table public.comps add constraint comps_parcel_anchor_has_identity check (
  anchor_kind = 'pin'
  or (anchor_kind = 'parcel' and (parcel_apn is not null or parcel_geom is not null))
  or (anchor_kind = 'site_plan' and site_plan_overlay_id is not null and site_plan_point is not null)
);

create index if not exists comps_site_plan_overlay_idx on public.comps (site_plan_overlay_id) where site_plan_overlay_id is not null;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'comps_anchor_kind_check';
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'comps_parcel_anchor_has_identity';
