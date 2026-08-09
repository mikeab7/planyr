/* listProjects — the live project list for the header breadcrumb / switcher.
 *
 * Reads the SAME per-user, RLS-scoped site store the Site Planner uses
 * (`loadSitesList()` returns the signed-in user's own sites when signed in, the
 * legacy local store when logged out — never cross-user), then groups it into
 * projects via the pure `groupProjects` helper. There is no parallel project
 * store: a project *is* a Site Planner site group.
 *
 * Kept separate from projectModel.js (the pure helpers) so the Node test runner can
 * exercise grouping/relTime without importing the storage → cloudSync → Supabase
 * chain. This module is browser/UI-only.
 */
import { loadSitesList, renameSiteGroup, deleteSiteGroup, pullCloud, isCloudActive, activeUid } from "../../workspaces/site-planner/lib/storage.js";

/** Which account's data every project surface is reading. Re-exported through this one
 *  project-layer seam so a caller that needs to ask a SECOND store the same question — "what
 *  else belongs to this project?" — resolves the account the same way, rather than reaching
 *  into the Site Planner store itself. */
export { activeUid };
import { groupProjects } from "./projectModel.js";

// Recently deleted (NEW-1) — deleting a project now bins it for 30 days instead of destroying it.
// Re-exported here so the shared breadcrumb reads the bin through the same one project-layer seam
// it already uses for list/rename/delete, rather than reaching into the Site Planner store itself.
export {
  listDeletedProjects, restoreDeletedProject, purgeDeletedProject,
  purgeExpiredDeletedProjects, DELETED_RETENTION_DAYS,
} from "../../workspaces/site-planner/lib/storage.js";

export { groupProjects, filterProjects, relTime, suggestNameMatch, normalizeProjectName } from "./projectModel.js";

export function listProjects() {
  try {
    return groupProjects(loadSitesList());
  } catch (_) {
    return [];
  }
}

/* THE PROJECT LIST CHANGED — one signal, every surface (B482 ×2).
 *
 * A same-tab localStorage write fires NO native `storage` event, so a warm that lands in one
 * component is invisible to every other reader of the same cache. The breadcrumb has always
 * papered over that by re-reading when its own dropdown opens; a rail that renders project
 * NAMES has no such moment — it just keeps showing whatever it read at mount. So the warm now
 * announces itself, and any surface can subscribe.
 *
 * It is deliberately the SAME synthetic `storage` event the breadcrumb already dispatches after
 * a rename/delete, so the existing listeners (this breadcrumb, the Site Planner's site list)
 * pick it up for free rather than needing a second mechanism bolted beside them.
 */
const SITES_EVENT_KEY = "planarfit:sites:v1";

export function notifyProjectsChanged() {
  try { window.dispatchEvent(new StorageEvent("storage", { key: SITES_EVENT_KEY })); } catch (_) {}
}

/** Subscribe to "the project list may have moved". Returns an unsubscribe. */
export function onProjectsChanged(cb) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e) => { if (!e.key || e.key.startsWith("planarfit:sites")) cb(); };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/* Warm the signed-in user's on-device project cache when it's empty (B475/B482), and SAY WHAT
 * HAPPENED (LOUD-FAILURE).
 *
 * The list reads listProjects() → loadSitesList(), which only returns data AFTER a cloud pull
 * has populated the per-user cache. On a device (or fresh tab) that went straight to another
 * workspace, that cache is empty even though the user has cloud projects — so the switcher
 * looked empty right next to surfaces that query Supabase live. One pull fixes the divergence:
 * it's the SAME `sites` table, just warmed into the shared cache every path reads.
 *
 * ⛔ THE BOOLEAN RETURN WAS ITSELF A SILENT-FAILURE SURFACE. `false` meant four different
 * things — logged out, already warm, no uid, and *the pull failed* — so a caller could not tell
 * "nothing to do" from "the cloud refused", and every caller therefore treated a real failure as
 * a no-op. That is exactly how a rail ends up captioning a failed lookup as though it were the
 * user's data. This reports the REASON; `warmProjectsIfEmpty` below keeps the old boolean
 * contract for the callers that only ever wanted "did the list change?".
 *
 * Safe + idempotent: it's the exact pull the Site Planner runs on login. Never throws.
 * Returns { ok, warmed, reason, error }.
 */
export async function warmProjects() {
  try {
    if (!isCloudActive()) return { ok: true, warmed: false, reason: "signed-out", error: "" };
    if (loadSitesList().length) return { ok: true, warmed: false, reason: "already-warm", error: "" };
    const uid = activeUid();
    if (!uid) return { ok: true, warmed: false, reason: "signed-out", error: "" };
    const res = await pullCloud(uid);
    if (!res || res.ok === false) {
      return { ok: false, warmed: false, reason: "pull-failed", error: (res && res.error) || "couldn't reach the cloud" };
    }
    notifyProjectsChanged();
    return { ok: true, warmed: true, reason: "pulled", error: "" };
  } catch (e) {
    return { ok: false, warmed: false, reason: "threw", error: (e && e.message) || "couldn't reach the cloud" };
  }
}

/** The original boolean form — true only when the cache actually gained projects. */
export async function warmProjectsIfEmpty() {
  const r = await warmProjects();
  return !!(r.ok && r.warmed);
}

// Rename a project (= a Site Planner site group) for the uncontrolled breadcrumb (B439).
// A project's name IS its group's authoritative `site` value, so this is a thin wrapper over the
// store's ONE rename write.
//
// NEW-2 — it now RETURNS the store's promise ({ ok, error, … }). It used to return nothing, and
// `renameSiteGroup` used to be a local-only write, so an uncontrolled rename from the header
// dropdown never reached the cloud AND never reported that it hadn't: the name simply came back
// on the next load. Both halves are fixed — the write goes to the source of truth, and the caller
// can await it and surface an honest failure.
export function renameProject(id, name) {
  return renameSiteGroup(id, name);
}

// Delete a project (= a whole site group, every plan in it) for the uncontrolled breadcrumb
// (B439). Returns the store's aggregate cloud-delete promise so the caller can surface an
// honest error if the cloud removal failed or matched zero rows.
export function deleteProject(id) {
  return deleteSiteGroup(id);
}
