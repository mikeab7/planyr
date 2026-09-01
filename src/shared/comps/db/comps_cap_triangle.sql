-- Comps — adds bldg_noi + bldg_cap_rate (B986096-HARDENING-7, owner rule: "lets add an option for
-- cap on building sales"). Run once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi),
-- AFTER comps.sql. Idempotent.
--
-- WHY TWO COLUMNS, NOT ONE: cap rate = NOI / price. Cap alone is unverifiable and can't be
-- derived from anything else on the row, so NOI has to come with it — Michael's own instruction
-- ("Michael asked for cap; NOI has to come with it or cap is unverifiable"). Building-sale comps
-- only (land and lease are untouched); enforced in the app, not by a CHECK, matching every other
-- type-scoped column here (lease_term, lease_ti, ...).
--
-- PRECISION: plain `numeric` — unconstrained, no rounding at the column level. The app itself
-- never rounds the stored value either (only the RENDERED percentage is rounded, to 2 decimals);
-- see comps.js's resolveCapTriangle for why precision matters here (a cap rounded to one decimal
-- moves NOI by real money on an eight-figure asset).
--
-- UNIT CONVENTION: bldg_cap_rate is a DECIMAL FRACTION (0.0575 for 5.75%), never a percentage
-- number. This is DELIBERATELY DIFFERENT from lease_escalation_pct (a raw percentage, 3.5) —
-- each column's convention is internally consistent and neither is "wrong"; they must simply
-- never be read as interchangeable. Flagged here so the difference reads as a decision, not an
-- inconsistency, the next time someone compares the two columns side by side.

alter table public.comps add column if not exists bldg_noi numeric;
alter table public.comps add column if not exists bldg_cap_rate numeric;

comment on column public.comps.bldg_noi is
  'Building-sale net operating income, $/yr. Part of the Price/NOI/Cap triangle (any two determine the third — see comps.js resolveCapTriangle). Building-sale comps only, by app convention. Nullable.';
comment on column public.comps.bldg_cap_rate is
  'Building-sale cap rate as a DECIMAL FRACTION (0.0575 = 5.75%), never a percentage number — deliberately different from lease_escalation_pct''s convention. Part of the Price/NOI/Cap triangle. Building-sale comps only, by app convention. Nullable.';

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name, data_type from information_schema.columns
--   where table_name = 'comps' and column_name in ('bldg_noi', 'bldg_cap_rate');
