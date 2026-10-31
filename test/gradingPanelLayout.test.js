// NEW-1 (owner 2026-10-31) — the approved Grading panel layout, as pure data: the signed Limits-of-disturbance mapping, the
// three suggested floors (no haul / least digging / shortest slopes), the haul-by-floor sampler, the threshold-only flags.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  limitOffsetFt, marginFromOffset, limitOffsetWord, LIMIT_PAST_MAX_FT, BALANCE_TOL_CY_PANEL, FLOOR_SAME_FT,
  gridDepthStats, floorStatsOf, haulTile, cutTile, fillTile, depthFlags, depthSentence, limitFlagSentence, seamFlags, rockFlag,
  sweepFloors, shortestSlopesFloor, interpolateHaul, haulCurve, haulZeroFloor, sweepFloorStats, floorRows, groundNumbers, ffePillText,
} from "../src/workspaces/site-planner/lib/gradingPanelModel.js";
import { gradingCfg, gradingSetback, gradingPack, hostIdMap, GRADING_DEFAULTS } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { propertyLimit, pointInRegions, resolveGradingLimit } from "../src/workspaces/site-planner/lib/gradingLimit.js";
import { buildProposedSurface } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { cardEarthwork, assemblyIds, runSync, BALANCE_TOL_CY } from "../src/workspaces/site-planner/lib/buildingGrade.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

describe("Limits of disturbance — ONE signed number off the property line (negative inside)", () => {
  it("the panel number is the NEGATION of the stored inside-margin, so existing plans keep their meaning", () => {
    expect(limitOffsetFt(10)).toBe(-10);                         // a fresh plan: stored +10 → the panel reads −10
    expect(limitOffsetFt(undefined)).toBe(-10);
    expect(limitOffsetFt(0)).toBe(0); expect(Object.is(limitOffsetFt(0), -0)).toBe(false);
    expect(limitOffsetFt(-20)).toBe(20);                          // stored −20 (past the line) → the panel reads +20
    expect(marginFromOffset(-10)).toBe(10);
    expect(marginFromOffset(20)).toBe(-20);
    expect(marginFromOffset(0)).toBe(0); expect(Object.is(marginFromOffset(0), -0)).toBe(false);
    for (const m of [10, 0, 5, 37, -20, -50]) expect(marginFromOffset(limitOffsetFt(m))).toBe(m);   // round trip
    expect(gradingCfg({}).gradingMarginFt).toBe(GRADING_DEFAULTS.gradingMarginFt);
    expect(limitOffsetFt(gradingCfg({}).gradingMarginFt)).toBe(-10);
  });
  it("positive is capped at +50 past the line; the words read −10 / 0 / +20", () => {
    expect(LIMIT_PAST_MAX_FT).toBe(50); expect(GRADING_DEFAULTS.limitPastMaxFt).toBe(LIMIT_PAST_MAX_FT);
    expect(marginFromOffset(80)).toBe(-50);
    expect(gradingCfg({ gradingMarginFt: -50 }).gradingMarginFt).toBe(-50);
    expect(gradingCfg({ gradingMarginFt: -51 }).gradingMarginFt).toBe(10);   // beyond the cap falls back, like any bad value
    expect([-10, 0, 20].map(limitOffsetWord)).toEqual(["−10", "0", "+20"]);
  });
  it("the default mode is the property-line limit; 'layout' survives only when named (the hand-edited outline)", () => {
    expect(gradingCfg({}).limitMode).toBe("boundary");
    expect(gradingCfg({ limitMode: "layout" }).limitMode).toBe("layout");
  });
  it("a POSITIVE offset moves the limit OUTWARD past the parcel; a negative one pulls it inside; zero is the line itself", () => {
    const parcel = rect(0, 0, 1000, 600);
    const at = (marginFt) => propertyLimit({ parcelRings: [parcel], marginFt }).rings;
    const probeOut = { x: -15, y: 300 };        // 15 ft outside the west line
    expect(pointInRegions(probeOut, [{ outer: at(10)[0], holes: [] }])).toBe(false);
    expect(pointInRegions(probeOut, [{ outer: at(0)[0], holes: [] }])).toBe(false);
    expect(pointInRegions(probeOut, [{ outer: at(-20)[0], holes: [] }])).toBe(true);   // panel +20
    expect(pointInRegions({ x: 5, y: 300 }, [{ outer: at(10)[0], holes: [] }])).toBe(false);   // inside the 10 ft margin
    expect(pointInRegions({ x: 5, y: 300 }, [{ outer: at(0)[0], holes: [] }])).toBe(true);
    // the same through the resolved limit the surface carries: the signature moves when the offset does
    const setback = gradingSetback([{ id: "p", points: parcel, setbacks: parcel.map(() => 25), active: true }], 25);
    const sig = (m) => resolveGradingLimit({ els: [], spec: { mode: "boundary", setbackRings: gradingPack(gradingCfg({ gradingMarginFt: m }), setback).setbackRings, setbackHoles: [] } }).sig;
    expect(sig(10)).not.toBe(sig(-20));
  });
});

