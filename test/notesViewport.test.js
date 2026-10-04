/* THE NOTE PAGE'S BLUEBEAM-STYLE WORKSPACE — the pure view rules (NEW-1, 2026-09-21).
 *
 * ⛔ THE PROPERTY THIS FILE EXISTS FOR, stated once: **zoom is anchored at the cursor.** The point
 * under the pointer is under the pointer before the step and under the pointer after it, at every
 * level, in both directions, from any starting view. Everything else here is a consequence of that
 * one rule or a guard on the range it may move through.
 *
 * ⛔ AND THE SECOND PROPERTY, which is the one NEW-2 actually needed: **the view is never a
 * function of the page's size.** Nothing in this module reads a sheet width, and nothing that
 * changes a sheet width may reach it. That is what retired three rounds of scroll compensation —
 * see this module's own header in `lib/notesViewport.js`.
 */
import { describe, expect, it } from "vitest";

import {
  VIEW_ZOOM_DEFAULT, VIEW_ZOOM_MAX, VIEW_ZOOM_MIN, VIEW_ZOOM_STEPS,
  clampViewZoom, fitView, frameView, openingZoom, PHONE_OPEN_ZOOM_MAX, PHONE_VIEWPORT_MAX, normalizeView, panBy, parseView, serializeView,
  stepZoom, toViewport, toWorkspace, viewKey, wheelIntent, wheelNativeAxis, zoomAbout, zoomForWheel, zoomKeyIntent, zoomLabel,
} from "../src/workspaces/notes/lib/notesViewport.js";

const V = (x, y, z) => ({ x, y, z });

describe("the range", () => {
  it("is wide enough to see a whole page as a card and to read fine text large", () => {
    expect(VIEW_ZOOM_MIN).toBe(0.1);
    expect(VIEW_ZOOM_MAX).toBe(8);
    expect(VIEW_ZOOM_DEFAULT).toBe(1);
  });

  it("the ladder is sorted, unique, spans the whole range, and contains 100%", () => {
    expect([...VIEW_ZOOM_STEPS].sort((a, b) => a - b)).toEqual(VIEW_ZOOM_STEPS);
    expect(new Set(VIEW_ZOOM_STEPS).size).toBe(VIEW_ZOOM_STEPS.length);
    expect(VIEW_ZOOM_STEPS[0]).toBe(VIEW_ZOOM_MIN);
    expect(VIEW_ZOOM_STEPS[VIEW_ZOOM_STEPS.length - 1]).toBe(VIEW_ZOOM_MAX);
    expect(VIEW_ZOOM_STEPS).toContain(1);
  });

  it("clamps, and lands a corrupt value on 100% rather than on NaN", () => {
    expect(clampViewZoom(0.001)).toBe(VIEW_ZOOM_MIN);
    expect(clampViewZoom(99)).toBe(VIEW_ZOOM_MAX);
    for (const junk of [undefined, null, NaN, 0, -2, "nonsense", {}]) {
      expect(clampViewZoom(junk)).toBe(VIEW_ZOOM_DEFAULT);
    }
  });
});

describe("the coordinate rule", () => {
  it("round-trips a point through both directions at any view", () => {
    for (const view of [V(0, 0, 1), V(300, -120, 0.4), V(-50, 900, 3.7)]) {
      for (const pt of [{ x: 0, y: 0 }, { x: 640, y: 480 }, { x: -200, y: 33.5 }]) {
        const back = toViewport(view, toWorkspace(view, pt));
        expect(back.x).toBeCloseTo(pt.x, 6);
        expect(back.y).toBeCloseTo(pt.y, 6);
      }
    }
  });

  it("`view.x` behaves exactly like `scrollLeft` — increasing it moves content LEFT", () => {
    const at = (x) => toViewport(V(x, 0, 1), { x: 500, y: 0 }).x;
    expect(at(100)).toBe(at(0) - 100);
  });
});

