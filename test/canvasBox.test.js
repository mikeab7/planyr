/* NEW-1 — the planner canvas's viewBox IS its element box. Resizing a docked panel must never shrink
 * the drawing.
 *
 * Owner report 2026-10-06: "as I resize the left menu, it literally shrinks everything else on the
 * site." The canvas SVG is width/height 100% with viewBox "0 0 size.w size.h" and the default
 * preserveAspectRatio ("meet"); `size` was floored at 320 × 360, so a map pane under 320 px wide (or
 * 360 tall) got a viewBox bigger than itself and the browser scaled the whole drawing down.
 *
 * The pure half is here; the behavioural half (real drag, real browser, red on the pre-fix build) is
 * ui-audit/verify-panel-resize-scale.mjs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canvasBox, nextCanvasSize, framePad, CANVAS_MIN_PX } from "../src/workspaces/site-planner/lib/canvasBox.js";

const PLANNER = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");

describe("canvasBox — the box is the measured rect, at every size", () => {
  it("passes a narrow pane through unfloored (the owner's case: 152 px wide)", () => {
    expect(canvasBox({ width: 152, height: 569 })).toEqual({ w: 152, h: 569, rawW: 152, rawH: 569 });
  });
  it("passes a short pane through unfloored (the same trap vertically)", () => {
    expect(canvasBox({ width: 812, height: 299 })).toEqual({ w: 812, h: 299, rawW: 812, rawH: 299 });
  });
  it("only guards against a degenerate box, keeping it positive", () => {
    const b = canvasBox({ width: 0, height: 0 });
    expect(b.w).toBe(CANVAS_MIN_PX);
    expect(b.h).toBe(CANVAS_MIN_PX);
    expect(b.rawW).toBe(0);
    expect(canvasBox(null)).toEqual({ w: CANVAS_MIN_PX, h: CANVAS_MIN_PX, rawW: 0, rawH: 0 });
  });
  it("RED-PROOF: the pre-fix floor would have scaled a 152-px pane to 0.475", () => {
    const oldW = Math.max(320, 152);           // the removed rule, replayed
    expect(152 / oldW).toBeCloseTo(0.475, 3);  // what "meet" did to the drawing
    expect(152 / canvasBox({ width: 152, height: 500 }).w).toBe(1);
  });
});

describe("nextCanvasSize — bails on identity when nothing moved", () => {
  it("returns the previous object for the same rect", () => {
    const prev = canvasBox({ width: 400, height: 300 });
    expect(nextCanvasSize(prev, { width: 400, height: 300 })).toBe(prev);
  });
  it("returns a new box when the width changes", () => {
    const prev = canvasBox({ width: 400, height: 300 });
    expect(nextCanvasSize(prev, { width: 152, height: 300 })).toEqual({ w: 152, h: 300, rawW: 152, rawH: 300 });
  });
});

describe("framePad — a fit never asks for a negative drawable width", () => {
  it("keeps the full margin on a normal pane", () => { expect(framePad(900, 700, 60)).toBe(60); });
  it("shrinks the margin on a narrow pane so content keeps half the short side", () => {
    const pad = framePad(100, 600, 60);
    expect(100 - pad * 2).toBeGreaterThanOrEqual(50);
  });
});

describe("source guard — no floor creeps back into the planner's size", () => {
  it("SitePlanner.jsx never floors a measured width/height at a fixed size again", () => {
    // the removed rule was `Math.max(320, r.width)` / `Math.max(360, r.height)` in six places
    expect(PLANNER).not.toMatch(/Math\.max\(\s*\d{2,}\s*,\s*r\.(width|height)\s*\)/);
  });
  it("every size write goes through canvasBox / nextCanvasSize", () => {
    expect(PLANNER).toMatch(/from "\.\/lib\/canvasBox\.js"/);
    const writes = PLANNER.match(/setSize\(\(\w+\) => [^\n]*/g) || [];
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const w of writes) expect(w).toMatch(/nextCanvasSize/);
  });
  it("the canvas SVG's viewBox is built from size.w × size.h", () => {
    expect(PLANNER).toMatch(/data-testid="planner-canvas"[^>]*viewBox=\{`0 0 \$\{size\.w\} \$\{size\.h\}`\}/);
  });
});
