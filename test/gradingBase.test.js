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
    expect(c.layers).toEqual({ buildable: false, cutfill: false, contours: false, paper: true, spots: true });     // per-plan: the map layers OFF until asked for; the paper background ON (ROUND 5, NEW-6)
    expect(c.enabled).toBe(false);                                        // grading itself is OFF for a plan until switched on
  });
  it("pavement slope is never below 0.5%; ratio is 2/3/4 only; depth must be positive", () => {
    expect(gradingCfg({ pavementSlopePct: 0.1 }).pavementSlopePct).toBe(0.5);
    expect(gradingCfg({ pavementSlopePct: 2.2 }).pavementSlopePct).toBe(2.2);
    expect(gradingCfg({ slopeRatio: 3 }).slopeRatio).toBe(3);
    expect(gradingCfg({ slopeRatio: 5 }).slopeRatio).toBe(2);
    expect(gradingCfg({ maxCutFillFt: -4 }).maxCutFillFt).toBe(12);
    expect(gradingCfg({ layers: { buildable: true } }).layers).toEqual({ buildable: true, cutfill: false, contours: false, paper: true, spots: true });
    expect(GRADING_DEFAULTS.shoulderFt).toBe(5);
  });
  it("ROUND 6: the open-ground slope defaults to 2%, a typed value rides into the engine pack, a negative one is refused", () => {
    expect(GRADING_DEFAULTS.openGroundSlopePct).toBe(2);
    expect(gradingCfg(undefined).openGroundSlopePct).toBe(2);
    expect(gradingCfg({ openGroundSlopePct: 3.5 }).openGroundSlopePct).toBe(3.5);
    expect(gradingCfg({ openGroundSlopePct: -1 }).openGroundSlopePct).toBe(2);
    expect(gradingPack(gradingCfg({ openGroundSlopePct: 3.5 }), { rings: [], holes: [] }).openGroundSlopePct).toBe(3.5);
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
    expect(gradingCfg({}).layers).toEqual({ buildable: false, cutfill: false, contours: false, paper: true, spots: true });
    expect(gradingCfg({ layers: { buildable: true } }).layers).toEqual({ buildable: true, cutfill: false, contours: false, paper: true, spots: true });
    expect(gradingCfg({ layers: { cutfill: true } }).layers).toEqual({ buildable: false, cutfill: true, contours: false, paper: true, spots: true });
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
  it("Ground (NEW-1): a severity pill, TWO numbers, the show-on-map button — no floor, no steepness row, no paragraph", () => {
    const html = renderToStaticMarkup(React.createElement(GroundSection, { model: model(), onToggleBuildable() {} }));
    expect(html).toContain("37.5 of 74 AC");
    expect(html).toContain("one pad at 2:1, no walls");
    expect(html).toContain("95 ft");
    expect(html).toContain("relief · 719 to 814");
    expect(html).toContain("WORKABLE");
    expect(html.match(/data-ground-stat=/g).length).toBe(2);
    expect(html).toContain("Show buildable area on map");
    for (const gone of ["Level ground at", "best single pad", "finish 795", "steeper than 15%", "Relief across the parcel", "data-ground-row"]) expect(html).not.toContain(gone);
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

  const stats = (haulCy, cut, fill) => ({ haulCy, deepestCutFt: cut, tallestFillFt: fill, cutCy: 0, fillCy: 0, netCy: haulCy, slopeSf: 0 });
  const card = (over = {}) => ({
    id: "b1", name: "Building 1", sf: 217500, ffe: 799.8, isAuto: true, solving: false, failed: false, focus: true,
    earthwork: { cutCy: 53633, fillCy: 54248, netCy: 615, balanced: false, dirtCy: 107881 }, haulCy: 615,
    tiles: { haul: { big: "0", sub: "balanced", tone: "green", dir: "none" }, cut: { big: "53,600", sub: "deepest 14 ft" }, fill: { big: "54,200", sub: "tallest 19 ft" } },
    flags: [], flagged: false, flag: null, fixes: { id: "b1", status: "idle", ffe: null, move: null },
    floors: { pending: false, balancedE: 799.8, curve: [{ E: 794, haulCy: -9000 }, { E: 799.8, haulCy: 0 }, { E: 806, haulCy: 9000 }], rows: [
      { key: "nohaul", E: 799.8, names: ["nohaul"], label: "no haul", sub: "", stats: stats(0, 14, 19), current: true },
      { key: "digging", E: 795, names: ["digging"], label: "least digging", sub: "38 AC stays on natural grade", stats: stats(-6000, 10, 12), current: false },
      { key: "slopes", E: 802.5, names: ["slopes"], label: "shortest slopes", sub: "", stats: stats(4000, 12, 16), current: false },
    ] },
    ...over,
  });
  const group = (cards, extra = {}, props = {}) => renderToStaticMarkup(React.createElement(GradingPanel, { model: model({ cards, limit: { mode: "boundary", source: "auto", sig: "s" }, actions: { typeFfe: noop, resetFfe: noop, findSecondPad: noop, editLimit: noop, doneEditLimit: noop, resetLimit: noop }, ...extra }), dockDropFt: 4, onCfg: noop, onDockDrop: noop, onSelectBuilding: noop, onApplyFfeFix: noop, onApplyMoveFix: noop, onToggleBuildable: noop, ...props }));
  it("Grading panel: with no building it says so in one line, and the Ground section still shows", () => {
    const html = group([]);
    expect(html).toContain("Place a building to grade it.");
    expect(html).toContain('data-grading-panel="empty"');
    expect(html).toContain('data-section="ground"');
    expect(html).not.toContain("data-grading-card");
    expect(html).not.toContain('data-testid="grading-ffe"');   // no building, no floor
  });
  it("Grading panel (NEW-1): inputs, then HAUL/CUT/FILL, flags, floors, on the map, ground — in that order", () => {
    const html = group([card({ flags: [{ id: "f", kind: "depth-fill", text: "Fill reaches 31 ft on the south side. Past 12 ft, sites usually terrace or wall.", actions: ["second-pad"] }] })]);
    const at = (k) => html.indexOf(`data-section="${k}"`);
    for (const k of ["inputs", "tiles", "flags", "floors", "on-the-map", "ground"]) expect(at(k)).toBeGreaterThan(-1);
    expect(at("inputs")).toBeLessThan(at("tiles")); expect(at("tiles")).toBeLessThan(at("flags")); expect(at("flags")).toBeLessThan(at("floors"));
    expect(at("floors")).toBeLessThan(at("on-the-map")); expect(at("on-the-map")).toBeLessThan(at("ground"));
    expect(html.indexOf('data-tile="haul"')).toBeLessThan(html.indexOf('data-tile="cut"'));
    expect(html.indexOf('data-tile="cut"')).toBeLessThan(html.indexOf('data-tile="fill"'));
  });
  it("one building: no card chrome, no selector; the floor is shown in ONE place with the AUTO · NO HAUL pill", () => {
    const html = group([card()]);
    expect(html).not.toContain('data-section="buildings"');
    expect(html.match(/data-ffe-value=/g).length).toBe(1);
    expect(html).toContain('value="799.8"');
    expect(html).toContain("AUTO · NO HAUL");
    expect(html).toContain('data-ffe-source="auto"');
    expect(html).toContain("Finished floor"); expect(html).toContain("Limits of disturbance"); expect(html).toContain("ft from property line"); expect(html).toContain("Slopes");
  });
  it("Limits of disturbance shows −10 on a fresh plan (the stored inside-margin is +10) and +20 past the line", () => {
    const html = group([card()]);
    expect(html).toMatch(/data-testid="grading-limit-offset"[^>]*value="-10"/);
    const out = group([card()], { cfg: gradingCfg({ gradingMarginFt: -20 }) });
    expect(out).toMatch(/data-testid="grading-limit-offset"[^>]*value="\+20"/);
  });
  it("tiles: HAUL big number with its one-word sub-line, CUT with 'deepest', FILL with 'tallest'", () => {
    const html = group([card({ tiles: { haul: { big: "4,300", sub: "4,300 CY in", tone: "amber", dir: "in" }, cut: { big: "53,600", sub: "deepest 14 ft" }, fill: { big: "54,200", sub: "tallest 19 ft" } } })]);
    expect(html).toContain("4,300 CY in"); expect(html).toContain("deepest 14 ft"); expect(html).toContain("tallest 19 ft");
    expect(group([card()])).toContain(">balanced<");
  });
  it("a clear plan shows NO flag at all (no 'clear' line, no 'Slopes daylight' sentence)", () => {
    const html = group([card()]);
    expect(html).not.toContain("data-grading-flag"); expect(html).not.toContain("daylight inside"); expect(html).not.toContain('data-grading-flag="clear"');
  });
  it("floors table: three rows, the current one marked, the sub-label under least digging, the haul-by-floor curve beneath", () => {
    const html = group([card()]);
    expect(html.match(/data-floor-row=/g).length).toBe(3);
    expect(html).toContain("799.8 · no haul"); expect(html).toContain("795.0 · least digging"); expect(html).toContain("802.5 · shortest slopes");
    expect(html).toContain("38 AC stays on natural grade");
    expect(html).toMatch(/data-floor-row="nohaul"[^>]*data-floor-current="1"/);
    expect(html).toContain("Other floors to try"); expect(html).toContain("Haul by floor"); expect(html).toContain('data-haul-curve="1"'); expect(html).toContain('data-haul-current="1"');
  });
  it("the settings are NOT in the body: pavement slope, dock drop, buffer, terrace depth live behind the gear (which rides the header)", () => {
    const html = group([card()]);
    for (const hidden of ["Pavement slope", "Dock drop", "Max cut or fill under a pad", "Undisturbed buffer", "terrace or wall is usual", "Grading margin"]) expect(html).not.toContain(hidden);
    expect(html).not.toContain('data-grading-gear="1"');
    for (const gone of ["Around the layout", "To the boundary", "daylight inside", "faces uphill", "steeper than"]) expect(html).not.toContain(gone);
    const head = renderToStaticMarkup(React.createElement(GradingHeaderActions, { model: model({ cards: [card()] }), planOn: true, dockDropFt: 4, onCfg: noop, onDockDrop: noop }));
    expect(head).toContain('data-grading-gear="1"'); expect(head).toContain('aria-label="Grading settings"'); expect(head).toContain('data-testid="grading-plan-switch"');
  });
  it("a typed floor reads TYPED and the pill resets it", () => {
    const html = group([card({ isAuto: false, ffe: 801 })]);
    expect(html).toContain('data-ffe-source="typed"'); expect(html).toContain('data-ffe-reset="1"'); expect(html).toContain(">TYPED<");
    expect(html).toContain('value="801"');
  });
  it("solving shows an ellipsis (never an empty field)", () => {
    expect(group([card({ ffe: null, solving: true, tiles: null, floors: null })])).toContain('placeholder="…"');
    expect(group([card({ ffe: null, failed: true, tiles: null, floors: null })])).toContain('placeholder="—"');
    expect(group([card({ ffe: null, solving: true, tiles: null, floors: null })], { demStatus: "failed" })).toContain("Couldn&#x27;t read the ground");
  });
  it("several buildings: a thin selector above ONE set of blocks; ON THE MAP and GROUND appear once", () => {
    const html = group([card(), card({ id: "b2", name: "Building 2", sf: 140000, ffe: 801.2, focus: false, flagged: true, flags: [], tiles: null, floors: null })]);
    expect(html).toContain('data-section="buildings"');
    expect(html).toContain('data-card-state="open"'); expect(html).toContain('data-card-state="collapsed"');
    expect(html).toContain("Building 2 · 140,000 SF"); expect(html).toContain("801.2 ft");
    expect(html.match(/data-section="on-the-map"/g).length).toBe(1); expect(html.match(/data-section="ground"/g).length).toBe(1);
    expect(html.match(/data-ffe-value=/g).length).toBe(1);   // never two floors on screen at once
  });
  it("a flag is one sentence plus the action links it owns — the move fix reads 'Second pad' (searched on click, never on open)", () => {
    const flag = { id: "d", kind: "depth-fill", thresholdFt: 12, text: "Fill reaches 31 ft on the south side. Past 12 ft, sites usually terrace or wall.", actions: ["second-pad"] };
    const html = group([card({ flags: [flag] })]);
    expect(html).toContain("Fill reaches 31 ft on the south side. Past 12 ft, sites usually terrace or wall.");
    expect(html).toMatch(/data-fix="move"[^>]*>Second pad</);
    expect(html).not.toMatch(/<button[^>]*data-fix="move"[^>]*disabled/);
    expect(html).not.toContain("data-fix=\"wall\"");
  });
  it("with no clearing fix the link is disabled", () => {
    const flag = { id: "L", kind: "limit", text: "Fill slope runs 14 ft past the property line on the south side.", actions: ["ffe", "limit"] };
    const html = group([card({ flags: [flag], fixes: { id: "b1", status: "done", ffe: null, move: null } })]);
    expect(html).toContain("No floor clears it");
    expect(html).toMatch(/<button[^>]*data-fix="ffe"[^>]*disabled/);
  });
  it("ON THE MAP: four pills, the legend in the picture's own colours", () => {
    const html = group([card()], {}, { showSpots: true });
    for (const t of ["grading-show-on-map", "grading-show-contours", "grading-show-paper", "grading-show-spots"]) expect(html).toContain(`data-testid="${t}"`);
    for (const l of ["cut", "fill", "limit", "existing"]) expect(html).toContain(`data-legend="${l}"`);
    expect(html).toContain("rgb(181,84,28)"); expect(html).toContain("rgb(43,108,176)");
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
