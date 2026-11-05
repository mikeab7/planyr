-- Adds the electrical-service and dock-door facts to public.comps (NEW-2; provisional label until the
-- real B# is minted at push time, per /CLAUDE.md's LATE-BIND rule). Idempotent: safe to re-run.
-- Run AFTER comps.sql, comps_value_constraints.sql and comps_building_specs.sql (it re-states their
-- shared non-negative CHECK so one constraint enumerates every size/footage/count figure).
--
-- WHY: the Records search (NEW-1) filters on "power" and "dock doors", two standard industrial-comp
-- facts that had no field anywhere. All four are optional facts about the BUILDING, so they apply to
-- building_sale and lease comps only (enforced client-side by compSheetColumns.js `appliesTo`, like
-- clear_height_ft — a stray value on a land row is harmless dead data, not a hazard).
--
-- power_amps  : service size in amps — the number people quote ("2,000A").
-- power_volts : service voltage (e.g. 480).
-- power_phase : 1 or 3.
-- dock_doors  : dock-high door count.

alter table public.comps add column if not exists power_amps integer;
alter table public.comps add column if not exists power_volts integer;
alter table public.comps add column if not exists power_phase smallint;
alter table public.comps add column if not exists dock_doors integer;

alter table public.comps drop constraint if exists comps_amounts_non_negative;
alter table public.comps add constraint comps_amounts_non_negative check (
  (land_price is null or land_price >= 0) and
  (bldg_price is null or bldg_price >= 0) and
  (lease_rate is null or lease_rate >= 0) and
  (lease_ti is null or lease_ti >= 0) and
  (lease_opex is null or lease_opex >= 0) and
  (land_size_value is null or land_size_value >= 0) and
  (bldg_size_sf is null or bldg_size_sf >= 0) and
  (lease_size_sf is null or lease_size_sf >= 0) and
  (clear_height_ft is null or clear_height_ft >= 0) and
  (power_amps is null or power_amps >= 0) and
  (power_volts is null or power_volts >= 0) and
  (dock_doors is null or dock_doors >= 0)
);

alter table public.comps drop constraint if exists comps_power_phase_check;
alter table public.comps add constraint comps_power_phase_check check (
  power_phase is null or power_phase in (1, 3)
);

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'comps'
--     and column_name in ('power_amps', 'power_volts', 'power_phase', 'dock_doors');   -- expect 4 rows
--   select conname from pg_constraint where conrelid = 'public.comps'::regclass and contype = 'c'
--     and conname in ('comps_amounts_non_negative', 'comps_power_phase_check');       -- expect 2 rows
