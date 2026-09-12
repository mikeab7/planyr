import { describe, it, expect } from "vitest";
import { zoomStackBottomPx, TOP_RIGHT_ROW_RESERVE_PX } from "../src/workspaces/site-planner/lib/mapChromeStack.js";

// B1338272 — the smallest current iPhone in landscape gives a 568×320 device a canvas about
// 263px tall once the header/toolbar are subtracted (measured live against the owner's real
// Bain plan). The desktop desired offset (100) and the narrow one are both fixed constants
// tuned for a canvas comfortably taller than that.
// ⛔ SUPERSEDED (NEW-2, phone-chrome-parity pass) — `NARROW_DESIRED`/`FURNITURE_ROW_NARROW` no
// longer add the now-removed `FAB_RESERVE_PX` (62); the caller's real narrow values are
// `68 + narrowSafeBottom` / `8 + narrowSafeBottom` (SitePlanner.jsx). `zoomStackBottomPx` itself
// is untouched — it only ever consumed `desired`/`floor` as plain numbers — so this test still
// exercises the real pure function; these two constants are just realistic-shaped inputs to it,
// not a claim about what the caller currently passes.
const DESKTOP_DESIRED = 100;
const NARROW_DESIRED = 162;
const STACK_H = 90; // three 30px buttons
const FURNITURE_ROW_NARROW = 102;
const FURNITURE_ROW_DESKTOP = 40;

describe("zoomStackBottomPx (B1338272 — the zoom stack must never climb into the top-right row)", () => {
  it("returns the desired offset UNCHANGED on a comfortably tall canvas (desktop stays pixel-identical)", () => {
    const got = zoomStackBottomPx({ desired: DESKTOP_DESIRED, paneH: 800, stackH: STACK_H, floor: FURNITURE_ROW_DESKTOP });
    expect(got).toBe(DESKTOP_DESIRED);
  });

  it("returns the desired offset UNCHANGED on a typical phone-portrait canvas", () => {
    const got = zoomStackBottomPx({ desired: NARROW_DESIRED, paneH: 560, stackH: STACK_H, floor: FURNITURE_ROW_NARROW });
    expect(got).toBe(NARROW_DESIRED);
  });

  it("clamps on the real iPhone SE landscape canvas height, and the clamped stack clears the top row", () => {
    const paneH = 263; // measured live, Chromium mobile emulation, the owner's real Bain plan fixture
    const got = zoomStackBottomPx({ desired: NARROW_DESIRED, paneH, stackH: STACK_H, floor: FURNITURE_ROW_NARROW });
    expect(got).toBeLessThan(NARROW_DESIRED);
    // the stack's own top edge, measured from the canvas top
    const stackTop = paneH - got - STACK_H;
    expect(stackTop).toBeGreaterThanOrEqual(TOP_RIGHT_ROW_RESERVE_PX);
  });

  it("never returns less than the floor, even on an extremely short canvas", () => {
    const got = zoomStackBottomPx({ desired: NARROW_DESIRED, paneH: 120, stackH: STACK_H, floor: FURNITURE_ROW_NARROW });
    expect(got).toBe(FURNITURE_ROW_NARROW);
  });

  it("holds CONTINUOUSLY as the canvas shrinks — no per-device cliff, monotonically non-increasing", () => {
    let prev = Infinity;
    for (let paneH = 700; paneH >= 150; paneH -= 5) {
      const got = zoomStackBottomPx({ desired: NARROW_DESIRED, paneH, stackH: STACK_H, floor: FURNITURE_ROW_NARROW });
      expect(got).toBeLessThanOrEqual(prev);
      expect(got).toBeGreaterThanOrEqual(FURNITURE_ROW_NARROW);
      prev = got;
    }
  });

  it("clears the top row at every pane height above the floor's own breakeven point", () => {
    for (let paneH = 200; paneH <= 700; paneH += 11) {
      const got = zoomStackBottomPx({ desired: NARROW_DESIRED, paneH, stackH: STACK_H, floor: FURNITURE_ROW_NARROW });
      const stackTop = paneH - got - STACK_H;
      // Once the floor itself binds (an extremely short canvas), clearing the top row is no
      // longer possible at any offset — that's the named, accepted edge case. Above that point,
      // the clamp must guarantee real clearance.
      const floorBinds = got === FURNITURE_ROW_NARROW && paneH - FURNITURE_ROW_NARROW - STACK_H < TOP_RIGHT_ROW_RESERVE_PX;
      if (!floorBinds) expect(stackTop).toBeGreaterThanOrEqual(TOP_RIGHT_ROW_RESERVE_PX);
    }
  });
});
