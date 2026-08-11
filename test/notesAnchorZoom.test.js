/* The pure halves of "a block that stays put" (NEW-2) and "make the writing bigger" (NEW-3).
 *
 * The GEOMETRY — that a double-clicked block renders at the point pressed — is not provable
 * here and is not attempted here: it is asserted in a real browser, against real rects, by
 * ui-audit/verify-notes-anchor-zoom.mjs. That split is deliberate. The previous three rounds
 * of NEW-2 all passed checks that were true and did not answer the question; a unit test that
 * claimed to cover placement would be a fourth.
 *
 * What IS provable without a browser is every rule the browser then applies: the clamp, the
 * zoom ladder, what each gesture means, and the scroll arithmetic that keeps the same writing
 * under the eye across a step.
 */
import { describe, expect, it } from "vitest";

import { clampAnchor, ANCHOR_EDGE_PAD, ANCHOR_MIN_WIDTH } from "../src/workspaces/notes/lib/notesAnchorNode.js";
import {
  normalizeZoom, scrollTopAfterZoom, stepZoom, zoomForKey, zoomForWheel, zoomLabel, zoomKey,
  ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS,
} from "../src/workspaces/notes/lib/notesZoom.js";

describe("clampAnchor — a block is never dropped half off the page", () => {
  const box = { width: 800, height: 600 };

  it("leaves a point that is already inside exactly where it was", () => {
    expect(clampAnchor({ x: 420, y: 245, ...box })).toEqual({ x: 420, y: 245 });
  });

  it("pulls a point beyond the right or bottom edge back inside", () => {
    const c = clampAnchor({ x: 5000, y: 5000, ...box, blockWidth: 180, blockHeight: 24 });
    expect(c.x).toBe(800 - 180 - ANCHOR_EDGE_PAD);
    expect(c.y).toBe(600 - 24 - ANCHOR_EDGE_PAD);
  });

  it("never lets it sit at a negative offset", () => {
    expect(clampAnchor({ x: -400, y: -9, ...box })).toEqual({ x: ANCHOR_EDGE_PAD, y: ANCHOR_EDGE_PAD });
  });

  it("survives a box smaller than the block itself rather than producing nonsense", () => {
    const c = clampAnchor({ x: 50, y: 50, width: 40, height: 10 });
    expect(c.x).toBe(ANCHOR_EDGE_PAD);
    expect(c.y).toBe(ANCHOR_EDGE_PAD);
  });

  it("rounds to whole pixels — a stored position is a number somebody may read", () => {
    expect(clampAnchor({ x: 100.4, y: 200.6, ...box })).toEqual({ x: 100, y: 201 });
  });

  it("refuses nonsense input instead of writing NaN into the document", () => {
    expect(clampAnchor({ x: undefined, y: "abc", ...box })).toEqual({ x: ANCHOR_EDGE_PAD, y: ANCHOR_EDGE_PAD });
    expect(ANCHOR_MIN_WIDTH).toBeGreaterThan(0);
  });
});

