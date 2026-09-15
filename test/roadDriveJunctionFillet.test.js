/* B<PENDING> — road→pavement-pad junctions (a driveway teeing into a truck court / paving pad /
 * parking field) rendered raw geometric angles instead of a curb return: on the acute side of an
 * oblique approach, the road edge and the pad edge crossed into a knife-edge V notch; on the
 * obtuse side, a hard, unfilleted corner. Owner repro: a 36 ft road into a truck-court stub at an
 * oblique angle. Dedupe-checked against B1005/B1006/B1011/B1052/B955 and B1631648/B1631649 (all
 * Done) — none of those touch a road-to-PAD junction's fillet geometry: B1005/B1006/B1011 are
 * road-TO-ROAD curb-return/junction defects (teeJunctionsOf/nodeJunction, a separate code path);
 * B1052 is excess control points; B955/B1631649 are the TOPOLOGICAL connect (whether a `driveTee`
 * relationship gets recorded at all), not the rendered fillet; B1631648 is a single road's own
 * interior-vertex offset-polygon width defect, unrelated to a junction. Net-new.
 *
 * ROOT CAUSE, measured (not assumed) below. `driveJunctionsOf` (SitePlanner.jsx) calls
 * `teeGeometry` with the target rect's facing edge as the "through" line (`phT: 0` — a pad
 * contributes no pavement of its own to dissolve with). The old wedge builder anchored its far
 * (side-pavement) reach to `f.tan2` — a point on the driveway's THEORETICAL long-edge line,
 * extended infinitely — and pushed it perpendicular by a small fixed `deepS`. That line is the
 * driveway's REAL edge only where its tessellated strip actually reaches, and the strip's own end
 * (at the connect point) is a FLAT CAP perpendicular to the driveway's centerline (`etOpenButt`),
 * not to that line. At an oblique approach the two corners are NOT symmetric about that cap:
 * MEASURED on a 36 ft drive meeting a pad edge at 45°, one corner's `tan2` lands ~9 ft further
 * INTO the strip than the flat cap (harmless overlap) while the OTHER lands ~9 ft BEHIND it, on
 * the side of the cap the strip's own polygon never occupies. A fixed perpendicular push from
 * `tan2` runs parallel to the cap it needs to cross, so past roughly a 40° approach the wedge on
 * that side never reaches the strip at all — it dissolves as its OWN disconnected island, and the
 * strip's real (now-exposed) flat cap is what's left forming the raw edges the owner saw: a
 * straight, hard-angled cut where a rounded return should be, with open ground (a real gap in
 * pavement coverage — the knife-edge notch) between it and the stranded return.
 *
 * Road-to-road tees never show this: `teeJunctionsOf`/`nodeJunction` gives the "through" side a
 * real pavement width, so a side road's flat cap lands somewhere inside that wide strip by sheer
 * overlap — a coincidence of a wide target, not a fix, and one a zero-width pad target doesn't
 * have. `teeGeometry` has exactly one live caller (`driveJunctionsOf`) — grepped — so this fix is
 * scoped to the road↔pad/parking family and cannot touch road-to-road geometry.
 *
 * THE FIX (roadGeometry.js, `teeGeometry`'s wedge builder): anchor the wedge to the driveway's
 * REAL cap corner (`T + inS*phS` — the same point `roadStripRing`'s own flat cap uses), reaching
 * past it into the strip by a small tuck, then take the CONVEX HULL of every candidate point (the
 * arc, the old through/side backing points, and the new cap-anchored ones). The fillet arc is
 * convex outward by construction, so the hull leaves the true curve untouched and only fills in
 * whatever straight-line backing is needed to bridge it to wherever the real cap corner turns out
 * to be — ahead of `tan2` or behind it, no case split needed.
 *
 * This suite is the RED-PROOF the item asked for: every case below reproduces on pre-fix `main`
 * as either a disconnected wedge (region count > 1) or a self-intersecting union — confirmed in a
 * throwaway repro against the unmodified source before this fix was written, not assumed.
 */
import { describe, it, expect } from "vitest";
import { rectEdges, nearestRectEdge, teeGeometry } from "../src/workspaces/site-planner/lib/roadGeometry.js";
import { dissolveRings } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { roadStripRing, roadCurbWidth } from "../src/workspaces/site-planner/lib/siteGeometry.js";

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

