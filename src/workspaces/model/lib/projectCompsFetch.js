/* Model workspace — the minimal comps read behind Comp.<title>.* (spreadsheet-live-data-refs).
 *
 * ⛔ Deliberately NOT `shared/comps/lib/compsStore.js`/`comps.js` — same "duplicate rather than
 * share across a route boundary" call this repo already makes for `releaseCanvas.js` (see that
 * file's own header in `shared/CLAUDE.md`). `comps.js` is a large pure model (lease/land/building-
 * sale derivations this feature never uses) with a STATIC Site Planner consumer (the Leasing
 * Comps panel) already; importing it here too made Rollup extract it into a THIRD shared chunk
 * that a plain Site-route load then had to fetch (measured via `npm run ci-parity`'s bundle-
 * budget gate — an unlisted "comps" chunk on the Site route's own manifest). The seven columns
 * `lib/projectRefs.js` actually reads are selected and mapped directly here instead, off the SAME
 * shared Supabase client + the SAME `public.comps` table/RLS every other reader uses (own rows +
 * team rows, soft-deleted excluded) — never a second data source, only a narrower read of the
 * one that exists.
 */
import { supabase } from "../../site-planner/lib/supabase.js";

const SELECT_COLS = "project_id,title,comp_type,comp_date,lease_rate,lease_size_sf,bldg_size_sf";

/** Every live comp's `{projectId, title, compType, compDate, leaseRate, leaseSizeSf, bldgSizeSf}`
 *  — just the fields lib/projectRefs.js's `compEntries` reads, camelCased to match its (and
 *  comps.js's own rowToComp) field-naming convention. `{data, error}`, same LOUD-FAILURE shape
 *  every store in this repo returns — never swallows a failure, just returns nothing to name. */
export async function fetchProjectNameComps() {
  if (!supabase) return { data: [], error: null };
  const { data, error } = await supabase.from("comps").select(SELECT_COLS).is("deleted_at", null);
  if (error) return { data: [], error };
  return {
    data: (data || []).map((r) => ({
      projectId: r.project_id || null,
      title: r.title || "",
      compType: r.comp_type || null,
      compDate: r.comp_date || null,
      leaseRate: r.lease_rate,
      leaseSizeSf: r.lease_size_sf,
      bldgSizeSf: r.bldg_size_sf,
    })),
    error: null,
  };
}
