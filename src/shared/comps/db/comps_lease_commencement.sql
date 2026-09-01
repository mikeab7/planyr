-- Comps — adds lease_commencement_date (B986096-HARDENING-6). Run once in the Supabase SQL
-- editor (project lyeqzkuiwngunutlkkmi), AFTER comps.sql. Idempotent.
--
-- WHY: comp_date (NOT NULL) is EXECUTION/CLOSING date — the deal's signing date, the one every
-- recency filter and sort already reads. A LEASE'S COMMENCEMENT (rent-start) date is a
-- DIFFERENT fact about a different moment — Michael's own real abstract stated only a
-- commencement ("estimated to be June 1, 2027") with no separate signing date anywhere in it.
-- Before this column, the entry parser folded a commencement into comp_date itself (soft-
-- flagged, with a note in `notes` disambiguating it) — real, but it meant the commencement
-- itself was never a queryable fact, only prose. Now it is: a comp with both stated gets BOTH
-- real facts; a comp with only a commencement still gets comp_date filled (soft-flagged, so the
-- required field isn't left blank) AND the commencement itself lands here, honestly, in its own
-- column. Lease-only in practice (a sale has one closing date, not a separate commencement) but
-- left ungated at the DB level, matching every other lease-only column here (lease_term,
-- lease_ti, ...) — the app is what enforces which fields apply per comp type, not a CHECK.

alter table public.comps add column if not exists lease_commencement_date date;
comment on column public.comps.lease_commencement_date is
  'Lease rent-commencement date, distinct from comp_date (execution/closing). LEASE comps only, by app convention. Nullable.';

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name from information_schema.columns where table_name = 'comps' and column_name = 'lease_commencement_date';
