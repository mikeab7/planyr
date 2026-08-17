/* THE RIGHT-CLICK MENU IS ALWAYS FULLY VISIBLE (NEW-MENU-OFFSCREEN).
 *
 * ⛔ HIS REPORT: *"you can't see everything on the menu because the delete part is hidden behind
 * my start menu or task bar."*
 *
 * ⛔ THE OLD RULE WAS A GUESS, AND THAT IS THE WHOLE DEFECT: `top: Math.min(at.y, innerHeight -
 * 420)` — a hard-coded 420px estimate of the menu's own height, never checked against what
 * actually rendered. A menu taller than the guess still ran off the bottom, and the row that fell
 * off was the LAST one, which is `Delete this box`.
 *
 * ⛔ SO THE RULE TAKES THE MEASURED SIZE AND IS PURE, which is what lets every case below be a
 * test rather than something you have to open a browser and squint at. The browser half — that
 * the number handed in really is the rendered size of the whole assembly, strip included — is
 * `ui-audit/verify-notes-menu-layout.mjs`.
 */
import { describe, expect, it } from "vitest";

import { placeMenu } from "../src/workspaces/notes/components/NoteEditor.jsx";

/** A viewport the size of his maximised window, and a menu the size the assembly really is. */
const VIEW = { viewW: 1500, viewH: 820 };
const M = 8;                                   // the margin the rule keeps

const bottomOf = (r, h) => r.top + h;
const rightOf = (r, w) => r.left + w;

describe("the ordinary case", () => {
  it("opens below and right of the pointer when there is room", () => {
    const r = placeMenu({ x: 400, y: 200, w: 240, h: 300, ...VIEW });
    expect(r).toMatchObject({ left: 400, top: 200, flipped: false });
  });

  it("…and that is the pointer's own position, not an offset from it", () => {
    const r = placeMenu({ x: 137, y: 61, w: 240, h: 300, ...VIEW });
    expect(r.left).toBe(137);
    expect(r.top).toBe(61);
  });
});

describe("⛔ the bottom edge — his case", () => {
  /* ⛔ THE MENU IS 430 TALL WITH THE STRIP ON IT, WHICH IS PAST THE OLD 420 GUESS. Opened near the
   * bottom of a maximised window, the old rule left the last row under the taskbar. */
  it("⛔ FLIPS above the pointer when it will not fit below", () => {
    const r = placeMenu({ x: 400, y: 700, w: 240, h: 430, ...VIEW });
    expect(r.flipped, "it should flip, not merely slide").toBe(true);
    expect(bottomOf(r, 430)).toBeLessThanOrEqual(VIEW.viewH - M);
  });

  it("⛔ …and the LAST row is on screen, which is the row he could not reach", () => {
    for (const y of [640, 700, 760, 800, 819]) {
      const r = placeMenu({ x: 400, y, w: 240, h: 430, ...VIEW });
      expect(bottomOf(r, 430), `opened at y=${y}`).toBeLessThanOrEqual(VIEW.viewH - M);
      expect(r.top, `opened at y=${y}`).toBeGreaterThanOrEqual(M);
    }
  });

  it("slides up rather than flipping when there is no room either way", () => {
    // A short window: 430 does not fit below y=300 and does not fit above it either.
    const r = placeMenu({ x: 400, y: 300, w: 240, h: 430, viewW: 1500, viewH: 500 });
    expect(r.top).toBeGreaterThanOrEqual(M);
    expect(bottomOf(r, 430)).toBeLessThanOrEqual(500 - M);
  });

  /* ⛔ A MENU TALLER THAN THE WHOLE VIEWPORT STILL HAS TO START ON SCREEN. Clamping the BOTTOM
   * would push the top off, so the first rows — the ones you reach for most — would be the
   * unreachable ones. The top wins. */
  it("⛔ a menu taller than the viewport starts at the top, not off the top", () => {
    const r = placeMenu({ x: 400, y: 400, w: 240, h: 900, viewW: 1500, viewH: 500 });
    expect(r.top).toBe(M);
  });
});

describe("the right edge, and the top", () => {
  it("pulls left so the menu never runs off the right", () => {
    const r = placeMenu({ x: 1440, y: 200, w: 240, h: 300, ...VIEW });
    expect(rightOf(r, 240)).toBeLessThanOrEqual(VIEW.viewW - M);
  });

  it("…but never off the LEFT while doing it", () => {
    const r = placeMenu({ x: 20, y: 200, w: 900, h: 300, viewW: 400, viewH: 820 });
    expect(r.left).toBeGreaterThanOrEqual(0);
  });

  it("a menu opened near the top is not pushed above the viewport", () => {
    const r = placeMenu({ x: 400, y: 2, w: 240, h: 300, ...VIEW });
    expect(r.top).toBeGreaterThanOrEqual(M);
  });
});

describe("it never throws, whatever it is handed", () => {
  /* The first render happens BEFORE the measurement exists, so zero and undefined are ordinary
   * inputs here rather than edge cases. */
  it("survives an unmeasured menu", () => {
    expect(placeMenu({ x: 100, y: 100, w: 0, h: 0, ...VIEW })).toMatchObject({ left: 100, top: 100 });
    expect(() => placeMenu({})).not.toThrow();
  });

  it("falls back to a sane viewport rather than NaN", () => {
    const r = placeMenu({ x: 100, y: 100, w: 240, h: 300 });
    expect(Number.isFinite(r.left) && Number.isFinite(r.top)).toBe(true);
  });

  /* ⛔ EVERY RESULT IS A WHOLE PIXEL. A fractional `top` on a fixed-position element makes the
   * text inside it render on a half-pixel and go soft, which reads as a rendering bug. */
  it("rounds", () => {
    const r = placeMenu({ x: 100.4, y: 100.6, w: 240, h: 300, ...VIEW });
    expect(Number.isInteger(r.left) && Number.isInteger(r.top)).toBe(true);
  });
});

/* ⛔ THE PROPERTY, SWEPT — because the cases above are the ones I thought of, and the defect he
 * reported was in a case nobody thought of. For every pointer position on a grid across his
 * window, and for the three heights the assembly actually takes, the menu must be fully inside
 * the viewport. This is the check that would have caught the 420 guess. */
describe("⛔ THE PROPERTY: fully on screen, from anywhere, at any size", () => {
  it("holds for every pointer position and every menu size", () => {
    const bad = [];
    for (const h of [180, 300, 430, 520]) {
      for (const w of [224, 240, 320]) {
        for (let y = 0; y <= 819; y += 37) {
          for (let x = 0; x <= 1499; x += 71) {
            const r = placeMenu({ x, y, w, h, ...VIEW });
            const fits = r.left >= 0 && r.top >= 0
              && rightOf(r, w) <= VIEW.viewW && bottomOf(r, h) <= VIEW.viewH;
            if (!fits) bad.push(`(${x},${y}) ${w}×${h} → ${r.left},${r.top}`);
          }
        }
      }
    }
    expect(bad.slice(0, 5), `${bad.length} placements ran off screen`).toEqual([]);
  });
});
