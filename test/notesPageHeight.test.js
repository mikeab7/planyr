/* SET A NOTE PAGE'S OWN HEIGHT BY HAND — the pure rules behind the top/bottom edge drags.
 *
 * ⛔ THE PROPERTY THIS FILE EXISTS FOR, and it is the one that has now been got wrong twice: a
 * TOP-edge drag must move the edge you GRABBED and leave the OTHER edge exactly where it was.
 * The page only ever grows downward, so each direction has exactly one thing that can move on its
 * behalf — the scroller when growing (the room was just created), the space above the page when
 * shrinking (the scroller is at 0 and a negative assignment silently clamps). `topEdgeCompensation`
 * is that whole rule as one answer; these tests pin it so a future edit cannot quietly reintroduce
 * either failure.
 *
 * The browser-side proof lives in ui-audit/verify-notes-page-height.mjs §16 (the four-way edge
 * matrix, measured on `note-sheet`) and §17 (the grip is still grabbable when you let go). This
 * file is the half that runs in CI.
 */
import { describe, expect, it } from "vitest";

import {
  PAGE_HEIGHT_MAX, PAGE_HEIGHT_MIN,
  dragHeightFromDelta, pageHeightLabel, resolvePinnedBaseHeight,
  scrollToReach, topEdgeCompensation,
} from "../src/workspaces/notes/lib/notesPageHeight.js";

describe("the stored value", () => {
  it("passes Fit to content (null) straight through, so the caller keeps its own default", () => {
    expect(resolvePinnedBaseHeight(null)).toBe(null);
    expect(resolvePinnedBaseHeight(undefined)).toBe(null);
    expect(pageHeightLabel(null)).toBe("Fit to content");
    expect(pageHeightLabel(400)).toBe("Custom");
  });

  it("floors and caps a pin rather than trusting it — a corrupt value cannot wedge a page", () => {
    expect(resolvePinnedBaseHeight(10)).toBe(PAGE_HEIGHT_MIN);
    expect(resolvePinnedBaseHeight(99999)).toBe(PAGE_HEIGHT_MAX);
    expect(resolvePinnedBaseHeight("420")).toBe(420);
    expect(resolvePinnedBaseHeight("nonsense")).toBe(null);
  });

  it("a live drag and its commit resolve through the SAME limits, so they cannot disagree", () => {
    expect(dragHeightFromDelta(300, -1000)).toBe(PAGE_HEIGHT_MIN);
    expect(dragHeightFromDelta(300, 40)).toBe(340);
    expect(resolvePinnedBaseHeight(dragHeightFromDelta(300, -1000))).toBe(PAGE_HEIGHT_MIN);
  });
});

describe("the top edge's compensation", () => {
  it("SHRINKING opens space above the page and never touches the scroller (B1605664's own bug)", () => {
    // The page opens at scrollTop 0. Asking the scroller to go negative is what silently failed.
    expect(topEdgeCompensation({ startTopPad: 0, startScrollTop: 0, delta: -40 }))
      .toEqual({ topPad: 40, scrollTop: 0 });
  });

  it("GROWING rides the scroller — the room it needs was just created by the taller page", () => {
    expect(topEdgeCompensation({ startTopPad: 0, startScrollTop: 0, delta: 60 }))
      .toEqual({ topPad: 0, scrollTop: 60 });
  });

  it("growing HANDS BACK an earlier shrink's gap before it spends any scroll", () => {
    expect(topEdgeCompensation({ startTopPad: 80, startScrollTop: 0, delta: 60 }))
      .toEqual({ topPad: 20, scrollTop: 0 });
  });

  it("and only spends scroll for the part of the growth the gap could not cover", () => {
    expect(topEdgeCompensation({ startTopPad: 80, startScrollTop: 0, delta: 100 }))
      .toEqual({ topPad: 0, scrollTop: 20 });
  });

  it("⛔ THE ACCUMULATION PROPERTY — shrink, then regrow the same amount, lands exactly back at rest", () => {
    const shrunk = topEdgeCompensation({ startTopPad: 0, startScrollTop: 0, delta: -120 });
    const regrown = topEdgeCompensation({ startTopPad: shrunk.topPad, startScrollTop: shrunk.scrollTop, delta: 120 });
    expect(regrown).toEqual({ topPad: 0, scrollTop: 0 });
  });

  it("composes over several gestures without drifting — the failure nobody would report as a bug", () => {
    let state = { topPad: 0, scrollTop: 0 };
    for (const delta of [-30, -25, 20, -15, 50]) {
      state = topEdgeCompensation({ startTopPad: state.topPad, startScrollTop: state.scrollTop, delta });
    }
    // −30 −25 +20 −15 +50 = 0 net, so both the gap and the scroll must be back to nothing.
    expect(state).toEqual({ topPad: 0, scrollTop: 0 });
  });

  it("holds the page's bottom edge still at every step, which is the whole promise", () => {
    // bottom = top + height. top = matTop + baseMargin + topPad − scrollTop; height = start + delta.
    const bottomOf = (comp, delta) => (100 + comp.topPad - comp.scrollTop) + (400 + delta);
    const rest = bottomOf({ topPad: 0, scrollTop: 0 }, 0);
    for (const delta of [-200, -80, -1, 0, 1, 80, 200]) {
      expect(bottomOf(topEdgeCompensation({ delta }), delta)).toBe(rest);
    }
  });

  it("never returns a negative gap or a negative scroll, whatever it is handed", () => {
    const out = topEdgeCompensation({ startTopPad: -50, startScrollTop: -10, delta: 5 });
    expect(out.topPad).toBeGreaterThanOrEqual(0);
    expect(out.scrollTop).toBeGreaterThanOrEqual(0);
    expect(topEdgeCompensation()).toEqual({ topPad: 0, scrollTop: 0 });
  });
});

describe("keeping the dragged edge reachable", () => {
  it("gives back the least scroll that brings the whole grip back into view", () => {
    // The grip sits 42 above the first visible row; with 10 of clear air asked for, that is 52.
    expect(scrollToReach({ scrollTop: 60, gripTop: 84, visibleTop: 126, gap: 10 })).toBe(8);
  });

  it("does nothing at all when the grip is already in view — a drag that ends in reach never moves the picture", () => {
    expect(scrollToReach({ scrollTop: 60, gripTop: 300, visibleTop: 126, gap: 10 })).toBe(60);
    expect(scrollToReach({ scrollTop: 0, gripTop: 140, visibleTop: 126, gap: 10 })).toBe(0);
  });

  it("stops at the top of the mat rather than asking for a scroll that does not exist", () => {
    expect(scrollToReach({ scrollTop: 5, gripTop: -300, visibleTop: 126, gap: 10 })).toBe(0);
  });

  it("measures against the first VISIBLE row, not the scroller's own top", () => {
    // Same grip, a scroller whose box starts above the window: the visible row is what counts.
    expect(scrollToReach({ scrollTop: 40, gripTop: 20, visibleTop: 0, gap: 10 })).toBe(40);
    expect(scrollToReach({ scrollTop: 40, gripTop: 20, visibleTop: 60, gap: 10 })).toBe(0);
  });
});
