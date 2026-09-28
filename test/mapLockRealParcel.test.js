/* NEW-1 (B<PENDING>) — owner report 2026-09-28: "the selected parcel boundary moves relative to
 * the aerial as you zoom in/out," reported against the real "Schlipf" / "Concept A" plan
 * (site smuh3gjf2cdj), a 451.36 ac Waller County tract off HWY 90 E / Pederson Rd.
 *
 * INVESTIGATION (measured, not assumed — full account on the backlog item):
 *   - Pulled the EXACT production record (parcel psmuh3gjf2cdj_0: 33 real digitized vertices,
 *     the plan's real origin) read-only from planyr_production, with the owner's go-ahead to
 *     touch that plan for this investigation. Nothing on the real record was changed.
 *   - Ran the app's own lock invariant (`lockOffsetPx`) against these exact 33 vertices at the
 *     whole-tract zoom AND at the owner's described "0-1,000 ft scale bar" NW-corner zoom AND
 *     far past it: 0.000000 px disagreement at every level. The projection is EXACT for this
 *     exact geometry and origin.
 *   - Drove the real app end to end (real Esri aerial tiles, which ARE reachable from this
 *     environment) through the identical gesture — zoom to fit, then a cursor-tracked wheel-zoom
 *     onto the NW corner, screenshotted at rest AND mid-gesture (0 ms / 100 ms / 500 ms after the
 *     last notch, spanning the ZOOM_SETTLE_MS=220 anchor-release window) — and the boundary
 *     stayed visually locked to the same ground features (a field edge / cleared road) at every
 *     zoom and every timing. Worst measured lock error across the whole live run: ~1 px, the
 *     already-documented, deliberately-uncompensated Leaflet whole-pixel snap (mapLock.js's own
 *     "closing the whole-pixel floor" section) — not a growing, distance-dependent defect.
 *   - The county's OWN record for this exact parcel disagrees with itself by ~1%: GIS_AREA
 *     (449.715 ac, from the mapped polygon WCAD/TxGIO publishes) vs LEGAL_AREA (454.447 ac, from
 *     the recorded deed) — a discrepancy baked into the county's own GIS layer, not introduced by
 *     Planyr. That ~1% of imprecision is invisible at a whole-tract zoom and can look like a few
 *     feet of "drift" once you zoom in tight enough to compare a corner against a sharp aerial
 *     photo — the LEADING explanation for what was seen, not a rendering bug.
 *
 * This suite is therefore the PERMANENT GUARD for the mechanism that was investigated (mapLock's
 * exactness, over a real, many-vertex, far-from-origin county ring, at multiple zoom levels) —
 * closing the gap that no prior test exercised (mapLock.test.js's own cases are a clean synthetic
 * rectangle at one ppf). It is green today because no defect was found in the code; it exists so
 * a FUTURE regression in this exact mechanism is caught immediately rather than requiring a fresh
 * live investigation.
 */
import { describe, it, expect } from "vitest";
import { lockOffsetPx } from "../src/workspaces/site-planner/lib/mapLock.js";
import fixtures from "./fixtures/realParcelRings.json";

const SIZE = { w: 1218, h: 819 }; // a realistic measured canvas box (matches the live repro run)

function fitView(points, size, pad = 60) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const bw = Math.max(maxX - minX, 10), bh = Math.max(maxY - minY, 10);
  const ppf = Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh);
  return { ppf, offX: pad - minX * ppf + (size.w - pad * 2 - bw * ppf) / 2, offY: pad - minY * ppf + (size.h - pad * 2 - bh * ppf) / 2 };
}

function worstLockErrorPx(points, view, origin) {
  let worst = 0;
  for (const p of points) worst = Math.max(worst, Math.hypot(...Object.values(lockOffsetPx(p, view, SIZE, origin))));
  return worst;
}

