/* B845089 (NEW-2) — "when was this project actually last worked on," the panel-row / group-level
 * answer behind the Sites panel's right-hand column and its "Recently touched" sort. Pure — the
 * network fetch lives in elementApi.js/cloudSync.js.
 *
 * ⛔ WHY NOT `sites.updated_at` — measured, not assumed. That column only advances on a
 * header-level change (rename, settings, sharing) — element edits are written straight to
 * `site_elements` rows and deliberately do NOT bump the header (see cloudSync.js's `lastHeaderSig`
 * comment: "sites.updated_at now only advances on a REAL header change... element recency lives on
 * the site_elements rows"). Measured live across the owner's own plans: `sites.updated_at` read
 * 20.7, 28.2, 49.1, 51.2 and 64.6 hours NEWER than the last real edit, because merely opening a
 * plan (or its own autosave) touches the header. `site_elements.updated_at` is the one place a
 * real edit timestamp lives.
 *
 * Two derivations, kept apart because they answer different questions:
 *   summarizeElementRecency — per PLAN (site_id): the latest live element-row edit.
 *   groupRecencyMs          — per PROJECT (group): the max across every plan in the group. The
 *                             Sites panel shows one row per project (SitePlannerApp.jsx's
 *                             `siteGroups` collapses a group's plans to one representative), so a
 *                             plan the user hasn't touched today must not make an actively-edited
 *                             sibling plan in the same project look stale.
 *
 * The per-plan fallback: a plan with zero live element rows (blank, never drawn) has no element
 * timestamp at all — rather than an empty cell or "Invalid Date," it falls back to that plan's own
 * header `updatedAt` (stamped at creation and on every save), which is always present and is a
 * real fact ("last touched"), just a coarser one than a real edit.
 */

// rows: [{ site_id, updated_at }] — every LIVE element row's site + edit time (any kind; the
// caller reads only the two columns, not the geometry). Returns { [siteId]: msEpoch }, the most
// recent live element edit for that PLAN. A site with zero live element rows is simply absent.
export function summarizeElementRecency(rows) {
  const out = {};
  for (const r of (rows || [])) {
    if (!r || !r.site_id || !r.updated_at) continue;
    const ms = new Date(r.updated_at).getTime();
    if (!Number.isFinite(ms)) continue;
    if (!(r.site_id in out) || ms > out[r.site_id]) out[r.site_id] = ms;
  }
  return out;
}

const headerMs = (s) => {
  const v = s && s.updatedAt;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (!v) return null;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
};

// sites: every PLAN this user can see (the full, ungrouped list — NOT the one-representative-
// per-group list the panel renders). elementRecencyBySite: summarizeElementRecency's output.
// Returns { [groupId]: msEpoch } — groupId is `s.groupId || s.id`, the same fallback
// storage.js's `groupOf` uses for a record that predates grouping.
export function groupRecencyMs(sites, elementRecencyBySite) {
  const out = {};
  for (const s of (sites || [])) {
    if (!s || !s.id) continue;
    const gid = s.groupId || s.id;
    const perPlan = elementRecencyBySite && elementRecencyBySite[s.id];
    const ms = perPlan != null ? perPlan : headerMs(s);
    if (ms == null) continue;
    if (!(gid in out) || ms > out[gid]) out[gid] = ms;
  }
  return out;
}

// Compact display label: "2h", "3d", "Aug 12" (a year suffix only when `ms` isn't in `now`'s
// calendar year) — short enough that the panel's right-aligned column stays scannable at a
// glance. Returns null for an unresolvable timestamp so the caller can render its own honest
// placeholder instead of "Invalid Date".
export function lastEditedLabel(ms, now = Date.now()) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const diffMs = Math.max(0, now - ms);
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
