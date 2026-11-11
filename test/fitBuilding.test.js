// NEW-1 — "Fit the biggest building": the inverse of the forward grading problem. Three kinds of proof:
//  (1) SYNTHETIC grounds whose answer is derivable on paper (flat parcel → the setback-limited box; a tilted plane → the building turns its
//      length along the contours; a creek notch → the footprint stays out of it), so the search is checked against mathematics, not itself;
//  (2) the OWNER'S REAL Chehaw Rd ground (Georgia Test Site › Concept A) against an INDEPENDENT measure — the textbook largest-rectangle
//      scan of the sweep's own level-pad mask — and against the REAL grading engine on the fitted layout (no cell past the limit, cut / fill
//      within a few percent of what the search estimated);
//  (3) the plumbing: stacks must daylight inside the fence, a cancelled run stops, the alternative is balanced and distinct.
import { describe, it, expect } from "vitest";
import { buildLattice, prepareSweep, maskAt } from "../src/workspaces/site-planner/lib/buildableGround.js";
import { sweepBBox } from "../src/workspaces/site-planner/lib/buildableLattice.js";
import { prepareFit, runFitSync, fitBuildingSteps, fitBaseAngles, depthLadder, longAxisDeg, contourAxisDeg, roundSf, FIT_DEFAULTS } from "../src/workspaces/site-planner/lib/fitBuilding.js";
import { templateFromBuilding, defaultTemplate, fitAssemblyEls, syntheticAssemblyEls, frontageDegOf, lengthAxisDeg } from "../src/workspaces/site-planner/lib/fitTemplate.js";
import { chehawInputs } from "../ui-audit/lib/chehawSurfaceNode.mjs";
import { CHEHAW_CONCEPT_A_ROWS } from "../ui-audit/lib/chehawCrossDock.mjs";
import { gradingSetback } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { propertyLimit } from "../src/workspaces/site-planner/lib/gradingLimit.js";
import { buildProposedSurface } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { gradedAreaEarthwork } from "../src/workspaces/site-planner/lib/buildingGrade.js";
import { assemblyIds } from "../src/workspaces/site-planner/lib/gradingMembership.js";

const rect = (w, h, x = 0, y = 0) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const ladder = (lo, hi) => { const d = []; for (let v = lo; v <= hi; v += 20) d.push(v); return d; };
const BARE = { axis: "x", negDepth: 0, posDepth: 0, endNeg: 0, endPos: 0, depths: ladder(160, 800), bayFt: 56, minBays: 5 };
const CROSS = { ...BARE, negDepth: 200, posDepth: 200, negDrop: 4, posDrop: 4, lotDrop: 0.5 };
// a 1000 × 800 setback inside a fence 30 ft larger on every side
function site(sample, { bbox = [-300, -300, 1300, 1100] } = {}) {
  const lattice = buildLattice({ bbox, cell: 10, sample });
  return prepareFit({ lattice, setbackRings: [rect(1000, 800)], fenceRings: [rect(1060, 860, -30, -30)] });
}
const inRing = (ring, p) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { if ((ring[i].y > p.y) !== (ring[j].y > p.y) && p.x < (ring[j].x - ring[i].x) * (p.y - ring[i].y) / (ring[j].y - ring[i].y) + ring[i].x) c = !c; } return c; };
const bboxOf = (ring) => ({ x0: Math.min(...ring.map((p) => p.x)), x1: Math.max(...ring.map((p) => p.x)), y0: Math.min(...ring.map((p) => p.y)), y1: Math.max(...ring.map((p) => p.y)) });

describe("flat parcel — the answer is the setback-limited box", () => {
  const ctx = site(() => 100);
  const r = runFitSync({ ctx, template: BARE });
  it("fills the setback: 17 bays of 56 ft (952) by the deepest rung that fits (800)", () => {
    expect(r.best.lengthFt).toBe(952);
    expect(r.best.depthFt).toBe(800);
    expect(r.best.sf).toBe(952 * 800);
    expect(r.best.sfRounded).toBe(762000);
  });
  it("sits entirely inside the setback and moves no dirt", () => {
    const bb = bboxOf(r.best.building);
    expect(bb.x0).toBeGreaterThanOrEqual(-1); expect(bb.x1).toBeLessThanOrEqual(1001); expect(bb.y0).toBeGreaterThanOrEqual(-1); expect(bb.y1).toBeLessThanOrEqual(801);
    expect(r.best.ffe).toBe(100);
    expect(Math.abs(r.best.netCy)).toBeLessThan(1);
  });
  it("a template with a 200-ft court stack each side is limited by the FENCE, not the setback", () => {
    const rc = runFitSync({ ctx, template: CROSS });
    expect(rc.best.sf).toBeLessThan(r.best.sf);
    const fence = { x0: -30, x1: 1030, y0: -30, y1: 830 };
    for (const z of rc.best.zones) for (const p of z.ring) { expect(p.x).toBeGreaterThanOrEqual(fence.x0 - 1); expect(p.x).toBeLessThanOrEqual(fence.x1 + 1); expect(p.y).toBeGreaterThanOrEqual(fence.y0 - 1); expect(p.y).toBeLessThanOrEqual(fence.y1 + 1); }
  });
});

