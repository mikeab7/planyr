-- Site-plan overlays — replace the 2-control-point georeference with a direct placement
-- (B848496 NEW-2). Run once in the Supabase SQL editor, AFTER site_plan_overlays.sql already
-- created the table. Idempotent. Safe to run even though it's DESTRUCTIVE (drops
-- control_points/scale_ft_per_px/fit_residual_ft/scale_check_ft/scale_check_note) — as of
-- this migration `public.site_plan_overlays` holds zero rows in production, confirmed via
-- `select count(*)` before writing this file, so nothing is lost.
--
-- WHY: the owner rejected the control-point wizard outright ("just mimic the way it works on
-- the site planner module for references... you were introducing too much friction") and it
-- had also shipped a real defect — a plan placed upside down, because a 2-point similarity
-- fit is under-constrained and can silently mirror. The replacement is a DIRECT placement
-- (center + uniform scale + rotation) driven by on-map drag handles, mirroring the Site
-- Planner's own reference-image tool — see shared/sitePlans/lib/overlayGeoref.js.

alter table public.site_plan_overlays drop column if exists control_points;
alter table public.site_plan_overlays drop column if exists scale_ft_per_px;
alter table public.site_plan_overlays drop column if exists fit_residual_ft;
alter table public.site_plan_overlays drop column if exists scale_check_ft;
alter table public.site_plan_overlays drop column if exists scale_check_note;

alter table public.site_plan_overlays add column if not exists center_lat double precision;
alter table public.site_plan_overlays add column if not exists center_lon double precision;
alter table public.site_plan_overlays add column if not exists ft_per_px double precision;
alter table public.site_plan_overlays add column if not exists locked boolean not null default false;
alter table public.site_plan_overlays add column if not exists source_file_name text;

-- rotation_deg already exists (was a derived cache column) — now authoritative; give it the
-- NOT NULL + default the new writer relies on.
alter table public.site_plan_overlays alter column rotation_deg set default 0;
update public.site_plan_overlays set rotation_deg = 0 where rotation_deg is null;
alter table public.site_plan_overlays alter column rotation_deg set not null;

alter table public.site_plan_overlays drop constraint if exists site_plan_overlays_control_points_shape;
alter table public.site_plan_overlays drop constraint if exists site_plan_overlays_ft_per_px_positive;
alter table public.site_plan_overlays add constraint site_plan_overlays_ft_per_px_positive
  check (ft_per_px is null or ft_per_px > 0);

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='site_plan_overlays' order by ordinal_position;
