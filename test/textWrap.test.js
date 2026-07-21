import { describe, it, expect } from "vitest";
import { wrapText, calloutBoxMetrics, heuristicWidth } from "../src/shared/markup/textWrap.js";

/* B909/NEW-1 — a callout's box must always fully enclose its text: wrap at a sensible max
 * width, then size the box to the longest ACTUAL wrapped line + the real line count, never a
 * flat char-count guess. These tests run the pure Node-side heuristic measurer; the browser
 * path (a real <canvas> measurer) is exercised live in Playwright (see the session's headless
 * verification, V### in VERIFICATION.md). */

const fs = 14;

describe("wrapText", () => {
  it("a long single line wraps into multiple lines, none exceeding maxWidth", () => {
    const long = "THIS IS A VERY LONG UPPERCASE SENTENCE THAT SHOULD DEFINITELY WRAP ACROSS SEVERAL LINES";
    const maxWidth = 120;
    const lines = wrapText(long, fs, maxWidth);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(heuristicWidth(l, fs)).toBeLessThanOrEqual(maxWidth + 1e-6);
    // no words dropped or duplicated
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("a long single word with no spaces is force-broken so no chunk exceeds maxWidth", () => {
    const word = "supercalifragilisticexpialidocioussupercalifragilisticexpialidocious";
    const maxWidth = 80;
    const lines = wrapText(word, fs, maxWidth);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(heuristicWidth(l, fs)).toBeLessThanOrEqual(maxWidth + 1e-6);
    expect(lines.join("")).toBe(word); // every character preserved, just re-chunked
  });

  it("explicit multi-line text (\\n) is respected, not merged into one paragraph", () => {
    const text = "Line one\nLine two\nLine three";
    const lines = wrapText(text, fs, 400); // wide enough that wrapping wouldn't kick in
    expect(lines).toEqual(["Line one", "Line two", "Line three"]);
  });

  it("an explicit blank line is preserved (not dropped)", () => {
    const lines = wrapText("Top\n\nBottom", fs, 400);
    expect(lines).toEqual(["Top", "", "Bottom"]);
  });

  it("empty text still yields one (empty) line — a fresh callout gets a paintable box", () => {
    expect(wrapText("", fs, 200)).toEqual([""]);
  });
});

describe("calloutBoxMetrics — the box always encloses the (wrapped) text", () => {
  const assertEncloses = (text, opts = {}) => {
    const { lines, boxW, boxH } = calloutBoxMetrics(text, fs, opts);
    const padX = opts.padX ?? 8;
    for (const l of lines) expect(heuristicWidth(l, fs)).toBeLessThanOrEqual(boxW - padX * 2 + 1e-6);
    expect(boxH).toBeGreaterThan(0);
    return { lines, boxW, boxH };
  };

  it("a long single line", () => {
    const { lines } = assertEncloses("A very long uppercase sentence that must not overflow its callout box");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("a long single word with no spaces", () => {
    const { lines } = assertEncloses("pneumonoultramicroscopicsilicovolcanoconiosispneumonoultramicroscopicsilicovolcanoconiosis");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("explicit multi-line text", () => {
    const { lines, boxH } = assertEncloses("First leader note\nSecond line\nThird line");
    expect(lines).toHaveLength(3);
    // height grows with the line count
    const oneLine = calloutBoxMetrics("First leader note", fs, {});
    expect(boxH).toBeGreaterThan(oneLine.boxH);
  });

  it("box width never shrinks below the longest actual rendered line", () => {
    const { lines, boxW } = calloutBoxMetrics("short\na much much longer second line here", fs, { maxWidth: 500 });
    const longest = Math.max(...lines.map((l) => heuristicWidth(l, fs)));
    expect(boxW).toBeGreaterThanOrEqual(longest + 8 * 2 - 1e-6);
  });

  it("a single short line matches the original (pre-wrap) formula shape: fs + padY*2 tall", () => {
    const { boxH, lines } = calloutBoxMetrics("hi", fs, {});
    expect(lines).toHaveLength(1);
    expect(boxH).toBeCloseTo(fs + 4 * 2, 5);
  });

  it("respects a custom measurer (e.g. a stand-in for real canvas metrics)", () => {
    const wideMeasure = (str) => str.length * 100; // absurdly wide per-char, forces heavy wrapping
    const { lines } = calloutBoxMetrics("one two three four", fs, { measure: wideMeasure, maxWidth: 150 });
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(wideMeasure(l)).toBeLessThanOrEqual(150);
  });
});
