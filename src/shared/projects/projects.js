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
import { loadSitesList, renameSiteGroup, deleteSiteGroup } from "../../workspaces/site-planner/lib/storage.js";
import { groupProjects } from "./projectModel.js";

export { groupProjects, filterProjects, relTime } from "./projectModel.js";

export function listProjects() {
  try {
    return groupProjects(loadSitesList());
  } catch (_) {
    return [];
  }
}

// Rename all plans in a group (wraps renameSiteGroup — `name` is the site/location label).
export function renameProject(groupId, name) {
  renameSiteGroup(groupId, name);
}

// Delete every plan in a group (local + cloud). Returns a Promise<{ok,error?,removed?}>.
export function deleteProject(groupId) {
  return deleteSiteGroup(groupId);
}
