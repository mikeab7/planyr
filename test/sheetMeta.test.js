import { describe, it, expect } from "vitest";
import {
  reconstructLines, edgeOf, parseMatchLines, detectTitleBlock,
  drawingAreaOf, readSheetTitle, readSheetMeta,
} from "../src/shared/files/sheetMeta.js";
import { groupSheets } from "../src/shared/files/sheetGroups.js";

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
  it("does NOT pick a long copyright/legend body line over a short title (B378)", () => {
    // A general-notes sheet: the real title is short + large; the copyright block and a legend
    // row are long body prose at a smaller size. The OLD height×letters scorer picked the prose.
    const lines = reconstructLines([
      { str: "GENERAL NOTES", x: 1950, y: 180, w: 240, h: 22 },
      { str: "THIS DRAWING IS THE PROPERTY OF ACME AND MAY NOT BE REPRODUCED WITHOUT WRITTEN PERMISSION", x: 1950, y: 230, w: 470, h: 10 },
      { str: "CJ DENOTES CONSTRUCTION JOINT CONTINUED ON THIS SHEET", x: 1950, y: 260, w: 430, h: 10 },
    ], {});
    const band = { side: "right", x: W * 0.78, y: 0, w: W * 0.22, h: H };
    expect(readSheetTitle(lines, band, "Structural")).toBe("GENERAL NOTES");
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

// A structural GENERAL-NOTES sheet: wall-to-wall prose in the body (which defeats the density-based
// title-block detector), a body cross-reference to another sheet, and the sheet's OWN number in the
// right-edge title-block strip. This is the set whose labels were "atrocious" (B378/B379).
function notesSheet() {
  const items = [
    // body — the cross-reference the whole-page read used to grab as THIS sheet's number
    { str: "SEE DWG S202 FOR TYPICAL FOUNDATION DETAILS", x: 200, y: 150, w: 520, h: 12 },
  ];
  for (let i = 0; i < 12; i++)
    items.push({ str: `${i + 1}. ALL WORK SHALL CONFORM TO THE GOVERNING SPECIFICATIONS AND APPLICABLE CODES`, x: 200, y: 190 + i * 30, w: 760, h: 11 });
  // right-edge title-block strip (x ≥ 0.78W): the title + the sheet's OWN number + a copyright block
  items.push({ str: "GENERAL NOTES", x: 1960, y: 170, w: 240, h: 22 });
  items.push({ str: "SHEET NO.", x: 1960, y: 230, w: 90, h: 12 }, { str: "S001", x: 2080, y: 230, w: 50, h: 12 });
  items.push({ str: "THIS DRAWING IS THE PROPERTY OF ACME ENGINEERS AND MAY NOT BE REPRODUCED", x: 1960, y: 1520, w: 460, h: 8 });
  return { items, width: W, height: H };
}

describe("readSheetMeta — text-dense general-notes sheet (B378/B379)", () => {
  it("reads its OWN number from the title-block strip, NOT a body cross-reference", () => {
    const meta = readSheetMeta(notesSheet());
    expect(meta.sheetNumber).toBe("S001"); // not "S202" (the cross-reference in the body)
  });
  it("reads the real short title, not a long copyright line", () => {
    expect(readSheetMeta(notesSheet()).sheetTitle).toBe("GENERAL NOTES");
  });
  it("flags the sheet textDense so auto-calibration is suppressed", () => {
    expect(readSheetMeta(notesSheet()).textDense).toBe(true);
  });
  it("does NOT flag a normal plan sheet as textDense", () => {
    expect(readSheetMeta(gradingSheet()).textDense).toBe(false);
  });
});

// A real GPL topo-survey sheet (the owner's "stitch these" upload): a scanned/reference sheet with a
// tiny text layer — a bottom-left title block printing the sheet code as a big BARE "C-2" (no "SHEET
// NO." label text), the title, an "NTS" scale, and the set page-count "46". The number went unread
// (label-anchored only), so the set couldn't group OR stitch. (B412)
function topoSheet(code, roman) {
  return { width: W, height: H, items: [
    { str: `TOPO SURVEY ${roman}`, x: 120, y: 1362, w: 157, h: 20 },
    { str: code, x: 53, y: 1343, w: 73, h: 45 },      // the bare sheet code, large, in the title block
    { str: "46", x: 53, y: 1481, w: 50, h: 45 },       // the SET page-count (no letter prefix → must NOT win)
    { str: "FOR REFERENCE ONLY", x: 122, y: 746, w: 187, h: 16 },
    { str: "NTS", x: 83, y: 824, w: 32, h: 16 },
  ] };
}

describe("readSheetMeta — bare title-block sheet code on a scanned/reference sheet (B412)", () => {
  it("reads the prominent bare code 'C-2', NOT the page-count '46'", () => {
    const meta = readSheetMeta(topoSheet("C-2", "I"));
    expect(meta.sheetNumber).toBe("C-2");
  });
  it("reads NTS as the (non-)scale so auto-calibration won't fire", () => {
    expect(readSheetMeta(topoSheet("C-2", "I")).scale).toMatchObject({ explicit: "nts" });
  });
  it("a bare number with NO letter prefix is still ignored (stays conservative)", () => {
    const items = [{ str: "46", x: 53, y: 1481, w: 50, h: 45 }, { str: "TOPO SURVEY I", x: 120, y: 1362, w: 157, h: 20 }];
    expect(readSheetMeta({ width: W, height: H, items }).sheetNumber).toBe("");
  });
  it("the three topo sheets now form ONE consecutive set", () => {
    const metas = [["C-2", "I"], ["C-3", "II"], ["C-4", "III"]].map(([c, r], i) => {
      const m = readSheetMeta(topoSheet(c, r));
      return { id: "p" + (i + 1), sheetNumber: m.sheetNumber, sheetTitle: m.sheetTitle, discipline: m.discipline, item: m.item };
    });
    const groups = groupSheets(metas);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "group", sheetRange: "C-2–C-4" });
  });
});

