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

-- No two LIVE sibling folders may share a name (case-insensitive) — the rename path + the Drive
-- mirror assume sibling names are unique. This is also the atomic cross-tab/device guard against
-- a double-seed: a concurrent second seed's insert collides here and fails wholesale (no partial
-- tree), so a project can never end up with two copies of the template. coalesce() gives NULL
-- (top-level) parents a fixed key so top-level names are unique too; trashed rows are excluded so
-- a name can be reused after delete.
create unique index if not exists project_folders_sibling_unique
  on public.project_folders (user_id, project_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where trashed = false;

alter table public.project_folders enable row level security;

-- ── Drive-mirror bookkeeping is SERVER-authoritative ────────────────────────────────────────
-- The drive_* columns tell the server which Google Drive folder to rename/move/trash. If a client
-- could write them, it could point a server-side Drive op at an arbitrary folder id (all folders
-- live in one shared service-account Drive). RLS can't scope columns, so a trigger blocks any
-- change to drive_* made under the client role ('authenticated'); the server writes them only via
-- folder_set_drive_meta() (SECURITY DEFINER → runs as the owner role, so the trigger allows it).
-- Structure-only client updates (name / parent_id / sort_order / trashed) never touch drive_*, so
-- they are unaffected.
create or replace function public.project_folders_guard_drive_cols()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and (
       new.drive_folder_id is distinct from old.drive_folder_id
    or new.drive_parent_id is distinct from old.drive_parent_id
    or new.drive_name      is distinct from old.drive_name
    or new.drive_trashed   is distinct from old.drive_trashed
  ) then
    raise exception 'drive_* columns are server-managed (use folder_set_drive_meta)';
  end if;
  return new;
end $$;

drop trigger if exists project_folders_guard_drive on public.project_folders;
create trigger project_folders_guard_drive
  before update on public.project_folders
  for each row execute function public.project_folders_guard_drive_cols();

-- Server-only writeback for the mirror bookkeeping. SECURITY DEFINER so it bypasses the guard
-- trigger, but still scoped to the CALLER's own row via auth.uid() — a user can only ever set
-- drive_* on folders they own. Partial: only the keys present in p_patch are written (a present
-- key with a null value DOES set null, e.g. a top-level move clears drive_parent_id).
create or replace function public.folder_set_drive_meta(p_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.project_folders set
    drive_folder_id = case when p_patch ? 'drive_folder_id' then p_patch->>'drive_folder_id' else drive_folder_id end,
    drive_parent_id = case when p_patch ? 'drive_parent_id' then p_patch->>'drive_parent_id' else drive_parent_id end,
    drive_name      = case when p_patch ? 'drive_name'      then p_patch->>'drive_name'      else drive_name end,
    drive_trashed   = case when p_patch ? 'drive_trashed'   then (p_patch->>'drive_trashed')::boolean else drive_trashed end,
    updated_at = now()
  where id = p_id and user_id = auth.uid();
end $$;
grant execute on function public.folder_set_drive_meta(uuid, jsonb) to authenticated;

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
