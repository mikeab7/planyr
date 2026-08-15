/* LABEL BOXES ARE SIZED FROM MEASURED TEXT, NOT A CHARACTER COUNT (B548818).
 *
 * Owner report, on the measurement summary chip: the plate is far wider than the text inside it.
 * Measured on his plan — widest rendered line 53.5 units, plate 91.5, i.e. 19 units of dead air
 * on each side against 0.9 above and 3.2 below. The cause is one expression that every label
 * caller shared: `widest line by CHARACTER COUNT × (fontSize × 0.6)`. Two compounding errors —
 * a character count says "1" and "M" are the same width, and 0.6 em overstates the app's face,
 * which draws figures at roughly 0.55 em and separators at far less.
 *
 * Same defect class as the aerial-heading box; the brief was explicit that if a shared helper
 * does the estimating, the helper gets fixed and every caller swept. `widthOf` in labelLayout is
 * that helper, and these are its guards.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { layoutLabels } from "../src/workspaces/site-planner/lib/labelLayout.js";
import { heuristicWidth, canvasWidth, bestMeasurer } from "../src/shared/markup/textWrap.js";

const FS = 13.5;
const CHAR_W = FS * 0.6; // the estimate the app used to size every box with

const place = (item) => layoutLabels([{ id: "a", cx: 500, cy: 500, lh: 16, halfW: Infinity, halfH: Infinity, importance: 1, ...item }], {}).get("a");

describe("the estimate is the fallback, and the measurement wins when supplied", () => {
  it("with no measured widths, the box is EXACTLY the old character-count estimate", () => {
    const lines = ["193,007 SF"];
    const p = place({ lines, charW: CHAR_W });
    expect(p.box.w).toBeCloseTo(lines[0].length * CHAR_W, 6);
  });

  it("supplying measured widths sizes the box to the measurement instead", () => {
    const lines = ["193,007 SF"];
    const measured = 61.25;
    const p = place({ lines, charW: CHAR_W, textW: { [lines[0]]: measured } });
    expect(p.box.w).toBeCloseTo(measured, 6);
  });

  /* THE NUMBER THE OWNER SAW. A digit-heavy line is where the 0.6-em guess is worst: measured in
   * a real browser on his plan, a line that drew 53.5 units wide was boxed at 91.5 — 71% over.
   * The assertion here is deliberately weaker than that, because the fallback table it compares
   * against is itself documented as an OVER-estimate ("an over-estimate only boxes a touch wide;
   * an under-estimate is the overflow bug this module exists to prevent"). Beating even the
   * generous fallback is the point: the char-count guess is wider than a measurer that is already
   * trying to be wide. */
  it("on a digit-heavy line the old estimate overshoots even the generous fallback", () => {
    const line = "193,007 SF";
    const est = line.length * CHAR_W;
    expect(est).toBeGreaterThan(heuristicWidth(line, FS) * 1.05);
  });

  /* A box may only ever be measured per LINE — the longest line by characters is not always the
   * widest line on screen. This is the case a character count gets backwards, not merely
   * imprecise, and it is why the fix is per-line widths rather than a better constant. */
  it("the widest line is the one that DRAWS widest, not the one with the most characters", () => {
    const many = "iiiiii";   // six of the narrowest glyphs in the face
    const few = "MMM";       // three of the widest — fewer characters, more ink
    expect(few.length).toBeLessThan(many.length);
    expect(heuristicWidth(few, FS)).toBeGreaterThan(heuristicWidth(many, FS));
    const p = place({ lines: [many, few], charW: CHAR_W, textW: { [many]: heuristicWidth(many, FS), [few]: heuristicWidth(few, FS) } });
    expect(p.box.w).toBeCloseTo(heuristicWidth(few, FS), 6);
  });

  it("a line with no measured entry (a reflowable spec) falls back rather than collapsing to nothing", () => {
    const lines = ["Building 1", "80,000 SF"];
    const p = place({ lines, charW: CHAR_W, textW: { "80,000 SF": 40 } });
    expect(p.box.w).toBeCloseTo("Building 1".length * CHAR_W, 6); // the unmeasured line still counts
  });

  /* Measured widths are an INPUT to placement, so two frames that differ only in them must not be
   * served the same memoized layout. */
  it("the layout memo distinguishes two frames whose only difference is the measured width", () => {
    const lines = ["193,007 SF"];
    const a = place({ lines, charW: CHAR_W, textW: { [lines[0]]: 40 } });
    const b = place({ lines, charW: CHAR_W, textW: { [lines[0]]: 120 } });
    expect(a.box.w).not.toBeCloseTo(b.box.w, 3);
  });
});

describe("the shared measurer", () => {
  it("returns null outside a browser so callers fall back to the pure table", () => {
    expect(canvasWidth("x", 12)).toBeNull();
    expect(bestMeasurer()("x", 12)).toBe(heuristicWidth("x", 12));
  });
  /* Letter-spacing is real width and `measureText` does not report it — the chip's subordinate
   * lines carry 0.02 em, so a measurer blind to it under-sizes exactly those lines. */
  it("letter-spacing is counted as width by both measurers", () => {
    const plain = heuristicWidth("250,000 SF", 10);
    const spaced = heuristicWidth("250,000 SF", 10, { letterSpacing: 0.02 });
    expect(spaced).toBeCloseTo(plain + 0.02 * 10 * "250,000 SF".length, 6);
    expect(bestMeasurer({ letterSpacing: 0.02 })("250,000 SF", 10)).toBeCloseTo(spaced, 6);
  });
});

describe("every caller was swept, not just the one that was reported", () => {
  const SRC = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
  /* ⛔ The point of the sweep. The measurement chip was the loudest instance; the element-label
   * pass and the parcel acreage badge shared the identical expression. A guard on the chip alone
   * would leave the other two to be rediscovered. */
  it("no label pass still sizes a box by multiplying a character count", () => {
    const offenders = SRC.split("\n")
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /\.length\s*\*\s*\w*[cC]harW/.test(l) && !/\?\?/.test(l))
      .map(([i, l]) => `SitePlanner.jsx:${i}  ${l.trim().slice(0, 110)}`);
    expect(offenders).toEqual([]);
  });
  it("the three label passes all hand measured widths to the engine", () => {
    expect((SRC.match(/textW:/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(SRC).toContain("bestMeasurer");
  });
});
