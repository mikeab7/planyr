-- Document Review — file-facts index, WITH the Work Item B file-browser IA fields.
-- Run once in the Supabase SQL editor. SELF-CONTAINED + idempotent: it creates the
-- file_facts table if it has never been made (the base db/file_facts.sql was left dormant),
-- and just adds the two new columns if the table already exists. Safe to re-run.
--
-- Mirrors public.doc_reviews / public.sites RLS exactly — private by default, each user
-- only ever sees their own rows.
--
-- Work Item B fields (no duplicate columns):
--   • category        — NEW: the canonical top-level tree node (Drawings, Surveys, Plats,
--                       Title, Geotechnical, Environmental, Permits/Entitlements,
--                       Reports/Studies, Agreements)
--   • subcategory     — REUSES `discipline` (the data-driven second level)
--   • state           — NEW: needs_filing | filed | superseded
--   • on_map          — DERIVED from `placement` / the review's placed flag (no column)
--   • parse_confidence — REUSES `match_confidence`
--   • title_block_*   — REUSE sheet_number / sheet_title / revision / doc_date
--
-- The app DEGRADES gracefully without category/state (it derives them client-side), so the
-- tree works with or without this migration — running it just makes a manual "move to a
-- different folder" / "superseded" stick across reloads.

-- 1) Table (created if missing; columns added if it pre-existed) ---------------
create table if not exists public.file_facts (
  id               text not null,                  -- the file/source id (stable per filed drawing)
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  review_id        text,                           -- the doc_reviews row this file belongs to
  project_id       text,                           -- matched Site/Project (sites.group_id); null = needs filing
  category         text,                           -- canonical top-level node (Work Item B)
  discipline       text,                           -- = the data-driven subcategory (Survey / Civil / …)
  item             text,                           -- sheet title / type label
  sheet_number     text,                           -- the sheet id as printed (e.g. 'C-2.01')
  sheet_title      text,
  revision         text,
  doc_date         date,
  source_file      text,                           -- the human filename
  match_confidence real,                           -- 0..1 from the matcher (honest, never fabricated)
  needs_filing     boolean not null default false, -- true = low/no/ambiguous match → holding area
  state            text,                           -- needs_filing | filed | superseded (Work Item B)
  placement        jsonb,                          -- placement-readiness facts (placementFacts.js shape)
  updated_at       timestamptz not null default now(),
  primary key (user_id, id)
);

-- For a table that already existed (created from the older db/file_facts.sql), add the new
-- Work Item B columns. No-ops once present.
alter table public.file_facts add column if not exists category text;
alter table public.file_facts add column if not exists state    text;

-- Browse paths: by project → discipline, and by project → category → discipline, newest first.
create index if not exists file_facts_library_idx
  on public.file_facts (user_id, project_id, discipline, doc_date desc);
create index if not exists file_facts_category_idx
  on public.file_facts (user_id, project_id, category, discipline, doc_date desc);

-- 2) RLS — private by default (identical shape to public.doc_reviews) ----------
alter table public.file_facts enable row level security;

drop policy if exists "Users select own file_facts" on public.file_facts;
drop policy if exists "Users insert own file_facts" on public.file_facts;
drop policy if exists "Users update own file_facts" on public.file_facts;
drop policy if exists "Users delete own file_facts" on public.file_facts;

create policy "Users select own file_facts" on public.file_facts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own file_facts" on public.file_facts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own file_facts" on public.file_facts
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own file_facts" on public.file_facts
  for delete to authenticated using ((select auth.uid()) = user_id);
