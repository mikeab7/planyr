/* NEW-3 — MITIGATION BY 1-FT ELEVATION INCREMENT (hydraulic equivalence), and NEW-4's companion:
 * the mitigation TRIGGER SURFACE the bands are measured to.
 *
 * FBC Flood Damage Prevention Regs §5.02(h)(1) requires a HYDRAULICALLY EQUIVALENT (one-to-one)
 * offset for storage lost to fill. "Hydraulically equivalent" is an ELEVATION-MATCHED test —
 * storage has to be replaced in the band where it was lost, because water at elevation 141 cannot
 * be stored by a hole whose top is at 139. A matching TOTAL acre-foot figure (the Bain panel's
 * 98.2 provided vs 97.7 required) is therefore not evidence of compliance and will not survive
 * review: the totals can tie while every foot of the match is in the wrong place.
 *
 * This module builds the cut/fill table by 1-ft band from existing grade up to the governing flood
 * elevation:
 *   LOST    per band — fill placed in that elevation band inside a trigger zone (the storage the
 *           development takes away). Comes from the mitigation engine's per-cell spans.
 *   CREATED per band — compensating excavation in that same band (the storage the design gives
 *           back). Comes from the pond stage model, so it is the same integral the detention
 *           ledger reads — never a second, drifting derivation.
 *
 * Two rules the total-only method silently violated, both enforced here:
 *   (a) PER-BAND PASS/FAIL — a band that is short FAILS even when the overall total nets positive.
 *       `overallPass` is the AND of the bands, not a comparison of sums.
 *   (b) NO CREDIT BELOW THE FLOODPLAIN BOTTOM — volume excavated below the bottom of the floodplain
 *       generates fill material (useful dirt, real cost) but stores no floodwater that was lost, so
 *       it earns NO mitigation credit. It is reported separately as `excludedBelowBottomCf` so the
 *       dirt is still visible to the earthwork side without inflating compliance.
 *
 * Pure: spans + pond geometry in, a band table out. Node-testable.
 */
import { volumeBetween } from "./pondGeom.js";
import { pondElevations } from "./pondStageModel.js";

const CF_PER_ACFT = 43560;
export const DEFAULT_BAND_FT = 1;
// A band shortfall inside display precision is not a real shortfall. 0.01 ac-ft ≈ 16 yd³ — noise at
// a grid-cell boundary, not an obligation.
export const BAND_TOL_CF = 0.01 * CF_PER_ACFT;

const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const floorTo = (v, step) => Math.floor(v / step) * step;

/* Bucket a set of per-cell fill SPANS into elevation bands. A span is one grid cell's column of
 * fill: { loFt (existing grade), hiFt (top of fill, already capped at the flood surface), areaSf }.
 * Its volume distributes across the bands it crosses in proportion to the height in each — so a
 * 3.4-ft column starting at 138.2 puts 0.8 ft into the 138–139 band, 1 ft each into 139–140 and
 * 140–141, and 0.6 ft into 141–142. Pure. */
export function bandSpans(spans = [], { bandFt = DEFAULT_BAND_FT, datumFt = null } = {}) {
  const step = bandFt > 0 ? bandFt : DEFAULT_BAND_FT;
  const map = new Map(); // band lo → cf
  let totalCf = 0;
  for (const s of spans) {
    const lo = num(s.loFt), hi = num(s.hiFt), area = num(s.areaSf);
    if (lo == null || hi == null || area == null || !(hi > lo) || !(area > 0)) continue;
    const anchor = datumFt != null ? datumFt : 0;
    let b = anchor + floorTo(lo - anchor, step);
    while (b < hi - 1e-9) {
      const bandLo = Math.max(b, lo), bandHi = Math.min(b + step, hi);
      const cf = (bandHi - bandLo) * area;
      if (cf > 0) {
        map.set(b, (map.get(b) || 0) + cf);
        totalCf += cf;
      }
      b += step;
    }
  }
  const bands = [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([loFt, cf]) => ({ loFt, hiFt: loFt + step, cf }));
  return { bands, totalCf, bandFt: step };
}

/* The CREATED side: compensating storage a pond gives back, by band, from the pond's own stage
 * model — the same `volumeBetween` integral detention reads, so the two ledgers can never drift.
 *
 * Bands run from the pond's achievable floor up to `floodElevFt` (the governing trigger surface —
 * storage above the flood line replaces nothing that the flood occupied). Volume below
 * `floodplainBottomFt` is EXCLUDED from credit and reported separately: it is borrow, not offset.
 *
 * `ponds`: [{ id, name, ring, det }]. Ponds without an anchor (no top-of-bank elevation) are
 * reported in `unanchoredIds` and contribute nothing — never a silently-credited zero. Pure. */
