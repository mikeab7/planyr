-- Adds `lease_size_sf` (leased area, SF) to public.comps — the LEASE comp type's missing size
-- input (B647824). Nullable numeric, optional — same treatment as `bldg_size_sf` (BUILDING
-- SALE's analogous size column) and `land_size_value` (LAND's own size column). Run once in the
-- Supabase SQL editor (project lyeqzkuiwngunutlkkmi), AFTER db/comps.sql. Idempotent: safe to
-- re-run.
--
-- WHY: a lease comp's `lease_rate` is already $/SF, so without a leased-area figure there is no
-- way to turn a comp into a total annual rent, and any cross-comp average can only be a plain,
-- unweighted mean of $/SF — which misrepresents a set of deals with very different sizes (a
-- 90,000 SF deal at $6/SF and a 10,000 SF deal at $10/SF are NOT "$8/SF on average" to anyone
-- pricing off them). `summarizeLeaseComps` (lib/comps.js) now weights its NNN/gross averages by
-- this field, PER BASIS GROUP, only when EVERY comp in that group has it — and falls back to the
-- previous unweighted mean, explicitly flagged `weighted:false`, when any comp in the group is
-- missing it, so a weighted and an unweighted figure can never be silently blended into one
-- number. `leaseTotalAnnualRent` (rate x size) is the per-comp total the field also unlocks.

alter table public.comps add column if not exists lease_size_sf numeric;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'comps' and column_name = 'lease_size_sf';
