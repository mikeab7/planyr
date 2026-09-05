/* dashboardCompsFetch — the one `comps` read the Comps summary card needs (B1213313, NEW-2).
 * Deliberately lighter than `shared/comps/lib/compsStore.js`'s `fetchAllComps()` (every column) —
 * a summary card only needs the type breakdown.
 */
import { supabase } from "../../site-planner/lib/supabase.js";

const COMP_TYPES = ["land", "building_sale", "lease"];

/** { total, land, building_sale, lease } or null if the read failed. */
export async function fetchCompsCounts() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("comps").select("comp_type").is("deleted_at", null);
    if (error || !Array.isArray(data)) return null;
    const counts = { total: data.length, land: 0, building_sale: 0, lease: 0 };
    for (const row of data) { if (COMP_TYPES.includes(row.comp_type)) counts[row.comp_type]++; }
    return counts;
  } catch (_) {
    return null;
  }
}
