/* B1052 — control points the owner never placed.
 *
 * Every road-to-road connect SPLICES a vertex into the target road at the tee point, and nothing has
 * ever taken one back out: redraw the side road, drag its end, reconnect it a foot over, and each
 * attempt leaves its own vertex behind. On his real plan the 40 ft truck loop carried ten interior
 * vertices sitting 0.00–0.25 ft off the chord between their own neighbours — they bend the alignment
 * by nothing and are simply grips he has to look at and avoid dragging.
 *
 * B1008 (near-duplicates within ~1.5 ft) and B1010 (a short stub the alignment TURNS through) both
 * explicitly judged a COLLINEAR stub harmless. It distorts no geometry — and it is still clutter the
 * user never authored, which is the complaint. The test here is CONTRIBUTION, and the safety property
 * is that total movement is measured against the ORIGINAL polyline, so error cannot accumulate. */
import { describe, it, expect } from "vitest";
import { simplifyRoadVertices, ROAD_SIMPLIFY_TOL_FT } from "../src/workspaces/site-planner/lib/roadGeometry.js";

const P = (x, y) => ({ x, y });
// Farthest any point of `orig` sits from the polyline `keep` — the invariant the simplifier bounds.
const maxOffset = (orig, keep) => Math.max(...orig.map((p) => Math.min(...keep.slice(0, -1).map((a, i) => {
  const b = keep[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}))));

describe("simplifyRoadVertices — drop what contributes nothing", () => {
  it("collapses a straight run littered with connect debris", () => {
    const pts = [P(0, 0), P(100, 0), P(200, 0), P(202, 0), P(204, 0), P(600, 0)];
    const r = simplifyRoadVertices(pts, [], ROAD_SIMPLIFY_TOL_FT);
    expect(r).not.toBeNull();
    expect(r.pts).toEqual([P(0, 0), P(600, 0)]);
    expect(r.dropped).toEqual([1, 2, 3, 4]);
  });

  it("keeps a REAL corner — a vertex that carries the alignment", () => {
    const pts = [P(0, 0), P(300, 0), P(300, 300)];
    expect(simplifyRoadVertices(pts, [], ROAD_SIMPLIFY_TOL_FT)).toBeNull();
  });

  it("keeps a gentle bend that still moves the road more than the tolerance", () => {
    const pts = [P(0, 0), P(300, 8), P(600, 0)];       // 8 ft off the chord
    expect(simplifyRoadVertices(pts, [], ROAD_SIMPLIFY_TOL_FT)).toBeNull();
  });

  it("NEVER lets the road drift further than the tolerance from where it was drawn", () => {
    // A long stair of 1 ft steps: greedily removing them one at a time WOULD accumulate, which is
    // exactly why the check re-measures every original point against the trial result.
    const pts = Array.from({ length: 12 }, (_, i) => P(i * 50, i * 1.0));
    const r = simplifyRoadVertices(pts, [], ROAD_SIMPLIFY_TOL_FT);
    const kept = r ? r.pts : pts;
    expect(maxOffset(pts, kept)).toBeLessThanOrEqual(ROAD_SIMPLIFY_TOL_FT + 1e-6);
  });

  it("can be bounded against an EARLIER polyline via opts.reference", () => {
    // Composing passes: if a previous pass already nudged the road, measuring only against ITS output
    // would hand this pass a fresh budget. `reference` makes the bound span both.
    const original = [P(0, 0), P(300, 0), P(600, 0)];
    const afterPass1 = [P(0, 0), P(300, 1.4), P(600, 0)];       // an earlier pass moved the middle
    expect(simplifyRoadVertices(afterPass1, [], 1.5)).not.toBeNull();                        // 1.4 < 1.5
    expect(simplifyRoadVertices(afterPass1, [], 1.5, { reference: original })).not.toBeNull(); // still fine
    const far = [P(0, 0), P(300, 1.4), P(600, 0)];
    expect(simplifyRoadVertices(far, [], 1.0)).toBeNull();      // 1.4 > 1.0 against its own input
  });

  it("honours a tighter tolerance", () => {
    const pts = [P(0, 0), P(300, 1.0), P(600, 0)];
    expect(simplifyRoadVertices(pts, [], 0.25)).toBeNull();      // 1 ft off > 0.25 ft budget
    expect(simplifyRoadVertices(pts, [], 1.5)).not.toBeNull();
  });
});

describe("simplifyRoadVertices — junctions survive", () => {
  const pts = [P(0, 0), P(100, 0), P(200, 0), P(202, 0), P(204, 0), P(600, 0)];

  it("protects the vertex NEAREST a pin, so the tee keeps its node", () => {
    const r = simplifyRoadVertices(pts, [], ROAD_SIMPLIFY_TOL_FT, { pinned: [P(202, 0)] });
    expect(r.pts).toEqual([P(0, 0), P(202, 0), P(600, 0)]);
  });

  it("protects only ONE vertex per pin — the debris AROUND a junction still goes", () => {
    // All of 200/202/204 sit within a generous pin radius; only the nearest may survive.
    const r = simplifyRoadVertices(pts, [], ROAD_SIMPLIFY_TOL_FT, { pinned: [P(202, 0)], pinTolFt: 4 });
    expect(r.pts).toHaveLength(3);
    expect(r.pts[1]).toEqual(P(202, 0));
  });

  it("recognises a junction drawn with sub-foot slack when the pin radius allows it", () => {
    const r = simplifyRoadVertices(pts, [], ROAD_SIMPLIFY_TOL_FT, { pinned: [P(202.86, 0)], pinTolFt: 4 });
    expect(r.pts.some((p) => p.x === 202)).toBe(true);
  });

  it("endpoints are never dropped", () => {
    const r = simplifyRoadVertices(pts, [], 500);
    expect(r.pts[0]).toEqual(P(0, 0));
    expect(r.pts[r.pts.length - 1]).toEqual(P(600, 0));
  });

  it("leaves a deliberate SHARP vertex alone even where it contributes nothing", () => {
    const vtx = [{}, {}, { treatment: "sharp" }, {}, {}, {}];
    const r = simplifyRoadVertices(pts, vtx, ROAD_SIMPLIFY_TOL_FT);
    expect(r.pts.some((p) => p.x === 200)).toBe(true);
  });

  it("keeps pts and vtx index-aligned through the drop", () => {
    const vtx = [{}, { treatment: "arc", radius: 10 }, { treatment: "arc", radius: 99 }, {}, {}, {}];
    const r = simplifyRoadVertices(pts, vtx, ROAD_SIMPLIFY_TOL_FT, { pinned: [P(200, 0)] });
    expect(r.pts).toHaveLength(r.vtx.length);
    const at = r.pts.findIndex((p) => p.x === 200);
    expect(r.vtx[at].radius).toBe(99);                 // the surviving vertex kept ITS OWN treatment
  });
});

describe("simplifyRoadVertices — no churn", () => {
  it("returns null for an already-clean road (so a reload creates no new objects)", () => {
    expect(simplifyRoadVertices([P(0, 0), P(300, 0), P(300, 300)], [], ROAD_SIMPLIFY_TOL_FT)).toBeNull();
  });
  it("is idempotent — a simplified road simplifies no further", () => {
    const pts = [P(0, 0), P(100, 0), P(200, 0), P(600, 0)];
    const once = simplifyRoadVertices(pts, [], ROAD_SIMPLIFY_TOL_FT);
    expect(simplifyRoadVertices(once.pts, once.vtx, ROAD_SIMPLIFY_TOL_FT)).toBeNull();
  });
  it("no-ops on a 2-point road and on junk", () => {
    expect(simplifyRoadVertices([P(0, 0), P(10, 0)], [], 1.5)).toBeNull();
    expect(simplifyRoadVertices(null, [], 1.5)).toBeNull();
  });
});
