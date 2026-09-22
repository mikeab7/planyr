/* SET A NOTE PAGE'S OWN WIDTH BY HAND — the pure preset/resolution rules (NEW-1).
 *
 * ⛔ THE PROPERTY THIS FILE EXISTS FOR: a pin is a FLOOR — the resolved baseline never exceeds
 * what the pane actually has room for (it shrinks to fit a narrow window, it never clips), and
 * "Full width" always leaves the standing gutter on each side. NoteEditor.jsx's own measurement
 * effect trusts these answers without re-deriving them, so a wrong one here is a wrong page for
 * every note in the app, not a local bug.
 */
import { describe, expect, it } from "vitest";

import {
  FULL_WIDTH_FLOOR, FULL_WIDTH_GUTTER, PAGE_COL_MIN, PAGE_WIDTH_MAX, PAGE_WIDTH_MIN,
  PAGE_WIDTH_PRESETS, dragWidthFromDelta, leftEdgeDrag, normalizePageMargin, pageWidthLabel,
  pageWidthPresetId, resolvePinnedBaseWidth, resolvePresetPx, rightEdgeDrag, sheetWidthFor,
} from "../src/workspaces/notes/lib/notesPageWidth.js";

describe("the presets", () => {
  it("names exactly four, in menu order, each with a usable px or the full sentinel", () => {
    expect(PAGE_WIDTH_PRESETS.map((p) => p.id)).toEqual(["narrow", "normal", "wide", "full"]);
    expect(PAGE_WIDTH_PRESETS.map((p) => p.px)).toEqual([440, 580, 900, "full"]);
  });

  it("Normal matches the app's own unpinned default (580) — a real pin, not a renamed no-op", () => {
    expect(PAGE_WIDTH_PRESETS.find((p) => p.id === "normal").px).toBe(580);
  });

  it("is strictly increasing narrow < normal < wide, so the menu order reads as the visual order", () => {
    const [narrow, normal, wide] = PAGE_WIDTH_PRESETS;
    expect(narrow.px).toBeLessThan(normal.px);
    expect(normal.px).toBeLessThan(wide.px);
  });
});

describe("pageWidthPresetId — which row, if any, a stored value matches", () => {
  it("matches a preset's own exact px", () => {
    expect(pageWidthPresetId(440)).toBe("narrow");
    expect(pageWidthPresetId(580)).toBe("normal");
    expect(pageWidthPresetId(900)).toBe("wide");
  });

  it("null is unpinned, not a preset match", () => {
    expect(pageWidthPresetId(null)).toBeNull();
  });

  it("a dragged, off-preset width matches nothing — it is Custom, not a mis-highlighted preset", () => {
    expect(pageWidthPresetId(733)).toBeNull();
    expect(pageWidthPresetId(441)).toBeNull();
  });

  it("the literal string \"full\" matches the Full width preset's own id", () => {
    expect(pageWidthPresetId("full")).toBe("full");
  });
});

describe("pageWidthLabel — the closed menu trigger's word (PANEL-BREVITY)", () => {
  it("unpinned reads Fit to content", () => {
    expect(pageWidthLabel(null)).toBe("Fit to content");
  });
  it("a preset reads its own name", () => {
    expect(pageWidthLabel(440)).toBe("Narrow");
    expect(pageWidthLabel(580)).toBe("Normal");
    expect(pageWidthLabel(900)).toBe("Wide");
  });
  it("full width reads its own name", () => {
    expect(pageWidthLabel("full")).toBe("Full width");
  });
  it("a dragged, off-preset width reads Custom — never a bare number", () => {
    expect(pageWidthLabel(733)).toBe("Custom");
  });
});