describe("tilted plane — the building turns its length along the contours", () => {
  // z = 0.05·x: contours run north–south. With D = 12 the level band is 2D/g = 480 ft wide whatever the finish, so a 1000-ft-long building
  // across the slope cannot exist; one along it (800 ft) can.
  const ctx = site((x) => 0.05 * x);
  const r = runFitSync({ ctx, template: BARE, frontageDeg: 0 });      // the road offers east–west; the ground must override it
  it("picks the contour direction (north–south), not the road's", () => {
    expect(Math.abs(r.best.uDeg - 90)).toBeLessThan(11);
  });
  it("its depth is the width of the level band (≈ 2D/g = 480 ft) and it moves almost no net dirt", () => {
    expect(r.best.depthFt).toBeGreaterThanOrEqual(440); expect(r.best.depthFt).toBeLessThanOrEqual(480);
    expect(Math.abs(r.best.netCy)).toBeLessThan(0.05 * r.best.cutCy);
  });
  it("the long dimension runs along the slope's contours; turned the other way the length is capped by the level band and never gains", () => {
    expect(r.best.lengthFt).toBeGreaterThan(r.best.depthFt);
    const across = runFitSync({ ctx, template: BARE, angles: [0] });
    expect(across.best.lengthFt).toBeLessThanOrEqual(480);            // 2D/g: the band the finish can reach
    expect(across.best.sf).toBeLessThanOrEqual(r.best.sf);
  });
  it("on a plane tilted 30° the contours run at 120° and so does the building", () => {
    const a = 30 * Math.PI / 180;
    const ctx2 = site((x, y) => 0.05 * (x * Math.cos(a) + y * Math.sin(a)));
    const r2 = runFitSync({ ctx: ctx2, template: BARE, frontageDeg: 0 });
    const d = Math.abs(((r2.best.uDeg - 120) % 180 + 180) % 180); expect(Math.min(d, 180 - d)).toBeLessThan(11);
  });
});

describe("creek notch — the footprint avoids it", () => {
  // a 60-ft-wide channel 30 ft deep across the whole parcel north–south at x = 480..540: far past D, so nothing may stand over it
  const z = (x) => (x > 480 && x < 540 ? 70 : 100);
  const ctx = site(z);
  const r = runFitSync({ ctx, template: BARE });
  it("the building lies wholly on one side of the notch", () => {
    const bb = bboxOf(r.best.building);
    expect(bb.x1 <= 482 || bb.x0 >= 538).toBe(true);
  });
  it("every point under the building is within the max cut / fill of the finish (checked point by point, independently of the search's grid)", () => {
    const bb = bboxOf(r.best.building);
    let worst = 0;
    for (let x = bb.x0; x <= bb.x1; x += 5) for (let y = bb.y0; y <= bb.y1; y += 5) if (inRing(r.best.building, { x, y })) worst = Math.max(worst, Math.abs(r.best.ffe - z(x)));
    expect(worst).toBeLessThanOrEqual(FIT_DEFAULTS.D);
  });
  it("offers ONE balanced alternative, distinct from the biggest, that really is balanced", () => {
    expect(r.alt).toBeTruthy();
    expect(r.alt.sf).toBeLessThanOrEqual(r.best.sf);
    expect(Math.abs(r.alt.netCy)).toBeLessThanOrEqual(0.05 * Math.max(1, r.alt.cutCy) + 1);
    expect(r.alt.sfRounded === r.best.sfRounded && Math.abs(r.alt.ffe - r.best.ffe) < 0.5).toBe(false);
  });
});

