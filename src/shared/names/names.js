/* names.js — THE selector layer for user-editable names (see nameCore.js for the rule).
 *
 *   useProjectName(groupId, fallback)   the project's live name
 *   usePlanName(siteId, fallback)       the plan ("Concept A") live name
 *   renameProjectChecked(id, raw)       THE project rename: validate → storage write → notice
 *   renamePlanChecked(id, raw, write)   THE plan rename: validate → write → notice
 *
 * Reads go through `loadSiteSummaries()` (the reconciled, group-authoritative light read) and
 * re-run on `onProjectsChanged` — the one synthetic signal `storage.js` fires on every local
 * rename and every cloud pull — so a rename from ANY door (header, Map row menu, breadcrumb,
 * another tab, another device's pull) reaches every mounted reader with no second mechanism.
 */
import { useSyncExternalStore } from "react";
import { loadSiteSummaries } from "../../workspaces/site-planner/lib/siteListLight.js";
import { onProjectsChanged, renameProject } from "../projects/projects.js";
import {
  validateName, resolveProjectName, setPendingProjectName, clearPendingProjectName,
  subscribePending, announceNameNotice,
} from "./nameCore.js";

export { validateName, fileSafe, announceNameNotice } from "./nameCore.js";

const groupOfRec = (r) => (r && (r.groupId || r.id)) || null;

/* ONE id → name index over the reconciled store, cached until the app's own "list moved" signal
 * (or a short TTL as a backstop for a writer that never fires it). Callers that ask per row of a
 * list (every schedule label on the Dashboard) would otherwise re-parse the whole site store per row.
 *
 * ⛔ NEW-1 (B217540, recurrence ×2) — THE PLAN-NAME READ IS THE SAME INDEX, NOT A SECOND UNCACHED SCAN. `planNameOf`
 * used to call `loadSiteSummaries()` itself — parse the ENTIRE device store, map every record, run the group name
 * authority over all of them — and it is the `getSnapshot` of `usePlanName`, which the Site Planner calls from its own
 * render body. `useSyncExternalStore` calls `getSnapshot` on every render (and again in the commit to check for
 * tearing), and a drag renders the planner every pointer-move frame, so one building drag re-parsed the whole store
 * ~40× — measured as the single largest self-time in the profile at a 3 MB store (20 s over three edit cycles, against
 * 0.3 s with an empty store), i.e. cost that scales with every OTHER plan the device holds. Plan names now ride the
 * project index's one pass, its one cache and its one invalidation signal (`onProjectsChanged`, which every rename
 * and every cloud pull already fires), so a rename still reaches every reader and a render no longer reads the disk. */
let nameIndex = null;
let planIndex = null;
let nameIndexAt = 0;
const INDEX_TTL_MS = 2000;
export function invalidateNameIndex() { nameIndex = null; planIndex = null; }
if (typeof window !== "undefined") onProjectsChanged(invalidateNameIndex);
function refreshNameIndexes() {
  const now = Date.now();
  if (nameIndex && planIndex && now - nameIndexAt < INDEX_TTL_MS) return;
  const idx = {};
  const pidx = {};
  try {
    for (const r of loadSiteSummaries()) {
      const g = groupOfRec(r);
      if (g && !idx[g] && (r.site || r.name)) idx[g] = r.site || r.name;
      if (r && r.id && r.name) pidx[r.id] = r.name;
    }
  } catch (_) { /* an unreadable store answers "unknown", never a stale name */ }
  nameIndexAt = now;
  // keep the SAME object while nothing changed, so a subscriber's snapshot is stable across a TTL refresh
  const sameOf = (a, b) => a && Object.keys(b).length === Object.keys(a).length && Object.keys(b).every((k) => a[k] === b[k]);
  if (!sameOf(nameIndex, idx)) nameIndex = idx;
  if (!sameOf(planIndex, pidx)) planIndex = pidx;
}
export function allProjectNames() {
  refreshNameIndexes();
  return nameIndex;
}
export function allPlanNames() {
  refreshNameIndexes();
  return planIndex;
}
/** The stored project name for a group, or null when this device holds no record of it. */
export function storedProjectName(groupId) {
  if (!groupId) return null;
  return allProjectNames()[groupId] || null;
}
export function projectNameOf(groupId, fallback = "Untitled site") {
  return resolveProjectName(storedProjectName(groupId), groupId, fallback);
}
export function planNameOf(siteId, fallback = "Untitled plan") {
  try { return allPlanNames()[siteId] || fallback; } catch (_) { return fallback; }
}

const subscribeAll = (cb) => {
  const a = onProjectsChanged(cb);
  const b = subscribePending(cb);
  return () => { a(); b(); };
};

export function useProjectName(groupId, fallback = "Untitled site") {
  return useSyncExternalStore(subscribeAll, () => projectNameOf(groupId, fallback), () => fallback);
}
/** Every project's live name as one id → name lookup; re-renders the caller when any name changes
 *  (for a LIST of rows, where a hook per row is not possible). */
export function useProjectNames() {
  const idx = useSyncExternalStore(subscribeAll, () => allProjectNames(), () => ({}));
  return (id) => (id && idx[id]) || null;
}
export function usePlanName(siteId, fallback = "Untitled plan") {
  return useSyncExternalStore(subscribeAll, () => planNameOf(siteId, fallback), () => fallback);
}

/** The ONE project rename entry. `write` defaults to the storage group rename; the Site Planner
 *  passes its app-level renamer so the header banner + retry keep working. Returns
 *  `{ ok, name, error }`; a rejection or failure has ALREADY been announced. */
export async function renameProjectChecked(groupId, raw, write = renameProject) {
  const v = validateName(raw, "project");
  if (!v.ok) { announceNameNotice(v.error); return v; }
  if (!storedProjectName(groupId)) {
    // no stored record yet (lazy new project) — the pending map is the store for now
    setPendingProjectName(groupId, v.name);
  }
  let res;
  try { res = await write(groupId, v.name); } catch (e) { res = { ok: false, error: (e && e.message) || "rename failed" }; }
  if (res && res.ok === false) {
    // ROLL BACK what only this call put in the store (an unsaved-project pending name); a name
    // the persisted store already took is local-first and is retried by the caller's banner.
    if (!storedProjectName(groupId)) clearPendingProjectName(groupId);
    announceNameNotice(res.error || `“${v.name}” couldn't be saved.`);
  }
  if (!(res && res.ok === false)) clearPendingProjectName(groupId); // the persisted store owns the name now
  return { ...v, ok: !(res && res.ok === false), error: (res && res.error) || "" };
}

export async function renamePlanChecked(siteId, raw, write) {
  const v = validateName(raw, "plan");
  if (!v.ok) { announceNameNotice(v.error); return v; }
  let res;
  try { res = await write(siteId, v.name); } catch (e) { res = { ok: false, error: (e && e.message) || "rename failed" }; }
  if (res && res.ok === false) announceNameNotice(res.error || `“${v.name}” couldn't be saved.`);
  return { ...v, ok: !(res && res.ok === false), error: (res && res.error) || "" };
}