describe("zoomAbout — the point under the cursor stays under the cursor", () => {
  it("holds the anchor fixed, in every direction, from every starting view", () => {
    const anchors = [{ x: 0, y: 0 }, { x: 640, y: 480 }, { x: 1191, y: 17 }];
    const views = [V(0, 0, 1), V(420, -90, 0.5), V(-1200, 3000, 2.75)];
    for (const view of views) {
      for (const at of anchors) {
        for (const to of [0.25, 0.5, 1, 1.9, 4, 8]) {
          const next = zoomAbout(view, at, to);
          const wasOver = toWorkspace(view, at);
          const nowAt = toViewport(next, wasOver);
          expect(nowAt.x).toBeCloseTo(at.x, 6);
          expect(nowAt.y).toBeCloseTo(at.y, 6);
        }
      }
    }
  });

  it("a zoom to the level it is already at changes nothing", () => {
    const view = V(300, 120, 1.5);
    expect(zoomAbout(view, { x: 400, y: 200 }, 1.5)).toEqual(view);
  });

  it("clamps, so a caller cannot step out of range through it", () => {
    expect(zoomAbout(V(0, 0, 1), { x: 10, y: 10 }, 500).z).toBe(VIEW_ZOOM_MAX);
    expect(zoomAbout(V(0, 0, 1), { x: 10, y: 10 }, 0.0001).z).toBe(VIEW_ZOOM_MIN);
  });

  it("with no anchor it holds the viewport's own origin, which is still a fixed point", () => {
    const next = zoomAbout(V(200, 100, 1), undefined, 2);
    expect(toViewport(next, toWorkspace(V(200, 100, 1), { x: 0, y: 0 })).x).toBeCloseTo(0, 6);
  });
});

describe("zoomForWheel", () => {
  it("is proportional, so a trackpad's small deltas do not lurch a whole step", () => {
    const small = zoomForWheel(1, -10);
    expect(small).toBeGreaterThan(1);
    expect(small).toBeLessThan(1.1);
  });

  it("up is in, down is out", () => {
    expect(zoomForWheel(1, -120)).toBeGreaterThan(1);
    expect(zoomForWheel(1, 120)).toBeLessThan(1);
  });

  it("normalises line and page deltas into pixels rather than treating them as pixels", () => {
    expect(zoomForWheel(1, -3, { deltaMode: 1 })).toBeCloseTo(zoomForWheel(1, -48), 10);
    expect(zoomForWheel(1, -1, { deltaMode: 2 })).toBeCloseTo(zoomForWheel(1, -400), 10);
  });

  it("clamps at both ends and ignores a zero notch", () => {
    expect(zoomForWheel(8, -10_000)).toBe(VIEW_ZOOM_MAX);
    expect(zoomForWheel(0.1, 10_000)).toBe(VIEW_ZOOM_MIN);
    expect(zoomForWheel(1.3, 0)).toBe(1.3);
  });
});

