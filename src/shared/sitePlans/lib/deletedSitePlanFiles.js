/** Deleted site-plan FILES (the uploaded drawings on a site — `site_plan_overlays`), listed where
 * the site's plans are managed: the Site Planner's plan menu, under that project's "Recently deleted".
 *
 * NEW-1 (owner, 2026-10-20: "I don't know that we need to keep recently deleted site plans in the
 * site records area"). They used to be listed on the Site page's All comps list (added there by
 * #2406 because the record had been their only restore point); this is a MOVE, not a behaviour
 * change — same soft-delete bin, same Restore, same permanent delete (with the same tracked-site
 * tidy-up), same retention (none: the bin is never auto-purged). Nothing here is a second bin.
 *
 * Dynamic-import only from the planner (its menu opens it on demand) so the overlay store never
 * rides the Site route's critical path. */
import {
  fetchDeletedOverlays, restoreOverlay, permanentlyDeleteOverlay, countLiveOverlaysForProject,
} from "./sitePlanOverlayStore.js";
import { countLiveCompsForProject } from "../../comps/lib/compsStore.js";

/** Pure: which raw trash rows (`fetchDeletedOverlays` selects, snake_case) belong in THIS project's
 * bin, as menu rows. A row detached from every site (`project_id` null) has no project menu of its
 * own, so it is offered in whichever project's menu is open rather than becoming unreachable —
 * exactly how the single-record view treated it. Newest-deleted first (the store already sorts). */
export function deletedFilesForProject(rows, groupId) {
  return (rows || [])
    .filter((o) => o && (o.project_id === groupId || !o.project_id))
    .map((o) => ({
      id: o.id,
      name: o.doc_title || "Untitled site plan",
      page: o.page,
      fileName: o.source_file_name || null,
      deletedAt: o.deleted_at ? Date.parse(o.deleted_at) : null,
      projectId: o.project_id || null,
    }));
}

/** { ok, files, error } — LOUD-FAILURE: a failed read is reported, never an empty list. */
export async function listDeletedSitePlanFiles(groupId) {
  const { data, error } = await fetchDeletedOverlays();
  if (error) return { ok: false, files: [], error: error.message || "Couldn't load deleted site plans" };
  return { ok: true, files: deletedFilesForProject(data, groupId), error: null };
}

export async function restoreSitePlanFile(id) {
  const { error } = await restoreOverlay(id);
  return error ? { ok: false, error: error.message || "Couldn't restore the site plan" } : { ok: true };
}

// NEW-6 Part B (moved verbatim from SitePlansSection.jsx): an auto-created tracked ("market record")
// site is otherwise permanent and invisible once its last plan (and last comp) are gone. Mirrors
// CompsPanel.jsx's own purgeForever tidy-up, INCLUDING where it fires: PERMANENT delete only, never
// the soft delete — a soft-deleted overlay is restorable and `countLiveOverlaysForProject` already
// excludes it, so retiring the site then would strand a later restore. Best-effort and never reports
// a failure: `binOrphanedTrackedSite` refuses unless the site is still `role:"tracked"` and empty.
async function maybeRetireTrackedSite(projectId) {
  if (!projectId) return;
  try {
    const [liveOverlays, liveComps] = await Promise.all([
      countLiveOverlaysForProject(projectId),
      countLiveCompsForProject(projectId),
    ]);
    if (liveOverlays === 0 && liveComps === 0) {
      const { binOrphanedTrackedSite } = await import("../../../workspaces/site-planner/lib/storage.js");
      await binOrphanedTrackedSite(projectId);
    }
  } catch (_) { /* best-effort tidy-up */ }
}

export async function purgeSitePlanFile(file) {
  const { error } = await permanentlyDeleteOverlay(file.id);
  if (error) return { ok: false, error: error.message || "Couldn't delete the site plan" };
  if (file.projectId) await maybeRetireTrackedSite(file.projectId);
  return { ok: true };
}
