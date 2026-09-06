/* dashboardSitesFetch — the one `sites` read that powers the Pipeline, Pursuits-by-activity,
 * and Going-quiet cards, plus the project half of Jump-back-in (B1213313, NEW-2).
 *
 * A direct, minimal query rather than `site-planner/lib/storage.js`'s `loadSitesList()` —
 * that loader statically pulls in the ~165 KB site-model/element-sync engine for fields none
 * of these cards need. `status`/`role` are not real columns; they live inside the `data` jsonb
 * (`siteModel.js`), extracted here the same way `doc_reviews`' own loader already extracts
 * `placed`/`orgScope` — a sanctioned Postgres jsonb-arrow-select, not a novel pattern.
 *
 * `sites.updated_at` is a known-stale proxy for "last worked on" (site-planner/lib/
 * siteRecency.js's own header: element edits write to `site_elements` and deliberately don't
 * bump the site header, so this can read 20-65 hours behind). That's an accepted, documented
 * simplification for a dashboard summary card — never treated as authoritative elsewhere in
 * the app, and this module doesn't claim more precision than it has.
 */
import { supabase } from "../../site-planner/lib/supabase.js";

/** All of the signed-in user's (or team's — RLS scopes this) non-deleted plan rows. Returns []
 * on any failure — a dashboard card degrades to "no data" rather than throwing. */
export async function fetchSiteSummaries() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("sites")
      .select("id, group_id, site, name, county, updated_at, status:data->>status, role:data->>role, feasibilityExpiry:data->>feasibilityExpiry, loiDate:data->>loiDate, closingDate:data->>closingDate")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch (_) {
    return [];
  }
}
