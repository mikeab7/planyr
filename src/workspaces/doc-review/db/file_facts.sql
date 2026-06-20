-- Document Review — auto-filing file-facts index (B297).
-- Run once in the Supabase SQL editor after db/doc_reviews.sql + db/project_library.sql.
-- Idempotent; safe to re-run. Mirrors the public.doc_reviews / public.sites RLS exactly —
-- private by default, each user only ever sees their own rows.
--
-- WHY a separate table: doc_reviews holds the editable WORK layer (markups, calibration).
-- This is the queryable INDEX of facts the auto-filing read pulled off each drawing's title
-- block — one small row per filed file — so the library can answer "this project's Civil set,
-- latest revision" WITHOUT re-reading the PDF (the north-star: map → project → discipline →
-- latest set). The placement-readiness facts ride along (captured in the SAME read) so
-- "Place on map" doesn't reopen the file either.
--
-- Written server-side compute decides the facts (server/filing/), but the index itself lives
-- HERE in Supabase Postgres, not on /server (per the auto-filing spec: compute is stateless,
-- the file-facts index is data).

-- 1) Table -------------------------------------------------------------------
create table if not exists public.file_facts (
  id              text not null,                 -- the file/source id (stable per filed drawing)
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  review_id       text,                          -- the doc_reviews row this file belongs to
  project_id      text,                          -- matched Site/Project (sites.group_id); null = needs filing
  discipline      text,                          -- Survey / Civil / Architectural / …
  item            text,                          -- sheet title / type label
  sheet_number    text,                          -- the sheet id as printed (e.g. 'C-2.01')
  sheet_title     text,
  revision        text,
  doc_date        date,
  source_file     text,                          -- the human filename
  match_confidence real,                         -- 0..1 from the matcher (honest, never fabricated)
  needs_filing    boolean not null default false,-- true = low/no/ambiguous match → holding area
  placement       jsonb,                         -- placement-readiness facts (placementFacts.js shape)
  updated_at      timestamptz not null default now(),
  primary key (user_id, id)
);

-- Browse path: by project, then discipline, newest document first.
create index if not exists file_facts_library_idx
  on public.file_facts (user_id, project_id, discipline, doc_date desc);

-- 2) RLS — private by default (identical shape to public.doc_reviews) ---------
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
