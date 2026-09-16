/* B1611841 (NEW-2) — a road whose drawn endpoint lands well inside a paving pad / truck court /
 * parking field (not near its edge) used to grow a degenerate blob instead of curb returns at the
 * pad face it actually crosses.
 *
 * ROOT CAUSE, measured (not assumed): `driveJunctionsOf` (SitePlanner.jsx) anchored the whole
 * junction on the road's RAW drawn endpoint `P`, using `nearestRectEdge(P, edges)` to pick which
 * target edge is "the" entry — but `nearestRectEdge` answers "which edge is geometrically closest
 * to this point", not "which edge did this road actually cross to get here." Those agree only
 * while P sits near the target's own perimeter. Once a CONTAINED endpoint (a valid connect since
 * B1612608 — "lands on, overlaps, or falls within tolerance") passes the target's own midline, the
 * nearest edge silently FLIPS to a different side of the target than the one the drawn road
 * crossed — reproduced below (`oldEdgeSelection`): a straight approach through a pad's bottom edge,
 * walked deeper and deeper, has its "nearest edge" flip to the pad's RIGHT edge once the endpoint
 * clears the middle, even though the road never went anywhere near that side. `teeGeometry` was
 * then fed a `throughDir`/`edgeRunPos`/`edgeRunNeg` describing an edge the road never crossed,
 * while `sideDir` still (correctly) pointed back along the real approach — an internally
 * inconsistent tee that degenerated into the reported small blob (an empty/near-empty wedge set)
 * rather than a real curb return at the true entry face.
 *
 * THE FIX (`roadGeometry.js`): `roadEdgeCrossing(outsidePt, insidePt, edges)` asks the right
 * question directly — where the SEGMENT from the drive's own approach point to the endpoint
 * crosses the target's boundary — and `driveJunctionsOf` now anchors the junction (T, throughDir,
 * the along-edge run, the court-depth radius clamp, the building-obstacle check, and the side
 * reach available to the return) at that crossing point instead of the raw endpoint. The oldest,
 * already-verified near-edge behaviour (B1645792/B1664512) is unaffected: when P already sits on
 * the target's edge, the crossing point IS P (to within numerical noise), so nothing changes there.
 *
 * `oldEdgeSelection`/`fixedEdgeSelection` below replicate `driveJunctionsOf`'s edge-selection logic
 * (before and after this fix) using only pure, exported lib functions — the same pattern
 * `roadDriveJunctionFillet.test.js`'s own `driveJunctionScenario` already uses. `oldEdgeSelection`
 * is kept as the RED-PROOF record: confirmed red against unmodified `origin/main` before any fix
 * was written (the chosen edge visibly flips away from the true entry edge as the endpoint clears
 * the target's midline, and the wedge set degenerates to empty past that point) — the tests below
 * assert against `fixedEdgeSelection`/the real `roadEdgeCrossing` export instead.
 */
import { describe, it, expect } from "vitest";
import { rectEdges, polygonEdges, polygonContainsPoint, nearestRectEdge, rectContainsPoint, teeGeometry, roadEdgeCrossing } from "../src/workspaces/site-planner/lib/roadGeometry.js";
import { dissolveRings } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { roadStripRing, roadCurbWidth } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { pointInRing, pavedPredicate, floodFillEnclosed, enclosedAreaSqFt } from "../ui-audit/lib/paveFloodFill.mjs";

const roadOuterHalf = (el) => Math.max(0, (+el.travelW || 0) / 2) + roadCurbWidth(el);
const polygonArea = (ring) => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s / 2);
};
const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
const segCross = (a, b, c, d) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
function isSimplePolygon(ring) {
  const n = ring && ring.length;
  if (!n || n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = ring[j], d = ring[(j + 1) % n];
      if (j === (i + 1) % n || (j + 1) % n === i) continue;
      if (segCross(a, b, c, d)) return false;
    }
  }
  return true;
}

// Builds a straight (optionally tilted `angleDeg` off perpendicular) road crossing a rect pad's
// bottom edge, ending `insideDist` ft past it (negative = still outside; 0 = exactly on the edge).
function buildRoadIntoPad(insideDist, opts = {}) {
  const { padW = 200, padH = 600, width = 36, outsideLen = 100, angleDeg = 0 } = opts;
  const pad = { cx: 0, cy: 0, w: padW, h: padH, rot: 0 };
  const edges = rectEdges(pad.cx, pad.cy, pad.w, pad.h, 0);
  const edgeY = -padH / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const dir = { x: Math.sin(rad), y: Math.cos(rad) };
  const outside = { x: -dir.x * outsideLen, y: edgeY - dir.y * outsideLen };
  const P = { x: dir.x * insideDist, y: edgeY + dir.y * insideDist };
  const road = { type: "road", pts: [outside, P], vtx: [{}, {}], travelW: width, curb: 0.5, roadClass: "aisle" };
  return { pad, edges, outside, P, road };
}

