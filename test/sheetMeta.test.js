import { describe, it, expect } from "vitest";
import {
  reconstructLines, edgeOf, parseMatchLines, detectTitleBlock,
  drawingAreaOf, readSheetTitle, readSheetMeta,
} from "../src/shared/files/sheetMeta.js";

// A 34"×22" (ANSI D) landscape sheet in points (72/in).
const W = 2448, H = 1584;

// A right-edge title block (dense strip x ≥ ~0.78W) + a little drawing-area text + a
// vertical match line on the drawing's right edge referencing the next sheet.
function gradingSheet() {
  const items = [
    { str: "GRADING & DRAINAGE PLAN", x: 1950, y: 200, w: 420, h: 24 },
    { str: "SCALE:", x: 1950, y: 262, w: 60, h: 12 }, { str: '1"=40\'', x: 2020, y: 262, w: 70, h: 12 },
    { str: "SHEET NO.", x: 1950, y: 324, w: 90, h: 12 }, { str: "C-5", x: 2060, y: 324, w: 40, h: 12 },
    { str: "DATE:", x: 1950, y: 386, w: 50, h: 12 }, { str: "06/30/2025", x: 2020, y: 386, w: 90, h: 12 },
    { str: "PROJECT: KATY GRAND", x: 1950, y: 448, w: 320, h: 12 },
    // drawing-area labels (left of the title block)
    { str: "PROPOSED DETENTION POND", x: 240, y: 300, w: 260, h: 12 },
    { str: "FF 102.5", x: 600, y: 700, w: 80, h: 12 },
    // a vertical match line on the right edge of the DRAWING area (left of the title block)
    { str: "MATCH LINE - SEE SHEET C-6", x: 1640, y: 760, w: 230, h: 14 },
  ];
  // pad the title block so its density clearly wins
  for (let i = 0; i < 18; i++) items.push({ str: "GENERAL NOTE " + i, x: 1950, y: 520 + i * 34, w: 230, h: 12 });
  return { items, width: W, height: H };
}

describe("reconstructLines — rebuild human lines from fragmented runs (B336)", () => {
  it("joins runs that share a baseline, left-to-right", () => {
    const items = [
      { str: "SHEET", x: 1810, y: 700, w: 40, h: 14 }, { str: "C-6", x: 1860, y: 700, w: 30, h: 14 },
      { str: "MATCH", x: 1640, y: 700, w: 50, h: 14 }, { str: "LINE", x: 1700, y: 700, w: 40, h: 14 },
      { str: "SEE", x: 1770, y: 700, w: 35, h: 14 },
    ];
    const lines = reconstructLines(items);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("MATCH LINE SEE SHEET C-6");
  });
  it("keeps rows on different baselines separate", () => {
    const items = [
      { str: "TITLE", x: 100, y: 100, w: 60, h: 20 },
      { str: "BODY", x: 100, y: 200, w: 60, h: 12 },
    ];
    expect(reconstructLines(items)).toHaveLength(2);
  });
});

describe("edgeOf — which page edge a label sits against → cut orientation", () => {
  it("classifies left/right as vertical cuts, top/bottom as horizontal", () => {
    expect(edgeOf(50, H / 2, W, H)).toMatchObject({ side: "left", orientation: "vertical" });
    expect(edgeOf(W - 50, H / 2, W, H)).toMatchObject({ side: "right", orientation: "vertical" });
    expect(edgeOf(W / 2, 30, W, H)).toMatchObject({ side: "top", orientation: "horizontal" });
    expect(edgeOf(W / 2, H - 30, W, H)).toMatchObject({ side: "bottom", orientation: "horizontal" });
  });
});

describe("parseMatchLines — labels + target sheet + side (B336/B337)", () => {
  it("reads 'MATCH LINE - SEE SHEET C-6' as a right-edge vertical seam to C-6", () => {
    const lines = reconstructLines(gradingSheet().items);
    const ml = parseMatchLines(lines, { width: W, height: H });
    expect(ml).toHaveLength(1);
    expect(ml[0]).toMatchObject({ target: "C-6", side: "right", orientation: "vertical" });
  });
  it("reads 'CONTINUED ON SHEET C5 FOR CONTINUATION' and a bare MATCHLINE", () => {
    const items = [
      { str: "CONTINUED ON SHEET C5 FOR CONTINUATION", x: 60, y: 800, w: 360, h: 12 },
      { str: "MATCHLINE", x: 1200, y: 40, w: 120, h: 12 },
    ];
    const ml = parseMatchLines(reconstructLines(items), { width: W, height: H });
    expect(ml.find((m) => m.target === "C5")).toMatchObject({ side: "left" });
    expect(ml.find((m) => m.side === "top")).toBeTruthy(); // bare matchline still a seam
  });
  it("ignores pages with no match line", () => {
    const items = [{ str: "FLOOR PLAN", x: 100, y: 100, w: 100, h: 14 }];
    expect(parseMatchLines(reconstructLines(items), { width: W, height: H })).toEqual([]);
  });
});

describe("detectTitleBlock / drawingArea — the band to crop (B336/B338)", () => {
  it("finds a dense right-edge title block and yields the drawing area to its left", () => {
    const { items } = gradingSheet();
    const band = detectTitleBlock(items, { width: W, height: H });
    expect(band).toMatchObject({ side: "right" });
    expect(band.x).toBeCloseTo(W * 0.78, 0);
    const da = drawingAreaOf({ width: W, height: H }, band);
    expect(da.w).toBeCloseTo(W * 0.78, 0);
    expect(da.h).toBe(H);
  });
  it("returns null (fail open — don't crop) when no edge is disproportionately dense", () => {
    const items = [
      { str: "A", x: 100, y: 100, w: 10, h: 10 }, { str: "B", x: 800, y: 400, w: 10, h: 10 },
      { str: "C", x: 1400, y: 900, w: 10, h: 10 },
    ];
    expect(detectTitleBlock(items, { width: W, height: H })).toBeNull();
  });
});

describe("readSheetTitle — the human plan name, skipping label/data rows", () => {
  it("picks the large wordy line and skips SCALE/SHEET/DATE rows", () => {
    const { items } = gradingSheet();
    const band = detectTitleBlock(items, { width: W, height: H });
    expect(readSheetTitle(reconstructLines(items), band, "Grading Plan")).toBe("GRADING & DRAINAGE PLAN");
  });
  it("falls back to the deterministic item label when nothing stands out", () => {
    expect(readSheetTitle([], null, "Boundary Survey")).toBe("Boundary Survey");
  });
});

describe("readSheetMeta — the unified per-page record", () => {
  it("reads number, title, discipline, scale, match line, and a high confidence", () => {
    const meta = readSheetMeta(gradingSheet());
    expect(meta.hasText).toBe(true);
    expect(meta.sheetNumber).toBe("C-5");
    expect(meta.sheetTitle).toBe("GRADING & DRAINAGE PLAN");
    expect(meta.discipline).toBe("Civil");
    expect(meta.scale).toMatchObject({ ftPerInch: 40 });
    expect(meta.matchLines[0]).toMatchObject({ target: "C-6", side: "right" });
    expect(meta.titleBlock).toMatchObject({ side: "right" });
    expect(meta.confidence).toBeGreaterThan(0.7);
  });
  it("flags a scanned (no-text) page as hasText:false, confidence 0 (→ OCR seam)", () => {
    const meta = readSheetMeta({ items: [], width: W, height: H });
    expect(meta.hasText).toBe(false);
    expect(meta.confidence).toBe(0);
    expect(meta.matchLines).toEqual([]);
  });
});
