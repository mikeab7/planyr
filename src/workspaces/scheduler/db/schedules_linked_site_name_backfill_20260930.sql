-- NEW-1 (B1991040) — heal the STORED linked_site_name / data.linkedSiteName copies so they agree
-- with the project's current name. DISPLAY no longer depends on this (the app resolves the name by
-- linked_site_id at read time; scheduleOwnership.liveSiteName) — this only removes the stale text
-- that other readers of the column (reports, a SQL console) would otherwise still see.
--
-- Measured 2026-09-29: schedules id 6 "Master Schedule": linked_site_id smqgpt12zh5o,
-- linked_site_name "Pappadoupolos", while sites.site for that group reads "Papadopoulos".
--
-- SAFE BY CONSTRUCTION
--   • Touches ONLY linked_site_name and data->'linkedSiteName'. `name` (the schedule's own,
--     user-typed name) and `tasks` and every other key are never read or rewritten.
--   • Only rows whose stored copy DIFFERS from the live project name are updated; a re-run is a no-op.
--   • Only rows whose link resolves to a live sites row; an orphaned link keeps its text (the
--     documented fallback). Soft-deleted schedules are left alone.
--   • rev is bumped by one: schedules_enforce_version_monotonic refuses a `data` change unless rev
--     strictly increases, and an open Schedule tab then re-reads instead of overwriting.
--   • "Authoritative name of a group" = the newest rename stamp, else the newest row — the same
--     rule projectName.js applies client-side.
--
-- HOW TO RUN: Supabase SQL editor (runs as the table owner, so RLS does not hide other users' rows).
-- Step 1 is a read-only preview; run it first, then step 2.

-- 1) PREVIEW — what would change.
with live as (
  select distinct on (coalesce(group_id, id)) coalesce(group_id, id) as gid, site
  from public.sites
  where deleted_at is null and coalesce(nullif(trim(site), ''), null) is not null
  order by coalesce(group_id, id), nullif(data->>'siteRenamedAt','')::numeric desc nulls last, updated_at desc
)
select s.id, s.linked_site_id, s.linked_site_name as stored, l.site as live
from public.schedules s join live l on l.gid = s.linked_site_id
where s.deleted_at is null and s.linked_site_name is distinct from l.site;

-- 2) HEAL — snapshot first (this repo's backfill convention: a recovery table you can restore from).
create table if not exists public.recovery_20260930_schedules_linked_site_name_snapshot as table public.schedules;

with live as (
  select distinct on (coalesce(group_id, id)) coalesce(group_id, id) as gid, site
  from public.sites
  where deleted_at is null and coalesce(nullif(trim(site), ''), null) is not null
  order by coalesce(group_id, id), nullif(data->>'siteRenamedAt','')::numeric desc nulls last, updated_at desc
)
update public.schedules s
   set linked_site_name = l.site,
       data = jsonb_set(s.data, '{linkedSiteName}', to_jsonb(l.site), true),
       rev = s.rev + 1
  from live l
 where l.gid = s.linked_site_id
   and s.deleted_at is null
   and s.linked_site_name is distinct from l.site;