// The edge-selection logic `driveJunctionsOf` used BEFORE this fix — kept as the RED-PROOF record.
function oldEdgeSelection(outside, P, edges) {
  const h = nearestRectEdge(P, edges, { facingOnly: false });
  const contains = rectContainsPoint(P, edges);
  if (!h || !(h.dist <= 6 || contains)) return { skipped: true };
  return { edge: h.edge, pt: P, sideAvail: Math.hypot(outside.x - P.x, outside.y - P.y) };
}

// The edge-selection logic `driveJunctionsOf` uses AFTER this fix.
function fixedEdgeSelection(outside, P, edges) {
  const h = nearestRectEdge(P, edges, { facingOnly: false });
  const contains = rectContainsPoint(P, edges);
  if (!h || !(h.dist <= 6 || contains)) return { skipped: true };
  const crossing = roadEdgeCrossing(outside, P, edges);
  const edge = crossing ? crossing.edge : h.edge;
  const pt = crossing ? crossing.pt : P;
  const insideRunFt = Math.hypot(P.x - pt.x, P.y - pt.y);
  const sideAvail = Math.max(0, Math.hypot(outside.x - P.x, outside.y - P.y) - insideRunFt);
  return { edge, pt, sideAvail };
}

function junctionFromSelection(sel, road, edges, pad, R) {
  const sideDir = { x: road.pts[0].x - road.pts[1].x, y: road.pts[0].y - road.pts[1].y };
  const edgeRunPos = (sel.edge.b.x - sel.pt.x) * sel.edge.dir.x + (sel.edge.b.y - sel.pt.y) * sel.edge.dir.y;
  const edgeRunNeg = (sel.pt.x - sel.edge.a.x) * sel.edge.dir.x + (sel.pt.y - sel.edge.a.y) * sel.edge.dir.y;
  const perpDepth = sel.edge.axis === "y" ? pad.h : pad.w;
  const geom = teeGeometry({
    T: { x: sel.pt.x, y: sel.pt.y }, throughDir: sel.edge.dir, sideDir,
    phT: 0, phS: roadOuterHalf(road),
    R: Math.min(R, Math.max(1, perpDepth)), flare: 0, curbT: 0.5, curbS: roadCurbWidth(road),
    throughAvailPos: Math.max(0, edgeRunPos), throughAvailNeg: Math.max(0, edgeRunNeg),
    sideAvail: sel.sideAvail,
  });
  const strip = roadStripRing(road, {}, undefined, undefined);
  const wedges = geom ? geom.wedges : [];
  const dissolved = dissolveRings([strip, ...wedges]);
  return { geom, strip, wedges, dissolved };
}

const TRUE_ENTRY_EDGE_MID = { x: 0, y: -300 }; // padH=600 default → bottom edge at y=-300

describe("NEW-2 (B1611841) — RED-PROOF RECORD: the pre-fix edge selection breaks with depth", () => {
  it("oldEdgeSelection flips away from the true entry edge once the endpoint clears the pad's midline", () => {
    const flips = [];
    for (const d of [0, 50, 100, 150, 200, 250, 300]) {
      const { outside, P, edges } = buildRoadIntoPad(d);
      const sel = oldEdgeSelection(outside, P, edges);
      if (sel.skipped) continue;
      const ok = Math.abs(sel.edge.mid.x - TRUE_ENTRY_EDGE_MID.x) < 1 && Math.abs(sel.edge.mid.y - TRUE_ENTRY_EDGE_MID.y) < 1;
      if (!ok) flips.push({ insideDist: d, chosenEdgeMid: sel.edge.mid });
    }
    expect(flips.length, `documents the pre-fix defect: edge flips at ${JSON.stringify(flips)}`).toBeGreaterThan(0);
  });
});