/* ------------------------- B659 — the "every file misreads" revamp ------------------------- */

describe("readSheetTitle — rejects title-block IDENTITY rows (B659)", () => {
  const band = { side: "right", x: W * 0.78, y: 0, w: W * 0.22, h: H };
  const t = (rows, fallback = "Civil") =>
    readSheetTitle(reconstructLines(rows.map((str, i) => ({ str, x: 1950, y: 150 + i * 40, w: 300, h: 14 }))), band, fallback, { width: W, height: H });
  it("skips firm / corporate / contact lines for the real title", () => {
    expect(t(["POWERS BROWN ARCHITECTURE", "2100 Travis Street,", "Suite 501", "Houston, Texas 77002", "713.224.0456", "www.powersbrown.com", "GRADING PLAN"])).toBe("GRADING PLAN");
  });
  it("skips 'A PROJECT FOR …' / 'PREPARED FOR …' credits", () => {
    expect(t(["A PROJECT FOR HILLWOOD", "PREPARED FOR ACME INC", "FLOOR PLAN"])).toBe("FLOOR PLAN");
  });
  it("skips the TX interim-review stamp (huge type on IFR sheets)", () => {
    const lines = reconstructLines([
      { str: "PRELIMINARY NOT FOR CONSTRUCTION, PERMIT,", x: 1950, y: 150, w: 400, h: 40 },
      { str: "OR REGULATORY APPROVAL", x: 1950, y: 200, w: 300, h: 34 },
      { str: "CURRENT AS OF: 6/23/2026", x: 1950, y: 250, w: 220, h: 20 },
      { str: "REGISTRATION #25000", x: 1950, y: 290, w: 200, h: 26 },
      { str: "WALL SECTIONS AND DETAILS", x: 1950, y: 350, w: 260, h: 19 },
    ]);
    expect(readSheetTitle(lines, band, "", { width: W, height: H })).toBe("WALL SECTIONS AND DETAILS");
  });
  it("skips a lone city/state cell and a data field row", () => {
    expect(t(["TEXAS", "SITE AREA : 29.17 AC (1,270,657 SF)", "SITE PLAN"])).toBe("SITE PLAN");
  });
  it("rejects shredded vertical text (mostly single-letter tokens)", () => {
    expect(t(["O I C I 119641 T E", "MECHANICAL DETAILS"])).toBe("MECHANICAL DETAILS");
  });
  it("rejects colon-terminated label rows and bracketed notes (B364 — the scanned-set OCR pass)", () => {
    expect(t(["SUBMITTALS / REVISIONS:", "[NOTE: SEE RISER", "ELECTRICAL POWER PLAN"])).toBe("ELECTRICAL POWER PLAN");
  });
  it("rejects the lone huge 'PRELIMINARY' stamp word and the compliance sentence (B660 — live GPL set)", () => {
    expect(t(["PRELIMINARY", "VERIFIED THAT IT FULLY COMPLIES", "OVERALL FLOOR PLAN"])).toBe("OVERALL FLOOR PLAN");
    // …but a real title that CONTAINS the word stays eligible
    expect(t(["PRELIMINARY PLAT"], "")).toBe("PRELIMINARY PLAT");
  });
});

