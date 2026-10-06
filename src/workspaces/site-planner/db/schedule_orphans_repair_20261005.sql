-- NEW-1 / NEW-2 (2026-10-05) — ONE-TIME, NON-DESTRUCTIVE repair of the two drift rows the cascade fixes
-- going forward (drift report D03, D04). Run AFTER db/project_schedule_cascade.sql (it needs the
-- `schedules.deleted_with_project` column). Idempotent; safe to re-run; deletes nothing.
--
--  1. D03 — a live schedule whose project has NO live plan left (production: schedule 24 "Untitled site",
--     project smtxbxh59fqt soft-deleted 2026-09-11). It is SOFT-deleted with the project's own deleted_at and
--     tagged, exactly as the trigger would have done, so restoring the project brings it back.
--  2. D04 — a plan whose `scheduleProjectId` hint names no live schedule linked to its project (production:
--     smu1t5vcp73y / smu2z4hz93ew -> "23", a schedule row that does not exist). The hint is REPOINTED at the
--     project's own live schedule when it has one, otherwise cleared. Version is bumped (the version guard
--     refuses a content write without it), so any stale client self-heals through its ordinary CAS path.
--
-- Dry-run: wrap in `begin; … rollback;` and read the two counts at the bottom first.

-- 1. orphan schedules -> soft-deleted with their (fully deleted) project
with dead as (
  select coalesce(s.data->>'groupId', s.group_id, s.id) as gid, max(s.deleted_at) as at
    from public.sites s
   group by 1
  having bool_and(s.deleted_at is not null)
)
update public.schedules sc
   set deleted_at = d.at, deleted_with_project = d.gid
  from dead d, public.sites p
 where sc.deleted_at is null
   and (p.id = sc.linked_site_id or p.group_id = sc.linked_site_id)
   and coalesce(p.data->>'groupId', p.group_id, p.id) = d.gid;

-- 2. dangling hints -> repoint at the project's live schedule, else clear
with fix as (
  select p.id,
         (select min(sc.id) from public.schedules sc
           where sc.deleted_at is null
             and sc.linked_site_id in (p.id, p.group_id, coalesce(p.data->>'groupId', p.id))) as live_id
    from public.sites p
   where p.data->>'scheduleProjectId' is not null
     and not exists (select 1 from public.schedules sc
                      where sc.deleted_at is null and sc.id::text = p.data->>'scheduleProjectId'
                        and sc.linked_site_id in (p.id, p.group_id, coalesce(p.data->>'groupId', p.id)))
)
update public.sites p
   set data = case when f.live_id is null
                   then (p.data - 'scheduleProjectId') - 'scheduleProjectName'
                   else jsonb_set(p.data, '{scheduleProjectId}', to_jsonb(f.live_id)) end,
       version = coalesce(p.version, 1) + 1,
       updated_at = now()
  from fix f
 where p.id = f.id;
