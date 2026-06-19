/* "Place on map" auto-placement cascade (B178 / NEW-3).
 *
 * When the user places a filed drawing, walk the methods best→fallback and stop at the
 * first that runs WITH CONFIDENCE. The choice is driven entirely by the NEW-2 placement
 * facts captured at filing time, so we never reopen the file to decide. Pure logic: this
 * picks the method + explains every rung it skipped (never a silent fall-through); the
 * actual geometry handoff (reproject / boundary-fit / measure-scale / manual calibrate)
 * lives in the overlay machinery (overlayAlign.js / overlayScale.js / the EPSG:2278
 * spine) which the caller invokes for the chosen rung.
 *
 * Rung order (best → fallback):
 *   1 EMBEDDED   — file carries real-world coords; land exactly, no scaling (reproject).
 *   2 FIT_BOUNDARY — solve scale+rotation+translation in one affine/Helmert fit by
 *                    matching the drawing's boundary to the held parcel/survey geometry.
 *                    Preferred over any STATED scale — a printed scale is a claim about
 *                    original plot size and breaks under "fit to page"/copier resize;
 *                    geometry is ground truth.
 *   3 MEASURE    — scale bar or a labeled dimension; divide drawn length by the annotated
 *                  real value (resize-invariant). Prefer the longest baseline; use the
 *                  north arrow for rotation, then position to the parcel.
 *   4 MANUAL     — last resort: trace a labeled dimension by hand (B179 calibration).
 */
import { longestDimension } from "./placementFacts.js";

export const METHOD = {
  EMBEDDED: "embedded",
  FIT_BOUNDARY: "fit-boundary",
  MEASURE: "measure-graphic",
  MANUAL: "manual",
};

// Rung definitions in priority order. Each `evaluate(facts, ctx)` returns either
// { ok:true, detail } (this rung can run with confidence) or { ok:false, reason }
// (why it was skipped — surfaced, never swallowed).
export const RUNGS = [
  {
    method: METHOD.EMBEDDED,
    label: "Embedded coordinates",
    evaluate(facts, ctx) {
      const e = facts.embeddedCoords;
      if (!e || !e.present) return { ok: false, reason: "No real-world coordinates embedded in the file." };
      if (!ctx.canReproject) return { ok: false, reason: `Coordinates present (${e.crs || "unknown CRS"}) but reprojection to the project grid isn't available yet.` };
      return { ok: true, detail: { crs: e.crs || null } };
    },
  },
  {
    method: METHOD.FIT_BOUNDARY,
    label: "Fit to known boundary",
    evaluate(facts, ctx) {
      if (!facts.boundary || !facts.boundary.present) return { ok: false, reason: "No parcel/property boundary detected on the drawing." };
      if (!ctx.targetBoundary) return { ok: false, reason: "No held parcel/survey geometry to fit the drawing to." };
      return { ok: true, detail: { fit: "similarity" } };
    },
  },
  {
    method: METHOD.MEASURE,
    label: "Measure a graphic",
    evaluate(facts) {
      const bar = facts.scaleBar;
      if (bar && bar.present && bar.drawnLenPx > 0 && bar.realLenFt > 0)
        return { ok: true, detail: { baseline: "scale-bar", drawnLenPx: bar.drawnLenPx, realLenFt: bar.realLenFt, rotationDeg: rotFrom(facts) } };
      const dim = longestDimension(facts);
      if (dim) return { ok: true, detail: { baseline: "dimension", dimension: dim, rotationDeg: rotFrom(facts) } };
      return { ok: false, reason: "No graphic scale bar or labeled dimension found to measure." };
    },
  },
  {
    method: METHOD.MANUAL,
    label: "Manual calibration",
    // Always available — the user traces a known dimension by hand (B179).
    evaluate() { return { ok: true, detail: { byHand: true } }; },
  },
];

// A north arrow gives a rotation hint for the MEASURE rung (position-to-parcel still
// refines it); null when there's no arrow so the caller leaves rotation by-hand.
function rotFrom(facts) {
  const n = facts.northArrow;
  return n && n.present && typeof n.orientationDeg === "number" ? n.orientationDeg : null;
}

/* Walk the cascade. Returns the chosen rung plus the ordered list of skipped rungs with
 * their reasons, so the UI can surface WHY a higher method didn't run rather than
 * silently dropping to a lower one (the spec's hard rule). `confident` is true unless we
 * fell all the way to MANUAL — manual always "runs" but isn't an automatic placement.
 *
 *   facts  — a NEW-2 placement-facts object (placementFacts.emptyPlacementFacts()-shaped)
 *   ctx    — { canReproject, targetBoundary } capabilities for the higher rungs
 */
export function choosePlacement(facts, ctx = {}) {
  const safe = facts || {};
  const skipped = [];
  for (const rung of RUNGS) {
    const r = rung.evaluate(safe, ctx);
    if (r.ok) {
      return {
        method: rung.method,
        label: rung.label,
        detail: r.detail || {},
        skipped,
        confident: rung.method !== METHOD.MANUAL,
        reason: skipped.length
          ? `Using ${rung.label.toLowerCase()} (higher methods unavailable).`
          : `Using ${rung.label.toLowerCase()}.`,
      };
    }
    skipped.push({ method: rung.method, label: rung.label, reason: r.reason });
  }
  // Unreachable (MANUAL always ok), but stay defensive.
  return { method: METHOD.MANUAL, label: "Manual calibration", detail: { byHand: true }, skipped, confident: false, reason: "Falling back to manual calibration." };
}
