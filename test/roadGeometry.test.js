import { describe, it, expect } from "vitest";
import {
  roadCenterline, minRadiusOfCurvature, roadMinRadius, polylineLength,
  insertRoadVertex, removeRoadVertex, canRemoveRoadVertex, curbStrokePx,
  findRoadConnect, roadsMergeCompatible, concatRoads, planRoadConnect, fixRoadRadii,
} from "../src/workspaces/site-planner/lib/roadGeometry.js";
import {
  speedMinRadius, classMinRadius, classDefaultRadius, roadClassOf, ROAD_CLASS_SEEDS,
} from "../src/workspaces/site-planner/lib/roadClasses.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Shortest distance from point p to segment ab.
const distToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};
const contains = (poly, q, tol = 1e-6) => poly.some((p) => dist(p, q) <= tol);

describe("roadCenterline — degenerate + sharp", () => {
  it("returns a 2-point road unchanged (the legacy straight road)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const out = roadCenterline(pts, []);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[1]).toEqual({ x: 100, y: 0 });
  });

  it("sharp == polyline (output equals the input vertices)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const vtx = [{ treatment: "sharp" }, { treatment: "sharp" }, { treatment: "sharp" }];
    const out = roadCenterline(pts, vtx);
    expect(out).toHaveLength(3);
    expect(out).toEqual(pts);
  });

  it("drops fewer than 2 valid points to a trivial result", () => {
    expect(roadCenterline([], [])).toEqual([]);
    expect(roadCenterline([{ x: 1, y: 2 }], [])).toEqual([{ x: 1, y: 2 }]);
  });
});

describe("roadCenterline — arc fillet", () => {
  const A = { x: 0, y: 0 }, P = { x: 100, y: 0 }, C = { x: 100, y: 100 }; // 90° right turn
  const vtxArc = [{ treatment: "arc" }, { treatment: "arc", radius: 30 }, { treatment: "arc" }];

  it("rounds the corner: the vertex itself is NOT in the output, endpoints are", () => {
    const out = roadCenterline([A, P, C], vtxArc);
    expect(contains(out, A)).toBe(true);
    expect(contains(out, C)).toBe(true);
    expect(contains(out, P)).toBe(false); // corner is filleted away
  });

  it("is tangent to both adjacent segments (arc clears them by ~0)", () => {
    const out = roadCenterline([A, P, C], vtxArc);
    // The fillet's first/last dense points sit ON the two legs (tangency).
    const onLegAB = out.filter((q) => distToSeg(q, A, P) < 1e-6).length;
    const onLegBC = out.filter((q) => distToSeg(q, P, C) < 1e-6).length;
    expect(onLegAB).toBeGreaterThanOrEqual(1);
    expect(onLegBC).toBeGreaterThanOrEqual(1);
    // For a 90° turn, radius 30, the tangent run-up T = R·tan(45°) = 30, well within the
    // 50-ft half-segment, so the requested 30 is kept: min curvature radius ≈ 30.
    expect(roadMinRadius([A, P, C], vtxArc)).toBeCloseTo(30, 0);
  });

  it("feasibility-clamps the radius so the run-up never overruns a segment", () => {
    // Two SHORT 20-ft legs, a 90° turn, asking for an absurd 500-ft radius.
    const a = { x: 0, y: 0 }, p = { x: 20, y: 0 }, c = { x: 20, y: 20 };
    const vtx = [{}, { treatment: "arc", radius: 500 }, {}];
    const out = roadCenterline([a, p, c], vtx);
    // Every dense point stays within the two legs' bounding region (no spike past them):
    for (const q of out) {
      expect(distToSeg(q, a, p) < 20 + 1e-6 || distToSeg(q, p, c) < 20 + 1e-6).toBe(true);
    }
    // The tangent points must be within each 20-ft leg (run-up T ≤ half = 10 ft).
    const entryRun = Math.min(...out.map((q) => distToSeg(q, p, c) < 1e-6 ? dist(q, p) : Infinity));
    expect(entryRun).toBeLessThanOrEqual(10 + 1e-6);
  });

  it("a nearly-straight vertex keeps the corner sharp (no degenerate huge fillet)", () => {
    const a = { x: 0, y: 0 }, p = { x: 100, y: 0 }, c = { x: 200, y: 0.0001 };
    const out = roadCenterline([a, p, c], [{}, { treatment: "arc", radius: 40 }, {}]);
    expect(contains(out, p, 1e-3)).toBe(true); // passes straight through
  });
});

