// src/shared/schedule/scheduleLiveness.js
//
// NEW-1 (2026-10-05) — a schedule belongs to a PROJECT; when the project is deleted the schedule goes with it.
// The database now enforces that (db/project_schedule_cascade.sql). This is the READER'S half: a surface that
// lists schedules (the Dashboard's Schedule Health / Needs Attention cards, the master report) must never show
// one whose project is deleted, even if a row predates the cascade or the migration has not been applied yet.
// Measured on production 2026-10-05: schedule 24 "Untitled site" stayed live 24 days after its project was
// deleted and the Dashboard card listed it. Pure — takes the `sites` rows the caller already has.
import { ownerOf, OWNER_KIND_SITE } from "./scheduleOwnership.js";

/** `{ dead:Set, live:Set }` of project keys (plan ids AND group ids). A key is dead only when EVERY plan that
 * carries it is soft-deleted; any live plan of the group makes the whole group live. */
export function projectLiveness(siteRows) {
  const byGroup = new Map();
  for (const r of Array.isArray(siteRows) ? siteRows : []) {
    if (!r || r.id == null) continue;
    const gid = r.group_id != null ? r.group_id : r.id;
    const g = byGroup.get(gid) || { keys: new Set([gid]), anyLive: false };
    g.keys.add(r.id);
    if (r.deleted_at == null) g.anyLive = true;
    byGroup.set(gid, g);
  }
  const dead = new Set(); const live = new Set();
  for (const g of byGroup.values()) for (const k of g.keys) (g.anyLive ? live : dead).add(k);
  return { dead, live };
}

/** The `{ id → project }` schedule map without the schedules whose linked project is deleted. An org-owned
 * schedule (stale link) and one whose link names a project we hold no row for are kept — absence of a `sites`
 * row is "unknown", never "deleted". `siteRows` null/undefined (the read failed) → the map unchanged. */
export function dropSchedulesOfDeletedProjects(projectsMap, siteRows) {
  if (!projectsMap || typeof projectsMap !== "object" || !Array.isArray(siteRows)) return projectsMap;
  const { dead, live } = projectLiveness(siteRows);
  const out = {};
  for (const [id, p] of Object.entries(projectsMap)) {
    const o = p && typeof p === "object" ? ownerOf(p) : null;
    if (o && o.kind === OWNER_KIND_SITE && dead.has(o.siteId) && !live.has(o.siteId)) continue;
    out[id] = p;
  }
  return out;
}
