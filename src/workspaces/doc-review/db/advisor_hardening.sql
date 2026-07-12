-- Supabase security-advisor hardening (NEW-F8, delete-safety batch 2026-07-12).
--
-- Re-issues two trigger functions with a PINNED search_path (advisor lint
-- 0011_function_search_path_mutable): a function without a fixed search_path can be redirected
-- by a role-mutable path. Both bodies are byte-identical to their home files —
--   • project_folders_guard_drive_cols — src/workspaces/doc-review/db/project_folders.sql
--     (the pin is now also in that file, so a fresh setup run is correct on its own)
--   • guard_team_rehome — src/workspaces/site-planner/db/team_rehome_guard.sql (already pinned
--     in the repo since 2026-06-26; the LIVE DB still runs the older unpinned version)
-- Re-running CREATE OR REPLACE does not touch the triggers that call these. Idempotent.
--
-- NOT addressed here, deliberately:
--   • planar_data / planar_history / planar_suggestions anon-write policies — the standalone
--     scheduler page saves signed-out BY DESIGN; planar_history snapshots every save (its own
--     recovery layer) and anon DELETE is already blocked. Documented as an accepted advisor
--     finding in docs/REFERENCE.md.
--   • Leaked-password protection — an Auth dashboard toggle, not SQL (OWNER-TODO.md).

create or replace function public.project_folders_guard_drive_cols()
returns trigger language plpgsql set search_path = pg_catalog as $$
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

create or replace function public.guard_team_rehome()
returns trigger language plpgsql
set search_path = pg_catalog  -- lock the search path (satisfies the Supabase linter + defense-in-depth)
as $$
begin
  if new.team_id is distinct from old.team_id and old.user_id is distinct from auth.uid() then
    raise exception 'Only the project owner can change sharing (team_id).' using errcode = '42501';
  end if;
  return new;
end;
$$;