describe("roadCenterline — smooth (Catmull-Rom through-point)", () => {
  const A = { x: 0, y: 0 }, P = { x: 100, y: 50 }, C = { x: 200, y: 0 };
  const vtx = [{ treatment: "smooth" }, { treatment: "smooth" }, { treatment: "smooth" }];

  it("passes THROUGH its clicked points (interpolating, not approximating)", () => {
    const out = roadCenterline([A, P, C], vtx);
    expect(contains(out, A, 1e-6)).toBe(true);
    expect(contains(out, P, 1e-6)).toBe(true); // the through-point is on the curve
    expect(contains(out, C, 1e-6)).toBe(true);
  });

  it("actually curves (more points than the raw polyline) and stays bounded", () => {
    const out = roadCenterline([A, P, C], vtx);
    expect(out.length).toBeGreaterThan(5); // tessellated
    // Curve bows toward the through-point but does not fly outside a generous box.
    for (const q of out) {
      expect(q.x).toBeGreaterThanOrEqual(-1);
      expect(q.x).toBeLessThanOrEqual(201);
      expect(q.y).toBeGreaterThanOrEqual(-1);
      expect(q.y).toBeLessThanOrEqual(60);
    }
  });
});

describe("roadCenterline — tessellation density", () => {
  it("a sharp 90° arc is dense enough to read as smooth at working zoom", () => {
    const out = roadCenterline(
      [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }],
      [{}, { treatment: "arc", radius: 100 }, {}],
      { tessDeg: 6 },
    );
    // A 90° arc at 6°/step → ≥15 segments of arc + the two straight runs.
    expect(out.length).toBeGreaterThanOrEqual(15);
  });

  it("denser tessDeg yields more points", () => {
    const pts = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }];
    const vtx = [{}, { treatment: "arc", radius: 100 }, {}];
    const coarse = roadCenterline(pts, vtx, { tessDeg: 20 });
    const fine = roadCenterline(pts, vtx, { tessDeg: 2 });
    expect(fine.length).toBeGreaterThan(coarse.length);
  });
});

describe("minRadiusOfCurvature", () => {
  it("a straight line has infinite radius", () => {
    expect(minRadiusOfCurvature([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toBe(Infinity);
  });
  it("samples on a known circle recover its radius", () => {
    const R = 40, pts = [];
    for (let d = 0; d <= 90; d += 5) {
      const a = (d * Math.PI) / 180;
      pts.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
    }
    expect(minRadiusOfCurvature(pts)).toBeCloseTo(R, 1);
  });
  it("returns the TIGHTEST radius along a mixed alignment", () => {
    // A gentle 100-ft arc then a tight 20-ft arc — the min must be ~20.
    const tight = roadCenterline(
      [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 40 }, { x: 260, y: 40 }],
      [{}, { treatment: "arc", radius: 100 }, { treatment: "arc", radius: 20 }, {}],
    );
    expect(minRadiusOfCurvature(tight)).toBeLessThan(40);
  });
});

describe("polylineLength", () => {
  it("sums segment lengths", () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 14 }])).toBeCloseTo(15, 6);
  });
  it("is 0 for <2 points", () => {
    expect(polylineLength([{ x: 1, y: 1 }])).toBe(0);
  });
});

