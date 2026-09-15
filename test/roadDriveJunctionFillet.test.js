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
import { rectEdges, nearestRectEdge, teeGeometry, polygonEdges, polygonContainsPoint, polygonDepthBehind } from "../src/workspaces/site-planner/lib/roadGeometry.js";
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

// B<PENDING> NEW-1 (amendment to B1645792 / V1173824) — the shipped fix (PR #1722, merged 0f17770)
// stopped the wedge disconnecting into an island, but a live pass on the deployed build found two
// residuals: (1) a small unpaved NOTCH still opens right at the throat — the single convex hull
// mixing the arc with the cap-bridge points could dip inside the true covered area at the shared
// tangent vertex; (2) the SAME hull swallows most/all of the fillet arc's tessellated points
// whenever the cap-bridge points reach further out than the arc — replacing a curb-return curve
// with a straight-sided wedge. Both are RED on the single-hull construction (confirmed below
// against a reverted copy of the fix before writing it) and GREEN once the arc-preserving sliver
// and the cap-bridge are built as two pieces and merged via `dissolveRings` instead of one hull.
function padRingOf(pad) {
  const hw = pad.w / 2, hh = pad.h / 2;
  return [
    { x: pad.cx - hw, y: pad.cy - hh }, { x: pad.cx + hw, y: pad.cy - hh },
    { x: pad.cx + hw, y: pad.cy + hh }, { x: pad.cx - hw, y: pad.cy + hh },
  ];
}
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
// Scan a grid around the throat for a cell that is PAVED NOWHERE (neither the pad rect nor any
// dissolved road region covers it) yet has at least 3 of its 4 orthogonal neighbours paved — an
// isolated unpaved pocket, i.e. the notch the owner's live check found.
function throatNotchCells(s, opts = {}) {
  const { half = 60, step = 0.5, near = 12 } = opts;
  const padRing = padRingOf(s.pad);
  const found = [];
  for (let x = -half; x <= half; x += step) {
    for (let y = -half; y <= half; y += step) {
      const pt = { x: s.P.x + x, y: s.P.y + y };
      if (Math.hypot(x, y) > near) continue; // restrict the scan to right around the tee point
      const inPad = pointInRing(pt, padRing);
      let inRoad = false;
      for (const r of s.dissolved) if (pointInRing(pt, r.outer)) { inRoad = true; break; }
      if (inPad || inRoad) continue;
      const nb = [[step, 0], [-step, 0], [0, step], [0, -step]].map(([dx, dy]) => {
        const p2 = { x: pt.x + dx, y: pt.y + dy };
        if (pointInRing(p2, padRing)) return true;
        for (const r of s.dissolved) if (pointInRing(p2, r.outer)) return true;
        return false;
      });
      if (nb.filter(Boolean).length >= 3) found.push(pt);
    }
  }
  return found;
}
// A tessellated arc's SAG off its own chord: 0 for a dead-straight run, large for a real curve.
function arcSag(arc) {
  if (!Array.isArray(arc) || arc.length < 3) return 0;
  const a = arc[0], b = arc[arc.length - 1], m = arc[Math.floor(arc.length / 2)];
  const chordLen = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.abs((b.x - a.x) * (a.y - m.y) - (a.x - m.x) * (b.y - a.y)) / (chordLen || 1);
}
// How many of the fillet's own tessellated arc points survive as vertices of the returned wedge
// polygon (order-independent — a hull can reorder/renumber but must not DROP the curve's points).
// Tolerance is clipper's own centi-foot rounding (dissolveRings snaps to 1/100 ft) — a real
// surviving vertex lands within a fraction of an inch of the original; a flattened chord drops the
// point entirely, which reads as nothing within many feet, not a few hundredths.
const ARC_SURVIVAL_TOL_FT = 0.05;
function arcPointsSurviving(wedgeRing, arc) {
  const has = (p) => wedgeRing.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < ARC_SURVIVAL_TOL_FT);
  return arc.filter(has).length;
}