describe("stepZoom", () => {
  it("walks the ladder in both directions and stops at the ends", () => {
    expect(stepZoom(1, +1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(VIEW_ZOOM_MAX, +1)).toBe(VIEW_ZOOM_MAX);
    expect(stepZoom(VIEW_ZOOM_MIN, -1)).toBe(VIEW_ZOOM_MIN);
  });

  it("snaps onto the ladder from a level a wheel left between rungs", () => {
    expect(stepZoom(1.37, +1)).toBe(1.5);
    expect(stepZoom(1.37, -1)).toBe(1.25);
  });

  it("stepping up then down from a rung returns to that rung", () => {
    for (const z of VIEW_ZOOM_STEPS.slice(1, -1)) expect(stepZoom(stepZoom(z, +1), -1)).toBe(z);
  });
});

describe("zoomKeyIntent", () => {
  it("claims the four gestures, on either modifier", () => {
    expect(zoomKeyIntent({ key: "0", ctrlKey: true })).toEqual({ kind: "reset" });
    expect(zoomKeyIntent({ key: "9", metaKey: true })).toEqual({ kind: "fit" });
    expect(zoomKeyIntent({ key: "=", ctrlKey: true })).toEqual({ kind: "step", direction: 1 });
    expect(zoomKeyIntent({ key: "-", ctrlKey: true })).toEqual({ kind: "step", direction: -1 });
  });

  it("answers the keyboards that spell the same key differently", () => {
    for (const key of ["=", "+", "Add"]) expect(zoomKeyIntent({ key, ctrlKey: true }).direction).toBe(1);
    for (const key of ["-", "_", "Subtract"]) expect(zoomKeyIntent({ key, ctrlKey: true }).direction).toBe(-1);
  });

  it("⛔ LEAVES EVERY UNMODIFIED KEY ALONE — typing a `-` in a sentence is not a zoom", () => {
    expect(zoomKeyIntent({ key: "-" })).toBe(null);
    expect(zoomKeyIntent({ key: "0" })).toBe(null);
    expect(zoomKeyIntent({ key: "=", ctrlKey: true, altKey: true })).toBe(null);
    expect(zoomKeyIntent({ key: "a", ctrlKey: true })).toBe(null);
    expect(zoomKeyIntent({})).toBe(null);
  });
});

describe("panBy", () => {
  it("tracks the hand one-to-one — dragging right moves the content right", () => {
    expect(panBy(V(100, 100, 1), { dx: 30, dy: -20 })).toEqual(V(70, 120, 1));
  });

  it("⛔ IS UNBOUNDED IN BOTH AXES, WHICH IS THE WHOLE FEATURE. A scroller clamps at 0 and at its", () => {
    // own content's edge; that clamp is what made three rounds of compensation unfixable. Panning
    // to a NEGATIVE view is how you look at the blank workspace above and left of the page.
    expect(panBy(V(0, 0, 1), { dx: 500, dy: 500 })).toEqual(V(-500, -500, 1));
    expect(panBy(V(0, 0, 1), { dx: -99_999, dy: -99_999 })).toEqual(V(99_999, 99_999, 1));
  });

  it("never changes the zoom", () => {
    expect(panBy(V(0, 0, 2.5), { dx: 40, dy: 40 }).z).toBe(2.5);
  });
});

describe("frameView / fitView", () => {
  const viewport = { width: 1232, height: 824 };

  it("centres the page horizontally at 100%", () => {
    const v = frameView({ viewport, page: { x: 0, y: 0, width: 580, height: 2000 }, zoom: 1 });
    const left = toViewport(v, { x: 0, y: 0 }).x;
    const right = toViewport(v, { x: 580, y: 0 }).x;
    expect(left).toBeCloseTo(viewport.width - right, 6);
  });

  it("⛔ PUTS A TALL PAGE'S TOP EDGE ON SCREEN, never its middle — a document is read from the top", () => {
    const v = frameView({ viewport, page: { x: 0, y: 0, width: 580, height: 5000 }, zoom: 1 });
    const top = toViewport(v, { x: 0, y: 0 }).y;
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThan(viewport.height / 2);
  });

  it("centres a SHORT page vertically, because there is room to", () => {
    const v = frameView({ viewport, page: { x: 0, y: 0, width: 580, height: 200 }, zoom: 1 });
    const top = toViewport(v, { x: 0, y: 0 }).y;
    const bottom = toViewport(v, { x: 0, y: 200 }).y;
    expect(top).toBeCloseTo(viewport.height - bottom, 6);
  });

  it("fit shows the WHOLE page — both edges inside the viewport, in both axes", () => {
    for (const page of [{ width: 580, height: 5000 }, { width: 2400, height: 800 }, { width: 900, height: 900 }]) {
      const v = fitView({ viewport, page: { x: 0, y: 0, ...page } });
      const tl = toViewport(v, { x: 0, y: 0 });
      const br = toViewport(v, { x: page.width, y: page.height });
      expect(tl.x).toBeGreaterThanOrEqual(-0.5);
      expect(tl.y).toBeGreaterThanOrEqual(-0.5);
      expect(br.x).toBeLessThanOrEqual(viewport.width + 0.5);
      expect(br.y).toBeLessThanOrEqual(viewport.height + 0.5);
    }
  });

  it("⛔ FIT NEVER MAGNIFIES PAST 100% — 'show me all of it' is not 'fill the glass'", () => {
    expect(fitView({ viewport, page: { x: 0, y: 0, width: 200, height: 100 } }).z).toBe(1);
  });

  it("survives junk without producing a NaN view", () => {
    for (const args of [{}, { viewport: {}, page: {} }, { viewport: { width: NaN }, page: { width: NaN } }]) {
      const v = fitView(args);
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.y)).toBe(true);
      expect(Number.isFinite(v.z)).toBe(true);
    }
  });
});