describe("the zoom ladder", () => {
  it("100% is on it, and is where a reset goes", () => {
    expect(ZOOM_STEPS).toContain(1);
    expect(ZOOM_DEFAULT).toBe(1);
    expect(zoomForKey(2, { key: "0", ctrlKey: true })).toBe(1);
  });

  it("steps up and down through recognisable numbers, and stops at the ends", () => {
    expect(stepZoom(1, +1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(ZOOM_MAX, +1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  it("snaps onto the ladder from a level that is not on it (a wheel leaves you between steps)", () => {
    expect(stepZoom(1.17, +1)).toBe(1.25);
    expect(stepZoom(1.17, -1)).toBe(1.1);
  });

  it("a stored level that is corrupt lands on 100%, never on an unreadable page", () => {
    for (const bad of [null, undefined, "", "abc", NaN, 0, -3, {}]) expect(normalizeZoom(bad)).toBe(ZOOM_DEFAULT);
    expect(normalizeZoom("1.25")).toBe(1.25);
    expect(normalizeZoom(99)).toBe(ZOOM_MAX);
    expect(normalizeZoom(0.001)).toBe(ZOOM_MIN);
  });

  it("says the level out loud in one place", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(1.25)).toBe("125%");
    expect(zoomLabel("nonsense")).toBe("100%");
  });

  it("is scoped per account, like every other notes key", () => {
    expect(zoomKey("u1")).toBe("planyr:notes:zoom:v1:u1");
    expect(zoomKey(null)).toBe("planyr:notes:zoom:v1:local");
  });
});

describe("what a gesture means", () => {
  it("a wheel notch UP zooms in, DOWN zooms out, and both stay in range", () => {
    expect(zoomForWheel(1, -120)).toBeGreaterThan(1);
    expect(zoomForWheel(1, 120)).toBeLessThan(1);
    expect(zoomForWheel(ZOOM_MAX, -10000)).toBe(ZOOM_MAX);
    expect(zoomForWheel(ZOOM_MIN, 10000)).toBe(ZOOM_MIN);
  });

  it("a trackpad's many small deltas are proportional, not a fixed step", () => {
    const one = zoomForWheel(1, -40);
    const two = zoomForWheel(one, -40);
    expect(two).toBeGreaterThan(one);
    // …and one big notch moves further than one small one, which a step-based rule cannot do.
    expect(zoomForWheel(1, -240)).toBeGreaterThan(zoomForWheel(1, -40));
  });

  it("a LINE or PAGE delta is normalised rather than taken as pixels", () => {
    expect(zoomForWheel(1, -3, { deltaMode: 1 })).toBeGreaterThan(1);
    expect(zoomForWheel(1, -1, { deltaMode: 2 })).toBeGreaterThan(zoomForWheel(1, -1, { deltaMode: 0 }));
  });

  it("a wheel with no delta changes nothing", () => {
    expect(zoomForWheel(1.25, 0)).toBe(1.25);
  });

  it("⛔ ONLY WITH CTRL/CMD — a plain wheel is scrolling and must stay scrolling", () => {
    expect(zoomForKey(1, { key: "=", ctrlKey: false, metaKey: false })).toBeNull();
  });

  it("every spelling of the zoom keys means the same thing", () => {
    for (const key of ["=", "+", "Add"]) expect(zoomForKey(1, { key, ctrlKey: true })).toBe(1.1);
    for (const key of ["-", "_", "Subtract"]) expect(zoomForKey(1, { key, ctrlKey: true })).toBe(0.9);
    expect(zoomForKey(1, { key: "=", metaKey: true })).toBe(1.1);          // a Mac
  });

  it("leaves every other keystroke completely alone", () => {
    for (const key of ["a", "Enter", "Tab", "z", "1", "ArrowUp"]) {
      expect(zoomForKey(1, { key, ctrlKey: true })).toBeNull();
    }
    expect(zoomForKey(1, { key: "=", ctrlKey: true, altKey: true })).toBeNull();
  });
});

describe("VIEWPORT-STABLE — the same writing stays under the eye", () => {
  it("keeps the anchor where it was on screen when the level changes", () => {
    // Sitting 1000 unzoomed pixels down the document, at the very top of the viewport.
    expect(scrollTopAfterZoom({ anchorOffset: 1000, viewportOffset: 0, from: 1, to: 2 })).toBe(2000);
    expect(scrollTopAfterZoom({ anchorOffset: 1000, viewportOffset: 0, from: 2, to: 1 })).toBe(1000);
  });

  it("accounts for where in the viewport the anchor was sitting", () => {
    expect(scrollTopAfterZoom({ anchorOffset: 1000, viewportOffset: 200, from: 1, to: 2 })).toBe(1800);
  });

  it("never asks for a negative scroll position", () => {
    expect(scrollTopAfterZoom({ anchorOffset: 10, viewportOffset: 500, from: 1, to: 1.1 })).toBe(0);
  });

  it("⛔ RETURNS NULL WHEN NOTHING CHANGED — a no-op must not touch the scroller at all", () => {
    expect(scrollTopAfterZoom({ anchorOffset: 1000, viewportOffset: 0, from: 1.25, to: 1.25 })).toBeNull();
  });
});
