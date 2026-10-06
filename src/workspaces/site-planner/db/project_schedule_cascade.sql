-- NEW-1 / NEW-2 (2026-10-05) — a project and its SCHEDULE live and die together; a plan's "has a
-- schedule" hint can never outlive the schedule it names. Run ONCE in the Supabase SQL editor.
-- Idempotent; ADDITIVE (one nullable column, two functions, two triggers; no policy change).
--
-- THE BUGS THIS CLOSES (measured on production 2026-10-05, drift report D03 / D04):
--  · D03 — schedule 24 "Untitled site" stayed LIVE after its project was soft-deleted (2026-09-11)
--    and the Dashboard's Schedule Health card kept listing it. Deleting a project only ever
--    stamped `sites.deleted_at`; nothing carried that to `schedules`.
--  · D04 — two live Goose Creek plans carried `data.scheduleProjectId = "23"` for a schedule row
--    that no longer exists, so the switcher showed a "Has a schedule" calendar that led nowhere.
--    The hint is a client-side MIRROR of the schedule list; when a schedule row went away by any
--    route the app's own heal did not see (a row removed outside the app, the heal losing a race),
--    the mirror stayed.
--
-- THE FIX IS AT THE DATABASE because the failure was "some path forgot", and a trigger runs for
-- EVERY path, every client vintage:
--  1. sites → schedules. When the LAST live plan of a project is soft-deleted, every live schedule
--     linked to that project is soft-deleted with the SAME `deleted_at`, and tagged
--     `deleted_with_project = <group id>`. Restoring the project (any plan back to live) restores
--     exactly the schedules carrying that tag — a schedule the user deleted on its own earlier is
--     never resurrected. Deleting ONE plan of a project that still has a live sibling touches
--     nothing (the project, and so its schedule, is still alive).
--  2. schedules → sites. When a schedule leaves (soft-deleted OR hard-deleted), any plan hint that
--     names it is cleared. The clear bumps `version` (sites_enforce_version_monotonic refuses a
--     content write without one — the same shape `rename_site_group` uses) so a client holding the
--     old copy takes its ordinary stale-CAS self-heal path. A project-delete cascade clears the
--     hints on the dead plans too; the client's derive-from-schedules heal re-writes the hint when
--     the project is restored and the schedule returns.
--
-- The DERIVED truth stays `schedules.linked_site_id` (the schedule says which project it belongs
-- to); the hint is only ever a mirror of it. Nothing here makes the hint authoritative.

-- LOCK SAFETY: an ALTER TABLE queues for an exclusive lock, and while it waits it blocks every query behind it
-- (a dry run of this file against production timed out at 60 s on exactly that wait, 2026-10-05). Fail fast
-- instead of queueing: if the next line errors with "lock timeout", just run the file again a few seconds later.
set lock_timeout = '3s';

alter table public.schedules add column if not exists deleted_with_project text;
comment on column public.schedules.deleted_with_project is
  'Set (to the project/group id) only when the schedule was soft-deleted BY its project being deleted; '
  'a project restore brings back exactly the schedules carrying this tag. Null for a schedule the user '
  'deleted directly. NEW-1 2026-10-05.';

create or replace function public.sites_cascade_schedules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gid  text := coalesce(new.data->>'groupId', new.group_id, new.id);
  v_keys text[];
begin
  if old.deleted_at is null and new.deleted_at is not null then
    -- the project is only gone once its LAST live plan is
    if exists (select 1 from public.sites s
                where coalesce(s.data->>'groupId', s.group_id, s.id) = v_gid
                  and s.deleted_at is null) then
      return new;
    end if;
    select array_agg(distinct k) into v_keys from (
      select s.id as k from public.sites s where coalesce(s.data->>'groupId', s.group_id, s.id) = v_gid
      union select v_gid
    ) q;
    update public.schedules
       set deleted_at = new.deleted_at, deleted_with_project = v_gid
     where deleted_at is null and linked_site_id = any (v_keys);
  elsif old.deleted_at is not null and new.deleted_at is null then
    update public.schedules
       set deleted_at = null, deleted_with_project = null
     where deleted_with_project = v_gid and deleted_at is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists sites_cascade_schedules_trg on public.sites;
create trigger sites_cascade_schedules_trg
  after update of deleted_at on public.sites
  for each row when (old.deleted_at is distinct from new.deleted_at)
  execute function public.sites_cascade_schedules();

create or replace function public.schedules_clear_plan_hints()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and not (old.deleted_at is null and new.deleted_at is not null) then
    return new;
  end if;
  update public.sites s
     set data       = (s.data - 'scheduleProjectId') - 'scheduleProjectName',
         version    = coalesce(s.version, 1) + 1,
         updated_at = now()
   where s.data->>'scheduleProjectId' = old.id::text;
  return coalesce(new, old);
end;
$$;

drop trigger if exists schedules_clear_plan_hints_trg on public.schedules;
create trigger schedules_clear_plan_hints_trg
  after update of deleted_at or delete on public.schedules
  for each row execute function public.schedules_clear_plan_hints();

revoke execute on function public.sites_cascade_schedules() from public;
revoke execute on function public.schedules_clear_plan_hints() from public;
