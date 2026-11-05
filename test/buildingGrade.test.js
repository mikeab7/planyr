// the Grading group's pure half: assembly membership, the earthwork tiles (read from the lattice the
// rows use), the flag in plain words, the three FFE bases, the two fix solvers, and the spot-elevation
// geometry. Synthetic grounds with closed-form answers, then the REAL Chehaw lattice.
import { describe, it, expect } from "vitest";
import {
  hostBuildingIdOf, assemblyIds, assemblyEarthwork, netLabel, describeFlag, shiftAssembly, withFfe,
  solveBalanced, findFfeFix, findMoveFix, runSync, runChunked, compass8, compassAbbr,
  spotElevationsFor, courtDropReadout, snapFfe, BALANCE_TOL_CY, padCorners, padCornerSpots, ringSf,
} from "../src/workspaces/site-planner/lib/buildingGrade.js";
import { buildProposedSurface } from "../src/workspaces/site-planner/lib/proposedSurface.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const rot = (ring, deg, c) => { const a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a); return ring.map((p) => ({ x: c.x + (p.x - c.x) * co - (p.y - c.y) * si, y: c.y + (p.x - c.x) * si + (p.y - c.y) * co })); };
const G = (setbackRings) => ({ pavementSlopePct: 1.5, lotDropFt: 0.5, slopeRatio: 2, shoulderFt: 5, setbackRings });
// ground rising to the east at 2%: z = 80 + 0.02 x
const hill = (pt) => 80 + 0.02 * pt.x;
const SB = rect(-400, -300, 1600, 900);

const scene = (bx = 300, by = 100) => ([
  { id: "b", type: "building", ring: rect(bx, by, 300, 200), padElevFt: 90 },
  { id: "c", type: "paving", ring: rect(bx, by + 200, 300, 100), dockStack: { x: bx + 150, y: by + 100 }, hostId: "b" },
  { id: "p1", type: "parking", ring: rect(bx, by - 60, 300, 60), hostId: "b" },
]);
const surf = (els, setback = SB, ground = hill) => buildProposedSurface({
  els, ffeFt: 90, dockDropFt: 4, existAt: ground, parcelRings: [rect(-450, -350, 1700, 1000)],
  grading: G([setback]), opts: { maxCells: 6000, minCellFt: 3 },
});

describe("membership + tiles", () => {
  it("hostBuildingIdOf climbs attachedTo through intermediate layers", () => {
    const byId = new Map([["b", { id: "b", type: "building" }], ["c", { id: "c", type: "paving", attachedTo: "b" }], ["t", { id: "t", type: "trailer", attachedTo: "c" }], ["x", { id: "x", type: "paving" }]]);
    expect(hostBuildingIdOf(byId.get("t"), byId)).toBe("b");
    expect(hostBuildingIdOf(byId.get("c"), byId)).toBe("b");
    expect(hostBuildingIdOf(byId.get("b"), byId)).toBe("b");
    expect(hostBuildingIdOf(byId.get("x"), byId)).toBeNull();
  });
  it("assemblyIds is the building plus the elements it hosts", () => {
    const ids = assemblyIds(scene().concat([{ id: "other", type: "building", ring: rect(0, 0, 10, 10) }]), "b");
    expect([...ids].sort()).toEqual(["b", "c", "p1"]);
  });
  it("tiles are read from the SAME lattice: one building ties to the earthwork rows to the cubic yard", () => {
    const s = surf(scene());
    const t = assemblyEarthwork(s.grid, assemblyIds(scene(), "b"));
    expect(t.cutCy).toBeCloseTo(s.grid.cutCy, 6);
    expect(t.fillCy).toBeCloseTo(s.grid.fillCy, 6);
    expect(Math.round(t.netCy)).toBe(Math.round(s.grid.fillCy - s.grid.cutCy));
  });
  it("two buildings: each assembly's tiles add up to the whole-plan rows", () => {
    const els = scene(300, 100).concat(scene(300, 100).map((e) => ({ ...e, id: e.id + "2", hostId: e.hostId ? "b2" : undefined, dockStack: e.dockStack ? { x: e.dockStack.x, y: e.dockStack.y + 700 } : undefined, ring: e.ring.map((p) => ({ x: p.x, y: p.y + 700 })) })));
    const s = surf(els);
    const a = assemblyEarthwork(s.grid, assemblyIds(els, "b")), b = assemblyEarthwork(s.grid, assemblyIds(els, "b2"));
    expect(a.cutCy + b.cutCy).toBeCloseTo(s.grid.cutCy, 4);
    expect(a.fillCy + b.fillCy).toBeCloseTo(s.grid.fillCy, 4);
  });
  it("net label: export / import / balanced under 500 CY", () => {
    expect(netLabel(-2000)).toBe("CY export"); expect(netLabel(2000)).toBe("CY import");
    expect(netLabel(499)).toBe("CY net, balanced"); expect(netLabel(-499)).toBe("CY net, balanced");
    expect(netLabel(500)).toBe("CY import");
  });
});

