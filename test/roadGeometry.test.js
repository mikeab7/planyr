import { describe, it, expect } from "vitest";
import {
  roadCenterline, minRadiusOfCurvature, roadMinRadius, polylineLength,
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
