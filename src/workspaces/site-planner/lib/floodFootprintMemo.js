/* @planner-extract — AUDIT BATCH G1: the flood-footprint memo helpers (mitigationForFootprint, pondFloodFacts), moved verbatim out of
 * SitePlanner.jsx. Behaviour-identical; see test/helpers/plannerSource.js. */
import { polyArea } from "./siteGeometry.js";
import { ruleSignature } from "./floodplainRules.js";
import { computeMitigation, wse1pctForRing, ringInTrigger } from "./floodplainMitigation.js";


/* B707/B712 — which drawn elements count as FILL for the mitigation screen: the
 * same set the yield math treats as impervious (buildings incl. bump-outs, paving,
 * parking, trailer courts). Ponds are CUT, never fill; roads ride their strip math
 * elsewhere and are deliberately out of the v1 screening set. */
export const FM_FILL_TYPES = new Set(["building", "paving", "parking", "trailer"]);

/* Per-element mitigation memo (the pondGeom _detMemo idiom): the metrics pass runs
 * per render, so during a drag only the dragged element's signature changes and
 * everything else returns from cache — the whole-site grid never recomputes per
 * frame. Sig covers the footprint geometry + every elevation/rule input + the
 * flood-geometry fetch stamp. */
const _mitMemo = new Map();
const MIT_MEMO_MAX = 64;
// Cheap position-sensitive ring checksum: an AREA-PRESERVING vertex edit (slide a
// middle vertex along a wall line) must still bust the memo — count + first point +
// area alone would serve stale intersect geometry for it.
export const ringHash = (ring) => {
  let h = 0;
  for (let i = 0; i < ring.length; i++) h += (ring[i].x * 7 + ring[i].y * 3) * (i + 1);
  return Math.round(h);
};
export function mitigationForFootprint(fp, zones, rule, elev, zonesSig) {
  const sig = [
    fp.id, fp.ring.length, ringHash(fp.ring), polyArea(fp.ring).toFixed(0),
    fp.padElevFt ?? "", zonesSig, ruleSignature(rule),
    elev.padElevFt ?? "", elev.existGradeFt ?? "", elev.bfeFt ?? "", elev.derivedBfeFt ?? "", elev.derivedXsWselFt ?? "", elev.derivedWse02Ft ?? "", elev.wse02Ft ?? "", elev.avgFillDepthFt ?? "",
    // B807 — the async-arriving derived 1% MUST be in the sig, or a value that lands
    // after the first compute silently never re-prices (the stale-memo trap).
    elev.derivedWse1pctFt ?? "", elev.derivedWse1pctSrc ?? "",
    // B808 — same trap for the async-arriving DEM grid.
    elev.gradeAtKey ?? "",
    // B826 — the proposed-surface identity: a re-graded plane must re-price.
    fp.surfaceKey ?? "",
  ].join("~");
  if (_mitMemo.has(sig)) {
    const hit = _mitMemo.get(sig);
    _mitMemo.delete(sig); _mitMemo.set(sig, hit);
    return hit;
  }
  // B809 — retain the priced cells: the heat map renders the SAME array that summed.
  // NEW-3 — also retain each cell's elevation SPAN (grade → top of fill), which is what the
  // hydraulic-equivalence band ledger needs; the totals are computed in the same pass, so a band
  // can never disagree with the volume it came from.
  const val = computeMitigation({ footprints: [fp], zones, rule, elev, opts: { retainCells: true, bandSpans: true } });
  _mitMemo.set(sig, val);
  if (_mitMemo.size > MIT_MEMO_MAX) _mitMemo.delete(_mitMemo.keys().next().value);
  return val;
}

/* Per-pond flood facts (governing WSE + in-trigger), memoized like the fill memo —
 * the metrics pass asks for these for EVERY pond each render, and the underlying
 * grid tests would otherwise jank drags on exactly the in-floodplain sites this
 * feature targets. */
const _pondFactsMemo = new Map();
export function pondFloodFacts(ring, zones, rule, { bfeFt, bfeSrc, existGradeFt, derivedBfeFt, derivedXsWselFt, derivedWse1pctFt, derivedWse1pctSrc }, zonesSig) {
  const sig = [ring.length, ringHash(ring), zonesSig, ruleSignature(rule), bfeFt ?? "", bfeSrc ?? "", existGradeFt ?? "", derivedBfeFt ?? "", derivedXsWselFt ?? "", derivedWse1pctFt ?? "", derivedWse1pctSrc ?? ""].join("~");
  if (_pondFactsMemo.has(sig)) {
    const hit = _pondFactsMemo.get(sig);
    _pondFactsMemo.delete(sig); _pondFactsMemo.set(sig, hit);
    return hit;
  }
  // NEW-2 — keep the WSE provider tag beside the value so the pond split can stamp an
  // ESTIMATED water surface (est-boundary-grade rides the manual rung with its own tag).
  const w = wse1pctForRing(ring, zones, { bfeFt, bfeSrc, existGradeFt, derivedBfeFt, derivedXsWselFt, derivedWse1pctFt, derivedWse1pctSrc });
  const val = {
    wseFt: w.wseFt,
    wseSrc: w.provider ?? null,
    inTrigger: ringInTrigger(ring, zones, rule),
  };
  _pondFactsMemo.set(sig, val);
  if (_pondFactsMemo.size > MIT_MEMO_MAX) _pondFactsMemo.delete(_pondFactsMemo.keys().next().value);
  return val;
}
