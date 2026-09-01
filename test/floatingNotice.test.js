/* FloatingNotice's bottom-sheet clearance math (NEW-1, B1000400, docs/DESIGN.md "Floating
 * notifications"). The DOM/portal half needs a browser (proven live — e2e/notification-position.spec.js
 * and the OWNER-facing V568016 check); this pins the ARITHMETIC — a floating notice must clear an
 * open mobile bottom sheet by exactly its height plus the shared gap, and fall back to the plain
 * bottom offset the instant the sheet reports 0 (closed/unmounted).
 */
import { describe, it, expect } from "vitest";
import { noticeBottomOffset, NOTICE_BOTTOM, NOTICE_GAP } from "../src/shared/ui/FloatingNotice.jsx";
import {
  publishBottomSheetHeight, currentBottomSheetHeight, subscribeBottomSheetHeight,
} from "../src/shared/ui/bottomSheetTracker.js";

describe("noticeBottomOffset — clears an open bottom sheet, never sits under or over it", () => {
  it("with no sheet open, sits at the plain bottom offset", () => {
    expect(noticeBottomOffset(0)).toBe(NOTICE_BOTTOM);
  });

  it("with a sheet open, adds the sheet's height plus the shared gap", () => {
    expect(noticeBottomOffset(400)).toBe(NOTICE_BOTTOM + 400 + NOTICE_GAP);
  });

  it("tracks the sheet's height exactly (mid-drag, not just at rest)", () => {
    expect(noticeBottomOffset(120.5)).toBeCloseTo(NOTICE_BOTTOM + 120.5 + NOTICE_GAP);
  });

  it("treats a negative or zero height the same as closed", () => {
    expect(noticeBottomOffset(0)).toBe(NOTICE_BOTTOM);
    expect(noticeBottomOffset(-1)).toBe(NOTICE_BOTTOM);
  });
});

describe("bottomSheetTracker — publish/subscribe", () => {
  it("clamps a negative or zero publish to 0", () => {
    publishBottomSheetHeight(300);
    expect(currentBottomSheetHeight()).toBe(300);
    publishBottomSheetHeight(-5);
    expect(currentBottomSheetHeight()).toBe(0);
  });

  it("notifies every subscriber with each published value, and stops after unsubscribe", () => {
    const seen = [];
    const unsubscribe = subscribeBottomSheetHeight((h) => seen.push(h));
    publishBottomSheetHeight(120);
    publishBottomSheetHeight(0); // e.g. BottomSheet's own unmount cleanup
    unsubscribe();
    publishBottomSheetHeight(500); // must NOT reach the now-unsubscribed listener
    expect(seen).toEqual([120, 0]);
  });

  it("a late subscriber reads the CURRENT value via currentBottomSheetHeight, not just future pushes", () => {
    publishBottomSheetHeight(240);
    expect(currentBottomSheetHeight()).toBe(240);
    publishBottomSheetHeight(0); // reset for other tests in this file
  });
});
