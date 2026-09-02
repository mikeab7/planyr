-- Comps: soft delete, mirroring sites/doc_reviews/site_plan_overlays' own `deleted_at` pattern
-- (B1066368, owner live-drive report on the deployed app, 2026-09-02 — "deleting a comp
-- destroys it with no confirmation and no way back, while the panel's Recently deleted section
-- stays empty"). Run once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi) AFTER
-- comps.sql. Idempotent: safe to re-run.
--
-- ROOT CAUSE (read the delete path and the Recently deleted query, as the report asked):
-- (a) comps.js's deleteComp() was a real hard `DELETE FROM comps` with no `deleted_at` column at
--     all — comps were the ONE table in this feature area with no soft-delete story, contradicting
--     the sites/doc_reviews/site_plan_overlays precedent already shipped for exactly this reason.
-- (b) There was no comps-specific "Recently deleted" UI in CompsPanel.jsx at all — the "Recently
--     deleted" disclosure the owner saw and expanded belongs to the adjacent "Your sites" tab
--     (SitePlansSection.jsx), which lists soft-deleted SITE PLANS, not comps; it can never show a
--     deleted comp because it never queries `comps`. Both findings are real; (a) is the actual bug
--     (comps had no recovery path at all) and this migration + its store/UI changes fix it. (b) is
--     now also fixed — CompsPanel.jsx grows its own "Recently deleted" section, the same shape as
--     the site-plans one, reading `comps` instead.
alter table public.comps add column if not exists deleted_at timestamptz;

create index if not exists comps_deleted_at_idx
  on public.comps (user_id, deleted_at)
  where deleted_at is not null;
create index if not exists comps_live_comp_date_idx
  on public.comps (user_id, comp_date desc)
  where deleted_at is null;

-- Verify (read-only; safe to run any time) ------------------------------------------------------
--   select column_name from information_schema.columns where table_name = 'comps'
--     and column_name = 'deleted_at';   -- expect 1 row
--   select indexname from pg_indexes where tablename = 'comps'
--     and indexname in ('comps_deleted_at_idx', 'comps_live_comp_date_idx');  -- expect 2 rows