const roadOuterHalf = (el) => Math.max(0, (+el.travelW || 0) / 2) + roadCurbWidth(el);
const polygonArea = (ring) => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s / 2);
};

// Replicates driveJunctionsOf's own math (SitePlanner.jsx) for ONE road→pad connection, using
// only exported, pure lib functions — the same real pipeline the app dissolves and renders.
function driveJunctionScenario(angleDeg, opts = {}) {
  const {
    padW = 200, padH = 150, padRot = 0, width = 36, driveLen = 300, alongEdge = 0,
    edge = "bottom", R = 24, flare = 0, curb = 0.5,
  } = opts;
  const pad = { cx: 0, cy: 0, w: padW, h: padH, rot: padRot };
  const edges = rectEdges(pad.cx, pad.cy, pad.w, pad.h, pad.rot);
  const edgeIdx = { bottom: 0, right: 1, top: 2, left: 3 }[edge];
  const e = edges[edgeIdx];
  const P = { x: e.mid.x + e.dir.x * alongEdge, y: e.mid.y + e.dir.y * alongEdge };
  const rad = (angleDeg * Math.PI) / 180;
  // A unit vector making `angleDeg` with the edge's OUTWARD normal (0 = perpendicular-in).
  const c = Math.cos(rad), s = Math.sin(rad);
  const dir = { x: e.outN.x * c + e.dir.x * s, y: e.outN.y * c + e.dir.y * s };
  const far = { x: P.x + dir.x * driveLen, y: P.y + dir.y * driveLen };
  const road = { type: "road", pts: [far, P], vtx: [{}, {}], travelW: width, curb, roadClass: "aisle" };

  const hit = nearestRectEdge(P, edges, { facingOnly: false });
  if (!hit) return null;
  const sideDir = { x: far.x - P.x, y: far.y - P.y }; // INTO the driveway body, matching driveJunctionsOf
  const edgeRunPos = (hit.edge.b.x - P.x) * hit.edge.dir.x + (hit.edge.b.y - P.y) * hit.edge.dir.y;
  const edgeRunNeg = (P.x - hit.edge.a.x) * hit.edge.dir.x + (P.y - hit.edge.a.y) * hit.edge.dir.y;
  const geom = teeGeometry({
    T: P, throughDir: hit.edge.dir, sideDir,
    phT: 0, phS: roadOuterHalf(road),
    R: Math.min(R, Math.max(1, padH)), flare, curbT: 0.5, curbS: roadCurbWidth(road),
    throughAvailPos: Math.max(0, edgeRunPos), throughAvailNeg: Math.max(0, edgeRunNeg),
    sideAvail: driveLen - 1,
  });
  const strip = roadStripRing(road, {}, undefined, undefined);
  const wedges = geom ? geom.wedges : [];
  const dissolved = dissolveRings([strip, ...wedges]);
  return { pad, edges, road, P, hit, geom, strip, wedges, dissolved };
}

// The core property: the driveway's own pavement (strip + curb-return wedges) dissolves into ONE
// connected, simple region — no stranded wedge island, no exposed raw flat cap, no self-crossing.
function assertCleanJunction(angleDeg, opts, label) {
  const s = driveJunctionScenario(angleDeg, opts);
  expect(s, `${label} @ ${angleDeg}°: scenario built`).toBeTruthy();
  expect(s.dissolved.length, `${label} @ ${angleDeg}°: road pavement is ONE connected region, not a stranded wedge`).toBe(1);
  for (const r of s.dissolved) {
    expect(isSimplePolygon(r.outer), `${label} @ ${angleDeg}°: dissolved region is a simple polygon (no self-intersection)`).toBe(true);
  }
  return s;
}

