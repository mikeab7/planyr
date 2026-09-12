/* nameGroupIntegrity.js — THE detector for the two data-integrity holes NEW-3 (2026-09-12 owner
 * review, "our code was too susceptible to issues with this and maybe had too many sources of
 * truth") exists to close permanently, both measured against `planyr_production` the same day:
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
 * This module is PURE (no storage, no network, no DOM) so both classes are unit-testable on their
 * own, and it is the ONE place either question is asked — `scripts/audit-name-group-integrity.mjs`
 * (live, whole-account) and `test/nameGroupIntegrity.test.js` (seeded, CI-enforced) both call it
 * rather than re-deriving either check.
 */
import { nameAuthority, groupKeyOf as modelGroupKeyOf } from "./projectName.js";

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

/* A row's `scheduleProjectName` hint disagreeing with its project's own current authoritative name.
 *
 * ⛔ DELIBERATELY INFORMATIONAL, NEVER BLOCKING — read this before wiring it into anything that
 * fails a build. The hint mirrors the LINKED SCHEDULE's own name (a fact that lives in a different
 * backend entirely — see storage.js's `setScheduleLink` header: "the pairing is stored on the
 * schedule project… a lightweight HINT is mirrored onto the site"), not the site's own name. The two
 * are allowed to be genuinely different names for two different things that simply happen to match
 * at creation, so forcing equality here would be a product-behaviour change, not a bug fix. What IS
 * a real, worth-reporting defect is a site rename leaving this hint stale with nothing that ever
 * notices — so this is surfaced for awareness (and is what the audit script counts separately from
 * the two blocking checks above), never failed on. Asked only when the hint is genuinely populated:
 * absent/empty means "no schedule linked" and votes on nothing. */
export function scheduleNameDrift(row, authoritativeName) {
  const hint = asName(row && row.data && typeof row.data === "object" ? row.data.scheduleProjectName : null);
  if (hint == null || authoritativeName == null || hint === authoritativeName) return null;
  return { id: row.id, scheduleProjectName: hint, authoritativeName };
}

/* The whole-account pass. `rows` is the raw shape `select id, site, data, group_id, updated_at,
 * deleted_at` returns (live + deleted — every check here reasons per-row or per-live-group, never
 * needs a live-only filter the way projectName's split gate does).
 *
 * Returns { nameMismatches, groupKeyMismatches, scheduleNameDrifts }: the first two are BLOCKING —
 * a caller (the audit script, a future CI gate) should fail loudly on either being non-empty; the
 * third is informational only, per scheduleNameDrift's own header. */
export function auditRows(rows) {
  const list = (rows || []).filter(Boolean);
  const nameMismatches = list.map(nameMismatch).filter(Boolean);
  const groupKeyMismatches = list.map(groupKeyMismatch).filter(Boolean);

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

  return { nameMismatches, groupKeyMismatches, scheduleNameDrifts };
}