describe("roadClasses — civil thresholds", () => {
  it("speedMinRadius matches R = V²/[15(e+f)]", () => {
    // 25 mph, e=0.06, f=0.165 → 625 / (15·0.225) = 185.18…
    expect(speedMinRadius(25, 0.06, 0.165)).toBeCloseTo(185.19, 1);
    expect(speedMinRadius(0)).toBe(0);
  });
  it("classMinRadius reads the stored threshold, speed-derives the public class", () => {
    const truck = ROAD_CLASS_SEEDS.find((c) => c.key === "truck");
    expect(classMinRadius(truck)).toBe(50);
    const pub = ROAD_CLASS_SEEDS.find((c) => c.key === "public");
    expect(classMinRadius(pub)).toBeCloseTo(185.19, 1);
    const custom = ROAD_CLASS_SEEDS.find((c) => c.key === "custom");
    expect(classMinRadius(custom)).toBe(0); // no threshold
  });
  it("classDefaultRadius falls back to 50 when missing", () => {
    expect(classDefaultRadius({ defaultRadius: 120 })).toBe(120);
    expect(classDefaultRadius({})).toBe(50);
  });
  it("roadClassOf resolves a key, falling back to the default class", () => {
    expect(roadClassOf({}, "truck").key).toBe("truck");
    expect(roadClassOf({}, "nonsense").key).toBe("aisle"); // DEFAULT_ROAD_CLASS
  });
  it("settings.roadClasses overrides the seeds", () => {
    const s = { roadClasses: [{ key: "truck", label: "T", defaultRadius: 99, minRadius: 77 }] };
    expect(roadClassOf(s, "truck").defaultRadius).toBe(99);
    expect(classMinRadius(roadClassOf(s, "truck"))).toBe(77);
  });
});

describe("insertRoadVertex — control-point add (B718)", () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]; // 3-pt L
  const vtx = [{}, { treatment: "arc" }, {}];

  it("splices the point at edgeIndex+1 and a {} treatment at the SAME index", () => {
    const r = insertRoadVertex(pts, vtx, 0, { x: 50, y: 0 }); // split first segment
    expect(r).not.toBeNull();
    expect(r.index).toBe(1);
    expect(r.pts).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(r.vtx).toHaveLength(r.pts.length);          // arrays stay length-matched
    expect(r.vtx[1]).toEqual({});                        // new interior entry is empty ({} → arc)
    expect(r.vtx[0]).toEqual({});                        // endpoint untouched
    expect(r.vtx[3]).toEqual({});                        // last endpoint untouched
    expect(r.vtx[2]).toEqual({ treatment: "arc" });      // the old interior treatment shifted right
  });

  it("normalizes a short/absent vtx list to match pts", () => {
    const r = insertRoadVertex(pts, undefined, 1, { x: 100, y: 50 });
    expect(r.pts).toHaveLength(4);
    expect(r.vtx).toHaveLength(4);
    r.vtx.forEach((v) => expect(v).toEqual({}));
  });

  it("a point inserted on a straight (collinear) segment does not bend the alignment", () => {
    const straight = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    const r = insertRoadVertex(straight, [{}, {}], 0, { x: 100, y: 0 }); // on the line
    // new interior {} → treatmentAt = "arc", but collinear → arcCorner passes straight through
    const dense = roadCenterline(r.pts, r.vtx, { defaultRadius: 50 });
    dense.forEach((p) => expect(Math.abs(p.y)).toBeLessThan(1e-6)); // still on y=0 → no jump
  });

  it("returns null for an out-of-range edge index or a bad point", () => {
    expect(insertRoadVertex(pts, vtx, -1, { x: 1, y: 1 })).toBeNull();
    expect(insertRoadVertex(pts, vtx, 2, { x: 1, y: 1 })).toBeNull(); // 2 == pts.length-1, no segment after
    expect(insertRoadVertex(pts, vtx, 0, { x: NaN, y: 0 })).toBeNull();
    expect(insertRoadVertex([{ x: 0, y: 0 }], vtx, 0, { x: 1, y: 1 })).toBeNull();
  });
});

