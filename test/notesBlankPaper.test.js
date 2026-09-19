/* THE BLANK-PAPER DECISION (NEW-1, owner report 2026-09-18 — the fifth round on one symptom).
 *
 * ⛔ THE CASE THESE NUMBERS COME FROM is his, restated in pixels: a short line whose writing ends
 * well inside a wide page, and a press level with it but a long way further across. The shipped
 * test asked only "is there a line at this height", so the answer was "yes, that one" however far
 * out the press was, and his next character went into that line.
 *
 * The browser reading (which rectangles a line occupies) belongs to the caller; what is pinned
 * here is the DECISION, which is the part that was wrong.
 */
import { describe, expect, it } from "vitest";
import {
  BLANK_DBLTAP_MS, BLANK_DBLTAP_PX, isBlankDoublePress, pressPastLineEnd,
} from "../src/workspaces/notes/lib/notesBlankPaper.js";

/** One rendered line: a 20px-tall row of writing running from x=100 to x=240. */
const LINE = { top: 100, bottom: 120, left: 100, right: 240 };
/** A paragraph that wrapped onto two lines, the second one shorter. */
const WRAPPED = [
  { top: 100, bottom: 120, left: 100, right: 700 },
  { top: 120, bottom: 140, left: 100, right: 310 },
];

describe("pressPastLineEnd — his reported case", () => {
  it("calls a press a long way past the end of the line blank paper", () => {
    // Level with the line (y=110), far past where its words stop (x=240).
    expect(pressPastLineEnd([LINE], 900, 110)).toBe(true);
  });

  it("still calls a press just past the last glyph part of that line", () => {
    // Within one line-height of the end: double-clicking here must go on selecting the last word.
    expect(pressPastLineEnd([LINE], 250, 110)).toBe(false);
    expect(pressPastLineEnd([LINE], 259, 110)).toBe(false);
  });

  it("puts the boundary at the line's OWN height, so it scales with the type", () => {
    // 20px line → 20px of slack. 241..260 is the line; past 260 is paper.
    expect(pressPastLineEnd([LINE], 260, 110)).toBe(false);
    expect(pressPastLineEnd([LINE], 261, 110)).toBe(true);
    // A 40px line earns 40px of slack from the same rule, with nothing to keep in step by hand.
    const big = { top: 100, bottom: 140, left: 100, right: 240 };
    expect(pressPastLineEnd([big], 275, 120)).toBe(false);
    expect(pressPastLineEnd([big], 285, 120)).toBe(true);
  });

  it("never calls a press ON the writing blank paper", () => {
    expect(pressPastLineEnd([LINE], 150, 110)).toBe(false);
    expect(pressPastLineEnd([LINE], 240, 110)).toBe(false);
  });

  it("leaves the LEFT margin alone — that is B1368's case, not this one", () => {
    expect(pressPastLineEnd([LINE], 20, 110)).toBe(false);
    expect(pressPastLineEnd([LINE], 99, 110)).toBe(false);
  });
});

describe("pressPastLineEnd — a paragraph that wraps", () => {
  it("answers about the row the press is actually on, not the widest one", () => {
    // Level with the SHORT second line, past its end but well inside the first line's width.
    expect(pressPastLineEnd(WRAPPED, 500, 130)).toBe(true);
    // The same x, level with the LONG first line, is on the writing.
    expect(pressPastLineEnd(WRAPPED, 500, 110)).toBe(false);
  });

  it("treats the seam between two lines as belonging to the lower one", () => {
    // y=120 is the first line's `bottom` and the second's `top`; a half-open test keeps it
    // unambiguous, and either answer here is "on text" rather than blank paper.
    expect(pressPastLineEnd(WRAPPED, 200, 120)).toBe(false);
  });
});

describe("pressPastLineEnd — refusing to guess", () => {
  it("says no when no row owns the press's height", () => {
    // Below the last line is open page, but it is a DIFFERENT case and handled elsewhere;
    // claiming a row that does not exist would place a box off the back of a guess.
    expect(pressPastLineEnd([LINE], 900, 400)).toBe(false);
    expect(pressPastLineEnd(WRAPPED, 900, 40)).toBe(false);
  });

  it("says no when the shape could not be read at all", () => {
    expect(pressPastLineEnd(null, 900, 110)).toBe(false);
    expect(pressPastLineEnd([], 900, 110)).toBe(false);
    expect(pressPastLineEnd([LINE], NaN, 110)).toBe(false);
    expect(pressPastLineEnd([LINE], 900, undefined)).toBe(false);
  });
});

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
