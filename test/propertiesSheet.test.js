import { describe, it, expect } from "vitest";
import {
  isPhoneSheetMode, SHEET_SNAPS, heightForSnap, resolveDragSnap, keyboardInsetPx,
  clampSheetHeightForKeyboard, selectionCoverDeltaPx, keyboardHeightPx, sheetMaxHeightForKeyboard,
} from "../src/workspaces/site-planner/lib/propertiesSheet.js";

// B1215682/NEW-1 — pure geometry + decisions for the phone Properties bottom sheet.

describe("isPhoneSheetMode", () => {
  it("requires BOTH narrow width and a coarse pointer", () => {
    expect(isPhoneSheetMode({ narrow: true, coarsePointer: true })).toBe(true);
  });
  it("a narrow desktop browser window with a mouse is NOT phone-sheet mode (width alone isn't enough)", () => {
    expect(isPhoneSheetMode({ narrow: true, coarsePointer: false })).toBe(false);
  });
  it("a wide touch device (an iPad in landscape) is NOT phone-sheet mode either", () => {
    expect(isPhoneSheetMode({ narrow: false, coarsePointer: true })).toBe(false);
  });
  it("neither narrow nor coarse", () => {
    expect(isPhoneSheetMode({ narrow: false, coarsePointer: false })).toBe(false);
  });
});

describe("heightForSnap", () => {
  it("half is roughly half the viewport", () => {
    expect(heightForSnap("half", 800)).toBe(400);
  });
  it("tall is capped well short of the full viewport (the map must stay visible)", () => {
    expect(heightForSnap("tall", 800)).toBe(680);
    expect(SHEET_SNAPS.tall).toBeLessThan(1);
  });
  it("falls back to half for an unknown snap name", () => {
    expect(heightForSnap("bogus", 800)).toBe(heightForSnap("half", 800));
  });
  it("never negative on a zero/undefined viewport", () => {
    expect(heightForSnap("half", 0)).toBe(0);
    expect(heightForSnap("half", undefined)).toBe(0);
  });
});

describe("resolveDragSnap", () => {
  const halfPx = 400, tallPx = 680, dismissBelowPx = 180;
  it("resolves to half when released below the midpoint", () => {
    expect(resolveDragSnap({ heightPx: 420, halfPx, tallPx, dismissBelowPx })).toBe("half");
  });
  it("resolves to tall when released above the midpoint", () => {
    expect(resolveDragSnap({ heightPx: 600, halfPx, tallPx, dismissBelowPx })).toBe("tall");
  });
  it("dismisses when dragged below the dismiss threshold", () => {
    expect(resolveDragSnap({ heightPx: 100, halfPx, tallPx, dismissBelowPx })).toBe("dismiss");
  });
  it("the dismiss threshold is exclusive at its own boundary", () => {
    expect(resolveDragSnap({ heightPx: 180, halfPx, tallPx, dismissBelowPx })).not.toBe("dismiss");
  });
});

describe("keyboardInsetPx", () => {
  it("no visualViewport → 0 (desktop / unsupported browser)", () => {
    expect(keyboardInsetPx({ innerHeight: 800 })).toBe(0);
  });
  it("keyboard closed: visualViewport fills the window → 0 inset", () => {
    const win = { innerHeight: 800, visualViewport: { height: 800, offsetTop: 0 } };
    expect(keyboardInsetPx(win)).toBe(0);
  });
  it("keyboard open: visualViewport shrinks by the keyboard's height", () => {
    const win = { innerHeight: 800, visualViewport: { height: 480, offsetTop: 0 } };
    expect(keyboardInsetPx(win)).toBe(320);
  });
  it("ignores a sub-pixel rounding gap (never reports a phantom keyboard)", () => {
    const win = { innerHeight: 800, visualViewport: { height: 799.6, offsetTop: 0 } };
    expect(keyboardInsetPx(win)).toBe(0);
  });
});

