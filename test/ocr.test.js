import { describe, it, expect } from "vitest";
import { ocrScaleFor, extractWords, wordsToItems, createOcrRunner } from "../src/workspaces/doc-review/lib/ocr.js";
import { readSheetMeta } from "../src/shared/files/sheetMeta.js";

describe("ocrScaleFor — render density (B351)", () => {
  it("caps a big sheet by the memory budget and a small sheet at 4×", () => {
    expect(ocrScaleFor(2448, 1584)).toBeCloseTo(Math.sqrt(24e6 / (2448 * 1584)), 3); // E-size ≈ 2.5×
    expect(ocrScaleFor(612, 792)).toBe(4);   // letter → ceiling
    expect(ocrScaleFor(20000, 20000)).toBe(1.5); // floor
  });
});

describe("extractWords — tolerate flat or nested Tesseract output", () => {
  it("reads top-level words", () => {
    expect(extractWords({ words: [{ text: "A" }] })).toEqual([{ text: "A" }]);
  });
  it("flattens blocks→paragraphs→lines→words", () => {
    const data = { blocks: [{ paragraphs: [{ lines: [{ words: [{ text: "X" }, { text: "Y" }] }] }] }] };
    expect(extractWords(data).map((w) => w.text)).toEqual(["X", "Y"]);
  });
});

describe("wordsToItems — Tesseract boxes → page-unit items (B351)", () => {
  it("divides pixel bboxes by the render scale and drops blank/low-confidence words", () => {
    const words = [
      { text: "C-5", confidence: 92, bbox: { x0: 200, y0: 100, x1: 320, y1: 140 } }, // scale 2 → page 100,50,60,20
      { text: "noise", confidence: 12, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },       // low conf → dropped
      { text: "   ", confidence: 99, bbox: { x0: 0, y0: 0, x1: 50, y1: 20 } },         // blank → dropped
      { text: "bad", confidence: 99, bbox: { x0: 50, y0: 50, x1: 50, y1: 80 } },       // zero width → dropped
    ];
    const { items, width, height } = wordsToItems(words, 2, 1224, 792);
    expect(width).toBe(1224); expect(height).toBe(792);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ str: "C-5", x: 100, y: 50, w: 60, h: 20, ocr: true });
  });
});

// A scanned grading sheet, expressed as the WORD list Tesseract would return (canvas pixels at
// render scale 2 on a 2448×1584 page). Title block on the right; a match line in the drawing.
function scannedGradingWords(scale = 2) {
  const W = (text, px, py, pw, ph, conf = 90) => ({ text, confidence: conf, bbox: { x0: px * scale, y0: py * scale, x1: (px + pw) * scale, y1: (py + ph) * scale } });
  const words = [
    // title (one row, split into words like Tesseract does)
    W("GRADING", 1950, 200, 150, 24), W("&", 2110, 200, 20, 24), W("DRAINAGE", 2140, 200, 170, 24), W("PLAN", 2320, 200, 90, 24),
    W("SCALE:", 1950, 262, 60, 12), W('1"=40\'', 2020, 262, 70, 12),
    W("SHEET", 1950, 324, 60, 12), W("NO.", 2015, 324, 35, 12), W("C-5", 2060, 324, 40, 12),
    W("DATE:", 1950, 386, 50, 12), W("06/30/2025", 2020, 386, 90, 12),
    // a match line in the drawing area (right side, left of the title block)
    W("MATCH", 1640, 760, 55, 14), W("LINE", 1700, 760, 40, 14), W("-", 1745, 760, 10, 14),
    W("SEE", 1760, 760, 35, 14), W("SHEET", 1800, 760, 55, 14), W("C-6", 1860, 760, 35, 14),
  ];
  for (let i = 0; i < 18; i++) words.push(W("NOTE", 1950, 520 + i * 34, 60, 12)); // title-block density
  return words;
}

describe("createOcrRunner — orchestrate render→recognize→convert (B351)", () => {
  it("an OCR'd scanned page flows through readSheetMeta to the same metadata as a text page", async () => {
    const renderPage = async () => ({ canvas: { width: 4896, height: 3168 }, baseW: 2448, baseH: 1584, scale: 2 });
    const recognize = async () => ({ words: scannedGradingWords(2) });
    const runner = createOcrRunner({ renderPage, recognize });
    const page = await runner.run({}, 1);
    expect(page.width).toBe(2448);
    const meta = readSheetMeta(page);
    expect(meta.hasText).toBe(true);
    expect(meta.sheetNumber).toBe("C-5");
    expect(meta.sheetTitle).toBe("GRADING & DRAINAGE PLAN");
    expect(meta.scale).toMatchObject({ ftPerInch: 40 });
    expect(meta.matchLines[0]).toMatchObject({ target: "C-6", side: "right" });
    expect(meta.titleBlock).toMatchObject({ side: "right" });
  });

  it("spins up the worker lazily (once), reuses it, fires onOcrStart, and disposes it", async () => {
    let started = 0, terminated = 0, made = 0;
    const fakeWorker = { recognize: async () => ({ data: { words: [{ text: "HI", confidence: 90, bbox: { x0: 0, y0: 0, x1: 20, y1: 10 } }] } }), terminate: async () => { terminated++; } };
    const makeWorker = async () => { made++; return fakeWorker; };
    const renderPage = async () => ({ canvas: {}, baseW: 100, baseH: 100, scale: 1 });
    const runner = createOcrRunner({ renderPage, makeWorker, onOcrStart: () => started++ });
    await runner.run({}, 1);
    await runner.run({}, 2);
    expect(made).toBe(1);     // worker created once
    expect(started).toBe(1);  // onOcrStart fired once
    await runner.dispose();
    expect(terminated).toBe(1);
  });

  it("fails soft — a recognize error yields null (sheetRead keeps the no-text record)", async () => {
    const runner = createOcrRunner({ renderPage: async () => ({ canvas: {}, baseW: 10, baseH: 10, scale: 1 }), recognize: async () => { throw new Error("wasm boom"); } });
    expect(await runner.run({}, 1)).toBeNull();
  });
});