describe("resolvePresetPx — a preset's own px against the pane it is rendering in", () => {
  it("a plain-number preset ignores the pane entirely", () => {
    expect(resolvePresetPx(440, { paneWidth: 2000 })).toBe(440);
    expect(resolvePresetPx(900, { paneWidth: 500 })).toBe(900);
  });

  it("\"full\" fills the pane down to the standing gutter on each side, once the pane is roomy", () => {
    expect(resolvePresetPx("full", { paneWidth: 1400 })).toBe(1400 - FULL_WIDTH_GUTTER * 2);
  });

  /* ⛔ B1561105 — "Full width" rendered NARROWER than "Wide" on a real window (~1190 CSS px):
   * Wide ignores the pane and always renders 900, while "full" used to compute paneWidth - 48
   * with nothing stopping it from landing below 900 whenever the pane was only a little wider
   * than Wide's own fixed size. Reproduced exactly: at the pane width that produces this, "full"
   * used to resolve to LESS than the "wide" preset. The FLOOR fixed that; kept covered below at
   * a genuinely tiny pane where the floor still has to do real work. */
  it("never resolves narrower than the widest fixed preset (Wide), even on a pane too tiny to floor around", () => {
    const wide = PAGE_WIDTH_PRESETS.find((p) => p.id === "wide").px;
    expect(FULL_WIDTH_FLOOR).toBe(wide);
    const paneWidth = 50; // small enough that even the narrowed B1344624 gutter can't clear the floor
    expect(paneWidth - FULL_WIDTH_GUTTER * 2).toBeLessThan(wide); // the floor is still needed here
    expect(resolvePresetPx("full", { paneWidth })).toBe(wide);
    expect(resolvePresetPx("full", { paneWidth })).toBeGreaterThanOrEqual(
      resolvePresetPx(wide, { paneWidth }),
    );
  });

  /* ⛔ B1344624 — THE FLOOR WAS DOING ALL THE WORK, EVEN WHEN IT SHOULDN'T HAVE BEEN: at the
   * owner's own ~1190px working window (pane ≈ 923px, Pages rail open, Outline closed), the OLD
   * 24px-per-side gutter put "full"'s own pane-relative number (923 − 48 = 875) BELOW the floor
   * on nearly every ordinary window, so `resolvePresetPx` always fell back to the exact same
   * constant Wide already is — "Full width" and "Wide" read as the identical number on every
   * page he tried, never a genuine, pane-tracking answer. The narrowed gutter (24 → 8) lets a
   * pane with real room to give report a number that legitimately EXCEEDS Wide instead. */
  it("at the owner's own working window, genuinely exceeds Wide instead of silently equalling it", () => {
    const wide = PAGE_WIDTH_PRESETS.find((p) => p.id === "wide").px;
    const paneWidth = 923;
    const full = resolvePresetPx("full", { paneWidth });
    expect(full).toBeGreaterThan(wide); // a real, pane-tracking answer, not the floor's constant
    expect(full).toBe(paneWidth - FULL_WIDTH_GUTTER * 2); // computed from the pane, not floored
  });

  it("on a tiny pane, floors at the widest fixed preset rather than shrinking further — it overflows, the mat scrolls", () => {
    expect(resolvePresetPx("full", { paneWidth: 10 })).toBe(FULL_WIDTH_FLOOR);
  });

  it("on a roomy pane, still fills the pane exactly as before — the floor never widens an already-wide answer", () => {
    expect(resolvePresetPx("full", { paneWidth: 2000 })).toBe(2000 - FULL_WIDTH_GUTTER * 2);
  });

  it("the five options read as a monotonic ladder at every window size, narrow through very wide", () => {
    for (const paneWidth of [10, 200, 320, 440, 500, 580, 700, 900, 923, 950, 1190, 1400, 2400, 3440]) {
      const narrow = resolvePresetPx(PAGE_WIDTH_PRESETS[0].px, { paneWidth });
      const normal = resolvePresetPx(PAGE_WIDTH_PRESETS[1].px, { paneWidth });
      const wide = resolvePresetPx(PAGE_WIDTH_PRESETS[2].px, { paneWidth });
      const full = resolvePresetPx("full", { paneWidth });
      expect(narrow).toBeLessThanOrEqual(normal);
      expect(normal).toBeLessThanOrEqual(wide);
      expect(wide).toBeLessThanOrEqual(full);
    }
  });
});