describe("NEW-1 (B1645792 amendment) — oblique road-into-pad: no throat notch, and the returns are real arcs", () => {
  const ANGLES = [1, 5, 15, 30, 45, 60, 75, 80, 85, 89];

  it("REGRESSION (owner's exact shape): a 36 ft drive into a truck court at 45° leaves no unpaved notch at the throat", () => {
    const s = driveJunctionScenario(45, { width: 36, R: 24, padW: 200, padH: 150 });
    const notches = throatNotchCells(s);
    expect(notches, `unpaved notch cells found near the throat: ${JSON.stringify(notches.slice(0, 5))}`).toHaveLength(0);
  });

  it("no throat notch across the oblique angle sweep", () => {
    for (const a of ANGLES) {
      const s = driveJunctionScenario(a, { width: 36, R: 24, padW: 200, padH: 150 });
      const notches = throatNotchCells(s);
      expect(notches, `angle ${a}°: unpaved notch cells: ${JSON.stringify(notches.slice(0, 5))}`).toHaveLength(0);
    }
  });

  // `wedges` drops a corner entirely (via `.filter(Boolean)`) when its fillet is genuinely
  // degenerate (no room for a return at all — a real, honest sharp corner, not a bug), so it does
  // NOT index-correspond to `returns` once any corner is degenerate. Match a wedge to its arc by
  // content (does the wedge ring contain the arc's own tan1?) rather than by position.
  function wedgeForArc(wedges, arc) {
    if (!arc || !arc.length) return null;
    const tan1 = arc[0];
    return (wedges || []).find((w) => w.some((p) => Math.hypot(p.x - tan1.x, p.y - tan1.y) < 1e-3)) || null;
  }

  it("the returned wedge keeps a REAL curb-return arc, not a straightened chord, across the sweep", () => {
    for (const a of ANGLES) {
      const s = driveJunctionScenario(a, { width: 36, R: 24, padW: 200, padH: 150 });
      for (const arc of s.geom.returns) {
        if (arcSag(arc) < 0.5) continue; // a near-degenerate/negligible fillet at this angle — nothing to preserve
        const wedgeRing = wedgeForArc(s.geom.wedges, arc);
        expect(wedgeRing, `angle ${a}°: no wedge for a non-degenerate arc`).toBeTruthy();
        const survived = arcPointsSurviving(wedgeRing, arc);
        // At least 3/4 of the tessellated arc must survive as real wedge vertices — a straightened
        // chord (the pre-fix defect) keeps only the two endpoints (survived === 2 of N).
        expect(survived, `angle ${a}°: only ${survived}/${arc.length} arc points survived in the wedge — the curve was flattened`)
          .toBeGreaterThanOrEqual(Math.ceil(arc.length * 0.75));
      }
    }
  });

  it("generic paving pad (not a truck court) also keeps its arcs and stays notch-free", () => {
    for (const a of [15, 45, 75]) {
      const s = driveJunctionScenario(a, { width: 24, R: 15 });
      expect(throatNotchCells(s)).toHaveLength(0);
      for (const arc of s.geom.returns) {
        if (arcSag(arc) < 0.5) continue;
        const wedgeRing = wedgeForArc(s.geom.wedges, arc);
        expect(wedgeRing, `angle ${a}°: no wedge for a non-degenerate arc`).toBeTruthy();
        const survived = arcPointsSurviving(wedgeRing, arc);
        expect(survived).toBeGreaterThanOrEqual(Math.ceil(arc.length * 0.75));
      }
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

// B<PENDING> NEW-2 — a free-drawn POLYGON pad/parking field must get the SAME junction-fillet
// treatment as a rect pad (driveJunctionsOf's own predicate used to exclude any target carrying
// `.points` outright — SitePlanner.jsx's `if (!T || T.points || ...) continue`). This replicates
// driveJunctionsOf's math using `polygonEdges`/`polygonContainsPoint`/`polygonDepthBehind` in place
// of `rectEdges`/`rectContainsPoint`/`T.w`|`T.h` — the same substitution the real fix makes — over
// a RECTANGULAR ring (so the result is directly comparable to the rect-target suite above) and
// over a genuinely CONCAVE (L-shaped) field.
function polygonJunctionScenario(angleDeg, points, opts = {}) {
  const { width = 36, driveLen = 300, edgeIndex = 0, alongEdge = 0, R = 24, flare = 0, curb = 0.5 } = opts;
  const edges = polygonEdges(points);
  const e = edges[edgeIndex];
  const P = { x: e.mid.x + e.dir.x * alongEdge, y: e.mid.y + e.dir.y * alongEdge };
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const dir = { x: e.outN.x * c + e.dir.x * s, y: e.outN.y * c + e.dir.y * s };
  const far = { x: P.x + dir.x * driveLen, y: P.y + dir.y * driveLen };
  const road = { type: "road", pts: [far, P], vtx: [{}, {}], travelW: width, curb, roadClass: "aisle" };

  const hit = nearestRectEdge(P, edges, { facingOnly: false });
  if (!hit) return null;
  const sideDir = { x: far.x - P.x, y: far.y - P.y };
  const edgeRunPos = (hit.edge.b.x - P.x) * hit.edge.dir.x + (hit.edge.b.y - P.y) * hit.edge.dir.y;
  const edgeRunNeg = (P.x - hit.edge.a.x) * hit.edge.dir.x + (P.y - hit.edge.a.y) * hit.edge.dir.y;
  const perpDepth = polygonDepthBehind(points, hit.pt, { x: -hit.edge.outN.x, y: -hit.edge.outN.y });
  const geom = teeGeometry({
    T: P, throughDir: hit.edge.dir, sideDir,
    phT: 0, phS: roadOuterHalf(road),
    R: Math.min(R, Math.max(1, perpDepth)), flare, curbT: 0.5, curbS: roadCurbWidth(road),
    throughAvailPos: Math.max(0, edgeRunPos), throughAvailNeg: Math.max(0, edgeRunNeg),
    sideAvail: driveLen - 1,
  });
  const strip = roadStripRing(road, {}, undefined, undefined);
  const wedges = geom ? geom.wedges : [];
  const dissolved = dissolveRings([strip, ...wedges]);
  return { points, edges, road, P, hit, geom, strip, wedges, dissolved };
}

describe("NEW-2 — polygon pad / parking field is a valid drive target, same as a rect pad", () => {
  const rectRing = [{ x: -100, y: -75 }, { x: 100, y: -75 }, { x: 100, y: 75 }, { x: -100, y: 75 }]; // same footprint as the rect truck-court fixture above
  const lShape = [ // a concave, L-shaped field — the bottom edge (index 0) is the connect target
    { x: -100, y: -75 }, { x: 100, y: -75 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 75 }, { x: -100, y: 75 },
  ];

  it("connects, contains ONE region, and stays simple across an oblique angle sweep (rectangular polygon ring)", () => {
    for (const a of [0, 15, 30, 45, 60, 75, 89]) {
      const s = polygonJunctionScenario(a, rectRing, { width: 36, R: 24 });
      expect(s, `angle ${a}°: scenario built`).toBeTruthy();
      expect(s.dissolved.length, `angle ${a}°: one connected region`).toBe(1);
      for (const r of s.dissolved) expect(isSimplePolygon(r.outer), `angle ${a}°: simple polygon`).toBe(true);
    }
  });

  it("REGRESSION shape (45° into a polygon-drawn rectangular field) matches the rect-target result: no throat notch", () => {
    const s = polygonJunctionScenario(45, rectRing, { width: 36, R: 24 });
    const padRingLike = rectRing; // reuse the same point-in-ring check the rect suite uses via throatNotchCells's pad param shape
    const notches = throatNotchCells({ pad: { cx: 0, cy: 0, w: 200, h: 150 }, dissolved: s.dissolved, P: s.P });
    expect(notches).toHaveLength(0);
  });

  it("connects to a CONCAVE (L-shaped) field without crashing and stays a simple, connected region", () => {
    for (const a of [0, 20, 45, 70]) {
      const s = polygonJunctionScenario(a, lShape, { width: 30, R: 20, edgeIndex: 0 });
      expect(s, `angle ${a}°: scenario built`).toBeTruthy();
      expect(s.dissolved.length, `angle ${a}°: one connected region`).toBe(1);
      for (const r of s.dissolved) expect(isSimplePolygon(r.outer)).toBe(true);
    }
  });

  it("a point WELL INSIDE the polygon field is contained (the B1612608 large-court case, for a polygon)", () => {
    expect(polygonContainsPoint({ x: 0, y: 0 }, rectRing)).toBe(true);
    expect(polygonContainsPoint({ x: 0, y: 0 }, lShape)).toBe(false); // inside the L's own notch, not the field
    expect(polygonContainsPoint({ x: -50, y: -50 }, lShape)).toBe(true);
  });
});
