-- Comps — a FOURTH record type: UNDER CONSTRUCTION (competing supply). Run once in the Supabase SQL
-- editor (project lyeqzkuiwngunutlkkmi), AFTER comps.sql, comps_value_constraints.sql and
-- comps_power_docks.sql. Idempotent: safe to re-run.
--
-- WHAT THIS IS (owner ask, 2026-11-24): "add buildings under construction with similar info entries,
-- under the same umbrella as the transaction record feature." A building being built is NOT a new
-- table or module: it is a `comps` row whose `comp_type` is 'under_construction', so it rides the
-- SAME rows, RLS policies (team-read / owner-write — unchanged, NOT re-stated here), site link,
-- anchors, list, search/filters, site-record panel, map pins and phone sheet as every other record.
--
-- FIELD MAPPING (reuse before adding — no competing second column for a fact `comps` already holds):
--   name/address     -> title + the anchor (pin / parcel / site plan), as for every comp
--   developer        -> comp_party_provider   (labelled "Developer" for this type)
--   tenant if known  -> comp_party_acquirer   (labelled "Tenant")
--   size (SF)        -> bldg_size_sf          (the building's size, same column a building sale uses)
--   clear height, dock doors, power -> clear_height_ft, dock_doors, power_*  (unchanged)
--   asking rate      -> lease_rate / lease_rate_period / lease_rate_expense (same period rule: a rate
--                       with no period is refused by comps_lease_rate_requires_period)
--   notes / source   -> notes
-- NEW COLUMNS (only what had no home):
--   uc_status          'planned' | 'under_construction' | 'delivered'
--   uc_delivery_kind   'spec' | 'bts'   (speculative, or built-to-suit for a signed tenant)
--   uc_start_date      construction start
--   uc_delivery_date   expected (or actual) delivery
--   uc_preleased_pct   0..100
-- comp_date stays NULL for these rows (it is the executed date of a TRANSACTION); a delivered
-- building converts to a regular lease / sale record in the app by changing comp_type and clearing
-- the uc_* columns (`comps.js` `convertDeliveredComp`).

alter table public.comps drop constraint if exists comps_comp_type_check;
alter table public.comps add constraint comps_comp_type_check
  check (comp_type in ('land', 'building_sale', 'lease', 'under_construction'));

alter table public.comps add column if not exists uc_status        text;
alter table public.comps add column if not exists uc_delivery_kind text;
alter table public.comps add column if not exists uc_start_date    date;
alter table public.comps add column if not exists uc_delivery_date date;
alter table public.comps add column if not exists uc_preleased_pct numeric;

alter table public.comps drop constraint if exists comps_uc_status_check;
alter table public.comps add constraint comps_uc_status_check
  check (uc_status is null or uc_status in ('planned', 'under_construction', 'delivered'));
alter table public.comps drop constraint if exists comps_uc_delivery_kind_check;
alter table public.comps add constraint comps_uc_delivery_kind_check
  check (uc_delivery_kind is null or uc_delivery_kind in ('spec', 'bts'));
alter table public.comps drop constraint if exists comps_uc_preleased_pct_check;
alter table public.comps add constraint comps_uc_preleased_pct_check
  check (uc_preleased_pct is null or (uc_preleased_pct >= 0 and uc_preleased_pct <= 100));

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name from information_schema.columns where table_name = 'comps' and column_name like 'uc_%';  -- 5 rows
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'comps_comp_type_check';
