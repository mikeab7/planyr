/* THE BLANK-PAPER DOUBLE-CLICK PAIRING (NEW-1, owner report 2026-09-18, amended 2026-09-22).
 *
 * ⛔ `pressPastLineEnd` IS GONE, WITH ITS TESTS (NEW-1, 2026-09-22) — it answered "is this
 * press past the end of a line of FLOW TEXT", and there is no flow text left on the page for a
 * press to be past the end of; the sheet holds nothing but positioned boxes. See
 * `notesBlankPaper.js`'s own header for the retired mechanism's history. `isBlankDoublePress`
 * is the one piece that survives: every press on blank paper still needs to know whether it is
 * the first or the second of a pair, regardless of what (if anything) used to be nearby.
 */
import { describe, expect, it } from "vitest";
import {
  BLANK_DBLTAP_MS, BLANK_DBLTAP_PX, isBlankDoublePress,
} from "../src/workspaces/notes/lib/notesBlankPaper.js";

describe("isBlankDoublePress — the pair, reconstructed", () => {
  const first = { t: 1000, x: 500, y: 300 };

  it("pairs two presses close in time and place", () => {
    expect(isBlankDoublePress(first, { t: 1200, x: 501, y: 299 })).toBe(true);
  });

  it("refuses a pair that is too slow", () => {
    expect(isBlankDoublePress(first, { t: 1000 + BLANK_DBLTAP_MS, x: 500, y: 300 })).toBe(false);
    expect(isBlankDoublePress(first, { t: 3000, x: 500, y: 300 })).toBe(false);
  });

  it("refuses a pair that moved too far", () => {
    expect(isBlankDoublePress(first, { t: 1100, x: 500 + BLANK_DBLTAP_PX + 1, y: 300 })).toBe(false);
    expect(isBlankDoublePress(first, { t: 1100, x: 500, y: 300 + BLANK_DBLTAP_PX + 1 })).toBe(false);
  });

  it("has no first press to pair with, or nonsense timestamps", () => {
    expect(isBlankDoublePress(null, { t: 1100, x: 500, y: 300 })).toBe(false);
    expect(isBlankDoublePress(first, null)).toBe(false);
    expect(isBlankDoublePress(first, { t: NaN, x: 500, y: 300 })).toBe(false);
    // A clock that went backwards is not a gesture.
    expect(isBlankDoublePress(first, { t: 900, x: 500, y: 300 })).toBe(false);
  });
});
