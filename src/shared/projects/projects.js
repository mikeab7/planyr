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
import { groupProjects } from "./projectModel.js";

export { groupProjects, filterProjects, relTime } from "./projectModel.js";

export function listProjects() {
  try {
    return groupProjects(loadSitesList());
  } catch (_) {
    return [];
  }
}

// Warm the signed-in user's on-device project cache when it's empty (B475).
//
// The breadcrumb switcher reads listProjects() → loadSitesList(), which only returns
// data AFTER a Site-Planner cloud pull has populated the per-user cache. On a device (or
// fresh tab) that went straight to Markup without ever opening the Site Planner, that cache
// is empty even though the user has cloud projects — so the switcher looked empty/stale right
// next to a populated Markup Library (which queries Supabase live). One pull fixes the
// divergence: it's the SAME `sites` table, just warmed into the shared cache both paths read.
//
// Safe + idempotent: it's the exact pull the Site Planner runs on login. No-ops (returns
// false) when logged out (the legacy local store is authoritative) or when the cache already
// has projects. Never throws.
export async function warmProjectsIfEmpty() {
  try {
    if (!isCloudActive()) return false;        // logged out → nothing to pull
    if (loadSitesList().length) return false;  // already warm
    const uid = activeUid();
    if (!uid) return false;
    const res = await pullCloud(uid);
    return !!(res && res.ok);
  } catch (_) {
    return false;
  }
}

// Rename a project (= a Site Planner site group) for the uncontrolled breadcrumb (B439).
// A project's name IS its group's `site` label, so this is a thin wrapper over the store.
export function renameProject(id, name) {
  renameSiteGroup(id, name);
}

// Delete a project (= a whole site group, every plan in it) for the uncontrolled breadcrumb
// (B439). Returns the store's aggregate cloud-delete promise so the caller can surface an
// honest error if the cloud removal failed or matched zero rows.
export function deleteProject(id) {
  return deleteSiteGroup(id);
}
