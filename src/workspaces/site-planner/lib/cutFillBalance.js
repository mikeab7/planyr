/* NEW-10 — SITE CUT / FILL BALANCE, and labelling a BORROW-DRIVEN storage surplus.
 *
 * Bain's ponds hold 206.3 ac-ft = ~333,000 CY of cut, against roughly 290,000 CY needed to raise
 * ~60 ac of pad ~3 ft. That near-balance strongly suggests the 197% detention overbuild is
 * BORROW-DRIVEN, not hydraulic — the ponds are that big because the site needed the dirt.
 *
 * Why the distinction matters commercially: a later value-engineering pass that "right-sizes" the
 * ponds down toward the 76.7 ac-ft requirement would suddenly need to IMPORT six figures of cubic
 * yards of fill. Read as hydraulic slack, the surplus looks like free money; read as borrow, it is
 * load-bearing. The panel must not let the reader mistake one for the other.
 *
 * Shrink factor: excavated material loses volume when compacted into a pad (or gains, for some
 * clays placed loose). A configurable factor converts bank cut → placed fill. Default 1.0 (no
 * adjustment) so the number is never silently massaged; a user/criteria value applies visibly.
 *
 * Pure: cubic feet / cubic yards in, a balance summary out. Node-testable.
 */

const CF_PER_CY = 27;
const CF_PER_ACFT = 43560;
const SQFT_PER_ACRE = 43560;
const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

export const DEFAULT_SHRINK_FACTOR = 1.0;
// How close cut and fill have to be for the balance to "explain" a storage surplus. Within 25% of
// each other reads as a site that was dug for its dirt, not for its hydraulics.
export const BALANCE_EXPLAINS_TOL = 0.25;

/* The balance itself.
 *   cutCf          total excavation (the ponds, plus any other cut) in cubic feet
 *   fillCf         total fill demand (pad raise, courts, berms) in cubic feet
 *   shrinkFactor   placed fill per unit of bank cut (see above)
 *
 * Returns cut/fill in CY, the net (positive = surplus dirt to export, negative = import needed),
 * and the balance ratio. Null-safe: an unknown input returns `known:false` rather than a zero.
 * Pure. */
export function cutFillBalance({ cutCf = null, fillCf = null, shrinkFactor = DEFAULT_SHRINK_FACTOR } = {}) {
  const cut = num(cutCf), fill = num(fillCf);
  const sf = num(shrinkFactor) != null && num(shrinkFactor) > 0 ? num(shrinkFactor) : DEFAULT_SHRINK_FACTOR;
  if (cut == null || fill == null) {
    return { known: false, cutCy: cut == null ? null : cut / CF_PER_CY, fillCy: fill == null ? null : fill / CF_PER_CY, shrinkFactor: sf, reason: cut == null ? "excavation volume unknown" : "fill demand unknown" };
  }
  const usableFillCf = cut * sf;             // what the cut actually yields once placed
  const netCf = usableFillCf - fill;         // + surplus to export, − import needed
  const ratio = fill > 0 ? usableFillCf / fill : null;
  return {
    known: true,
    cutCf: cut, fillCf: fill,
    cutCy: cut / CF_PER_CY, fillCy: fill / CF_PER_CY,
    usableFillCf, usableFillCy: usableFillCf / CF_PER_CY,
    netCf, netCy: netCf / CF_PER_CY,
    shrinkFactor: sf,
    ratio,
    state: ratio == null ? "no-fill" : Math.abs(ratio - 1) <= BALANCE_EXPLAINS_TOL ? "balanced" : ratio > 1 ? "surplus" : "import",
  };
}

/* Screening estimate of the FILL demand from a pad raise: area × raise. Kept here so the balance
 * card can stand on its own when the full grading engine hasn't run. Pure. */
export function padFillDemandCf({ padAcres = null, raiseFt = null } = {}) {
  const a = num(padAcres), r = num(raiseFt);
  if (a == null || r == null || a <= 0 || r <= 0) return null;
  return a * SQFT_PER_ACRE * r;
}

/* NEW-10's second half: is the DETENTION storage surplus explained by the dirt balance?
 *
 *   requiredCf / providedCf   the detention ledger
 *   balance                   a cutFillBalance() result
 *
 * A surplus is labelled BORROW-DRIVEN when the site's cut and fill roughly balance — i.e. the extra
 * pond volume is exactly the hole the pad raise dug. The label matters because it inverts the
 * commercial reading: `slack:false` means shrinking the ponds costs imported fill.
 *
 * Returns null when there is no surplus, or when the balance isn't known (never a guess). Pure. */
export function classifyStorageSurplus({ requiredCf = null, providedCf = null, balance = null } = {}) {
  const req = num(requiredCf), prov = num(providedCf);
  if (req == null || prov == null || !(prov > req)) return null;
  const surplusCf = prov - req;
  const surplusPct = req > 0 ? surplusCf / req : null;
  if (!balance || !balance.known) {
    return { surplusCf, surplusAcFt: surplusCf / CF_PER_ACFT, surplusPct, driver: "unknown", slack: null, note: "Storage exceeds the requirement. Whether that surplus is genuine slack or the hole the pad fill came out of cannot be told until the site cut/fill balance is known." };
  }
  const borrowDriven = balance.state === "balanced" || balance.state === "import";
  // How much of the surplus the fill demand could account for, in the same units the reader sees.
  const surplusCy = surplusCf / CF_PER_CY;
  return {
    surplusCf, surplusAcFt: surplusCf / CF_PER_ACFT, surplusPct, surplusCy,
    driver: borrowDriven ? "borrow" : "hydraulic",
    slack: !borrowDriven,
    balanceState: balance.state,
    // The import a naive right-sizing would create: shrinking the ponds by the surplus removes that
    // much cut, which then has to be bought and hauled in.
    importIfShrunkCy: borrowDriven ? surplusCy * (balance.shrinkFactor || 1) : 0,
    note: borrowDriven
      ? `This storage surplus is BORROW-DRIVEN, not slack: the site's cut and fill roughly balance, so the extra pond volume is the hole the pad fill came out of. Shrinking the ponds toward the bare requirement would create roughly ${Math.round(surplusCy * (balance.shrinkFactor || 1)).toLocaleString("en-US")} CY of imported fill.`
      : "The site's cut exceeds its fill demand, so this storage surplus is genuine slack — the ponds could be reduced without creating a fill import.",
  };
}

/* The one call the panel makes: balance + surplus classification in one object. Pure. */
export function assessCutFill({ cutCf = null, fillCf = null, shrinkFactor = DEFAULT_SHRINK_FACTOR, requiredCf = null, providedCf = null } = {}) {
  const balance = cutFillBalance({ cutCf, fillCf, shrinkFactor });
  return { balance, surplus: classifyStorageSurplus({ requiredCf, providedCf, balance }) };
}
