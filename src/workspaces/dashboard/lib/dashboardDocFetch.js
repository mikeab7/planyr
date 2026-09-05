/* dashboardDocFetch — the last-touched Review document, for the Jump-back-in card (B1213313,
 * NEW-2). A trimmed version of doc-review/lib/reviewStore.js's own `fetchReviews()` shape —
 * avoided here on purpose so this card doesn't statically pull that module's heavier
 * `cloudSync.js`/`siteModel.js` imports for three columns.
 */
import { supabase } from "../../site-planner/lib/supabase.js";

/** { id, title, project, projectId, updatedAt } for the most recently touched document across
 * every project, or null if there is none / the read failed. */
export async function fetchLastTouchedDoc() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("doc_reviews")
      .select("id, title, project, project_id, updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return { id: data.id, title: data.title || "Untitled document", project: data.project || null, projectId: data.project_id || null, updatedAt: data.updated_at || null };
  } catch (_) {
    return null;
  }
}
