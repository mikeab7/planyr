/* OCR stress test (B352) — adversarial pass over the scanned-sheet path, mirroring the B348
 * engine hardening but for the OCR layer the owner asked to stress ("stress test it").
 *
 * The worst failure here is a SILENT one: OCR emits garbage on a noisy scan, and instead of a
 * graceful "couldn't read it → manual" the bad output poisons the reader (a NaN box → NaN title-
 * block math) or mis-groups the set. Every test below drives the kind of junk a real scan throws
 * (non-finite boxes, inverted boxes, malformed text/confidence, broken Tesseract shapes, worker
 * failures, mixed clean/garbage sets) and asserts the path degrades to a clean no-text record —
 * never a crash, a NaN, or a confident wrong group.
 */
import { describe, it, expect } from "vitest";
import { wordsToItems, ocrScaleFor, extractWords, createOcrRunner } from "../src/workspaces/doc-review/lib/ocr.js";
import { readSheetMeta } from "../src/shared/files/sheetMeta.js";
import { groupSheets } from "../src/shared/files/sheetGroups.js";

const word = (text, x0, y0, x1, y1, confidence = 90) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });
const finite = (n) => Number.isFinite(n);
const allItemsSane = (res) =>
  res && Array.isArray(res.items) && finite(res.width) && finite(res.height) &&
  res.items.every((i) => finite(i.x) && finite(i.y) && finite(i.w) && finite(i.h) && i.w > 0 && i.h > 0 && typeof i.str === "string");

describe("B352 stress — wordsToItems rejects every malformed box (no NaN ever leaks)", () => {
  it("drops non-finite (NaN / ±Infinity) coordinates — the B348-class poison", () => {
    const words = [
      word("good", 100, 100, 200, 140),
      word("nan", NaN, 10, 50, 30),
      word("inf", 0, 0, Infinity, 20),
      word("ninf", -Infinity, 0, 10, 20),
      word("nanY", 0, NaN, 10, 20),
    ];
    const res = wordsToItems(words, 2, 1224, 792);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].str).toBe("good");
    expect(allItemsSane(res)).toBe(true);
  });
  it("drops inverted, zero-area, and missing boxes; keeps a valid negative-position box", () => {
    const words = [
      word("inv", 200, 100, 100, 140),       // x1 < x0
      word("zero", 50, 50, 50, 80),          // zero width
      { text: "nobox", confidence: 99 },     // missing bbox
      word("offpage", -300, -300, -200, -260), // finite, valid box at negative coords → kept
    ];
    const res = wordsToItems(words, 1, 1000, 1000);
    expect(res.items.map((i) => i.str)).toEqual(["offpage"]);
    expect(allItemsSane(res)).toBe(true);
  });
  it("coerces non-string text, drops blank/empty, keeps missing/NaN confidence, drops finite-low", () => {
    const words = [
      word(42, 0, 0, 10, 10, 80),                 // numeric text → "42"
      word("   ", 0, 0, 10, 10, 99),              // blank → dropped
      { text: "noconf", bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }, // missing conf → kept
      word("nanconf", 0, 0, 10, 10, NaN),         // NaN conf → kept
      word("low", 0, 0, 10, 10, 3),               // finite low → dropped
      word(null, 0, 0, 10, 10, 99),               // null text → dropped
    ];
    const res = wordsToItems(words, 1, 100, 100);
    expect(res.items.map((i) => i.str).sort()).toEqual(["42", "nanconf", "noconf"]);
  });
  it("guards a 0 / NaN / negative / Infinity render scale (never a NaN or negative dim)", () => {
    for (const s of [0, NaN, -2, Infinity, -Infinity, undefined]) {
      const res = wordsToItems([word("x", 0, 0, 20, 10)], s, 100, 100);
      expect(allItemsSane(res)).toBe(true);
      expect(res.items[0].w).toBeGreaterThan(0);
    }
  });
  it("guards non-finite page dims", () => {
    const res = wordsToItems([word("x", 0, 0, 10, 10)], 1, NaN, Infinity);
    expect(res.width).toBe(0); expect(res.height).toBe(0);
  });
  it("handles a flood of garbage words without crashing", () => {
    const words = Array.from({ length: 5000 }, (_, i) => word("g" + i, i % 1000, i % 800, (i % 1000) + 5, (i % 800) + 5, (i * 7) % 100));
    const res = wordsToItems(words, 2, 2448, 1584);
    expect(allItemsSane(res)).toBe(true);
  });
});

