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
  // NEW-1 (2026-11-10) — owner: "I right click on a road … my click goes to like the middle of the menu, so I have to move my
  // mouse up to Add control point." The old rule FLIPPED the whole menu above the cursor on any bottom overflow, so a 335 px
  // road menu opened 25 px short of the bottom edge put its first row 335 px above the pointer.
  describe("opens AT the cursor; slides (not flips) on a small bottom overflow (NEW-1, 2026-11-10)", () => {
    const road = { menuW: 236, menuH: 335, viewportW: 1280, viewportH: 720 };

    it("mid-canvas click on a roomy window: top-left at the cursor, first row under the pointer", () => {
      const p = placeContextMenu({ cursorX: 512, cursorY: 200, ...road });
      expect(p.left).toBe(514);
      expect(p.top).toBe(202);
    });

    it("the measured failure — 25 px of overflow — slides up by the overflow instead of flipping a whole menu-height", () => {
      const p = placeContextMenu({ cursorX: 512, cursorY: 400, ...road });
      expect(p.top + road.menuH, "bottom edge sits on the bottom margin").toBe(720 - M);
      expect(p.top).toBe(720 - M - 335); // 377: the first row is 23 px above the pointer, not 337
      expect(400 - p.top, "pointer is within the menu, near its top").toBeLessThan(40);
    });

    it("keeps the pointer in the top half after a slide, so the first rows stay in reach", () => {
      for (const cursorY of [380, 420, 450, 500]) {
        const p = placeContextMenu({ cursorX: 512, cursorY, ...road });
        if (p.top <= cursorY) expect(cursorY - p.top, `y=${cursorY}`).toBeLessThanOrEqual(road.menuH / 2);
        expect(p.top + road.menuH, `y=${cursorY} on screen`).toBeLessThanOrEqual(720 - M);
        expect(p.top, `y=${cursorY} on screen`).toBeGreaterThanOrEqual(M);
      }
    });

    it("a click hard against the bottom edge still FLIPS up (the menu clears the pointer, nothing under it)", () => {
      const p = placeContextMenu({ cursorX: 512, cursorY: 712, ...road });
      expect(p.top).toBe(712 - 2 - 335);
      expect(p.top + road.menuH).toBeLessThanOrEqual(720 - M);
    });

    it("a tall menu in a short window slides to fit rather than parking at the very top with the pointer mid-menu", () => {
      // 600 px menu, 720 window, click at 400: flipping needs top = -202 (no room) — the old clamp pinned it to y=8.
      const p = placeContextMenu({ cursorX: 512, cursorY: 400, menuW: 236, menuH: 600, viewportW: 1280, viewportH: 720 });
      expect(p.top).toBe(720 - M - 600);
      expect(p.top + 600).toBeLessThanOrEqual(720 - M);
      expect(p.top).toBeGreaterThanOrEqual(M);
    });

    it("right edge: opens to the LEFT of the pointer, tight against it, fully on screen", () => {
      const p = placeContextMenu({ cursorX: 1270, cursorY: 200, ...road });
      expect(p.left + road.menuW).toBe(1270 - 2);
      expect(p.left + road.menuW).toBeLessThanOrEqual(1280 - M);
      expect(p.top).toBe(202);
    });

    it("bottom-right corner: both flips, still on screen, pointer just outside the menu's corner", () => {
      const p = placeContextMenu({ cursorX: 1275, cursorY: 715, ...road });
      expect(p.left + road.menuW).toBeLessThanOrEqual(1280 - M);
      expect(p.top + road.menuH).toBeLessThanOrEqual(720 - M);
      // as close to the pointer as the 8 px edge margin allows (the pointer is 5 px from each edge)
      expect(1275 - (p.left + road.menuW)).toBeLessThanOrEqual(M);
      expect(715 - (p.top + road.menuH)).toBeLessThanOrEqual(M);
    });
  });
});
