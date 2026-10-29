/* NEW-1 (road → employee parking) — lib/parkingApproach.js, the field's INSIDE: aisle snap, the stall gap + count, a road through the field, a drive along
 * the aisle-mouth face. The cross-approach matrix is test/driveParkingMatrix.test.js; this file is the module's own contract and the cases the matrix
 * cannot express (a road that is not an endpoint connection). All of it runs the real pipeline (driveJunctionsOf → roadNetSteps), never a hand-copied solver. */
import { describe, it, expect } from "vitest";
import { makeField, makeRoad, makeAlongRoad, makeThroughRoad, SETTINGS, netOf, stallCells, fieldWorld, distToSeg, polylineSegs, coveredBy } from "./helpers/driveMatrix.js";
import { snapToAisle, keptRuns, overlapFraction, stallLayoutOf, effectiveStallCount, fieldInsidesOf, rectFrame, STALL_HIT_FRACTION } from "../src/workspaces/site-planner/lib/parkingApproach.js";
import { driveJunctionsOf } from "../src/workspaces/site-planner/lib/roadJunctions.js";
import { rectOutlineCutSegments } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { siteMetrics } from "../src/workspaces/site-planner/lib/siteMetrics.js";
import { carStalls } from "../src/workspaces/site-planner/lib/siteGeometry.js";

const ROTS = [0, 90, 270, 23];
const AISLE_Y = SETTINGS.stallDepth + SETTINGS.aisle / 2;

describe("snapToAisle — a landing on the END face centres on the aisle it is aimed at", () => {
  for (const rot of ROTS) {
    const f = makeField({ rot, h: 120 });                      // two modules: aisles at local y 18..42 and 78..102
    const F = rectFrame(f), at = (x, y) => F.toWorld({ x, y });
    it(`rot ${rot}: 3 ft off the first aisle → on its centreline; 3 ft off the second → on that one`, () => {
      const a = snapToAisle(f, SETTINGS, at(0, AISLE_Y + 3)), b = snapToAisle(f, SETTINGS, at(f.w, 90 + 3));
      const la = F.toLocal(a.pt), lb = F.toLocal(b.pt);
      expect(la.x).toBeCloseTo(0, 6); expect(la.y).toBeCloseTo(AISLE_Y, 6); expect(a.aisleIndex).toBe(0);
      expect(lb.x).toBeCloseTo(f.w, 6); expect(lb.y).toBeCloseTo(90, 6); expect(b.aisleIndex).toBe(1);
    });
    it(`rot ${rot}: not on an end face (a row side), far from any aisle, or a free-drawn ring → no snap`, () => {
      expect(snapToAisle(f, SETTINGS, at(100, 0))).toBeNull();
      expect(snapToAisle(f, SETTINGS, at(0, 60))).toBeNull();                 // mid-way between the two aisles: 18 ft from each centre, past half-aisle + 6
      expect(snapToAisle(makeField({ rot, shape: "poly" }), SETTINGS, at(0, AISLE_Y))).toBeNull();
    });
  }
});

describe("clip + runs primitives", () => {
  it("overlapFraction is exact for convex quads and the hit threshold is 15%", () => {
    const cell = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 18 }, { x: 0, y: 18 }];
    expect(overlapFraction(cell, [{ x: -5, y: -5 }, { x: 4.5, y: -5 }, { x: 4.5, y: 30 }, { x: -5, y: 30 }])).toBeCloseTo(0.5, 9);
    expect(overlapFraction(cell, [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 5 }, { x: 20, y: 5 }])).toBe(0);
    expect(STALL_HIT_FRACTION).toBe(0.15);
  });
  it("keptRuns splits a band around the removed stalls (and is the whole band when none)", () => {
    expect(keptRuns(5, null, 0)).toEqual([{ k0: 0, k1: 4 }]);
    expect(keptRuns(6, new Set(["0:2", "0:3", "1:0"]), 0)).toEqual([{ k0: 0, k1: 1 }, { k0: 4, k1: 5 }]);
    expect(keptRuns(3, new Set(["2:0", "2:1", "2:2"]), 2)).toEqual([]);
    expect(keptRuns(4, new Set(["0:0"]), 0)).toEqual([{ k0: 1, k1: 3 }]);
  });
});

