-- B2404337 (NEW-2, DB hardening block 2026-10-21) — project_folders.drive_* IS SERVER-MANAGED ON INSERT TOO.
--
-- MEASURED ON PRODUCTION (pg_trigger, 2026-10-19/21): `project_folders_guard_drive` was BEFORE UPDATE
-- only, and the INSERT policy "Users insert own project_folders" checks nothing but `auth.uid() = user_id`.
-- project_folders.sql's own header names the threat: every folder lives in ONE shared service-account
-- Drive, so a client that can write drive_* can aim a server-side Drive op at an arbitrary folder id.
-- The hole: an authenticated user INSERTs a row in their own project carrying someone else's
-- `drive_folder_id` and `trashed = true`; `POST /api/folders {action:"sync"}` (functions/api/folders.js →
-- server/storage/folderMirror.js, the `trashes` loop → `client.trash(t.driveFolderId)`) then trashes the
-- victim's Drive folder and every filed PDF under it. Rename / move are reachable the same way.
--
-- THE RULE: an INSERT by role `authenticated` with ANY drive_* value (`drive_folder_id` /
-- `drive_parent_id` / `drive_name` non-null, or `drive_trashed` true — that column is `not null default
-- false`) is refused with the same message the UPDATE guard uses. Nothing legitimate breaks: every real
-- drive_* write goes through the SECURITY DEFINER `folder_set_drive_meta()` RPC (measured: 5,923 calls,
-- the live path), and neither client nor server inserts drive_* directly —
--   • client: library/lib/folders.js `seedProjectFolders` inserts `buildSeedRows()` rows (id, project_id,
--     parent_id, name, sort_order, template_version) and `addFolder` inserts {id, project_id, parent_id,
--     name, sort_order}; no drive_* key on either (checked 2026-10-21).
--   • server: server/storage/folderStoreSupabase.js only SELECTs rows and PATCHes drive_* through the RPC
--     (`folder_set_drive_meta`); folderMirror.js / folderReconcile.js never INSERT a project_folders row.
--     A future service-role insert would be unaffected anyway (`current_user` is then `service_role`).
--
-- Same body as project_folders.sql (the home file carries the pin, so a fresh setup run is correct on
-- its own); this file is the idempotent re-issue for an existing database. Applied to production by the
-- shipping session. Proof: db/test/project_folders_drive_insert_guard.test.sql.

create or replace function public.project_folders_guard_drive_cols()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      if new.drive_folder_id is not null
         or new.drive_parent_id is not null
         or new.drive_name is not null
         or new.drive_trashed then
        raise exception 'drive_* columns are server-managed (use folder_set_drive_meta)';
      end if;
    elsif new.drive_folder_id is distinct from old.drive_folder_id
       or new.drive_parent_id is distinct from old.drive_parent_id
       or new.drive_name      is distinct from old.drive_name
       or new.drive_trashed   is distinct from old.drive_trashed then
      raise exception 'drive_* columns are server-managed (use folder_set_drive_meta)';
    end if;
  end if;
  return new;
end $$;

create or replace trigger project_folders_guard_drive
  before insert or update on public.project_folders
  for each row execute function public.project_folders_guard_drive_cols();
