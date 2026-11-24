/* A drive-in ramp draws NO DOTS (owner 2026-11-24, recurrence of the 2026-11-06 "dots left on ramps" report: "I thought we talked about getting rid
 * of the dots on the ramps, but they're still showing up"). The dots were the two BOLLARD symbols (dark discs with a white keyline): at the default
 * 16-ft ramp with a 12-ft door they sat 2 ft off each jamb = exactly on the footprint's two wall corners, so they read as leftover handles. The
 * 2026-11-06 fix was to a markup cloud's corner handles, never to the ramp, so the ramp's dots were never touched — this file is the guard.
 * Drives the REAL renderer (ElNode → renderRampPx) for both layouts, both directions, all four walls, selected and not, on screen and on the
 * export (print / PDF) label frame, including an OLD record that still stores `bollards: true`. */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { newRampRecord, rampBox, rampParts } from "../src/workspaces/site-planner/lib/driveInRamp.js";
import { ElNode, resolveElNeighbors } from "../src/workspaces/site-planner/components/elementRender.jsx";
import { plannerSource } from "./helpers/plannerSource.js";

const HOST = { id: "b1", type: "building", cx: 0, cy: 0, w: 500, h: 250, rot: 0, dock: "cross" };
const settings = { showDocks: true, showGrid: true, showDims: true, floodMitigation: { dockDropFt: 4 } };
const H = { startMoveEl() {}, onElDouble() {}, startDimMove() {}, onDimNumberDown() {}, onElContext() {} };
const f2p = (p) => ({ x: p.x * 4 + 1200, y: p.y * 4 + 800 });

const render = (rampEl, { isSel = false, lf = null, host = HOST } = {}) => {
  const nb = resolveElNeighbors([host, rampEl], settings);
  return renderToStaticMarkup(createElement("svg", { xmlns: "http://www.w3.org/2000/svg" },
    createElement(ElNode, { el: rampEl, f2p, isSel, tool: "select", settings, H, nb: nb.get(rampEl.id), dimHidden: false, roadNet: null, lf, editingCorners: false })));
};
const dotCount = (svg) => (svg.match(/<(circle|ellipse)\b/g) || []).length;

describe("a drive-in ramp draws no dots", () => {
  const cases = [];
  for (const side of ["top", "bottom", "left", "right"]) for (const layout of ["straight", "along"]) for (const dir of [1, -1]) cases.push({ side, layout, dir });
  it.each(cases)("$side wall · $layout · dir $dir — unselected, selected, export frame, and an old record with bollards: true", ({ side, layout, dir }) => {
    const at = side === "top" || side === "bottom" ? 200 : 100;
    for (const legacy of [false, true]) {
      const rec = { ...newRampRecord(side, at, { layout, dir }), ...(legacy ? { bollards: true } : {}) };
      const parts = rampParts(HOST, rec, { dockHeightIn: 48 });
      expect(parts).not.toHaveProperty("bollards");
      const el = { id: "r1", type: "driveInRamp", attachedTo: "b1", noLabel: true, ramp: rec, ...rampBox(HOST, rec, { dockHeightIn: 48 }) };
      for (const isSel of [false, true]) for (const lf of [null, { ppf: 2, k: 1.5 }]) {
        const svg = render(el, { isSel, lf });
        expect(svg).toContain('data-feature="el:r1"');
        expect(dotCount(svg), `${side}/${layout}/${dir} sel=${isSel} lf=${!!lf} legacy=${legacy}`).toBe(0);
      }
    }
  });
  it("a door marker on a non-dock wall and an orphan ramp (host gone) draw no dots either", () => {
    const host = { ...HOST, dock: "front" };
    const rec = newRampRecord("left", 100);
    const el = { id: "r2", type: "driveInRamp", attachedTo: "b1", noLabel: true, ramp: rec, ...rampBox(host, rec, { marker: true }) };
    expect(dotCount(render(el, { host }))).toBe(0);
    const orphan = { ...el, attachedTo: "gone" };
    expect(dotCount(render(orphan, { isSel: true }))).toBe(0);
  });
  it("a selected ramp gets no resize / rotate grips (its size and place come from Properties)", () => {
    expect(plannerSource()).toMatch(/if \(el\.type === "driveInRamp"\) return null;/);
  });
  it("Properties carry no Bollards switch (a switch that draws nothing would lie)", async () => {
    // source-scan: the Properties panel needs the full planner harness to mount; the absence of one label is all this asserts
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/workspaces/site-planner/components/PropFields.jsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/ramp-bollards|"Bollards"/);
  });
});
