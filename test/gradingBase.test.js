import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gradingCfg, gradingSetback, gradingPack, parcelsSig, hostIdMap, GRADING_DEFAULTS } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { GroundSection, BuildingTab, GradingTabs } from "../src/workspaces/site-planner/components/GradingPanels.jsx";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet } from "../src/workspaces/site-planner/lib/mapLock.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

describe("gradingCfg", () => {
  it("defaults: 1.5% pavement, 12 ft depth, 2:1", () => {
    const c = gradingCfg(undefined);
    expect([c.pavementSlopePct, c.maxCutFillFt, c.slopeRatio]).toEqual([1.5, 12, 2]);
    expect(c.layers).toEqual({ buildable: false, cutfill: false });
  });
  it("pavement slope is never below 0.5%; ratio is 2/3/4 only; depth must be positive", () => {
    expect(gradingCfg({ pavementSlopePct: 0.1 }).pavementSlopePct).toBe(0.5);
    expect(gradingCfg({ pavementSlopePct: 2.2 }).pavementSlopePct).toBe(2.2);
    expect(gradingCfg({ slopeRatio: 3 }).slopeRatio).toBe(3);
    expect(gradingCfg({ slopeRatio: 5 }).slopeRatio).toBe(2);
    expect(gradingCfg({ maxCutFillFt: -4 }).maxCutFillFt).toBe(12);
    expect(gradingCfg({ layers: { buildable: true } }).layers).toEqual({ buildable: true, cutfill: false });
    expect(GRADING_DEFAULTS.shoulderFt).toBe(5);
  });
});

describe("gradingSetback — the existing setback feature, else the property line", () => {
  const pc = { id: "a", points: rect(0, 0, 400, 300), active: true };
  it("a parcel with a setback value uses its inset polygon", () => {
    const s = gradingSetback([{ ...pc, setbacks: [50, 25, 25, 25] }], 0);
    expect(s.usingPropertyLine).toBe(false);
    expect(s.rings).toHaveLength(1);
    const xs = s.rings[0].map((p) => p.x), ys = s.rings[0].map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(25, 0); expect(Math.min(...ys)).toBeCloseTo(50, 0);
  });
  it("the plan default setback counts as a setback", () => {
    expect(gradingSetback([pc], 25).usingPropertyLine).toBe(false);
  });
  it("no setback anywhere → the parcel line, and it SAYS so", () => {
    const s = gradingSetback([pc], 0);
    expect(s.usingPropertyLine).toBe(true);
    expect(s.rings[0]).toEqual(pc.points);
  });
  it("save-and-except carve-outs ride along as holes", () => {
    const s = gradingSetback([{ ...pc, exceptions: [{ pts: rect(100, 100, 50, 50) }] }], 25);
    expect(s.holes).toHaveLength(1);
  });
  it("parcelsSig is a stable VALUE signature (a fresh array of equal parcels is the same key)", () => {
    expect(parcelsSig([{ ...pc }], 25)).toBe(parcelsSig([{ ...pc }], 25));
    expect(parcelsSig([pc], 25)).not.toBe(parcelsSig([pc], 30));
    expect(parcelsSig([pc], 25)).not.toBe(parcelsSig([{ ...pc, points: rect(0, 0, 401, 300) }], 25));
  });
  it("gradingPack carries the owner's rules into the engine", () => {
    const p = gradingPack(gradingCfg({ pavementSlopePct: 2 }), gradingSetback([pc], 25));
    expect([p.pavementSlopePct, p.lotDropFt, p.slopeRatio, p.shoulderFt]).toEqual([2, 0.5, 2, 5]);
    expect(p.setbackRings).toHaveLength(1);
  });
  it("hostIdMap climbs attachedTo to the building; unattached layers have none", () => {
    const m = hostIdMap([{ id: "b", type: "building" }, { id: "c", type: "paving", attachedTo: "b" }, { id: "t", type: "trailer", attachedTo: "c" }, { id: "x", type: "paving" }]);
    expect(m.get("c")).toBe("b"); expect(m.get("t")).toBe("b"); expect(m.has("x")).toBe(false); expect(m.has("b")).toBe(false);
  });
});

