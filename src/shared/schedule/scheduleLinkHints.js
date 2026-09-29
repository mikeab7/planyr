// src/shared/schedule/scheduleLinkHints.js
//
// B1953795 (S1) — the "Has a schedule" hint on a Site Planner group is a DERIVED MIRROR of the
// schedules' own `linkedSiteId` (the source of truth, held in the schedule document). It used to
// be written only by three event messages (link / create-linked / unlink-with-no-group) and so
// went stale on unlink, relink X→Y, delete, and when a site held two schedules.
//
// The fix: instead of trusting event deltas, RE-DERIVE the wanted hint for every group from the
// full schedule list the embedded app already posts on every data change (`planar:nav-state`),
// and write only where the stored hint disagrees. Source wins; stale hints heal on the next
// nav-state (which also is the non-destructive migration of hints already stale on disk). A
// user-typed schedule name is never touched — the hint holds an id only.
import { ownerOf, OWNER_KIND_SITE } from "./scheduleOwnership.js";

/** siteId → [schedule entries in list order] for every schedule the list says belongs to a site. */
export function schedulesBySite(navProjects) {
  const out = new Map();
  if (!Array.isArray(navProjects)) return out;
  for (const p of navProjects) {
    if (!p || typeof p !== "object") continue;
    const o = ownerOf(p); // the ONE ownership answer: an org-owned schedule's stale link doesn't count
    if (o.kind !== OWNER_KIND_SITE) continue;
    const key = o.siteId;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(p);
  }
  return out;
}

/**
 * The writes needed so every group's hint equals what the schedules say.
 * `groups`: [{ id, scheduleProjectId }] (projectModel entries). Returns
 * [{ groupId, scheduleProjectId: id|null, name }]. Empty/unloaded list → [] (never clears on
 * "nothing known yet"). A hint that still points at one of the group's linked schedules is kept
 * (stable when a site has two); otherwise the first linked schedule; otherwise cleared.
 */
export function planScheduleHintSync(navProjects, groups) {
  if (!Array.isArray(navProjects) || navProjects.length === 0 || !Array.isArray(groups)) return [];
  const bySite = schedulesBySite(navProjects);
  const ops = [];
  for (const g of groups) {
    if (!g || g.id == null) continue;
    const linked = bySite.get(g.id) || [];
    const cur = g.scheduleProjectId != null ? g.scheduleProjectId : null;
    const keep = cur != null ? linked.find((p) => String(p.id) === String(cur)) : null;
    const want = keep || linked[0] || null;
    const wantId = want ? want.id : null;
    if ((wantId == null ? null : String(wantId)) === (cur == null ? null : String(cur))) continue;
    ops.push({ groupId: g.id, scheduleProjectId: wantId, name: want ? want.linkedSiteName ?? null : null });
  }
  return ops;
}
