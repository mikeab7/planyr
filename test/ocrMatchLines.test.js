import { describe, it, expect } from "vitest";
import { framePointToPage, recoverMatchLines } from "../src/shared/files/ocrMatchLines.js";

const W = 2448, H = 1584;

// Build Tesseract-style words ("MATCH LINE ~ SHEET 2") laid out left-to-right on one baseline,
// starting at (x,y) in the given frame, scale 1. Each word ~120 wide, 26 tall.
function mlWords(x, y) {
  const toks = ["MATCH", "LINE", "~", "SHEET", "2"];
  let cx = x;
  return toks.map((t) => { const x0 = cx; const x1 = cx + (t.length > 1 ? 130 : 30); cx = x1 + 22; return { text: t, confidence: 90, bbox: { x0, y0: y, x1, y1: y + 26 } }; });
}

describe("framePointToPage — invert a rotated OCR pass back to the page frame", () => {
  it("0° is identity", () => {
    expect(framePointToPage(100, 200, 0, W, H)).toEqual({ x: 100, y: 200 });
  });
  it("90° (page rendered clockwise) inverts so a frame-top label lands on the page LEFT edge", () => {
    // frame is H wide × W tall; a point near the frame top (ry small) → page left (x small).
    const p = framePointToPage(700, 20, 90, W, H);
    expect(p.x).toBeCloseTo(20);          // ry → page x (near 0 = left edge)
    expect(p.y).toBeCloseTo(H - 700);     // rx → H - rx
  });
  it("270° inverts the other way", () => {
    const p = framePointToPage(700, 20, 270, W, H);
    expect(p.x).toBeCloseTo(W - 20);      // near right edge
    expect(p.y).toBeCloseTo(700);
  });
});

describe("recoverMatchLines — read raster match-lines from multi-orientation OCR passes (B413)", () => {
  it("a horizontal label near the page bottom → target + side 'bottom'", () => {
    const ml = recoverMatchLines([{ deg: 0, scale: 1, words: mlWords(900, H - 120) }], { width: W, height: H });
    expect(ml).toHaveLength(1);
    expect(ml[0]).toMatchObject({ target: "2", side: "bottom", orientation: "horizontal" });
  });
  it("a 90°-rotated label (left-edge vertical print) → side 'left'", () => {
    // In the 90° frame (H wide × W tall) the label reads horizontally near the frame top (small y),
    // which maps back to the page's LEFT edge.
    const ml = recoverMatchLines([{ deg: 90, scale: 1, words: mlWords(800, 30) }], { width: W, height: H });
    expect(ml).toHaveLength(1);
    expect(ml[0]).toMatchObject({ target: "2", side: "left", orientation: "vertical" });
  });
  it("dedupes the same label caught in two passes", () => {
    const ml = recoverMatchLines([
      { deg: 0, scale: 1, words: mlWords(900, H - 120) },
      { deg: 0, scale: 1, words: mlWords(900, H - 120) },
    ], { width: W, height: H });
    expect(ml).toHaveLength(1);
  });
  it("honors the render scale (2× canvas → page units)", () => {
    const ml = recoverMatchLines([{ deg: 0, scale: 2, words: mlWords(1800, (H - 120) * 2) }], { width: W, height: H });
    expect(ml).toHaveLength(1);
    expect(ml[0].side).toBe("bottom");
  });
  it("no match-line text → empty", () => {
    const words = [{ text: "GENERAL", confidence: 90, bbox: { x0: 100, y0: 100, x1: 220, y1: 126 } }, { text: "NOTES", confidence: 90, bbox: { x0: 230, y0: 100, x1: 330, y1: 126 } }];
    expect(recoverMatchLines([{ deg: 0, scale: 1, words }], { width: W, height: H })).toEqual([]);
  });
});
