/* NEW-A3 — the STAGE–STORAGE–DISCHARGE curve: the bridge from geometry + outlet to routing.
 *
 * A reservoir-routing pass needs, at each water-surface elevation, BOTH how much the basin
 * holds (storage) and how fast the outlet lets it out (discharge). This module builds that
 * table for a pond by pairing:
 *   • STORAGE   — pondGeom.volumeBetween (the same average-end-area stage integration the
 *                 detention ledger + banded-storage split use, so this can never disagree
 *                 with the volume shown elsewhere), from the basin floor up to top of bank; and
 *   • DISCHARGE — outletStructure.outletDischarge at that elevation.
 *
 * The curve runs from the basin FLOOR (tobElev − min(depth, maxDepth)) to TOP OF BANK
 * (tobElev), sampled at `steps` increments. Elevations, feet NAVD88; storage, cubic feet;
 * discharge, cfs. Anchored ponds only (needs det.tobElev) — an unanchored pond returns a
 * reason, never a fabricated datum (LOUD-FAILURE). Pure + Node-testable; no DOM/network. */
import { volumeBetween } from "./pondGeom.js";
import { maxInwardOffset } from "./pondOffset.js";
import { outletDischarge, outletLowestElev } from "./outletStructure.js";

const detOf = (det = {}) => ({
  depth: Number.isFinite(det.depth) ? det.depth : 8,
  freeboard: Number.isFinite(det.freeboard) ? det.freeboard : 1,
  slope: Number.isFinite(det.slope) ? det.slope : 3,
});

/* Build the stage-storage-discharge curve for an anchored pond + its outlet.
 * Returns { ok, curve, floorElevFt, tobElevFt, designWsElevFt, maxDepthFt, outletLowestElevFt,
 *           outletProblems } or { ok:false, reason }. `steps` is the sample count between
 * floor and top of bank (default 24 → ~0.3-ft resolution on an 8-ft basin). Pure. */
export function buildStageStorageDischarge({ ring = null, det = null, outlet = null, criteria = null, tailwaterElevFt = null, steps = 24 } = {}) {
  if (!Array.isArray(ring) || ring.length < 3) return { ok: false, reason: "no pond footprint" };
  const tob = det && det.tobElev;
  if (tob == null || !isFinite(tob)) return { ok: false, reason: "pond not anchored — set a top-of-bank elevation first" };
  const { depth, freeboard, slope } = detOf(det);
  const maxDepth = slope > 0 ? maxInwardOffset(ring) / slope : 0;
  const floorElev = tob - Math.min(depth, maxDepth);
  const designWsElev = tob - freeboard;
  if (!(tob > floorElev)) return { ok: false, reason: "degenerate basin (floor at or above top of bank)" };

  const n = Math.max(4, Math.floor(steps));
  const curve = [];
  for (let i = 0; i <= n; i++) {
    const elev = floorElev + ((tob - floorElev) * i) / n;
    const storageCf = volumeBetween(ring, det, floorElev, elev) || 0;
    const d = outletDischarge(elev, outlet, { criteria, tailwaterElevFt });
    curve.push({ elevFt: round3(elev), stageFt: round3(elev - floorElev), storageCf: Math.max(0, storageCf), dischargeCfs: Math.max(0, d.cfs) });
  }
  // First-sample discharge problems describe the outlet model itself (elevation-independent).
  const probe = outletDischarge(designWsElev, outlet, { criteria, tailwaterElevFt });
  return {
    ok: true,
    curve,
    floorElevFt: round3(floorElev),
    tobElevFt: round3(tob),
    designWsElevFt: round3(designWsElev),
    maxDepthFt: round3(Math.min(depth, maxDepth)),
    outletLowestElevFt: round3num(outletLowestElev(outlet)),
    outletProblems: probe.problems,
  };
}

/* Interpolate storage (cf) at an elevation from a built curve (clamped to its ends). Pure. */
export function storageAtElev(curve, elevFt) {
  return interp(curve, "elevFt", "storageCf", elevFt);
}
/* Interpolate discharge (cfs) at an elevation from a built curve (clamped). Pure. */
export function dischargeAtElev(curve, elevFt) {
  return interp(curve, "elevFt", "dischargeCfs", elevFt);
}
/* Interpolate the elevation (ft) at a target storage (cf) — the inverse the storage-
 * indication routing needs to read discharge back out of a storage state. Clamped. Pure. */
export function elevAtStorage(curve, storageCf) {
  return interp(curve, "storageCf", "elevFt", storageCf);
}
/* Interpolate discharge (cfs) at a target storage (cf). Pure. */
export function dischargeAtStorage(curve, storageCf) {
  return interp(curve, "storageCf", "dischargeCfs", storageCf);
}

/* Generic clamped piecewise-linear interpolation over a curve sorted ascending by xKey. */
function interp(curve, xKey, yKey, x) {
  if (!Array.isArray(curve) || !curve.length || !Number.isFinite(x)) return null;
  if (x <= curve[0][xKey]) return curve[0][yKey];
  const last = curve[curve.length - 1];
  if (x >= last[xKey]) return last[yKey];
  for (let i = 0; i + 1 < curve.length; i++) {
    const a = curve[i], b = curve[i + 1];
    if (x >= a[xKey] && x <= b[xKey]) {
      const span = b[xKey] - a[xKey];
      if (span <= 0) return a[yKey];
      return a[yKey] + ((b[yKey] - a[yKey]) * (x - a[xKey])) / span;
    }
  }
  return last[yKey];
}

const round3 = (n) => Math.round(n * 1000) / 1000;
const round3num = (n) => (n == null || !Number.isFinite(n) ? null : round3(n));