describe("where the view lives", () => {
  it("⛔ IS KEYED PER PAGE AND PER SCOPE — two accounts on one machine do not share a view, and", () => {
    // neither do two pages. On a canvas you can pan, the view is a place you left off IN A
    // PARTICULAR DOCUMENT; one level for the whole workspace (which is what this replaced) would
    // drop you at another page's framing.
    expect(viewKey("user-a", "p1")).not.toBe(viewKey("user-b", "p1"));
    expect(viewKey("user-a", "p1")).not.toBe(viewKey("user-a", "p2"));
    expect(viewKey(null, null)).toContain("local");
  });

  it("round-trips through storage, rounded so two saves of one place do not differ", () => {
    const v = { x: 123.456, y: -78.9, z: 1.23456 };
    const back = parseView(JSON.stringify(serializeView(v)));
    expect(back).toEqual({ x: 123, y: -79, z: 1.235 });
  });

  it("⛔ `null` MEANS 'NEVER OPENED', AND THAT IS DIFFERENT FROM 'OPENED AT THE IDENTITY VIEW'", () => {
    // The first wants a fresh framing; the second must be left exactly where it was.
    expect(parseView(null)).toBe(null);
    expect(parseView("not json")).toBe(null);
    expect(parseView("{}")).toBe(null);
    expect(parseView(JSON.stringify({ x: 0, y: 0, z: 1 }))).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("normalizeView refuses to produce NaN from anything", () => {
    for (const junk of [undefined, null, {}, { x: "a", y: {}, z: [] }]) {
      const v = normalizeView(junk);
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
    }
  });
});

describe("zoomLabel", () => {
  it("says the level out loud once, so a control and a test cannot disagree", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(1.25)).toBe("125%");
    expect(zoomLabel(0.1)).toBe("10%");
    expect(zoomLabel(8)).toBe("800%");
  });
});

/* ⛔ NEW-1 (2026-09-29) — A PLAIN WHEEL ZOOMS AT THE CURSOR, LIKE THE SITE PLAN. The decision table
 * lives in `wheelIntent`; the DOM half (a wheel over a scrollable table/menu is left alone) is driven
 * in a real browser by `ui-audit/verify-notes-canvas.mjs` §2. */
