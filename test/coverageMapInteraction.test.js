import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { wheelIntent, wheelZoomFactor, isTap, zoomKeyWord, placeNear, mapHeightCap, TAP_SLOP } from "../src/workspaces/admin/lib/coverageMapInteraction.js";

describe("admin coverage map — wheel, tap and sizing rules (NEW-1/NEW-2)", () => {
  it("a plain wheel or trackpad scroll belongs to the PAGE; only a modifier (or pinch) zooms", () => {
    expect(wheelIntent({ deltaY: 120 })).toBe("scroll");
    expect(wheelIntent({ deltaY: -120, ctrlKey: false, metaKey: false })).toBe("scroll");
    expect(wheelIntent({ deltaY: -3, deltaX: 40 })).toBe("scroll");
    expect(wheelIntent({ deltaY: -120, ctrlKey: true })).toBe("zoom"); // ctrl+wheel, and a trackpad pinch
    expect(wheelIntent({ deltaY: -120, metaKey: true })).toBe("zoom");
  });

  it("zoom steps are bounded: a mouse notch ~1.8x, a pinch tick barely moves", () => {
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0 })).toBeGreaterThan(1.7);
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0 })).toBeLessThan(1.9);
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0 })).toBeCloseTo(1 / wheelZoomFactor({ deltaY: -100, deltaMode: 0 }), 6);
    expect(wheelZoomFactor({ deltaY: -4, deltaMode: 0 })).toBeLessThan(1.06);
  });

  it("a press that does not travel is a click; a real drag is not", () => {
    expect(isTap(0)).toBe(true);
    expect(isTap(TAP_SLOP)).toBe(true);
    expect(isTap(TAP_SLOP + 1)).toBe(false);
    expect(isTap(99)).toBe(false); // a pinch
  });

  it("the hint names the right modifier key", () => {
    expect(zoomKeyWord("MacIntel")).toBe("Cmd");
    expect(zoomKeyWord("Win32")).toBe("Ctrl");
    expect(zoomKeyWord("Linux x86_64")).toBe("Ctrl");
  });

  it("a card/tooltip sits beside the click, flips at an edge and never leaves the map", () => {
    const box = { w: 800, h: 500 }, size = { w: 300, h: 200 };
    expect(placeNear({ x: 100, y: 100 }, size, box)).toEqual({ x: 114, y: 114 });
    const right = placeNear({ x: 780, y: 100 }, size, box);
    expect(right.x + size.w).toBeLessThanOrEqual(box.w - 8);
    expect(right.x).toBeLessThan(780);
    const bottom = placeNear({ x: 100, y: 490 }, size, box);
    expect(bottom.y + size.h).toBeLessThanOrEqual(box.h - 8);
    const tiny = placeNear({ x: 50, y: 50 }, { w: 300, h: 200 }, { w: 320, h: 220 });
    expect(tiny.x).toBeGreaterThanOrEqual(8); expect(tiny.y).toBeGreaterThanOrEqual(8);
  });

  it("the map is capped to what is left under the header and legend, with a floor on a short window", () => {
    expect(mapHeightCap({ visibleHeight: 800, offsetTop: 220 })).toBe(564);
    expect(mapHeightCap({ visibleHeight: 800, offsetTop: 220, bottomPad: 0 })).toBe(580);
    expect(mapHeightCap({ visibleHeight: 400, offsetTop: 300 })).toBe(300);
  });

  it("the section no longer carries the developer diagnostic, and a plain wheel is never prevented in the handler", () => {
    const src = fs.readFileSync(new URL("../src/workspaces/admin/ParcelCoverageSection.jsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/wired entries not drawn/);
    expect(src).not.toMatch(/parcel-coverage-notdrawn/);
    // the scroll branch returns BEFORE the first preventDefault in the wheel handler
    const h = src.slice(src.indexOf("const onWheel"), src.indexOf('el.addEventListener("wheel"'));
    expect(h.indexOf('wheelIntent(e) === "scroll"')).toBeGreaterThan(-1);
    expect(h.indexOf("return;")).toBeLessThan(h.indexOf("e.preventDefault()"));
  });
});
