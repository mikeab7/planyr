-- Adds `lease_free_rent_months` (rent-abatement period at lease commencement, in months) to
-- public.comps — the LEASE comp type's missing free-rent input (NEW-2; provisional label until
-- the real B# is minted at push time, per /CLAUDE.md's LATE-BIND rule). Nullable numeric,
-- optional — same treatment as `lease_ti` (LEASE's analogous optional numeric field). Run once
-- in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi), AFTER db/comps.sql and
-- db/comps_lease_size.sql. Idempotent: safe to re-run.
--
-- WHY: free rent is standard on an industrial lease comp and was previously uncapturable. Once
-- it exists, the form's derived "Total annual rent" is no longer the whole truth for a comp with
-- free rent — see NEW-3, which labels that total FACE rent rather than computing an effective
-- (net-of-abatement) figure, which the owner has not yet approved.

alter table public.comps add column if not exists lease_free_rent_months numeric;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'comps' and column_name = 'lease_free_rent_months';
