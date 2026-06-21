import { describe, it, expect } from "vitest";
import { readSheets, readAndGroup, statedCalibration, groupCalibration } from "../src/workspaces/doc-review/lib/sheetRead.js";

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

describe("readSheets — per-page metadata from positioned text (B326)", () => {
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

describe("readAndGroup — collapse the set into logical sheets (B325)", () => {
  it("yields cover (single) + grading (group of 3) + utility (single)", async () => {
    const { groups } = await readAndGroup(doc, { extractItems });
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ kind: "single" });
    expect(groups[1]).toMatchObject({ kind: "group", title: "Grading Plan" });
    expect(groups[1].label).toBe("Grading Plan · C-5–C-7 · 3 sheets");
    expect(groups[2]).toMatchObject({ kind: "single", title: "Utility Plan" });
  });
});

describe("statedCalibration / groupCalibration — auto-calibrate per group (B329)", () => {
  it("turns a trusted stated scale into ft-per-point on a standard plot", async () => {
    const sheets = await readSheets(doc, { extractItems });
    expect(statedCalibration(sheets[1])).toBeCloseTo(40 / 72, 6); // 1"=40' on ANSI D
  });
  it("distrusts a stated scale on a NON-standard (resized) page → 0", () => {
    expect(statedCalibration({ scale: { ftPerInch: 40 }, width: 500, height: 500 })).toBe(0);
  });
  it("picks the group's scale from its first scaled page", async () => {
    const { groups } = await readAndGroup(doc, { extractItems });
    const cal = groupCalibration(groups[1].pages);
    expect(cal.ftPerUnit).toBeCloseTo(40 / 72, 6);
    expect(cal.label).toBe('1"=40\'');
  });
});
