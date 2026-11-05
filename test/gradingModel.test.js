// NEW-3 (owner-only grading layer) — the GRADING MODEL inside the proposed-surface engine: flat pad, court and
// lots falling away from the building at the pavement slope, paved neighbours ramping at the grading slope,
// the 5 ft shoulder, and the setback flag. Closed forms on flat / tilted ground, then the reads that must
// agree (the lattice, the point readout, the spot elevations).
import { describe, it, expect } from "vitest";
import {
  buildPlanes, buildProposedSurface, sampleProposedAt, wallFor, wedgeDz, GRADING_DEFAULTS,
} from "../src/workspaces/site-planner/lib/proposedSurface.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const FFE = 100;
const GROUND = 90;
const flat = () => GROUND;

// Building 0..200 × 0..100; truck court south of it (0..260 × 100..230); end-wall lot east of it (200..260 × 0..100).
const els = () => ([
  { id: "b", type: "building", ring: rect(0, 0, 200, 100), padElevFt: FFE },
  { id: "c", type: "paving", ring: rect(0, 100, 260, 130), dockStack: { x: 100, y: 50 }, hostId: "b" },
  { id: "l", type: "parking", ring: rect(200, 0, 60, 100), hostId: "b" },
]);
const G = (over = {}) => ({ pavementSlopePct: 1.5, lotDropFt: 0.5, slopeRatio: 2, shoulderFt: 5, ...over });

describe("grading planes — the owner's rules", () => {
  it("wallFor picks the wall the element sits against and the depth is measured off that wall line", () => {
    const w = wallFor(rect(0, 0, 200, 100), { x: 100, y: 165 });
    expect(w.n.x).toBeCloseTo(0, 9); expect(w.n.y).toBeCloseTo(1, 9);          // south wall, outward = +y
    const e = wallFor(rect(0, 0, 200, 100), { x: 230, y: 50 });
    expect(e.n.x).toBeCloseTo(1, 9); expect(e.n.y).toBeCloseTo(0, 9);          // east wall
  });
  it("the court starts at FFE − dock drop ON THE FACE and falls away at the pavement slope", () => {
    const { planes } = buildPlanes({ els: els(), ffeFt: FFE, dockDropFt: 4, grading: G() });
    const c = planes.get("c");
    expect(c.baseElevFt).toBe(96);
    expect(c.slopePct).toBe(1.5);
    expect(c.zAt({ x: 100, y: 100 })).toBeCloseTo(96, 9);                      // dock face
    expect(c.zAt({ x: 100, y: 200 })).toBeCloseTo(96 - 1.5, 9);                // 100 ft out at 1.5%
    expect(c.zAt({ x: 5, y: 150 })).toBeCloseTo(c.zAt({ x: 250, y: 150 }), 9); // level ALONG the face
  });
  it("a car lot starts at FFE − 0.5′ at its CURB and falls away from the building", () => {
    const { planes } = buildPlanes({ els: els(), ffeFt: FFE, dockDropFt: 4, grading: G() });
    const l = planes.get("l");
    expect(l.baseElevFt).toBe(99.5);
    expect(l.zAt({ x: 200, y: 50 })).toBeCloseTo(99.5, 9);                     // curb = its edge against the east wall
    expect(l.zAt({ x: 260, y: 50 })).toBeCloseTo(99.5 - 0.015 * 60, 9);
  });
  it("a lot with a gap (sidewalk) starts at its OWN near edge, not at the wall", () => {
    const e = els(); e[2] = { ...e[2], ring: rect(210, 0, 60, 100) };
    const { planes } = buildPlanes({ els: e, ffeFt: FFE, grading: G() });
    expect(planes.get("l").zAt({ x: 210, y: 50 })).toBeCloseTo(99.5, 9);
  });
  it("a trailer row stacked beyond the court CONTINUES the court's plane", () => {
    const e = els().concat([{ id: "t", type: "trailer", ring: rect(0, 230, 260, 60), dockStack: { x: 100, y: 50 }, hostId: "b" }]);
    const { planes } = buildPlanes({ els: e, ffeFt: FFE, dockDropFt: 4, grading: G() });
    const c = planes.get("c"), t = planes.get("t");
    for (const pt of [{ x: 20, y: 229 }, { x: 130, y: 260 }, { x: 250, y: 289 }]) expect(t.zAt(pt)).toBeCloseTo(c.zAt(pt), 9);
  });
  it("pavement slope is user-set but never below 0.5%", () => {
    const lo = buildPlanes({ els: els(), ffeFt: FFE, grading: G({ pavementSlopePct: 0.1 }) }).planes.get("c");
    expect(lo.slopePct).toBe(0.5);
    const hi = buildPlanes({ els: els(), ffeFt: FFE, grading: G({ pavementSlopePct: 2.5 }) }).planes.get("c");
    expect(hi.slopePct).toBe(2.5);
  });
  it("without a host the pre-existing rules apply (landscape / unattached paving untouched)", () => {
    const e = [{ id: "b", type: "building", ring: rect(0, 0, 100, 100) }, { id: "p", type: "paving", ring: rect(300, 0, 50, 50) }];
    const g = buildPlanes({ els: e, ffeFt: FFE, grading: G() }).planes.get("p");
    const o = buildPlanes({ els: e, ffeFt: FFE }).planes.get("p");
    expect(g.baseElevFt).toBe(o.baseElevFt); expect(g.slopePct).toBe(o.slopePct);
  });
  it("without the grading argument the engine's defaults are untouched", () => {
    expect(GRADING_DEFAULTS.pavementSlopePct).toBe(1.5);
    const a = buildProposedSurface({ els: els(), ffeFt: FFE, dockDropFt: 4, existAt: flat });
    expect(a.grid.outside).toBeNull();
    expect(a.grid.grading).toBeNull();
  });
});