describe("titleCandidates — wrapped titles & vertical (rotated) titles (B659)", () => {
  const band = { side: "right", x: W * 0.78, y: 0, w: W * 0.22, h: H };
  it("joins a two-line wrapped title of the same type size into one candidate", () => {
    const lines = reconstructLines([
      { str: "WALL SECTIONS AND", x: 2167, y: 1307, w: 200, h: 19 },
      { str: "DETAILS", x: 2228, y: 1328, w: 79, h: 19 },
    ]);
    expect(readSheetTitle(lines, band, "", { width: W, height: H })).toBe("WALL SECTIONS AND DETAILS");
  });
  it("reaches PAST interleaved small lines to join the wrapped halves (look-back)", () => {
    const lines = reconstructLines([
      { str: "TAS NOTES AND", x: 2167, y: 300, w: 180, h: 19 },
      // small unrelated cells between the halves in y-order
      { str: "CONSTRUCTION DOCUMENTS", x: 1960, y: 306, w: 140, h: 9 },
      { str: "OWNERSHIP DATA", x: 1960, y: 316, w: 110, h: 9 },
      { str: "DETAILS", x: 2200, y: 322, w: 79, h: 19 },
    ]);
    expect(readSheetTitle(lines, band, "", { width: W, height: H })).toBe("TAS NOTES AND DETAILS");
  });
  it("joins a rotated (bottom→top) vertical title's runs in true reading order", () => {
    // Two vertical CCW runs: reading order is bottom-up within a column, and the next line of the
    // title is the column to the LEFT. fontH is the type size; h is the run LENGTH.
    const items = [
      { str: "DETAILS", x: 201, y: 218, w: 19, h: 80, vert: true, up: true, fontH: 19 },
      { str: "WALL SECTIONS AND", x: 262, y: 200, w: 19, h: 170, vert: true, up: true, fontH: 19 },
    ];
    const lines = reconstructLines(items);
    const leftBand = { side: "left", x: 0, y: 0, w: W * 0.22, h: H };
    expect(readSheetTitle(lines, leftBand, "", { width: W, height: H })).toBe("WALL SECTIONS AND DETAILS");
  });
  it("fuses a glyph-stacked pseudo-vertical string into one readable line", () => {
    // Single-character unrotated items stacked on one x-center — some CAD exporters draw
    // vertical labels this way; row-bucketing used to read one glyph per row (gibberish).
    const items = "M201-A".split("").map((ch, i) => ({ str: ch, x: 60, y: 1300 + i * 40, w: 30, h: 36 }));
    const lines = reconstructLines(items);
    const stacked = lines.find((l) => l.text === "M201-A");
    expect(stacked).toBeTruthy();
    expect(stacked.vert).toBe(true);
  });
  it("sheds a leading sheet-code token glued onto the title cell", () => {
    const lines = reconstructLines([{ str: "C-2 TOPO SURVEY I", x: 100, y: 1340, w: 230, h: 20 }]);
    expect(readSheetTitle(lines, null, "", { width: W, height: H })).toBe("TOPO SURVEY I");
  });
});

describe("detectTitleBlock — left-edge band (B659)", () => {
  it("detects a dense LEFT-edge title block and keeps the drawing area to its right", () => {
    const items = [{ str: "PLAN LABEL", x: 1200, y: 700, w: 120, h: 12 }];
    for (let i = 0; i < 18; i++) items.push({ str: "TITLE BLOCK ROW " + i, x: 60, y: 120 + i * 70, w: 300, h: 14 });
    const band = detectTitleBlock(items, { width: W, height: H });
    expect(band).toMatchObject({ side: "left" });
    const da = drawingAreaOf({ width: W, height: H }, band);
    expect(da.x).toBeCloseTo(W * 0.22, 0);
  });
});

