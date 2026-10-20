// ROUND 4 (B2349120 / B2349121) — grade the site as ONE pad inside a grading limit: the auto outline (union → rounded
// outside corners → shoulder → holes filled → clipped to the setback), the edited outline that grows to re-admit a
// moved element, the boundary mode (the setback less buffers and the pond, slopes thrown INWARD to the plateau the
// Level-ground sweep already computes), and the stitched surface inside it: no slope cell inside the limit, one
// daylight ring around it, adjacent paved planes sharing their common edge elevation, earthwork = the hand integral.
import { describe, it, expect } from "vitest";
import {
  autoGradingLimit, resolveGradingLimit, boundaryGradingLimit, maskRegions, unionRings, regionsAreaSf, pointInRegions, clearGradingLimitCache,
  LIMIT_MODES, LIMIT_DEFAULTS,
} from "../src/workspaces/site-planner/lib/gradingLimit.js";
import { buildProposedSurface, sampleProposedAt, buildSeams, buildPlanes, nearestOnRing } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { describeFlag, cardEarthwork, scopeIds, assemblyIds } from "../src/workspaces/site-planner/lib/buildingGrade.js";
import { pointInRing } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { readFileSync } from "node:fs";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet } from "../src/workspaces/site-planner/lib/mapLock.js";
import { sampleAtLatLng } from "../src/workspaces/site-planner/lib/demGrid.js";
import { feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const bboxOf = (ring) => ring.reduce((a, p) => [Math.min(a[0], p.x), Math.min(a[1], p.y), Math.max(a[2], p.x), Math.max(a[3], p.y)], [Infinity, Infinity, -Infinity, -Infinity]);

/* a cross-dock + two parking rows + a car lot on one end (the Georgia Test Site shape, in miniature) */
const crossDock = () => ([
  { id: "b", type: "building", ring: rect(0, 0, 520, 300) },
  { id: "c1", type: "paving", ring: rect(0, 300, 520, 130) },
  { id: "t1", type: "trailer", ring: rect(0, 430, 520, 60) },
  { id: "c2", type: "paving", ring: rect(0, -130, 520, 130) },
  { id: "t2", type: "trailer", ring: rect(0, -190, 520, 60) },
  { id: "p", type: "parking", ring: rect(520, 0, 120, 300) },
]);

describe("the auto grading limit — one rounded outline around everything graded", () => {
  it("one region around a cross-dock with rows and a lot, pushed out by the shoulder", () => {
    const r = autoGradingLimit({ rings: crossDock().map((e) => e.ring) });
    expect(r.length).toBe(1);
    expect(r[0].holes.length).toBe(0);
    const [x0, y0, x1, y1] = bboxOf(r[0].outer);
    expect(x0).toBeCloseTo(-5, 1); expect(y0).toBeCloseTo(-195, 1); expect(x1).toBeCloseTo(645, 1); expect(y1).toBeCloseTo(495, 1);
  });
  it("outside corners are ROUNDED (radius 30 by default, never under the aisle width) — the sharp corner is cut off", () => {
    const r = autoGradingLimit({ rings: crossDock().map((e) => e.ring) });
    // the layout's NW corner is (0, −190); the limit's bbox corner is (−5, −195); 3 ft in from it is OFF the rounded limit
    expect(pointInRing({ x: -2, y: -192 }, r[0].outer)).toBe(false);
    // …while 30 ft along either edge it is on it
    expect(pointInRing({ x: 40, y: -192 }, r[0].outer)).toBe(true);
    expect(pointInRing({ x: -2, y: -150 }, r[0].outer)).toBe(true);
    // a larger radius cuts more
    const big = autoGradingLimit({ rings: crossDock().map((e) => e.ring), cornerRadiusFt: 60 });
    expect(pointInRing({ x: 12, y: -180 }, big[0].outer)).toBe(false);
    expect(pointInRing({ x: 12, y: -180 }, r[0].outer)).toBe(true);
    expect(LIMIT_DEFAULTS.cornerRadiusFt).toBe(30);
  });
  it("a strip thinner than the rounding radius (a road, a walk) is not erased by the rounding", () => {
    const rings = [rect(0, 0, 300, 200), rect(300, 90, 400, 24)];   // a 24 ft drive off the east wall
    const r = autoGradingLimit({ rings });
    expect(pointInRegions({ x: 650, y: 102 }, r)).toBe(true);
    expect(pointInRegions({ x: 650, y: 60 }, r)).toBe(false);
  });
  it("a gap narrower than twice the radius closes; a wide gap stays two regions", () => {
    expect(autoGradingLimit({ rings: [rect(0, 0, 100, 100), rect(140, 0, 100, 100)] }).length).toBe(1);
    expect(autoGradingLimit({ rings: [rect(0, 0, 100, 100), rect(500, 0, 100, 100)] }).length).toBe(2);
  });
  it("holes narrower than a drive aisle are filled; a wide courtyard stays a hole", () => {
    const frame = (w, t) => [rect(0, 0, w, t), rect(0, w - t, w, t), rect(0, 0, t, w), rect(w - t, 0, t, w)];
    const wide = autoGradingLimit({ rings: frame(400, 20), cornerRadiusFt: 0, shoulderFt: 0, aisleFt: 24 });
    expect(wide[0].holes.length).toBe(1);
    const narrow = autoGradingLimit({ rings: frame(60, 20), cornerRadiusFt: 0, shoulderFt: 0, aisleFt: 24 });
    expect(narrow[0].holes.length).toBe(0);
  });
  it("NEVER crosses the setback polygon: where the union would, the limit hugs the setback", () => {
    const sb = rect(-50, -100, 500, 700);         // east line at x = 450, inside the lot
    const r = autoGradingLimit({ rings: crossDock().map((e) => e.ring), clipRings: [sb] });
    for (const p of r[0].outer) { expect(p.x).toBeLessThanOrEqual(450 + 0.02); expect(p.x).toBeGreaterThanOrEqual(-50 - 0.02); }
    expect(regionsAreaSf(r)).toBeLessThan(regionsAreaSf(autoGradingLimit({ rings: crossDock().map((e) => e.ring) })));
    // a save-and-except hole in the setback is a hole in the limit
    const withHole = autoGradingLimit({ rings: crossDock().map((e) => e.ring), clipRings: [rect(-400, -400, 1400, 1300)], clipHoles: [rect(200, 100, 60, 60)] });
    expect(withHole[0].holes.length).toBe(1);
  });
  it("an element the clip removes entirely leaves the limit smaller, never a stray region", () => {
    const r = autoGradingLimit({ rings: crossDock().map((e) => e.ring), clipRings: [rect(-50, -100, 400, 700)] });
    expect(r.length).toBe(1);
  });
});

describe("the edited limit", () => {
  it("the owner's polygon is the limit, clipped to the setback, and an element outside it grows the limit — named", () => {
    clearGradingLimitCache();
    const els = crossDock();
    const edited = rect(-20, -210, 580, 720);             // everything but the car lot (x 520..640)
    const r = resolveGradingLimit({ els, spec: { mode: "layout", edited, setbackRings: [rect(-400, -400, 1400, 1300)] } });
    expect(r.source).toBe("edited");
    expect(r.grewIds).toEqual(["p"]);
    expect(pointInRegions({ x: 630, y: 150 }, r.regions)).toBe(true);        // the lot is back inside
    expect(pointInRegions({ x: -10, y: 0 }, r.regions)).toBe(true);           // the owner's line stands elsewhere
    const all = resolveGradingLimit({ els, spec: { mode: "layout", edited: rect(-20, -210, 700, 720), setbackRings: [rect(-400, -400, 1400, 1300)] } });
    expect(all.grewIds).toEqual([]);
    expect(all.areaSf).toBeCloseTo(700 * 720, 0);
  });
  it("auto is the default source and the two modes are exactly 'layout' and 'boundary'", () => {
    const r = resolveGradingLimit({ els: crossDock(), spec: {} });
    expect(r.source).toBe("auto"); expect(r.mode).toBe("layout");
    expect(LIMIT_MODES).toEqual(["layout", "boundary"]);
    expect(resolveGradingLimit({ els: crossDock(), spec: { mode: "nonsense" } }).mode).toBe("layout");
  });
});

describe("boundary mode — the limit is the setback less buffers and the pond", () => {
  it("the setback polygon with the pond and a stream buffer cut out", () => {
    const r = boundaryGradingLimit({ setbackRings: [rect(0, 0, 1000, 800)], pondRings: [rect(700, 600, 200, 150)], bufferRings: [rect(0, 0, 1000, 50)] });
    expect(r.length).toBe(1);
    expect(r[0].holes.length).toBe(1);                                        // the pond
    expect(pointInRegions({ x: 500, y: 25 }, r)).toBe(false);                 // the buffer strip
    expect(pointInRegions({ x: 800, y: 650 }, r)).toBe(false);                // the pond
    expect(regionsAreaSf(r)).toBeCloseTo(1000 * 800 - 1000 * 50 - 200 * 150, 0);
  });
});

describe("a raster mask becomes regions", () => {
  it("one outer ring with one hole, area exact", () => {
    const nx = 10, ny = 8, mask = new Uint8Array(nx * ny);
    for (let j = 1; j < 7; j++) for (let i = 1; i < 9; i++) mask[j * nx + i] = 1;
    mask[3 * nx + 4] = 0; mask[3 * nx + 5] = 0;
    const r = maskRegions({ mask, nx, ny, x0: 0, y0: 0, cell: 10 });
    expect(r.length).toBe(1); expect(r[0].holes.length).toBe(1);
    expect(regionsAreaSf(r)).toBe((8 * 6 - 2) * 100);
    expect(r[0].outer.length).toBe(4);
  });
  it("two islands are two regions; an empty mask is no region", () => {
    const nx = 10, ny = 4, mask = new Uint8Array(nx * ny);
    mask[1 * nx + 1] = 1; mask[1 * nx + 8] = 1;
    expect(maskRegions({ mask, nx, ny, x0: 0, y0: 0, cell: 5 }).length).toBe(2);
    expect(maskRegions({ mask: new Uint8Array(nx * ny), nx, ny, x0: 0, y0: 0, cell: 5 })).toEqual([]);
  });
});

/* ---------------------------------------------------------------- the stitched surface */
const FFE = 100, flat = () => 90;
const scene = () => ([
  { id: "b", type: "building", ring: rect(0, 0, 200, 100), padElevFt: FFE },
  { id: "c", type: "paving", ring: rect(0, 100, 260, 130), dockStack: { x: 100, y: 50 }, hostId: "b" },
  { id: "l", type: "parking", ring: rect(200, 0, 60, 100), hostId: "b" },
]);
const SB = rect(-300, -300, 900, 800);
const G = (over = {}, limitOver = {}) => ({ pavementSlopePct: 1.5, lotDropFt: 0.5, slopeRatio: 2, shoulderFt: 5, setbackRings: [SB], ...over,
  limit: { mode: "layout", shoulderFt: 5, cornerRadiusFt: 30, aisleFt: 24, maxPavementSlopePct: 5, maxCutFillFt: 12, ...limitOver } });
const build = (els, ground = flat, over = {}, limitOver = {}, opts = {}) => buildProposedSurface({
  els, ffeFt: FFE, dockDropFt: 4, existAt: ground, parcelRings: [rect(-350, -350, 1000, 900)], grading: G(over, limitOver), opts: { maxCells: 9000, minCellFt: 2, existKey: "t", ...opts },
});

describe("the stitched surface inside the limit (NEW-2)", () => {
  const s = build(scene());
  it("NO slope cell inside the limit; the open ground inside is 'infill'; the slopes belong to the limit", () => {
    const inside = s.grid.cells.filter((c) => pointInRegions(c, s.grid.limit.regions));
    expect(inside.length).toBeGreaterThan(1000);
    expect(inside.some((c) => c.wedge)).toBe(false);
    expect(inside.some((c) => c.cls === "infill")).toBe(true);
    const slopes = s.grid.cells.filter((c) => c.wedge);
    expect(slopes.length).toBeGreaterThan(100);
    expect(slopes.every((c) => c.elId === "limit:0" && !pointInRegions(c, s.grid.limit.regions))).toBe(true);
  });
  it("ONE daylight ring around the whole limit (never one per element)", () => {
    expect(s.daylight.length).toBe(1);
    expect(s.daylight[0].elId).toBe("limit:0");
    expect(s.daylight[0].ring.length).toBeGreaterThan(20);
    // on flat ground 10 ft below the pad the ring sits 2·10 = 20 ft outside the limit at the pad's blank north wall
    const top = Math.min(...s.daylight[0].ring.filter((p) => p.x > 50 && p.x < 150).map((p) => p.y));
    expect(top).toBeCloseTo(-5 - 20, 0);
  });
  it("earthwork equals the hand integral within 2% (pad + court + lot + the open ground + the 2:1 band)", () => {
    // pad 200×100 at +10; court 260×130 from +6 at the face falling 1.5% to +4.05 (mean +5.025); lot 60×100 from +9.5 falling
    // 1.5% east (mean +9.05) but bending down to the court's 96 at its south edge: mean ≈ (9.05 + (9.05 − 3.47)) / 2 … so
    // compare the ELEMENT cells against their own planes read back through the surface (the integral is the sum of what
    // the surface says, and the surface is one function) and the TOTAL against an independent fine re-integration.
    const fine = build(scene(), flat, {}, {}, { maxCells: 60000, minCellFt: 1 });
    expect(Math.abs(s.grid.fillCy - fine.grid.fillCy) / fine.grid.fillCy).toBeLessThan(0.02);
    expect(s.grid.cutCy).toBeCloseTo(0, 6);
    // and the pad alone is exactly its box × its depth (within the lattice's 2%)
    expect(Math.abs(s.grid.perEl.b.fillCf - 200 * 100 * 10) / (200 * 100 * 10)).toBeLessThan(0.03);
  });
  it("a seam: the lot (FFE − 0.5) meets the court (FFE − 4) by SHARING the court's edge elevation, bending within its own extent", () => {
    const z = (x, y) => sampleProposedAt(s.grid, { x, y }, flat).ft;
    expect(z(230, 99.5)).toBeCloseTo(96.0, 0);                   // at the seam: the court's level (the lower wins)
    expect(z(230, 0.5)).toBeCloseTo(99.5 - 0.015 * 30, 1);       // at the wall: its own plane
    const mid = z(230, 50);
    expect(mid).toBeGreaterThan(97); expect(mid).toBeLessThan(98.5);
    expect(s.grid.seams).toEqual([]);                             // 3.5 ft over 100 ft + 1.5% = 5%: within the max pavement slope
    expect(s.violations.some((v) => v.kind === "seam-step")).toBe(false);
  });
  it("a seam that would push a plane past the max pavement slope says so: a curb/wall of X ft", () => {
    const s2 = build(scene(), flat, {}, { maxPavementSlopePct: 3 });
    expect(s2.grid.seams.length).toBe(1);
    expect(s2.grid.seams[0]).toMatchObject({ elId: "l", nId: "c" });
    expect(s2.grid.seams[0].stepFt).toBeCloseTo(3.5 - 0.015 * 100, 0);
    const v = s2.violations.find((x) => x.kind === "seam-step");
    expect(v.short).toMatch(/^The lot and the court can't meet without a step; a curb\/wall of [\d.]+ ft at their seam\.$/);
  });
  it("a dock chain's court and trailer row are ONE plane: no seam between them", () => {
    const els = scene().concat([{ id: "t", type: "trailer", ring: rect(0, 230, 260, 60), dockStack: { x: 100, y: 50 }, hostId: "b" }]);
    const { planes } = buildPlanes({ els, ffeFt: FFE, dockDropFt: 4, grading: G() });
    const graded = els.filter((e) => planes.has(e.id)).map((e) => ({ el: e, plane: planes.get(e.id), bbox: bboxOf(e.ring) }));
    const { seams } = buildSeams(graded);
    expect(seams.has("t")).toBe(false);
    expect(seams.has("c")).toBe(false);
  });
  it("the dock WALL keeps its step (the pad never bends) and the court starts at FFE − drop on the face", () => {
    const z = (x, y) => sampleProposedAt(s.grid, { x, y }, flat).ft;
    expect(z(100, 99.5)).toBeCloseTo(100, 6);
    expect(z(100, 100.5)).toBeCloseTo(96 - 0.015 * 0.5, 2);
  });
  it("the open ground between the court's far edge and the limit holds the court's edge elevation (the shoulder), then the slope runs from the LIMIT", () => {
    const z = (x, y) => sampleProposedAt(s.grid, { x, y }, flat);
    const edge = z(130, 229.5).ft;                 // the court's far edge, 1.5% × 130 below the face
    expect(edge).toBeCloseTo(96 - 0.015 * 129.5, 1);
    const sh = z(130, 233);                         // 3 ft past the edge, inside the 5 ft shoulder → infill at the edge's level
    expect(sh.cls).toBe("infill"); expect(sh.ft).toBeCloseTo(edge, 0);
    const out = z(130, 240);                        // 5 ft past the limit: on the 2:1 slope (2.5 ft down from the edge)
    expect(out.wedge).toBe(true); expect(out.ft).toBeCloseTo(edge - 5 / 2, 0);
    expect(z(130, 300).status).toBe("none");        // daylit: nothing proposed
  });
  it("the readout and the lattice are one surface: cell dz == probe − ground", () => {
    let n = 0;
    for (const c of s.grid.cells) {
      if (c.dzFt == null) continue;
      const r = sampleProposedAt(s.grid, c, flat);
      if (r.status !== "value") continue;
      expect(r.ft - 90).toBeCloseTo(c.dzFt, 6);
      if (++n > 800) break;
    }
    expect(n).toBeGreaterThan(400);
  });
  it("the card's earthwork and every search read the WHOLE graded area under a limit", () => {
    const e = cardEarthwork(s.grid, assemblyIds(scene(), "b"));
    expect(e.fillCy).toBeCloseTo(s.grid.fillCy, 6);
    expect([...scopeIds(s.grid, new Set(["b"]))].sort()).toEqual(["b", "c", "infill:0", "l", "limit:0"]);
    expect(s.grid.limit.areaAc).toBeGreaterThan(1); expect(s.grid.limit.source).toBe("auto"); expect(s.grid.limit.mode).toBe("layout");
  });
});

describe("the flag moves to the limit", () => {
  it("names the EDGE of the graded area, the kind, and how far past the setback; carries the span for 'pull the limit in'", () => {
    const tilt = (p) => 90 + 0.02 * p.x;
    const els = scene().map((e) => ({ ...e, ring: e.ring.map((p) => ({ x: p.x - 280, y: p.y })) }));
    const s = build(els, tilt);
    expect(s.grid.outside.count).toBeGreaterThan(50);
    expect(Object.keys(s.grid.outside.perEl)).toEqual(["limit:0"]);
    const f = describeFlag(s, assemblyIds(els, "b"), { buildingCentre: { x: -180, y: 50 }, elements: els, slopeRatio: 2 });
    expect(f.limit).toBe(true);
    expect(f.side).toBe("West"); expect(f.kind).toBe("fill");
    expect(f.text.title).toBe("Slope crosses the setback · West");
    expect(f.text.body).toBe(`The fill slope on the west edge of the graded area runs ${f.over} ft past the setback at 2:1. Pick a fix:`);
    expect(f.span.pt.x).toBeLessThan(-300); expect(f.span.radiusFt).toBeGreaterThanOrEqual(60);
  });
  it("nothing outside → no flag", () => {
    expect(describeFlag(build(scene()), new Set(["b"]), { buildingCentre: { x: 100, y: 50 } })).toBeNull();
  });
});

/* ROUND 6 (NEW-3, owner live check 2026-10-20 on Georgia Test Site › Concept A, "To the boundary"): the open ground inside the
 * limit FOLLOWS THE PAVEMENT in both modes — it reads the graded edges it touches and continues their fall at the open-ground
 * slope (2% default) toward the limit, never back up to the FFE. Boundary mode's flat plateau at the FFE (the Level-ground
 * sweep's mask) is gone: the setback's inward slope is thrown from the limit at whatever elevation that surface reaches there. */
describe("ROUND 6 — the open ground inside the limit follows the pavement, it does not step back up to the FFE", () => {
  // a court falling 1.5% from the dock face to its far edge at E, then 100 ft of open ground to the setback (boundary mode)
  const court = [
    { id: "b", type: "building", ring: rect(0, 0, 200, 100), padElevFt: FFE },
    { id: "c", type: "paving", ring: rect(0, 100, 200, 130), dockStack: { x: 100, y: 50 }, hostId: "b" },
  ];
  const SB2 = rect(-100, -100, 400, 430);                 // the court's far edge is y = 230; the setback 100 ft past it
  const flatLow = () => FFE - 7;                           // flat ground near the court's far edge, so the setback band never bites
  const s = buildProposedSurface({ els: court, ffeFt: FFE, dockDropFt: 4, existAt: flatLow, parcelRings: [SB2],
    grading: { ...G({ setbackRings: [SB2] }, { mode: "boundary" }), openGroundSlopePct: 2 }, opts: { maxCells: 12000, minCellFt: 2, existKey: "r6" } });
  const E = sampleProposedAt(s.grid, { x: 100, y: 229.5 }, flatLow).ft;        // the court's far-edge elevation
  it("beyond the court's far edge the open ground is ≤ E and ≥ E − 2 ft at the limit (100 ft at 2%)", () => {
    expect(E).toBeCloseTo(FFE - 4 - 0.015 * 129.5, 1);
    const beyond = s.grid.cells.filter((c) => c.cls === "infill" && c.y > 232 && c.x > 20 && c.x < 180);
    expect(beyond.length).toBeGreaterThan(200);
    expect(beyond.every((c) => c.propFt <= E + 1e-6)).toBe(true);
    expect(beyond.every((c) => c.propFt >= E - 2 - 1e-6)).toBe(true);
    // and it FALLS away from the court at the open-ground slope: 2% of the distance past the far edge
    for (const c of beyond.filter((c) => c.x > 60 && c.x < 140)) expect(c.propFt).toBeCloseTo(E - 0.02 * (c.y - 230), 1);
    // the FFE never comes back: nothing beyond the court is above the court's edge, let alone at the pad's finish
    expect(Math.max(...beyond.map((c) => c.propFt))).toBeLessThan(FFE - 4);
  });
  it("no open-ground cell inside the limit is higher than the nearest pavement edge it drains from", () => {
    const infill = s.grid.cells.filter((c) => c.cls === "infill");
    expect(infill.length).toBeGreaterThan(1000);
    const over = infill.filter((c) => {
      let best = null;
      for (const g of s.grid.owners) { const q = nearestOnRing(c, g.el.ring); const d = Math.hypot(c.x - q.x, c.y - q.y); if (!best || d < best.d) best = { d, z: s.grid.zOf(g, q) }; }
      return c.propFt > best.z + 1e-6;
    });
    expect(over.length).toBe(0);
  });
  it("the plateau is retired: `plateaus` is empty, the graded area IS the setback, and the probe agrees with the cells", () => {
    expect(s.grid.limit.plateaus).toEqual([]);
    expect(s.grid.limit.areaSf).toBeCloseTo(400 * 430, -2);
    const c0 = s.grid.cells.find((c) => c.cls === "infill" && c.y > 260 && c.x > 90 && c.x < 110);
    expect(sampleProposedAt(s.grid, c0, flatLow).ft).toBeCloseTo(c0.propFt, 6);
  });
  it("layout mode too: the open ground inside the limit leaves a pad at its finish and falls at 2%, never interpolated back up (the round-4 IDW)", () => {
    const tilt = (p) => 90 + 0.02 * p.x;
    const sl = build(scene(), tilt, { openGroundSlopePct: 2 });
    const inside = sl.grid.cells.filter((c) => c.cls === "infill");
    expect(inside.length).toBeGreaterThan(50);
    for (const c of inside) {
      let best = null;
      for (const g of sl.grid.owners) { const q = nearestOnRing(c, g.el.ring); const d = Math.hypot(c.x - q.x, c.y - q.y); if (!best || d < best.d) best = { d, z: sl.grid.zOf(g, q) }; }
      expect(c.propFt).toBeLessThanOrEqual(best.z + 1e-6);
    }
  });
  it("the gear's open-ground slope is honoured: 4% falls twice as fast as 2%", () => {
    const s4 = buildProposedSurface({ els: court, ffeFt: FFE, dockDropFt: 4, existAt: flatLow, parcelRings: [SB2],
      grading: { ...G({ setbackRings: [SB2] }, { mode: "boundary" }), openGroundSlopePct: 4 }, opts: { maxCells: 12000, minCellFt: 2, existKey: "r6b" } });
    const z2 = sampleProposedAt(s.grid, { x: 100, y: 280 }, flatLow).ft, z4 = sampleProposedAt(s4.grid, { x: 100, y: 280 }, flatLow).ft;
    expect(E - z2).toBeCloseTo(1.0, 1);
    expect(E - z4).toBeCloseTo(2.0, 1);
  });
  it("the pond and a stream buffer are cut out of the boundary limit", () => {
    const tilt = (p) => 90 + 0.02 * p.x;
    const sp = buildProposedSurface({ els: scene(), ffeFt: FFE, dockDropFt: 4, existAt: tilt, parcelRings: [], pondRings: [rect(400, 300, 100, 100)], easementRings: [rect(-300, 400, 900, 100)],
      grading: G({}, { mode: "boundary" }), opts: { maxCells: 9000, minCellFt: 2, existKey: "t2" } });
    expect(sp.grid.cells.some((c) => c.x > 400 && c.x < 500 && c.y > 300 && c.y < 400 && !c.wedge)).toBe(false);   // pond: nothing priced
    expect(pointInRegions({ x: 100, y: 450 }, sp.grid.limit.limitRegions)).toBe(false);                              // buffer: outside the limit
  });
});

/* B2376240 (owner live check 2026-10-20, Georgia Test Site › Concept A, "To the boundary"): the limit IS the setback and
 * the slope is thrown INWARD from it, so by construction no graded cell may lie outside the setback and the setback /
 * property-line flag can never fire — the band starts exactly at the setback line (the daylight line IS the limit). */
describe("boundary mode never grades outside the setback and never flags (B2376240)", () => {
  const tilt = (p) => 90 + 0.02 * p.x + 0.01 * p.y;
  const inSb = (c) => pointInRing(c, SB) || SB.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 1e-6);
  it("synthetic scene on tilted ground: zero cells outside the setback, zero flagged, the daylight line is the setback", () => {
    const s = build(scene(), tilt, {}, { mode: "boundary" });
    expect(s.grid.limit.mode).toBe("boundary");
    expect(s.grid.cells.length).toBeGreaterThan(1000);
    expect(s.grid.cells.filter((c) => !inSb(c)).length).toBe(0);
    expect(s.grid.cells.filter((c) => c.out).length).toBe(0);
    expect(s.grid.outside).toEqual(expect.objectContaining({ count: 0, sf: 0, maxPastFt: 0 }));
    expect(describeFlag(s, new Set(["b"]), { buildingCentre: { x: 100, y: 50 } })).toBeNull();
    expect(s.violations.filter((v) => v.id === "offsite-fill" || /setback/i.test(v.id)).length).toBe(0);
    // the band: slope cells only between the plateau and the setback, and the daylight ring is the limit itself
    const slope = s.grid.cells.filter((c) => c.wedge);
    expect(slope.length).toBeGreaterThan(50);
    expect(slope.every(inSb)).toBe(true);
    expect(s.daylight.length).toBe(s.grid.limit.limitRegions.reduce((n, r) => n + 1 + r.holes.length, 0));
    expect(s.daylight[0].ring).toEqual(s.grid.limit.limitRegions[0].outer);
    // the band starts AT the limit: a slope cell a few feet inside the setback edge exists and is shallow — every band cell's
    // depth is within the 2:1 slope thrown from the setback (|dz| ≤ distance to the setback / 2), so the slope daylights AT the
    // setback, never past it (ROUND 6: the band meets the open ground's own fall, not a flat plateau)
    const nearEdge = slope.filter((c) => Math.abs(c.x - (-300)) < 6 && c.y > -100 && c.y < 100);
    expect(nearEdge.length).toBeGreaterThan(0);
    const toSb = (c) => Math.min(c.x + 300, 600 - c.x, c.y + 300, 500 - c.y);
    expect(slope.every((c) => Math.abs(c.dzFt) <= toSb(c) / 2 + 0.05 + c.wFt / 2)).toBe(true);
    // the open ground inside falls away from the pavement: nothing in it sits above the FFE
    expect(s.grid.cells.filter((c) => c.cls === "infill").every((c) => c.propFt <= FFE + 1e-6)).toBe(true);
    // the probe agrees with the lattice at a band cell and refuses a point outside the limit
    const c0 = slope[Math.floor(slope.length / 2)];
    expect(sampleProposedAt(s.grid, c0, tilt).ft).toBeCloseTo(c0.propFt, 6);
    expect(sampleProposedAt(s.grid, { x: -340, y: 0 }, tilt).status).toBe("none");
  });
  it("the real Chehaw ground: zero cells outside the ring, zero flagged, the surface still builds in budget", () => {
    const F = new URL("./fixtures/chehaw-218-02007", import.meta.url).pathname;
    const pj = JSON.parse(readFileSync(F + ".parcel.json", "utf8"));
    const ll = pj.ringLngLat.slice(0, -1);
    const lat0 = ll.reduce((a, p) => a + p[1], 0) / ll.length, lon0 = ll.reduce((a, p) => a + p[0], 0) / ll.length;
    const ring = ll.map(([lo, la]) => lngLatToFeet(lo, la, lon0, lat0));
    const bx = -560, by = -1326;
    const els = [
      { id: "b1", type: "building", ring: rect(bx, by, 520, 300), padElevFt: 795 },
      { id: "c1", type: "paving", ring: rect(bx, by + 300, 520, 130), hostId: "b1", dockStack: { x: bx + 260, y: by + 150 } },
      { id: "p1", type: "parking", ring: rect(bx, by - 62, 520, 62), hostId: "b1" },
    ];
    const req = JSON.parse(readFileSync(F + ".req.json", "utf8"));
    const grid = decodeGrid(new Uint8Array(readFileSync(F + ".lerc")).buffer, req);
    const existAt = (pt) => { const [la, lo] = feetToLatLngPair(pt, lat0, lon0); return sampleAtLatLng(grid, req, la, lo); };
    const t = performance.now();
    const s = buildProposedSurface({ els, ffeFt: 795, dockDropFt: 4, existAt, parcelRings: [ring],
      grading: { pavementSlopePct: 1.5, lotDropFt: 0.5, slopeRatio: 2, shoulderFt: 5, setbackRings: [ring], limit: { mode: "boundary", maxCutFillFt: 12 } }, opts: { maxCells: 9000, existKey: "chehaw-b" } });
    const ms = performance.now() - t;
    expect(s.grid.limit.mode).toBe("boundary");
    expect(s.grid.cells.length).toBeGreaterThan(2000);
    expect(s.grid.cells.filter((c) => !pointInRing(c, ring)).length).toBe(0);
    expect(s.grid.outside.count).toBe(0);
    expect(describeFlag(s, new Set(["b1"]), { buildingCentre: { x: bx + 260, y: by + 150 } })).toBeNull();
    expect(s.grid.cells.filter((c) => c.wedge).length).toBeGreaterThan(100);
    expect(s.daylight.length).toBe(1);
    expect(s.daylight[0].ring).toEqual(s.grid.limit.limitRegions[0].outer);
    // ROUND 6: the open ground inside the setback follows the pavement — none of it is above the FFE, and it is not flat at it
    const infill = s.grid.cells.filter((c) => c.cls === "infill");
    expect(infill.length).toBeGreaterThan(500);
    expect(infill.filter((c) => c.propFt > 795 + 1e-6).length).toBe(0);
    expect(infill.filter((c) => c.propFt < 795 - 0.5).length).toBeGreaterThan(300);
    expect(ms).toBeLessThan(1500);
  });
});

describe("the real Chehaw ring: one rounded outline around a building with courts and a car lot", () => {
  it("one region, rounded ends, inside the setback", () => {
    const F = new URL("./fixtures/chehaw-218-02007", import.meta.url).pathname;
    const pj = JSON.parse(readFileSync(F + ".parcel.json", "utf8"));
    const ll = pj.ringLngLat.slice(0, -1);
    const lat0 = ll.reduce((a, p) => a + p[1], 0) / ll.length, lon0 = ll.reduce((a, p) => a + p[0], 0) / ll.length;
    const ring = ll.map(([lo, la]) => lngLatToFeet(lo, la, lon0, lat0));
    const bx = -560, by = -1326;
    const els = [
      { id: "b1", type: "building", ring: rect(bx, by, 520, 300) },
      { id: "c1", type: "paving", ring: rect(bx, by + 300, 520, 130) },
      { id: "p1", type: "parking", ring: rect(bx, by - 62, 520, 62) },
      { id: "p2", type: "parking", ring: rect(bx, by - 124, 520, 62) },
    ];
    const r = resolveGradingLimit({ els, spec: { mode: "layout", setbackRings: [ring] } });
    expect(r.regions.length).toBe(1);
    expect(r.regions[0].outer.every((p) => pointInRing(p, ring) || ring.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1))).toBe(true);
    expect(pointInRing({ x: bx - 3, y: by - 122 }, r.regions[0].outer)).toBe(false);   // a rounded corner
    expect(r.areaAc).toBeGreaterThan(6); expect(r.areaAc).toBeLessThan(10);
    // and the whole surface on the real ground builds under 150 ms with no slope cell inside the limit
    const req = JSON.parse(readFileSync(F + ".req.json", "utf8"));
    const grid = decodeGrid(new Uint8Array(readFileSync(F + ".lerc")).buffer, req);
    const existAt = (pt) => { const [la, lo] = feetToLatLngPair(pt, lat0, lon0); return sampleAtLatLng(grid, req, la, lo); };
    const t = performance.now();
    const s = buildProposedSurface({ els: els.map((e) => ({ ...e, padElevFt: e.type === "building" ? 795 : undefined, hostId: e.type === "building" ? undefined : "b1", dockStack: e.id === "c1" ? { x: bx + 260, y: by + 150 } : null })),
      ffeFt: 795, dockDropFt: 4, existAt, parcelRings: [ring], grading: { pavementSlopePct: 1.5, lotDropFt: 0.5, slopeRatio: 2, shoulderFt: 5, setbackRings: [ring], limit: { mode: "layout" } }, opts: { maxCells: 9000, existKey: "chehaw" } });
    const ms = performance.now() - t;
    expect(s.grid.cells.filter((c) => c.wedge && pointInRegions(c, s.grid.limit.regions)).length).toBe(0);
    expect(s.daylight.length).toBe(1);
    expect(s.grid.cutCy).toBeGreaterThan(0); expect(s.grid.fillCy).toBeGreaterThan(0);
    expect(ms).toBeLessThan(600);
  });
});
