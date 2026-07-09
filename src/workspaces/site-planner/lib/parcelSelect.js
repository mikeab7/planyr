/* Parcel merge-selection reducer (B735).
 *
 * The Site Planner keeps TWO parcel-selection stores: `sel` (the ONE primary parcel, drives the
 * properties panel + move/reshape) and `combineSel` (the SET of parcels picked for the Combine /
 * Merge tool). A plain click selects into `sel`; a Shift-click accumulates into `combineSel`.
 *
 * The bug this fixes: a plain-click-then-Shift-click flow never accumulated. Plain-clicking A put
 * A only in `sel`; Shift-clicking B added B to `combineSel` (which was still empty) and reset `sel`
 * to B — so A silently dropped, the 2-parcel set that Merge needs never formed, and Merge stayed
 * disabled. (Distinct from B443, which fixed Shift-clicks that never *registered* — a marquee stole
 * them. Here the click registers; the prior parcel just isn't carried over.)
 *
 * The FIX is `extendMergeSelection`: on an additive (Shift / pick-mode) click, first SEED the set
 * from the current single selection (`primaryId`) so A joins the set, then toggle the clicked id.
 * The toggle math itself is delegated to the shared `nextSelection` reducer (one source of truth,
 * shared with Document Review — B569) so the two workspaces can't drift; the two things layered on
 * top are Site-Planner-specific and can't live in the neutral shared module:
 *   1. SEED from `primaryId` (the two-store reconciliation described above).
 *   2. Inactive parcels (B170) are never ADDED to a merge set, but an already-picked one may always
 *      be removed (e.g. it was just toggled inactive).
 *
 * Parcels deliberately map Shift → toggle (add OR remove) — the "sanctioned divergence" from the
 * markup surface, where Shift is add-only. That is exactly `nextSelection(..., { toggle: true })`.
 */
import { nextSelection } from "../../../shared/markup/selection.js";

/**
 * The next merge-selection array after an additive click on `clickedId`.
 *
 * @param {string[]} current   the current combineSel array
 * @param {string}   clickedId the parcel just clicked
 * @param {object}   opts
 * @param {string|null} opts.primaryId  the currently single-selected parcel id (seeds the set), or null
 * @param {(id:string)=>*} opts.isActive returns the parcel's `active` flag; `false` = inactive
 *                                        (a missing / undefined value counts as active — the default)
 * @returns {string[]} the new combineSel array
 */
export function extendMergeSelection(current, clickedId, { primaryId = null, isActive } = {}) {
  const active = (id) => (typeof isActive === "function" ? isActive(id) !== false : true);
  let set = Array.isArray(current) ? current : [];
  // (1) Seed from the single selection before toggling — so plain-click A then Shift-click B keeps A.
  if (primaryId != null && primaryId !== clickedId && !set.includes(primaryId) && active(primaryId)) {
    set = nextSelection(set, primaryId, { add: true });
  }
  // (2) Toggle the clicked parcel. Never ADD an inactive parcel (B170); removing one is always fine.
  if (!set.includes(clickedId) && !active(clickedId)) return set;
  return nextSelection(set, clickedId, { toggle: true });
}
