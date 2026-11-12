// NEW-1 — "Fit the biggest building": the DOORS. Who may see the button (only inside the owner-only Grading panel, past its "off" and "loading" early
// returns), that the search code is reached only through the lazy grading chunk and the terrain worker (the planner's main chunk gains none of it),
// and what the card says in each state. Structural (source) checks plus renders — the repo's standing way to guard a gate (see grading3dGate.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { GradingPanel, FitBuildingRow, fitNetWords } from "../src/workspaces/site-planner/components/GradingPanels.jsx";

const SRC = new URL("../src", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs)$/.test(n) ? [p] : []; });
const files = walk(SRC), rel = (p) => relative(SRC, p), read = (p) => readFileSync(p, "utf8");
const importersOf = (re) => files.filter((p) => re.test(read(p))).map(rel).sort();
const planner = read(join(SRC, "workspaces/site-planner/SitePlanner.jsx"));
const panels = read(join(SRC, "workspaces/site-planner/components/GradingPanels.jsx"));

describe("the search code stays out of the always-loaded planner", () => {
  it("lib/fitBuilding.js is imported only by the terrain worker and the template module", () => {
    expect(importersOf(/from\s+["'][^"']*\/fitBuilding(?:\.js)?["']/)).toEqual(["workspaces/site-planner/lib/fitTemplate.js", "workspaces/site-planner/lib/terrainWorker.js"]);
  });
  it("lib/fitTemplate.js is imported only by the lazy grading controller", () => {
    expect(importersOf(/from\s+["'][^"']*\/fitTemplate(?:\.js)?["']/)).toEqual(["workspaces/site-planner/components/GradingController.jsx"]);
  });
  it("the client door (fitBuildingJob) is reached only by a dynamic import inside the controller", () => {
    const ctl = read(join(SRC, "workspaces/site-planner/components/GradingController.jsx"));
    expect(ctl).toMatch(/await import\("\.\.\/lib\/buildableClient\.js"\)/);
    expect(importersOf(/from\s+["'][^"']*\/buildableClient(?:\.js)?["']/)).toEqual([]);
  });
  it("SitePlanner.jsx imports none of the fit modules (its two functions are plain closures)", () => {
    expect(planner).not.toMatch(/fitBuilding|fitTemplate/);
    expect(planner).toMatch(/const grFitSource =/); expect(planner).toMatch(/const grApplyFit =/);
  });
  it("one undoable action: Use this takes exactly one history frame and resizes through the planner's own refitChildren", () => {
    const body = planner.slice(planner.indexOf("const grApplyFit ="), planner.indexOf("const grBldgName ="));
    expect((body.match(/pushHistory\(\)/g) || []).length).toBe(1);
    expect(body).toMatch(/refitChildren\(a, b\.id,/);
    expect(body).toMatch(/makeCourtZone\(nb, side\)/);          // no building on the plan: a cross-dock with its court + trailer + buffer
  });
  it("the fence is the plan's limit of disturbance (the grading pack's rings), not the setback", () => {
    const ctl = read(join(SRC, "workspaces/site-planner/components/GradingController.jsx"));
    expect(ctl).toMatch(/fence: \{ rings: pack\.setbackRings, holes: pack\.limit\.setbackHoles/);
  });
  it("the regrade banner shows the work (job 'fit'), and a stale answer is cleared when the layout or rules move", () => {
    const ctl = read(join(SRC, "workspaces/site-planner/components/GradingController.jsx"));
    expect(ctl).toMatch(/regrade\.begin\("fit"\)/);
    expect(ctl).toMatch(/F\.key !== fitKey/);
  });
});

describe("the button lives only inside the owner-only Grading panel, past its early returns", () => {
  const noop = () => {};
  it("plan switched off → no Fit button; model still loading → none either", () => {
    const off = renderToStaticMarkup(createElement(GradingPanel, { planOn: false, model: null, onPlanOn: noop, dockDropFt: 4, onCfg: noop, onDockDrop: noop }));
    expect(off).not.toContain("grading-fit-building"); expect(off).not.toContain("Fit the biggest building");
    const loading = renderToStaticMarkup(createElement(GradingPanel, { planOn: true, model: null, onPlanOn: noop, dockDropFt: 4, onCfg: noop, onDockDrop: noop }));
    expect(loading).not.toContain("Fit the biggest building");
    const body = panels.slice(panels.indexOf("const GradingPanelBody"));
    expect(body.indexOf("<FitBuildingRow")).toBeGreaterThan(body.indexOf('view.state === "loading"'));
    expect(body.indexOf("<FitBuildingRow")).toBeGreaterThan(body.indexOf("if (!planOn)"));
  });
  it("the panel itself is the owner-gated one (planner mounts it behind gradingOn)", () => {
    expect(planner).toMatch(/_pid === "grading" && gradingOn/);
  });
});

describe("the row in each state", () => {
  const html = (fit) => renderToStaticMarkup(createElement(FitBuildingRow, { fit })).replace(/&#x27;/g, "'");
  const btn = (h) => (h.match(/<button[^>]*data-testid="grading-fit-building"[^>]*>/) || [""])[0];
  it("no model → nothing", () => { expect(html(null)).toBe(""); });
  it("idle: one button, disabled until the ground has loaded", () => {
    const a = html({ status: "idle", ready: false }), b = html({ status: "idle", ready: true });
    expect(a).toContain("Fit the biggest building"); expect(btn(a)).toContain("disabled");
    expect(btn(b)).not.toContain("disabled");
    expect(b).not.toContain("grading-fit-card");
  });
  it("running: the button says so and is disabled (the banner shows the work)", () => {
    const h = html({ status: "running" });
    expect(h).toContain("Fitting…"); expect(btn(h)).toContain("disabled");
  });
  const ready = (over = {}) => ({ status: "ready", shownIs: "best", createsBuilding: false,
    card: { sf: 439000, lengthFt: 784, depthFt: 560, ffe: 795, cutCy: 138969, fillCy: 32778, netCy: -106191, pastLimit: 0, engine: true },
    other: { sf: 383000, ffe: 801, balanced: true }, use() {}, dismiss() {}, swap() {}, ...over });
  it("ready: SF, dimensions, finished floor, cut / fill / net, Use this + Dismiss, ONE alternative as a link — no paragraphs", () => {
    const h = html(ready());
    expect(h).toContain("439,000 SF"); expect(h).toContain("784 × 560 ft"); expect(h).toContain("Finished floor 795");
    expect(h).toContain("Cut 139,000 · Fill 33,000 · 106,000 CY export");
    expect(h).toContain("grading-fit-use"); expect(h).toContain("grading-fit-dismiss");
    expect(h).toContain("Or balance the dirt: 383,000 SF, FFE 801");
    expect((h.match(/data-testid="grading-fit-alt"/g) || []).length).toBe(1);
  });
  it("showing the alternative offers the way back, never a third option", () => {
    const h = html(ready({ shownIs: "alt", card: { sf: 383000, lengthFt: 1008, depthFt: 380, ffe: 801, cutCy: 75049, fillCy: 73473, netCy: -1576, pastLimit: 0 }, other: { sf: 439000, ffe: 795 } }));
    expect(h).toContain("Or the biggest: 439,000 SF, FFE 795"); expect(h).toContain("383,000 SF");
    expect((h.match(/data-testid="grading-fit-alt"/g) || []).length).toBe(1);
  });
  it("no alternative → no link; a layout whose slope still runs past the limit says so in one line", () => {
    const h = html(ready({ other: null, card: { sf: 439000, lengthFt: 784, depthFt: 560, ffe: 795, cutCy: 1, fillCy: 1, netCy: 0, pastLimit: 12 } }));
    expect(h).not.toContain("grading-fit-alt"); expect(h).toContain("Its slope runs past the limit.");
  });
  it("V2115882 — a building that breaks a rule shows the card as usual PLUS one plain line naming the rule and the amount", () => {
    const card = { sf: 86000, lengthFt: 392, depthFt: 220, ffe: 794, cutCy: 9000, fillCy: 12000, netCy: 3000, pastLimit: 0 };
    const h = html(ready({ card: { ...card, breaks: [{ rule: "cutfill", limitFt: 2, actualFt: 4.5 }] } }));
    expect(h).toContain("grading-fit-card"); expect(h).toContain("Use this"); expect(h).toContain("Dismiss");
    expect(h).toContain("Breaks the max cut / fill: 4.5 ft under the building, the limit is 2 ft.");
    const h2 = html(ready({ card: { ...card, pastLimit: 3, pastFt: 12.4, breaks: [{ rule: "cutfill", limitFt: 2, actualFt: 45 }, { rule: "limit" }] } }));
    expect(h2).toContain("Breaks the max cut / fill: 45 ft under the building, the limit is 2 ft.");
    expect(h2).toContain("Breaks the limits: its slope runs about 12 ft past them.");
    expect(h2).not.toContain("Its slope runs past the limit.");
    expect(html(ready({ card: { ...card, breaks: [] } }))).not.toContain("Breaks the");
  });
  it("the only message left for 'nothing fits' is a setback that cannot hold the smallest building — said as that", () => {
    expect(html({ status: "nofit", why: "no-room", dismiss() {} })).toContain("The setbacks leave no room for even the smallest building.");
  });
  it("nothing fits / failed are one plain line each", () => {
    expect(html({ status: "nofit", why: "no-fit", dismiss() {} })).toContain("No building fits inside the limits with these rules.");
    expect(html({ status: "failed" })).toContain("Couldn't finish the search.");
  });
  it("net dirt in words", () => {
    expect(fitNetWords(-1200)).toBe("1,200 CY export"); expect(fitNetWords(30000)).toBe("30,000 CY import"); expect(fitNetWords(300)).toBe("balanced");
  });
});
