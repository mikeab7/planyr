-- B1517888 — Block a HARD DELETE of a `sites` row while its project GROUP still has a live
-- (non-soft-deleted) plan. Run ONCE in the Supabase SQL editor. Idempotent; safe to re-run.
-- ADDITIVE: adds one function, one expression index, and one BEFORE DELETE trigger. Changes no
-- existing column and no existing policy.
--
-- ============================================================================================
-- THE BUG THIS CLOSES — URGENT, confirmed live on the owner's own machine, 2026-09-11
-- ============================================================================================
-- B1469872 (shipped the day before this file) taught `purgeExpiredDeletedProjects`
-- (site-planner `lib/storage.js`) to skip hard-deleting a soft-deleted plan whose project group
-- still has a live sibling plan. That guard is CLIENT-SIDE ONLY — it lives in the JS bundle, not
-- the database. A browser tab that loaded its bundle before that fix deployed has no such check
-- in its code at all, and `buildSkew.js`'s "a newer build is available" notice is deliberately
-- non-blocking and dismissible (that module's own header explains why) — nothing forces such a
-- tab to reload. Confirmed live: a planyr.io tab open 34.6 hours (loaded well before the fix
-- deployed) was still running the unguarded sweep on the owner's own machine.
--
-- `ProjectBreadcrumb.jsx`'s `refreshBin()` fires `purgeExpiredDeletedProjects` on EVERY
-- project-switcher dropdown open. A stale tab that opens the switcher after a soft-deleted plan's
-- 30-day retention window (`DELETED_RETENTION_DAYS`) has elapsed calls `cloudHardDelete` on it
-- with zero further checks — and `site_elements_site_id_fkey` is `ON DELETE CASCADE`, so that
-- DELETE also destroys every element row the plan holds. This was not hypothetical: a real,
-- currently-worked project (Bain "Concept A - Quiddity V1", 45 live elements, 4 live sibling
-- plans) had a soft-deleted plan scheduled to become auto-purge-eligible within hours of this
-- file being written.
--
-- The only place this can be closed for EVERY client — stale or current, this session's fix or
-- a browser nobody has looked at in days — is the database: a BEFORE DELETE trigger runs
-- regardless of which JS bundle issued the DELETE, so no client vintage can skip it.
--
-- ============================================================================================
-- THE GROUP KEY — DELIBERATE CHOICE, AND WHY
-- ============================================================================================
-- Two candidate keys exist for "which project does this plan belong to": the `group_id` COLUMN,
-- and `coalesce(data->>'groupId', id)` computed from the row's own jsonb. `rename_site_group.sql`
-- and the site-planner workspace's own `CLAUDE.md` (documenting `projectName.js`) both say the
-- COLUMN is a denormalized MIRROR that is KNOWN TO DRIFT from the jsonb ("the e2e fixture rows
-- disagree today").
--
-- This guard uses `coalesce(data->>'groupId', id)` — the SAME key `rename_site_group()` and
-- `set_site_group_role()` already trust for a group-wide write — and deliberately NOT the
-- `group_id` column. A drifted column could either UNDER-protect (miss a real live sibling
-- because the column disagrees with the jsonb, letting a destructive delete through) or
-- OVER-protect (falsely link two unrelated rows and block a legitimate one). This is a
-- destructive, irreversible action, so it must use the value every other group-wide write in
-- this codebase already treats as authoritative — never the mirror documented to drift.
--
-- (The existing CLIENT-side liveness check this guard backs up — `cloudCheckDeleted` /
-- `cloudDeleteGroup` / `listDeletedPlansInGroup` in `cloudSync.js` / `storage.js` — reads the
-- `group_id` COLUMN instead. That is a separate, pre-existing choice, left untouched here:
-- reconciling that drift generally is real, separate work, out of scope for this urgent fix. A
-- server-side guard keyed on the AUTHORITATIVE jsonb value is strictly more protective than the
-- column-keyed client check it backs up, never less — so leaving the client path as-is cannot
-- reopen the hole this file closes.)
--
-- ============================================================================================
-- WHY THIS DOES NOT BREAK A LEGITIMATE WHOLE-PROJECT PURGE
-- ============================================================================================
-- The rule is "refuse when a LIVE (deleted_at IS NULL) sibling remains" — never "refuse when any
-- other row exists". Every hard-delete call site in the app (`purgeDeletedProject` — "Delete
-- forever", called both from the account-wide bin and from a single plan's per-project trash —
-- and the 30-day `purgeExpiredDeletedProjects` sweep) only ever acts on rows that are ALREADY
-- soft-deleted (found via `cloudDeletedRows`). So a genuinely dead project — every plan in its
-- group already soft-deleted — has NO live sibling anywhere in the group, before or after any one
-- of its rows is removed; the check passes for every member regardless of delete order, whether
-- the client issues one DELETE per row (the app's current `Promise.all` shape) or a future
-- batched statement. Only a plan whose group has a plan that is STILL genuinely live trips this —
-- which is exactly, and only, the case this file exists to stop.
--
-- ⚠ KNOWN, DELIBERATE CONSEQUENCE: the plan menu's own per-plan "Delete forever"
-- (`SitePlanner.jsx`'s `purgeDeletedProject([p.id], groupId)`, offered for a plan discarded from
-- an otherwise-still-live project — see `listDeletedPlansInGroup`'s header) will now ALSO refuse
-- while that plan's group has any other live plan. Before this file, that manual action could
-- permanently destroy real element data (the same cascade) from an active project with one click
-- and no server-side check at all — this was already the more dangerous of the two paths, just
-- not the one an unattended timer could trigger. The refusal now surfaces exactly like any other
-- purge failure (`cloudHardDelete`'s existing error handling → the UI's existing "couldn't be
-- permanently deleted" toast), loudly, not silently. If a way to intentionally purge one dead
-- plan out of a live project is wanted, that is a distinct, deliberate follow-up feature — not
-- built here, and not silently reopened by this fix either.
--
-- ============================================================================================
-- FAIL-SAFE
-- ============================================================================================
-- The check runs inside the same transaction as the DELETE it is guarding; any error while
-- evaluating it aborts the whole statement, so an inconclusive check can never fall through to a
-- destructive default. Nothing here weakens the existing DELETE RLS policy ("delete own or
-- team-admin sites") — this trigger fires strictly in addition to it, after RLS has already
-- permitted the delete, as a second, independent refusal.
--
-- Idempotent — safe to re-run.

-- ---------------------------------------------------------------------------
-- 1) The guard. BEFORE DELETE, per row:
--      (a) refuse if this row was never even soft-deleted (belt-and-suspenders — every real
--          caller only ever hard-deletes an already-trashed row);
--      (b) refuse if another row sharing this row's group key still has deleted_at IS NULL
--          (i.e. is LIVE).
-- ---------------------------------------------------------------------------
create or replace function public.sites_block_delete_live_group()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  gkey    text := coalesce(old.data->>'groupId', old.id);
  live_id text;
begin
  if old.deleted_at is null then
    raise exception 'sites_block_delete_live_group: refusing to permanently delete % — it is not in the trash (deleted_at is null)', old.id
      using errcode = 'PLYR1';
  end if;

  select s.id into live_id
    from public.sites s
   where coalesce(s.data->>'groupId', s.id) = gkey
     and s.id <> old.id
     and s.deleted_at is null
   limit 1;

  if live_id is not null then
    raise exception 'sites_block_delete_live_group: refusing to permanently delete % — its project group % still has a live plan (%)', old.id, gkey, live_id
      using errcode = 'PLYR1';
  end if;

  return old;
end;
$$;

comment on function public.sites_block_delete_live_group() is
  'BEFORE DELETE guard (B1517888): refuses to hard-delete a sites row while its project group '
  '(coalesce(data->>''groupId'', id)) still has a live (deleted_at is null) plan, or while the '
  'row itself was never soft-deleted. See db/sites_block_delete_live_group.sql for the production '
  'incident behind it.';

-- ---------------------------------------------------------------------------
-- 2) An expression index on the same group-key computation, so the guard's lookup (and any
--    future query keyed the same way) never has to scan the whole table.
-- ---------------------------------------------------------------------------
create index if not exists sites_group_key_idx
  on public.sites (coalesce(data->>'groupId', id));

-- ---------------------------------------------------------------------------
-- 3) The trigger.
-- ---------------------------------------------------------------------------
drop trigger if exists sites_block_delete_live_group on public.sites;
create trigger sites_block_delete_live_group
  before delete on public.sites
  for each row execute function public.sites_block_delete_live_group();

-- Verification (run after): db/test/sites_block_delete_live_group.test.sql — self-rolling-back,
-- proves a smshwnnijjfi-shaped delete is refused and a genuinely dead group still purges cleanly.
