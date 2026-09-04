-- Adds `lease_opex` (operating expenses — taxes, insurance and CAM/reimbursements passed through
-- or absorbed under the deal's Basis — the comp's own quoted OpEx figure) to public.comps
-- (B843664 — owner chat block, "add opex as an optional input"; provisional label until the real
-- B# is minted at push time, per /CLAUDE.md's LATE-BIND rule). Nullable numeric, optional — same
-- treatment as `lease_ti`/`lease_free_rent_months` (LEASE's other optional numeric inputs). Run
-- once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi), AFTER db/comps.sql and
-- db/comps_value_constraints.sql. Idempotent: safe to re-run.
--
-- WHY: an industrial lease comp is quoted either NNN (base rent only — the tenant pays taxes,
-- insurance and CAM on top) or gross (the landlord pays those out of the rent). Today the sheet
-- records the rate and the Basis but never the operating expenses themselves, so an NNN comp and
-- a gross comp can't be honestly compared. Once OpEx exists, `comps.js`'s `opexNormalizedRate`
-- can approximate the OPPOSITE basis for a comp that states it — NNN base + OpEx ≈ the gross
-- equivalent, gross − OpEx ≈ the NNN equivalent — as a SEPARATE derived figure; it never changes
-- what the existing $/SF/yr derived column means, and `summarizeLeaseComps`' NNN/gross averages
-- are untouched (see that item's own note on the summary-average question, which is the owner's
-- call, not made here).
--
-- UNITS: fixed at $/SF/YR, regardless of whether the base rent is quoted MO or YR via the
-- existing Per selector — industrial OpEx is conventionally quoted $/SF/yr even when rent isn't,
-- and this avoids a second period selector nobody asked for. The column name and every label
-- reading it say so explicitly.

alter table public.comps add column if not exists lease_opex numeric;

-- Extend the existing non-negative-amounts guarantee (comps_value_constraints.sql) rather than
-- adding a parallel constraint — one place enumerates every dollar/size figure this product
-- guarantees is never negative.
alter table public.comps drop constraint if exists comps_amounts_non_negative;
alter table public.comps add constraint comps_amounts_non_negative check (
  (land_price is null or land_price >= 0) and
  (bldg_price is null or bldg_price >= 0) and
  (lease_rate is null or lease_rate >= 0) and
  (lease_ti is null or lease_ti >= 0) and
  (lease_opex is null or lease_opex >= 0) and
  (land_size_value is null or land_size_value >= 0) and
  (bldg_size_sf is null or bldg_size_sf >= 0) and
  (lease_size_sf is null or lease_size_sf >= 0)
);

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name, data_type, is_nullable from information_schema.columns
--   where table_schema = 'public' and table_name = 'comps' and column_name = 'lease_opex';
--   select conname from pg_constraint where conrelid = 'public.comps'::regclass and contype = 'c'
--     and conname = 'comps_amounts_non_negative';  -- confirm it still exists post-alter