describe("removeRoadVertex / canRemoveRoadVertex — control-point delete (B718)", () => {
  const pts = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const vtx = [{}, { treatment: "arc" }, { treatment: "sharp" }, {}];

  it("removes an interior vertex from BOTH arrays, staying length-matched", () => {
    const r = removeRoadVertex(pts, vtx, 1);
    expect(r.pts).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(r.vtx).toEqual([{}, { treatment: "sharp" }, {}]);
    expect(r.vtx).toHaveLength(r.pts.length);
  });

  it("blocks removing an endpoint (index 0 or last) → null", () => {
    expect(removeRoadVertex(pts, vtx, 0)).toBeNull();
    expect(removeRoadVertex(pts, vtx, pts.length - 1)).toBeNull();
  });

  it("blocks dropping below 2 points → null", () => {
    const two = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(removeRoadVertex(two, [{}, {}], 0)).toBeNull();
    expect(removeRoadVertex(two, [{}, {}], 1)).toBeNull();
  });

  it("removing the sole interior of a 3-pt road yields a valid 2-pt straight road", () => {
    const three = [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 0 }];
    const r = removeRoadVertex(three, [{}, { treatment: "arc" }, {}], 1);
    expect(r.pts).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(r.vtx).toEqual([{}, {}]);
    expect(roadCenterline(r.pts, r.vtx)).toHaveLength(2); // renders as a straight road
  });

  it("canRemoveRoadVertex mirrors the guard (interior-only, above 2)", () => {
    expect(canRemoveRoadVertex(pts, 1)).toBe(true);
    expect(canRemoveRoadVertex(pts, 0)).toBe(false);
    expect(canRemoveRoadVertex(pts, pts.length - 1)).toBe(false);
    expect(canRemoveRoadVertex([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0)).toBe(false);
  });
});

describe("curbStrokePx — to-scale 6\" curb border (B719)", () => {
  it("returns curbFt*ppf when above the floor (scales proportionally with zoom)", () => {
    expect(curbStrokePx(0.5, 4, 0.75)).toBeCloseTo(2.0);   // zoomed in → thicker, to scale
    expect(curbStrokePx(1.0, 10, 0.75)).toBeCloseTo(10.0); // a 12" curb visibly doubles a 6"
  });
  it("floors to minPx when the true width goes sub-pixel (overview zoom)", () => {
    expect(curbStrokePx(0.5, 1, 0.75)).toBe(0.75); // 0.5px → floored
    expect(curbStrokePx(0.5, 0.3, 0.75)).toBe(0.75);
  });
  it("is defensive against non-finite inputs", () => {
    expect(curbStrokePx(undefined, 2, 0.75)).toBe(0.75);
    expect(curbStrokePx(0.5, NaN, 0.75)).toBe(0.75);
  });
});

