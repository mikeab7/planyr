/* NEW-1 / NEW-2 — the CURVED half of the road family, driven by the owner's REAL geometry.
 *
 * Every previous guard in this family (B945…B1011) was built on a mock: two STRAIGHT roads meeting at
 * a tee. On a straight road the chord between two control points IS the road, so both defects below
 * are invisible to that mock — which is exactly why they shipped and kept coming back.
 *
 *   NEW-1 — the right-click "Add control point" hit test projected the cursor onto the CHORD between
 *           control points, with a tolerance of about the pavement half-width. On a bend the chord cuts
 *           the corner, so the drawn pavement on the OUTSIDE of the curve sits further from the chord
 *           than that tolerance: no edge hit, no menu item, the element's own menu opened instead.
 *           Owner: "I can't extend the road … if I try a different portion of it then it does work."
 *
 *   NEW-2 — where a road SPLITS, the branch is welded to one of the through road's control points —
 *           but a fillet at that vertex carries the DRAWN centerline clear of it. On Goose Creek
 *           "Plan 1 (copy)" the 36' aisle turns ~88° through an arc-treated vertex and the pavement
 *           passes ~10 ft from the node the branch hangs off, so the two strips stepped against each
 *           other and one armpit got no curb return at all (the two through arms read as a straight
 *           run-through from the chords, and a "flat" gap is skipped).
 *
 * The fixture is the owner's actual element set, pulled from the production site record — see
 * ui-audit/fixtures/goose-creek-plan1-copy.json.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  roadCenterline, roadCenterlineTagged, projectToRoadCenterline, projectToPolyline,
  insertRoadVertex, nodeJunction,
} from "../src/workspaces/site-planner/lib/roadGeometry.js";
import { bufferPolyline } from "../src/workspaces/site-planner/lib/metesAndBounds.js";
import { dissolveRings } from "../src/workspaces/site-planner/lib/roadNetwork.js";

const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1-copy.json", import.meta.url), "utf8"));
const el = (id) => FIXTURE.els.find((e) => e.id === id);

// The owner's split: the 36' aisle e1454749rlpiva runs east, turns ~88° north through an ARC vertex,
// and the branch e1454750rlpiva tees onto that same vertex heading south.
const THROUGH = el("e1454749rlpiva");
const BRANCH = el("e1454750rlpiva");
const AISLE_R = 25;                 // the "aisle" class default Arc radius (roadClasses.js)
const AISLE_RETURN = 24;            // classReturnRadius("aisle")
const outerHalf = (e) => (+e.travelW || 0) / 2 + (Number.isFinite(+e.curb) ? +e.curb : 0.5);
const stripOf = (e, opts = {}) => bufferPolyline(roadCenterline(e.pts, e.vtx, { defaultRadius: AISLE_R, ...opts }), (+e.travelW || 0) + 2 * (Number.isFinite(+e.curb) ? +e.curb : 0.5));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const bearing = (v) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
// The hit test as it WAS: distance from a point to the straight chord between two control points.
const projToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/* ---------------------------------------------------------------------------------------------
 * NEW-1 — hit-testing the road as DRAWN
 * ------------------------------------------------------------------------------------------- */