describe("resolvePinnedBaseWidth — the ONE answer NoteEditor.jsx's measurement effect trusts", () => {
  it("null (Fit to content) is passed straight back — the caller's own SHEET_MAX_WIDTH fallback is untouched", () => {
    expect(resolvePinnedBaseWidth(null, { paneWidth: 1200 })).toBeNull();
  });

  it("a numeric pin resolves to itself when the pane has room", () => {
    expect(resolvePinnedBaseWidth(900, { paneWidth: 2000 })).toBe(900);
    expect(resolvePinnedBaseWidth(440, { paneWidth: 2000 })).toBe(440);
  });

  it("\"full\" resolves against the live pane, matching resolvePresetPx exactly", () => {
    expect(resolvePinnedBaseWidth("full", { paneWidth: 1000 })).toBe(resolvePresetPx("full", { paneWidth: 1000 }));
  });

  it("is a FLOOR CONCEPT, never a clip — clamps to the drag min/max but never throws on a wild value", () => {
    expect(resolvePinnedBaseWidth(1, { paneWidth: 2000 })).toBe(PAGE_WIDTH_MIN);
    expect(resolvePinnedBaseWidth(999999, { paneWidth: 999999 })).toBe(PAGE_WIDTH_MAX);
  });

  it("an unreadable stored value (a stale/foreign string) answers null rather than throwing", () => {
    expect(resolvePinnedBaseWidth("garbage", { paneWidth: 1200 })).toBeNull();
    expect(resolvePinnedBaseWidth(NaN, { paneWidth: 1200 })).toBeNull();
  });
});

describe("dragWidthFromDelta — the live preview and the eventual commit share one clamp", () => {
  it("adds the delta, both directions", () => {
    expect(dragWidthFromDelta(580, 100)).toBe(680);
    expect(dragWidthFromDelta(580, -100)).toBe(480);
  });

  it("never drops below PAGE_WIDTH_MIN, however far the pointer travels", () => {
    expect(dragWidthFromDelta(580, -100000)).toBe(PAGE_WIDTH_MIN);
  });

  it("never exceeds PAGE_WIDTH_MAX, however far the pointer travels", () => {
    expect(dragWidthFromDelta(580, 100000)).toBe(PAGE_WIDTH_MAX);
  });

  it("rounds to a whole pixel — a stored width is never a fraction", () => {
    expect(Number.isInteger(dragWidthFromDelta(580.4, 12.6))).toBe(true);
  });
});

/* ═══ THE TWO EDGE-DRAG DECISIONS (NEW-2, fourth round, 2026-09-21) ═══════════════════════════
 *
 * ⛔ THESE REPLACE THE `leftWidthGripPad` AND `matSidePads` SUITES THAT USED TO BE HERE, AND THE
 * REPLACEMENT IS THE POINT — read `lib/notesViewport.js`'s header before restoring either.
 *
 * Both of those functions, and every test that used to sit here, were about ONE question: how do
 * we hold the words still while the sheet's own position inside a SCROLLER changes underneath
 * them? The answer was always a compensation, and the tests proved the compensation was computed
 * correctly. They were right and they went green while the feature was broken in the field three
 * times running, because the thing that fails is not the arithmetic — it is that `scrollLeft` is a
 * BOUNDED resource and the debt is unbounded. The last suite here even asserted "the mat has
 * enough scrollable room for whatever the gutter could not absorb", which is exactly the right
 * property for the wrong mechanism.
 *
 * On a transform workspace the page is placed at a workspace coordinate and the view is never
 * consulted, so there is no compensation to compute and nothing here left to assert about one.
 * What IS asserted below is the geometry itself: where each boundary goes, which boundary holds,
 * and how much the content is allowed to move (which is zero, except for the one case where the
 * boundary is deliberately being pushed into it).
 */