// ---------------------------------------------------------------------------------------
// NEW-1 — snap-and-connect road endpoints
// ---------------------------------------------------------------------------------------
describe("findRoadConnect — endpoint / interior candidate search", () => {
  // Two separate roads; road B's near end sits ~6 ft from the query point.
  const roadA = { id: "a", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  const roadB = { id: "b", pts: [{ x: 106, y: 0 }, { x: 200, y: 0 }] };

  it("finds the nearest endpoint within tolerance", () => {
    const hit = findRoadConnect({ x: 100, y: 0 }, { id: "a", index: 1 }, [roadA, roadB], { tolFt: 10 });
    expect(hit).toBeTruthy();
    expect(hit.roadId).toBe("b");
    expect(hit.kind).toBe("endpoint");
    expect(hit.pt).toEqual({ x: 106, y: 0 });
  });

  it("returns null when nothing is within tolerance", () => {
    expect(findRoadConnect({ x: 100, y: 0 }, { id: "a", index: 1 }, [roadB], { tolFt: 3 })).toBeNull();
  });

  it("never snaps the moving vertex to itself, but allows the road's OTHER endpoint (loop close)", () => {
    const loop = { id: "a", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 5 }] };
    // dragging endpoint 0 near endpoint 2 (the last) of the same road → loop-close candidate
    const hit = findRoadConnect({ x: 100, y: 5 }, { id: "a", index: 0 }, [loop], { tolFt: 10 });
    expect(hit.roadId).toBe("a");
    expect(hit.index).toBe(2);
    // the excluded moving vertex itself is never returned
    const none = findRoadConnect({ x: 0, y: 0 }, { id: "a", index: 0 }, [loop], { tolFt: 3 });
    expect(none).toBeNull();
  });

  it("finds an interior (T-junction) point when allowInterior and it is the nearest", () => {
    const through = { id: "t", pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }] };
    const hit = findRoadConnect({ x: 100, y: 4 }, { id: "m", index: 1 }, [through], { tolFt: 10, allowInterior: true });
    expect(hit.kind).toBe("interior");
    expect(hit.pt.x).toBeCloseTo(100);
    expect(hit.pt.y).toBeCloseTo(0);
    expect(hit.index).toBe(0);
  });

  it("prefers an endpoint over an interior projection near that same endpoint", () => {
    const through = { id: "t", pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }] };
    const hit = findRoadConnect({ x: 2, y: 3 }, { id: "m", index: 1 }, [through], { tolFt: 10, allowInterior: true });
    expect(hit.kind).toBe("endpoint");   // the (0,0) end, not a tee just past it
    expect(hit.pt).toEqual({ x: 0, y: 0 });
  });

  it("nearest candidate wins on ties (closer road chosen)", () => {
    const near = { id: "near", pts: [{ x: 103, y: 0 }, { x: 150, y: 0 }] };
    const far = { id: "far", pts: [{ x: 108, y: 0 }, { x: 150, y: 20 }] };
    const hit = findRoadConnect({ x: 100, y: 0 }, { id: "m", index: 1 }, [near, far], { tolFt: 12 });
    expect(hit.roadId).toBe("near");
  });
});

describe("roadsMergeCompatible — same class + travel width + curb", () => {
  const base = { roadClass: "aisle", travelW: 24, curb: 0.5 };
  it("true for matching roads", () => {
    expect(roadsMergeCompatible(base, { ...base })).toBe(true);
  });
  it("false when the class differs", () => {
    expect(roadsMergeCompatible(base, { ...base, roadClass: "truck" })).toBe(false);
  });
  it("false when travel width or curb differs beyond tolerance", () => {
    expect(roadsMergeCompatible(base, { ...base, travelW: 30 })).toBe(false);
    expect(roadsMergeCompatible(base, { ...base, curb: 1.5 })).toBe(false);
  });
});

describe("concatRoads — merge two roads into one polyline", () => {
  it("A.last ↔ B.first: appends, shared point becomes an interior arc vertex", () => {
    const aPts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const bPts = [{ x: 100, y: 0 }, { x: 100, y: 100 }];
    const r = concatRoads(aPts, [{}, {}], 1, bPts, [{}, {}], 0, 40);
    expect(r.pts).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(r.vtx).toHaveLength(3);
    expect(r.joinIndex).toBe(1);
    expect(r.vtx[1]).toEqual({ treatment: "arc", radius: 40 });
    expect(r.vtx[0]).toEqual({});
    expect(r.vtx[2]).toEqual({});
  });

  it("A.last ↔ B.last: B is reversed so the alignment is continuous", () => {
    const aPts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const bPts = [{ x: 100, y: 100 }, { x: 100, y: 0 }]; // shared point is B's LAST
    const r = concatRoads(aPts, [{}, {}], 1, bPts, [{}, {}], 1, 40);
    expect(r.pts).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  });

  it("A.first ↔ B.first: A is reversed so its free end leads", () => {
    const aPts = [{ x: 100, y: 0 }, { x: 0, y: 0 }]; // shared point is A's FIRST
    const bPts = [{ x: 100, y: 0 }, { x: 100, y: 100 }];
    const r = concatRoads(aPts, [{}, {}], 0, bPts, [{}, {}], 0, 40);
    expect(r.pts).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(r.joinIndex).toBe(1);
  });

  it("preserves interior treatments through the concat", () => {
    const aPts = [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 0 }];
    const aVtx = [{}, { treatment: "smooth" }, {}];
    const bPts = [{ x: 100, y: 0 }, { x: 150, y: 0 }];
    const r = concatRoads(aPts, aVtx, 2, bPts, [{}, {}], 0, 40);
    expect(r.pts).toHaveLength(4);
    expect(r.vtx[1]).toEqual({ treatment: "smooth" }); // A's original interior kept
    expect(r.vtx[2]).toEqual({ treatment: "arc", radius: 40 }); // the new join vertex
  });

  it("returns null when an index is not an endpoint", () => {
    const aPts = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];
    expect(concatRoads(aPts, [{}, {}, {}], 1, [{ x: 100, y: 0 }, { x: 150, y: 0 }], [{}, {}], 0, 40)).toBeNull();
  });
});