describe("the rules", () => {
  it("max cut / fill is honoured: on a 40-ft hill with D = 6 no finish ever sits more than 6 ft from the ground it covers", () => {
    const ctx = site((x) => 0.02 * x + 100);                      // 20 ft of relief over the setback
    const r = runFitSync({ ctx, template: BARE, params: { D: 6 } });
    const bb = bboxOf(r.best.building);
    let worst = 0;
    for (let x = bb.x0; x <= bb.x1; x += 5) for (let y = bb.y0; y <= bb.y1; y += 5) if (inRing(r.best.building, { x, y })) worst = Math.max(worst, Math.abs(r.best.ffe - (0.02 * x + 100)));
    expect(worst).toBeLessThanOrEqual(6 + 0.6);                    // a half cell of lattice interpolation
  });
  it("a steeper slope ratio never gains area", () => {
    const ctx = site((x) => 0.04 * x);
    const a = runFitSync({ ctx, template: CROSS, params: { s: 2 } }).best.sf, b = runFitSync({ ctx, template: CROSS, params: { s: 4 } }).best.sf;
    expect(b).toBeLessThanOrEqual(a);
  });
  it("length grows in whole bays, depth snaps to the rungs, SF is reported to the nearest 1,000", () => {
    const r = runFitSync({ ctx: site(() => 100), template: CROSS });
    expect(r.best.lengthFt % 56).toBe(0);
    expect(depthLadder({ dockMode: "cross" })).toContain(r.best.depthFt);
    expect(r.best.sfRounded % 1000).toBe(0);
    expect(roundSf(439040)).toBe(439000);
  });
  it("nothing fits in a parcel that is too small: best is null, with a reason", () => {
    const lattice = buildLattice({ bbox: [-100, -100, 400, 400], cell: 10, sample: () => 100 });
    const ctx = prepareFit({ lattice, setbackRings: [rect(150, 150)], fenceRings: [rect(190, 190, -20, -20)] });
    const r = runFitSync({ ctx, template: BARE });
    expect(r.best).toBeNull(); expect(r.why).toBeTruthy();
  });
  it("a cancelled run stops and says so (the worker's supersede path)", () => {
    const ctx = site(() => 100);
    let n = 0;
    const g = fitBuildingSteps({ ctx, template: CROSS, shouldAbort: () => ++n > 2 });
    let r = g.next(); while (!r.done) r = g.next();
    expect(r.value.aborted).toBe(true);
  });
  it("is deterministic", () => {
    const ctx = site((x, y) => 100 + 0.01 * x + 0.02 * y);
    const a = runFitSync({ ctx, template: CROSS }), b = runFitSync({ ctx, template: CROSS });
    expect(b.best.sf).toBe(a.best.sf); expect(b.best.ffe).toBe(a.best.ffe); expect(b.best.centre).toEqual(a.best.centre);
  });
});

describe("angles", () => {
  it("dedupes near-equal orientations and keeps frontage, parcel axis, current rotation and the contours", () => {
    const a = fitBaseAngles({ frontageDeg: 10, longAxis: 11, currentDeg: 50, contourDeg: 50.5 });
    expect(a.map((x) => x.label)).toEqual(["frontage", "current", "frontage-perp"]);
    expect(fitBaseAngles({}).length).toBe(1);
  });
  it("finds a rectangle's long axis and a plane's contour direction", () => {
    const lat = buildLattice({ bbox: [0, 0, 1000, 400], cell: 10, sample: (x) => 0.05 * x });
    const inside = new Uint8Array(lat.nx * lat.ny).fill(1);
    const ax = longAxisDeg(lat, inside); expect(Math.min(ax, 180 - ax)).toBeLessThan(2);
    const c = contourAxisDeg(lat, inside); expect(Math.abs(c - 90)).toBeLessThan(2);
    const flat = buildLattice({ bbox: [0, 0, 1000, 400], cell: 10, sample: () => 5 });
    expect(contourAxisDeg(flat, inside)).toBeNull();
  });
  it("the frontage is the direction of the road nearest the parcel", () => {
    const parcel = [rect(100, 100)[0], rect(100, 100)[1], rect(100, 100)[2], rect(100, 100)[3]];
    expect(frontageDegOf([[{ x: 0, y: 200 }, { x: 500, y: 200 }], [{ x: 900, y: 0 }, { x: 900, y: 500 }]], [parcel])).toBeCloseTo(0, 5);
    expect(frontageDegOf([], [parcel])).toBeNull();
  });
});

