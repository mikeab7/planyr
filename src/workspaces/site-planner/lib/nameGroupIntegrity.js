/* nameGroupIntegrity.js — THE detector for the data-integrity holes this module exists to close
 * permanently. Started with the two NEW-3 (2026-09-12 owner review, "our code was too susceptible
 * to issues with this and maybe had too many sources of truth") found, both measured against
 * `planyr_production` the same day:
 *
 *   1. A project's name is copied across up to FOUR places (the `site` column, the `data->>'site'`
 *      jsonb mirror, the client's localStorage cache, and — for a group with a linked Schedule —
 *      `data->>'scheduleProjectName'`) with nothing measured keeping the last of those in sync on
 *      a rename.
 *   2. A project's GROUP is keyed two different ways by different code: `rename_site_group()` /
 *      `reconcile_site_group_name()` / `set_project_team_state()` all resolve it as
 *      `coalesce(data->>'groupId', id)` (the jsonb); several client-side resolvers in storage.js /
 *      cloudSync.js still read the denormalized `group_id` COLUMN, which three SQL files in this
 *      repo already document as "known to drift from the jsonb" (rename_site_group.sql,
 *      set_site_group_role.sql, team_share_state.sql). B366386 fixed the sharing RPCs onto the
 *      jsonb key and found exactly one live disagreement — the seeded e2e fixture row
 *      `e2e-fixture-testfit` (a typo in e2e/seed/seed-fixtures.sql, fixed alongside this module) —
 *      against zero disagreement across every one of the owner's own 34 real project groups. The
 *      exposure is latent, not active, which is exactly why nothing before this caught it: a
 *      pure-logic detector, proven red on that seeded shape, so a future write path that DOES
 *      introduce drift (a migration, a duplicate-project path, a manual SQL fix) fails loudly
 *      instead of sitting unnoticed the way this one did.
 *
 * ⛔ NEW-1 (2026-09-15) added a THIRD, BLOCKING check: `unstampedRow`. A row with no valid rename
 * stamp is `sites_preserve_rename_stamp`'s (db/sites_rename_stamp_guard.sql) own no-op case —
 * "if prior_at is null then return new" — so it has NO protection at all, exactly the gap that let
 * a brand-new project (`smu1z3h60nbu`, created three days after the 2026-09-12 backfill closed
 * every row that existed THEN) get its name overwritten cleanly. `db/sites_rename_stamp_guard.sql`
 * now stamps every row at INSERT so this should never recur — this check is the permanent CI-side
 * proof that it doesn't, so a future write path that bypasses that trigger (there should be none —
 * it fires on every INSERT, unconditionally) fails the build instead of waiting for someone to
 * probe production again the way NEW-1 itself had to.
 *
 * This module is PURE (no storage, no network, no DOM) so every class is unit-testable on its own,
 * and it is the ONE place any of these questions is asked — `scripts/audit-name-group-integrity.mjs`
 * (live, whole-account) and `test/nameGroupIntegrity.test.js` (seeded, CI-enforced) both call it
 * rather than re-deriving any check.
 *
 * ⛔ NEW-2 (2026-09-16) — `nameMismatch` should now NEVER fire in production. `db/sites_site_
 * column_mirror.sql` makes the column/jsonb agreement it checks a DATABASE-ENFORCED invariant, not
 * a discipline every writer has to keep — see that file and docs/DATA.md §2.15 for the full
 * reasoning. This detector stays: it is the CI-side proof the guarantee holds, and the one thing
 * that would notice if a future migration ever bypassed the trigger.
 */
import { nameAuthority, renameStamp, groupKeyOf as modelGroupKeyOf } from "./projectName.js";

// A value counts as "a name" the same way projectName.js's `claimOf` does — a non-empty, non-
// whitespace string. Anything else (absent, JSON null, "") is "no opinion", not a competing claim.
const asName = (v) => (typeof v === "string" && v.trim() ? v : null);

/* The group key every RPC that decides group membership resolves — `coalesce(data->>'groupId', id)`
 * — applied to a RAW Supabase row shape (`{ id, data }`), never an in-memory plan model (that's
 * `projectName.groupKeyOf`, reused here so there is exactly one definition of "what a groupId JSON
 * value counts as"). */
export function jsonbGroupKeyOf(row) {
  if (!row) return null;
  return modelGroupKeyOf({ id: row.id, groupId: row.data && typeof row.data === "object" ? row.data.groupId : null });
}