describe("NEW-1 — the edge hit test follows the curve the renderer draws", () => {
  // A synthetic 90° arc corner with the numbers checkable by hand: a 40 ft road (half the pavement,
  // curb included, is 20.5 ft) bending through the TRUCK-ROUTE class's 120 ft default radius — the
  // "large radius return" the owner was right-clicking beside. The fillet's middle ordinate is
  // R(√2 − 1) ≈ 49.7 ft, so the drawn road runs nearly 50 ft clear of the corner vertex.
  const PTS = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }];
  const VTX = [{}, { treatment: "arc", radius: 120 }, {}];
  const OPTS = { defaultRadius: 120 };
  const HALF = 20.5;
  const toChords = (p) => Math.min(projToSeg(p, PTS[0], PTS[1]), projToSeg(p, PTS[1], PTS[2]));

  it("REGRESSION: the pavement at a large-radius bend lies beyond the tolerance from EITHER chord", () => {
    // This is the defect in one number. The hit test allowed about the strip half-width off a chord;
    // on this bend the road itself is 35 ft off the nearer chord, so no click on that pavement could
    // ever register as an edge — and the road's own context menu opened instead.
    const dense = roadCenterline(PTS, VTX, OPTS);
    const apex = projectToPolyline(dense, PTS[1]).pt;
    expect(toChords(apex)).toBeGreaterThan(HALF);
  });

  it("a click on the outside of the bend, beyond the half-width from either chord, still finds the edge", () => {
    const dense = roadCenterline(PTS, VTX, OPTS);
    const apex = projectToPolyline(dense, PTS[1]).pt;
    // Step outward along the corner bisector — still on the pavement, and further from BOTH chords
    // than the tolerance. This is the exact click that used to return nothing.
    const click = { x: apex.x + 12 / Math.SQRT2, y: apex.y - 12 / Math.SQRT2 };
    expect(toChords(click)).toBeGreaterThan(HALF);
    const hit = projectToRoadCenterline(PTS, VTX, click, OPTS);
    expect(hit).toBeTruthy();
    expect(hit.d).toBeCloseTo(12, 6);                                     // …the new one lands, right where clicked
    expect(hit.d).toBeLessThan(HALF);
  });

  it("the returned insertion point lies ON the drawn centerline", () => {
    const dense = roadCenterline(PTS, VTX, OPTS);
    for (const click of [{ x: 150, y: 4 }, { x: 285, y: 15 }, { x: 296, y: 40 }, { x: 305, y: 250 }]) {
      const hit = projectToRoadCenterline(PTS, VTX, click, OPTS);
      expect(projectToPolyline(dense, hit.pt).d).toBeLessThan(1e-6);
    }
  });

  it("the hit maps back to a control-point segment insertRoadVertex accepts, and splices there", () => {
    for (const click of [{ x: 150, y: 4 }, { x: 305, y: 250 }]) {
      const hit = projectToRoadCenterline(PTS, VTX, click, OPTS);
      expect(hit.index).toBeGreaterThanOrEqual(0);
      expect(hit.index).toBeLessThanOrEqual(PTS.length - 2);
      const ins = insertRoadVertex(PTS, VTX, hit.index, hit.pt);
      expect(ins).toBeTruthy();
      expect(ins.pts).toHaveLength(PTS.length + 1);
      expect(ins.pts[ins.index]).toEqual({ x: hit.pt.x, y: hit.pt.y });
    }
    // …and each click lands in the segment nearest it: the first on segment 0, the second on segment 1.
    expect(projectToRoadCenterline(PTS, VTX, { x: 150, y: 4 }, OPTS).index).toBe(0);
    expect(projectToRoadCenterline(PTS, VTX, { x: 305, y: 250 }, OPTS).index).toBe(1);
  });

  it("a SHARP (uncurved) road behaves exactly as the chord projection did", () => {
    const sharpVtx = [{}, { treatment: "sharp" }, {}];
    for (const click of [{ x: 150, y: 7 }, { x: 296, y: 40 }, { x: 20, y: -3 }]) {
      const hit = projectToRoadCenterline(PTS, sharpVtx, click, OPTS);
      // The dense centerline IS the input polyline, so the projection is the plain chord projection.
      const chord = projectToPolyline(PTS, click);
      expect(hit.index).toBe(chord.i);
      expect(hit.pt.x).toBeCloseTo(chord.pt.x, 9);
      expect(hit.pt.y).toBeCloseTo(chord.pt.y, 9);
      expect(hit.d).toBeCloseTo(chord.d, 9);
    }
  });

  it("a 2-point road is unchanged, and a degenerate one does not throw", () => {
    const two = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const hit = projectToRoadCenterline(two, [{}, {}], { x: 50, y: 9 });
    expect(hit.index).toBe(0);
    expect(hit.pt).toEqual({ x: 50, y: 0 });
    expect(projectToRoadCenterline([{ x: 0, y: 0 }], [{}], { x: 1, y: 1 })).toBeNull();
    expect(projectToRoadCenterline(null, null, { x: 1, y: 1 })).toBeNull();
  });

  it("every dense segment is charged to a real control-point segment", () => {
    const { dense, segOwn } = roadCenterlineTagged(THROUGH.pts, THROUGH.vtx, { defaultRadius: AISLE_R });
    expect(segOwn).toHaveLength(dense.length - 1);
    for (const own of segOwn) {
      expect(own).toBeGreaterThanOrEqual(0);
      expect(own).toBeLessThanOrEqual(THROUGH.pts.length - 2);
    }
    // …and the ownership only ever moves forward along the alignment.
    for (let i = 1; i < segOwn.length; i++) expect(segOwn[i]).toBeGreaterThanOrEqual(segOwn[i - 1]);
  });

  it("roadCenterline is byte-identical through the tagged builder", () => {
    for (const road of [THROUGH, BRANCH, el("e1454717dshobp"), el("e1454747rlpiva")]) {
      const tagged = roadCenterlineTagged(road.pts, road.vtx, { defaultRadius: AISLE_R });
      expect(roadCenterline(road.pts, road.vtx, { defaultRadius: AISLE_R })).toEqual(tagged.dense);
    }
  });
});