describe("compass", () => {
  it("north is up (−y), east is +x, in the planner's feet frame", () => {
    expect(compass8(0, -1)).toBe("north"); expect(compass8(1, 0)).toBe("east"); expect(compass8(0, 1)).toBe("south");
    expect(compass8(-1, 0)).toBe("west"); expect(compass8(1, -1)).toBe("north-east"); expect(compass8(-1, 1)).toBe("south-west");
    expect(compassAbbr("south-east")).toBe("SE");
  });
});

describe("the flag, in plain words", () => {
  // push the building toward the south setback line so the court's fill slope leaves it
  const SB2 = rect(-400, -300, 1600, 720);     // south line at y = 420
  it("names the side, the element, fill vs cut, and how far past the line", () => {
    const els = scene(300, 100);               // court spans y 300..400; fill slope reaches ~ past 460?
    const s = surf(els, SB2, () => 70);        // ground 20 ft BELOW the pad: tall fill, long reach
    const f = describeFlag(s, assemblyIds(els, "b"), { buildingCentre: { x: 450, y: 200 }, elements: els, slopeRatio: 2 });
    expect(f).not.toBeNull();
    expect(f.kind).toBe("fill");
    expect(f.side).toBe("South");
    expect(f.property).toBe(false);
    expect(f.element).toBe("the truck court");
    expect(f.over).toBeGreaterThan(5);
    expect(f.text.title).toBe("Slope crosses the setback · South");
    expect(f.text.body).toBe(`The fill slope off the truck court runs ${f.over} ft past the line at 2:1. Pick a fix:`);
  });
  it("nothing outside the setback → no flag", () => {
    const els = scene(300, 100);
    expect(describeFlag(surf(els, SB, () => 88), assemblyIds(els, "b"), { buildingCentre: { x: 450, y: 200 }, elements: els })).toBeNull();
  });
  it("says 'the property line' when the slope also crosses the parcel ring", () => {
    const els = scene(300, 100);
    const s = buildProposedSurface({ els, ffeFt: 90, dockDropFt: 4, existAt: () => 50, parcelRings: [rect(-450, -350, 1700, 760)], grading: G([rect(-400, -300, 1600, 700)]), opts: { maxCells: 6000, minCellFt: 3 } });
    const f = describeFlag(s, assemblyIds(els, "b"), { buildingCentre: { x: 450, y: 200 }, elements: els });
    expect(f.property).toBe(true);
    expect(f.text.title).toBe("Slope crosses the property line");
  });
});

describe("FFE bases", () => {
  const els = scene(300, 100);
  const ids = assemblyIds(els, "b");
  const at = (ffe) => surf(withFfe(els, "b", ffe));
  const net = (ffe) => { const s = at(ffe); return s ? s.grid.fillCy - s.grid.cutCy : null; };
  const dirt = (ffe) => { const s = at(ffe); return s ? s.grid.fillCy + s.grid.cutCy : null; };
  it("Balanced nets within 500 CY and is the 0.1-ft step closest to zero", () => {
    const r = runSync(solveBalanced(net, { lo: 70, hi: 120 }));
    expect(r.achieved).toBe(true);
    expect(Math.abs(r.netCy)).toBeLessThan(BALANCE_TOL_CY);
    expect(r.ffe * 10).toBeCloseTo(Math.round(r.ffe * 10), 9);   // the 0.1-ft grading convention
    // brute force over 0.5 steps in the window agrees to within one step
    let bf = null;
    for (let f = 80; f <= 100; f += 0.1) { const n = Math.abs(net(f)); if (!bf || n < bf.n) bf = { f, n }; }
    expect(Math.abs(r.ffe - bf.f)).toBeLessThanOrEqual(0.3);
  });
  it("ids reach the tiles: balanced FFE reads 'CY net, balanced' on the tile", () => {
    const f = runSync(solveBalanced(net, { lo: 70, hi: 120 })).ffe;
    const t = assemblyEarthwork(at(f).grid, ids);
    expect(netLabel(t.netCy)).toBe("CY net, balanced");
  });
  it("snapFfe rounds to the half-foot convention", () => {
    expect(snapFfe(793.74)).toBe(793.5); expect(snapFfe(793.76)).toBe(794);
  });
});