describe("planRoadConnect — merge / weld / tee decision", () => {
  const aisleA = { id: "a", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }], vtx: [{}, {}], roadClass: "aisle", travelW: 24, curb: 0.5 };
  const aisleB = { id: "b", pts: [{ x: 100, y: 0 }, { x: 100, y: 100 }], vtx: [{}, {}], roadClass: "aisle", travelW: 24, curb: 0.5 };

  it("merges two matching roads meeting end-to-end", () => {
    const cand = { roadId: "b", kind: "endpoint", index: 0, pt: { x: 100, y: 0 } };
    const plan = planRoadConnect(aisleA, 1, aisleB, cand, 40);
    expect(plan.action).toBe("merge");
    expect(plan.deleteTarget).toBe(true);
    expect(plan.moving.pts).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  });

  it("welds (no merge) when the road classes differ", () => {
    const truckB = { ...aisleB, roadClass: "truck" };
    const cand = { roadId: "b", kind: "endpoint", index: 0, pt: { x: 100, y: 0 } };
    const plan = planRoadConnect(aisleA, 1, truckB, cand, 40);
    expect(plan.action).toBe("weld");
    expect(plan.deleteTarget).toBeUndefined();
    expect(plan.moving.pts[1]).toEqual({ x: 100, y: 0 }); // dragged endpoint welded exactly
  });

  it("welds when closing a loop on the same road (never merges with itself)", () => {
    const loop = { id: "a", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], vtx: [{}, {}, {}], roadClass: "aisle", travelW: 24, curb: 0.5 };
    const cand = { roadId: "a", kind: "endpoint", index: 2, pt: { x: 100, y: 100 } };
    const plan = planRoadConnect(loop, 0, loop, cand, 40);
    expect(plan.action).toBe("weld");
    expect(plan.moving.pts[0]).toEqual({ x: 100, y: 100 }); // endpoint 0 welded onto endpoint 2
  });

  it("tees an endpoint onto another road's interior, inserting a vertex on the through road", () => {
    const through = { id: "t", pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }], vtx: [{}, {}], roadClass: "aisle", travelW: 24, curb: 0.5 };
    const moving = { id: "m", pts: [{ x: 100, y: 50 }, { x: 100, y: 8 }], vtx: [{}, {}], roadClass: "aisle", travelW: 24, curb: 0.5 };
    const cand = { roadId: "t", kind: "interior", index: 0, pt: { x: 100, y: 0 } };
    const plan = planRoadConnect(moving, 1, through, cand, 40);
    expect(plan.action).toBe("tee");
    expect(plan.moving.pts[1]).toEqual({ x: 100, y: 0 });         // moving endpoint welded onto the centerline
    expect(plan.target.pts).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]); // vertex inserted
  });
});

