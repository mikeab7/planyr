-- Comps — adds lease_escalation_pct (B986096). Run once in the Supabase SQL editor (project
-- lyeqzkuiwngunutlkkmi), AFTER comps.sql. Idempotent.
--
-- WHY: a broker's lease abstract routinely states an annual rent escalation ("3.50% annual
-- increases") — a normal, materially-valuable term of an industrial lease that changes what
-- the deal is worth over its term. It has no column today; rather than dropping it into notes
-- (where it's invisible to any structured read), it gets a real column, matching how every
-- other lease term here (lease_ti, lease_term, lease_free_rent_months) was added incrementally
-- as it turned out to matter. Deliberately a single flat annual percentage, not a schedule —
-- that is the shape every abstract pasted into this app so far actually states.

alter table public.comps add column if not exists lease_escalation_pct numeric;
comment on column public.comps.lease_escalation_pct is
  'Annual lease rate escalation, percent (e.g. 3.50 for 3.5%/yr). LEASE comps only. Nullable.';

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name from information_schema.columns where table_name = 'comps' and column_name = 'lease_escalation_pct';