/* ---------------------------------------------------------------------------------------------
 * NEW-2 — the split resolves into one surface
 * ------------------------------------------------------------------------------------------- */
describe("NEW-2 — a road that splits ON A CURVE resolves into one surface (owner's real plan)", () => {
  const P = BRANCH.pts[0];                       // the welded junction node
  const GVI = 1;                                 // …which is the through road's interior vertex 1

  it("the fixture really is the failing topology: an arc-treated junction vertex, obliquely branched", () => {
    expect(dist(THROUGH.pts[GVI], P)).toBeLessThan(0.01);          // the branch hangs off vertex 1
    expect(THROUGH.vtx[GVI].treatment).toBeUndefined();            // …which defaults to "arc"
    const din = { x: THROUGH.pts[GVI].x - THROUGH.pts[0].x, y: THROUGH.pts[GVI].y - THROUGH.pts[0].y };
    const dout = { x: THROUGH.pts[GVI + 1].x - THROUGH.pts[GVI].x, y: THROUGH.pts[GVI + 1].y - THROUGH.pts[GVI].y };
    const deflect = Math.abs(((bearing(dout) - bearing(din) + 540) % 360) - 180);
    expect(deflect).toBeGreaterThan(80);                           // a real ~88° bend, not a collinear vertex
    expect(deflect).toBeLessThan(95);
  });

  it("REGRESSION: without the fix, the pavement misses the junction node by most of a lane", () => {
    const drawn = roadCenterline(THROUGH.pts, THROUGH.vtx, { defaultRadius: AISLE_R });
    const off = projectToPolyline(drawn, P).d;
    expect(off).toBeGreaterThan(9);                                // ~9.9 ft clear of the node
    expect(off).toBeGreaterThan(outerHalf(BRANCH) / 2);            // over half the branch's own half-width
  });

  it("flattening the junction vertex puts the drawn pavement back through the node", () => {
    const drawn = roadCenterline(THROUGH.pts, THROUGH.vtx, { defaultRadius: AISLE_R, sharpAt: [GVI] });
    expect(projectToPolyline(drawn, P).d).toBeLessThan(1e-6);
    // …and it changes NOTHING anywhere else on the road.
    const plain = roadCenterline(THROUGH.pts, THROUGH.vtx, { defaultRadius: AISLE_R });
    for (const q of drawn) if (dist(q, P) > 60) expect(projectToPolyline(plain, q).d).toBeLessThan(0.5);
  });

  it("flattening a COLLINEAR junction vertex is a no-op (the ordinary straight tee is untouched)", () => {
    const straight = el("e1454717dshobp");                         // its vertex 3 carries the other tee
    const plain = roadCenterline(straight.pts, straight.vtx, { defaultRadius: AISLE_R });
    const flat = roadCenterline(straight.pts, straight.vtx, { defaultRadius: AISLE_R, sharpAt: [3] });
    expect(flat).toEqual(plain);
  });

  // Build the junction the way SitePlanner does — three arms around the node, each with its own
  // tangent, half-width at back of curb and run.
  const runFrom = (pts, i, step, noiseFt) => {
    let d = 0, far = null;
    for (let k = i + step; k >= 0 && k < pts.length; k += step) {
      d += dist(pts[k], pts[k - step]);
      if (!far && dist(pts[k], pts[i]) > noiseFt) far = pts[k];
      if (d >= 1000) break;
    }
    return { dist: d, far: far || pts[i + step] || pts[i] };
  };
  const junction = (roundOwnCorner) => {
    const back = runFrom(THROUGH.pts, GVI, -1, Math.max(1.5, THROUGH.travelW / 2));
    const fwd = runFrom(THROUGH.pts, GVI, 1, Math.max(1.5, THROUGH.travelW / 2));
    const side = runFrom(BRANCH.pts, 0, 1, Math.max(1.5, BRANCH.travelW / 2));
    const hG = outerHalf(THROUGH), hS = outerHalf(BRANCH);
    return nodeJunction({
      node: { x: P.x, y: P.y }, R: AISLE_RETURN, flatDeg: 178, roundOwnCorner,
      arms: [
        { dir: { x: back.far.x - P.x, y: back.far.y - P.y }, half: hG, avail: back.dist, road: THROUGH.id, deep: Math.min(hG * 0.5, 12) },
        { dir: { x: fwd.far.x - P.x, y: fwd.far.y - P.y }, half: hG, avail: fwd.dist, road: THROUGH.id, deep: Math.min(hG * 0.5, 12) },
        { dir: { x: side.far.x - P.x, y: side.far.y - P.y }, half: hS, avail: side.dist, road: BRANCH.id, deep: Math.max(1, Math.min(hS * 0.5, 12)) },
      ],
    });
  };

  it("REGRESSION: the through road's own turn is left as a SQUARE corner unless the junction rounds it", () => {
    // With the junction vertex flattened the road's own buffer miters that corner — so the junction has
    // to round it. Without `roundOwnCorner` the same-road gap is skipped and one corner of a three-way
    // intersection is a hard 90°, beside two clean curb returns.
    expect(junction(false).wedges).toHaveLength(1);
    expect(junction(true).wedges).toHaveLength(2);
  });

  it("every armpit at the split gets a REAL curb return — no squared-off corner", () => {
    const nj = junction(true);
    expect(nj.gaps.filter((g) => g.R > 0)).toHaveLength(2);
    for (const g of nj.gaps) {
      expect(g.R, "a real radius, not a collapsed corner").toBeGreaterThan(4);
      expect(g.arc.length, "a tessellated arc, not a two-point chamfer").toBeGreaterThan(3);
    }
  });

  it("the split dissolves to ONE region with no sliver holes, at the owner's real geometry", () => {
    const nj = junction(true);
    const regions = dissolveRings([
      stripOf(THROUGH, { sharpAt: [GVI] }),
      stripOf(BRANCH),
      ...nj.wedges,
    ]);
    expect(regions).toHaveLength(1);
    // A hair-thin hole between a tessellated strip and an analytic wedge strokes as exactly the faint
    // seam this whole change exists to kill.
    for (const h of regions[0].holes) expect(Math.abs(h.reduce((s, p, i) => { const q = h[(i + 1) % h.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2)).toBeGreaterThan(200);
  });

  // The sharpest turn the dissolved outline makes within `rad` of the node. A curb-return arc turns a
  // few degrees per tessellation step, so anything near a right angle here is a STEP or a NOTCH — one
  // strip's boundary showing through inside the other's pavement.
  const worstTurnNear = (region, rad) => {
    const r = region.outer;
    let worst = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[(i - 1 + r.length) % r.length], b = r[i], c = r[(i + 1) % r.length];
      if (dist(b, P) > rad) continue;
      const t = Math.abs((((bearing({ x: c.x - b.x, y: c.y - b.y }) - bearing({ x: b.x - a.x, y: b.y - a.y })) + 540) % 360) - 180);
      if (t > worst) worst = t;
    }
    return worst;
  };
  const NEAR = outerHalf(THROUGH) * 1.5;

  it("the outline carries no STEP through the split: it turns only as a curb return turns", () => {
    const nj = junction(true);
    const [region] = dissolveRings([stripOf(THROUGH, { sharpAt: [GVI] }), stripOf(BRANCH), ...nj.wedges]);
    expect(worstTurnNear(region, NEAR)).toBeLessThan(30);
  });

  it("REGRESSION: on the stored (un-flattened) alignment the same union steps and loses a return", () => {
    // Documents what shipped: the node sits ~10 ft off the pavement, so the two through arms read as a
    // straight run-through from the chords, one whole armpit contributes nothing, and the outline turns
    // through better than a right angle twice within a lane of the node — the owner's step and notch.
    const nj = junction(false);
    expect(nj.wedges).toHaveLength(1);
    const [region] = dissolveRings([stripOf(THROUGH), stripOf(BRANCH), ...nj.wedges]);
    expect(worstTurnNear(region, NEAR)).toBeGreaterThan(60);
  });
});
