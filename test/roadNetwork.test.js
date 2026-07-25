/* NEW-1/NEW-2 — the dissolved road network (roadNetwork.js) + the additive curb-return wedge.
 *
 * These are the guards for the class of defect that came back seven times (B945/B946/B949/B953/B964/
 * B971/B989/B1005/B1006). Every prior test asserted properties of a COVER PATCH — its width, its reach,
 * whether a mask hole existed. A patch can satisfy all of that and still leave the junction looking like
 * two rectangles crossing, because the patch is not the pavement. What these assert instead is the thing
 * the owner actually sees: that the junction is ONE region with ONE boundary, and that nothing of the
 * side road's butting end survives inside the through road.
 */
import { describe, it, expect } from "vitest";
import { dissolveRings, clipPolylineOutside, clusterIds, regionPathD } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { teeGeometry, roadCornerRadii, roadRadiusConflicts } from "../src/workspaces/site-planner/lib/roadGeometry.js";
import { bufferPolyline } from "../src/workspaces/site-planner/lib/metesAndBounds.js";

const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s / 2); };
const pointInRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
const inRegion = (p, reg) => pointInRing(p, reg.outer) && !(reg.holes || []).some((h) => pointInRing(p, h));

// A tee built the way SitePlanner builds one: half-widths at BACK OF CURB, wedges unioned with strips.
function teeScene({ throughPts, sidePts, wThrough = 40, wSide = 40, curb = 0.5, R = 24, tessDeg = 6 }) {
  const phT = wThrough / 2 + curb, phS = wSide / 2 + curb;
  const T = sidePts[sidePts.length - 1];
  const throughDir = { x: throughPts[throughPts.length - 1].x - throughPts[0].x, y: throughPts[throughPts.length - 1].y - throughPts[0].y };
  const sideDir = { x: sidePts[0].x - T.x, y: sidePts[0].y - T.y };
  const geom = teeGeometry({ T, throughDir, sideDir, phT, phS, R, tessDeg, throughAvailPos: 500, throughAvailNeg: 500, sideAvail: 500 });
  const strips = [bufferPolyline(throughPts, wThrough + 2 * curb), bufferPolyline(sidePts, wSide + 2 * curb)];
  return { geom, regions: dissolveRings([...strips, ...geom.wedges]) };
}

describe("dissolveRings — the junction is ONE region, not a patch over a seam", () => {
  it("two overlapping rings dissolve to a single region", () => {
    const a = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const b = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }];
    const out = dissolveRings([a, b]);
    expect(out).toHaveLength(1);
    expect(area(out[0].outer)).toBeCloseTo(175, 0);   // 100 + 100 − 25 shared
  });

  it("an OPPOSITELY WOUND ring still ADDS pavement — it must never subtract", () => {
    // The silent killer: under a non-zero fill rule a clockwise ring overlapping a counter-clockwise one
    // cancels, so a return wedge that happens to wind the other way punches a hole where it should add.
    const ccw = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const cw = [{ x: 5, y: 5 }, { x: 5, y: 15 }, { x: 15, y: 15 }, { x: 15, y: 5 }];
    const out = dissolveRings([ccw, cw]);
    expect(out).toHaveLength(1);
    expect(out[0].holes).toHaveLength(0);
    expect(area(out[0].outer)).toBeCloseTo(175, 0);
  });

  it("a ring enclosing a courtyard keeps it as a HOLE, not as lost pavement", () => {
    const outer = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const bar = [{ x: -10, y: 40 }, { x: 110, y: 40 }, { x: 110, y: 60 }, { x: -10, y: 60 }];
    const ringRoad = [outer.slice(), bar];   // a solid square + a bar: no hole
    expect(dissolveRings(ringRoad)[0].holes).toHaveLength(0);
    // A true loop of four strips DOES enclose a hole.
    const s = (x0, y0, x1, y1) => bufferPolyline([{ x: x0, y: y0 }, { x: x1, y: y1 }], 20);
    const loop = dissolveRings([s(0, 0, 200, 0), s(200, 0, 200, 200), s(200, 200, 0, 200), s(0, 200, 0, 0)]);
    expect(loop).toHaveLength(1);
    expect(loop[0].holes).toHaveLength(1);
  });

  it("regionPathD emits the outer ring plus every hole (even-odd ready)", () => {
    const reg = { outer: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], holes: [[{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]] };
    const d = regionPathD(reg, (p) => p);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.endsWith("Z")).toBe(true);
  });
});

