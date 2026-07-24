/* Grading milestone (PR-N DECISION 2 + 3) — the finished-floor / earthwork balance layer.
 *
 * TWO pure pieces, no DOM, feet + cubic yards everywhere. Screening only — confirm final
 * grading with your civil engineer.
 *
 * DECISION 3 — the balance-optimal FFE float. The regulatory MINIMUM finished-floor is the
 * hard floor (BFE + the jurisdiction's freeboard, from lib/buildability.js requiredFfe).
 * On a site that would otherwise HAUL SPOIL OFF (net export — a big detention basin digs
 * more dirt than the pads/paving need for fill), the finished floor can float UP off that
 * floor: every foot of pad raise is fill that reuses the basin cut on site instead of
 * trucking it away. So the recommended floor is
 *     FFE = max(regulatory minimum, balance-optimal)
 * and it is NEVER below the regulatory floor (raising helps balance; lowering would break
 * code). `solveBalanceFfe` finds the smallest raise above the floor that nets the dirt
 * closest to zero. It bisects a caller-supplied net(ffe) — net dirt in CY at a trial floor,
 * monotone increasing in the floor (higher pad → more fill → less export) — so the solver
 * stays engine-agnostic and testable with a synthetic net function.
 *
 * DECISION 2 — the net residual in plain haul terms: truckloads. One tandem dump hauls
 * ~12–14 bank CY (a screening range, not a spec), so a CY residual maps to a truckload
 * COUNT the developer can picture. Bigger loads (max CY/truck) → the LOW count.
 */

// One tandem/off-road dump ≈ 12–14 bank CY (screening range — label it, never a spec).
export const TRUCK_CY_MIN = 12;
export const TRUCK_CY_MAX = 14;

/* Truckloads to move `cy` bank cubic yards, as a { lo, hi } range. Bigger loads (max
 * CY/truck) need FEWER trucks → lo; smaller loads → hi. Sign is ignored (import and
 * export both take trucks). A non-finite / zero volume → { lo:0, hi:0 }. Pure. */
export function truckloads(cy, { min = TRUCK_CY_MIN, max = TRUCK_CY_MAX } = {}) {
  const q = Math.abs(Number.isFinite(cy) ? cy : 0);
  if (!(q > 0) || !(min > 0) || !(max > 0)) return { lo: 0, hi: 0 };
  return { lo: Math.ceil(q / max), hi: Math.ceil(q / min) };
}

/* "≈ 8–10 truckloads" | "≈ 1 truckload" | "" (nothing to haul). Pure. */
export function truckloadLabel(cy, opts) {
  const { lo, hi } = truckloads(cy, opts);
  if (hi <= 0) return "";
  if (lo === hi) return `≈ ${lo.toLocaleString("en-US")} truckload${lo === 1 ? "" : "s"}`;
  return `≈ ${lo.toLocaleString("en-US")}–${hi.toLocaleString("en-US")} truckloads`;
}

/* Solve the balance-optimal finished floor. Inputs:
 *   netAtFfe(ffeFt) → net dirt CY at that trial floor (+ import / − export), or null when
 *                     the surface can't be priced (no ground elevation). MUST be monotone
 *                     non-decreasing in ffeFt.
 *   regMinFfeFt     — the regulatory floor (the hard minimum; the result never dips below).
 *   maxRaiseFt      — screening cap on how far the pad may float up for balance (default 8′).
 *   tolCy           — "balanced" band around zero net (default 10 CY).
 * Returns null when net can't be evaluated. Otherwise:
 *   { ffeFt, regMinFfeFt, balanceRaiseFt, netAtFloorCy, netCy, achieved, clamped }
 *     balanceRaiseFt — feet raised above the floor for balance (0 when the floor already
 *                      imports/balances); rounded to the 0.1-ft grading convention.
 *     clamped        — null | "imports-at-floor" (raising can't help — the site needs
 *                      import even at the floor) | "capped" (even the max raise still exports).
 * Pure. */
