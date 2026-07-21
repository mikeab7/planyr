import { describe, it, expect } from "vitest";
import { placeContextMenu } from "../src/shared/ui/contextMenuPlacement.js";

// Pure cursor-anchored context-menu placement (B915). Every hand-rolled menu used to feed an
// ASSUMED height into a one-sided clamp, so a tall menu opened near the bottom edge ran its
// Delete row off-screen. Lock the flip-up / flip-left / clamp / max-height behavior here.

const VIEW = { viewportW: 1200, viewportH: 800 };
const M = 8;

describe("placeContextMenu (B915)", () => {
  it("opens at the cursor (top-left) when there's room on all sides", () => {
    const p = placeContextMenu({ cursorX: 300, cursorY: 200, menuW: 200, menuH: 260, ...VIEW });
    expect(p.left).toBe(302); // cursorX + gap(2)
    expect(p.top).toBe(202); // cursorY + gap(2)
    // fully inside the viewport
    expect(p.left + 200).toBeLessThanOrEqual(1200 - M);
    expect(p.top + 260).toBeLessThanOrEqual(800 - M);
  });

  it("flips UP when the menu would overflow the bottom edge (the reported pin-menu bug)", () => {
    // A tall status+share+delete menu right-clicked near the bottom of the map.
    const menuH = 360;
    const p = placeContextMenu({ cursorX: 400, cursorY: 770, menuW: 200, menuH, ...VIEW });
    // opens ABOVE the cursor, not below (where Delete would be clipped)
    expect(p.top).toBe(770 - 2 - menuH); // cursorY - gap - menuH
    expect(p.top).toBeGreaterThanOrEqual(M);
    // the whole menu — including its last row — is now on-screen
    expect(p.top + menuH).toBeLessThanOrEqual(800 - M);
  });

  it("flips LEFT when the menu would overflow the right edge", () => {
    const menuW = 240;
    const p = placeContextMenu({ cursorX: 1180, cursorY: 300, menuW, menuH: 200, ...VIEW });
    expect(p.left).toBe(1180 - 2 - menuW); // cursorX - gap - menuW → opens to the left
    expect(p.left).toBeGreaterThanOrEqual(M);
    expect(p.left + menuW).toBeLessThanOrEqual(1200 - M);
  });

  it("flips BOTH ways on a bottom-right corner click", () => {
    const menuW = 220, menuH = 300;
    const p = placeContextMenu({ cursorX: 1190, cursorY: 790, menuW, menuH, ...VIEW });
    expect(p.left).toBe(1190 - 2 - menuW);
    expect(p.top).toBe(790 - 2 - menuH);
    expect(p.left).toBeGreaterThanOrEqual(M);
    expect(p.top).toBeGreaterThanOrEqual(M);
    expect(p.left + menuW).toBeLessThanOrEqual(1200 - M);
    expect(p.top + menuH).toBeLessThanOrEqual(800 - M);
  });

  it("hard-clamps to the margin and caps height when the menu is taller than the viewport", () => {
    const menuH = 1000; // taller than the 800 viewport
    const p = placeContextMenu({ cursorX: 600, cursorY: 400, menuW: 200, menuH, ...VIEW });
    // top-left pinned inside the margin box even though the menu can't fully fit
    expect(p.top).toBe(M);
    expect(p.left).toBeGreaterThanOrEqual(M);
    // height capped to the viewport minus both margins → the component scrolls the overflow
    expect(p.maxHeight).toBe(800 - 2 * M);
  });

  it("keeps a left-edge / top-edge click off the very edge (margin respected)", () => {
    const p = placeContextMenu({ cursorX: 1, cursorY: 1, menuW: 200, menuH: 200, ...VIEW });
    expect(p.left).toBeGreaterThanOrEqual(M);
    expect(p.top).toBeGreaterThanOrEqual(M);
  });

  it("respects a custom margin", () => {
    const p = placeContextMenu({ cursorX: 600, cursorY: 400, menuW: 3000, menuH: 3000, ...VIEW, margin: 20 });
    expect(p.left).toBe(20);
    expect(p.top).toBe(20);
    expect(p.maxHeight).toBe(800 - 40);
  });
});
