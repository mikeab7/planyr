/* dashboardPipeline — pure grouping/derivation for the Dashboard's Pipeline, Jump-back-in and
 * Going-quiet cards (B1213313, NEW-2). Reads the SAME per-plan `sites` rows (see
 * dashboardSitesFetch.js) `pursuitsList.js`'s Pursuits card also builds on. `pursuitsByActivity`
 * (the placeholder "Pursuits by activity" card) was removed in B1161793 (NEW-2, Direction C) —
 * directly superseded by the richer, sortable `pursuitsTable` in pursuitsList.js.
 *
 * A `sites` row is one PLAN, not one project — a project (what the owner calls a "site") can
 * hold several plans sharing one `group_id`. `groupProjectsByGroupId` collapses to one entry per
 * project, the way SitePlannerApp.jsx's own `siteGroups` memo does, picking the most-recently-
 * updated plan as the group's representative (its status/name/county are what the owner would
 * see if they opened the project right now) and counting every plan in the group.
 */

const DEFAULT_STATUS = "pursuit"; // siteStatus.js's own new-site default
const DEFAULT_ROLE = "pursuit";   // role has no legacy split — absent means "pursuit" (B843792)
const OPEN_STATUSES = new Set(["pursuit", "active", "onhold"]);

/** `siteRows` — the raw `sites` table rows (one per plan). Returns one summary per `group_id`. */
export function groupProjectsByGroupId(siteRows) {
  const byGroup = new Map();
  for (const row of siteRows || []) {
    if (!row) continue;
    const gid = row.group_id || row.id;
    if (!gid) continue;
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid).push(row);
  }
  const out = [];
  for (const [groupId, rows] of byGroup) {
    const newest = rows.reduce((a, b) => (Date.parse(b.updated_at || 0) > Date.parse(a.updated_at || 0) ? b : a));
    out.push({
      groupId,
      // B1161793 (NEW-2) — the representative PLAN's own row id, distinct from `groupId` (which
      // is a separate value shared across sibling plans, or falls back to a solo plan's id when
      // it has no group). The Pursuits card's Yield/Quiet columns key off `site_elements.site_id`,
      // which is always a PLAN id — never the group id — so this is what lets those two per-plan
      // reads land on the same representative plan `name`/`status`/`county` already come from.
      siteId: newest.id,
      name: (newest.site || newest.name || "").trim() || "Untitled",
      county: newest.county || null,
      status: newest.status || DEFAULT_STATUS,
      role: newest.role || DEFAULT_ROLE,
      updatedAt: newest.updated_at || null,
      planCount: rows.length,
      // B1161793 (NEW-2) — the pursuit's contractual dates (feasibility expiry / LOI response /
      // closing), read straight through from the representative plan. Absent on every pursuit
      // until entered via the "Deal dates…" editor — see pursuitsList.js's own header.
      feasibilityExpiry: newest.feasibilityExpiry || null,
      loiDate: newest.loiDate || null,
      closingDate: newest.closingDate || null,
    });
  }
  return out;
}

/** Counts by status, tracked market records broken out on their own (role governs before status
 * does — a tracked record's `status` field is not part of the pipeline funnel). */
export function pipelineCounts(projects) {
  const counts = { pursuit: 0, active: 0, onhold: 0, complete: 0, dead: 0, tracked: 0 };
  for (const p of projects || []) {
    if (p.role === "tracked") { counts.tracked++; continue; }
    if (counts[p.status] === undefined) continue;
    counts[p.status]++;
  }
  return counts;
}

/** The single most recently updated project, of any status/role — "Jump back in" is a literal
 * "where were you last" signal, not a judgment about which project deserves attention, so
 * nothing here is filtered out. Returns null for an empty list. */
export function mostRecentProject(projects) {
  return (projects || []).reduce((best, p) => (
    !best || Date.parse(p.updatedAt || 0) > Date.parse(best.updatedAt || 0) ? p : best
  ), null);
}

/** Open projects (pursuit/active/onhold) that haven't been touched in `idleDays` or more —
 * settled stages (complete/dead) and tracked market records are never "going quiet", they're
 * supposed to be idle. Sorted longest-idle first. */
export function goingQuiet(projects, { idleDays = 30, limit = 8, nowMs = Date.now() } = {}) {
  return (projects || [])
    .filter((p) => p.role !== "tracked" && OPEN_STATUSES.has(p.status) && p.updatedAt)
    .map((p) => ({ ...p, idleDays: Math.floor((nowMs - Date.parse(p.updatedAt)) / 86400000) }))
    .filter((p) => p.idleDays >= idleDays)
    .sort((a, b) => b.idleDays - a.idleDays)
    .slice(0, limit);
}
