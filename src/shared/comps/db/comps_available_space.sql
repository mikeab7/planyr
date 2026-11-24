-- Comps — a FIFTH record type: AVAILABLE SPACE (a vacancy). Run once in the Supabase SQL editor
-- (project lyeqzkuiwngunutlkkmi), AFTER comps_under_construction.sql. Idempotent: safe to re-run.
--
-- WHAT THIS IS (owner ask, 2026-11-24: "we should also log vacancies"; approved shape: one "Log
-- supply" menu row with Under construction / Available space inside). Like under construction it
-- is SUPPLY, not a transaction: a `comps` row whose `comp_type` is 'available', on the SAME rows,
-- RLS policies (team-read / owner-write — unchanged, NOT re-stated here), anchors, list, filters,
-- record panel, map pins and phone sheet. It never enters an average.
--
-- FIELD MAPPING (reuse before adding):
--   landlord         -> comp_party_provider   (labelled "Landlord")
--   listing broker   -> comp_party_acquirer   (labelled "Listing broker"; cleared when it converts)
--   available SF     -> lease_size_sf         (becomes the leased SF when it converts to a lease)
--   building size    -> bldg_size_sf          (optional)
--   asking rate      -> lease_rate / lease_rate_period / lease_rate_expense (period rule unchanged)
--   clear height, dock doors, power, notes   (unchanged)
-- NEW COLUMNS:
--   av_kind   'direct' | 'sublease'
--   av_date   the date the space is available
-- comp_date stays NULL (nothing signed).

alter table public.comps drop constraint if exists comps_comp_type_check;
alter table public.comps add constraint comps_comp_type_check
  check (comp_type in ('land', 'building_sale', 'lease', 'under_construction', 'available'));

alter table public.comps add column if not exists av_kind text;
alter table public.comps add column if not exists av_date date;

alter table public.comps drop constraint if exists comps_av_kind_check;
alter table public.comps add constraint comps_av_kind_check
  check (av_kind is null or av_kind in ('direct', 'sublease'));

-- Verify (read-only):
--   select column_name from information_schema.columns where table_name = 'comps' and column_name like 'av_%';  -- 2 rows
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'comps_comp_type_check';