// The "NW corner" analogue: west = min x, north = min y (mapLock.js's feet frame is x-east,
// y-SOUTH, so north is the most-negative y).
function nwMost(points) {
  return points.reduce((best, p) => (p.x + p.y < best.x + best.y ? p : best), points[0]);
}

describe("NEW-1 — real county parcel boundary stays locked to the basemap at every zoom", () => {
  for (const [key, fx] of Object.entries(fixtures)) {
    if (key.startsWith("_")) continue;
    describe(`${key} (${fx._source})`, () => {
      const { origin, points } = fx;
      const fit = fitView(points, SIZE);

      it("is exact at the whole-tract fit view, across EVERY real vertex", () => {
        expect(worstLockErrorPx(points, fit, origin)).toBeLessThan(1e-6);
      });

      it("stays exact zoomed in tight on the far corner (the owner's exact gesture)", () => {
        const corner = nwMost(points);
        // Anchor the corner at a fixed screen point and sweep ppf up — mirrors what an
        // anchored cursor-tracked wheel-zoom (zoomAround) produces: the corner's own screen
        // position never moves, only the scale changes.
        const anchor = { x: 300, y: 300 };
        for (const mult of [1, 4, 16, 48, 60]) {
          const ppf = Math.min(fit.ppf * mult, 8); // the app's own zoomAround clamp (viewAnchor.js)
          const view = { ppf, offX: anchor.x - corner.x * ppf, offY: anchor.y - corner.y * ppf };
          // A tiny float-precision floor (not a visual one) at extreme ppf on a coordinate far
          // from the anchor — still four orders of magnitude below one screen pixel.
          expect(worstLockErrorPx(points, view, origin)).toBeLessThan(1e-4);
        }
      });

      it("stays exact at a vertex far from the origin AND one near it (adjacent-cases table)", () => {
        const nearOrigin = points.reduce((b, p) => (Math.hypot(p.x, p.y) < Math.hypot(b.x, b.y) ? p : b), points[0]);
        const farFromOrigin = points.reduce((b, p) => (Math.hypot(p.x, p.y) > Math.hypot(b.x, b.y) ? p : b), points[0]);
        for (const pt of [nearOrigin, farFromOrigin]) {
          expect(Math.hypot(...Object.values(lockOffsetPx(pt, fit, SIZE, origin)))).toBeLessThan(1e-6);
        }
      });
    });
  }

  it("holds identically whether the ring came from a county GIS import or a hand-drawn/deed-plotted boundary — the projection takes plain {x,y} points and has no data-source branch", () => {
    // A hand-drawn or deed-promoted parcel (lib/plannerPlacementCmds.js's promoteDeedToParcel)
    // stores geometry in the exact same {x,y} shape as a county-GIS import (parcelsFromRings) —
    // both flow through the SAME lngLatRingToFeet/feetToLatLng pair with no branch on provenance.
    // This is proven structurally (both fixtures above go through the identical function with no
    // `source` parameter), not by fetching a third data source.
    const handDrawn = [{ x: -900, y: -600 }, { x: 900, y: -600 }, { x: 900, y: 600 }, { x: -900, y: 600 }];
    const origin = { lat: 29.8, lon: -95.8 };
    const view = fitView(handDrawn, SIZE);
    expect(worstLockErrorPx(handDrawn, view, origin)).toBeLessThan(1e-6);
  });

  it("holds for a setback ring (an inward-offset copy of the boundary) the same way it holds for the boundary itself", () => {
    // The setback line is drawn through the identical f2p/feetToLatLng pipeline as the parcel
    // boundary — an inward offset changes the POINTS, never the projection.
    const { origin, points } = fixtures.schlipf;
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    const setbackRing = points.map((p) => ({ x: p.x + (cx - p.x) * 0.02, y: p.y + (cy - p.y) * 0.02 })); // ~2% inward
    const view = fitView(points, SIZE);
    expect(worstLockErrorPx(setbackRing, view, origin)).toBeLessThan(1e-6);
  });
});