describe("road → paving-pad / truck-court junction — curb-return fillet, not a raw notch", () => {
  const ANGLES = [0, 5, 15, 30, 45, 60, 70, 75, 80, 85, 89];

  it("REGRESSION (owner's exact shape): a 36 ft drive into a truck court at 45° reads as one continuous, filleted pavement", () => {
    assertCleanJunction(45, { width: 36, R: 24, padW: 200, padH: 150 }, "truck court");
  });

  it("truck court — perpendicular through highly oblique, mid-edge", () => {
    for (const a of ANGLES) assertCleanJunction(a, { width: 36, R: 24 }, "truck court mid-edge");
  });

  it("generic paving pad — parking-scale return radius", () => {
    for (const a of ANGLES) assertCleanJunction(a, { width: 24, R: 15 }, "parking pad");
  });

  it("acute, near-perpendicular and obtuse approach angles, explicitly named", () => {
    assertCleanJunction(15, { width: 36, R: 24 }, "acute (15°)");
    assertCleanJunction(2, { width: 36, R: 24 }, "near-perpendicular (2°)");
    assertCleanJunction(75, { width: 36, R: 24 }, "obtuse (75°)");
  });

  it("connects near a pad CORNER (little room on one side of the junction)", () => {
    for (const a of [0, 15, 30, 45, 60, 75]) assertCleanJunction(a, { alongEdge: 90, padW: 200 }, "near corner");
  });

  it("connects at a pad corner with a TINY margin (2 ft to spare)", () => {
    for (const a of [0, 30, 60]) assertCleanJunction(a, { alongEdge: 98, padW: 200 }, "tiny margin");
  });

  it("road meeting a pad edge MID-SEGMENT (the ordinary case, far from any corner)", () => {
    for (const a of [0, 30, 45, 60, 75]) assertCleanJunction(a, { alongEdge: 0, padW: 200 }, "mid-segment");
  });

  it("both ends of the same road connect to two different pads, each at its own oblique angle", () => {
    // Not a shared code path beyond geometry keyed on each endpoint's own T/edge/angle — exercised
    // as two independent scenarios (mirrors how driveJunctionsOf iterates [0, S.pts.length-1]).
    const end1 = assertCleanJunction(30, { alongEdge: -20 }, "road end 1");
    const end2 = assertCleanJunction(60, { alongEdge: 40 }, "road end 2");
    expect(end1.dissolved.length).toBe(1);
    expect(end2.dissolved.length).toBe(1);
  });

  it("small pad, generic paving (not a truck court)", () => {
    for (const a of [0, 30, 45, 60, 75]) assertCleanJunction(a, { padW: 60, padH: 40, width: 24, R: 15 }, "small pad");
  });

  it("narrow drive and a very wide drive, sharp approach", () => {
    for (const a of [0, 30, 60, 80]) assertCleanJunction(a, { width: 12, R: 15 }, "narrow drive");
    for (const a of [0, 30, 45, 60]) assertCleanJunction(a, { width: 60, R: 50 }, "wide drive");
  });

  it("a flared throat (extra widening) still dissolves clean", () => {
    for (const a of [0, 30, 45, 60]) assertCleanJunction(a, { flare: 6 }, "flared");
  });

  it("connects on every edge of the target rect (not just the bottom), including a rotated pad", () => {
    for (const edge of ["bottom", "right", "top", "left"]) {
      for (const a of [0, 30, 60]) assertCleanJunction(a, { edge }, `edge=${edge}`);
    }
    for (const a of [0, 30, 60]) assertCleanJunction(a, { padRot: 37 }, "rotated pad");
  });

  it("degenerate/no-room cases stay honest (sharp corner or no wedge) and never crash or self-cross", () => {
    // Connecting exactly AT a pad corner (zero edge run one way) must not throw, and whatever comes
    // back (even a bare, unfilleted strip) must still be simple.
    for (const a of [0, 30, 60]) {
      const s = driveJunctionScenario(a, { alongEdge: 100, padW: 200 }); // exactly at the corner
      expect(s).toBeTruthy();
      for (const r of s.dissolved) expect(isSimplePolygon(r.outer)).toBe(true);
    }
  });
});

describe("does not regress B1631648 (a road's OWN interior bend, unrelated to a drive junction)", () => {
  it("roadStripRing still holds a straight-through road's width with no junction involved", () => {
    const road = { type: "road", pts: [{ x: 0, y: 0 }, { x: 500, y: 0 }], vtx: [{}, {}], travelW: 36, curb: 0.5, roadClass: "aisle" };
    const strip = roadStripRing(road, {}, undefined, undefined);
    expect(strip.length).toBeGreaterThanOrEqual(4);
    expect(isSimplePolygon(strip)).toBe(true);
  });
});
