import { describe, it, expect } from "vitest";
import {
  worldToScreen, screenToWorld, zoomAround, panBy, fitView, shouldPan, clampNum,
} from "../src/shared/viewport/viewportTransform.js";

describe("viewport transform — world<->screen round trip", () => {
  const v = { scale: 0.5, tx: 60, ty: 40 };
  it("worldToScreen applies scale then offset", () => {
    expect(worldToScreen(v, { x: 100, y: 200 })).toEqual({ x: 100 * 0.5 + 60, y: 200 * 0.5 + 40 });
  });
  it("screenToWorld is the exact inverse", () => {
    const p = { x: 137, y: -22 };
    const back = screenToWorld(v, worldToScreen(v, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});

describe("zoomAround — cursor-anchored zoom", () => {
  it("keeps the world point under the anchor fixed", () => {
    const v = { scale: 1, tx: 0, ty: 0 };
    const ax = 300, ay = 150;
    const before = screenToWorld(v, { x: ax, y: ay });
    const nv = zoomAround(v, 1.12, ax, ay);
    const after = screenToWorld(nv, { x: ax, y: ay });
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(nv.scale).toBeCloseTo(1.12, 9);
  });

  it("matches the Site Planner's exact inline wheel formula", () => {
    // The legacy code: fx=(mx-offX)/ppf; ppf'=clamp(.02,8,ppf*f); offX'=mx-fx*ppf'
    const ppf = 0.35, offX = 60, offY = 80, mx = 220, my = 130, f = 1.12;
    const fx = (mx - offX) / ppf, fy = (my - offY) / ppf;
    const ppf2 = Math.max(0.02, Math.min(8, ppf * f));
    const legacy = { ppf: ppf2, offX: mx - fx * ppf2, offY: my - fy * ppf2 };
    const nv = zoomAround({ scale: ppf, tx: offX, ty: offY }, f, mx, my, 0.02, 8);
    expect(nv.scale).toBeCloseTo(legacy.ppf, 9);
    expect(nv.tx).toBeCloseTo(legacy.offX, 9);
    expect(nv.ty).toBeCloseTo(legacy.offY, 9);
  });

  it("clamps scale but still holds the anchor put at the clamp", () => {
    const v = { scale: 7.5, tx: 10, ty: 10 };
    const ax = 200, ay = 200;
    const before = screenToWorld(v, { x: ax, y: ay });
    const nv = zoomAround(v, 4, ax, ay, 0.02, 8); // 7.5*4 clamps to 8
    expect(nv.scale).toBe(8);
    const after = screenToWorld(nv, { x: ax, y: ay });
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe("panBy", () => {
  it("shifts the offset by the screen delta, scale unchanged", () => {
    expect(panBy({ scale: 0.5, tx: 10, ty: 20 }, 5, -7)).toEqual({ scale: 0.5, tx: 15, ty: 13 });
  });
});

describe("fitView", () => {
  it("page mode fits the whole box and centres it", () => {
    const v = fitView(1000, 500, 400, 400, { pad: 0, mode: "page" });
    expect(v.scale).toBeCloseTo(0.4, 9);          // limited by width (400/1000)
    expect(v.tx).toBeCloseTo((400 - 1000 * 0.4) / 2, 9); // 0
    expect(v.ty).toBeCloseTo((400 - 500 * 0.4) / 2, 9);  // 100 → vertically centred
  });
  it("width mode fits width and lets height overflow", () => {
    const v = fitView(1000, 5000, 400, 400, { pad: 0, mode: "width" });
    expect(v.scale).toBeCloseTo(0.4, 9);
  });
});

describe("shouldPan — Bluebeam pan/tool collision", () => {
  it("middle-mouse always pans, even with a drawing tool", () => {
    expect(shouldPan({ button: 1, tool: "area" })).toBe(true);
    expect(shouldPan({ button: 1, tool: "select", onObject: true })).toBe(true);
  });
  it("Space-hold pans over any tool", () => {
    expect(shouldPan({ spaceHeld: true, tool: "distance" })).toBe(true);
  });
  it("the Pan tool pans", () => {
    expect(shouldPan({ tool: "pan" })).toBe(true);
  });
  it("Select pans on empty canvas but selects/moves on an object", () => {
    expect(shouldPan({ tool: "select", onObject: false })).toBe(true);
    expect(shouldPan({ tool: "select", onObject: true })).toBe(false);
  });
  it("a drawing/measure tool draws (never pans) on a left drag", () => {
    expect(shouldPan({ button: 0, tool: "rect" })).toBe(false);
    expect(shouldPan({ button: 0, tool: "count" })).toBe(false);
  });
});

describe("clampNum", () => {
  it("clamps to range", () => {
    expect(clampNum(5, 0, 3)).toBe(3);
    expect(clampNum(-1, 0, 3)).toBe(0);
    expect(clampNum(2, 0, 3)).toBe(2);
  });
});
