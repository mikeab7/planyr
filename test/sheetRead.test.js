import { describe, it, expect } from "vitest";
import { readSheets, readAndGroup, statedCalibration, groupCalibration, isNotToScale, scaleBarCalibration } from "../src/workspaces/doc-review/lib/sheetRead.js";

const W = 2448, H = 1584; // ANSI D landscape (34×22 in) in points → detectSheet().std

function page({ number, title, scale }) {
  const items = [{ str: title, x: 1950, y: 200, w: 420, h: 24 }];
  if (scale) items.push({ str: "SCALE:", x: 1950, y: 262, w: 60, h: 12 }, { str: scale, x: 2030, y: 262, w: 70, h: 12 });
  if (number) items.push({ str: "SHEET NO.", x: 1950, y: 324, w: 90, h: 12 }, { str: number, x: 2060, y: 324, w: 40, h: 12 });
  for (let i = 0; i < 16; i++) items.push({ str: "GENERAL NOTE " + i, x: 1950, y: 380 + i * 30, w: 230, h: 12 });
  return { items, width: W, height: H };
}

const PAGES = {
  1: page({ title: "COVER SHEET" }),
  2: page({ number: "C-5", title: "GRADING PLAN", scale: '1"=40\'' }),
  3: page({ number: "C-6", title: "GRADING PLAN", scale: '1"=40\'' }),
  4: page({ number: "C-7", title: "GRADING PLAN", scale: '1"=40\'' }),
  5: page({ number: "C-8", title: "UTILITY PLAN", scale: '1"=40\'' }),
};
const doc = { numPages: 5 };
const extractItems = async (_doc, p) => PAGES[p];

describe("readSheets — per-page metadata from positioned text (B336)", () => {
  it("reads number, title, and scale for each page via the injected extractor", async () => {
    const sheets = await readSheets(doc, { extractItems });
    expect(sheets).toHaveLength(5);
    expect(sheets[1]).toMatchObject({ pageNum: 2, sheetNumber: "C-5", discipline: "Civil" });
    expect(sheets[1].scale).toMatchObject({ ftPerInch: 40 });
  });
  it("runs the OCR seam only for a no-text page", async () => {
    const blank = { items: [], width: W, height: H };
    let ocrCalls = 0;
    const ocr = async () => { ocrCalls++; return page({ number: "C-9", title: "PAVING PLAN", scale: '1"=20\'' }); };
    const sheets = await readSheets({ numPages: 1 }, { extractItems: async () => blank, ocr });
    expect(ocrCalls).toBe(1);
    expect(sheets[0]).toMatchObject({ sheetNumber: "C-9", ocr: true });
  });
});

describe("readAndGroup — collapse the set into logical sheets (B335)", () => {
  it("yields cover (single) + grading (group of 3) + utility (single)", async () => {
    const { groups } = await readAndGroup(doc, { extractItems });
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ kind: "single" });
    // B653: the group label now carries the sheet's OWN printed title (was the coarse
    // discipline item "Grading Plan").
    expect(groups[1]).toMatchObject({ kind: "group", title: "GRADING PLAN" });
    expect(groups[1].label).toBe("GRADING PLAN · C-5–C-7 · 3 sheets");
    expect(groups[2]).toMatchObject({ kind: "single", title: "UTILITY PLAN" });
  });
});

describe("statedCalibration / groupCalibration — auto-calibrate per group (B339)", () => {
  it("turns a trusted stated scale into ft-per-point on a standard plot", async () => {
    const sheets = await readSheets(doc, { extractItems });
    expect(statedCalibration(sheets[1])).toBeCloseTo(40 / 72, 6); // 1"=40' on ANSI D
  });
  it("distrusts a stated scale on a NON-standard (resized) page → 0", () => {
    expect(statedCalibration({ scale: { ftPerInch: 40 }, width: 500, height: 500 })).toBe(0);
  });
  it("does NOT auto-calibrate a text-dense notes/specs sheet, even on a standard plot (B379)", () => {
    // a scale-looking string in dense notes text must not silently scale a non-drawing sheet
    expect(statedCalibration({ scale: { ftPerInch: 40 }, width: W, height: H, textDense: true })).toBe(0);
  });
  it("picks the group's scale from its first scaled page", async () => {
    const { groups } = await readAndGroup(doc, { extractItems });
    const cal = groupCalibration(groups[1].pages);
    expect(cal.ftPerUnit).toBeCloseTo(40 / 72, 6);
    expect(cal.label).toBe('1"=40\'');
  });
});

describe("isNotToScale — a sheet that can never be measured (B631/NEW-2)", () => {
  it("is true for an explicit NOT TO SCALE title block", () => {
    expect(isNotToScale({ scale: { explicit: "nts", label: "NOT TO SCALE" } })).toBe(true);
  });
  it("is true for a text-dense non-drawing sheet (notes/specs/legend/schedule, B379)", () => {
    expect(isNotToScale({ textDense: true })).toBe(true);
    // even one carrying a scale-looking string — it's a legend, not a plan
    expect(isNotToScale({ textDense: true, scale: { ftPerInch: 40 } })).toBe(true);
  });
  it("is FALSE for a plan sheet whose stated scale we just couldn't read (keep Align available)", () => {
    // no explicit NTS + not text-dense → merely unlabeled, NOT proven not-to-scale
    expect(isNotToScale({ scale: null, textDense: false })).toBe(false);
    expect(isNotToScale({ scale: { ftPerInch: 40 }, textDense: false })).toBe(false);
    expect(isNotToScale({})).toBe(false);
    expect(isNotToScale(null)).toBe(false);
  });
});

describe("scaleBarCalibration — feet-per-unit from a stored scale-bar fact (B340 tail #1)", () => {
  const bar = { present: true, drawnLenPx: 200, realLenFt: 40, confidence: 0.8 };
  it("is dormant until an extractor stores a scaleBar fact (fail open → 0)", () => {
    expect(scaleBarCalibration({})).toBe(0);
    expect(scaleBarCalibration({ scaleBar: { present: false } })).toBe(0);
  });
  it("turns a confident bar fact into ft-per-unit", () => {
    expect(scaleBarCalibration({ scaleBar: bar })).toBeCloseTo(0.2, 6);
  });
  it("never auto-calibrates a text-dense sheet, and rejects a low-confidence read", () => {
    expect(scaleBarCalibration({ scaleBar: bar, textDense: true })).toBe(0);
    expect(scaleBarCalibration({ scaleBar: { ...bar, confidence: 0.3 } })).toBe(0);
  });
  it("groupCalibration prefers a STATED scale, falls back to the bar", () => {
    const W = 2448, H = 1584;
    const stated = { scale: { ftPerInch: 40, label: '1"=40\'' }, width: W, height: H };
    const barOnly = { scale: null, width: 500, height: 500, scaleBar: bar }; // non-standard size — stated would be distrusted
    expect(groupCalibration([stated]).src).toBe("stated");
    expect(groupCalibration([barOnly]).src).toBe("scalebar");
    // stated wins even when a later page has a bar
    expect(groupCalibration([stated, barOnly]).src).toBe("stated");
  });
});
