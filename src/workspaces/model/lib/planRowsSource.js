/* planRowsSource — where the Model workspace gets a SIGNED-IN plan's real geometry (B1953797, H2).
 *
 * THE FACT. For a signed-in plan the drawn elements (buildings, parcels, …) live as `site_elements`
 * ROWS. The plan record a device holds locally is, for any plan that device has not OPENED, a SLIM
 * HEADER (`parcels: []`, `els: []` — cloudSync.slimForCloud), and `loadSite` only ever reads that local
 * mirror. So `Site.Acres` / `Plan.BuildingN.SF` on a second device that signed in and went straight to
 * Model read `#REF!` "no parcels drawn yet" for a 40-acre plan — and, on a device that HAD opened the
 * plan last week, quietly quoted last week's numbers. "Not fetched" was reading as "nothing there".
 *
 * THE RULE (same as the Map's parcelSummary and the Dashboard's yield): rows are canonical. A signed-in
 * Model fetches the open plan's element rows (the two kinds the formula names read — `el` and `parcel`),
 * folds them onto the local header with the ONE rows→model fold (`rowsToModel`), and reads Site.* and Plan.*
 * from that. Three explicit states — never a number that means "unknown":
 *   loading  — nothing fetched yet for this plan (`Site.Acres` → #N/A, labelled "loading")
 *   ready    — rows in hand (an EMPTY result is now a true "no parcels drawn yet")
 *   error    — the fetch failed (→ #N/A, labelled "couldn't load"; never the stale local number)
 *
 * This file is the I/O + state shape only; the derivation stays in projectRefs.js.
 */
import { supabase } from "../../site-planner/lib/supabase.js";
import { rowsToModel } from "../../site-planner/lib/elementRows.js";

export const PLAN_ROWS_KINDS = ["el", "parcel"];
const PAGE = 1000; // PostgREST's response cap — page rather than truncate silently (B868960)

// `{ planId, status: "loading"|"ready"|"error", rows }` — the value ModelApp holds and projectRefs reads.
export const planRowsLoading = (planId) => ({ planId, status: "loading", rows: [] });
export const planRowsReady = (planId, rows) => ({ planId, status: "ready", rows });
export const planRowsError = (planId, error) => ({ planId, status: "error", rows: [], error: error || "fetch failed" });

/** Every LIVE `el` + `parcel` row of ONE plan. Never throws; `{ ok:false }` on any failure so the caller
 *  shows the explicit error state instead of a number. */
export async function fetchPlanRowsForModel(planId, client = supabase) {
  if (!client || !planId) return { ok: false, rows: [], error: "no client" };
  const rows = [];
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from("site_elements")
        .select("id,kind,data,z_index,rev,deleted_at")
        .eq("site_id", planId)
        .in("kind", PLAN_ROWS_KINDS)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !Array.isArray(data)) return { ok: false, rows: [], error: (error && error.message) || "bad response" };
      rows.push(...data);
      if (data.length < PAGE) return { ok: true, rows };
    }
  } catch (e) {
    return { ok: false, rows: [], error: (e && e.message) || "fetch threw" };
  }
}

/** The plan as the formula names should read it: the local header with its element collections replaced
 *  by the rows (the same fold the planner's own read path runs). */
export function siteFromRows(header, rows) {
  return rowsToModel(header || {}, rows || []);
}

/** A cheap change signature so an unchanged refetch does not re-render / re-evaluate the workbook. */
export function rowsSignature(rows) {
  return (rows || []).map((r) => `${r.kind}:${r.id}:${r.rev ?? ""}`).join("|");
}