describe("readSheetMeta — spatial label-anchored sheet number (B659)", () => {
  function stampSheet() {
    const items = [
      // right-edge title block, dense
      { str: "WALL SECTIONS AND DETAILS", x: 2160, y: 1307, w: 220, h: 19 },
      { str: "SHEET NUMBER", x: 2271, y: 1391, w: 77, h: 10 },
      { str: "A305", x: 2200, y: 1420, w: 100, h: 38 },
      // the plot timestamp that follows the label in CONTENT order — must NOT read as "6"
      { str: "6/23/2026", x: 2209, y: 1491, w: 90, h: 10 },
      { str: "7:55:20 PM", x: 2305, y: 1491, w: 80, h: 10 },
    ];
    for (let i = 0; i < 16; i++) items.push({ str: "GENERAL NOTE " + i, x: 1950, y: 200 + i * 40, w: 230, h: 12 });
    return { items, width: W, height: H };
  }
  it("reads the code item NEAREST the 'SHEET NUMBER' caption, not the timestamp after it", () => {
    const meta = readSheetMeta(stampSheet());
    expect(meta.sheetNumber).toBe("A305");
  });
  it("whole-page last resort: a clearly-largest lone code wins even outside every strip", () => {
    const items = [
      { str: "A303", x: 1100, y: 57, w: 100, h: 38 },       // mid-page, 2× any other type
      { str: "DRAWING CONTENT", x: 900, y: 700, w: 200, h: 14 },
      { str: "MORE CONTENT HERE FOR TEXT", x: 700, y: 800, w: 260, h: 14 },
    ];
    expect(readSheetMeta({ items, width: W, height: H }).sheetNumber).toBe("A303");
    // …but NOT when other text is comparably large (a body grid-ref can't win by accident)
    const noisy = items.concat([{ str: "BIG BANNER TEXT", x: 400, y: 300, w: 500, h: 36 }]);
    expect(readSheetMeta({ items: noisy, width: W, height: H }).sheetNumber).toBe("");
  });
});

describe("readSheetTitle — rejects drawing annotations & field-label rows (B412)", () => {
  it("does NOT pick a large MATCH LINE annotation in the drawing area over the title block", () => {
    const lines = reconstructLines([
      { str: "GRADING PLAN", x: 1980, y: 200, w: 220, h: 18 },              // real title (smaller) in the band
      { str: "MATCH LINE - SEE SHEET C-15", x: 700, y: 760, w: 360, h: 30 }, // big annotation in the drawing area
    ], {});
    const band = detectTitleBlock([
      { str: "GRADING PLAN", x: 1980, y: 200, w: 220, h: 18 },
    ].concat(Array.from({ length: 16 }, (_, i) => ({ str: "X", x: 1980, y: 260 + i * 30, w: 200, h: 12 }))), { width: W, height: H });
    expect(readSheetTitle(lines, band, "Civil", { width: W, height: H })).toBe("GRADING PLAN");
  });
  it("does NOT pick a large project-name banner (whole-page scan) — restricts to the title-block zone", () => {
    const lines = reconstructLines([
      { str: "GRAND PORT LOGISTICS", x: 700, y: 90, w: 700, h: 40 },   // banner, top-center drawing area
      { str: "DEMOLITION PLAN", x: 2000, y: 1400, w: 240, h: 20 },     // title in the bottom-right zone
    ], {});
    expect(readSheetTitle(lines, null, "Civil", { width: W, height: H })).toBe("DEMOLITION PLAN");
  });
  it("rejects a merged field-label+value row 'C-14 SHEET NUMBER'", () => {
    const lines = reconstructLines([
      { str: "C-14 SHEET NUMBER", x: 2000, y: 320, w: 260, h: 14 },
      { str: "PAVING PLAN", x: 2000, y: 200, w: 220, h: 20 },
    ], {});
    const band = { side: "right", x: W * 0.78, y: 0, w: W * 0.22, h: H };
    expect(readSheetTitle(lines, band, "Civil", { width: W, height: H })).toBe("PAVING PLAN");
  });
});
