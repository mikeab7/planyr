/* goingQuiet.js — pure "Going quiet" derivation for the Dashboard (B1196305, NEW-2): a live
 * pursuit (role "pursuit", status neither "complete" nor "dead" — a settled project going quiet
 * is expected, not a signal) that hasn't been touched in 30 days. One row per project (groupId),
 * from its most-recently-updated plan, oldest-touched first.
 */
import { latestPerGroup } from "./pipelineCounts.js";

export const QUIET_DAYS = 30;

export function goingQuietPursuits(sites, nowMs = Date.now()) {
  const cutoff = nowMs - QUIET_DAYS * 86400000;
  const groups = latestPerGroup((sites || []).filter((s) => s.role === "pursuit"));
  return groups
    .filter((g) => g.status !== "complete" && g.status !== "dead")
    .filter((g) => (g.updatedAt || 0) < cutoff)
    .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
}
