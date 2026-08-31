/* listProjects — the live project list for the header breadcrumb / switcher.
 *
 * Reads the SAME per-user, RLS-scoped site store the Site Planner uses, then groups it into
 * projects via the pure `groupProjects` helper. There is no parallel project store: a project
 * *is* a Site Planner site group.
 *
 * Kept separate from projectModel.js (the pure helpers) so the Node test runner can
 * exercise grouping/relTime without importing the storage → cloudSync → Supabase
 * chain. This module is browser/UI-only.
 *
 * ⛔ B927105 — THIS FILE IS CHROME ON EVERY WORKSPACE (rendered by AppHeader ->
 * ProjectBreadcrumb on every route, and imported directly by several workspaces besides), so a
 * STATIC import here of anything heavy rides every route's bundle. `storage.js`'s full surface
 * statically pulls the whole site-model / cloud-sync / element-sync engine (~165 KB) for
 * geometry this module never touches — it only ever needs a project's NAME, STATUS and
 * TIMESTAMPS. Two things fix that, both already-established patterns in this codebase (see
 * ProjectBreadcrumb.jsx's own note on why the notes census is a dynamic import):
 *   1. `listProjects()` (called synchronously, from render) reads through `siteListLight.js`
 *      instead of `storage.js`'s `loadSitesList()` — the same raw records, the same
 *      name-reconciliation, but skipping the geometry-normalization engine entirely.
 *   2. Every operation that actually WRITES or PULLS content (rename, delete, restore, purge,
 *      warm/reconcile from the cloud) is already only ever called from a user action or an
 *      effect — never from render — so it reaches `storage.js` through a dynamic import()
 *      instead of a static one. Zero behaviour change: every one of these already returns a
 *      Promise (or is wrapped in `Promise.resolve(...)` by its caller), so an extra microtask
 *      for the one-time chunk fetch is invisible.
 * `activeUid`/`isCloudActive` come from `activeUser.js` directly — the same tiny leaf
 * `storage.js` itself now delegates to — so even those two lightweight reads never touch the
 * heavy module.
 */
import { activeUid, isCloudActive } from "../../workspaces/site-planner/lib/activeUser.js";
import { loadSiteSummaries } from "../../workspaces/site-planner/lib/siteListLight.js";
import { groupProjects, DELETED_RETENTION_DAYS } from "./projectModel.js";

/** Which account's data every project surface is reading. Re-exported through this one
 *  project-layer seam so a caller that needs to ask a SECOND store the same question — "what
 *  else belongs to this project?" — resolves the account the same way, rather than reaching
 *  into the Site Planner store itself. */
export { activeUid, DELETED_RETENTION_DAYS };

// The one place this module reaches into the full engine — always behind a dynamic import, and
// always from a function that already returns/is treated as a Promise (see the header above).
const storageEngine = () => import("../../workspaces/site-planner/lib/storage.js");

// Recently deleted (NEW-1) — deleting a project now bins it for 30 days instead of destroying it.
// Thin async wrappers (not a re-export) so the engine loads only when one is actually called.
export async function listDeletedProjects() {
  return (await storageEngine()).listDeletedProjects();
}
export async function restoreDeletedProject(ids) {
  return (await storageEngine()).restoreDeletedProject(ids);
}
export async function purgeDeletedProject(ids) {
  return (await storageEngine()).purgeDeletedProject(ids);
}
export async function purgeExpiredDeletedProjects(opts) {
  return (await storageEngine()).purgeExpiredDeletedProjects(opts);
}

export { groupProjects, filterProjects, relTime, suggestNameMatch, normalizeProjectName } from "./projectModel.js";

export function listProjects() {
  try {
    return groupProjects(loadSiteSummaries());
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
 * The list reads listProjects() → loadSiteSummaries(), which only returns data AFTER a cloud
 * pull has populated the per-user cache. On a device (or fresh tab) that went straight to another
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
    if (loadSiteSummaries().length) return { ok: true, warmed: false, reason: "already-warm", error: "" };
    const uid = activeUid();
    if (!uid) return { ok: true, warmed: false, reason: "signed-out", error: "" };
    const res = await (await storageEngine()).pullCloud(uid);
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

/* B853266/NEW-1 — warmProjects() above ONLY pulls when the on-device cache is EMPTY
 * (`loadSiteSummaries().length` — "already-warm" short-circuits otherwise), so a cache that already
 * holds SOME projects but has quietly diverged from the cloud (a device that missed a sync, a
 * `cloud-group-count-diverged` event with nothing to self-heal it) never gets a second chance —
 * the switcher can be opened a hundred times and it will keep serving the same stale snapshot.
 * That is exactly the owner-reported failure: a project he is standing in (a real, active site
 * group in the cloud) simply isn't in this device's cached mirror.
 *
 * reconcileProjects() is the always-pull sibling, meant to be called on a deliberate user moment
 * (the switcher dropdown opening) rather than on every mount — it's the identical pull
 * warmProjects() already calls (safe + idempotent, "the exact pull the Site Planner runs on
 * login"), just no longer gated on the cache being empty. */
export async function reconcileProjects() {
  try {
    if (!isCloudActive()) return { ok: true, warmed: false, reason: "signed-out", error: "" };
    const uid = activeUid();
    if (!uid) return { ok: true, warmed: false, reason: "signed-out", error: "" };
    const before = loadSiteSummaries().length;
    const res = await (await storageEngine()).pullCloud(uid);
    if (!res || res.ok === false) {
      return { ok: false, warmed: false, reason: "pull-failed", error: (res && res.error) || "couldn't reach the cloud" };
    }
    const changed = loadSiteSummaries().length !== before;
    if (changed) notifyProjectsChanged();
    return { ok: true, warmed: changed, reason: "pulled", error: "" };
  } catch (e) {
    return { ok: false, warmed: false, reason: "threw", error: (e && e.message) || "couldn't reach the cloud" };
  }
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
export async function renameProject(id, name) {
  return (await storageEngine()).renameSiteGroup(id, name);
}

// Delete a project (= a whole site group, every plan in it) for the uncontrolled breadcrumb
// (B439). Returns the store's aggregate cloud-delete promise so the caller can surface an
// honest error if the cloud removal failed or matched zero rows.
export async function deleteProject(id) {
  return (await storageEngine()).deleteSiteGroup(id);
}