describe("the template of a building", () => {
  const rows = CHEHAW_CONCEPT_A_ROWS, b = rows[0], kids = rows.filter((e) => e.attachedTo === b.id);
  const t = templateFromBuilding(b, kids, { dockDropFt: 4 });
  it("reads a cross-dock's stacks and ends off the attached elements", () => {
    expect(t.dockMode).toBe("cross"); expect(t.axis).toBe("x");
    expect(t.lengthFt).toBe(1429); expect(t.depthFt).toBe(650);
    expect(Math.min(t.negDepth, t.posDepth)).toBe(185);            // 135 court + 50 trailer row
    expect(Math.max(t.negDepth, t.posDepth)).toBe(200);            // … and the 15-ft buffer behind the east row
    expect(t.negDrop).toBe(4); expect(t.posDrop).toBe(4);
    expect(t.endNeg).toBe(65); expect(t.endPos).toBe(65);          // 5-ft walk + 60-ft car row at each end
    expect(t.depths).toContain(650);
    expect(lengthAxisDeg(b)).toBe(259);
  });
  it("a single-load building drops only its dock side by the dock drop; the rear stack drops by a curb", () => {
    const sb = { id: "b", type: "building", cx: 0, cy: 0, w: 800, h: 250, rot: 0, dock: "single", dockAxis: "x", dockSide: "bottom" };
    const kid = (id, cy, h) => ({ id, type: "paving", cx: 0, cy, w: 800, h, rot: 0, attachedTo: "b" });
    const ts = templateFromBuilding(sb, [kid("c", 125 + 67.5, 135), kid("p", -125 - 30, 60)], { dockDropFt: 4 });
    expect(ts.posDepth).toBe(135); expect(ts.posDrop).toBe(4);
    expect(ts.negDepth).toBe(60); expect(ts.negDrop).toBe(0.5);
  });
  it("with no building the default is a cross-dock from the plan's standard zone depths", () => {
    const d = defaultTemplate({}, { dockDropFt: 4 });
    expect(d.dockMode).toBe("cross"); expect(d.negDepth).toBe(200); expect(d.posDepth).toBe(200); expect(d.fromBuilding).toBe(false);
    expect(defaultTemplate({ truckCourtD: 150, trailerParkD: 60, bufferD: 20 }).negDepth).toBe(230);
  });
});