// NEW-1 (2026-10-06, live signed-in WebKit pass): with the keyboard up iOS also SCROLLS the visual viewport (offsetTop > 0) to
// reveal the field. keyboardInsetPx counts that scroll (the sheet's BOTTOM must sit on the visible band's bottom), so the clamp's
// `layout − inset` is the visible height PLUS the scroll: the sheet could stand taller than the band and its top rows — the first
// field, "Building number" — ended up above the top of the screen. Measured: sheet top 47 vs visible top 130 on the iPhone 15
// descriptor, both iOS models, `ui-audit/verify-phone-typing.mjs` "view scrolled late by iOS". The CEILING must come from the
// keyboard's HEIGHT (layout − visible height, scroll-free) and be applied as a max-height, so it takes effect instantly.
describe("keyboardHeightPx vs keyboardInsetPx on a scrolled visual viewport", () => {
  // iPhone 15 descriptor: layout 659, keyboard 380 → visible height 279; iOS has scrolled the viewport by 109
  const win = (offsetTop) => ({ innerHeight: 659, visualViewport: { height: 279, offsetTop } });
  it("the inset subtracts the scroll (the bottom anchor); the keyboard height does not (the ceiling)", () => {
    expect(keyboardInsetPx(win(109))).toBe(271);
    expect(keyboardHeightPx(win(109))).toBe(380);
  });
  it("agree when the viewport has not scrolled, and are 0 with no keyboard / no visualViewport", () => {
    expect(keyboardHeightPx(win(0))).toBe(keyboardInsetPx(win(0)));
    expect(keyboardHeightPx({ innerHeight: 659, visualViewport: { height: 659, offsetTop: 0 } })).toBe(0);
    expect(keyboardHeightPx({ innerHeight: 659 })).toBe(0);
    expect(keyboardHeightPx(null)).toBe(0);
  });
});
describe("sheetMaxHeightForKeyboard", () => {
  it("is the visible height minus the top margin while a keyboard is up — the same whatever the scroll", () => {
    expect(sheetMaxHeightForKeyboard(659, 380)).toBe(255);
  });
  it("has no ceiling without a keyboard (the caller keeps its own max-height)", () => {
    expect(sheetMaxHeightForKeyboard(659, 0)).toBeNull();
  });
  it("never collapses below the minimum on a very short visible area", () => {
    expect(sheetMaxHeightForKeyboard(500, 460)).toBe(120);
  });
});

describe("clampSheetHeightForKeyboard", () => {
  it("leaves the height unchanged when there is plenty of room", () => {
    expect(clampSheetHeightForKeyboard(400, 800, 0)).toBe(400);
  });
  it("shrinks the sheet so its top never runs off-screen once the keyboard opens", () => {
    // viewport 800, keyboard covers 300 → available = 800 - 300 - 24 = 476
    expect(clampSheetHeightForKeyboard(680, 800, 300)).toBe(476);
  });
  it("never collapses below the minimum height even on a very short visual viewport", () => {
    expect(clampSheetHeightForKeyboard(680, 500, 460, 24, 120)).toBe(120);
  });
});

describe("selectionCoverDeltaPx", () => {
  it("returns 0 when the selection is already fully above the sheet", () => {
    expect(selectionCoverDeltaPx({ selTop: 100, selBottom: 200, sheetTopY: 400 })).toBe(0);
  });
  it("returns the overlap plus margin when the sheet covers the selection", () => {
    // selBottom 500 + margin 16 - sheetTopY 400 = 116
    expect(selectionCoverDeltaPx({ selTop: 450, selBottom: 500, sheetTopY: 400, margin: 16 })).toBe(116);
  });
  it("never shifts the selection above the true viewport top", () => {
    // selTop is only 10px below the viewport top, so room is tiny even though the raw overlap is large
    expect(selectionCoverDeltaPx({ selTop: 26, selBottom: 500, sheetTopY: 100, margin: 16, viewportTop: 0 }))
      .toBe(10); // room = 26 - 0 - 16 = 10, less than the raw overlap of 416
  });
  it("returns 0 with unknown geometry rather than guessing", () => {
    expect(selectionCoverDeltaPx({ selTop: 10, selBottom: null, sheetTopY: 400 })).toBe(0);
    expect(selectionCoverDeltaPx({ selTop: 10, selBottom: 500, sheetTopY: null })).toBe(0);
  });
});
