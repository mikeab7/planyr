// NEW-1 (2026-11-11) — the 3D grading viewer's DOORS: who may see the button, who may mount the viewer, and that three.js can only ever load through
// the viewer's own lazy chunk. Structural (source) checks plus a render of the button row — the repo's standing way to guard a gate (see
// gradingGate.test.js, lazyPlanner.test.js). The built-chunk half is `node ui-audit/verify-grading-3d-bundle.mjs` (needs `npm run build`).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { GradingPanel, View3dRow } from "../src/workspaces/site-planner/components/GradingPanels.jsx";

const SRC = new URL("../src", import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(jsx?|mjs)$/.test(n) ? [p] : []; });
const files = walk(SRC);
const rel = (p) => relative(SRC, p);
const read = (p) => readFileSync(p, "utf8");
const planner = read(join(SRC, "workspaces/site-planner/SitePlanner.jsx"));
const panels = read(join(SRC, "workspaces/site-planner/components/GradingPanels.jsx"));

describe("three.js loads ONLY through the viewer's lazy chunk", () => {
  it("exactly one module in src/ imports 'three': lib/grading3d/threeScene.js", () => {
    const importers = files.filter((p) => /from\s+["']three["']|import\(\s*["']three["']|require\(\s*["']three["']/.test(read(p))).map(rel);
    expect(importers).toEqual(["workspaces/site-planner/lib/grading3d/threeScene.js"]);
  });
  it("only the viewer component imports the scene module, and nothing imports the viewer except SitePlanner's lazy() door", () => {
    const sceneUsers = files.filter((p) => /(?:from|import\()\s*["'][^"']*grading3d\/threeScene(?:\.js)?["']/.test(read(p))).map(rel);
    expect(sceneUsers).toEqual(["workspaces/site-planner/components/Grading3DViewer.jsx"]);
    const viewerUsers = files.filter((p) => /(?:from|import\()\s*["'][^"']*Grading3DViewer(?:\.jsx)?["']/.test(read(p)) && !/Grading3DViewer\.jsx$/.test(p)).map(rel);
    expect(viewerUsers).toEqual(["workspaces/site-planner/SitePlanner.jsx"]);
    expect(planner).toMatch(/const Grading3DViewer = lazy\(\(\) => import\("\.\/components\/Grading3DViewer\.jsx"\)\)/);
    expect(planner).not.toMatch(/import\s+[^;\n]*Grading3DViewer[^;\n]*from/);                 // never a static import
  });
  it("the Grading panel file and the planner-side door (View3dMount) carry no three.js and no viewer import", () => {
    expect(panels).not.toMatch(/from\s+["']three["']|Grading3DViewer|threeScene/);
    const mount = read(join(SRC, "workspaces/site-planner/components/View3dMount.jsx"));
    expect(mount).not.toMatch(/from\s+["']three["']|threeScene|Grading3DViewer/);
  });
  it("the pure builders import nothing from three (so they stay unit-testable and out of any chunk that does not need them)", () => {
    for (const f of ["field", "meshBuild", "orbit", "buildModel", "colors"]) expect(read(join(SRC, `workspaces/site-planner/lib/grading3d/${f}.js`))).not.toMatch(/["']three["']/);
  });
  it("package.json pins three to ONE exact version (no caret) as a runtime dependency", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies.three).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("the gate: no button unless 'Grade this plan' is on, and the viewer is mounted only behind the owner gate", () => {
  const noop = () => {};
  it("with the plan's grading OFF the panel is the one-line empty state — no 'View in 3D', no 3D section", () => {
    const html = renderToStaticMarkup(createElement(GradingPanel, { planOn: false, model: null, onPlanOn: noop, onView3d: noop, view3dReady: true, dockDropFt: 4, onCfg: noop, onDockDrop: noop }));
    expect(html).toContain('data-grading-panel="off"');
    expect(html).not.toContain("grading-view-3d"); expect(html).not.toContain("View in 3D"); expect(html).not.toContain('data-section="view3d"');
  });
  it("while the model is still loading there is no button either (it sits past the loading early return)", () => {
    const html = renderToStaticMarkup(createElement(GradingPanel, { planOn: true, model: null, onPlanOn: noop, onView3d: noop, view3dReady: true, dockDropFt: 4, onCfg: noop, onDockDrop: noop }));
    expect(html).toContain('data-grading-panel="loading"'); expect(html).not.toContain("View in 3D");
    const body = panels.slice(panels.indexOf("const GradingPanelBody"));
    expect(body.indexOf("<View3dRow")).toBeGreaterThan(body.indexOf('view.state === "loading"'));
    expect(body.indexOf("<View3dRow")).toBeGreaterThan(body.indexOf("if (!planOn)"));
  });
  it("the row is a real button: disabled with its reason until the surface exists, enabled and calling onOpen after", () => {
    const off = renderToStaticMarkup(createElement(View3dRow, { ready: false, onOpen: noop }));
    expect(off).toContain("disabled"); expect(off).toContain("Available once the grading has finished calculating");
    const on = renderToStaticMarkup(createElement(View3dRow, { ready: true, onOpen: noop }));
    expect(on).not.toMatch(/disabled=""/); expect(on).toContain("View in 3D"); expect(on).toContain('data-testid="grading-view-3d"');
  });
  it("SitePlanner mounts the viewer only while grading is ON for the plan (grOn = the owner gate AND the per-plan switch) — a non-owner can never reach it", () => {
    expect(planner).toMatch(/\{grOn && grView3d && createPortal\(/);
    expect(planner).toMatch(/const grPlanOn = gradingOn && \(settings\.grading \|\| \{\}\)\.enabled === true;/);
    expect(planner).toMatch(/const grOn = grBase\.on;/);
    expect(planner).toMatch(/_pid === "grading" && gradingOn/);                                  // the panel itself: owner only
    // the only setter that opens it is the panel's button
    const opens = planner.match(/setGrView3d\(true\)/g) || [];
    expect(opens.length).toBe(1);
  });
  it("the viewer writes nothing to the plan: no storage, no cloud, no setEls, no history", () => {
    const v = read(join(SRC, "workspaces/site-planner/components/Grading3DViewer.jsx")) + read(join(SRC, "workspaces/site-planner/lib/grading3d/threeScene.js"));
    expect(v).not.toMatch(/localStorage|saveSite|pushHistory|setEls|cloudSync|supabase|\.from\(/);
  });
  it("every key is swallowed (capture phase) and Esc closes; React events are sealed at the portal", () => {
    const v = read(join(SRC, "workspaces/site-planner/components/Grading3DViewer.jsx"));
    expect(v).toMatch(/addEventListener\("keydown", onKey, true\)/); expect(v).toMatch(/e\.key === "Escape"/);
    const m = read(join(SRC, "workspaces/site-planner/components/View3dMount.jsx"));
    for (const ev of ["onPointerDown", "onWheel", "onKeyDown", "onContextMenu", "onClick"]) expect(m).toContain(`${ev}: stop`);
  });
});