describe("tiles and flags — thresholds only, one sentence each", () => {
  it("HAUL: 'balanced' under the tolerance (the panel's tolerance IS buildingGrade's), else 'N CY in/out'", () => {
    expect(BALANCE_TOL_CY_PANEL).toBe(BALANCE_TOL_CY);
    expect(haulTile(120)).toMatchObject({ big: "0", sub: "balanced", tone: "green" });
    expect(haulTile(4312)).toMatchObject({ big: "4,300", sub: "4,300 CY in", tone: "amber", dir: "in" });
    expect(haulTile(-9120)).toMatchObject({ big: "9,100", sub: "9,100 CY out", dir: "out" });
    expect(cutTile(53633, 13.6)).toEqual({ big: "53,600", sub: "deepest 14 ft" });
    expect(fillTile(54248, 19.2)).toEqual({ big: "54,200", sub: "tallest 19 ft" });
  });
  it("the approved sentence, no state name; the pad rule wins, then the terrace depth anywhere; nothing under the thresholds", () => {
    expect(depthSentence({ kind: "fill", ft: 31.2, where: "south side", thresholdFt: 12 })).toBe("Fill reaches 31 ft on the south side. Past 12 ft, sites usually terrace or wall.");
    const whereOf = (d, scope) => (scope === "pad" ? "NW corner" : "east side");
    const f = depthFlags({ pad: { fill: { ft: 14, x: 0, y: 0 }, cut: { ft: 5, x: 0, y: 0 } }, anywhere: { fill: { ft: 31, x: 1, y: 1 }, cut: { ft: 20, x: 2, y: 2 } }, maxCutFillFt: 12, terraceDepthFt: 12, whereOf });
    expect(f.map((x) => x.id)).toEqual(["depth-cut", "depth-fill"]);       // one per kind, deepest first
    expect(f[1].scope).toBe("pad"); expect(f[1].text).toBe("Fill reaches 14 ft at the NW corner. Past 12 ft, sites usually terrace or wall.");
    expect(f[0].scope).toBe("slopes"); expect(f[0].thresholdFt).toBe(12);   // the pad's cut is fine; the slopes' 20 ft is past the terrace depth
    expect(depthFlags({ pad: { fill: { ft: 12, x: 0, y: 0 } }, anywhere: { fill: { ft: 12, x: 0, y: 0 } }, maxCutFillFt: 12, terraceDepthFt: 12, whereOf })).toEqual([]);
    expect(depthFlags({ pad: null, anywhere: { fill: { ft: 25, x: 0, y: 0 } }, maxCutFillFt: 12, terraceDepthFt: 30, whereOf })).toEqual([]);   // the terrace depth is its own setting
    expect(gradingCfg({}).terraceDepthFt).toBe(12);
  });
  it("the limit flag, a seam that cannot meet, and rock are each ONE sentence; none describes the ground", () => {
    expect(limitFlagSentence({ kind: "fill", over: 14, place: "past the property line", side: "South" })).toBe("Fill slope runs 14 ft past the property line on the south side.");
    const planes = new Map([["c", { classId: "dockApron" }], ["r", { classId: "driveAisles" }]]);
    const sf = seamFlags([{ elId: "c", nId: "r", stepFt: 2.43, needPct: 7 }, { elId: "r", nId: "c", stepFt: 1, needPct: 6 }], planes, 5);
    expect(sf).toHaveLength(1); expect(sf[0].text).toBe("The truck court can't meet the road within 5%; it needs a 2.4 ft step.");
    expect(rockFlag({ raiseFt: 0.01 }, "east end")).toBeNull();
    expect(rockFlag({ raiseFt: 2.31 }, "east end").text).toBe("Cut reaches rock on the east end. About 2.4 ft more floor would clear it.");
    for (const t of [sf[0].text, rockFlag({ raiseFt: 2 }, null).text, depthSentence({ kind: "cut", ft: 20, where: null, thresholdFt: 12 })]) expect(t).not.toMatch(/uphill|downhill|faces|crosses|runs \d+ ft deep/i);
  });
});

