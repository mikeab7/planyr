/* NEW-5 — viewport culling is a FRAME-TIME fix, and it must never touch the export.
 *
 * The measured problem: the feet-frame SVG holds ~4,600 elements and its cost scaled with
 * the whole model rather than with what is on screen — median frame 20 ms, p90 80 ms, p99
 * 140 ms during a drag, against a 16.7 ms budget.
 *
 * The hard constraint from the brief: culling is SCREEN-ONLY. `buildExportSvg` and the
 * PDF/aerial path must render the complete model regardless of the current viewport, so the
 * last describe below asserts exactly that — element count out of the export path is
 * independent of where the view happens to be pointing.
 */
import { describe, it, expect } from "vitest";
import {
  visibleWorldRect, elementBounds, boundsIntersect, cullToView, shouldCull,
  CULL_MARGIN, CULL_MIN_ELEMENTS,
} from "../src/workspaces/site-planner/lib/viewCull.js";

const view = { ppf: 0.35, offX: 60, offY: 60 };
const size = { w: 1600, h: 465 };

describe("visibleWorldRect", () => {
  it("covers the viewport plus the pop-in margin", () => {
    const bare = visibleWorldRect(view, size, 0);
    const grown = visibleWorldRect(view, size, CULL_MARGIN);
    expect(bare.maxX - bare.minX).toBeCloseTo(size.w / view.ppf, 6);
    expect(grown.minX).toBeLessThan(bare.minX);
    expect(grown.maxY).toBeGreaterThan(bare.maxY);
  });

  it("tracks the pan — the rect moves with the view, not with the model", () => {
    const a = visibleWorldRect(view, size);
    const b = visibleWorldRect({ ...view, offX: view.offX - 3500 }, size);
    expect(b.minX).toBeGreaterThan(a.minX);
  });
});

describe("elementBounds", () => {
  it("bounds a point list", () => {
    expect(elementBounds({ points: [{ x: 0, y: 0 }, { x: 10, y: -4 }, { x: -3, y: 8 }] }))
      .toEqual({ minX: -3, minY: -4, maxX: 10, maxY: 8 });
  });

  it("bounds a rotated box by its circumscribed radius, so any rotation is covered", () => {
    const b = elementBounds({ cx: 100, cy: 50, w: 60, h: 80, rot: 37 });
    const r = Math.hypot(60, 80) / 2;
    expect(b).toEqual({ minX: 100 - r, minY: 50 - r, maxX: 100 + r, maxY: 50 + r });
  });

  it("returns null for a shape it does not understand — and null is NEVER culled", () => {
    expect(elementBounds({ kind: "something-new" })).toBeNull();
    expect(elementBounds({ points: [{ x: 0, y: NaN }] })).toBeNull();
    expect(boundsIntersect(null, { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toBe(true);
  });
});

describe("cullToView", () => {
  const rect = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const inside = { id: "in", cx: 500, cy: 500, w: 10, h: 10 };
  const outside = { id: "out", cx: 90000, cy: 90000, w: 10, h: 10 };
  const straddling = { id: "edge", points: [{ x: -50, y: 500 }, { x: 50, y: 520 }] };

  it("keeps what the view can reach and drops what it can't", () => {
    const kept = cullToView([inside, outside, straddling], rect);
    expect(kept.map((e) => e.id)).toEqual(["in", "edge"]);
  });

  it("always keeps the selection and whatever is mid-drag, wherever it is", () => {
    const kept = cullToView([inside, outside], rect, { keep: new Set(["out"]) });
    expect(kept.map((e) => e.id)).toEqual(["in", "out"]);
  });

  it("is the IDENTITY when disabled — not a copy, so an export path allocates nothing", () => {
    const list = [inside, outside];
    expect(cullToView(list, rect, { enabled: false })).toBe(list);
    expect(cullToView(list, null)).toBe(list);
  });

  it("does not cull a small plan at all — the filter would cost more than it saves", () => {
    expect(shouldCull(CULL_MIN_ELEMENTS - 1)).toBe(false);
    expect(shouldCull(CULL_MIN_ELEMENTS)).toBe(true);
  });
});

describe("the export renders the COMPLETE model, whatever the view (hard constraint)", () => {
  // A plan spread far wider than any one viewport — the reference scenario's shape.
  const model = Array.from({ length: 300 }, (_, i) => ({ id: `e${i}`, cx: i * 400, cy: (i % 7) * 900, w: 120, h: 90 }));

  it("an export pass keeps every element, from three very different views", () => {
    const views = [
      { ppf: 0.35, offX: 60, offY: 60 },
      { ppf: 2.4, offX: -41000, offY: -2200 },
      { ppf: 0.04, offX: 900, offY: 400 },
    ];
    for (const v of views) {
      const exported = cullToView(model, visibleWorldRect(v, size), { enabled: shouldCull(model.length, { exporting: true }) });
      expect(exported.length).toBe(model.length);
    }
  });

  it("…while the SCREEN pass at those same views draws strictly fewer", () => {
    const v = { ppf: 2.4, offX: -41000, offY: -2200 };
    const drawn = cullToView(model, visibleWorldRect(v, size), { enabled: shouldCull(model.length) });
    expect(drawn.length).toBeLessThan(model.length);
    expect(drawn.length).toBeGreaterThan(0); // and it still draws what's actually there
  });

  it("every element is visible from SOME view — culling hides nothing permanently", () => {
    const seen = new Set();
    for (const el of model) {
      const v = { ppf: 0.35, offX: size.w / 2 - el.cx * 0.35, offY: size.h / 2 - el.cy * 0.35 };
      cullToView(model, visibleWorldRect(v, size), { enabled: true }).forEach((e) => seen.add(e.id));
    }
    expect(seen.size).toBe(model.length);
  });
});
