/* 2026-09-22 — a road's pavement ENDS at the court face, whatever paints on top.
 *
 * Until B1788912 (creation-order stacking) the road-into-pad junction relied on the PAD painting over
 * the road's overshoot, end cap and wedge cusp. These tests pin the geometry that replaced that
 * reliance: `dissolveRings(…, { subtract })` cuts the pad out of the painted region,
 * `regionEdgeSegments` leaves the mouth un-stroked, and `armStraightRun` stops a junction arm where
 * the road's own corner arc begins. */
import { describe, it, expect } from "vitest";
import { dissolveRings, regionEdgeSegments, polylinesPathD } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { pointInRing } from "../src/workspaces/site-planner/lib/ringMath.js";
import { armStraightRun, roadRunFrom } from "../src/workspaces/site-planner/lib/roadJunctions.js";
import { legShares } from "../src/workspaces/site-planner/lib/roadGeometry.js";

const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

describe("dissolveRings subtract — the pad is cut out of the road region", () => {
  // A 36 ft strip running from x=0 into a pad whose face is at x=100, overshooting 60 ft inside.
  const strip = rect(0, -18, 160, 18);
  const pad = rect(100, -200, 500, 200);
  it("leaves no pavement inside the pad and keeps everything outside it", () => {
    const [region] = dissolveRings([strip], { subtract: [pad] });
    expect(region).toBeTruthy();
    const xs = region.outer.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(100, 1);      // ends at the face
    expect(Math.min(...xs)).toBeCloseTo(0, 1);
    for (const p of region.outer) expect(p.x).toBeLessThanOrEqual(100 + 0.02);
    expect(pointInRing({ x: 130, y: 0 }, region.outer)).toBe(false);
    expect(pointInRing({ x: 50, y: 0 }, region.outer)).toBe(true);
  });
  it("without subtract the overshoot is still there (the control)", () => {
    const [region] = dissolveRings([strip]);
    expect(pointInRing({ x: 130, y: 0 }, region.outer)).toBe(true);
  });
  it("a strip lying wholly inside the pad dissolves to nothing rather than a phantom", () => {
    expect(dissolveRings([rect(120, -18, 160, 18)], { subtract: [pad] })).toEqual([]);
  });
});

describe("regionEdgeSegments — the mouth carries no curb line", () => {
  const strip = rect(0, -18, 160, 18);
  const pad = rect(100, -200, 500, 200);
  it("drops exactly the segment lying along the pad face and keeps the rest as open polylines", () => {
    const [region] = dissolveRings([strip], { subtract: [pad] });
    const lines = regionEdgeSegments(region, [pad]);
    const onFace = (a, b) => Math.abs(a.x - 100) < 0.05 && Math.abs(b.x - 100) < 0.05;
    for (const l of lines) for (let i = 0; i + 1 < l.length; i++) expect(onFace(l[i], l[i + 1])).toBe(false);
    // Every non-face segment of the outline survives: the two long edges and the far end cap.
    const total = lines.reduce((s, l) => s + l.length - 1, 0);
    expect(total).toBe(3);
    expect(polylinesPathD(lines, (p) => p)).toMatch(/^M/);
  });
  it("with no cutters the whole ring comes back closed", () => {
    const [region] = dissolveRings([strip]);
    const [only] = regionEdgeSegments(region, []);
    expect(only[0]).toEqual(only[only.length - 1]);
  });
});

describe("armStraightRun — an arm's straight run ends at the neighbouring corner's arc entry", () => {
  const settings = {};
  it("subtracts the next corner's tangent length on an interior leg", () => {
    // Node at index 3 of a 5-point road; the vertex before it (index 2) is a 90° arc corner of R 20
    // on a 26 ft leg → tangent 20, so only 6 ft of the leg is straight.
    const el = { type: "road", travelW: 36, roadClass: "aisle", pts: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 200 }, { x: 26, y: 200 }, { x: 200, y: 200 }],
      vtx: [{}, { treatment: "arc", radius: 20 }, { treatment: "arc", radius: 20 }, {}, {}] };
    const raw = roadRunFrom(el.pts, 3, -1, 18);
    const run = armStraightRun(el, 3, -1, settings, new Set([3]));
    expect(raw.dist).toBeGreaterThan(26);
    expect(run.dist).toBeCloseTo(6, 3);
  });
  it("leaves a leg that runs to a road END alone", () => {
    const el = { type: "road", travelW: 36, roadClass: "aisle", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }], vtx: [{}, {}] };
    expect(armStraightRun(el, 1, -1, settings).dist).toBeCloseTo(100, 6);
  });
  it("charges no tangent for a neighbouring vertex that is itself a junction node (sharpAt)", () => {
    const el = { type: "road", travelW: 36, roadClass: "aisle", pts: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 200 }, { x: 26, y: 200 }, { x: 200, y: 200 }],
      vtx: [{}, {}, { treatment: "arc", radius: 20 }, {}, {}] };
    expect(armStraightRun(el, 3, -1, settings, new Set([2, 3])).dist).toBeCloseTo(26, 3);
  });
});

describe("legShares — a shared leg is split by need", () => {
  it("both fit: each corner may take what the other does not need", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const vtx = [{}, { treatment: "arc", radius: 20 }, { treatment: "arc", radius: 30 }, {}];
    const sh = legShares(pts, vtx, 50);
    expect(sh[1].c).toBeCloseTo(1 - 30 / 100, 9);
    expect(sh[2].a).toBeCloseTo(1 - 20 / 100, 9);
    expect(sh[1].a).toBe(1); expect(sh[2].c).toBe(1);
  });
  it("both do not fit: pro rata, and the two tangents never overlap", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }];
    const vtx = [{}, { treatment: "arc", radius: 30 }, { treatment: "arc", radius: 10 }, {}];
    const sh = legShares(pts, vtx, 50);
    expect(sh[1].c + sh[2].a).toBeCloseTo(1, 9);
    expect(sh[1].c).toBeCloseTo(0.75, 9);
  });
  it("a sharp neighbour leaves the whole leg to the corner", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }];
    const vtx = [{}, { treatment: "arc", radius: 30 }, { treatment: "sharp" }, {}];
    expect(legShares(pts, vtx, 50)[1].c).toBe(1);
    expect(legShares(pts, [{}, { treatment: "arc", radius: 30 }, { treatment: "arc", radius: 30 }, {}], 50, [2])[1].c).toBe(1);
  });
});