describe("OTHER FLOORS TO TRY — the table", () => {
  const st = (haulCy) => ({ haulCy, deepestCutFt: 5, tallestFillFt: 6, slopeSf: 0 });
  it("three rows in order, the current one marked; the label is '<name>' and least digging carries its sub-label", () => {
    const rows = floorRows({ nohaul: { E: 799.8, stats: st(0) }, digging: { E: 795, areaAc: 37.6, stats: st(-5000) }, slopes: { E: 802.5, stats: st(4000) } }, 795);
    expect(rows.map((r) => r.label)).toEqual(["no haul", "least digging", "shortest slopes"]);
    expect(rows.map((r) => r.current)).toEqual([false, true, false]);
    expect(rows[1].sub).toBe("38 AC stays on natural grade");
  });
  it("two picks within 0.25 ft are ONE row carrying both names — never a duplicate", () => {
    const rows = floorRows({ nohaul: { E: 799.8, stats: st(0) }, digging: { E: 795, areaAc: 37.6, stats: st(-5000) }, slopes: { E: 799.9, stats: st(100) } }, 799.8);
    expect(rows).toHaveLength(2);
    expect(rows[0].label).toBe("no haul · shortest slopes");
    expect(new Set(rows.map((r) => r.E)).size).toBe(rows.length);
    expect(FLOOR_SAME_FT).toBe(0.25);
    expect(floorRows({ nohaul: { E: 800, stats: st(0) }, digging: { E: 800.2, areaAc: 4, stats: st(0) }, slopes: { E: 800.1, stats: st(0) } }, 800)).toHaveLength(1);
  });
  it("the pill words", () => { expect(ffePillText(true)).toBe("AUTO · NO HAUL"); expect(ffePillText(false)).toBe("TYPED"); });
});

describe("the haul-by-floor sampler", () => {
  it("sweeps ±6 ft of the balanced floor (7 samples = every 2 ft, or every 0.5 ft for 25)", () => {
    expect(sweepFloors(800)).toEqual([794, 796, 798, 800, 802, 804, 806]);
    expect(sweepFloors(800, { count: 25 })).toHaveLength(25);
    expect(sweepFloors(800, { count: 25 })[1]).toBe(794.5);
    expect(sweepFloors(NaN)).toEqual([]);
  });
  it("the curve interpolates to every half foot and its sign changes exactly once — import above, export below", () => {
    const samples = [-9000, -5000, -1500, 600, 3200, 7000, 12000].map((h, i) => ({ E: 794 + 2 * i, haulCy: h }));
    const c = haulCurve(samples);
    expect(c).toHaveLength(25); expect(c[0].E).toBe(794); expect(c[24].E).toBe(806);
    for (let i = 1; i < c.length; i++) expect(c[i].haulCy).toBeGreaterThan(c[i - 1].haulCy);                  // raising the floor only adds import
    expect(c.filter((p, i) => i > 0 && Math.sign(p.haulCy) !== Math.sign(c[i - 1].haulCy)).length).toBe(1);   // one crossing of zero
    expect(c[0].haulCy).toBeLessThan(0); expect(c[24].haulCy).toBeGreaterThan(0);
    const z = haulZeroFloor(c);
    expect(z).toBeGreaterThan(799); expect(z).toBeLessThan(800);
    expect(interpolateHaul(samples, 798)).toBe(-1500);
    expect(interpolateHaul(samples, 790)).toBeNull();
    expect(haulZeroFloor(haulCurve([{ E: 1, haulCy: 5 }, { E: 2, haulCy: 9 }]))).toBeNull();
  });
  it("shortestSlopesFloor takes the smallest footprint and breaks ties toward the balanced floor", () => {
    expect(shortestSlopesFloor([{ E: 1, slopeSf: 9 }, { E: 2, slopeSf: 4 }, { E: 3, slopeSf: 7 }]).E).toBe(2);
    expect(shortestSlopesFloor([{ E: 1, slopeSf: 4 }, { E: 5, slopeSf: 4 }], 4.5).E).toBe(5);
    expect(shortestSlopesFloor([])).toBeNull();
  });
});

