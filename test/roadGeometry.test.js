import { describe, it, expect } from "vitest";
import {
  roadCenterline, minRadiusOfCurvature, roadMinRadius, polylineLength,
  insertRoadVertex, removeRoadVertex, canRemoveRoadVertex, curbStrokePx,
  findRoadConnect, roadsMergeCompatible, concatRoads, planRoadConnect, fixRoadRadii,
  teeGeometry, rectEdges, nearestRectEdge, weldCoverPolygon,
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

  // B961/NEW-3 — connect by reaching the visible pavement EDGE (curb line), not the hidden centerline.
  it("connects when the point reaches a wide road's EDGE, though it is outside centerline tolerance", () => {
    // Endpoint at (106,0); a road 40 ft wide (halfW 20) has its curb line 20 ft off the centerline.
    const wide = { id: "b", pts: [{ x: 106, y: 30 }, { x: 200, y: 30 }], halfW: 20 };
    // Query 24 ft below the centerline endpoint → only 4 ft from the curb edge. Centerline distance
    // (24) exceeds tolFt(6); edge distance (4) is within it → connects.
    const hit = findRoadConnect({ x: 106, y: 6 }, { id: "m", index: 1 }, [wide], { tolFt: 6 });
    expect(hit).toBeTruthy();
    expect(hit.roadId).toBe("b");
    expect(hit.kind).toBe("endpoint");
    expect(hit.pt).toEqual({ x: 106, y: 30 });     // still RESOLVES to the centerline point
    expect(hit.dist).toBeCloseTo(4);               // returned dist is EDGE-relative (24 - halfW 20)
  });

  it("with no halfW, the same far point does NOT connect (edge == centerline)", () => {
    const thin = { id: "b", pts: [{ x: 106, y: 30 }, { x: 200, y: 30 }] };   // halfW defaults 0
    expect(findRoadConnect({ x: 106, y: 6 }, { id: "m", index: 1 }, [thin], { tolFt: 6 })).toBeNull();
  });

  it("honors halfW on an interior (tee) edge hit too, still projecting onto the centerline", () => {
    const through = { id: "t", pts: [{ x: 0, y: 40 }, { x: 200, y: 40 }], halfW: 15 };
    // 22 ft below the centerline → 7 ft past the curb edge; within tolFt 8 → interior tee.
    const hit = findRoadConnect({ x: 100, y: 18 }, { id: "m", index: 1 }, [through], { tolFt: 8, allowInterior: true });
    expect(hit.kind).toBe("interior");
    expect(hit.pt.x).toBeCloseTo(100);
    expect(hit.pt.y).toBeCloseTo(40);              // projected onto the centerline, not the edge
    expect(hit.dist).toBeCloseTo(7);               // edge-relative (22 - halfW 15)
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

// ---------------------------------------------------------------------------------------
// B953/NEW-1 — clean T-intersection geometry at a road tee
// ---------------------------------------------------------------------------------------
const distToLine = (p, a, d) => Math.abs((p.x - a.x) * -d.y + (p.y - a.y) * d.x); // signed→abs perp dist to line (a,dir d)

describe("teeGeometry — clean tee (curb returns, width-capped)", () => {
  // Through road east-west through origin; side road tees in from the north.
  const base = { T: { x: 0, y: 0 }, throughDir: { x: 1, y: 0 }, sideDir: { x: 0, y: 1 }, phT: 12, phS: 12, R: 20, curbT: 0.5, curbS: 0.5 };

  it("perpendicular tee: throat widens to side width + 2R and returns are tangent to both edges", () => {
    const g = teeGeometry(base);
    expect(g).toBeTruthy();
    // throat opening ≈ 2*(phS + R) = 2*(12+20) = 64 (wider than the 24 ft side road)
    expect(g.throatWidth).toBeCloseTo(64, 3);
    expect(g.throatWidth).toBeGreaterThan(2 * base.phS);
    // through tangents sit on the through near edge (y = phT = 12); side tangents on the side edges (x = ±12)
    for (const p of g.throughTangents) expect(p.y).toBeCloseTo(12, 3);
    expect(g.sideTangents.map((p) => Math.abs(p.x)).sort()).toEqual([12, 12]);
    // each return arc runs from its through tangent to its side tangent (tangency)
    for (let i = 0; i < 2; i++) {
      const arc = g.returns[i];
      expect(arc.length).toBeGreaterThanOrEqual(2);
      const ends = [arc[0], arc[arc.length - 1]];
      // one end is on the through edge (y≈12), the other on a side edge (x≈±12)
      expect(ends.some((p) => Math.abs(p.y - 12) < 1e-3)).toBe(true);
      expect(ends.some((p) => Math.abs(Math.abs(p.x) - 12) < 1e-3)).toBe(true);
    }
  });

  it("B989: a small return is honored, but a large one is WIDTH-CAPPED (no runaway throat)", () => {
    // capW = max(2·phT, 2·phS) + 4 = 28; tMax = capW·0.9 = 25.2. A return whose tangent run fits
    // (R=10 → t=10 ≤ tMax) is honored exactly; a big one (R=40 → t=40) is clamped to the width cap.
    const capW = 2 * Math.max(base.phT, base.phS) + 4;
    const tMax = capW * 0.9;
    const small = teeGeometry({ ...base, R: 10 });
    const large = teeGeometry({ ...base, R: 40 });
    expect(small.throatWidth).toBeCloseTo(2 * (12 + 10), 2);           // small return honored
    expect(large.throatWidth).toBeGreaterThan(small.throatWidth);      // still grows with R…
    expect(large.throatWidth).toBeLessThanOrEqual(2 * (base.phS + tMax) + 1e-6); // …but only to the cap
    expect(large.throatWidth).toBeLessThan(2 * (12 + 40));             // NOT the raw 2·(phS+R) fan
  });

  it("flare widens the throat beyond the returns alone", () => {
    const noFlare = teeGeometry(base);
    const flared = teeGeometry({ ...base, flare: 10 });
    expect(flared.throatWidth).toBeGreaterThan(noFlare.throatWidth);
  });

  it("feasibility clamp: a short side road shrinks the returns (no runaway throat)", () => {
    const clamped = teeGeometry({ ...base, sideAvail: 8 });
    const free = teeGeometry(base);
    expect(clamped.R).toBeLessThan(free.R);
    expect(clamped.throatWidth).toBeLessThan(free.throatWidth);
  });

  it("acute tee still connects and degrades gracefully (finite, no NaN, positive throat)", () => {
    const acute = teeGeometry({ ...base, sideDir: unitv(2, 1) }); // ~27° from the through road
    expect(acute).toBeTruthy();
    for (const arc of acute.returns) for (const p of arc) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); }
    expect(acute.throatWidth).toBeGreaterThan(0);
    expect(acute.coverPolys.flat().every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it("returns null when the side road is parallel to the through road (not a tee)", () => {
    expect(teeGeometry({ ...base, sideDir: { x: 1, y: 0 } })).toBeNull();
  });

  it("B989: produces ONE simple mouth cover polygon spanning the junction (no seam+wedge trio)", () => {
    const g = teeGeometry(base);
    expect(g.coverPolys.length).toBe(1);                        // single mouth, not seam + 2 wedges
    const mouth = g.coverPolys[0];
    expect(mouth.length).toBeGreaterThanOrEqual(3);
    expect(mouth.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    // the mouth rounds out past the raw side strip (the two curb returns), so it spans wider than 2·phS
    const allX = mouth.map((p) => p.x);
    expect(Math.max(...allX) - Math.min(...allX)).toBeGreaterThan(2 * base.phS);
  });

  // B964 — the cover apron must be a SIMPLE, SMOOTH outline: NO spikes / pointed cusps (fold-back
  // vertices) and NO self-intersection (the old outA/outB "ears" folded the top edge back on itself,
  // making a star/blob). A curb return is legitimately CONCAVE where it rounds the reflex corner, so
  // we do NOT require convexity — we require no ~180° reversal at any vertex, and no crossing edges.
  const segCross = (p1, p2, p3, p4) => {
    const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  const isSimple = (ring) => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;      // skip shared-vertex/adjacent edges
        if (segCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return false;
      }
    }
    return true;
  };
  // B989 — the cover is ONE simple mouth polygon (up one fillet, straight along the drive edges to a
  // common height that buries the strip end-cap, then down the other fillet, back along the through/court
  // edge), NOT B971's seam band + two wedges. It must NOT self-intersect or fold back (that was the
  // wings/notch/pinch/spike the owner saw), at ANY angle including a hard skew.
  it("B989: the mouth cover is ONE SIMPLE polygon with NO fold-back cusp — road tee + car & truck drives + skew", () => {
    const cases = [
      teeGeometry(base),                                                   // road-to-road tee
      teeGeometry({ T: base.T, throughDir: base.throughDir, sideDir: base.sideDir, phT: 0, phS: 12, R: 20, curbT: 0.5, curbS: 0.5 }),   // car parking drive
      teeGeometry({ T: base.T, throughDir: base.throughDir, sideDir: base.sideDir, phT: 0, phS: 15, R: 50, curbT: 0.5, curbS: 0.5 }),   // truck-court drive (WB-62)
      teeGeometry({ T: base.T, throughDir: base.throughDir, sideDir: unitv(1, 2), phT: 0, phS: 15, R: 40, curbT: 0.5, curbS: 0.5 }),    // skewed drive
      teeGeometry({ T: base.T, throughDir: base.throughDir, sideDir: unitv(3, 1), phT: 0, phS: 15, R: 50, curbT: 0.5, curbS: 0.5 }),    // hard skew (~18°, glancing)
    ];
    for (const g of cases) {
      expect(g).toBeTruthy();
      expect(Array.isArray(g.coverPolys)).toBe(true);
      expect(g.coverPolys.length).toBe(1);                                 // ONE mouth
      const mouth = g.coverPolys[0];
      expect(mouth.length).toBeGreaterThanOrEqual(3);
      expect(mouth.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      expect(isSimple(mouth)).toBe(true);                                  // no self-intersecting edges (no star/blob/spike)
      // NB: maxFoldBack is deliberately NOT asserted on the mouth. A curb return meets the through/court
      // edge TANGENTIALLY at its two fillet endpoints (tan1A / tan1B), which reads as a ~180° reversal to
      // the fold-back metric but renders as a smooth tangent — exactly the B971 carve-out. isSimple (no
      // self-crossing) is the real "no wings/spike/star" guard here.
    }
  });

  it("B989: the mouth is WIDTH-CAPPED — a big return can't open a runaway fan", () => {
    const phS = 15, R = 50;
    const g = teeGeometry({ T: base.T, throughDir: base.throughDir, sideDir: base.sideDir, phT: 0, phS, R, curbT: 0.5, curbS: 0.5 });
    const xs = g.coverPolys[0].map((p) => p.x);
    const mouthW = Math.max(...xs) - Math.min(...xs);
    const capW = 2 * phS + 4;                                              // phT=0 → capW = 2·phS + margin
    // bounded by the drive + a ≈one-drive-width return each side (drive + 2·tMax), NOT the raw
    // 2·(phS+R)=130 ft "fan" the un-clamped return used to open.
    expect(mouthW).toBeLessThan(2 * (phS + capW));
    expect(mouthW).toBeLessThan(2 * (phS + R));
  });

  it("B964: each return arc is a single smooth (monotonic-turning) fillet — not a spiky path", () => {
    const g = teeGeometry({ T: base.T, throughDir: base.throughDir, sideDir: base.sideDir, phT: 0, phS: 15, R: 50, curbT: 0.5, curbS: 0.5 });
    for (const arc of g.returns) {
      expect(arc.length).toBeGreaterThanOrEqual(3);
      let sign = 0;
      for (let i = 1; i < arc.length - 1; i++) {
        const a = arc[i - 1], b = arc[i], c = arc[i + 1];
        const cz = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.abs(cz) < 1e-6) continue;
        const s = Math.sign(cz);
        if (sign === 0) sign = s; else expect(s).toBe(sign);               // turns the SAME way throughout ⇒ one clean convex arc
      }
    }
  });
});

function unitv(x, y) { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }

// ---------------------------------------------------------------------------------------
// B955/NEW-1 — road → parking-drive / truck-court connect (rect-edge targets)
// ---------------------------------------------------------------------------------------

describe("rectEdges — the 4 edges of a rect element", () => {
  it("axis-aligned rect: 4 edges with outward normals pointing away from centre", () => {
    const es = rectEdges(0, 0, 100, 40, 0);
    expect(es).toHaveLength(4);
    for (const e of es) {
      // outward normal points away from the centre (dot with centre→mid ≥ 0)
      expect(e.outN.x * e.mid.x + e.outN.y * e.mid.y).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.hypot(e.outN.x, e.outN.y)).toBeCloseTo(1, 6);
    }
    // edge lengths are the two side lengths
    const lens = es.map((e) => Math.round(e.len)).sort((a, b) => a - b);
    expect(lens).toEqual([40, 40, 100, 100]);
  });

  it("a rotated rect still yields unit outward normals and correct lengths", () => {
    const es = rectEdges(10, 5, 60, 20, 37);
    for (const e of es) expect(Math.hypot(e.outN.x, e.outN.y)).toBeCloseTo(1, 6);
    const lens = es.map((e) => Math.round(e.len)).sort((a, b) => a - b);
    expect(lens).toEqual([20, 20, 60, 60]);
  });
});

describe("nearestRectEdge — connect-target edge for a road endpoint", () => {
  const es = rectEdges(0, 0, 100, 40, 0); // rect spans x∈[-50,50], y∈[-20,20]

  it("picks the facing edge nearest the point and clamps onto the segment", () => {
    // A point above the top edge (y=+20 for this frame) → nearest facing edge is the top.
    const hit = nearestRectEdge({ x: 10, y: 60 }, es);
    expect(hit).toBeTruthy();
    expect(hit.pt.y).toBeCloseTo(20, 6);   // clamped onto the top edge
    expect(hit.pt.x).toBeCloseTo(10, 6);
    expect(hit.dist).toBeCloseTo(40, 6);
  });

  it("ignores edges the point is INSIDE of (facingOnly) — only outward edges qualify", () => {
    // A point off the right end: nearest facing edge is the right short edge (x=50).
    const hit = nearestRectEdge({ x: 80, y: 0 }, es);
    expect(hit.pt.x).toBeCloseTo(50, 6);
    expect(hit.pt.y).toBeCloseTo(0, 6);
  });

  it("clamps to the edge's corner when the point is beyond the segment end", () => {
    const hit = nearestRectEdge({ x: 90, y: 60 }, es);
    // nearest point is the top-right corner (50, 20)
    expect(hit.pt.x).toBeCloseTo(50, 6);
    expect(hit.pt.y).toBeCloseTo(20, 6);
  });
});

describe("teeGeometry reused for a road→drive connect (edge as 'through', no through curb)", () => {
  it("car-scale (parking) vs truck-scale (flared) returns: truck court reads wider", () => {
    // Target edge along +x at y=0 (a parking-field / court edge); road tees from the north. The truck
    // court's wider read comes from its throat FLARE (B989 caps the return radius itself to ≈one
    // drive-width, so the flare — not a runaway 50 ft radius — is what opens the dock-court mouth).
    const common = { T: { x: 0, y: 0 }, throughDir: { x: 1, y: 0 }, sideDir: { x: 0, y: 1 }, phT: 0, phS: 12, curbT: 0, curbS: 0.5 };
    const car = teeGeometry({ ...common, R: 20 });
    const truck = teeGeometry({ ...common, R: 50, flare: 20 });
    expect(car).toBeTruthy();
    expect(truck).toBeTruthy();
    expect(truck.throatWidth).toBeGreaterThan(car.throatWidth); // truck court reads much wider
    // returns are tangent to the target edge (y≈0) on one end
    for (const g of [car, truck]) for (const arc of g.returns) {
      const ends = [arc[0], arc[arc.length - 1]];
      expect(ends.some((p) => Math.abs(p.y) < 1e-3)).toBe(true);
    }
  });

  // B989 — the WIDTH cap now bounds the WB-62 ≈50 ft return to ≈one drive-width even on a ROOMY drive
  // (the owner's fix: throughAvail/sideAvail are the road LENGTHS, so the old length-only clamp left the
  // oblique return unbounded). A genuinely TIGHT run (shorter than the width cap) clamps it further still.
  it("B989: the return is WIDTH-CAPPED even on a roomy drive, and clamps FURTHER on a tight run", () => {
    const common = { T: { x: 0, y: 0 }, throughDir: { x: 1, y: 0 }, sideDir: { x: 0, y: 1 }, phT: 0, phS: 12, curbT: 0, curbS: 0.5, R: 50 };
    const roomy = teeGeometry({ ...common, throughAvail: 300, sideAvail: 300 });
    const tight = teeGeometry({ ...common, throughAvail: 10, sideAvail: 10 });
    const capW = 2 * 12 + 4;                                     // phT=0 → capW = 2·phS + margin
    expect(roomy).toBeTruthy();
    expect(tight).toBeTruthy();
    expect(roomy.R).toBeLessThan(50);                           // NOT the raw 50 — the width cap bites
    expect(roomy.R).toBeLessThanOrEqual(capW);                  // ≈ one drive-width (perpendicular ⇒ Rc = tMax ≤ capW)
    expect(tight.R).toBeLessThan(roomy.R);                      // a short run clamps further
    expect(tight.throatWidth).toBeLessThan(roomy.throatWidth);
  });
});

describe("weldCoverPolygon — seamless road-to-road weld patch (B960/NEW-2)", () => {
  const pointInRing = (p, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i].y, xi = ring[i].x, yj = ring[j].y, xj = ring[j].x;
      if (((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };

  it("collinear same-width weld → a patch straddling the join that covers the seam point", () => {
    // Road A runs in from the left (body neighbor at -x → dir +x toward P); road B runs in from
    // the right (dir -x). Both 25 ft edge-to-edge → halfW 12.5.
    const cover = weldCoverPolygon({ x: 0, y: 0 }, [
      { dir: { x: 1, y: 0 }, halfW: 12.5 },
      { dir: { x: -1, y: 0 }, halfW: 12.5 },
    ]);
    expect(cover).toBeTruthy();
    expect(cover.length).toBeGreaterThanOrEqual(4);
    expect(pointInRing({ x: 0, y: 0 }, cover)).toBe(true);      // the seam point is covered
    expect(pointInRing({ x: 0, y: 12 }, cover)).toBe(true);     // near-edge on the perpendicular seam covered
    // the patch extends a little into BOTH roads (not just one side)
    expect(pointInRing({ x: 3, y: 0 }, cover)).toBe(true);
    expect(pointInRing({ x: -3, y: 0 }, cover)).toBe(true);
  });

  it("bridges a width step: the wider road's full cross-section at the join is covered", () => {
    const cover = weldCoverPolygon({ x: 0, y: 0 }, [
      { dir: { x: 1, y: 0 }, halfW: 20 },     // wide road
      { dir: { x: -1, y: 0 }, halfW: 8 },     // narrow road
    ]);
    expect(cover).toBeTruthy();
    expect(pointInRing({ x: 0, y: 18 }, cover)).toBe(true);     // out to the wide road's half-width
  });

  it("miters a bent weld — the outer corner between two flat caps is filled", () => {
    // A comes from the west (dir +x), B leaves to the north (its body is north, dir −y toward P).
    const cover = weldCoverPolygon({ x: 0, y: 0 }, [
      { dir: { x: 1, y: 0 }, halfW: 10 },
      { dir: { x: 0, y: -1 }, halfW: 10 },
    ]);
    expect(cover).toBeTruthy();
    // the join point and a point just inside the wedge are covered (no open notch/seam)
    expect(pointInRing({ x: 0, y: 0 }, cover)).toBe(true);
  });

  it("returns null when under-specified (one arm, or zero width)", () => {
    expect(weldCoverPolygon({ x: 0, y: 0 }, [{ dir: { x: 1, y: 0 }, halfW: 10 }])).toBeNull();
    expect(weldCoverPolygon({ x: 0, y: 0 }, [
      { dir: { x: 1, y: 0 }, halfW: 0 }, { dir: { x: -1, y: 0 }, halfW: 0 },
    ])).toBeNull();
  });
});
