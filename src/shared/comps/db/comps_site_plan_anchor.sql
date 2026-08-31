-- Comps — extend anchor_kind with a third anchor: a point on an uploaded, georeferenced site
-- plan (B848848). ADDITIVE migration; run once in the Supabase SQL editor AFTER comps.sql
-- and sitePlans/db/site_plan_overlays.sql. Idempotent.
--
-- `lat`/`lon` stay NOT NULL and authoritative on every comp, per the existing contract every
-- map view/list/filter already relies on (comps.sql) — a site-plan-anchored comp's lat/lon
-- come straight from the real map click on the placed plan (never left null). `site_plan_point`
-- is the extra snapshot this anchor kind carries — the click's lat/lon run back through the
-- overlay's placement (shared/sitePlans/lib/overlayGeoref.js latLonToImagePoint) to the
-- image-pixel point it corresponds to, for provenance/redraw — the same shape
-- `parcel_apn`/`parcel_geom` already play for the 'parcel' anchor kind.
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
