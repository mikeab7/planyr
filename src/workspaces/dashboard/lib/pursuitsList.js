/* pursuitsList — pure table model for the Dashboard's "Pursuits" card (B1161793, NEW-2, Direction
 * C's second real content card).
 *
 * Sorted by SOONEST UPCOMING contractual date, ascending — an undated pursuit sorts to the
 * bottom. "Quiet for" (real edit recency) never enters the sort: a stale pursuit must never
 * outrank one with a clock running on it (tried and explicitly rejected in the brief).
 *
 * ⛔ Dependency the brief asked to be surfaced loudly if missing: `feasibilityExpiry` / `loiDate` /
 * `closingDate` did NOT exist on the site model before this item — there was no contractual-date
 * field of any kind on a pursuit. They are added here (siteModel.js's `createSiteModel`) as plain
 * optional ISO date strings; every existing pursuit reads all three as unset until the owner (or a
 * teammate) fills them in via the new "Deal dates…" editor (MapFinder.jsx's site context menu). So
 * on first release EVERY row reads "Nothing scheduled" and the card is sorted on nothing but the
 * undated tie-break (alphabetical-by-nothing, effectively insertion order) until dates are entered —
 * this module does not fall back to last-edited or any other proxy; see the brief's own instruction
 * not to substitute one silently.
 */
import { daysUntil } from "./dashboardDates.js";

const OPEN_STATUSES = new Set(["pursuit", "active", "onhold"]);

export const NEXT_DATE_FIELDS = [
  { key: "feasibilityExpiry", label: "Feasibility ends" },
  { key: "loiDate", label: "LOI response due" },
  { key: "closingDate", label: "Closing" },
];

/** The soonest date among a pursuit's three contractual fields that hasn't happened yet (today
 * counts as 0 days out), or null when none is set or all have already passed. */
export function nextContractualDate(p, nowMs = Date.now()) {
  let best = null;
  for (const f of NEXT_DATE_FIELDS) {
    const iso = p && p[f.key];
    if (!iso) continue;
    const days = daysUntil(iso, nowMs);
    if (days == null || days < 0) continue;
    if (!best || days < best.days) best = { label: f.label, date: iso, days };
  }
  return best;
}

/** `projects` — `groupProjectsByGroupId()` output, extended with the three raw date fields (see
 * dashboardSitesFetch.js). `quietDaysByGroup` — `{ [groupId]: days }` from real element-edit
 * recency (dashboardElementRecencyFetch.js + siteRecency.js), never last-edited/autosave. */
export function pursuitsTable(projects, quietDaysByGroup, { nowMs = Date.now() } = {}) {
  return (projects || [])
    .filter((p) => p.role !== "tracked" && OPEN_STATUSES.has(p.status))
    .map((p) => ({
      groupId: p.groupId,
      siteId: p.siteId,
      name: p.name,
      county: p.county,
      status: p.status,
      next: nextContractualDate(p, nowMs),
      quietDays: quietDaysByGroup && quietDaysByGroup[p.groupId] != null ? quietDaysByGroup[p.groupId] : null,
    }))
    .sort((a, b) => {
      const ad = a.next ? a.next.days : null;
      const bd = b.next ? b.next.days : null;
      if (ad == null && bd == null) return 0;
      if (ad == null) return 1; // undated always sorts to the bottom
      if (bd == null) return -1;
      return ad - bd; // ascending — soonest first; quiet time never a tiebreak input
    });
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

// The brief's own thresholds for the "Next" cell's second line and the "Quiet for" emphasis.
export const NEXT_LINE_URGENT_DAYS = 7;   // < this → red
export const NEXT_LINE_SOON_DAYS = 14;    // < this → accent
export const QUIET_EMPHASIS_DAYS = 10;    // >= this → emphasized (never colored red/accent — not a warning)

/** "danger" | "accent" | "muted" — the Next cell's second-line tone. null (undated) is muted. */
export function nextLineTone(days) {
  if (days == null) return "muted";
  if (days < NEXT_LINE_URGENT_DAYS) return "danger";
  if (days < NEXT_LINE_SOON_DAYS) return "accent";
  return "muted";
}

export function isQuietEmphasized(days) {
  return days != null && days >= QUIET_EMPHASIS_DAYS;
}
