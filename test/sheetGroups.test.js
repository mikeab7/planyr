import { describe, it, expect } from "vitest";
import { parseSheetCode, consecutiveCodes, groupKey, groupSheets, markAdjacentDuplicateNumbers } from "../src/shared/files/sheetGroups.js";

const sheet = (sheetNumber, item, discipline = "Civil", sheetTitle = "") => ({ sheetNumber, item, discipline, sheetTitle });

describe("parseSheetCode + consecutiveCodes — sheet-number contiguity (B335)", () => {
  it("parses prefix/major/minor into a comparable ordinal", () => {
    expect(parseSheetCode("C5")).toMatchObject({ prefix: "C", major: 5, minor: null, ordinal: 5 });
    expect(parseSheetCode("C-2.01")).toMatchObject({ prefix: "C", major: 2, minor: 1, ordinal: 201 });
    expect(parseSheetCode("A7.10")).toMatchObject({ prefix: "A", major: 7, minor: 10, ordinal: 710 });
    expect(parseSheetCode("")).toBeNull();
  });
  it("treats a +1 ordinal step on the same prefix as consecutive", () => {
    expect(consecutiveCodes(parseSheetCode("C5"), parseSheetCode("C6"))).toBe(true);
    expect(consecutiveCodes(parseSheetCode("C-2.01"), parseSheetCode("C-2.02"))).toBe(true);
    expect(consecutiveCodes(parseSheetCode("C5"), parseSheetCode("C7"))).toBe(false); // gap
    expect(consecutiveCodes(parseSheetCode("C5"), parseSheetCode("A6"))).toBe(false); // prefix change
  });
});

describe("groupKey — same plan type chains, generic does not", () => {
  it("keys on discipline+item, ignoring generic 'Document'", () => {
    expect(groupKey(sheet("C5", "Grading Plan"))).toBe(groupKey(sheet("C6", "Grading Plan")));
    expect(groupKey(sheet("X1", "Document"))).toBe(""); // ungroupable
  });
});

describe("markAdjacentDuplicateNumbers — clear cross-reference misreads (B378)", () => {
  it("clears a sheet number that repeats on an adjacent page (the 'S202 ×4' bug)", () => {
    const pages = [
      { pageNum: 1, sheetNumber: "S202", confidence: 0.8 },
      { pageNum: 2, sheetNumber: "S202", confidence: 0.8 },
      { pageNum: 3, sheetNumber: "S202", confidence: 0.8 },
    ];
    const out = markAdjacentDuplicateNumbers(pages);
    expect(out.map((p) => p.sheetNumber)).toEqual(["", "", ""]);
    expect(out.every((p) => p.dupNumber && p.confidence <= 0.3)).toBe(true);
  });
  it("leaves a normal distinct run untouched (same objects)", () => {
    const pages = [{ sheetNumber: "C-5" }, { sheetNumber: "C-6" }, { sheetNumber: "C-7" }];
    const out = markAdjacentDuplicateNumbers(pages);
    expect(out.map((p) => p.sheetNumber)).toEqual(["C-5", "C-6", "C-7"]);
    expect(out[0]).toBe(pages[0]); // unchanged pages are not re-created
  });
  it("ignores empty numbers (two un-numbered pages are not 'duplicates')", () => {
    const out = markAdjacentDuplicateNumbers([{ sheetNumber: "" }, { sheetNumber: "" }]);
    expect(out.every((p) => !p.dupNumber)).toBe(true);
  });
});

describe("groupSheets — collapse a real set into logical sheets (B335)", () => {
  it("groups a contiguous grading run and leaves the cover + a lone detail standalone", () => {
    const pages = [
      sheet("", "Document", "Other", "COVER SHEET"),          // cover — no number → standalone
      sheet("C5", "Grading Plan"), sheet("C6", "Grading Plan"),
      sheet("C7", "Grading Plan"), sheet("C8", "Grading Plan"), sheet("C9", "Grading Plan"),
      sheet("C10", "Utility Plan"),                            // different plan → its own single
    ];
    const groups = groupSheets(pages);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ kind: "single", title: "COVER SHEET" });
    expect(groups[1]).toMatchObject({ kind: "group", title: "Grading Plan", sheetRange: "C5–C9" });
    expect(groups[1].label).toBe("Grading Plan · C5–C9 · 5 sheets");
    expect(groups[1].pages).toHaveLength(5);
    expect(groups[2]).toMatchObject({ kind: "single", title: "Utility Plan" });
  });
  it("does NOT merge same-type sheets across a numbering gap", () => {
    const groups = groupSheets([sheet("C5", "Grading Plan"), sheet("C7", "Grading Plan")]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === "single")).toBe(true);
  });
  it("does NOT merge a contiguous run of DIFFERENT plan types", () => {
    const groups = groupSheets([sheet("C5", "Grading Plan"), sheet("C6", "Paving Plan")]);
    expect(groups).toHaveLength(2);
  });
  it("collapses ~20 pages into a much shorter logical list", () => {
    const pages = [
      sheet("", "Document", "Other", "COVER"),
      sheet("G1", "Document", "Geotech", "GENERAL NOTES"),
      ...Array.from({ length: 5 }, (_, i) => sheet("C" + (5 + i), "Grading Plan")),
      ...Array.from({ length: 4 }, (_, i) => sheet("C" + (10 + i), "Utility Plan")),
      ...Array.from({ length: 3 }, (_, i) => sheet("A" + (1 + i), "Architectural", "Architectural")),
    ];
    const groups = groupSheets(pages);
    // cover + notes (2 singles) + grading group + utility group + arch group = 5 logical
    expect(groups).toHaveLength(5);
    expect(groups.reduce((n, g) => n + g.pages.length, 0)).toBe(pages.length); // every page accounted for
  });
});
