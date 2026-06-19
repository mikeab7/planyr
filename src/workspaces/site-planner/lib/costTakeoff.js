/* Cost takeoff — priced quantities derived from drawn site elements.
 *
 * Today this covers ROAD segments, which yield TWO independent, separately-priced
 * quantities (B181):
 *   • Paving — an AREA item, in square yards (SY; 1 SY = 9 SF). Width is measured
 *     FACE-OF-CURB to FACE-OF-CURB (the drivable asphalt surface) — the curb is
 *     NOT folded into the paving width (B180). Where the curb is curb-and-gutter,
 *     the concrete gutter pan rides with the curb LF item, so the asphalt paving is
 *     trimmed by the pan width on each curbed side.
 *   • Curb — a LINEAR item, in linear feet (LF). BOTH sides are counted: a 1,000 ft
 *     road curbed both sides = 2,000 LF. The curb TYPE (barrier vs curb-and-gutter)
 *     selects which unit price the LF rides on.
 *
 * Pure functions only (no React, no geometry helpers from the canvas) so the math is
 * unit-testable. Geometry (FC-FC width, length) is passed in by the caller, which is
 * also the single place that knows a road's live dimensions.
 *
 * Unit prices are ALWAYS user-supplied (anchor to the user's own recent regional
 * bids) — never hard-coded. A missing price reports the quantity with no extended
 * cost rather than inventing a number.
 *
 * Hook for later: radius/corner curb is often a separate, higher-priced LF item.
 * It is NOT broken out yet, but `roadQuantities` returns a `curbCategory: "linear"`
 * tag so a future "radius" category can be added as its own line without reworking
 * the rollup. */

export const SF_PER_SY = 9;             // 1 square yard = 9 square feet
export const DEFAULT_PAN_WIDTH = 2.0;   // ft — concrete gutter pan (24"), each curbed side

// Curb types. `hasPan` = the type carries a flat concrete gutter pan that the paving
// area must be trimmed by (the pan is concrete, priced with the curb LF, not asphalt).
export const CURB_TYPE_META = {
  none:          { label: "No curb",      hasPan: false, hint: "no curb — full FC-FC width is paving" },
  barrier:       { label: "Barrier curb", hasPan: false, hint: "vertical ~6\" lip; no gutter pan" },
  "curb-gutter": { label: "Curb & gutter", hasPan: true,  hint: "curb + flat gutter pan (typ. 18–24\")" },
};
export const CURB_TYPES = ["none", "barrier", "curb-gutter"];

// --- Read the cost attributes off a road element (all additive/optional) ---
export const roadCurbType = (el) => (CURB_TYPES.includes(el && el.curbType) ? el.curbType : "barrier");
export const roadCurbedSides = (el) => {
  if (roadCurbType(el) === "none") return 0;          // no curb ⇒ no curbed sides
  const s = el && el.curbedSides;
  return s === 0 || s === 1 || s === 2 ? s : 2;       // default: curbed both sides
};
// Gutter-pan width (ft) per curbed side — 0 unless the type actually has a pan.
export const roadPanWidth = (el) => {
  if (!CURB_TYPE_META[roadCurbType(el)].hasPan) return 0;
  const p = el && el.panWidth;
  return Number.isFinite(p) && p > 0 ? p : DEFAULT_PAN_WIDTH;
};

/* Priced quantities for ONE road segment.
 *   fcfcWidth — face-of-curb to face-of-curb paving width (ft). EXCLUDES the curb
 *               (B180): a 30' FC-FC road is 30' of paving, never 31'.
 *   lengthFt  — segment length (ft).
 * Returns the asphalt paving (SY) and the curb (LF, both sides), plus the inputs
 * used so a caller can show the working. */
export function roadQuantities(el, fcfcWidth, lengthFt) {
  const w = Math.max(0, +fcfcWidth || 0);
  const L = Math.max(0, +lengthFt || 0);
  const sides = roadCurbedSides(el);
  const pan = roadPanWidth(el);                 // 0 unless curb-and-gutter
  const curbType = roadCurbType(el);
  // Curb is linear, counted on every curbed side.
  const curbLf = L * sides;
  // Asphalt paving = FC-FC width minus the concrete gutter pan on each curbed side
  // (the pan is priced with the curb LF, so it must not also be counted as asphalt).
  const pavingWidth = Math.max(0, w - pan * sides);
  const pavingSf = pavingWidth * L;
  const pavingSy = pavingSf / SF_PER_SY;
  return {
    lengthFt: L, fcfcWidth: w, curbType, curbedSides: sides, panWidth: pan,
    curbCategory: "linear",                     // hook: future "radius" category
    pavingWidth, pavingSf, pavingSy, curbLf,
  };
}

// A user-entered unit price → a finite number, or null (blank / not yet supplied).
const priceOf = (v) => {
  if (v == null || v === "") return null;
  const n = +v;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const extend = (qty, price) => (price == null ? null : qty * price);

/* Roll up every road segment into site-wide quantities + (where priced) extended
 * cost. `fcfcOf(el)` and `lengthOf(el)` let the caller supply live geometry. Curb LF
 * is split by type so each rides its own unit price. `prices` keys:
 * { pavingSy, curbBarrierLf, curbGutterLf } — all optional, all user-supplied. */
export function costRollup(els, fcfcOf, lengthOf, prices = {}) {
  let pavingSy = 0, curbBarrierLf = 0, curbGutterLf = 0, segments = 0;
  for (const el of els || []) {
    if (!el || el.type !== "road" || el.points) continue;  // rect roads only
    const q = roadQuantities(el, fcfcOf(el), lengthOf(el));
    pavingSy += q.pavingSy;
    if (q.curbType === "curb-gutter") curbGutterLf += q.curbLf;
    else if (q.curbType === "barrier") curbBarrierLf += q.curbLf;
    segments++;
  }
  const pPaving = priceOf(prices.pavingSy);
  const pBarrier = priceOf(prices.curbBarrierLf);
  const pGutter = priceOf(prices.curbGutterLf);
  const pavingCost = extend(pavingSy, pPaving);
  const curbBarrierCost = extend(curbBarrierLf, pBarrier);
  const curbGutterCost = extend(curbGutterLf, pGutter);
  const costs = [pavingCost, curbBarrierCost, curbGutterCost].filter((c) => c != null);
  const total = costs.length ? costs.reduce((s, c) => s + c, 0) : null;
  return {
    segments,
    pavingSy, curbBarrierLf, curbGutterLf,
    pavingCost, curbBarrierCost, curbGutterCost, total,
  };
}