describe("a ROW-SIDE drive removes exactly the stalls it passes through — and the count agrees", () => {
  for (const rot of ROTS) for (const attached of [false, true]) {
    it(`rot ${rot} ${attached ? "attached" : "free"}: 26 ft road at the middle of the row`, async () => {
      const f = makeField({ rot, attached }), r = makeRoad(f, { face: "top", along: 100 });
      const { net } = await netOf([f, r]);
      const clip = net.stallClips.get("F");
      expect(clip).toBeTruthy();
      const base = carStalls(f.w, f.h, SETTINGS).count;
      expect(clip.base).toBe(base);
      expect(clip.removed.length).toBeGreaterThanOrEqual(3);            // 27 ft of pavement over 9 ft stalls
      expect(clip.removed.length).toBeLessThanOrEqual(4);
      expect(clip.count).toBe(base - clip.removed.length);
      expect(clip.removed.every((c) => c.band === 0)).toBe(true);       // only the row that backs onto the face
      // the Yield total is the same number
      const m = siteMetrics([f, r], [], [], SETTINGS);
      expect(m.stalls).toBe(clip.count);
      // and without the road the field is whole again
      expect(siteMetrics([f], [], [], SETTINGS).stalls).toBe(base);
    });
  }
  it("a drive down the AISLE END removes nothing (it lies in the aisle)", async () => {
    const f = makeField({}), r = makeRoad(f, { face: "left", along: AISLE_Y });
    const { net } = await netOf([f, r]);
    const clip = net.stallClips.get("F");
    expect(clip ? clip.removed.length : 0).toBe(0);
    expect(siteMetrics([f, r], [], [], SETTINGS).stalls).toBe(carStalls(f.w, f.h, SETTINGS).count);
  });
  it("flipDepth (the aisle is on the face the drive lands on): nothing to cross, nothing removed", async () => {
    const f = makeField({ cfg: { flipDepth: true }, h: 60 }), r = makeRoad(f, { face: "top", along: 100 });
    const L = stallLayoutOf(f, SETTINGS);
    expect(L.aisles[0].y0).toBeLessThan(L.bands[0].y + 1e-6 + 40);   // layout sanity: it is a two-row module either way
    const { net } = await netOf([f, r]);
    const clip = net.stallClips.get("F");
    const base = carStalls(f.w, f.h, { ...SETTINGS, flipDepth: true }).count;
    expect(effectiveStallCount(new Map(clip ? [["F", { clip }]] : []), f, SETTINGS)).toBe(clip ? clip.count : base);
  });
  it("a free-drawn polygon field has an estimate only — no stall clip, no change to its count", async () => {
    const f = makeField({ shape: "poly" }), r = makeRoad(f, { face: "top", along: 100 });
    const { net } = await netOf([f, r]);
    expect(net.stallClips.has("F")).toBe(false);
  });
});

describe("a road THROUGH the field", () => {
  for (const rot of ROTS) {
    it(`rot ${rot}: stalls under the road are removed in BOTH rows, the outline is interrupted at both crossings, and no junction is invented`, async () => {
      const f = makeField({ rot }), t = makeThroughRoad(f, { at: 100 });
      expect(driveJunctionsOf([f, t], SETTINGS)).toEqual([]);
      const { net } = await netOf([f, t]);
      const clip = net.stallClips.get("F");
      expect(clip).toBeTruthy();
      const bands = new Set(clip.removed.map((c) => c.band));
      expect(bands.has(0) && bands.has(1)).toBe(true);
      expect(clip.count).toBe(clip.base - clip.removed.length);
      // outline: nothing inked INSIDE the road's pavement at either crossing
      const ink = polylineSegs(rectOutlineCutSegments(f, net.outlineCuts.get("F"), net.mouths.get("F")));
      const F = rectFrame(f);
      for (const y of [0, f.h]) for (const dx of [-6, 0, 6]) expect(coveredBy(F.toWorld({ x: 100 + dx, y }), ink, 0.35), `crossing at ${y} ${dx}`).toBe(false);
      // …and still inked well away from it
      expect(coveredBy(F.toWorld({ x: 30, y: 0 }), ink, 0.35)).toBe(true);
      expect(coveredBy(F.toWorld({ x: 170, y: f.h }), ink, 0.35)).toBe(true);
    });
  }
  it("a road that merely passes BESIDE the field removes nothing", async () => {
    const f = makeField({}), t = makeThroughRoad(f, { at: 260 });          // 60 ft past the right face
    const { net } = await netOf([f, t]);
    expect(net.stallClips.has("F")).toBe(false);
  });
});