describe("panels render (static markup)", () => {
  const model = (over = {}) => ({
    cfg: gradingCfg({}), setback: { usingPropertyLine: false }, demStatus: "ready",
    ground: { status: "ready", retry() {}, summary: { best: { E: 795, areaAc: 37.46 }, parcelAc: 73.98, severity: { id: "workable", label: "Workable", tone: "green" }, relief: { reliefFt: 95, lowFt: 719.3, highFt: 814.3, steepShare: 0.04 } } },
    bestFinish: 795, actions: { typeFfe() {}, pickBasis() {} }, building: null, ...over,
  });
  it("Ground: the three rows, the severity pill, the show-on-map button", () => {
    const html = renderToStaticMarkup(React.createElement(GroundSection, { model: model(), onShowBuildable() {} }));
    expect(html).toContain("Level ground at 2:1, no walls");
    expect(html).toContain("37.5 of 74.0 AC");
    expect(html).toContain("best single pad, finish 795 ft · no more than 12 ft of cut or fill");
    expect(html).toContain("Workable");
    expect(html).toContain("Relief across the parcel");
    expect(html).toContain("95 ft · 719 to 814");
    expect(html).toContain("Ground steeper than 15%");
    expect(html).toContain(">4%<");
    expect(html).toContain("Show buildable area on map");
  });
  it("Ground: computing and failed states are named, never blank", () => {
    expect(renderToStaticMarkup(React.createElement(GroundSection, { model: model({ ground: { status: "computing", summary: null, retry() {} } }), onShowBuildable() {} }))).toContain("Reading the ground");
    const f = renderToStaticMarkup(React.createElement(GroundSection, { model: model({ ground: { status: "failed", summary: null, retry() {} }, demStatus: "failed" }), onShowBuildable() {} }));
    expect(f).toContain("Couldn&#x27;t read the ground"); expect(f).toContain("Retry");
  });
  const bModel = (flag) => model({ building: {
    id: "b", ffe: 793.5, basis: "balanced", solving: null, extra: 0, noSurface: false, court: null, courtDrop: "789.5 → 787.5 ft", spots: [],
    earthwork: { cutCy: 38000, fillCy: 37000, netCy: -1000, balanced: false, dirtCy: 75000 },
    flag, fixes: { status: "done", ffe: { ffe: 791, delta: -2.5 }, move: { distFt: 35, direction: "north", dx: 0, dy: -35 } },
  } });
  it("Building tab: chips, FFE, court readout, tiles, no-walls pill", () => {
    const html = renderToStaticMarkup(React.createElement(BuildingTab, { model: bModel(null), dockDropFt: 4, renderNumber: "1", wallRows: [{ key: "dock", badge: "S", role: "dock", layers: [{ label: "Court", depth: 130 }] }], onCfg() {}, onDockDrop() {}, onApplyFfeFix() {}, onApplyMoveFix() {} }));
    for (const t of ["Balanced dirt", "Least dirt", "Most room", "789.5 → 787.5 ft", "38,000", "37,000", "CY cut", "CY fill", "CY export", "no walls · 5 ft shoulder", "Bank volumes, no stripping or shrink", "Slopes daylight inside the setback.", "Court 130′"]) expect(html).toContain(t);
    expect(html).toContain('aria-pressed="true"');
  });
  it("Building tab: the flag card with both fixes and the disabled wall option", () => {
    const flag = { text: { title: "Slope crosses the setback · South", body: "The fill slope off the truck court runs 18 ft past the line at 2:1. Pick a fix:" } };
    const html = renderToStaticMarkup(React.createElement(BuildingTab, { model: bModel(flag), dockDropFt: 4, renderNumber: "1", wallRows: [], onCfg() {}, onDockDrop() {}, onApplyFfeFix() {}, onApplyMoveFix() {} }));
    expect(html).toContain("Slope crosses the setback · South");
    expect(html).toContain("Lower FFE to 791.0 ft");
    expect(html).toContain("Move building 35 ft north");
    expect(html).toMatch(/<button disabled[^>]*data-fix="wall"/);
  });
  it("Building tab: with no clearing fix, the buttons are disabled and say so", () => {
    const m = bModel({ text: { title: "t", body: "b" } }); m.building.fixes = { status: "done", ffe: null, move: null };
    const html = renderToStaticMarkup(React.createElement(BuildingTab, { model: m, dockDropFt: 4, renderNumber: "1", wallRows: [], onCfg() {}, onDockDrop() {}, onApplyFfeFix() {}, onApplyMoveFix() {} }));
    expect(html).toContain("No finish elevation clears it");
    expect(html).toMatch(/<button disabled[^>]*data-fix="ffe"/);
  });
  it("Tabs: the strip only exists while a building is selected", () => {
    expect(renderToStaticMarkup(React.createElement(GradingTabs, { tab: "analysis", onTab() {}, showBuilding: false }, "x"))).not.toContain("Building");
    expect(renderToStaticMarkup(React.createElement(GradingTabs, { tab: "building", onTab() {}, showBuilding: true }, "x"))).toContain("Building");
  });
});

describe("terrain worker — the buildable job protocol", () => {
  it("summary, then a mask without re-shipping the DEM, and a LOUD no-context for an unknown key", async () => {
    const posts = [];
    globalThis.self = { postMessage: (m) => posts.push(m) };
    await import("../src/workspaces/site-planner/lib/terrainWorker.js");
    const F = fileURLToPath(new URL("./fixtures/chehaw-218-02007", import.meta.url));
    const b = readFileSync(F + ".lerc");
    const req = JSON.parse(readFileSync(F + ".req.json", "utf8"));
    const grid = decodeGrid(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), req);
    const pj = JSON.parse(readFileSync(F + ".parcel.json", "utf8"));
    const ll = pj.ringLngLat.slice(0, -1);
    const lat0 = ll.reduce((a, p) => a + p[1], 0) / ll.length, lon0 = ll.reduce((a, p) => a + p[0], 0) / ll.length;
    const ring = ll.map(([lo, la]) => lngLatToFeet(lo, la, lon0, lat0));
    const base = { kind: "buildable", key: "k1", origin: { lat: lat0, lon: lon0 }, rings: [ring], holes: [], parcelRings: [ring], cell: 10, marginFt: 200, s: 2, D: 12 };
    globalThis.self.onmessage({ data: { id: 1, op: "summary", ...base, dem: { grid, req } } });
    const sum = posts.find((p) => p.id === 1);
    expect(sum.ok).toBe(true);
    expect(sum.summary.best.areaAc).toBeGreaterThan(35);
    globalThis.self.onmessage({ data: { id: 2, op: "mask", ...base, E: sum.summary.best.E } });
    const m = posts.find((p) => p.id === 2);
    expect(m.ok).toBe(true);
    expect(m.mask).toBeInstanceOf(Uint8Array);
    expect(m.cells).toBeGreaterThan(1000);
    globalThis.self.onmessage({ data: { id: 3, op: "mask", ...base, key: "never-seen", E: 795 } });
    expect(posts.find((p) => p.id === 3)).toMatchObject({ ok: false, error: "no-context" });
  });
});
