-- Adds electrical service and dock-door count to public.comps (NEW-2, comps records search; the
-- power / dock-door filters in the Records tab need the fields to exist). Run once in the Supabase
-- SQL editor (project lyeqzkuiwngunutlkkmi) AFTER comps.sql and comps_value_constraints.sql.
-- Idempotent: safe to re-run. Additive and nullable — no existing row changes.
--
--   power_amps   integer   service size in amps, the number people quote ("2,000A")
--   power_volts  integer   e.g. 480
--   power_phase  smallint  1 or 3
--   dock_doors   integer   dock-high door count
--
-- Applies to BUILDING_SALE and LEASE comps only; enforced client-side by compSheetColumns.js
-- `appliesTo` (same as comps_building_specs.sql), not by a DB constraint.

alter table public.comps add column if not exists power_amps integer;
alter table public.comps add column if not exists power_volts integer;
alter table public.comps add column if not exists power_phase smallint;
alter table public.comps add column if not exists dock_doors integer;

-- Own constraint names so they never collide with the comps_amounts_non_negative list that
-- comps_value_constraints.sql / comps_building_specs.sql re-create (both drop-and-add it).
alter table public.comps drop constraint if exists comps_power_docks_non_negative;
alter table public.comps add constraint comps_power_docks_non_negative check (
  (power_amps is null or power_amps >= 0) and
  (power_volts is null or power_volts >= 0) and
  (dock_doors is null or dock_doors >= 0)
);

alter table public.comps drop constraint if exists comps_power_phase_1_or_3;
alter table public.comps add constraint comps_power_phase_1_or_3 check (
  power_phase is null or power_phase in (1, 3)
);

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'comps'
--     and column_name in ('power_amps','power_volts','power_phase','dock_doors');   -- expect 4 rows
--   select conname from pg_constraint where conrelid = 'public.comps'::regclass and contype = 'c'
--     and conname in ('comps_power_docks_non_negative','comps_power_phase_1_or_3');  -- expect 2 rows
