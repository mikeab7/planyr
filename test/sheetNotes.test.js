import { describe, it, expect } from "vitest";
import { parseNotes, aggregateNotes } from "../src/shared/files/sheetNotes.js";

const dims = { width: 1224, height: 792 };
const L = (text, x, y, h = 10) => ({ text, x, y, w: text.length * 6, h, lineH: h });

describe("parseNotes — find notes/legend blocks (B350)", () => {
  it("captures a heading + its column body, stopping at a big vertical gap", () => {
    const lines = [
      L("GENERAL NOTES", 100, 100),
      L("1. ALL WORK PER CITY STANDARDS", 100, 118),
      L("2. CONTRACTOR TO VERIFY UTILITIES", 100, 134),
      L("PLAN VIEW", 100, 500), // far below → a different region, excluded
    ];
    const blocks = parseNotes(lines, dims);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].heading).toBe("GENERAL NOTES");
    expect(blocks[0].lines).toHaveLength(2);
    expect(blocks[0].lines[0]).toMatch(/CITY STANDARDS/);
  });

  it("reads multiple blocks (NOTES + LEGEND)", () => {
    const lines = [
      L("GRADING NOTES", 100, 100),
      L("1. FINISH GRADES SHOWN", 100, 116),
      L("LEGEND", 100, 300),
      L("FF = FINISH FLOOR", 100, 316),
      L("TC = TOP OF CURB", 100, 332),
    ];
    const blocks = parseNotes(lines, dims);
    expect(blocks.map((b) => b.heading)).toEqual(["GRADING NOTES", "LEGEND"]);
    expect(blocks[1].lines).toHaveLength(2);
  });

  it("does not treat a sentence ending in 'notes' as a heading", () => {
    const lines = [L("REFER TO THE STRUCTURAL DRAWINGS FOR ADDITIONAL NOTES", 100, 100)];
    expect(parseNotes(lines, dims)).toHaveLength(0);
  });
});

describe("aggregateNotes — union across sheets, flag per-sheet variations (B350)", () => {
  const sheetA = { sheet: "C-5", notes: [{ heading: "GENERAL NOTES", lines: ["1. ALL WORK PER CITY", "2. VERIFY UTILITIES"] }] };
  const sheetB = { sheet: "C-6", notes: [{ heading: "GENERAL NOTES", lines: ["1. ALL WORK PER CITY", "3. SEE STRUCTURAL"] }] };

  it("dedupes a shared note and keeps every distinct note", () => {
    const model = aggregateNotes([sheetA, sheetB]);
    expect(model).toHaveLength(1);
    expect(model[0].heading).toBe("GENERAL NOTES");
    const texts = model[0].lines.map((l) => l.text);
    expect(texts).toContain("1. ALL WORK PER CITY");
    expect(texts).toContain("2. VERIFY UTILITIES");
    expect(texts).toContain("3. SEE STRUCTURAL");
    expect(model[0].lines).toHaveLength(3);
  });

  it("tracks which sheets each note appeared on", () => {
    const model = aggregateNotes([sheetA, sheetB]);
    const shared = model[0].lines.find((l) => /ALL WORK/.test(l.text));
    const onlyA = model[0].lines.find((l) => /VERIFY/.test(l.text));
    expect(shared.sheets.sort()).toEqual(["C-5", "C-6"]);
    expect(onlyA.sheets).toEqual(["C-5"]);
    expect(model[0].sheetsWithHeading.sort()).toEqual(["C-5", "C-6"]);
  });

  it("ignores the enumerator when deduping ('1.' vs '1)')", () => {
    const a = { sheet: "A", notes: [{ heading: "NOTES", lines: ["1. SAME NOTE"] }] };
    const b = { sheet: "B", notes: [{ heading: "NOTES", lines: ["1) SAME NOTE"] }] };
    const model = aggregateNotes([a, b]);
    expect(model[0].lines).toHaveLength(1);
    expect(model[0].lines[0].sheets.sort()).toEqual(["A", "B"]);
  });
});
