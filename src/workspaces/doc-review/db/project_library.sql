-- Document Review — Project Library (B14): link reviews/files to Project/Site records
-- and index them for a browseable folder structure. ADDITIVE migration — run once in
-- the Supabase SQL editor after db/doc_reviews.sql. Idempotent; safe to re-run.
--
-- Project lifecycle status is NOT added here: it already lives on the Site Model
-- (sites.data ->> 'status', states pursuit/active/onhold/complete/dead, applied per
-- site group — see siteModel.js / BACKLOG B7–B8). The library reads it from there and
-- edits it through the same Site Planner write path, so there's one source of truth.
--
-- Source PDFs keep using the existing private 'doc-review-files' bucket; only the
-- object path scheme changes (client-side) to <uid>/project-<id>/<discipline>/<srcId>.pdf.
-- The first path segment is still the owner's uid, so the existing Storage RLS policies
-- (keyed on (storage.foldername(name))[1] = auth.uid()::text) keep working unchanged.

-- File-index columns on the review record (discipline/project/title already exist).
alter table public.doc_reviews add column if not exists project_id text;  -- the Site/Project (sites.group_id) this review is filed under; null = Unfiled
alter table public.doc_reviews add column if not exists item       text;  -- type/item label, e.g. "Boundary Survey", "Grading Plan"
alter table public.doc_reviews add column if not exists revision   text;  -- revision label, e.g. "Rev 2", "IFC"
alter table public.doc_reviews add column if not exists doc_date   date;  -- the drawing/document date (drives newest-first ordering)

-- Browse path: by project, then discipline, newest document first.
create index if not exists doc_reviews_library_idx
  on public.doc_reviews (user_id, project_id, discipline, doc_date desc);