describe("the four pad-corner spots", () => {
  it("a quadrilateral pad uses its own corners; any other ring uses its oriented box", () => {
    const sq = rect(0, 0, 100, 60);
    expect(padCorners(sq)).toHaveLength(4);
    const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 60 }, { x: 0, y: 60 }];
    const cs = padCorners(L);
    expect(cs).toHaveLength(4);
    const xs = cs.map((c) => Math.round(c.x)), ys = cs.map((c) => Math.round(c.y));
    expect(Math.min(...xs)).toBe(0); expect(Math.max(...xs)).toBe(100); expect(Math.min(...ys)).toBe(0); expect(Math.max(...ys)).toBe(60);
  });
  it("cut where the ground is above the floor, fill where it is below, to a tenth", () => {
    const ring = rect(0, 0, 100, 100);
    const ground = (p) => 100 + (p.x > 50 ? 9.14 : -6.83);      // east corners 9.14 above a 100 ft floor... west 6.83 below
    const spots = padCornerSpots(ring, 100, ground);
    expect(spots).toHaveLength(4);
    const texts = spots.map((s) => s.text).sort();
    expect(texts).toEqual(["cut 9.1", "cut 9.1", "fill 6.8", "fill 6.8"]);
    expect(spots.find((s) => s.kind === "cut").depthFt).toBeCloseTo(9.14, 6);
  });
  it("a corner over a DEM void has no spot, and a corner on grade says so", () => {
    const ring = rect(0, 0, 100, 100);
    expect(padCornerSpots(ring, 100, (p) => (p.x > 50 ? null : 100))).toHaveLength(2);
    expect(padCornerSpots(ring, 100, () => 100).every((s) => s.text === "grade")).toBe(true);
    expect(padCornerSpots(ring, NaN, () => 100)).toEqual([]);
  });
  it("ringSf is the shoelace area", () => { expect(ringSf(rect(5, 5, 20, 30))).toBe(600); });
});

describe("the fix solvers", () => {
  const SB2 = rect(-400, -300, 1600, 720);
  const els = scene(300, 100);
  const ids = assemblyIds(els, "b");
  const ground = () => 72;
  const outOf = (e) => { const s = surf(e, SB2, ground); return s.grid.outside.count; };
  it("there is a flag to fix to begin with", () => { expect(outOf(els)).toBeGreaterThan(0); });
  it("FFE fix: the NEAREST clearing finish, and nothing nearer clears", () => {
    const clears = (ffe) => outOf(withFfe(els, "b", ffe)) === 0;
    const fix = runSync(findFfeFix(clears, 90));
    expect(fix).not.toBeNull();
    expect(clears(fix.ffe)).toBe(true);
    // every nearer step (either side) is still flagged
    const k = Math.round(Math.abs(fix.delta) / 0.5);
    for (let i = 1; i < k; i++) { expect(clears(90 + i * 0.5)).toBe(false); expect(clears(90 - i * 0.5)).toBe(false); }
    expect(fix.delta).toBeLessThan(0);   // lowering the pad shortens a fill slope
  });
  it("FFE fix gives up (null) when nothing within ±16 ft clears", () => {
    expect(runSync(findFfeFix(() => false, 90))).toBeNull();
  });
  it("Move fix: straight away from the offending cells, in 5 ft steps, and nothing shorter clears", () => {
    const s = surf(els, SB2, ground);
    const clearsAt = (dx, dy) => outOf(shiftAssembly(els, ids, dx, dy)) === 0;
    const fix = runSync(findMoveFix(clearsAt, { buildingCentre: { x: 450, y: 200 }, offendCentroid: s.grid.outside.centroid }));
    expect(fix).not.toBeNull();
    expect(fix.direction).toBe("north");           // the offending slope is south of the building → move north
    expect(fix.distFt % 5).toBe(0);
    expect(clearsAt(fix.dx, fix.dy)).toBe(true);
    expect(clearsAt(fix.dx * (fix.distFt - 5) / fix.distFt, fix.dy * (fix.distFt - 5) / fix.distFt)).toBe(false);
  });
  it("Move fix returns null when nothing within 240 ft clears (and never throws)", () => {
    expect(runSync(findMoveFix(() => false, { buildingCentre: { x: 0, y: 0 }, offendCentroid: { x: 0, y: 10 } }))).toBeNull();
    expect(runSync(findMoveFix(() => true, { buildingCentre: { x: 0, y: 0 }, offendCentroid: { x: 0, y: 0 } }))).toBeNull();
  });
  it("shiftAssembly moves rings AND the dock-stack anchor, and only the assembly", () => {
    const e2 = els.concat([{ id: "z", type: "building", ring: rect(0, 0, 10, 10) }]);
    const m = shiftAssembly(e2, ids, 10, -20);
    expect(m.find((e) => e.id === "c").dockStack).toEqual({ x: 460, y: 180 });
    expect(m.find((e) => e.id === "b").ring[0]).toEqual({ x: 310, y: 80 });
    expect(m.find((e) => e.id === "z").ring[0]).toEqual({ x: 0, y: 0 });
  });
});

