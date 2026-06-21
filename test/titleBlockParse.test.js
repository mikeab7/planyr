import { describe, it, expect } from "vitest";
import { classifyDiscipline, findDates, latestDate, parseSheetNumber, parseRevision, readTitleBlockText } from "../src/shared/files/titleBlockParse.js";

describe("classifyDiscipline — plain-code doc-type detection, no LLM (B312)", () => {
  it("recognizes an ALTA survey by name (owner example)", () => {
    expect(classifyDiscipline("ALTA/NSPS LAND TITLE SURVEY OF ...")).toEqual({ discipline: "Survey", item: "ALTA Survey" });
    expect(classifyDiscipline("This is an ALTA survey")).toMatchObject({ discipline: "Survey", item: "ALTA Survey" });
  });
  it("maps common sheet types to disciplines", () => {
    expect(classifyDiscipline("BOUNDARY SURVEY")).toMatchObject({ discipline: "Survey", item: "Boundary Survey" });
    expect(classifyDiscipline("OVERALL GRADING PLAN")).toMatchObject({ discipline: "Civil", item: "Grading Plan" });
    expect(classifyDiscipline("FIRE SPRINKLER PLAN")).toMatchObject({ item: "Fire Sprinkler" });
    expect(classifyDiscipline("LANDSCAPE PLANTING PLAN")).toMatchObject({ discipline: "Landscape" });
    expect(classifyDiscipline("FINAL PLAT OF ...")).toMatchObject({ discipline: "Survey", item: "Plat" });
  });
  it("falls back to the sheet-number prefix when keywords miss, else Other (never a guess)", () => {
    expect(classifyDiscipline("just some notes", "C-2.01")).toMatchObject({ discipline: "Civil" });
    expect(classifyDiscipline("just some notes", "A7.10")).toMatchObject({ discipline: "Architectural" });
    expect(classifyDiscipline("nothing recognizable here")).toEqual({ discipline: "Other", item: "Document" });
  });
});

describe("findDates / latestDate — 'search all dates and date itself' (owner)", () => {
  it("finds dates in several formats and returns the newest", () => {
    const text = "DRAWN 01/15/2024  CHECKED 2024-03-02  ISSUED June 30, 2025  rev 05.10.25";
    expect(findDates(text)).toContain("2025-06-30");
    expect(latestDate(text)).toBe("2025-06-30");
  });
  it("parses '30 June 2025' and numeric 2-digit years", () => {
    expect(latestDate("plotted 30 June 2025")).toBe("2025-06-30");
    expect(findDates("6/30/25")).toEqual(["2025-06-30"]);
  });
  it("returns '' when there's no real date (no fabrication)", () => {
    expect(latestDate("no dates here, just 13/45/9999 nonsense")).toBe("");
  });
});

describe("parseSheetNumber — conservative, labelled-first (B312)", () => {
  it("reads a labelled sheet number", () => {
    expect(parseSheetNumber("... SHEET NO: C-2.01 ...")).toBe("C-2.01");
    expect(parseSheetNumber("DWG # A7.10")).toBe("A7.10");
  });
  it("returns '' rather than grab a random grid ref", () => {
    expect(parseSheetNumber("detail A195 and column W21 on the page")).toBe("");
  });
});

describe("parseRevision", () => {
  it("reads issue/revision labels", () => {
    expect(parseRevision("ISSUED FOR CONSTRUCTION  IFC")).toBe("IFC");
    expect(parseRevision("Rev 3")).toBe("REV 3");
    expect(parseRevision("no revision label")).toBe("");
  });
});

describe("readTitleBlockText — the deterministic field bundle", () => {
  it("assembles fields from a vector sheet's text", () => {
    const f = readTitleBlockText("KATY GRAND BLDG 1  GRADING PLAN  SHEET NO: C-2.01  ISSUED FOR CONSTRUCTION IFC  June 30, 2025");
    expect(f.hasText).toBe(true);
    expect(f).toMatchObject({ discipline: "Civil", item: "Grading Plan", sheetNumber: "C-2.01", revision: "IFC", date: "2025-06-30" });
  });
  it("flags an empty/scanned page so the caller falls back to the AI", () => {
    expect(readTitleBlockText("").hasText).toBe(false);
    expect(readTitleBlockText("   ").hasText).toBe(false);
  });
  it("surfaces the stated scale in the same pass (one reader — B360)", () => {
    // ONE reader: filing fields + the Markup auto-calibration scale come from a single read.
    const civil = readTitleBlockText("OVERALL GRADING PLAN  SHEET C-3  06/30/2025  SCALE: 1\"=40'");
    expect(civil.scale).toMatchObject({ ftPerInch: 40, form: "engineer" });
    const arch = readTitleBlockText("FLOOR PLAN  SHEET A-2  10/24/2025  1/8\"=1'-0\"");
    expect(arch.scale).toMatchObject({ ftPerInch: 8, form: "arch" });
    // a sheet with no stated scale → null (never fabricated)
    expect(readTitleBlockText("BOUNDARY SURVEY  SHEET V-1  06/30/2025").scale).toBeNull();
  });
});