export function solveBalanceFfe({ netAtFfe, regMinFfeFt, maxRaiseFt = 8, tolCy = 10, iters = 24 } = {}) {
  if (typeof netAtFfe !== "function" || !Number.isFinite(regMinFfeFt)) return null;
  const n0 = netAtFfe(regMinFfeFt);
  if (n0 == null || !Number.isFinite(n0)) return null;
  const round1 = (v) => Math.round(v * 10) / 10;
  const round2 = (v) => Math.round(v * 100) / 100;
  // At the regulatory floor the site already needs import (or balances). Raising the pad
  // only adds fill → more import. The floor stands; there's no balance raise to make.
  if (n0 >= -tolCy) {
    return {
      ffeFt: round2(regMinFfeFt), regMinFfeFt, balanceRaiseFt: 0,
      netAtFloorCy: Math.round(n0), netCy: Math.round(n0),
      achieved: Math.abs(n0) <= tolCy, clamped: n0 > tolCy ? "imports-at-floor" : null,
    };
  }
  // Exporting at the floor: raise the pad to reuse the spoil. Check the cap first.
  const nCap = netAtFfe(regMinFfeFt + maxRaiseFt);
  if (nCap == null || !Number.isFinite(nCap)) return null;
  if (nCap <= -tolCy) {
    // Even the max raise still exports — report the capped raise honestly (partial).
    const raise = round1(maxRaiseFt);
    return {
      ffeFt: round2(regMinFfeFt + raise), regMinFfeFt, balanceRaiseFt: raise,
      netAtFloorCy: Math.round(n0), netCy: Math.round(nCap), achieved: false, clamped: "capped",
    };
  }
  // Bisect the raise in [0, maxRaise] for net ≈ 0 (net increases with the raise).
  let lo = 0, hi = maxRaiseFt, rm = maxRaiseFt, nm = nCap;
  for (let k = 0; k < iters; k++) {
    rm = (lo + hi) / 2;
    nm = netAtFfe(regMinFfeFt + rm);
    if (nm == null || !Number.isFinite(nm)) return null;
    if (Math.abs(nm) <= tolCy) break;
    if (nm > 0) hi = rm; else lo = rm;
  }
  const raise = round1(rm);
  return {
    ffeFt: round2(regMinFfeFt + raise), regMinFfeFt, balanceRaiseFt: raise,
    netAtFloorCy: Math.round(n0), netCy: Math.round(nm),
    achieved: Math.abs(nm) <= tolCy, clamped: null,
  };
}

/* The dual-display decomposition for the finished floor readout. Returns null when there's
 * no regulatory floor to state. Otherwise
 *   { ffeFt, floorFt, raiseFt, hasRaise,
 *     ffeText:   "FFE 155.6′",
 *     floorText: "code floor 154.1′",
 *     raiseText: "+1.5′ for earthwork balance" | "",
 *     full:      "FFE 155.6′ (code floor 154.1′ + 1.5′ for earthwork balance)"
 *              | "FFE 154.1′ (at the code floor)" }
 * The parenthetical form matches the brief and stays EM-DASH-FREE (the panel copy rule).
 * Pure — the ONE place the "reg min + balance" sentence is composed (both panel + print). */
export function ffeDualDisplay({ ffeFt = null, regMinFfeFt = null } = {}) {
  if (!Number.isFinite(regMinFfeFt)) return null;
  const floorFt = Math.round(regMinFfeFt * 10) / 10;
  const eff = Number.isFinite(ffeFt) ? Math.round(ffeFt * 10) / 10 : floorFt;
  const raiseFt = Math.round((eff - floorFt) * 10) / 10;
  const hasRaise = raiseFt > 0.05;
  const f1 = (v) => v.toFixed(1);
  const ffeText = `FFE ${f1(eff)}′`;
  const floorText = `code floor ${f1(floorFt)}′`;
  const raiseText = hasRaise ? `+${f1(raiseFt)}′ for earthwork balance` : "";
  const full = hasRaise ? `${ffeText} (${floorText} + ${f1(raiseFt)}′ for earthwork balance)` : `${ffeText} (at the code floor)`;
  return { ffeFt: eff, floorFt, raiseFt, hasRaise, ffeText, floorText, raiseText, full };
}
