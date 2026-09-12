-- ⛔ CORRECTED 2026-09-12 (B1568880, "NEW-2" cleanup dispatch) — A PRIOR SESSION'S "referenced ZERO
-- TIMES IN THE SHIPPED BUNDLE" CLAIM ABOUT THIS FUNCTION WAS A MEASUREMENT ARTIFACT, NOT A FINDING.
-- THIS RPC IS THE LIVE, PRIMARY RENAME PATH. Read this before "cleaning up" this file again.
--
-- A 2026-09-11 dispatch treated this function as dead code — "referenced zero times across 29
-- loaded JS chunks" — and it cost three prior sessions of fixes (including the RAISE guard a few
-- lines down) aimed at code the app supposedly never reaches. It does reach it: `cloudRenameGroup()`
-- (`lib/cloudRename.js`) calls `supabase.rpc("rename_site_group", …)` as its PRIMARY path, from
-- `storage.renameSiteGroup()` — the one rename entry point every UI surface (map right-click,
-- header project dropdown) goes through. Audited against the RUNNING system on 2026-09-12, not
-- reasoned about:
--   • `pg_get_functiondef` against `planyr_production` (`lyeqzkuiwngunutlkkmi`) returns this exact
--     function body, deployed, and `grant execute` to `authenticated` in place.
--   • `edge_logs` for that project show real `POST .../rest/v1/rpc/rename_site_group` calls
--     returning 200 — three in a row at 2026-09-12T02:41:24 / 02:41:54 / 02:42:47Z, matching the
--     owner's own hand-verification the same day: three consecutive renames of one project, each
--     holding, surviving a full page reload.
--   • A full local `vite build` places the literal string in its own lazy chunk
--     (`dist/assets/cloudRename-*.js`) — present, just not EAGERLY loaded.
--   • `test/renameStampIntegrity.test.js` already pins `rpcCalls[0].fn === "rename_site_group"` as
--     a standing regression guard on this exact wiring.
--
-- THE MECHANISM OF THE FALSE LEAD, so it is not repeated: `cloudRename.js` is deliberately reached
-- only by a dynamic `import()` fired from `storage.renameSiteGroup` — a rename is rare and
-- user-initiated, so its code should not ride the boot bundle every page load pays for (see that
-- file's own header). A chunk scan that never actually triggers a rename never loads that chunk, so
-- counting references in only the chunks a passive page load fetches will always read zero — the
-- same species of mistake `/CLAUDE.md`'s DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 and WRONG-CASE already
-- catalog (the probe's own inaction produced the reading, not the code under test). This is a
-- DIFFERENT question from "did the migration below ever get run" — it did, and the running function
-- matches this file byte for byte.
--
-- SO: do not delete this function as dead code, and it needs no "wiring up" — it is already the
-- sole primary writer of an atomic group rename. The RAISE guard below stays: it is reachable by
-- ANY authenticated caller (this function is granted to `authenticated`, callable directly over
-- PostgREST by anyone signed in, not only by the one client call site that happens to always pass a
-- valid stamp today), so it remains real defense-in-depth, not dead ceremony. See B1568880 in
-- BACKLOG.md for the full audit. The group_id-COLUMN-drift note below is unrelated and still
-- correct — separately filed as B366386, measured latent for every real owner project — do not
-- "fix" it here.
--
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
-- ⛔ DELIBERATE SCOPE, STATED HERE SO IT ISN'T ONLY IMPLICIT IN THE WHERE CLAUSE: this UPDATE
-- carries `and s.deleted_at is null` — an ordinary interactive rename never reaches into the
-- caller's trash. That is correct, but it means a row soft-deleted moments before a group rename
-- keeps its stale name FOREVER, invisible everywhere in the product yet still readable by any
-- query that doesn't filter `deleted_at` (group `smsrpaiqu5sv`'s anchor row sat this way for
-- weeks, B1037954/B1060784). The sibling function `reconcile_site_group_name()`
-- (db/reconcile_site_group_name.sql) is the trash-inclusive twin for exactly that cleanup — never
-- called from the app, only from the account-wide reconciliation script.
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
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_at bigint;
begin
  -- ⛔ NEW-1 — REFUSE AN EMPTY STAMP BY NAME. `jsonb_set` is STRICT, so a NULL `p_renamed_at` makes
  -- the whole expression NULL and the statement tries to set `data` to NULL. MEASURED, not assumed:
  -- `public.sites.data` is NOT NULL today, so the attempt aborts the whole group update with
  -- `23502 null value in column "data"` rather than destroying anything — the outcome is safe but
  -- the message names a column the caller never touched, and the safety rests entirely on a
  -- constraint this function does not own. Refusing here says what actually went wrong, and keeps
  -- saying it if that constraint is ever relaxed. Unreachable from today's client (`cloudRenameGroup`
  -- coerces with `Number(renamedAt) || Date.now()`) — which is exactly why it belongs here rather
  -- than being trusted there: this function is granted to `authenticated`, so any caller can reach
  -- it. LOUD-FAILURE: the client surfaces `error.message` straight onto the rename banner.
  if p_renamed_at is null or p_renamed_at <= 0 then
    raise exception 'rename_site_group: p_renamed_at must be a positive epoch-ms timestamp (got %)', p_renamed_at
      using errcode = '22004';
  end if;

  -- ⛔ HARDENED 2026-09-12 (B1584512) — THE WRITTEN STAMP IS AUTHORITATIVE, NEVER JUST THE CALLER'S
  -- GUESS. `sites_rename_stamp_guard.sql`'s trigger now refuses any write that is not STRICTLY
  -- newer than a row's own STORED stamp (closing "an older stamp wins" — see that file). The
  -- caller's `p_renamed_at` is computed client-side from `Math.max(Date.now(), newest-LOCAL-stamp +
  -- 1)` — a genuinely later rename made from a device whose local cache does not include every plan
  -- in this group could still name a value lower than a stamp already sitting on a row it hasn't
  -- seen, and with the trigger now strict that row would REFUSE while its siblings accept, reopening
  -- exactly the split-name defect this function exists to close. So take the group's own current
  -- maximum here, from the SAME rows the update below is about to touch, and write
  -- `greatest(caller's value, that maximum + 1)` — strictly newer than every row in the group by
  -- construction, so the trigger can never partially refuse a genuine group rename. A caller whose
  -- value already clears that bar (the ordinary case) is unaffected byte-for-byte.
  select greatest(p_renamed_at, coalesce(max(public.rename_stamp(s.data -> 'siteRenamedAt')), 0) + 1)
    into v_at
    from public.sites s
   where coalesce(s.data->>'groupId', s.id) = p_group_id
     and s.deleted_at is null;

  return query
  update public.sites s
     set site       = p_site,
         data       = jsonb_set(
                        jsonb_set(coalesce(s.data, '{}'::jsonb), '{site}', to_jsonb(p_site), true),
                        '{siteRenamedAt}', to_jsonb(v_at), true),
         version    = coalesce(s.version, 1) + 1,
         updated_at = now()
   where coalesce(s.data->>'groupId', s.id) = p_group_id
     and s.deleted_at is null
  returning s.id, s.version;
end;
$$;

comment on function public.rename_site_group(text, text, bigint) is
  'Rename a project (site group) in one atomic statement across every plan row in the group. '
  'SECURITY INVOKER — existing RLS on public.sites decides what the caller may rename. HARDENED '
  '2026-09-12 (B1584512) — the stamp actually written is greatest(caller''s value, the group''s own '
  'current max real stamp + 1), so it is always strictly newer than every row it touches.';

grant execute on function public.rename_site_group(text, text, bigint) to authenticated;
