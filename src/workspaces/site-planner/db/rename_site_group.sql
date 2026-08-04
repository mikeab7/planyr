-- NEW-1/NEW-2 — rename a PROJECT (a site group) in ONE atomic statement.
-- Run ONCE in the Supabase SQL editor. Idempotent; safe to re-run. ADDITIVE: adds a function,
-- changes no table, no column and no policy.
--
-- WHY THIS EXISTS
-- A project's name is denormalized: it is copied onto the `site` column (and `data->>'site'`) of
-- every plan row in the group. The client used to rename by iterating the plans it happened to
-- have in LOCAL storage, so any plan not hydrated in that browser was never written — it kept the
-- old name in the cloud and re-published it the next time it saved for any reason. Proven in
-- production: group smrp1wrgg6u5 sat split "Silvestri" (4 plans) / "Sylvestri" (1 plan, saved 17
-- minutes AFTER the rename) and showed as two entries in the map list.
--
-- This makes the rename ONE UPDATE over the whole group. Postgres applies a single statement
-- atomically, so the rename cannot half-land, and it reaches every plan in the group INCLUDING
-- ones the calling browser has never loaded.
--
-- SECURITY
--   • SECURITY INVOKER (the default) — the existing RLS policies on public.sites apply unchanged,
--     so a caller can only ever rename rows they are already permitted to update. No new surface.
--   • `search_path` is pinned, so the function body can't be redirected by a caller's search_path.
--   • It touches ONLY `site`, `data`, `version` and `updated_at`. It never writes `team_id`
--     (which would trip the guard_team_rehome BEFORE UPDATE trigger and could silently unshare a
--     project) and never writes `user_id` or `deleted_at`.
--
-- GROUP MATCHING — the group key is `coalesce(data->>'groupId', id)`, which is EXACTLY what the
-- client's `groupOf()` reads. The `group_id` COLUMN is a denormalized mirror that is known to
-- drift from the jsonb (the e2e fixture rows disagree today), so matching on it would rename the
-- wrong set. Do not "optimise" this onto the column.
--
-- BEFORE THIS RUNS the client degrades to a fetch-the-group-then-write-each-row fallback, which
-- still reaches every plan (fixing the split) but is not atomic — so saving and renaming are never
-- blocked by the migration being un-run; the rename simply isn't atomic yet.

create or replace function public.rename_site_group(
  p_group_id   text,
  p_site       text,
  p_renamed_at bigint
)
returns table (id text, version integer)
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  update public.sites s
     set site       = p_site,
         data       = jsonb_set(
                        jsonb_set(coalesce(s.data, '{}'::jsonb), '{site}', to_jsonb(p_site), true),
                        '{siteRenamedAt}', to_jsonb(p_renamed_at), true),
         version    = coalesce(s.version, 1) + 1,
         updated_at = now()
   where coalesce(s.data->>'groupId', s.id) = p_group_id
     and s.deleted_at is null
  returning s.id, s.version;
$$;

comment on function public.rename_site_group(text, text, bigint) is
  'Rename a project (site group) in one atomic statement across every plan row in the group. '
  'SECURITY INVOKER — existing RLS on public.sites decides what the caller may rename.';

grant execute on function public.rename_site_group(text, text, bigint) to authenticated;