describe("the shoulder, then the grading slope, until daylight", () => {
  it("wedgeDz: flat for the shoulder, then 1 ft of drop per `ratio` ft of run", () => {
    // edge at 100 over ground 90: fill. 4 ft past the edge: still on the shoulder (dz = 10)
    expect(wedgeDz(100, 90, 4, 2, 5)).toBeCloseTo(10, 9);
    expect(wedgeDz(100, 90, 5, 2, 5)).toBeCloseTo(10, 9);
    // 9 ft past: 4 ft beyond the shoulder at 2:1 = 2 ft of drop
    expect(wedgeDz(100, 90, 9, 2, 5)).toBeCloseTo(8, 9);
    // daylights at shoulder + 10·2 = 25 ft
    expect(wedgeDz(100, 90, 25, 2, 5)).toBeCloseTo(0, 9);
    expect(wedgeDz(100, 90, 40, 2, 5)).toBe(0);
    // shoulder 0 is exactly the original B833 taper
    expect(wedgeDz(100, 90, 8, 3, 0)).toBeCloseTo(10 - 8 / 3, 9);
    // cut mirrors fill
    expect(wedgeDz(90, 100, 9, 2, 5)).toBeCloseTo(-8, 9);
  });
  it("on flat ground the lattice reproduces the closed form off the building's blank (north) wall", () => {
    const s = buildProposedSurface({ els: [{ id: "b", type: "building", ring: rect(0, 0, 200, 100), padElevFt: FFE }], ffeFt: FFE, existAt: flat,
      grading: G(), opts: { maxCells: 80000, minCellFt: 1 } });
    const p = (d) => sampleProposedAt(s.grid, { x: 100, y: -d }, flat);
    expect(p(2).ft).toBeCloseTo(100, 6);          // shoulder
    expect(p(11).ft).toBeCloseTo(100 - (11 - 5) / 2, 6);
    expect(p(26).status === "value" ? p(26).ft : 90).toBeCloseTo(90, 6); // daylit (25 ft out)
  });
  it("cut-and-fill read from ONE surface: lattice cell dz == point readout − ground at its centre", () => {
    const s = buildProposedSurface({ els: els(), ffeFt: FFE, dockDropFt: 4, existAt: flat, grading: G(), opts: { maxCells: 20000, minCellFt: 2 } });
    let n = 0;
    for (const c of s.grid.cells) {
      if (c.dzFt == null) continue;
      const r = sampleProposedAt(s.grid, c, flat);
      if (r.status !== "value") continue;
      expect(r.ft - GROUND).toBeCloseTo(c.dzFt, 6);
      if (++n > 1500) break;
    }
    expect(n).toBeGreaterThan(500);
  });
});

