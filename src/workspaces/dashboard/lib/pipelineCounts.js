/* pipelineCounts.js — pure "Pipeline counts by status" derivation for the Dashboard (B1196305,
 * NEW-2), over `siteListLight.js`'s `loadSiteSummaries()` rows (one row per PLAN). A project
 * (site group) can hold several plans; this counts by PROJECT (one vote per groupId, from its
 * most-recently-updated plan), because "pipeline" is a portfolio question, not a plan count.
 */
import { STATUSES } from "../../site-planner/lib/siteStatus.js";

/** One row per groupId, taken from its most-recently-updated member. Exported for the
 * "Pursuits by activity" card, which groups the same way. */
export function latestPerGroup(sites) {
  const byGroup = new Map();
  for (const s of sites || []) {
    const gid = s.groupId || s.id;
    if (!gid) continue;
    const prev = byGroup.get(gid);
    if (!prev || (s.updatedAt || 0) >= (prev.updatedAt || 0)) byGroup.set(gid, s);
  }
  return [...byGroup.values()];
}

/** sites: siteListLight rows (any role). Returns { total, byStatus, trackedCount }, byStatus
 * carrying every STATUSES key (0 for a status with no members, never an absent key). */
export function pipelineCounts(sites) {
  const groups = latestPerGroup(sites);
  const pursuits = groups.filter((g) => g.role === "pursuit");
  const tracked = groups.filter((g) => g.role === "tracked");
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const g of pursuits) {
    if (Object.prototype.hasOwnProperty.call(byStatus, g.status)) byStatus[g.status] += 1;
  }
  return { total: pursuits.length, byStatus, trackedCount: tracked.length };
}