describe("leftEdgeDrag — the left boundary follows the pointer", () => {
  it("widening from a fresh page opens exactly that much blank paper and touches nothing else", () => {
    expect(leftEdgeDrag({ marginLeft: 0, colWidth: 580, delta: 120 }))
      .toEqual({ marginLeft: 120, colWidth: 580, contentShift: 0 });
  });

  it("composes with paper an earlier drag already opened, rather than starting over", () => {
    expect(leftEdgeDrag({ marginLeft: 120, colWidth: 580, delta: 40 }))
      .toEqual({ marginLeft: 160, colWidth: 580, contentShift: 0 });
  });

  it("narrowing spends the blank paper first, and the column is untouched while any remains", () => {
    expect(leftEdgeDrag({ marginLeft: 120, colWidth: 580, delta: -50 }))
      .toEqual({ marginLeft: 70, colWidth: 580, contentShift: 0 });
  });

  it("⛔ THE PROPERTY THAT MATTERS: while there is blank paper, the content does not move AT ALL", () => {
    for (const delta of [1, 5, 40, 90, 120, -1, -40, -119, -120]) {
      expect(leftEdgeDrag({ marginLeft: 120, colWidth: 580, delta }).contentShift).toBe(0);
    }
  });

  it("past the paper the column narrows, and the content moves by EXACTLY the overshoot", () => {
    /* The one case where content legitimately moves — the boundary is being pushed into it, which
     * is what dragging a margin marker into your own text means. It is returned explicitly rather
     * than left for a caller to infer, because a caller that has to infer it will get it wrong. */
    const r = leftEdgeDrag({ marginLeft: 120, colWidth: 580, delta: -200 });
    expect(r.marginLeft).toBe(0);
    expect(r.colWidth).toBe(500);
    expect(r.contentShift).toBe(80);
  });

  it("the column has a floor, and the content never moves further than the column actually gave", () => {
    const r = leftEdgeDrag({ marginLeft: 0, colWidth: 400, delta: -5000 });
    expect(r.colWidth).toBe(PAGE_COL_MIN);
    expect(r.contentShift).toBe(400 - PAGE_COL_MIN);
  });

  it("a shrink-then-regrow round trip lands exactly back where it started", () => {
    const grown = leftEdgeDrag({ marginLeft: 0, colWidth: 580, delta: 90 });
    const shrunk = leftEdgeDrag({ marginLeft: grown.marginLeft, colWidth: grown.colWidth, delta: -90 });
    expect(shrunk).toEqual({ marginLeft: 0, colWidth: 580, contentShift: 0 });
  });

  it("a zero delta is a no-op", () => {
    expect(leftEdgeDrag({ marginLeft: 50, colWidth: 580, delta: 0 }))
      .toEqual({ marginLeft: 50, colWidth: 580, contentShift: 0 });
  });

  it("tolerates missing arguments rather than producing NaN", () => {
    const r = leftEdgeDrag({});
    expect(Number.isFinite(r.marginLeft)).toBe(true);
    expect(Number.isFinite(r.colWidth)).toBe(true);
    expect(Number.isFinite(r.contentShift)).toBe(true);
  });
});

describe("rightEdgeDrag — the right boundary spends the column, and the left edge never moves", () => {
  it("widening grows the writing column", () => {
    expect(rightEdgeDrag({ colWidth: 580, delta: 180 })).toEqual({ colWidth: 760 });
  });

  it("narrowing shrinks it, down to the module's own floor", () => {
    expect(rightEdgeDrag({ colWidth: 580, delta: -180 })).toEqual({ colWidth: 400 });
    expect(rightEdgeDrag({ colWidth: 580, delta: -5000 })).toEqual({ colWidth: PAGE_WIDTH_MIN });
  });

  it("and it is ceilinged the same way every other width is", () => {
    expect(rightEdgeDrag({ colWidth: 580, delta: 99_999 })).toEqual({ colWidth: PAGE_WIDTH_MAX });
  });

  it("⛔ IT NEVER TOUCHES THE MARGIN, which is what keeps the page's LEFT edge still", () => {
    expect(rightEdgeDrag({ colWidth: 580, delta: 180 })).not.toHaveProperty("marginLeft");
  });
});

describe("sheetWidthFor / normalizePageMargin", () => {
  it("the page is its margin plus its column, and nothing else", () => {
    expect(sheetWidthFor({ marginLeft: 120, colWidth: 580 })).toBe(700);
    expect(sheetWidthFor({ marginLeft: 0, colWidth: 580 })).toBe(580);
  });

  it("⛔ A PAGE WRITTEN BEFORE THE MARGIN EXISTED READS BACK AS ZERO, so nothing migrates", () => {
    for (const v of [undefined, null, 0, "", NaN, -40, "nonsense"]) {
      expect(normalizePageMargin(v)).toBe(0);
    }
  });

  it("a real stored margin survives, rounded and ceilinged", () => {
    expect(normalizePageMargin(120.4)).toBe(120);
    expect(normalizePageMargin(99_999)).toBe(PAGE_WIDTH_MAX);
  });
});