describe("paved neighbours RAMP at the grading slope — no vertical step", () => {
  const s = buildProposedSurface({ els: els(), ffeFt: FFE, dockDropFt: 4, existAt: flat, grading: G(), opts: { maxCells: 200000, minCellFt: 1 } });
  const zAt = (pt) => sampleProposedAt(s.grid, pt, flat).ft;
  it("the end-wall lot (FFE − 0.5) drops to meet the court (FFE − 4) over 2:1, INSIDE the lot", () => {
    // lot cell right at the court edge: held to the court's level
    expect(zAt({ x: 230, y: 99.5 })).toBeCloseTo(96.0 + 0.5 / 2 - 0.015 * 0.5 + 0.0, 1);
    // 3.5 ft of drop needs 7 ft of ramp: at y = 93 the lot is back on its own plane
    expect(zAt({ x: 230, y: 90 })).toBeCloseTo(99.5 - 0.015 * 30, 1);
    // halfway up the ramp
    const mid = zAt({ x: 230, y: 96.5 });
    expect(mid).toBeGreaterThan(96.5); expect(mid).toBeLessThan(99);
  });
  it("no neighbouring graded paved cells differ by more than the 2:1 ramp (0.5 ft/ft) allows", () => {
    const paved = s.grid.cells.filter((c) => !c.wedge && (c.elId === "c" || c.elId === "l"));
    const byKey = new Map(paved.map((c) => [`${Math.round(c.x * 4)},${Math.round(c.y * 4)}`, c]));
    const cs = paved[0].wFt;
    let worst = 0, pairs = 0;
    for (const c of paved) {
      for (const [dx, dy] of [[cs, 0], [0, cs]]) {
        const o = byKey.get(`${Math.round((c.x + dx) * 4)},${Math.round((c.y + dy) * 4)}`);
        if (!o) continue;
        pairs++;
        worst = Math.max(worst, Math.abs((c.dzFt) - (o.dzFt)));
      }
    }
    expect(pairs).toBeGreaterThan(1000);
    expect(worst).toBeLessThanOrEqual(0.5 * cs + 0.06); // ramp 0.5/ft over one cell + the 1.5% pavement fall
  });
  it("the dock WALL (pad → court) keeps its full step: the building is exempt from ramping", () => {
    expect(zAt({ x: 100, y: 99.5 })).toBeCloseTo(100, 6);
    expect(zAt({ x: 100, y: 100.5 })).toBeCloseTo(96 - 0.015 * 0.5, 6);
  });
  it("two buildings' dock-chain trailer rows (same plane) never ramp against each other", () => {
    const e = els().concat([{ id: "t", type: "trailer", ring: rect(0, 230, 260, 60), dockStack: { x: 100, y: 50 }, hostId: "b" }]);
    const s2 = buildProposedSurface({ els: e, ffeFt: FFE, dockDropFt: 4, existAt: flat, grading: G(), opts: { maxCells: 120000, minCellFt: 2 } });
    const a = sampleProposedAt(s2.grid, { x: 100, y: 229 }, flat).ft, b = sampleProposedAt(s2.grid, { x: 100, y: 231 }, flat).ft;
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });
});

describe("the setback flag", () => {
  // setback polygon: the parcel inset — a 600 × 500 buildable box
  const sb = rect(-100, -150, 600, 500);
  const run = (b, ground = flat, gr = {}) => buildProposedSurface({
    els: [{ id: "b", type: "building", ring: b, padElevFt: FFE }], ffeFt: FFE, existAt: ground,
    parcelRings: [rect(-150, -200, 700, 600)], grading: G({ setbackRings: [sb], ...gr }), opts: { maxCells: 60000, minCellFt: 2 },
  });
  it("a building with room to daylight inside the setback reports nothing outside", () => {
    const s = run(rect(100, 100, 200, 100));
    expect(s.grid.outside.count).toBe(0);
    expect(s.grid.outside.centroid).toBeNull();
  });
  it("a fill slope crossing the setback is counted, located, and measured past the line", () => {
    // 10 ft of fill, daylight reach 5 + 20 = 25 ft; building 10 ft from the west setback line → slope runs ~15 ft past
    const s = run(rect(-90, 100, 200, 100));
    const o = s.grid.outside;
    expect(o.count).toBeGreaterThan(20);
    expect(o.centroid.x).toBeLessThan(-100);                    // west of the line
    expect(o.maxPastFt).toBeGreaterThan(12); expect(o.maxPastFt).toBeLessThan(20);
    expect(o.fillSf).toBeGreaterThan(0); expect(o.cutSf).toBe(0);
    expect(o.perEl.b.count).toBe(o.count);
    expect(o.beyondParcel).toBe(0);                             // the parcel line is 50 ft farther out
  });
  it("flagged cells carry out:true + pastFt so the layer can paint them red", () => {
    const s = run(rect(-90, 100, 200, 100));
    const flagged = s.grid.cells.filter((c) => c.out);
    expect(flagged.length).toBe(s.grid.outside.count);
    expect(flagged.every((c) => c.pastFt > 0)).toBe(true);
  });
  it("a slope that also crosses the PROPERTY line is told apart", () => {
    const s = run(rect(-140, 100, 200, 100));
    expect(s.grid.outside.beyondParcel).toBeGreaterThan(0);
  });
  it("cut slopes are named cut", () => {
    const hill = () => 120;
    const s = run(rect(-90, 100, 200, 100), hill);
    expect(s.grid.outside.cutSf).toBeGreaterThan(0); expect(s.grid.outside.fillSf).toBe(0);
  });
  it("raising/lowering FFE changes the reach (closed form: reach = shoulder + 2·|Δ|)", () => {
    const hi = run(rect(-90, 100, 200, 100)).grid.outside.maxPastFt;
    const lo = buildProposedSurface({ els: [{ id: "b", type: "building", ring: rect(-90, 100, 200, 100), padElevFt: 94 }], ffeFt: 94, existAt: flat,
      parcelRings: [], grading: G({ setbackRings: [sb] }), opts: { maxCells: 60000, minCellFt: 2 } }).grid.outside.maxPastFt;
    expect(lo).toBeLessThan(hi);
  });
});