describe("teeGeometry curb returns — rounded, tangent, and additive at every angle", () => {
  // The owner's three topologies. A straight tee is the one every prior fix was verified against; the
  // other two are the ones it shipped broken on.
  const cases = [
    { name: "straight 90° road-to-road tee", through: [{ x: -300, y: 0 }, { x: 300, y: 0 }], side: [{ x: 0, y: -300 }, { x: 0, y: 0 }] },
    { name: "oblique ~57° road-to-road tee", through: [{ x: -300, y: 0 }, { x: 300, y: 0 }], side: [{ x: -200, y: -300 }, { x: 0, y: 0 }] },
    { name: "acute ~25° road-to-road tee", through: [{ x: -400, y: 0 }, { x: 400, y: 0 }], side: [{ x: -400, y: -190 }, { x: 0, y: 0 }] },
    { name: "tee onto a CURVED through road", through: [{ x: -300, y: 60 }, { x: -150, y: 12 }, { x: 0, y: 0 }, { x: 150, y: 12 }, { x: 300, y: 60 }], side: [{ x: 0, y: -300 }, { x: 0, y: 0 }] },
  ];

  for (const c of cases) {
    it(`${c.name} — dissolves to ONE region with no slivers, and the side road's butting end is gone`, () => {
      const { geom, regions } = teeScene({ throughPts: c.through, sidePts: c.side });
      expect(geom).toBeTruthy();
      expect(geom.wedges).toHaveLength(2);
      expect(regions).toHaveLength(1);                              // one junction, one pavement region
      // No hair-thin holes. A real courtyard would be huge; anything under a few square feet is a sliver,
      // and a sliver strokes as exactly the faint seam this change exists to remove.
      for (const h of regions[0].holes) expect(area(h)).toBeGreaterThan(200);
      // The side road's END CAP used to sit inside the through pavement, drawing a rectangle across it.
      // Now every point across that cap is interior to the one region.
      const T = c.side[c.side.length - 1];
      for (const dx of [-18, -9, 0, 9, 18]) expect(inRegion({ x: T.x + dx, y: T.y }, regions[0])).toBe(true);
    });

    it(`${c.name} — the returns are ARCS (not chamfers) and stay within one drive-width of the mouth`, () => {
      const { geom } = teeScene({ throughPts: c.through, sidePts: c.side });
      for (const arc of geom.returns) {
        expect(arc.length).toBeGreaterThan(3);                      // a tessellated arc, not a 2-point chamfer
        // Curvature check: the mid-arc point must bow off the tan1→tan2 chord. A straight chamfer would not.
        const a = arc[0], b = arc[arc.length - 1], m = arc[Math.floor(arc.length / 2)];
        const chordLen = Math.hypot(b.x - a.x, b.y - a.y);
        const sag = Math.abs((b.x - a.x) * (a.y - m.y) - (a.x - m.x) * (b.y - a.y)) / (chordLen || 1);
        expect(sag).toBeGreaterThan(chordLen * 0.05);
      }
      expect(geom.R).toBeGreaterThan(0);
      expect(geom.R).toBeLessThanOrEqual(24 + 1e-6);                // never blows past the requested radius
      // NO SCOOP (the B989/B1005 contract, restated in the units that actually bound it). The mouth's
      // width is dictated by the skew — a 25° tee genuinely opens ~2·phS/sin25° — so throat width is the
      // wrong thing to bound. What must never run away is the RETURN's REACH past the corner: at any
      // angle the tangent run stays within the requested radius. That is what turned into the batwing.
      for (let k = 0; k < 2; k++) {
        const corner = geom.corners[k];
        const reach = Math.hypot(geom.throughTangents[k].x - corner.x, geom.throughTangents[k].y - corner.y);
        expect(reach).toBeLessThanOrEqual(24 + 1e-6);
      }
    });
  }

  it("a tee with NO run left past the corner degrades to a sharp corner, never to the full radius", () => {
    // The drive is wider than the edge it lands on. The old clamp was gated on `tMax > 0`, so a zero
    // reach fell through the guard and kept the FULL requested radius — no room produced the biggest turn.
    const g = teeGeometry({
      T: { x: 0, y: 0 }, throughDir: { x: 1, y: 0 }, sideDir: { x: 0, y: 1 },
      phT: 0, phS: 12, R: 50, throughAvail: 10, sideAvail: 10,
    });
    expect(g).toBeTruthy();
    expect(g.R).toBe(0);
    expect(g.wedges).toHaveLength(0);
  });

  it("per-direction availability: a drive landing near the END of an edge clamps only that side", () => {
    // 3 ft of edge to the right of T, 400 ft to the left. The right return must shrink; the left must not.
    const g = teeGeometry({
      T: { x: 0, y: 0 }, throughDir: { x: 1, y: 0 }, sideDir: { x: 0, y: 1 },
      phT: 0, phS: 12, R: 30, throughAvailPos: 15, throughAvailNeg: 400, sideAvail: 400,
    });
    expect(g).toBeTruthy();
    const [rA, rB] = [g.returns[0], g.returns[1]];
    const span = (arc) => Math.hypot(arc[arc.length - 1].x - arc[0].x, arc[arc.length - 1].y - arc[0].y);
    expect(Math.min(span(rA), span(rB))).toBeLessThan(Math.max(span(rA), span(rB)) * 0.6);
  });
});

