/* pursuitsList — pure table model for the Dashboard's "Pursuits" card (B1161793, NEW-2, Direction
 * C's second real content card).
 *
 * ⛔ B1342848 (owner instruction, 2026-09-09, verbatim: "remove the deal date from pursuits") — the
 * card's "Next" column and its soonest-contractual-date sort are GONE. The session that shipped
 * B1411504 confirmed, against the owner's real portfolio the same day, that all 44 open plan rows
 * across his 28 open pursuits have every one of the three contractual-date fields
 * (`feasibilityExpiry`/`loiDate`/`closingDate`) unset — the column read "Nothing scheduled" on
 * every row, and the resulting "sorted alphabetically" fallback banner was permanent, not a
 * transitional first-release state. The three date fields, the site-model schema, and the "Deal
 * dates…" editor (MapFinder.jsx) are UNTOUCHED — only the Dashboard card's own read/display of them
 * is removed. This supersedes B1268017's "Next" column design and B1411504 Part 2's undated
 * tie-break fix (both left as historical record — see their own items for the cross-reference).
 *
 * Sort is now plain alphabetical by name — the same fallback those items already used, kept as the
 * primary (only) sort rather than invented fresh. "Quiet for" (real edit recency) still rides along
 * per row but is deliberately NOT a sort input: the owner explicitly rejected quiet-first ordering
 * when this card was designed ("I don't know that something that's been quiet the longest should
 * really be the one at the top") — that verdict doesn't change just because the alternative it was
 * weighed against (date) is now gone too.
 */
import { shortenDisplayName } from "../../../shared/projects/projectModel.js";
import { orderProjects } from "../../../shared/projects/projectOrder.js";

const OPEN_STATUSES = new Set(["pursuit", "active", "onhold"]);

// B1407824 — the Pursuit column's own cell also carries a CSS `text-overflow: ellipsis` clamp
// (PursuitsCard.jsx) as a backstop for an unusually wide font, but pixel-width CSS truncation has
// no idea where a comma, period or hyphen sits — it can land the cut right after one, with no
// ellipsis if the clamp never actually engages. Shortened here instead, at the pure table-model
// layer, so the name that reaches the cell is already safe to display in full.
const PURSUIT_NAME_MAX_CHARS = 26;

/** `projects` — `groupProjectsByGroupId()` output. `quietDaysByGroup` — `{ [groupId]: days }` from
 * real element-edit recency (dashboardElementRecencyFetch.js + siteRecency.js), never
 * last-edited/autosave. Sorted alphabetically by name — see this module's header for why (B1342848)
 * and why that's never quiet time. */
export function pursuitsTable(projects, quietDaysByGroup, savedOrder = null) {
  const today = (projects || [])
    .filter((p) => p.role !== "tracked" && OPEN_STATUSES.has(p.status))
    .map((p) => ({
      groupId: p.groupId,
      siteId: p.siteId,
      name: shortenDisplayName(p.name, PURSUIT_NAME_MAX_CHARS),
      county: p.county,
      status: p.status,
      createdAt: p.createdAt ?? null,
      quietDays: quietDaysByGroup && quietDaysByGroup[p.groupId] != null ? quietDaysByGroup[p.groupId] : null,
    }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  // NEW-1 (2026-10-08) — alphabetical is now only "today's order", the fallback; his saved order
  // (projectOrder.js) lays over it. No saved order = byte-for-byte the old alphabetical list.
  return orderProjects(today, savedOrder);
}

/** { [groupId]: whole days since the group's real last edit }, derived from a
 * `{ [groupId]: msEpoch }` recency map (see quietDaysByGroupFromRows below). */
export function quietDaysByGroupFromRecency(groupRecencyMsMap, nowMs = Date.now()) {
  const out = {};
  for (const [gid, ms] of Object.entries(groupRecencyMsMap || {})) {
    if (ms == null) continue;
    out[gid] = Math.max(0, Math.floor((nowMs - ms) / 86400000));
  }
  return out;
}

/* ⛔ The two folds below deliberately DUPLICATE site-planner/lib/siteRecency.js's
 * `summarizeElementRecency` / `groupRecencyMs` rather than importing them — measured, not a style
 * choice. That module is also part of the Site Planner route's own static import graph, so even a
 * DYNAMIC import from here put it on a chunk Rollup shared with that route (the bundle-budget
 * audit's `bundle.siteRouteAllowlist` caught `siteRecency` as an unexpected new chunk on a plain
 * Site load). Both folds are a few lines of plain array iteration; duplicating them is cheaper
 * than merging two routes' bundles, and matches this repo's own established idiom for exactly
 * this situation (see e.g. `releaseCanvas.js`'s two copies, one per route). Keep both in step with
 * siteRecency.js's originals if that module's derivation ever changes. */

/** Per PLAN (site_id): the latest live element-row edit, in ms. */
function summarizeElementRecency(rows) {
  const out = {};
  for (const r of rows || []) {
    if (!r || !r.site_id || !r.updated_at) continue;
    const ms = new Date(r.updated_at).getTime();
    if (!Number.isFinite(ms)) continue;
    if (!(r.site_id in out) || ms > out[r.site_id]) out[r.site_id] = ms;
  }
  return out;
}

/** Per PROJECT (group): the max across every plan in the group — a plan with zero live element
 * rows falls back to its own header `updated_at` (always present, a real if coarser fact). */
function groupRecencyMs(siteRows, elementRecencyBySite) {
  const out = {};
  for (const s of siteRows || []) {
    if (!s || !s.id) continue;
    const gid = s.group_id || s.id;
    const perPlan = elementRecencyBySite && elementRecencyBySite[s.id];
    const headerMs = s.updated_at ? new Date(s.updated_at).getTime() : null;
    const ms = perPlan != null ? perPlan : (Number.isFinite(headerMs) ? headerMs : null);
    if (ms == null) continue;
    if (!(gid in out) || ms > out[gid]) out[gid] = ms;
  }
  return out;
}

/** `elementRecencyRows` — raw `[{site_id, updated_at}]` (dashboardElementRecencyFetch.js).
 * `siteRows` — raw `fetchSiteSummaries()` rows (`{id, group_id, updated_at}`, snake_case, one per
 * PLAN). Returns `{ [groupId]: whole days since real last edit }` — the Pursuits card's "Quiet
 * for" column, never `sites.updated_at` alone (a header touch/autosave, not a real edit). */
export function quietDaysByGroupFromRows(elementRecencyRows, siteRows, nowMs = Date.now()) {
  const bySite = summarizeElementRecency(elementRecencyRows);
  return quietDaysByGroupFromRecency(groupRecencyMs(siteRows, bySite), nowMs);
}

export const QUIET_EMPHASIS_DAYS = 10;    // >= this → emphasized (never colored red/accent — not a warning)

export function isQuietEmphasized(days) {
  return days != null && days >= QUIET_EMPHASIS_DAYS;
}
