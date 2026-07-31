/* Geometry level-of-detail (NEW-2) — the stall-striping collapse.
 *
 * The pixel proof lives in ui-audit/verify-stall-lod-parity.mjs, which needs two builds and a
 * browser. These are the parts that can go red in `npm test`, and they are the parts most likely
 * to be broken by a well-meaning later edit:
 *
 *   • the gate is expressed in LABEL-FRAME px (px / lfK), so an export at the sheet's scale
 *     decides for itself instead of inheriting whatever zoom the canvas was at. Get this wrong
 *     and a wide-zoom PDF silently loses its stalls — the mandatory export-parity requirement.
 *   • the collapsed form carries the SAME segments. `segmentsPath` is where that is true or not.
 *   • the stall COUNT comes from carStalls().count, a different code path from the render, and
 *     nothing here may touch it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STALL_PITCH_MIN_PX, stallStripesExplicit, segmentsPath } from "../src/workspaces/site-planner/lib/labelLayout.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const planner = readFileSync(join(ROOT, "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
const labels = readFileSync(join(ROOT, "src/workspaces/site-planner/lib/labelLayout.js"), "utf8");

describe("the stall-striping gate", () => {
  it("keeps the explicit per-stall path wherever a stall is resolvable", () => {
    // A 9′ stall at a detail zoom.
    expect(stallStripesExplicit(9 * 1.0)).toBe(true);
    expect(stallStripesExplicit(STALL_PITCH_MIN_PX)).toBe(true);
  });

  it("collapses only where the marks are finer than the threshold", () => {
    expect(stallStripesExplicit(9 * 0.02)).toBe(false);   // site overview — 0.18px pitch
    expect(stallStripesExplicit(9 * 0.35)).toBe(false);   // working zoom — 3.15px pitch
    expect(stallStripesExplicit(STALL_PITCH_MIN_PX - 0.001)).toBe(false);
  });

  it("is measured on the LABEL frame, so an EXPORT decides at the sheet's scale", () => {
    // The same canvas pitch, judged on a sheet whose scale is 8x the screen's: what reads as
    // sub-pixel on a zoomed-out canvas is a clearly-drawn stall on the paper, and must stay
    // explicit there. This is the whole of the export-parity requirement, in one assertion.
    const canvasPitchPx = 9 * 0.02;
    expect(stallStripesExplicit(canvasPitchPx, 1)).toBe(false);        // on screen: collapse
    expect(stallStripesExplicit(canvasPitchPx, 1 / 40)).toBe(true);    // on the sheet: explicit
  });

  it("treats a missing or zero lfK as 1 rather than dividing by zero", () => {
    expect(stallStripesExplicit(9, 0)).toBe(true);
    expect(stallStripesExplicit(0.18, 0)).toBe(false);
  });
});

describe("the collapsed form carries the same segments", () => {
  it("emits one subpath per segment, with the segment's own endpoints", () => {
    const segs = [[1, 2, 3, 4], [10, 20, 10, 40]];
    expect(segmentsPath(segs)).toBe("M1 2L3 4M10 20L10 40");
    expect((segmentsPath(segs).match(/M/g) || []).length).toBe(segs.length);
  });

  it("carries a LEAN through unchanged — an angled stall field is not excluded", () => {
    // The pattern approach that was tried first could not express a lean at all (the tile clips
    // it). The path form can, which is why angled fields collapse too.
    expect(segmentsPath([[0, 0, 5, 18]])).toBe("M0 0L5 18");
  });

  it("is empty for no segments, so an empty band pushes no node", () => {
    expect(segmentsPath([])).toBe("");
  });
});

describe("the wiring, guarded at the source", () => {
  it("both collapse call sites pass lfK, not a bare canvas px", () => {
    const calls = planner.match(/stallStripesExplicit\([^)]*\)/g) || [];
    expect(calls.length, "parking and trailer both gate").toBe(2);
    for (const c of calls) expect(c, `${c} must be judged on the label frame`).toMatch(/lfK/);
  });

  it("the stall COUNT still comes from carStalls().count, untouched by the render change", () => {
    expect(planner).toMatch(/carStalls\(e\.w, e\.h, cfgOf\(e\)\)\.count/);
  });

  it("the dock-door leaves are NOT collapsed — that half was measured and rejected", () => {
    // 23/255 on up to 0.41% of pixels, because a leaf's fill is semi-transparent. If a later
    // change reintroduces it, this goes red and points at the measurement rather than at taste.
    expect(planner).not.toMatch(/rectsPath/);
    expect(labels).not.toMatch(/dockLeavesExplicit/);
    expect(labels, "the reason must stay on the record next to the gate").toMatch(/SEMI-TRANSPARENT/);
  });
});
