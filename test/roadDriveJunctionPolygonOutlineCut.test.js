/* B1613152 — a road tee-ing into a POLYGON (freehand-drawn) paving/parking pad left that pad's own
 * outline drawing FULL and UNINTERRUPTED straight across the curb-return wedge, because
 * `rectOutlineCutSegments` (NEW-4, `roadNetwork.js`) — the mechanism that stops a RECT target's
 * outline from being "a line ruled across the opening" — has no polygon equivalent. `renderElPx`'s
 * polygon branch (`SitePlanner.jsx`, `if (el.points) { … }`) never even looked up `roadNet.outlineCuts`
 * for its own element id.
 *
 * ⛔ RETRACTION CONTEXT (owner dispatch, 2026-09-17): B1717616's shipped fix (`polygonEdgeRunFrom`,
 * PR #1749) was built on a premise the same dispatch then falsified by live measurement — the
 * connect point's proximity to a cosmetic digitizing vertex made no difference; the identical
 * junction built mid-run of a long, clean, vertex-free polygon edge failed identically. That fix
 * is NOT reverted here (it may still help some other configuration; nothing here disproves it) —
 * this is a SEPARATE, independently-diagnosed defect found by driving the real render pipeline
 * (`driveJunctionsOf` → `dissolveRings` → the polygon element's own draw path) rather than
 * re-deriving geometry by hand. MEASURED (this session): a polygon pad, a 24 ft "aisle"-class road
 * teeing in at 25.23° off perpendicular — `driveJunctionsOf`'s own returned `geom.returns` arc is a
 * complete, correctly-tessellated curve (confirmed by circle-fitting it, RMS ~0) at EVERY angle
 * tried; the defect is downstream, in `renderElPx`'s polygon branch drawing the pad's own straight
 * edge on top of / across that curve because nothing ever interrupted it.
 *
 * ⛔ THIS SUITE DRIVES THE REAL `driveJunctionsOf` + `dissolveRings` PIPELINE, never a hand-copied
 * re-derivation — the same discipline `roadDriveJunctionPolygonEdgeRun.test.js` and
 * `roadJunctions.js`'s own header describe as the reason three prior road-junction "fixes" shipped
 * green while the deployed build stayed broken.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { driveJunctionsOf } from "../src/workspaces/site-planner/lib/roadJunctions.js";
import { roadStripRing } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { dissolveRings, polygonOutlineCutSegments, rectOutlineCutSegments } from "../src/workspaces/site-planner/lib/roadNetwork.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

function pointInPoly(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
// A cut boundary point legitimately sits ON the cutter's own edge (that IS the cut), which a plain
// ray-cast can round either way — so "covered" means genuinely INSIDE, at least a hair off the edge.
function distToPolyBoundary(p, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    let t = len2 > 1e-12 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}
function strictlyCoveredBy(p, cutters, eps = 0.02) {
  return cutters.some((c) => pointInPoly(p, c) && distToPolyBoundary(p, c) > eps);
}

// A rectangular polygon pad expressed as `el.points` (the free-drawn / click-traced shape), so its
// bottom edge is a single, clean, vertex-free run — deliberately NOT the B1717616 digitizing-clutter
// case, since this defect's own control (the dispatch's own retraction) is that clutter is irrelevant.
function makePolygonPad({ w = 500, h = 150 } = {}) {
  const y = -h / 2;
  const points = [
    { x: -w / 2, y }, { x: w / 2, y },
    { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 },
  ];
  return { id: "pad1", type: "paving", points };
}
function makeRoad(id, angleDeg, alongEdge, { width = 24, driveLen = 300, curb = 0.5, edgeMidY = -75 } = {}) {
  const P = { x: alongEdge, y: edgeMidY };
  const rad = (angleDeg * Math.PI) / 180;
  const outN = { x: 0, y: -1 }, edgeDir = { x: 1, y: 0 };
  const c = Math.cos(rad), s = Math.sin(rad);
  const dir = { x: outN.x * c + edgeDir.x * s, y: outN.y * c + edgeDir.y * s };
  const far = { x: P.x + dir.x * driveLen, y: P.y + dir.y * driveLen };
  return { id, type: "road", pts: [far, P], vtx: [{}, {}], travelW: width, curb, roadClass: "aisle" };
}
// The real render pipeline's own cutter set for one drive junction: the dissolved road pavement
// (strip + both curb-return wedges), exactly what `roadNet.outlineCuts` holds in SitePlanner.jsx.
function realCutterFor(pad, road) {
  const [j] = driveJunctionsOf([pad, road], {});
  expect(j, "junction must be found").toBeTruthy();
  const strip = roadStripRing(road, {}, undefined, undefined);
  const dissolved = dissolveRings([strip, ...j.geom.wedges]);
  return { j, cutters: dissolved.map((r) => r.outer) };
}

describe("B1613152 — polygonOutlineCutSegments: a polygon pad's own outline is interrupted where a drive's dissolved pavement crosses it", () => {
  it("no cutters → the whole ring comes back as one segment per edge, unmodified (matches rectOutlineCutSegments' own no-op contract)", () => {
    const pad = makePolygonPad({});
    const segs = polygonOutlineCutSegments(pad, []);
    expect(segs.length).toBe(4); // four edges, none interrupted
    const total = segs.reduce((s, seg) => s + seg.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - seg[i].x, p.y - seg[i].y), 0), 0);
    expect(total).toBeCloseTo(2 * (500 + 150), 6);
  });

  it("invalid input returns [] (mirrors rectOutlineCutSegments' own degenerate-input contract)", () => {
    expect(polygonOutlineCutSegments(null, [])).toEqual([]);
    expect(polygonOutlineCutSegments({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, [])).toEqual([]); // <3 points
    expect(polygonOutlineCutSegments({ cx: 0, cy: 0, w: 10, h: 10 }, [])).toEqual([]); // a rect, not a polygon — rectOutlineCutSegments' own job
  });

  it("RED-PROOF-TURNED-GREEN: at every oblique angle, the pad's own edge is interrupted exactly where the real dissolved drive pavement covers it — no leftover straight segment crosses the curb-return wedge", () => {
    const pad = makePolygonPad({});
    for (const deg of [0, 10, 20, 25.23, 30, 34.27, 40, 45, 55, 65]) {
      const road = makeRoad("r", deg, 0);
      const { cutters } = realCutterFor(pad, road);
      const segs = polygonOutlineCutSegments(pad, cutters);
      // Every remaining segment endpoint must NOT be strictly inside any cutter (the cut removed
      // exactly the covered portion; nothing left over should still be "under" the pavement).
      for (const seg of segs) {
        for (const p of seg) {
          const covered = strictlyCoveredBy(p, cutters);
          expect(covered, `deg ${deg}: a surviving outline point (${p.x.toFixed(2)},${p.y.toFixed(2)}) sits inside the dissolved drive pavement`).toBe(false);
        }
      }
      // And the cut must have removed SOMETHING on the bottom edge (the road genuinely crosses it) —
      // otherwise this angle's fixture isn't exercising the defect at all (WRONG-CASE precondition).
      // Skipped at deg 0: a perpendicular approach's tangent points land EXACTLY on the pad edge line
      // (touching, not overlapping), so there is no length to remove there — the oblique angles below
      // are where a reach-capped tangent point sits genuinely inside the strip's own reach and this
      // precondition is what actually exercises the defect.
      if (deg !== 0) {
        const bottomBefore = 500; // the uncut bottom edge length
        const bottomAfterLen = segs
          .filter((seg) => seg.every((p) => Math.abs(p.y - -75) < 1e-6))
          .reduce((s, seg) => s + seg.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - seg[i].x, p.y - seg[i].y), 0), 0);
        expect(bottomAfterLen, `deg ${deg}: the bottom edge must be genuinely shortened by the cut`).toBeLessThan(bottomBefore - 0.1);
      }
    }
  });

  it("the cut never removes MORE than the dissolved pavement's own footprint (the rest of the pad's boundary is untouched)", () => {
    const pad = makePolygonPad({});
    const road = makeRoad("r", 25.23, 0);
    const { cutters } = realCutterFor(pad, road);
    const segs = polygonOutlineCutSegments(pad, cutters);
    // The top and side edges (far from the junction) must survive as whole, uncut segments.
    const top = segs.find((seg) => seg.every((p) => Math.abs(p.y - 75) < 1e-6));
    expect(top, "the top edge (far from the junction) must survive uncut").toBeTruthy();
    expect(Math.hypot(top[0].x - top[top.length - 1].x, top[0].y - top[top.length - 1].y)).toBeCloseTo(500, 3);
  });

  it("a target with no driveJunctionsOf hit at all (no cutters) never loses any outline — a plain, untouched pad renders exactly as before", () => {
    const pad = makePolygonPad({});
    const farRoad = makeRoad("r", 0, 10000); // nowhere near the pad
    const [j] = driveJunctionsOf([pad, farRoad], {});
    expect(j).toBeFalsy();
  });

  it("mirrors rectOutlineCutSegments' own family on an equivalent rect target — same cutters, same qualitative cut shape (parity between the two target kinds this defect class covers)", () => {
    const rectPad = { id: "pad2", type: "paving", cx: 0, cy: 0, w: 500, h: 150 };
    const road = makeRoad("r", 25.23, 0);
    const [j] = driveJunctionsOf([rectPad, road], {});
    expect(j).toBeTruthy();
    const strip = roadStripRing(road, {}, undefined, undefined);
    const dissolved = dissolveRings([strip, ...j.geom.wedges]);
    const cutters = dissolved.map((r) => r.outer);
    const rectSegs = rectOutlineCutSegments(rectPad, cutters);
    expect(rectSegs.length).toBeGreaterThan(4); // the rect's own edge is interrupted too — same defect class, same fix shape
  });
});

describe("B1613152 — the polygon render branch wires the cut in (source guard, mirrors junctionOutlineCut.test.js's own render-frame half)", () => {
  const src = read("../src/workspaces/site-planner/SitePlanner.jsx");

  it("the polygon branch looks up roadNet.outlineCuts for its own element id", () => {
    const i = src.indexOf('if (el.points) { // polygon element');
    expect(i, "polygon element branch not found — has it moved or been reverted?").toBeGreaterThan(-1);
    const block = src.slice(i, i + 1400);
    expect(block).toMatch(/const outlineCut = roadNet && roadNet\.outlineCuts \? roadNet\.outlineCuts\.get\(el\.id\) : null;/);
    expect(block).toMatch(/polygonOutlineCutSegments\(el, outlineCut\)/);
  });

  it("the polygon's own full-path stroke is suppressed exactly when a cut is active (never drawn twice)", () => {
    const i = src.indexOf("outlineCutSegs ? \"none\" : elStroke");
    expect(i, "the outline suppression on the polygon's own <path> stroke was not found").toBeGreaterThan(-1);
  });

  it("the interrupted-outline polylines are rendered as their own group, keyed to the element id", () => {
    expect(src).toMatch(/data-testid="polygon-outline-cut" data-el-id=\{el\.id\}/);
  });
});