describe("the three suggested floors on a synthetic RIDGE (the real surface engine)", () => {
  // A parcel with a Gaussian ridge east of the building: cutting it down is cheap in slope footprint but dear in dirt, so the floor with
  // the shortest slopes is NOT the floor that balances the dirt.
  const ring = rect(0, 0, 1200, 900);
  const existAt = (p) => 100 + 14 * Math.exp(-((p.x - 700) ** 2) / (2 * 120 ** 2)) + 0.004 * p.y;
  const setback = gradingSetback([{ id: "pc", points: ring, setbacks: ring.map(() => 25), active: true }], 25);
  const els0 = [{ id: "b1", type: "building", ring: rect(300, 200, 500, 300) }, { id: "c1", type: "paving", truckCourt: true, attachedTo: "b1", ring: rect(300, 500, 500, 130), dockStack: { x: 550, y: 350 } }];
  const hosts = hostIdMap(els0);
  const cfg = gradingCfg({ enabled: true });
  const aIds = assemblyIds(els0, "b1");
  const statsAt = function* (F) {
    const s = buildProposedSurface({ els: els0.map((e) => ({ id: e.id, type: e.type, ring: e.ring, dockStack: e.dockStack || null, accessible: false, slopeOverridePct: null, padElevFt: e.type === "building" ? F : null, ...(e.type !== "building" ? { hostId: hosts.get(e.id) ?? null } : {}) })),
      ffeFt: null, dockDropFt: 4, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [], opts: { existKey: `ridge${F}` }, grading: gradingPack(cfg, setback) });
    return floorStatsOf(cardEarthwork(s.grid, aIds), gridDepthStats(s.grid), 0);
  };
  it("shortest slopes picks a DIFFERENT floor from no haul, and the sampled haul crosses zero once, rising", () => {
    const balE = 109.3;      // the dirt balances near here on this ground
    const r = runSync(sweepFloorStats(statsAt, balE));
    expect(r.samples.length).toBeGreaterThanOrEqual(7);
    expect(r.nohaul.E).toBeCloseTo(balE, 5);
    expect(Math.abs(r.nohaul.haulCy)).toBeLessThan(25000);            // near balance at the balanced floor (a half-foot step is ~20k CY here)
    expect(Math.abs(r.slopes.E - balE)).toBeGreaterThanOrEqual(FLOOR_SAME_FT);
    expect(r.slopes.slopeSf).toBeLessThan(r.nohaul.slopeSf);          // it really is the smaller footprint
    for (let i = 1; i < r.samples.length; i++) expect(r.samples[i].haulCy).toBeGreaterThan(r.samples[i - 1].haulCy);
    expect(r.curve[0].haulCy).toBeLessThan(0); expect(r.curve[r.curve.length - 1].haulCy).toBeGreaterThan(0);
    expect(r.curve.filter((p, i) => i > 0 && Math.sign(p.haulCy) !== Math.sign(r.curve[i - 1].haulCy)).length).toBe(1);
    const rows = floorRows({ nohaul: { E: balE, stats: r.nohaul }, slopes: { E: r.slopes.E, stats: r.slopes } }, balE);
    expect(rows.map((x) => x.key)).toEqual(["nohaul", "slopes"]);   // two distinct rows
  });
  it("gridDepthStats reads the deepest cut and tallest fill off the grid the picture uses", () => {
    const s = buildProposedSurface({ els: els0.map((e) => ({ id: e.id, type: e.type, ring: e.ring, dockStack: e.dockStack || null, accessible: false, slopeOverridePct: null, padElevFt: e.type === "building" ? 104 : null, ...(e.type !== "building" ? { hostId: hosts.get(e.id) ?? null } : {}) })),
      ffeFt: null, dockDropFt: 4, existAt, parcelRings: setback.parcelRings, pondRings: [], easementRings: [], opts: { existKey: "ridge-d" }, grading: gradingPack(cfg, setback) });
    const d = gridDepthStats(s.grid);
    expect(d.cut.ft).toBeGreaterThan(15); expect(d.fill.ft).toBeGreaterThan(2); expect(d.slopeSf).toBeGreaterThan(1000);
  });
});

describe("the Ground block carries two numbers", () => {
  it("buildable acres of the site, and the relief — nothing else", () => {
    const g = groundNumbers({ best: { areaAc: 37.46 }, parcelAc: 73.98, relief: { reliefFt: 95.2, lowFt: 719.3, highFt: 814.3 } }, { slopeRatio: 2 });
    expect(g).toEqual({ acres: "37.5 of 74 AC", acresSub: "one pad at 2:1, no walls", relief: "95 ft", reliefSub: "relief · 719 to 814" });
    expect(groundNumbers(null, { slopeRatio: 2 })).toBeNull();
  });
});

describe("source guards — the panel never comes back", () => {
  const panel = readFileSync(new URL("../src/workspaces/site-planner/components/GradingPanels.jsx", import.meta.url), "utf8");
  it("no limit-mode control, no 'Around the layout', no 'Slopes daylight inside', no steepness row, the floor has ONE editor", () => {
    for (const gone of ["Around the layout", "To the boundary", "LIMIT_MODE_OPTIONS", "GradedAreaLine", "Slopes daylight inside", "steeper than", "data-ground-row=\"steep\"", "data-grading-flag=\"clear\"", "most level ground", "Grading margin"]) expect(panel).not.toContain(gone);
    expect((panel.match(/testid="grading-ffe"/g) || []).length).toBe(1);
  });
});