describe("B352 stress — extractWords tolerates any Tesseract shape", () => {
  it("returns [] for null/garbage data and partial nesting; prefers top-level words", () => {
    for (const d of [null, undefined, 42, "str", {}, { words: "nope" }, { blocks: [{}] }, { blocks: [{ paragraphs: [{}] }] }]) {
      expect(Array.isArray(extractWords(d))).toBe(true);
    }
    expect(extractWords({ words: [{ text: "A" }], blocks: [{ paragraphs: [{ lines: [{ words: [{ text: "Z" }] }] }] }] })[0].text).toBe("A");
    expect(extractWords({ blocks: [{ paragraphs: [{ lines: [{ words: [{ text: "X" }, { text: "Y" }] }] }] }] }).map((w) => w.text)).toEqual(["X", "Y"]);
  });
});

describe("B352 stress — createOcrRunner fails soft on every engine failure", () => {
  const render = async () => ({ canvas: {}, baseW: 100, baseH: 100, scale: 2 });
  it("renderPage throws → null", async () => {
    const r = createOcrRunner({ renderPage: async () => { throw new Error("render boom"); }, recognize: async () => ({ words: [] }) });
    expect(await r.run({}, 1)).toBeNull();
  });
  it("recognize throws / returns junk → null (no words → no record)", async () => {
    for (const rec of [async () => { throw new Error("x"); }, async () => null, async () => ({}), async () => ({ words: [] }), async () => "garbage"]) {
      const r = createOcrRunner({ renderPage: render, recognize: rec });
      expect(await r.run({}, 1)).toBeNull();
    }
  });
  it("makeWorker rejects → null, dispose is safe afterwards", async () => {
    const r = createOcrRunner({ renderPage: render, makeWorker: async () => { throw new Error("wasm fetch failed"); } });
    expect(await r.run({}, 1)).toBeNull();
    await expect(r.dispose()).resolves.toBeUndefined();
  });
  it("all-low-confidence words → an empty-items record (→ reader treats as no-text)", async () => {
    const r = createOcrRunner({ renderPage: render, recognize: async () => ({ words: [word("junk", 0, 0, 10, 10, 2), word("more", 20, 0, 30, 10, 5)] }) });
    const res = await r.run({}, 1);
    expect(res.items).toEqual([]);
    expect(readSheetMeta(res).hasText).toBe(false); // stays standalone, never mis-grouped
  });
});

