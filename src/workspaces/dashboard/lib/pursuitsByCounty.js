/* pursuitsByCounty.js — pure "Pursuits by activity" derivation for the Dashboard (B1196305,
 * NEW-2): groups pursuit PROJECTS (one vote per groupId, `latestPerGroup`) by county, reporting
 * each county's project count, total plan count across those projects, and how many are
 * currently status "active" — the portfolio's geographic spread of where the live work is.
 */
import { latestPerGroup } from "./pipelineCounts.js";

const UNKNOWN_COUNTY = "unknown";

export function pursuitsByCounty(sites) {
  const rows = (sites || []).filter((s) => s.role === "pursuit");
  // Plan counts per group, and each group's own latest county/status/name.
  const planCountByGroup = new Map();
  for (const s of rows) {
    const gid = s.groupId || s.id;
    if (!gid) continue;
    planCountByGroup.set(gid, (planCountByGroup.get(gid) || 0) + 1);
  }
  const groups = latestPerGroup(rows);

  const byCounty = new Map();
  for (const g of groups) {
    const gid = g.groupId || g.id;
    const key = g.county || UNKNOWN_COUNTY;
    const c = byCounty.get(key) || { county: key, projectCount: 0, planCount: 0, activeCount: 0 };
    c.projectCount += 1;
    c.planCount += planCountByGroup.get(gid) || 1;
    if (g.status === "active") c.activeCount += 1;
    byCounty.set(key, c);
  }
  return [...byCounty.values()].sort((a, b) => (b.activeCount - a.activeCount) || (b.projectCount - a.projectCount));
}