export function createdBands(ponds = [], { bandFt = DEFAULT_BAND_FT, floodElevFt = null, floodplainBottomFt = null, datumFt = null } = {}) {
  const step = bandFt > 0 ? bandFt : DEFAULT_BAND_FT;
  const flood = num(floodElevFt);
  const bottom = num(floodplainBottomFt);
  const map = new Map();
  const unanchoredIds = [];
  let totalCf = 0, excludedBelowBottomCf = 0;
  if (flood == null) {
    return { bands: [], totalCf: 0, excludedBelowBottomCf: 0, unanchoredIds: ponds.map((p) => p.id), bandFt: step, known: false };
  }
  for (const p of ponds) {
    const el = pondElevations(p.ring, p.det || {});
    if (!el) { unanchoredIds.push(p.id); continue; }
    // Credit only the column between the floodplain bottom (or the pond floor, whichever is
    // higher) and the flood surface. Everything under the bottom is borrow.
    const creditFloor = bottom != null ? Math.max(el.floorElev, bottom) : el.floorElev;
    if (bottom != null && bottom > el.floorElev + 1e-9) {
      excludedBelowBottomCf += volumeBetween(p.ring, p.det || {}, el.floorElev, Math.min(bottom, el.waterSurfElev)) || 0;
    }
    const top = Math.min(flood, el.waterSurfElev);
    if (!(top > creditFloor + 1e-9)) continue;
    const anchor = datumFt != null ? datumFt : 0;
    for (let b = anchor + floorTo(creditFloor - anchor, step); b < top - 1e-9; b += step) {
      const lo = Math.max(b, creditFloor), hi = Math.min(b + step, top);
      const cf = volumeBetween(p.ring, p.det || {}, lo, hi) || 0;
      if (cf > 0) { map.set(b, (map.get(b) || 0) + cf); totalCf += cf; }
    }
  }
  const bands = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([loFt, cf]) => ({ loFt, hiFt: loFt + step, cf }));
  return { bands, totalCf, excludedBelowBottomCf, unanchoredIds, bandFt: step, known: true };
}

/* THE band ledger: lost vs created, band by band, with per-band pass/fail and an overall result
 * that FAILS if ANY band is short — even when the total nets positive. That inversion is the whole
 * point: the Bain panel's +0.5 ac-ft total surplus is consistent with several feet of the column
 * being uncompensated.
 *
 * `ratio` is the jurisdiction's offset ratio (FBC: 1:1). Required per band = lost × ratio.
 *
 * Returns:
 *   bands[]          { loFt, hiFt, lostCf, requiredCf, createdCf, netCf, pass, shortCf }
 *   overallPass      AND over the bands (null when the inputs are unknown)
 *   shortBands[]     the failing bands, deepest first (the ones an engineer has to answer for)
 *   totals           { lostCf, requiredCf, createdCf, netCf, shortCf }
 *   totalWouldPass   what the OLD total-only method would have concluded — carried so the panel can
 *                    say "the totals tie, the elevations do not", which is the finding.
 * Pure. */
export function bandLedger({ lost = null, created = null, ratio = 1, tolCf = BAND_TOL_CF } = {}) {
  if (!lost || !created || created.known === false) {
    return { known: false, bands: [], overallPass: null, shortBands: [], totals: null, totalWouldPass: null, reason: "flood elevation or pond anchor missing — the elevation-matched test cannot run" };
  }
  const r = num(ratio) != null && num(ratio) > 0 ? num(ratio) : 1;
  const step = lost.bandFt || created.bandFt || DEFAULT_BAND_FT;
  const keys = new Set([...lost.bands.map((b) => b.loFt), ...created.bands.map((b) => b.loFt)]);
  const lostAt = new Map(lost.bands.map((b) => [b.loFt, b.cf]));
  const createdAt = new Map(created.bands.map((b) => [b.loFt, b.cf]));
  const bands = [...keys].sort((a, b) => a - b).map((loFt) => {
    const lostCf = lostAt.get(loFt) || 0;
    const requiredCf = lostCf * r;
    const createdCf = createdAt.get(loFt) || 0;
    const netCf = createdCf - requiredCf;
    return {
      loFt, hiFt: loFt + step,
      lostCf, requiredCf, createdCf, netCf,
      pass: netCf >= -tolCf,
      shortCf: netCf < -tolCf ? -netCf : 0,
    };
  });
  const totals = bands.reduce((t, b) => ({
    lostCf: t.lostCf + b.lostCf,
    requiredCf: t.requiredCf + b.requiredCf,
    createdCf: t.createdCf + b.createdCf,
    netCf: t.netCf + b.netCf,
    shortCf: t.shortCf + b.shortCf,
  }), { lostCf: 0, requiredCf: 0, createdCf: 0, netCf: 0, shortCf: 0 });
  const shortBands = bands.filter((b) => !b.pass).sort((a, b) => a.loFt - b.loFt);
  return {
    known: true,
    bandFt: step,
    ratio: r,
    bands,
    overallPass: shortBands.length === 0,
    shortBands,
    totals,
    excludedBelowBottomCf: created.excludedBelowBottomCf || 0,
    unanchoredIds: created.unanchoredIds || [],
    // What a total-only comparison would have said — the contrast IS the finding.
    totalWouldPass: totals.createdCf >= totals.requiredCf - tolCf,
  };
}