describe("B352 stress — OCR → readSheetMeta → grouping integration on messy scans", () => {
  // Build the word list Tesseract would emit for a scanned grading sheet (scale 2, 2448×1584).
  const gradingWords = (num, { rightRef, scale = '1"=40\'', corrupt = false } = {}) => {
    const W = (t, px, py, pw, ph, c = 90) => word(t, px * 2, py * 2, (px + pw) * 2, (py + ph) * 2, c);
    const ws = [
      W("GRADING", 1950, 200, 150, 24), W("PLAN", 2120, 200, 90, 24),
      W("SCALE:", 1950, 262, 60, 12), W(scale, 2030, 262, 70, 12),
      W("SHEET", 1950, 324, 60, 12), W("NO.", 2015, 324, 35, 12), W(num, 2060, 324, 40, 12),
    ];
    for (let i = 0; i < 16; i++) ws.push(W("NOTE" + i, 1950, 380 + i * 30, 60, 12));
    if (rightRef) ["MATCH", "LINE", "SEE", "SHEET", rightRef].forEach((t, k) => ws.push(W(t, 1640 + k * 50, 760, 45, 14)));
    if (corrupt) for (let i = 0; i < 12; i++) ws.push(word("?!#" + i, NaN, i, Infinity, i + 5, 30)); // noise the guard must absorb
    return ws;
  };
  const ocrSet = async (perPageWords) => {
    let p = 0;
    const runner = createOcrRunner({ renderPage: async () => ({ canvas: {}, baseW: 2448, baseH: 1584, scale: 2 }), recognize: async () => ({ words: perPageWords[p++] }) });
    const pages = [];
    for (let i = 0; i < perPageWords.length; i++) { const res = await runner.run({}, i + 1); pages.push({ pageNum: i + 1, ...readSheetMeta(res || { items: [] }) }); }
    return pages;
  };

  it("a clean scanned grading run groups + auto-detects the seam, even with NaN noise mixed in", async () => {
    const pages = await ocrSet([
      gradingWords("C-5", { rightRef: "C-6", corrupt: true }),
      gradingWords("C-6", { rightRef: "C-7", corrupt: true }),
      gradingWords("C-7", { corrupt: true }),
    ]);
    expect(pages.every((p) => Number.isFinite(p.confidence))).toBe(true);
    const groups = groupSheets(pages);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "group", title: "GRADING PLAN", sheetRange: "C-5–C-7" });
    expect(pages[0].matchLines.find((m) => m.target === "C-6")).toBeTruthy();
  });

  it("a pure-garbage scan reads as no-text and stays standalone (never a wrong merge)", async () => {
    const garbage = Array.from({ length: 40 }, (_, i) => word("xyz" + i, i, i, i + 3, i + 3, 4)); // all low-conf
    const pages = await ocrSet([gradingWords("C-5", { rightRef: "C-6" }), garbage]);
    expect(pages[1].hasText).toBe(false);
    const groups = groupSheets(pages);
    expect(groups.find((g) => g.kind === "group")).toBeUndefined(); // a lone readable C-5 + a garbage page → no group
    expect(groups).toHaveLength(2);
  });

  it("an unreadable sheet number leaves the page standalone, not force-merged", async () => {
    // OCR mangled the number to 'C' (no digits) on the middle sheet → it can't chain.
    const pages = await ocrSet([gradingWords("C-5"), gradingWords("C"), gradingWords("C-7")]);
    const groups = groupSheets(pages);
    expect(groups.every((g) => g.kind === "single")).toBe(true); // C-5 | C(unreadable) | C-7 — no false contiguity
  });
});

// Reproducible PRNG so a fuzz failure can be re-run.
function mulberry32(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

describe("B352 stress — randomized fuzz (invariants hold for any junk OCR output)", () => {
  it("300 random word sets never throw, never leak a non-finite item, and read a finite confidence", () => {
    const rnd = mulberry32(0xB352);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const coord = () => pick([rnd() * 5000, -rnd() * 500, NaN, Infinity, -Infinity, 0, rnd() * 1e9]);
    const text = () => pick(["GRADING", "C-5", "1\"=40'", "MATCH LINE SEE SHEET C-6", "", "   ", " ", "✦∆", String(Math.floor(rnd() * 1e6)), null, undefined, 12]);
    for (let iter = 0; iter < 300; iter++) {
      const n = Math.floor(rnd() * 60);
      const words = Array.from({ length: n }, () => ({
        text: text(),
        confidence: pick([rnd() * 100, NaN, undefined, -5, 200]),
        bbox: rnd() < 0.1 ? undefined : { x0: coord(), y0: coord(), x1: coord(), y1: coord() },
      }));
      const scale = pick([rnd() * 4, 0, NaN, -2, Infinity]);
      const res = wordsToItems(words, scale, pick([2448, 0, NaN, 612]), pick([1584, Infinity, 792]));
      expect(allItemsSane(res)).toBe(true);                // no NaN / negative-dim item ever leaks
      const meta = readSheetMeta(res);                     // the reader must survive OCR junk
      expect(Number.isFinite(meta.confidence)).toBe(true);
      expect(meta.confidence).toBeGreaterThanOrEqual(0);
      expect(meta.confidence).toBeLessThanOrEqual(1);
    }
  });
});