describe("wheelIntent — what a wheel event means over the canvas", () => {
  it("⛔ RED-PROOF: a plain wheel-UP is a zoom, not a scroll (the pre-change rule panned)", () => {
    expect(wheelIntent({ deltaY: -100 })).toEqual({ kind: "zoom", deltaY: -100 });
    expect(wheelIntent({ deltaY: 100 })).toEqual({ kind: "zoom", deltaY: 100 });
  });

  it("wheel up zooms IN and wheel down zooms OUT, the site plan's direction", () => {
    const z = 1;
    expect(zoomForWheel(z, wheelIntent({ deltaY: -100 }).deltaY)).toBeGreaterThan(z);
    expect(zoomForWheel(z, wheelIntent({ deltaY: 100 }).deltaY)).toBeLessThan(z);
  });

  it("Ctrl/⌘+wheel and a trackpad pinch (a ctrlKey wheel) still zoom", () => {
    expect(wheelIntent({ deltaY: -4, ctrlKey: true }).kind).toBe("zoom");
    expect(wheelIntent({ deltaY: 4, metaKey: true }).kind).toBe("zoom");
  });

  it("Ctrl+wheel zooms even over something that scrolls itself — page zoom is still suppressed", () => {
    expect(wheelIntent({ deltaY: -4, ctrlKey: true, ownsWheel: true }).kind).toBe("zoom");
  });

  it("Shift+wheel PANS vertically, whether the OS reports it as deltaY (Windows) or deltaX (macOS)", () => {
    expect(wheelIntent({ deltaY: 120, shiftKey: true })).toEqual({ kind: "pan", dx: 0, dy: 120 });
    expect(wheelIntent({ deltaX: 120, deltaY: 0, shiftKey: true })).toEqual({ kind: "pan", dx: 0, dy: 120 });
  });

  it("a mostly-sideways swipe pans horizontally and never zooms", () => {
    expect(wheelIntent({ deltaX: 60, deltaY: 4 })).toEqual({ kind: "pan", dx: 60, dy: 0 });
    expect(wheelIntent({ deltaX: -60, deltaY: 0 }).kind).toBe("pan");
  });

  it("a line/page-mode delta is normalised before it is spent as a pan", () => {
    expect(wheelIntent({ deltaY: 3, deltaMode: 1, shiftKey: true }).dy).toBe(48);
    expect(wheelIntent({ deltaY: 1, deltaMode: 2, shiftKey: true }).dy).toBe(400);
  });

  it("a wheel over something that scrolls itself is left NATIVE and changes nothing here", () => {
    for (const e of [{ deltaY: 100 }, { deltaY: -100 }, { deltaX: 80 }, { deltaY: 100, shiftKey: true }]) {
      expect(wheelIntent({ ...e, ownsWheel: true })).toEqual({ kind: "native" });
    }
  });

  it("wheelNativeAxis mirrors what the browser scrolls: Shift → x, dominant delta otherwise", () => {
    expect(wheelNativeAxis({ deltaY: 100 })).toBe("y");
    expect(wheelNativeAxis({ deltaX: 100, deltaY: 3 })).toBe("x");
    expect(wheelNativeAxis({ deltaY: 100, shiftKey: true })).toBe("x");
  });

  it("⛔ THE POINT UNDER THE CURSOR STAYS UNDER THE CURSOR through a wheel step, both axes, within 1px", () => {
    for (const view of [V(0, 0, 1), V(340, 910, 1.5), V(-250, -80, 0.4), V(1200, 40, 3)]) {
      for (const at of [{ x: 10, y: 10 }, { x: 600, y: 300 }, { x: 1100, y: 600 }]) {
        for (const deltaY of [-240, -100, -10, 10, 100, 240]) {
          const under = toWorkspace(view, at);
          const intent = wheelIntent({ deltaY });
          const next = zoomAbout(view, at, zoomForWheel(view.z, intent.deltaY));
          const now = toViewport(next, under);
          expect(Math.abs(now.x - at.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(now.y - at.y)).toBeLessThanOrEqual(1);
          expect(next.z === view.z).toBe(false);
        }
      }
    }
  });

  it("wheel zoom is smooth within the clamp and lands on it at both ends, like Ctrl+wheel", () => {
    expect(zoomForWheel(VIEW_ZOOM_MAX, wheelIntent({ deltaY: -100 }).deltaY)).toBe(VIEW_ZOOM_MAX);
    expect(zoomForWheel(VIEW_ZOOM_MIN, wheelIntent({ deltaY: 100 }).deltaY)).toBe(VIEW_ZOOM_MIN);
  });
});

describe('NEW-4 — the opening framing: top-anchored, and fit-width on a phone', () => {
  const viewport = { width: 1232, height: 824 };
  it('align: "top" puts a SHORT page\'s top edge a small margin below the top, whatever its height', () => {
    for (const height of [145, 213, 581, 5000]) {
      const v = frameView({ viewport, page: { x: 0, y: 0, width: 580, height }, zoom: 1, align: 'top' });
      const top = toViewport(v, { x: 0, y: 0 }).y;
      expect(top).toBeGreaterThan(0);
      expect(top).toBeLessThanOrEqual(Math.round(Math.min(viewport.width, viewport.height) * 0.04));
    }
  });
  it('…so a page that GROWS after the first measurement was already framed correctly (height-independent)', () => {
    const short = frameView({ viewport, page: { x: 0, y: 0, width: 580, height: 213 }, zoom: 1, align: 'top' });
    const grown = frameView({ viewport, page: { x: 0, y: 0, width: 580, height: 581 }, zoom: 1, align: 'top' });
    expect(short.y).toBe(grown.y);
  });
  it('the default stays centred (Fit wants the whole page centred)', () => {
    const v = frameView({ viewport, page: { x: 0, y: 0, width: 580, height: 200 }, zoom: 1 });
    expect(toViewport(v, { x: 0, y: 0 }).y).toBeCloseTo(viewport.height - toViewport(v, { x: 0, y: 200 }).y, 6);
  });
  it('desktop opens at 100%; a phone opens at fit width with BOTH edges on screen', () => {
    expect(openingZoom({ viewport: { width: 1280 }, page: { width: 580 } })).toBe(1);
    for (const [vw, pw] of [[390, 374], [390, 434], [430, 414], [360, 340]]) {
      const z = openingZoom({ viewport: { width: vw }, page: { width: pw } });
      const v = frameView({ viewport: { width: vw, height: 664 }, page: { x: 0, y: 0, width: pw, height: 500 }, zoom: z, align: 'top' });
      const left = toViewport(v, { x: 0, y: 0 }).x;
      const right = toViewport(v, { x: pw, y: 0 }).x;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(vw);
    }
  });
  it('a page narrower than the screen is shown a little larger, never past the cap; junk is safe', () => {
    expect(openingZoom({ viewport: { width: 390 }, page: { width: 200 } })).toBe(PHONE_OPEN_ZOOM_MAX);
    expect(PHONE_VIEWPORT_MAX).toBeGreaterThan(430);
    expect(Number.isFinite(openingZoom({}))).toBe(true);
  });
});
