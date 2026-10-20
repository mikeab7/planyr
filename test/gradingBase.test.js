import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gradingCfg, gradingSetback, gradingPack, parcelsSig, hostIdMap, GRADING_DEFAULTS } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { GroundSection, GradingPanel, GradingHeaderActions } from "../src/workspaces/site-planner/components/GradingPanels.jsx";
import { decodeGrid } from "../src/workspaces/site-planner/lib/lercGrid.js";
import { lngLatToFeet } from "../src/workspaces/site-planner/lib/mapLock.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

describe("gradingCfg", () => {
  it("defaults: 1.5% pavement, 12 ft depth, 2:1", () => {
    const c = gradingCfg(undefined);
    expect([c.pavementSlopePct, c.maxCutFillFt, c.slopeRatio]).toEqual([1.5, 12, 2]);
    expect(c.layers).toEqual({ buildable: false, cutfill: false, contours: false, paper: true });     // per-plan: the map layers OFF until asked for; the paper background ON (ROUND 5, NEW-6)
    expect(c.enabled).toBe(false);                                        // grading itself is OFF for a plan until switched on
  });
  it("pavement slope is never below 0.5%; ratio is 2/3/4 only; depth must be positive", () => {
    expect(gradingCfg({ pavementSlopePct: 0.1 }).pavementSlopePct).toBe(0.5);
    expect(gradingCfg({ pavementSlopePct: 2.2 }).pavementSlopePct).toBe(2.2);
    expect(gradingCfg({ slopeRatio: 3 }).slopeRatio).toBe(3);
    expect(gradingCfg({ slopeRatio: 5 }).slopeRatio).toBe(2);
    expect(gradingCfg({ maxCutFillFt: -4 }).maxCutFillFt).toBe(12);
    expect(gradingCfg({ layers: { buildable: true } }).layers).toEqual({ buildable: true, cutfill: false, contours: false, paper: true });
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

describe("gradingCfg layer defaults", () => {
  it("Level-pad limit and Cut & Fill are both OFF until asked for; grading is a per-plan switch, OFF until turned on", () => {
    expect(gradingCfg({}).layers).toEqual({ buildable: false, cutfill: false, contours: false, paper: true });
    expect(gradingCfg({ layers: { buildable: true } }).layers).toEqual({ buildable: true, cutfill: false, contours: false, paper: true });
    expect(gradingCfg({ layers: { cutfill: true } }).layers).toEqual({ buildable: false, cutfill: true, contours: false, paper: true });
    expect(gradingCfg({}).enabled).toBe(false);
    expect(gradingCfg({ enabled: true }).enabled).toBe(true);
    expect(gradingCfg({ enabled: "yes" }).enabled).toBe(false);
  });
});

describe("panels render (static markup)", () => {
  const noop = () => {};
  const actions = { typeFfe: noop, resetFfe: noop };
  const model = (over = {}) => ({
    cfg: gradingCfg({}), setback: { usingPropertyLine: false }, demStatus: "ready",
    ground: { status: "ready", retry() {}, summary: { best: { E: 795, areaAc: 37.46 }, parcelAc: 73.98, severity: { id: "workable", label: "Workable", tone: "green" }, relief: { reliefFt: 95, lowFt: 719.3, highFt: 814.3, steepShare: 0.04 } } },
    bestFinish: 795, actions, cards: [], rock: { status: "ready", count: 0, retry: noop }, ...over,
  });
  it("Ground: the three rows, the severity pill, the show-on-map button", () => {
    const html = renderToStaticMarkup(React.createElement(GroundSection, { model: model(), onToggleBuildable() {} }));
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
  it("Ground: with the line on the same button reads Hide", () => {
    const html = renderToStaticMarkup(React.createElement(GroundSection, { model: model(), onToggleBuildable() {}, buildableOn: true }));
    expect(html).toContain(">Hide<"); expect(html).not.toContain("Show buildable area on map");
  });
  it("Ground: computing and failed states are named, never blank", () => {
    expect(renderToStaticMarkup(React.createElement(GroundSection, { model: model({ ground: { status: "computing", summary: null, retry() {} } }), onToggleBuildable() {} }))).toContain("Reading the ground");
    const f = renderToStaticMarkup(React.createElement(GroundSection, { model: model({ ground: { status: "failed", summary: null, retry() {} }, demStatus: "failed" }), onToggleBuildable() {} }));
    expect(f).toContain("Couldn&#x27;t read the ground"); expect(f).toContain("Retry");
  });

  const card = (over = {}) => ({
    id: "b1", name: "Building 1", sf: 217500, ffe: 799.8, isAuto: true, solving: false, failed: false, focus: true,
    earthwork: { cutCy: 53633, fillCy: 54248, netCy: 615, balanced: false, dirtCy: 107881 },
    flag: null, basis: "Balances the dirt: 54k CY cut on the north, 54k CY fill on the south; 600 CY import. Docks sit on the low side, so the courts drain away from the building.",
    fixes: { id: "b1", status: "idle", ffe: null, move: null },
    alt: { id: "b1", E: 795, areaAc: 37.6, cutCy: 4000, fillCy: 75000, netCy: 71000 },
    ...over,
  });
  const group = (cards, extra = {}) => renderToStaticMarkup(React.createElement(GradingPanel, { model: model({ cards, ...extra }), dockDropFt: 4, onCfg: noop, onDockDrop: noop, onSelectBuilding: noop, onApplyFfeFix: noop, onApplyMoveFix: noop, onToggleBuildable: noop }));
  it("Grading panel: with no building it says so in one line, and the Ground section still shows", () => {
    const html = group([]);
    expect(html).toContain("Place a building to grade it.");
    expect(html).toContain('data-grading-panel="empty"');
    expect(html).toContain('data-section="ground"');
    expect(html).not.toContain("data-grading-card");
  });
  it("Grading panel: cards first, the Ground section under them", () => {
    const html = group([card()]);
    expect(html).toContain('data-grading-panel="cards"');
    expect(html.indexOf("data-grading-card")).toBeGreaterThan(-1);
    expect(html.indexOf('data-section="ground"')).toBeGreaterThan(html.indexOf("data-grading-card"));
    expect(html).not.toContain("Ground › Grading");
  });
  it("Grading panel: no model yet reads as loading, never blank", () => {
    const html = renderToStaticMarkup(React.createElement(GradingPanel, { model: null }));
    expect(html).toContain("Reading the ground");
    expect(html).toContain('data-grading-panel="loading"');
  });
  it("one card: title, FFE already filled in (grey = auto), the basis, ONE alternative link, the earthwork line — and NO tab, NO chips, NO 'pick' prompt", () => {
    const html = group([card()]);
    expect(html).toContain("Building 1 · 217,500 SF");
    expect(html).toContain("FFE 799.8 ft");
    expect(html).toContain('data-ffe-source="auto"');
    expect(html).toContain("Balances the dirt: 54k CY cut on the north");
    expect(html).toContain("Or sit it on the most level ground: FFE 795 (38 AC stays level, 71k CY import)");
    expect(html).toContain("Cut 53,600 · Fill 54,200 · 600 CY import");
    expect(html).toContain("Slopes daylight inside the setback.");
    for (const gone of ["Balanced dirt", "Least dirt", "Most room", "Pick a chip", "Pick a finish elevation", "role=\"tab\"", "Walls", "data-ffe-basis"]) expect(html).not.toContain(gone);
  });
  it("the settings are NOT in the card: the pavement slope, dock drop, depth and ratio live behind the gear", () => {
    const html = group([card()]);
    for (const hidden of ["Pavement slope", "Dock drop", "Max cut or fill under a pad", "Grading slopes", "5 ft shoulder"]) expect(html).not.toContain(hidden);
    expect(html).not.toContain('data-grading-gear="1"');   // the gear rides the panel HEADER (portal slot), not the body
    const head = renderToStaticMarkup(React.createElement(GradingHeaderActions, { model: model({ cards: [card()] }), dockDropFt: 4, onCfg: noop, onDockDrop: noop }));
    expect(head).toContain('data-grading-gear="1"');
    expect(head).toContain('aria-label="Grading settings"');
  });
  it("a typed FFE is black with the small auto chip that resets", () => {
    const html = group([card({ isAuto: false, ffe: 801, basis: "Your number. Reset to auto for the balanced finish." })]);
    expect(html).toContain('data-ffe-source="typed"'); expect(html).toContain('data-ffe-reset="1"');
    expect(html).toContain('value="801"');
  });
  it("solving shows an ellipsis (never an empty field); a failed price says so", () => {
    expect(group([card({ ffe: null, solving: true, earthwork: null, basis: undefined, alt: null })])).toContain("FFE … ft");
    expect(group([card({ ffe: null, failed: true, earthwork: null, basis: undefined, alt: null })])).toContain("FFE — ft");
    expect(group([card({ ffe: null, solving: true, earthwork: null, alt: null })], { demStatus: "failed" })).toContain("no suggestion yet");
  });
  it("a balanced pad reads Balanced; an export reads CY export", () => {
    expect(group([card({ earthwork: { cutCy: 50000, fillCy: 50100, netCy: 100 } })])).toContain("Balanced");
    expect(group([card({ earthwork: { cutCy: 60000, fillCy: 50000, netCy: -10000 } })])).toContain("10,000 CY export");
  });
  it("the selected card is expanded; the rest are one line each and name their FFE", () => {
    const html = group([card(), card({ id: "b2", name: "Building 2", sf: 140000, ffe: 801.2, focus: false, flag: { text: { title: "Slope crosses the setback · East", body: "x" } } })]);
    expect(html).toContain('data-card-state="open"'); expect(html).toContain('data-card-state="collapsed"');
    expect(html).toContain("Building 2 · 140,000 SF"); expect(html).toContain("FFE 801.2 ft");
  });
  it("the flag card is exactly as shipped: side, element, overshoot, the two fixes, the disabled wall line", () => {
    const flag = { text: { title: "Slope crosses the setback · South", body: "The fill slope off the truck court runs 18 ft past the line at 2:1. Pick a fix:" } };
    const html = group([card({ flag, fixes: { id: "b1", status: "done", ffe: { ffe: 791, delta: -2.5 }, move: { distFt: 35, direction: "north", dx: 0, dy: -35 } } })]);
    expect(html).toContain("Slope crosses the setback · South");
    expect(html).toContain("Lower FFE to 791.0 ft");
    expect(html).toContain("Move building 35 ft north");
    expect(html).toMatch(/<button disabled[^>]*data-fix="wall"/);
    expect(html).not.toContain("Slopes daylight inside the setback.");
  });
  it("with no clearing fix, the buttons are disabled and say so", () => {
    const html = group([card({ flag: { text: { title: "t", body: "b" } }, fixes: { id: "b1", status: "done", ffe: null, move: null } })]);
    expect(html).toContain("No finish elevation clears it");
    expect(html).toMatch(/<button disabled[^>]*data-fix="ffe"/);
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

describe("ROUND 5 (NEW-6) — the paper background checkbox state", () => {
  it("is ON by default, per plan; only an explicit false turns it off; anything else reads as on", () => {
    expect(gradingCfg({ enabled: true }).layers.paper).toBe(true);
    expect(gradingCfg({ enabled: true, layers: { cutfill: true } }).layers.paper).toBe(true);
    expect(gradingCfg({ enabled: true, layers: { paper: false } }).layers.paper).toBe(false);
    expect(gradingCfg({ enabled: true, layers: { paper: true } }).layers.paper).toBe(true);
    expect(gradingCfg({ enabled: true, layers: { paper: null } }).layers.paper).toBe(true);
    expect(gradingCfg(null).layers.paper).toBe(true);
  });
});
