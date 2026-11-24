/* dashboardCompsFetch — the Comps card's one read (NEW-COMPS-CARD, replacing the old bare-count
 * card — B1213313, NEW-2). The card shows the most recently added comp against its real peers, not
 * a count, so it needs every comp's full row (county, size, rate, dates) rather than just
 * `comp_type` — reuses `shared/comps/lib/compsStore.js`'s `fetchAllComps()` (the same canonical
 * read every other comp consumer in the app uses) rather than a second, narrower select that could
 * drift from it. The derivation itself (which comp is featured, who its peers are, the sentence)
 * is pure and lives in `lib/compsCardModel.js` — this file only fetches.
 */
import { fetchAllComps } from "../../../shared/comps/lib/compsStore.js";
import { supabase } from "../../site-planner/lib/supabase.js";

/** Every live comp the signed-in user can see, or `[]` on any failure — LOUD-FAILURE is for
 * writes; a dashboard summary card that can't reach this one source still renders the other cards
 * (Dashboard.jsx's own standing rule), so this degrades to an empty list rather than throwing. */
export async function fetchAllCompsForCard() {
  try {
    const { data, error } = await fetchAllComps();
    if (error) return [];
    // Buildings under construction and available space are SUPPLY, not transactions: the card
    // compares a deal against its peer deals, so they never enter it (they live in Records and on the map).
    return (data || []).filter((c) => c.compType !== "under_construction" && c.compType !== "available");
  } catch (_) {
    return [];
  }
}

/* NEW-1 (Locations map card) — comps carry a real, top-level lat/lon (comps_parcel_anchor_has_identity's
 * NOT NULL anchor, see shared/comps/lib/comps.js's own header) regardless of anchor kind (pin /
 * parcel / site_plan), so this is a plain column read — no jsonb path, unlike sites' `origin`.
 * Deliberately lighter than fetchAllComps(): the map only ever draws a quiet, unlabeled dot per
 * comp, so id + position is the whole shape it needs. */
export async function fetchCompsForMap() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.from("comps").select("id, lat, lon").is("deleted_at", null);
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch (_) {
    return [];
  }
}
