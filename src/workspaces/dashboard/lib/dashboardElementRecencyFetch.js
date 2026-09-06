/* dashboardElementRecencyFetch — the network half of the Pursuits card's "Quiet for" column
 * (B1161793, NEW-2). Reads `site_elements` directly (`site_id, updated_at` only — no geometry),
 * the SAME real-edit signal the Sites panel's own "last touched" column uses (site-planner/lib/
 * siteRecency.js) — element-row edits, never a header touch/autosave — which is exactly what the
 * brief's own verification step asks for: opening a pursuit without editing it must not reset
 * this column.
 *
 * ⛔ Deliberately NOT `elementApi.js`'s `fetchElementRecency`, even though it does the identical
 * paged query — measured, not a style choice. Importing that module (statically OR dynamically)
 * pulled it into a chunk Rollup then shared with the Site Planner route, since it's also part of
 * that route's own static import graph: the bundle-budget audit's `bundle.siteRouteAllowlist`
 * check caught `elementApi` appearing as an unexpected new chunk on a plain Site load. The
 * pagination itself (walking `.range()` until a short page) is duplicated rather than shared —
 * same reasoning `dashboard/lib/dashboardYieldFetch.js` already gives for its own local paging,
 * and the same "deliberately duplicated" idiom this repo uses elsewhere (see e.g.
 * `releaseCanvas.js`'s two copies) when the alternative is merging two routes' bundles.
 */
import { supabase } from "../../site-planner/lib/supabase.js";

const PAGE_SIZE = 1000;

/** Every live `kind="el"` row's `{site_id, updated_at}`, account-wide (RLS scopes it), paged past
 * PostgREST's 1,000-row response cap. Returns [] on any failure — a dashboard card degrades to
 * "no data" rather than throwing. */
export async function fetchAllElementRecency() {
  if (!supabase) return [];
  const rows = [];
  let from = 0;
  try {
    for (;;) {
      const { data, error } = await supabase
        .from("site_elements")
        .select("site_id,updated_at")
        .is("deleted_at", null)
        .range(from, from + PAGE_SIZE - 1);
      if (error || !Array.isArray(data)) return rows;
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
      from += PAGE_SIZE;
    }
  } catch (_) {
    return rows;
  }
}
