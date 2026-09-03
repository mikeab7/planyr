-- Comps — missing value-integrity CHECK constraints (adversarial review finding NEW-4,
-- 2026-09-02: "constraints the database should make and does not"). Run once in the Supabase
-- SQL editor (project lyeqzkuiwngunutlkkmi) AFTER comps.sql. Idempotent: safe to re-run.
--
-- THE GAP THIS CLOSES: the comp entry sheet already refuses to save a lease rate with no stated
-- period (compParse.js's blocking flag, finalizeGenericRow) and the UI never lets you type a
-- negative price — but neither of those is a database guarantee. Any OTHER writer (a future
-- script, a direct API call, a bug in a code path that doesn't go through the sheet) could still
-- insert a 12x-ambiguous rate or a negative price with nothing to stop it. The 12x error is
-- blocked in the UI and was open at the database — this migration closes it there too, so the
-- guarantee holds regardless of which code path writes the row.
--
-- FOUR CONSTRAINTS:
--   1. A lease rate with no period is meaningless (it could mean 12 different things) — require
--      one whenever the other is set, mirroring `comps_parcel_anchor_has_identity`'s own
--      "field X requires field Y" shape.
--   2. Every dollar/size figure this product ever quotes is non-negative — a negative price,
--      rate, TI allowance, or size is a data-entry error, never a real value.
--   3. `bldg_cap_rate` is stored as a DECIMAL FRACTION (0.075 for 7.5% — see comps.js's
--      `resolveCapTriangle` and compSheetColumns.js's own get/set pair, both already documented
--      as using this convention). A value of 7.5 instead of 0.075 would be a 100x scale error
--      that today saves cleanly; the range (0, 1] catches it while still allowing a genuinely
--      unusual double-digit-percent cap rate.
--   4. `lease_term` stays free TEXT, deliberately — NOT converted to an integer-months column.
--      This was already decided, not overlooked: HARDENING-10 (compSheetColumns.js's own header)
--      chose free text specifically because a real deal can be "10 yr + 2x5 options", which a
--      bare-months field can't hold; the sheet's own Term cell reduces it to a bare month count
--      at the CELL boundary only (`monthsFromTermText`), leaving the stored field untouched. A
--      parallel structured numeric column (for reliable future sort/filter) is real, separate
--      follow-up work — see BACKLOG.md — not a fix to what's already a deliberate choice.

alter table public.comps drop constraint if exists comps_lease_rate_requires_period;
alter table public.comps add constraint comps_lease_rate_requires_period check (
  lease_rate is null or lease_rate_period is not null
);

alter table public.comps drop constraint if exists comps_amounts_non_negative;
alter table public.comps add constraint comps_amounts_non_negative check (
  (land_price is null or land_price >= 0) and
  (bldg_price is null or bldg_price >= 0) and
  (lease_rate is null or lease_rate >= 0) and
  (lease_ti is null or lease_ti >= 0) and
  (land_size_value is null or land_size_value >= 0) and
  (bldg_size_sf is null or bldg_size_sf >= 0) and
  (lease_size_sf is null or lease_size_sf >= 0)
);

alter table public.comps drop constraint if exists comps_cap_rate_range;
alter table public.comps add constraint comps_cap_rate_range check (
  bldg_cap_rate is null or (bldg_cap_rate > 0 and bldg_cap_rate <= 1)
);

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select conname from pg_constraint where conrelid = 'public.comps'::regclass and contype = 'c'
--     and conname in ('comps_lease_rate_requires_period', 'comps_amounts_non_negative', 'comps_cap_rate_range');
--   -- expect 3 rows
