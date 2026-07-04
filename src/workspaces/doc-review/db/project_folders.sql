-- Per-project folder tree — Planyr's authoritative folder index (B645). Run once in the
-- Supabase SQL editor; idempotent + safe to re-run. Lives alongside the existing file index
-- (project_library.sql / file_facts.sql) — this is the SAME index auto-filing routes into,
-- not a parallel store. Private-by-default RLS, same shape as public.drive_files.
--
-- Two column groups, written by two different actors (disjoint, so no write conflict):
--   • STRUCTURE (client-written, supabase-js, own-row RLS): parent_id / name / sort_order /
--     trashed — the authoritative tree the user edits in the Library. Instant, no server hop.
--   • DRIVE MIRROR BOOKKEEPING (server-written, functions/api/folders.js with the caller's
--     token): drive_folder_id / drive_parent_id / drive_name / drive_trashed — what was last
--     pushed to Google Drive. Reconcile is one-way (Planyr → Drive) and BY drive_folder_id,
--     never by path, so a rename/move acts on the existing Drive folder in place.

create table if not exists public.project_folders (
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id               uuid not null default gen_random_uuid(),
  project_id       text not null,                 -- the Site Planner site-group (sites.group_id)
  parent_id        uuid,                          -- null = a top-level category (Drive parent = project root)
  name             text not null,
  sort_order       integer not null default 0,    -- sibling sort key (1-based); ties break on name
  trashed          boolean not null default false, -- soft-deleted: mirror trashes it in Drive, then it hides
  -- Drive mirror bookkeeping (server-written; null until the first reconcile pushes it):
  drive_folder_id  text,                          -- the folder's own Google Drive id
  drive_parent_id  text,                          -- parent's Drive id at last push (null = project root)
  drive_name       text,                          -- name at last push (diff vs. name → a rename)
  drive_trashed    boolean not null default false, -- already moved to Drive trash
  template_version integer,                        -- FOLDER_TEMPLATE version this row was seeded from
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, id)
);

-- Browse/reconcile path: a project's tree, parent-then-child, in sort order.
create index if not exists project_folders_proj_idx
  on public.project_folders (user_id, project_id, parent_id, sort_order);

-- Reconcile looks folders up by their Drive id; keep that scoped + fast.
create index if not exists project_folders_drive_idx
  on public.project_folders (user_id, drive_folder_id);

alter table public.project_folders enable row level security;

-- Private by default: each user only ever sees/writes their own folder rows.
do $$ begin
  create policy "Users select own project_folders" on public.project_folders for select to authenticated using ((select auth.uid()) = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Users insert own project_folders" on public.project_folders for insert to authenticated with check ((select auth.uid()) = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Users update own project_folders" on public.project_folders for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "Users delete own project_folders" on public.project_folders for delete to authenticated using ((select auth.uid()) = user_id);
exception when duplicate_object then null; end $$;
