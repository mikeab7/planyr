import { describe, it, expect } from "vitest";
import { wrapLines, calloutLayout, minCalloutWidthFt } from "../src/workspaces/site-planner/lib/calloutLayout.js";

// A resolved style matching calloutStyle()'s defaults (size/padX/padY/lineHeight/bold).
const ST = { size: 13, bold: false, lineHeight: 1.3, padX: 14, padY: 8 };

describe("wrapLines (B913)", () => {
  it("preserves hard newlines when wide enough to not wrap", () => {
    expect(wrapLines("one\ntwo", 20)).toEqual(["one", "two"]);
  });
  it("greedily word-wraps a long line to the char budget", () => {
    // 3-char budget: each word fits alone, so one word per line.
    expect(wrapLines("aaa bbb ccc", 3)).toEqual(["aaa", "bbb", "ccc"]);
    // 7-char budget: "aaa bbb" = 7 fits, "ccc" wraps.
    expect(wrapLines("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
  });
  it("hard-breaks a single word longer than the budget", () => {
    expect(wrapLines("abcdefgh", 3)).toEqual(["abc", "def", "gh"]);
    expect(wrapLines("abcdef", 3)).toEqual(["abc", "def"]); // exact multiple → no empty trailing line
  });
  it("keeps blank lines and combines hard + soft wrapping", () => {
    expect(wrapLines("hello world\n\nfoo", 5)).toEqual(["hello", "world", "", "foo"]);
  });
  it("returns the hard lines unchanged when maxChars < 1 (can't wrap)", () => {
    expect(wrapLines("a\nb", 0)).toEqual(["a", "b"]);
    expect(wrapLines("", 5)).toEqual([""]);
  });
});

describe("calloutLayout (B913)", () => {
  it("AUTO mode hugs the widest line and never wraps (pre-B913 behaviour)", () => {
    const c = { text: "short\nmuch longer line" };
    const g = calloutLayout(c, ST, 0.35);
    expect(g.wrapped).toBe(false);
    expect(g.lines).toEqual(["short", "much longer line"]); // hard lines, untouched
    // width hugs the widest line: tw = 16 chars * charW + 2*padX.
    const charW = 13 * 0.56;
    expect(g.w).toBeCloseTo(16 * charW + 14 * 2, 3);
    expect(g.h).toBeCloseTo(2 * (13 * 1.3) + 8 * 2, 3);
  });

  it("EXPLICIT width wraps the text and grows the height", () => {
    // A wide single line, forced narrow: it wraps to multiple lines and h grows.
    const c = { text: "alpha beta gamma delta", boxW: 30 };
    const g = calloutLayout(c, ST, 0.35);
    expect(g.wrapped).toBe(true);
    expect(g.w).toBeCloseTo(30 * 0.35, 5);       // width = boxW (feet) * ppf, exactly
    expect(g.lines.length).toBeGreaterThan(1);   // it wrapped
    expect(g.h).toBeCloseTo(g.lines.length * (13 * 1.3) + 8 * 2, 3);
  });

  it("box width in feet is zoom-invariant in AUTO mode (scales 1:1 with ppf)", () => {
    const c = { text: "constant width" };
    const a = calloutLayout(c, ST, 0.35), b = calloutLayout(c, ST, 0.7);
    expect(b.w / b.h).toBeCloseTo(a.w / a.h, 5);  // aspect preserved
    expect(a.w / 0.35).toBeCloseTo(b.w / 0.7, 5); // same width in feet at both zooms
  });

  it("minCalloutWidthFt is a positive floor, zoom-invariant", () => {
    const a = minCalloutWidthFt(ST, 0.35), b = minCalloutWidthFt(ST, 0.7);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeCloseTo(b, 5); // feet floor is the same at any zoom
  });

  it("guards empty / missing text", () => {
    expect(calloutLayout({ text: "" }, ST, 0.35).lines).toEqual([""]);
    expect(calloutLayout({}, ST, 0.35).lines).toEqual([""]);
    expect(calloutLayout({ text: "x", boxW: 0 }, ST, 0.35).wrapped).toBe(false); // boxW 0 → auto
  });
});
