/* dashboardParcelFetch — the parcel rows behind the Locations map's pin placement (see
 * dashboardParcelAnchors.js). Same paged `site_elements` read shape as dashboardYieldFetch.js,
 * narrowed to kind='parcel' for just the plotted projects' representative plans. Read-only.
 * Returns [] on any failure — the pins then fall back to the saved origin, never throw. */
import { supabase } from "../../site-planner/lib/supabase.js";

const PAGE_SIZE = 1000;

export async function fetchParcelsForSites(siteIds) {
  if (!supabase || !Array.isArray(siteIds) || !siteIds.length) return [];
  const rows = [];
  let from = 0;
  try {
    for (;;) {
      const { data, error } = await supabase
        .from("site_elements")
        .select("site_id,data")
        .eq("kind", "parcel")
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
