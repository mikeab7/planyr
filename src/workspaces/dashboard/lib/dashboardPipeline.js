/* dashboardPipeline — pure grouping/derivation for the Dashboard's Pipeline, Pursuits-by-
 * activity, and Going-quiet cards (B1213313, NEW-2). All three read the SAME per-plan `sites`
 * rows (see dashboardSitesFetch.js) and just look at them differently, so the fetch happens
 * once and these three pure functions each answer a different question over it.
 *
 * A `sites` row is one PLAN, not one project — a project (what the owner calls a "site") can
 * hold several plans sharing one `group_id`. `groupProjectsByGroupId` collapses to one entry per
 * project, the way SitePlannerApp.jsx's own `siteGroups` memo does, picking the most-recently-
 * updated plan as the group's representative (its status/name/county are what the owner would
 * see if they opened the project right now) and counting every plan in the group.
 */

const DEFAULT_STATUS = "pursuit"; // siteStatus.js's own new-site default
const DEFAULT_ROLE = "pursuit";   // role has no legacy split — absent means "pursuit" (B843792)
const PURSUIT_ACTIVITY_ORDER = { pursuit: 0, active: 1, onhold: 2 };
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
      name: (newest.site || newest.name || "").trim() || "Untitled",
      county: newest.county || null,
      status: newest.status || DEFAULT_STATUS,
      role: newest.role || DEFAULT_ROLE,
      updatedAt: newest.updated_at || null,
      planCount: rows.length,
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

/** The open pipeline (Pursuit/Active/On hold, tracked records excluded — they aren't a stage of
 * anything), ordered loudest-first (matching the map marker salience rule), newest within a
 * stage first. */
export function pursuitsByActivity(projects, { limit = 8 } = {}) {
  return (projects || [])
    .filter((p) => p.role !== "tracked" && PURSUIT_ACTIVITY_ORDER[p.status] !== undefined)
    .sort((a, b) => (PURSUIT_ACTIVITY_ORDER[a.status] - PURSUIT_ACTIVITY_ORDER[b.status]) || (Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0)))
    .slice(0, limit);
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