describe("NEW-2 (B1611841) — FIX: the junction resolves at the pad face the road actually crosses", () => {
  it("the chosen junction edge never flips away from the true entry edge, at any depth", () => {
    for (const d of [0, 5, 50, 100, 150, 200, 250, 300, 590]) {
      const { outside, P, edges } = buildRoadIntoPad(d);
      const sel = fixedEdgeSelection(outside, P, edges);
      if (sel.skipped) continue;
      expect(Math.abs(sel.edge.mid.x - TRUE_ENTRY_EDGE_MID.x), `insideDist=${d}: edge.mid.x`).toBeLessThan(1);
      expect(Math.abs(sel.edge.mid.y - TRUE_ENTRY_EDGE_MID.y), `insideDist=${d}: edge.mid.y`).toBeLessThan(1);
    }
  });

  it("the junction wedge geometry is IDENTICAL regardless of how far past the entry face the endpoint sits", () => {
    const sigs = [];
    for (const d of [0, 5, 50, 100, 200, 300, 590]) {
      const { outside, P, edges, pad, road } = buildRoadIntoPad(d);
      const sel = fixedEdgeSelection(outside, P, edges);
      const { wedges } = junctionFromSelection(sel, road, edges, pad, 24);
      sigs.push(wedges.map((w) => Math.round(polygonArea(w) * 100) / 100).sort((a, b) => a - b));
    }
    const base = JSON.stringify(sigs[0]);
    expect(sigs.some((s) => JSON.stringify(s) === "[]"), "no depth degenerated to an empty wedge set").toBe(false);
    for (const s of sigs) expect(JSON.stringify(s)).toBe(base);
  });

  it("real curb returns exist (non-empty, simple, non-zero-area wedges), never a degenerate blob, at every depth", () => {
    for (const d of [0, 100, 200, 300, 590]) {
      const { outside, P, edges, pad, road } = buildRoadIntoPad(d);
      const sel = fixedEdgeSelection(outside, P, edges);
      const { wedges, dissolved } = junctionFromSelection(sel, road, edges, pad, 24);
      expect(wedges.length, `insideDist=${d}: at least one curb-return wedge`).toBeGreaterThan(0);
      for (const w of wedges) {
        expect(isSimplePolygon(w), `insideDist=${d}: wedge is a simple polygon`).toBe(true);
        expect(polygonArea(w), `insideDist=${d}: wedge has real area, not a degenerate sliver`).toBeGreaterThan(50);
      }
      expect(dissolved.length, `insideDist=${d}: one connected region`).toBe(1);
    }
  });

  it("an oblique approach (not just perpendicular) also resolves at the true entry face", () => {
    // padW widened so a 30° drift over 250 ft (125 ft of horizontal travel) still lands inside the
    // pad rather than exiting through a side edge — a different adjacent case, not this one.
    for (const angleDeg of [10, 20, 30]) {
      for (const d of [0, 100, 250]) {
        const { outside, P, edges, pad, road } = buildRoadIntoPad(d, { angleDeg, padW: 400 });
        const sel = fixedEdgeSelection(outside, P, edges);
        expect(sel.skipped, `angle=${angleDeg} insideDist=${d}: connects`).not.toBe(true);
        expect(Math.abs(sel.edge.mid.x - TRUE_ENTRY_EDGE_MID.x), `angle=${angleDeg} insideDist=${d}`).toBeLessThan(1);
        const { wedges, dissolved } = junctionFromSelection(sel, road, edges, pad, 24);
        expect(wedges.length, `angle=${angleDeg} insideDist=${d}: real wedges`).toBeGreaterThan(0);
        expect(dissolved.length, `angle=${angleDeg} insideDist=${d}: one connected region`).toBe(1);
      }
    }
  });

  it("a free-drawn POLYGON pad target resolves the same way as a rect pad (B1664512's own target kind)", () => {
    const points = [{ x: -100, y: -300 }, { x: 100, y: -300 }, { x: 100, y: 300 }, { x: -100, y: 300 }];
    const edges = polygonEdges(points);
    for (const d of [0, 100, 250]) {
      const outside = { x: 0, y: -400 };
      const P = { x: 0, y: -300 + d };
      const road = { type: "road", pts: [outside, P], vtx: [{}, {}], travelW: 36, curb: 0.5, roadClass: "aisle" };
      const h = nearestRectEdge(P, edges, { facingOnly: false });
      const contains = polygonContainsPoint(P, points);
      expect(h && (h.dist <= 6 || contains), `insideDist=${d}: connects to the polygon target`).toBeTruthy();
      const crossing = roadEdgeCrossing(outside, P, edges);
      const edge = crossing ? crossing.edge : h.edge;
      const pt = crossing ? crossing.pt : P;
      expect(Math.abs(edge.mid.y - (-300)), `insideDist=${d}: polygon entry edge`).toBeLessThan(1);
      const sideDir = { x: outside.x - P.x, y: outside.y - P.y };
      const edgeRunPos = (edge.b.x - pt.x) * edge.dir.x + (edge.b.y - pt.y) * edge.dir.y;
      const edgeRunNeg = (pt.x - edge.a.x) * edge.dir.x + (pt.y - edge.a.y) * edge.dir.y;
      const geom = teeGeometry({
        T: pt, throughDir: edge.dir, sideDir, phT: 0, phS: roadOuterHalf(road),
        R: 24, flare: 0, curbT: 0.5, curbS: roadCurbWidth(road),
        throughAvailPos: Math.max(0, edgeRunPos), throughAvailNeg: Math.max(0, edgeRunNeg),
        sideAvail: Math.max(0, Math.hypot(outside.x - P.x, outside.y - P.y) - Math.hypot(P.x - pt.x, P.y - pt.y)),
      });
      expect(geom && geom.wedges.length, `insideDist=${d}: polygon target produces real wedges`).toBeGreaterThan(0);
    }
  });

  it("ADJACENT CASE — just inside the edge (a couple of feet) resolves identically to exactly-on-the-edge", () => {
    const { outside: o0, P: P0, edges: e0, pad: pad0, road: r0 } = buildRoadIntoPad(0);
    const { outside: o2, P: P2, edges: e2, pad: pad2, road: r2 } = buildRoadIntoPad(2);
    const sel0 = fixedEdgeSelection(o0, P0, e0);
    const sel2 = fixedEdgeSelection(o2, P2, e2);
    const w0 = junctionFromSelection(sel0, r0, e0, pad0, 24).wedges.map((w) => Math.round(polygonArea(w) * 100) / 100).sort();
    const w2 = junctionFromSelection(sel2, r2, e2, pad2, 24).wedges.map((w) => Math.round(polygonArea(w) * 100) / 100).sort();
    expect(JSON.stringify(w2)).toBe(JSON.stringify(w0));
  });

  it("ADJACENT CASE — past the far side of the pad entirely: either doesn't connect, or (within tolerance of the far edge) resolves there honestly, never a crash", () => {
    // A SHALLOW pad (150 ft deep) so 200+ ft genuinely exits the far side.
    for (const d of [160, 200, 300]) {
      const { outside, P, edges } = buildRoadIntoPad(d, { padH: 150 });
      const h = nearestRectEdge(P, edges, { facingOnly: false });
      const contains = rectContainsPoint(P, edges);
      const connects = h && (h.dist <= 6 || contains);
      if (!connects) continue; // correctly not a drive target at all — nothing to render, nothing to fix
      expect(() => {
        const sel = fixedEdgeSelection(outside, P, edges);
        junctionFromSelection(sel, { type: "road", pts: [outside, P], vtx: [{}, {}], travelW: 36, curb: 0.5, roadClass: "aisle" }, edges, { w: 200, h: 150 }, 24);
      }, `insideDist=${d}: never throws`).not.toThrow();
    }
  });

  it("flood-fill self-test control still sees the real geometry cleanly (no regression to the B1645792 acceptance bar)", () => {
    const { outside, P, edges, pad, road } = buildRoadIntoPad(150);
    const sel = fixedEdgeSelection(outside, P, edges);
    const { dissolved } = junctionFromSelection(sel, road, edges, pad, 24);
    const padRing = [{ x: -pad.w / 2, y: -pad.h / 2 }, { x: pad.w / 2, y: -pad.h / 2 }, { x: pad.w / 2, y: pad.h / 2 }, { x: -pad.w / 2, y: pad.h / 2 }];
    const isPaved = pavedPredicate([padRing], dissolved);
    const bbox = { x0: sel.pt.x - 90, y0: sel.pt.y - 90, x1: sel.pt.x + 90, y1: sel.pt.y + 90 };
    const real = floodFillEnclosed(isPaved, bbox, 0.5);
    const withHole = (pt) => isPaved(pt) && Math.hypot(pt.x - sel.pt.x, pt.y - (sel.pt.y + 5)) > 2;
    const control = floodFillEnclosed(withHole, bbox, 0.5);
    expect(control.enclosedCount, "self-test control sees a punched hole").toBeGreaterThan(0);
    expect(enclosedAreaSqFt(real), "no enclosed unpaved area near the (absorbed) junction").toBe(0);
    expect(pointInRing).toBeTypeOf("function"); // exercised transitively by pavedPredicate/floodFillEnclosed
  });
});