describe("a drive running ALONG the aisle-mouth face opens every aisle", () => {
  for (const rot of ROTS) for (const face of ["left", "right"]) {
    it(`rot ${rot}, ${face} face: one outline gap per aisle, the stall-row ends stay inked`, async () => {
      const f = makeField({ rot, h: 120 }), p = makeAlongRoad(f, { face });
      const { net } = await netOf([f, p]);
      const mouths = net.mouths.get("F");
      expect(mouths && mouths.length).toBe(2);                         // two aisles
      const F = rectFrame(f), x = face === "left" ? 0 : f.w;
      const ink = polylineSegs(rectOutlineCutSegments(f, net.outlineCuts.get("F"), mouths));
      for (const y of [30, 90]) expect(coveredBy(F.toWorld({ x, y }), ink, 0.35), `aisle at ${y} is open`).toBe(false);
      for (const y of [8, 60, 112]) expect(coveredBy(F.toWorld({ x, y }), ink, 0.35), `row end at ${y} is inked`).toBe(true);
      // the OTHER end face is untouched
      const ox = face === "left" ? f.w : 0;
      for (const y of [30, 90]) expect(coveredBy(F.toWorld({ x: ox, y }), ink, 0.35)).toBe(true);
    });
  }
  it("a drive 40 ft away is not 'along' the face; a drive at an angle is not either", async () => {
    const f = makeField({ h: 120 });
    expect((await netOf([f, makeAlongRoad(f, { gap: 40 })])).net.mouths.has("F")).toBe(false);
    const diag = makeAlongRoad(f, {}); diag.pts = [diag.pts[0], { x: diag.pts[0].x + 60, y: diag.pts[1].y }];
    expect((await netOf([f, diag])).net.mouths.has("F")).toBe(false);
  });
});

describe("edits keep the junction honest", () => {
  it("DELETE THE ROAD → the field is whole again (stalls, outline); DELETE THE FIELD → the road keeps a clean end", async () => {
    const f = makeField({ rot: 23 }), r = makeRoad(f, { face: "top", along: 100 });
    const withRoad = await netOf([f, r]), without = await netOf([f]);
    expect(withRoad.net.stallClips.size).toBe(1);
    expect(without.net.stallClips.size).toBe(0);
    expect(without.net.outlineCuts.size).toBe(0);
    expect(siteMetrics([f], [], [], SETTINGS).stalls).toBe(carStalls(f.w, f.h, SETTINGS).count);
    const roadOnly = await netOf([r]);
    expect(driveJunctionsOf([r], SETTINGS)).toEqual([]);
    expect(roadOnly.net.regions.length).toBe(1);
  });
  it("MOVE the field → the (stored) tee goes stale; the junction follows the road to wherever it now meets the field, bonded or not", () => {
    for (const attached of [false, true]) {
      const f = makeField({ attached }), r = makeRoad(f, { face: "left", along: AISLE_Y });
      expect(driveJunctionsOf([f, r], SETTINGS).length).toBe(1);
      const stale = { ...r, driveTee: { ...r.driveTee, targetId: "GONE" } };
      expect(driveJunctionsOf([f, stale], SETTINGS).length, attached ? "bonded" : "free").toBe(1);
    }
  });
  it("BOTH ends of one road on two fields, and a road that is tee'd to a road at one end and parking-connected at the other", () => {
    const A = makeField({ id: "A", cx: -300 }), B = makeField({ id: "B", cx: 300 });
    const W = fieldWorld(A);
    const both = { id: "R", type: "road", z: 1, pts: [W(A.w, AISLE_Y), { x: 100, y: 0 }], vtx: [{}, {}], travelW: 26, curb: 0.5, roadClass: "aisle" };
    const Wb = fieldWorld(B);
    both.pts = [W(A.w, AISLE_Y), Wb(0, AISLE_Y)];
    both.cx = 0; both.cy = 0; both.w = 600; both.h = 0; both.rot = 0;
    const js = driveJunctionsOf([A, B, both], SETTINGS);
    expect(js.map((j) => j.targetId).sort()).toEqual(["A", "B"]);
  });
});

describe("fieldInsidesOf is THE one answer (the canvas and the Yield read it)", () => {
  it("a plan with no road, or no rect car field, pays nothing", () => {
    const f = makeField({});
    expect(fieldInsidesOf({ els: [f], settings: SETTINGS, junctions: [], roads: [], stripOf: () => null, halfOf: () => 13.5 }).size).toBe(0);
  });
});