describe("runChunked", () => {
  it("drives a generator to completion", async () => {
    function* g() { for (let i = 0; i < 5; i++) yield; return 42; }
    expect(await runChunked(g(), { sliceMs: 0 })).toBe(42);
  });
  it("abandons a superseded run", async () => {
    function* g() { for (let i = 0; i < 1000; i++) yield; return 1; }
    let stale = false; let n = 0;
    const p = runChunked(g(), { sliceMs: 0, isStale: () => { if (++n > 3) stale = true; return stale; } });
    expect(await p).toEqual({ stale: true });
  });
});

describe("spot elevations + fall arrows", () => {
  const dockDrop = 4;
  const mk = (deg) => {
    const c = { x: 450, y: 200 };
    const els = scene(300, 100).map((e) => ({ ...e, ring: rot(e.ring, deg, c), dockStack: e.dockStack ? rot([e.dockStack], deg, c)[0] : e.dockStack }));
    const s = buildProposedSurface({ els, ffeFt: 90, dockDropFt: dockDrop, existAt: hill, parcelRings: [], grading: G([SB]), opts: { maxCells: 6000, minCellFt: 3 } });
    return { els, s };
  };
  it("the court: dock face = FFE − drop, far edge = face − 1.5% × depth, ONE face spot, two stations on a 300 ft court", () => {
    const { els, s } = mk(0);
    const plane = s.planes.get("c");
    const sp = spotElevationsFor(plane, els.find((e) => e.id === "c").ring, (pt) => s.grid.zOf({ plane, el: els.find((e) => e.id === "c") }, pt));
    expect(sp.kind).toBe("court");
    expect(sp.face.label).toBe("dock 86.0");
    expect(sp.depthFt).toBeCloseTo(100, 6);
    expect(sp.stations).toHaveLength(2);
    expect(sp.stations[0].far.z).toBeCloseTo(86 - 1.5, 6);
    expect(courtDropReadout(sp)).toBe("86.0 → 84.5 ft");
    expect(sp.tag.text).toBe("1.5% fall");
  });
  it("a court wider than 400 ft gets three stations; the grade tag is skipped on anything under 90 ft deep", () => {
    const wide = { id: "w", type: "paving", ring: rect(0, 100, 500, 100), dockStack: { x: 250, y: 50 }, hostId: "b" };
    const shallow = { id: "s", type: "paving", ring: rect(0, 100, 500, 60), dockStack: { x: 250, y: 50 }, hostId: "b" };
    for (const [e, stations, tag] of [[wide, 3, true], [shallow, 3, false]]) {
      const els = [{ id: "b", type: "building", ring: rect(0, 0, 500, 100), padElevFt: 90 }, e];
      const s = buildProposedSurface({ els, ffeFt: 90, existAt: () => 80, parcelRings: [], grading: G([SB]), opts: { maxCells: 4000, minCellFt: 3 } });
      const sp = spotElevationsFor(s.planes.get(e.id), e.ring, (pt) => s.planes.get(e.id).zAt(pt));
      expect(sp.stations).toHaveLength(stations);
      expect(!!sp.tag).toBe(tag);
    }
  });
  it("a lot reads 'curb', starts at FFE − 0.5, and a narrow lot gets one station", () => {
    const { els, s } = mk(0);
    const plane = s.planes.get("p1");
    const sp = spotElevationsFor(plane, els.find((e) => e.id === "p1").ring, (pt) => plane.zAt(pt));
    expect(sp.kind).toBe("lot");
    expect(sp.face.label).toBe("curb 89.5");
    expect(sp.stations).toHaveLength(2);      // 300 ft wide > 200
  });
  it("ROTATION: every label point rotates with the building (the face spot stays on the wall, the far spots stay 'depth' off it)", () => {
    for (const deg of [0, 30, 90, 217]) {
      const { els, s } = mk(deg);
      const plane = s.planes.get("c"), ring = els.find((e) => e.id === "c").ring;
      const sp = spotElevationsFor(plane, ring, (pt) => plane.zAt(pt));
      const face = sp.world(sp.face.a, sp.face.b);
      const far = sp.world(sp.stations[0].far.a, sp.stations[0].b);
      // the far point is exactly `depth` from the face line along the plane's fall
      expect(Math.hypot(far.x - sp.world(sp.face.a, sp.stations[0].b).x, far.y - sp.world(sp.face.a, sp.stations[0].b).y)).toBeCloseTo(100, 6);
      // the face point is on the building's wall line
      const b = els.find((e) => e.id === "b").ring;
      const wall = plane.wall;
      expect((face.x - wall.A.x) * wall.n.x + (face.y - wall.A.y) * wall.n.y).toBeCloseTo(0, 6);
      // and the same elevations at every angle
      expect(sp.face.label).toBe("dock 86.0");
      void b;
    }
  });
});
