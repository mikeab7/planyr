/* How a measurement PRESENTS its numbers (NEW-3).
 *
 * The complaint being fixed, verbatim: the area label was one run-on line —
 * "250,000 SF · 5.74 AC · 2,100′ perim" — three unrelated quantities at identical weight, with
 * both area units competing when only one matters at any scale, an abbreviation carrying the
 * headline's emphasis, and no dominant value at all.
 */
import { describe, it, expect } from "vitest";
import {
  SQFT_PER_ACRE, ACRE_LEAD_MIN_SF, fmtInt, fmt2, fmtFeet, fmtSf, fmtAcres,
  measureLabelModel, measureChipLines, headlineIndex, measureSegments,
} from "../src/workspaces/site-planner/lib/measureLabel.js";

describe("(f) one number convention, applied everywhere", () => {
  it("thousands separators, acres to two decimals, feet and square feet to zero", () => {
    expect(fmtInt(250000)).toBe("250,000");
    expect(fmtInt(2100.4)).toBe("2,100");
    expect(fmt2(5.7392)).toBe("5.74");
    expect(fmt2(5)).toBe("5.00");
    expect(fmtSf(250000)).toBe("250,000 SF");
    expect(fmtAcres(250000 / SQFT_PER_ACRE)).toBe("5.74 AC");
  });
  it("ONE feet convention — the prime mark, never a second spelling", () => {
    expect(fmtFeet(2100)).toBe("2,100′");
    expect(fmtFeet(2100)).not.toMatch(/ft|feet|'/);
  });
  it("the word 'perim' is gone from every label a measurement can produce", () => {
    const area = measureLabelModel("area", { areaSf: 250000, perimFt: 2100 });
    const line = measureLabelModel("line", { lengthFt: 3500 });
    const poly = measureLabelModel("polyline", { lengthFt: 3500, segments: 4 });
    const count = measureLabelModel("count", { count: 12 });
    for (const m of [area, line, poly, count]) {
      const all = [m.name, m.headline, m.detail].filter(Boolean).join(" ");
      expect(all).not.toMatch(/perim\b/);
    }
    expect(area.detail).toContain("perimeter"); // spelled out, and subordinate
  });
});

describe("(a)+(b) one dominant value, the headline unit chosen by magnitude", () => {
  it("below an acre it leads with square feet, with acres demoted to the detail line", () => {
    const m = measureLabelModel("area", { areaSf: 20000, perimFt: 600 });
    expect(m.headline).toBe("20,000 SF");
    expect(m.detail).toBe("0.46 AC · 600′ perimeter");
  });
  it("above an acre it leads with acres, with square feet demoted", () => {
    const m = measureLabelModel("area", { areaSf: 250000, perimFt: 2100 });
    expect(m.headline).toBe("5.74 AC");
    expect(m.detail).toBe("250,000 SF · 2,100′ perimeter");
  });
  it("the flip point is one acre exactly", () => {
    expect(measureLabelModel("area", { areaSf: ACRE_LEAD_MIN_SF - 1 }).headline).toMatch(/SF$/);
    expect(measureLabelModel("area", { areaSf: ACRE_LEAD_MIN_SF }).headline).toMatch(/AC$/);
  });
  it("NEVER both units at equal weight — each appears exactly once, on different lines", () => {
    const m = measureLabelModel("area", { areaSf: 250000, perimFt: 2100 });
    expect(m.headline).not.toContain("sf");
    expect(m.detail).not.toContain(" ac ");
    expect(m.detail.startsWith("250,000 SF")).toBe(true);
  });
  it("a perimeter of zero simply isn't printed", () => {
    expect(measureLabelModel("area", { areaSf: 250000, perimFt: 0 }).detail).toBe("250,000 SF");
  });
});

describe("(g) length and count get the same headline / detail treatment", () => {
  it("a two-point distance headlines the distance and has no padded detail line", () => {
    const m = measureLabelModel("line", { lengthFt: 3500, segments: 1 });
    expect(m.headline).toBe("3,500′");
    expect(m.detail).toBe(null);
  });
  it("a multi-leg run headlines the total and puts the breakdown underneath", () => {
    const m = measureLabelModel("polyline", { lengthFt: 3500, segments: 4 });
    expect(m.headline).toBe("3,500′");
    expect(m.detail).toBe("4 segments");
  });
  it("a count headlines the number with the unit underneath, singular when it is one", () => {
    expect(measureLabelModel("count", { count: 12 })).toMatchObject({ headline: "12", detail: "items" });
    expect(measureLabelModel("count", { count: 1 })).toMatchObject({ headline: "1", detail: "item" });
    expect(measureLabelModel("count", { count: 1400 }).headline).toBe("1,400");
  });
});

describe("the user's own label rides ABOVE the headline as a name", () => {
  it("is its own line, never concatenated into the number", () => {
    const m = measureLabelModel("area", { areaSf: 250000, perimFt: 2100 }, { label: "Detention take" });
    expect(m.name).toBe("Detention take");
    expect(m.headline).toBe("5.74 AC");
    expect(measureChipLines(m)).toEqual(["Detention take", "5.74 AC", "250,000 SF · 2,100′ perimeter"]);
    expect(headlineIndex(m)).toBe(1);
  });
  it("with no label the headline is the first line", () => {
    const m = measureLabelModel("line", { lengthFt: 900 });
    expect(m.name).toBe(null);
    expect(measureChipLines(m)).toEqual(["900′"]);
    expect(headlineIndex(m)).toBe(0);
  });
  it("a whitespace-only label is no label", () => {
    expect(measureLabelModel("line", { lengthFt: 900 }, { label: "   " }).name).toBe(null);
  });
  it("a very long label and a very large area still produce exactly three lines", () => {
    const long = "Proposed compensating storage take — north of the BKDD outfall channel";
    const m = measureLabelModel("area", { areaSf: 43_560_000, perimFt: 98_000 }, { label: long });
    const lines = measureChipLines(m);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(long);
    expect(lines[1]).toBe("1,000.00 AC");
    expect(lines[2]).toBe("43,560,000 SF · 98,000′ perimeter");
  });
  it("the uncalibrated flag rides on the model, so the chip can carry the ⚠", () => {
    expect(measureLabelModel("area", { areaSf: 100 }, { uncalibrated: true }).warn).toBe(true);
    expect(measureLabelModel("area", { areaSf: 100 }).warn).toBe(false);
  });
});

describe("(d) per-edge segment lengths", () => {
  const SQUARE = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  it("an open run dimensions its legs, a closed area also dimensions the closing edge", () => {
    expect(measureSegments(SQUARE, false)).toHaveLength(3);
    expect(measureSegments(SQUARE, true)).toHaveLength(4);
  });
  it("each entry is the edge midpoint, its length, and a ready-to-draw label", () => {
    const [first] = measureSegments(SQUARE, false);
    expect(first.mid).toEqual({ x: 50, y: 0 });
    expect(first.ft).toBe(100);
    expect(first.label).toBe("100′");
  });
  it("text is kept upright — a right-to-left edge is flipped, never printed upside down", () => {
    const segs = measureSegments(SQUARE, true);
    segs.forEach((s) => expect(Math.abs(s.deg)).toBeLessThanOrEqual(90));
    expect(segs[2].deg).toBe(0);   // the 100,100 → 0,100 edge, flipped from 180°
  });
  it("degenerate input is dropped rather than emitting a zero-length dimension", () => {
    expect(measureSegments([{ x: 0, y: 0 }, { x: 0, y: 0 }], false)).toEqual([]);
    expect(measureSegments([{ x: 0, y: 0 }], false)).toEqual([]);
    expect(measureSegments(null)).toEqual([]);
  });
});