// The group key several CLIENT resolvers still read directly off the row (storage.js/cloudSync.js's
// `row.group_id || row.id` idiom) — the denormalized COLUMN mirror.
export function columnGroupKeyOf(row) {
  if (!row) return null;
  return (typeof row.group_id === "string" && row.group_id) || row.id || null;
}

/* A row where the two group keys disagree — the RPCs would act on a different row set than a
 * column-keyed client resolver would show for the SAME row. Returns null when they agree (which
 * includes the overwhelmingly common case: no `groupId`/`group_id` at all, both falling back to the
 * row's own id). */
export function groupKeyMismatch(row) {
  if (!row || !row.id) return null;
  const jsonbKey = jsonbGroupKeyOf(row);
  const columnKey = columnGroupKeyOf(row);
  if (jsonbKey === columnKey) return null;
  return { id: row.id, jsonbKey, columnKey };
}

/* A row whose own `site` COLUMN disagrees with its own `data.site` jsonb field.
 *
 * ⛔ THIS IS A DIFFERENT QUESTION FROM projectName.reconcileGroupNames. That function asks whether
 * SEVERAL rows in a group agree with EACH OTHER (a legitimate historical split a rename can produce
 * and self-heals over time). This asks whether ONE row agrees with ITSELF — there is no legitimate
 * reason for that, ever, live or deleted: `rename_site_group()` / `reconcile_site_group_name()`
 * always write both together in the SAME statement, so any disagreement means some OTHER write path
 * touched one without the other. */
export function nameMismatch(row) {
  if (!row || !row.id) return null;
  const col = asName(row.site);
  const jsonb = asName(row.data && typeof row.data === "object" ? row.data.site : null);
  if (col === jsonb) return null;
  return { id: row.id, siteColumn: col, siteJsonb: jsonb };
}

/* NEW-1 (2026-09-15) — a row carrying no valid rename stamp at all, live or deleted (the backfill
 * this check exists to keep true ran over every row, trashed included — see
 * db/rename_stamp_backfill_20260912.sql's own "WHAT THIS DELIBERATELY DOES NOT TOUCH" for why a
 * trashed row is exactly as unprotected as a live one otherwise). Reuses `projectName.renameStamp`
 * — the SAME one parse `public.rename_stamp` mirrors server-side — rather than re-deriving the
 * "is this a real stamp" question a third time. BLOCKING: this row has no protection at all
 * against sites_preserve_rename_stamp's own no-op case. */
export function unstampedRow(row) {
  if (!row || !row.id) return null;
  const raw = row.data && typeof row.data === "object" ? row.data.siteRenamedAt : undefined;
  if (renameStamp(raw) != null) return null;
  return { id: row.id };
}

/* A row's `scheduleProjectName` hint disagreeing with its project's own current authoritative name.
 *
 * ⛔ DELIBERATELY INFORMATIONAL, NEVER BLOCKING — read this before wiring it into anything that
 * fails a build. ⛔ CORRECTED B1768080 (2026-09-18): this hint is NOT the linked Schedule's own,
 * separately-editable name — a prior version of this comment said so, but tracing the actual wire
 * payload (`public/sequence/index.html`'s `emitLinkChanged`, fed by `Scheduler.jsx`'s own
 * `siteName: routedSiteName`) shows it is a snapshot of the SITE's OWN name taken once, at the
 * moment the link was created or changed, then never refreshed by any later rename on either side.
 * So a disagreement here is exactly the staleness B1768080 fixed at the READ sites
 * (`functions/api/mcp/_tools.js`/`_metrics.js` now prefer the scheduler backend's live name) — this
 * check stays informational-only because the stored value is still a legitimate fallback for when
 * that backend is unreachable, never because the two names are allowed to mean different things.
 * Asked only when the hint is genuinely populated: absent/empty means "no schedule linked" and
 * votes on nothing. */
export function scheduleNameDrift(row, authoritativeName) {
  const hint = asName(row && row.data && typeof row.data === "object" ? row.data.scheduleProjectName : null);
  if (hint == null || authoritativeName == null || hint === authoritativeName) return null;
  return { id: row.id, scheduleProjectName: hint, authoritativeName };
}