describe("clipPolylineOutside — a curb stripe stops at the junction", () => {
  it("drops the part of a stripe that runs inside another road's pavement", () => {
    const line = [{ x: -100, y: 0 }, { x: 100, y: 0 }];
    const box = [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }];
    const segs = clipPolylineOutside(line, [box]);
    expect(segs).toHaveLength(2);
    for (const s of segs) for (const p of s) expect(Math.abs(p.x)).toBeGreaterThanOrEqual(20 - 1e-6);
  });
  it("leaves a stripe untouched when nothing crosses it", () => {
    const line = [{ x: 0, y: 0 }, { x: 50, y: 0 }];
    expect(clipPolylineOutside(line, [])).toEqual([line]);
    expect(clipPolylineOutside(line, [[{ x: 200, y: 200 }, { x: 210, y: 200 }, { x: 210, y: 210 }]])).toHaveLength(1);
  });
});

describe("clusterIds — connected roads render as one surface", () => {
  it("groups roads joined by tees/welds and leaves a lone road on its own", () => {
    const idx = clusterIds(["a", "b", "c", "d"], [["a", "b"], ["b", "c"]]);
    expect(idx.get("a")).toBe(idx.get("b"));
    expect(idx.get("b")).toBe(idx.get("c"));
    expect(idx.get("d")).not.toBe(idx.get("a"));
  });
  it("ignores pairs naming an unknown id", () => {
    const idx = clusterIds(["a", "b"], [["a", "zz"]]);
    expect(idx.get("a")).not.toBe(idx.get("b"));
  });
});

/* NEW-4 — the three defects the owner reported off his live plan, and the silent clamp behind them. */
describe("roadCornerRadii / roadRadiusConflicts — a corner the app had to shrink must SAY SO", () => {
  it("reports the DRAWN radius, not the requested one, when the leg is too short to hold it", () => {
    // A 28 ft corner (a fire lane's inside minimum) on a leg far too short to carry it. arcCorner
    // silently clamps the run to half the shorter leg; this is what surfaces that.
    const pts = [{ x: -200, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 22 }];
    const vtx = [{}, { treatment: "arc", radius: 28 }, {}];
    const [corner] = roadCornerRadii(pts, vtx);
    expect(corner.requested).toBe(28);
    expect(corner.rendered).toBeLessThan(28);
    expect(corner.rendered).toBeCloseTo(11, 0);      // half the 22 ft leg, at a 90° deflection
    expect(corner.limited).toBe(true);
  });

  it("does NOT flag a corner the geometry can actually hold", () => {
    const pts = [{ x: -300, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 300 }];
    const vtx = [{}, { treatment: "arc", radius: 28 }, {}];
    const [corner] = roadCornerRadii(pts, vtx);
    expect(corner.limited).toBe(false);
    expect(corner.rendered).toBeCloseTo(28, 6);
    expect(roadRadiusConflicts(pts, vtx, 28)).toHaveLength(0);
  });

  it("flags every interior corner drawn below the class minimum, and carries the vertex point", () => {
    const pts = [{ x: -200, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 22 }];
    const vtx = [{}, { treatment: "arc", radius: 28 }, {}];
    const [bad] = roadRadiusConflicts(pts, vtx, 28);
    expect(bad.i).toBe(1);
    expect(bad.minRadius).toBe(28);
    expect(bad.pt).toEqual({ x: 0, y: 0 });
  });

  it("a straight or smooth vertex is never a radius conflict", () => {
    const straight = [{ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(roadRadiusConflicts(straight, [{}, { treatment: "arc", radius: 28 }, {}], 28)).toHaveLength(0);
    const smooth = [{ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 22 }];
    expect(roadRadiusConflicts(smooth, [{}, { treatment: "smooth" }, {}], 28)).toHaveLength(0);
  });

  it("the Custom class (no threshold) never flags", () => {
    const pts = [{ x: -200, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 22 }];
    expect(roadRadiusConflicts(pts, [{}, { treatment: "arc", radius: 28 }, {}], 0)).toHaveLength(0);
  });
});
