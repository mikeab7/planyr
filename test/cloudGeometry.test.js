import { describe, it, expect } from "vitest";
import {
  CLOUD_ARC_PRESETS, CLOUD_ARC_MIN_FT, CLOUD_ARC_MAX_FT, CLOUD_ARC_DEFAULT_FT,
  clampCloudArcFt, edgeScallopCount, cloudScallopPath, simplifyPath, cloudMetaDefaults,
  CLOUD_STATUS_OPTIONS,
} from "../src/workspaces/site-planner/lib/cloudGeometry.js";

describe("clampCloudArcFt", () => {
  it("passes a value already in range through unchanged", () => expect(clampCloudArcFt(3)).toBe(3));
  it("clamps below the floor", () => expect(clampCloudArcFt(0.01)).toBe(CLOUD_ARC_MIN_FT));
  it("clamps above the ceiling", () => expect(clampCloudArcFt(999)).toBe(CLOUD_ARC_MAX_FT));
  it("falls back to the default on garbage input", () => {
    expect(clampCloudArcFt(NaN)).toBe(CLOUD_ARC_DEFAULT_FT);
    expect(clampCloudArcFt(undefined)).toBe(CLOUD_ARC_DEFAULT_FT);
    expect(clampCloudArcFt("nope")).toBe(CLOUD_ARC_DEFAULT_FT);
  });
});

describe("edgeScallopCount — even distribution, remainder absorbed", () => {
  it("an edge that divides evenly gets exactly that many arcs", () => {
    expect(edgeScallopCount(12, 3)).toBe(2); // 12 / (2*3) = 2
  });
  it("an edge that does NOT divide evenly still gets a WHOLE arc count, never a leftover stub", () => {
    // 10ft edge, 3ft arcs → 10/6 = 1.67 → rounds to 2 arcs of 5ft chord each (not 1 arc of 6ft + a 4ft stub)
    const n = edgeScallopCount(10, 3);
    expect(n).toBe(2);
    const chord = 10 / n;
    expect(chord).toBeCloseTo(5, 6);
  });
  it("a very short edge still gets at least one arc", () => {
    expect(edgeScallopCount(0.2, 3)).toBe(1);
  });
  it("degenerate input returns 0", () => {
    expect(edgeScallopCount(0, 3)).toBe(0);
    expect(edgeScallopCount(10, 0)).toBe(0);
    expect(edgeScallopCount(-5, 3)).toBe(0);
  });
});

describe("cloudScallopPath", () => {
  const square = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];

  it("returns a closed path starting at the first vertex and ending with Z", () => {
    const d = cloudScallopPath(square, 3);
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
  });

  it("emits one arc command per scallop across the whole ring", () => {
    const d = cloudScallopPath(square, 3);
    const arcCount = (d.match(/A /g) || []).length;
    // 4 edges of 20ft each, arc 3ft → edgeScallopCount(20,3) = round(20/6) = 3 arcs/edge = 12 total
    expect(arcCount).toBe(4 * edgeScallopCount(20, 3));
  });

  it("every arc command carries the requested radius", () => {
    const d = cloudScallopPath(square, 3);
    const radii = [...d.matchAll(/A (\S+) (\S+) /g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(radii.length).toBeGreaterThan(0);
    for (const [rx, ry] of radii) { expect(rx).toBe(3); expect(ry).toBe(3); }
  });

  it("degenerate (< 3 point) input returns an empty string rather than a broken path", () => {
    expect(cloudScallopPath([{ x: 0, y: 0 }, { x: 1, y: 1 }], 3)).toBe("");
    expect(cloudScallopPath([], 3)).toBe("");
  });

  it("the sweep flag flips between a clockwise and a counter-clockwise ring (bulges stay outward)", () => {
    const cw = cloudScallopPath(square, 3);
    const ccw = cloudScallopPath([...square].reverse(), 3);
    const sweepOf = (d) => d.match(/A \S+ \S+ 0 0 (\d)/)[1];
    expect(sweepOf(cw)).not.toBe(sweepOf(ccw));
  });

  it("a triangle with one very short edge still closes the loop (one arc on the short edge, never a straight gap)", () => {
    const tri = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 0.1 }];
    const d = cloudScallopPath(tri, 3);
    expect(d.trim().endsWith("Z")).toBe(true);
    // 3 edges, each contributes >= 1 arc
    expect((d.match(/A /g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("simplifyPath (Ramer–Douglas–Peucker)", () => {
  it("collapses a dense, nearly-straight trail to just its endpoints", () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: Math.sin(i) * 0.01 })); // sub-tolerance noise
    const out = simplifyPath(pts, 0.5);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it("keeps a real corner that exceeds the tolerance", () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }];
    const out = simplifyPath(pts, 0.1);
    // the corner at (10,0) is a real turn and must survive
    expect(out.some((p) => p.x === 10 && p.y === 0)).toBe(true);
    expect(out.length).toBeLessThan(pts.length);
  });

  it("passes short input through unchanged", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplifyPath(pts, 1)).toEqual(pts);
  });

  it("a non-positive tolerance is a no-op", () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    expect(simplifyPath(pts, 0)).toEqual(pts);
  });
});

describe("cloudMetaDefaults", () => {
  it("stamps Bluebeam-parity metadata with Subject defaulting to 'Cloud' and Status 'None'", () => {
    const m = cloudMetaDefaults("2026-08-25T00:00:00.000Z", "Michael");
    expect(m.subject).toBe("Cloud");
    expect(m.status).toBe("None");
    expect(CLOUD_STATUS_OPTIONS).toContain(m.status);
    expect(m.author).toBe("Michael");
    expect(m.createdAt).toBe("2026-08-25T00:00:00.000Z");
    expect(m.modifiedAt).toBe("2026-08-25T00:00:00.000Z");
    expect(m.comment).toBe("");
    expect(m.label).toBe("");
    expect(m.layer).toBe("");
  });

  it("defaults author to 'You' when none is supplied", () => {
    expect(cloudMetaDefaults("2026-01-01T00:00:00.000Z").author).toBe("You");
  });
});

describe("presets", () => {
  it("Small < Medium < Large, all within the clamp range", () => {
    expect(CLOUD_ARC_PRESETS.small).toBeLessThan(CLOUD_ARC_PRESETS.medium);
    expect(CLOUD_ARC_PRESETS.medium).toBeLessThan(CLOUD_ARC_PRESETS.large);
    for (const v of Object.values(CLOUD_ARC_PRESETS)) {
      expect(v).toBeGreaterThanOrEqual(CLOUD_ARC_MIN_FT);
      expect(v).toBeLessThanOrEqual(CLOUD_ARC_MAX_FT);
    }
  });
});
