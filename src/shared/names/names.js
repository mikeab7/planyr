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

/** The stored project name for a group, or null when this device holds no record of it. */
export function storedProjectName(groupId) {
  if (!groupId) return null;
  try {
    const rec = loadSiteSummaries().find((r) => groupOfRec(r) === groupId && (r.site || r.name));
    return rec ? (rec.site || rec.name) : null;
  } catch (_) { return null; }
}
export function projectNameOf(groupId, fallback = "Untitled site") {
  return resolveProjectName(storedProjectName(groupId), groupId, fallback);
}
export function planNameOf(siteId, fallback = "Untitled plan") {
  try {
    const rec = loadSiteSummaries().find((r) => r && r.id === siteId);
    return (rec && rec.name) || fallback;
  } catch (_) { return fallback; }
}

const subscribeAll = (cb) => {
  const a = onProjectsChanged(cb);
  const b = subscribePending(cb);
  return () => { a(); b(); };
};

export function useProjectName(groupId, fallback = "Untitled site") {
  return useSyncExternalStore(subscribeAll, () => projectNameOf(groupId, fallback), () => fallback);
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
