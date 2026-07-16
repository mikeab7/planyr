import { describe, it, expect } from "vitest";
import { clampToBounds, initialFloatPos, reconcileForNarrow, shouldInspectorTakeDock, dockAfterRelinquish, FLOAT_MIN_WIDTH, FLOAT_SIZE } from "../src/shared/ui/floatingPanel.js";

// NEW-1 — pure geometry + docked-only decision for the poppable Site Planner panels.
// A viewport rect the size of a typical map area; card smaller than it on both axes.
const bounds = { left: 100, top: 50, width: 1000, height: 700 };
const size = { w: 340, h: 420 };

describe("clampToBounds", () => {
  it("leaves a fully-inside position unchanged", () => {
    expect(clampToBounds({ x: 300, y: 200 }, size, bounds)).toEqual({ x: 300, y: 200 });
  });
  it("snaps a position past the left/top edges back to the min inset", () => {
    expect(clampToBounds({ x: -500, y: -500 }, size, bounds, 8)).toEqual({ x: 108, y: 58 });
  });
  it("snaps a position past the right/bottom edges to the max inset", () => {
    // maxX = 100 + 1000 - 340 - 8 = 752; maxY = 50 + 700 - 420 - 8 = 322
    expect(clampToBounds({ x: 9999, y: 9999 }, size, bounds, 8)).toEqual({ x: 752, y: 322 });
  });
  it("pins a card larger than the bounds to the min edge (never negative / NaN)", () => {
    const huge = { w: 5000, h: 5000 };
    expect(clampToBounds({ x: 400, y: 400 }, huge, bounds, 8)).toEqual({ x: 108, y: 58 });
  });
  it("honours a custom margin", () => {
    expect(clampToBounds({ x: -1, y: -1 }, size, bounds, 20)).toEqual({ x: 120, y: 70 });
  });
  it("returns the position unchanged when bounds are unknown", () => {
    expect(clampToBounds({ x: 5, y: 5 }, size, null)).toEqual({ x: 5, y: 5 });
  });
});

describe("initialFloatPos", () => {
  it("opens near the bounds' top-left for index 0", () => {
    expect(initialFloatPos(bounds, 0, size, 16)).toEqual({ x: 116, y: 66 });
  });
  it("cascades by 28px per index so stacked cards don't overlap exactly", () => {
    expect(initialFloatPos(bounds, 2, size, 16, 28)).toEqual({ x: 116 + 56, y: 66 + 56 });
  });
  it("stays in-bounds even at a large index", () => {
    const p = initialFloatPos(bounds, 50, size, 16, 28);
    expect(p.x).toBeLessThanOrEqual(bounds.left + bounds.width - size.w);
    expect(p.y).toBeLessThanOrEqual(bounds.top + bounds.height - size.h);
    expect(p.x).toBeGreaterThanOrEqual(bounds.left);
    expect(p.y).toBeGreaterThanOrEqual(bounds.top);
  });
  it("falls back to a fixed spot when bounds are unknown", () => {
    expect(initialFloatPos(null)).toEqual({ x: 24, y: 96 });
  });
});

describe("reconcileForNarrow", () => {
  it("adopts the first floating id as the docked panel when the dock is empty", () => {
    expect(reconcileForNarrow({ floatingIds: ["yield", "parcel"], leftPanel: null }))
      .toEqual({ leftPanel: "yield", floating: {} });
  });
  it("keeps an existing docked panel and just closes the floaters", () => {
    expect(reconcileForNarrow({ floatingIds: ["yield"], leftPanel: "standards" }))
      .toEqual({ leftPanel: "standards", floating: {} });
  });
  it("is a no-op (empty floating) when nothing is floating", () => {
    expect(reconcileForNarrow({ floatingIds: [], leftPanel: "yield" }))
      .toEqual({ leftPanel: "yield", floating: {} });
  });
});

describe("shouldInspectorTakeDock (NEW-1 single-occupancy dock)", () => {
  it("takes over the dock when the inspector opens on desktop and isn't already docked", () => {
    expect(shouldInspectorTakeDock({ inspectorOpen: true, narrow: false, alreadyDocked: false })).toBe(true);
  });
  it("never takes over on narrow (B556: the ✎ pill opens a companion overlay, not a dock takeover)", () => {
    expect(shouldInspectorTakeDock({ inspectorOpen: true, narrow: true, alreadyDocked: false })).toBe(false);
  });
  it("doesn't take over when the inspector isn't open (a plain click selects only — B750)", () => {
    expect(shouldInspectorTakeDock({ inspectorOpen: false, narrow: false, alreadyDocked: false })).toBe(false);
  });
  it("is a no-op when the inspector already holds the dock", () => {
    expect(shouldInspectorTakeDock({ inspectorOpen: true, narrow: false, alreadyDocked: true })).toBe(false);
  });
});

describe("dockAfterRelinquish (NEW-1 restore-on-deselect/✕)", () => {
  it("restores the memoized panel while the inspector holds the dock", () => {
    expect(dockAfterRelinquish({ leftPanel: "properties", restore: "yield" })).toBe("yield");
  });
  it("closes the dock (null) when nothing was docked before the takeover", () => {
    expect(dockAfterRelinquish({ leftPanel: "properties", restore: null })).toBe(null);
    expect(dockAfterRelinquish({ leftPanel: "properties", restore: undefined })).toBe(null);
  });
  it("leaves a deliberately-switched panel untouched — the manual choice wins over the memo", () => {
    expect(dockAfterRelinquish({ leftPanel: "analysis", restore: "yield" })).toBe("analysis");
    expect(dockAfterRelinquish({ leftPanel: null, restore: "yield" })).toBe(null);
  });
});

describe("constants", () => {
  it("pins the docked-only breakpoint at 760px", () => {
    expect(FLOAT_MIN_WIDTH).toBe(760);
  });
  it("exposes a sane default footprint", () => {
    expect(FLOAT_SIZE).toEqual({ w: 340, h: 420 });
  });
});
