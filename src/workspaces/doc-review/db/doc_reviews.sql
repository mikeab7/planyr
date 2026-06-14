-- Document Review — cloud persistence schema.
-- Run once in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi). Idempotent:
-- safe to re-run. Mirrors the Site Planner `public.sites` table + RLS exactly —
-- private by default, each user only ever sees their own rows and their own files.
--
-- Two stores per review:
--   public.doc_reviews (Postgres)  -> the small work layer: markups, measurements,
--     calibration, stitch transforms, takeoff, and the source-file references.
--   storage 'doc-review-files'     -> the source PDF bytes, at <uid>/<reviewId>/<srcId>.pdf.
-- The client (src/workspaces/doc-review/lib/reviewStore.js) reuses the app's existing
-- anon Supabase client + auth session; no service-role key is ever used in the browser.

-- 1) Table -------------------------------------------------------------------
create table if not exists public.doc_reviews (
  id          text not null,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text,
  kind        text,                 -- 'single' | 'stitch'
  project     text,                 -- free-text project ref (future: FK into the filing index)
  discipline  text,                 -- e.g. 'Civil', 'Landscape', 'Survey'
  updated_at  timestamptz not null default now(),
  data        jsonb not null,       -- serialized review model (see reviewStore.js)
  primary key (user_id, id)
);

create index if not exists doc_reviews_user_updated_idx
  on public.doc_reviews (user_id, updated_at desc);

-- 2) RLS — private by default (identical shape to public.sites) ---------------
alter table public.doc_reviews enable row level security;

drop policy if exists "Users select own reviews" on public.doc_reviews;
drop policy if exists "Users insert own reviews" on public.doc_reviews;
drop policy if exists "Users update own reviews" on public.doc_reviews;
drop policy if exists "Users delete own reviews" on public.doc_reviews;

create policy "Users select own reviews" on public.doc_reviews
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own reviews" on public.doc_reviews
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own reviews" on public.doc_reviews
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete own reviews" on public.doc_reviews
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 3) Private Storage bucket for the source PDFs ------------------------------
-- Path convention <uid>/<reviewId>/<srcId>.pdf puts the owner's user id first so
-- the policies below can key off it. The 50 MB cap matches the free tier; the app
-- flags larger files "re-drop on load" instead of failing the save.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('doc-review-files', 'doc-review-files', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/pdf'];

-- 4) Storage RLS — each user only ever touches files under their own uid folder
drop policy if exists "Users read own review files"   on storage.objects;
drop policy if exists "Users upload own review files" on storage.objects;
drop policy if exists "Users update own review files" on storage.objects;
drop policy if exists "Users delete own review files" on storage.objects;

create policy "Users read own review files" on storage.objects
  for select to authenticated
  using (bucket_id = 'doc-review-files' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "Users upload own review files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'doc-review-files' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "Users update own review files" on storage.objects
  for update to authenticated
  using (bucket_id = 'doc-review-files' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "Users delete own review files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'doc-review-files' and (select auth.uid())::text = (storage.foldername(name))[1]);