// ---------------------------------------------------------------------------------------
// NEW-2 — auto-fix sub-minimum road radius
// ---------------------------------------------------------------------------------------
describe("fixRoadRadii — tier 1 (arc to the class target with room)", () => {
  it("bumps a too-tight arc up to meet the class minimum", () => {
    // A gentle bend with generous run-up but a small user arc radius (10 ft) → below a 50 ft min.
    const pts = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 800, y: 120 }];
    const vtx = [{}, { treatment: "arc", radius: 10 }, {}];
    expect(roadMinRadius(pts, vtx, { defaultRadius: 10 })).toBeLessThan(50);
    const res = fixRoadRadii(pts, vtx, 50, { targetRadius: 120 });
    expect(res.changed).toBe(true);
    expect(res.fixed).toContain(1);
    expect(res.residual).toHaveLength(0);
    expect(roadMinRadius(res.pts, res.vtx, { defaultRadius: 120 })).toBeGreaterThanOrEqual(50 - 1e-6);
  });

  it("leaves an already-compliant road unchanged", () => {
    const pts = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 800, y: 120 }];
    const vtx = [{}, { treatment: "arc", radius: 120 }, {}];
    const res = fixRoadRadii(pts, vtx, 50, { targetRadius: 120 });
    expect(res.changed).toBe(false);
    expect(res.fixed).toHaveLength(0);
  });

  it("leaves a deliberate SHARP corner alone (a hard corner is not a sub-min radius)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const vtx = [{}, { treatment: "sharp" }, {}];
    const res = fixRoadRadii(pts, vtx, 50, { targetRadius: 120 });
    expect(res.changed).toBe(false);
    expect(res.vtx[1].treatment).toBe("sharp");
  });

  it("no-ops on a straight 2-point road or when the class has no threshold", () => {
    expect(fixRoadRadii([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{}, {}], 50).changed).toBe(false);
    const pts = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 800, y: 120 }];
    expect(fixRoadRadii(pts, [{}, { treatment: "arc", radius: 5 }, {}], 0).changed).toBe(false);
  });
});

describe("fixRoadRadii — tier 3 nudge + tier 4 located residual", () => {
  it("nudges a pinched corner that an arc alone cannot open, and it then meets the minimum", () => {
    // A ~37°-deflection zag whose short arms cannot fit a 50 ft arc (feasible ≈19 ft), but a
    // bounded vertex nudge toward the A–C chord opens the corner enough to reach the minimum.
    const pts = [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 60, y: 0 }];
    const vtx = [{}, { treatment: "arc", radius: 50 }, {}];
    expect(roadMinRadius(pts, vtx, { defaultRadius: 50 })).toBeLessThan(50); // arc alone can't reach it
    const res = fixRoadRadii(pts, vtx, 50, { targetRadius: 120, maxNudgeFt: 60 });
    expect(res.changed).toBe(true);
    expect(res.fixed).toContain(1);
    // the interior vertex actually moved (a nudge happened)
    expect(res.pts[1]).not.toEqual({ x: 30, y: 40 });
    expect(roadMinRadius(res.pts, res.vtx, { defaultRadius: 120 })).toBeGreaterThanOrEqual(50 - 1e-3);
  });

  it("reports a LOCATED residual for a truly impossible pinch (tiny bound, no nudge room)", () => {
    const pts = [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 40, y: 0 }];
    const vtx = [{}, { treatment: "arc", radius: 50 }, {}];
    const res = fixRoadRadii(pts, vtx, 50, { targetRadius: 120, allowNudge: false });
    expect(res.residual.length).toBeGreaterThanOrEqual(1);
    expect(res.residual[0].index).toBe(1);
    expect(res.residual[0].reason).toMatch(/short/);
  });

  it("is a pure function — never mutates the caller's pts/vtx", () => {
    const pts = [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 60, y: 0 }]; // exercises the nudge path
    const vtx = [{}, { treatment: "arc", radius: 50 }, {}];
    const ptsCopy = JSON.parse(JSON.stringify(pts));
    const vtxCopy = JSON.parse(JSON.stringify(vtx));
    fixRoadRadii(pts, vtx, 50, { targetRadius: 120, maxNudgeFt: 60 });
    expect(pts).toEqual(ptsCopy);
    expect(vtx).toEqual(vtxCopy);
  });
});