describe("OWNER'S REAL GROUND — Chehaw Rd (Georgia Test Site › Concept A), 2:1, ≤ 12 ft cut / fill", () => {
  const { inputs, existAt } = chehawInputs({ owner: 2 });
  const base = inputs(793, "layout", "fit-test");
  const ring = base.parcelRings[0];
  let minY = Infinity; for (const p of ring) minY = Math.min(minY, p.y);
  const sb = ring.map((a, i) => { const c = ring[(i + 1) % ring.length]; return (a.y + c.y) / 2 < minY + 400 ? 50 : 25; });
  const setback = gradingSetback([{ id: "pc", points: ring, setbacks: sb, active: true }], 25);
  const fence = propertyLimit({ parcelRings: setback.parcelRings, holes: setback.holes, marginFt: 10, bufferFt: 0 });
  const lattice = buildLattice({ bbox: sweepBBox(setback.parcelRings, 200), cell: 10, sample: (x, y) => existAt({ x, y }) });
  const ctx = prepareFit({ lattice, setbackRings: setback.rings, setbackHoles: setback.holes, fenceRings: fence.rings, fenceHoles: fence.holes });
  const bEl = base.els.find((e) => e.type === "building");
  const b0 = CHEHAW_CONCEPT_A_ROWS[0];
  const c0 = bEl.ring.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
  const off = { x: c0.x - b0.cx, y: c0.y - b0.cy }, shift = (e) => ({ ...e, cx: e.cx + off.x, cy: e.cy + off.y });
  const b = shift(b0), kids = CHEHAW_CONCEPT_A_ROWS.filter((e) => e.attachedTo === b0.id).map(shift);
  const tpl = templateFromBuilding(b, kids, { dockDropFt: 4 });

  it("the sweep's level pad is the prototype's: ~37 of 74 ac at a finish near 795", () => {
    const sw = prepareSweep({ lattice, rings: setback.rings, holes: setback.holes });
    const m = maskAt(sw, 795, 2, 12);
    expect(m.areaAc).toBeGreaterThan(36); expect(m.areaAc).toBeLessThan(39);
  });

  it("a BARE building matches an independent largest-rectangle scan of that level-pad mask (within the bay / depth snapping)", () => {
    const sw = prepareSweep({ lattice, rings: setback.rings, holes: setback.holes });
    let indep = 0;
    for (const E of [793, 794, 795, 796, 797]) {
      const m = maskAt(sw, E, 2, 12), { nx, ny } = lattice, h = new Int32Array(nx);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) h[i] = m.mask[j * nx + i] ? h[i] + 1 : 0;
        const st = [];
        for (let i = 0; i <= nx; i++) { const cur = i === nx ? 0 : h[i]; let start = i; while (st.length && st[st.length - 1][1] >= cur) { const [si, sh] = st.pop(); indep = Math.max(indep, sh * (i - si) * 100); start = si; } st.push([start, cur]); }
      }
    }
    const bare = runFitSync({ ctx, template: { ...tpl, negDepth: 0, posDepth: 0, endNeg: 0, endPos: 0, depths: ladder(160, 800) }, angles: [0] });
    expect(bare.best.sf).toBeGreaterThan(0.9 * indep);
    expect(bare.best.sf).toBeLessThan(1.1 * indep);
  });

  const r = runFitSync({ ctx, template: tpl, currentDeg: tpl.uDeg });
  it("fits a building at a finish near the prototype's 795, in well under 10 s", () => {
    expect(r.best.sf).toBeGreaterThan(300000);
    expect(r.best.ffe).toBeGreaterThanOrEqual(792); expect(r.best.ffe).toBeLessThanOrEqual(798);
    expect(r.stats.ms).toBeLessThan(10000);
    // eslint-disable-next-line no-console
    console.log(`[fit-building] Chehaw Concept A: ${r.best.sfRounded.toLocaleString()} SF (${r.best.lengthFt} × ${r.best.depthFt}) FFE ${r.best.ffe}, ${r.stats.ms} ms; alt ${r.alt ? `${r.alt.sfRounded.toLocaleString()} SF FFE ${r.alt.ffe}` : "none"}`);
  });
  it("the alternative is balanced and smaller", () => {
    expect(r.alt).toBeTruthy();
    expect(r.alt.sf).toBeLessThan(r.best.sf);
    expect(Math.abs(r.alt.netCy)).toBeLessThanOrEqual(0.05 * r.alt.cutCy + 1);
  });
  for (const which of ["best", "alt"]) {
    it(`the REAL grading engine agrees on the ${which}: nothing past the limit, cut / fill within 8% of the search's estimate`, () => {
      const c = r[which];
      const gi = inputs(c.ffe, "layout", `fit-price-${which}`);
      gi.els = fitAssemblyEls(gi.els, bEl.id, assemblyIds(gi.els, bEl.id), { cx: b.cx, cy: b.cy, w: b.w, h: b.h, rot: b.rot }, c.box, tpl.axis, c.ffe);
      const s = buildProposedSurface(gi);
      const ew = gradedAreaEarthwork(s.grid);
      expect(s.grid.outside ? s.grid.outside.count : 0).toBe(0);
      expect(Math.abs(ew.cutCy - c.cutCy) / c.cutCy).toBeLessThan(0.08);
      expect(Math.abs(ew.fillCy - c.fillCy) / c.fillCy).toBeLessThan(0.08);
    });
  }
  it("re-fitting the assembly puts the building exactly in the candidate's box (same footprint area, same centre)", () => {
    const c = r.best, gi = inputs(c.ffe, "layout", "fit-box");
    const els2 = fitAssemblyEls(gi.els, bEl.id, assemblyIds(gi.els, bEl.id), { cx: b.cx, cy: b.cy, w: b.w, h: b.h, rot: b.rot }, c.box, tpl.axis, c.ffe);
    const nb = els2.find((e) => e.id === bEl.id);
    const area = Math.abs(nb.ring.reduce((a, p, i) => { const q = nb.ring[(i + 1) % nb.ring.length]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;
    expect(area).toBeCloseTo(c.lengthFt * c.depthFt, -1);
    const cx = nb.ring.reduce((a, p) => a + p.x / 4, 0), cy = nb.ring.reduce((a, p) => a + p.y / 4, 0);
    expect(Math.hypot(cx - c.box.cx, cy - c.box.cy)).toBeLessThan(0.5);
    expect(nb.padElevFt).toBe(c.ffe);
  });
});

describe("no building on the plan — the synthetic cross-dock", () => {
  it("builds the building plus a court and a trailer row on each long side, hosted by it", () => {
    const els = syntheticAssemblyEls({ cx: 0, cy: 0, w: 800, h: 400, rot: 0 }, {}, 100);
    expect(els.map((e) => e.type)).toEqual(["building", "paving", "trailer", "paving", "trailer"]);
    expect(els.slice(1).every((e) => e.hostId === els[0].id && e.dockStack)).toBe(true);
    expect(els[0].padElevFt).toBe(100);
    const ys = els.flatMap((e) => e.ring.map((p) => p.y));
    expect(Math.max(...ys) - Math.min(...ys)).toBe(400 + 2 * 185);
  });
});
