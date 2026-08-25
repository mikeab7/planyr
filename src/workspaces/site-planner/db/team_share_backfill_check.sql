-- ============================================================================
-- Team-share consistency audit (B714 follow-up). DIAGNOSTIC BY DEFAULT — the
-- SELECT below is safe to run any time; the repair template at the bottom is
-- commented out and must be reviewed + run PER CASE by a human. Never wire this
-- into a migration pipeline or run it unattended.
--
-- WHAT IT LOOKS FOR: a project GROUP (coalesce(data->>'groupId', id)) whose own
-- rows disagree on team_id — some plans in the group carry a share, others read
-- null. That is the exact signature the pre-B714 bug left behind (an autosave
-- from a stale in-memory model silently reverting team_id back to null on some,
-- but not all, of a group's plans) — see db/team_share_default.sql and
-- BACKLOG.md B714 for the root cause and the fix (team_id is now write-isolated
-- to the explicit set_project_team() RPC, guarded by the sites_team_share_guard
-- trigger, so this signature cannot be produced by any ordinary write path
-- going forward). This script exists to catch any pre-fix damage that is still
-- sitting in the data, or any future regression of the same shape.
--
-- Run this file's SELECT in the Supabase SQL editor (project lyeqzkuiwngunutlkkmi).
-- An empty result means no group is in an inconsistent state.
--
-- Audited 2026-08-23 (the session that added this file): 0 groups matched.
-- ============================================================================

select coalesce(data->>'groupId', id) as group_key,
       array_agg(id order by updated_at desc)              as site_ids,
       count(*)                                             as total_rows,
       count(*) filter (where team_id is null)              as null_rows,
       count(*) filter (where team_id is not null)          as shared_rows,
       array_agg(distinct team_id) filter (where team_id is not null) as team_ids_seen,
       array_agg(distinct user_id)                          as owners
from public.sites
where deleted_at is null
group by 1
having count(*) filter (where team_id is null) > 0
   and count(*) filter (where team_id is not null) > 0
order by 1;

-- ----------------------------------------------------------------------------
-- REPAIR TEMPLATE — do NOT run without reviewing the specific group above.
-- This is a maintenance write to sites.team_id and MUST bypass the
-- sites_team_share_guard trigger deliberately (it exists to refuse exactly this
-- kind of direct UPDATE from anyone else). Confirm with the project owner which
-- team_id is the INTENDED one for the group before running anything below —
-- do not infer intent from the majority value alone.
--
--   begin;
--   set local session_replication_role = replica;  -- bypass the share-intent trigger for this maintenance statement only
--   update public.sites
--     set team_id = '<the-intended-team-uuid>'
--     where coalesce(data->>'groupId', id) = '<group_key-from-above>'
--       and deleted_at is null
--       and team_id is distinct from '<the-intended-team-uuid>';
--   reset session_replication_role;
--   commit;
--
-- After running, re-run the SELECT above to confirm the group no longer appears.
-- ============================================================================