/* B1768080 — a row's `scheduleProjectName` hint disagreeing with the schedule's OWN current live
 * name (from `planar_data`), never asked before this item. `scheduleNameDrift` above compares the
 * hint against the SITE's name — a different, and now largely harmless, question, since
 * `functions/api/mcp/_tools.js`/`_metrics.js` no longer trust the stored hint when the live
 * scheduler backend answers. THIS is the comparison that actually caught a real, live divergence
 * on 2026-09-18: schedule id 30's stored hint on four `sites` rows read "Goose Creek" while the
 * schedule itself had been renamed to "MUD v PID" in `planar_data` — a disagreement
 * `scheduleNameDrift` could never see, because the site's own name ("Goose Creek") never changed.
 * `liveNameById` is a Map<string, string|null> — see `functions/api/mcp/_tools.js`'s
 * `liveScheduleNameMap` for the same shape read the same way (string-keyed, since PostgREST hands
 * back `scheduleProjectId` as text). Silent (`null`) when the row names no schedule, or names one
 * the live map has nothing for (a schedule the caller never fetched, or one since deleted — the
 * live map only ever asserts what it actually saw). INFORMATIONAL for the same reason
 * `scheduleNameDrift` is: this stored value is a legitimate fallback for when the live backend is
 * unreachable, so a caller never trusting it standing alone is not itself a defect. */
export function scheduleNameStaleAgainstLive(row, liveNameById) {
  const hint = asName(row && row.data && typeof row.data === "object" ? row.data.scheduleProjectName : null);
  if (hint == null || !liveNameById) return null;
  const schedId = row.data && typeof row.data === "object" ? row.data.scheduleProjectId : null;
  if (schedId == null) return null;
  const key = String(schedId);
  if (!liveNameById.has(key)) return null; // a schedule the caller never fetched, or since deleted
  const live = liveNameById.get(key);
  if (live === hint) return null;
  return { id: row.id, scheduleProjectId: schedId, storedName: hint, liveName: live };
}

/* The whole-account pass. `rows` is the raw shape `select id, site, data, group_id, updated_at,
 * deleted_at` returns (live + deleted — every check here reasons per-row or per-live-group, never
 * needs a live-only filter the way projectName's split gate does).
 *
 * `opts.liveScheduleNameById` (optional) — see `scheduleNameStaleAgainstLive`'s header. Omitted by
 * the seeded unit suite (it has no scheduler backend to fetch); the live audit script passes it.
 *
 * Returns { nameMismatches, groupKeyMismatches, unstampedRows, scheduleNameDrifts,
 * scheduleNameStaleVsLive }: the first three are BLOCKING — a caller (the audit script, a future CI
 * gate) should fail loudly on any being non-empty; the last two are informational only, per their
 * own headers. */
export function auditRows(rows, opts) {
  const liveScheduleNameById = opts && opts.liveScheduleNameById;
  const list = (rows || []).filter(Boolean);
  const nameMismatches = list.map(nameMismatch).filter(Boolean);
  const groupKeyMismatches = list.map(groupKeyMismatch).filter(Boolean);
  const unstampedRows = list.map(unstampedRow).filter(Boolean);

  // Resolve each LIVE group's current authoritative name once, so scheduleNameDrift has something
  // honest to compare against — reusing projectName.nameAuthority rather than re-deriving it.
  const liveByGroup = new Map();
  for (const row of list) {
    if (row.deleted_at) continue;
    const g = jsonbGroupKeyOf(row);
    const plan = {
      id: row.id,
      site: (row.data && typeof row.data === "object" && row.data.site) || row.site || null,
      siteRenamedAt: row.data && typeof row.data === "object" ? row.data.siteRenamedAt : null,
      updatedAt: row.updated_at,
    };
    const arr = liveByGroup.get(g);
    if (arr) arr.push(plan); else liveByGroup.set(g, [plan]);
  }
  const authorityByGroup = new Map();
  for (const [g, plans] of liveByGroup) {
    const a = nameAuthority(plans);
    if (!a.ambiguous && a.name != null) authorityByGroup.set(g, a.name);
  }
  const scheduleNameDrifts = list
    .map((row) => scheduleNameDrift(row, authorityByGroup.get(jsonbGroupKeyOf(row))))
    .filter(Boolean);
  const scheduleNameStaleVsLive = liveScheduleNameById
    ? list.map((row) => scheduleNameStaleAgainstLive(row, liveScheduleNameById)).filter(Boolean)
    : [];

  return { nameMismatches, groupKeyMismatches, unstampedRows, scheduleNameDrifts, scheduleNameStaleVsLive };
}
