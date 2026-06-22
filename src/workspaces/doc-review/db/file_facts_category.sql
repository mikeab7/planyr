-- Document Review — Work Item B file-browser IA: add CATEGORY (the canonical top-level
-- tree node) and STATE (the filing-lifecycle facet) to the file-facts index.
-- Run once in the Supabase SQL editor after db/file_facts.sql. Additive + idempotent.
--
-- Mapping to the existing schema (no duplicate columns):
--   • category        — NEW (canonical: Drawings, Surveys, Plats, Title, Geotechnical,
--                       Environmental, Permits/Entitlements, Reports/Studies, Agreements)
--   • subcategory     — REUSES `discipline` (the data-driven second level)
--   • state           — NEW (needs_filing | filed | superseded)
--   • on_map          — DERIVED from `placement` / the review's placed flag (no column)
--   • parse_confidence — REUSES `match_confidence`
--   • title_block_*   — REUSE sheet_number / sheet_title / revision / doc_date
--
-- The store DEGRADES gracefully until this runs: category/state are derived from
-- discipline + the needs_filing flag (categoryOf / stateOf in shared/files/fileFacts.js),
-- so the tree works with or without the migration — no regression.

alter table public.file_facts add column if not exists category text; -- canonical top-level node
alter table public.file_facts add column if not exists state    text; -- needs_filing | filed | superseded

-- Browse the tree fast: project → category → discipline (subcategory), newest first.
create index if not exists file_facts_category_idx
  on public.file_facts (user_id, project_id, category, discipline, doc_date desc);
