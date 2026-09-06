/* dashboardYieldFetch — the network half of the Pursuits card's Yield column (B1161793, NEW-2).
 *
 * A direct, minimal query scoped to the specific plan ids the card actually needs (each open
 * pursuit's REPRESENTATIVE plan — see dashboardPipeline.js's `siteId`), rather than
 * `elementApi.js`'s account-wide `fetchParcelSummaries`/`fetchElementRecency` shape: those two
 * exist because their callers (the Sites panel) genuinely need every plan's acreage/recency, but
 * pulling every element on every plan in the account just to find the buildings on a handful of
 * open pursuits would be real over-fetch. Paged the same way (PostgREST's 1,000-row response
 * cap — see elementApi.js's own header for the bug this avoids) — kept local rather than
 * importing that module's page walker, since `.in("site_id", ids)` is a filter shape it doesn't
 * take.
 */
import { supabase } from "../../site-planner/lib/supabase.js";

const PAGE_SIZE = 1000;

/** Every live `kind="el"` row's `{site_id, data}` for the given plan ids. Returns [] on any
 * failure, an empty id list, or no client — a dashboard card degrades to "no data" rather than
 * throwing. */
export async function fetchElementsForSites(siteIds) {
  if (!supabase || !Array.isArray(siteIds) || !siteIds.length) return [];
  const rows = [];
  let from = 0;
  try {
    for (;;) {
      const { data, error } = await supabase
        .from("site_elements")
        .select("site_id,data")
        .eq("kind", "el")
        .in("site_id", siteIds)
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
