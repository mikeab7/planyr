import { describe, it, expect } from "vitest";
import { classifyDiscipline, findDates, latestDate, issueDate, parseSheetNumber, parseRevision, readTitleBlockText } from "../src/shared/files/titleBlockParse.js";

describe("classifyDiscipline — plain-code doc-type detection, no LLM (B312)", () => {
  it("recognizes an ALTA survey by name (owner example)", () => {
    expect(classifyDiscipline("ALTA/NSPS LAND TITLE SURVEY OF ...")).toEqual({ discipline: "Survey", item: "ALTA Survey" });
    expect(classifyDiscipline("This is an ALTA survey")).toMatchObject({ discipline: "Survey", item: "ALTA Survey" });
  });
  it("maps common sheet types to disciplines", () => {
    expect(classifyDiscipline("BOUNDARY SURVEY")).toMatchObject({ discipline: "Survey", item: "Boundary Survey" });
    expect(classifyDiscipline("OVERALL GRADING PLAN")).toMatchObject({ discipline: "Civil", item: "Grading Plan" });
    expect(classifyDiscipline("LANDSCAPE PLANTING PLAN")).toMatchObject({ discipline: "Landscape" });
    expect(classifyDiscipline("FINAL PLAT OF ...")).toMatchObject({ discipline: "Survey", item: "Plat" });
  });
  it("routes the expanded discipline buckets (owner taxonomy 2026-06-21)", () => {
    // Fire is split; Structural/Mechanical/Electrical/Plumbing get their own buckets (were "Other").
    expect(classifyDiscipline("FIRE SPRINKLER PLAN")).toMatchObject({ discipline: "Fire Sprinkler" });
    expect(classifyDiscipline("FIRE PROTECTION PLAN")).toMatchObject({ discipline: "Fire Sprinkler" });
    expect(classifyDiscipline("FIRE ALARM RISER DIAGRAM")).toMatchObject({ discipline: "Fire Alarm" });
    expect(classifyDiscipline("FOUNDATION PLAN — STRUCTURAL")).toMatchObject({ discipline: "Structural" });
    expect(classifyDiscipline("MECHANICAL HVAC PLAN")).toMatchObject({ discipline: "Mechanical" });
    expect(classifyDiscipline("ELECTRICAL POWER PLAN")).toMatchObject({ discipline: "Electrical" });
    expect(classifyDiscipline("PLUMBING PLAN")).toMatchObject({ discipline: "Plumbing" });
  });
  it("classifies by WEIGHTED dominance — a stray cross-reference can't steal it (B360 corpus)", () => {
    // Real failure: a Jacintoport STRUCTURAL set said "structural" 71× but a deep "grading" 2× filed
    // it Civil (rule order); a Jacintoport ARCH set said "structural" 61× (cross-refs) but "floor
    // plan" 22× and read Structural. Definitive sheet-types outweigh bare cross-reference names.
    const structural = "FOUNDATION PLAN  FRAMING PLAN  STRUCTURAL NOTES  SEE CIVIL GRADING PLAN  SEE ARCHITECTURAL DRAWINGS";
    expect(classifyDiscipline(structural).discipline).toBe("Structural");
    const arch = "FLOOR PLAN  ROOF PLAN  REFLECTED CEILING PLAN  BUILDING ELEVATIONS  SEE STRUCTURAL  STRUCTURAL  STRUCTURAL";
    expect(classifyDiscipline(arch).discipline).toBe("Architectural");
  });
  it("falls back to the sheet-number prefix when keywords miss, else Other (never a guess)", () => {
    expect(classifyDiscipline("just some notes", "C-2.01")).toMatchObject({ discipline: "Civil" });
    expect(classifyDiscipline("just some notes", "A7.10")).toMatchObject({ discipline: "Architectural" });
    expect(classifyDiscipline("just some notes", "S-101")).toMatchObject({ discipline: "Structural" });
    expect(classifyDiscipline("just some notes", "E-601")).toMatchObject({ discipline: "Electrical" });
    expect(classifyDiscipline("just some notes", "SV-1")).toMatchObject({ discipline: "Survey" }); // SV before bare S
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
  it("a mixed-separator dimension is NOT a date (B360 — '5-29/32' once parsed as 2032)", () => {
    // Real failure: a Jacintoport MEP sheet's "DEGREES AT 5-29/32" parsed as 2032-05-29 and poisoned
    // the latest-date pick. Same separator is required, so the dimension is ignored, the real date kept.
    expect(findDates("DEGREES AT 5-29/32")).toEqual([]);
    expect(latestDate("ISSUED 10/08/2024  BEVEL 5-29/32")).toBe("2024-10-08");
  });
});

describe("issueDate — prefer the issue/revision date over a base date (B411b)", () => {
  it("picks the date next to ISSUED/REV, not a newer unrelated date elsewhere", () => {
    // The reported failure shape: a base "DATE" and an issue date, plus a stray later date in the
    // notes. Pure-recency grabbed the stray; issueDate stays on the labeled revision date.
    const text = "DATE: 04/07/2023   GENERAL NOTES SEE 11/30/2026 SPEC   REV 2  ISSUED FOR PERMIT  09/17/2025";
    expect(latestDate(text)).toBe("2026-11-30");  // pure recency = wrong
    expect(issueDate(text)).toBe("2025-09-17");   // labeled issue/rev date = right
  });
  it("prefers the issue date over an older bare base date", () => {
    const text = "DATE 04/07/2023   ISSUED FOR CONSTRUCTION 09/17/2025";
    expect(issueDate(text)).toBe("2025-09-17");
  });
  it("among several revision dates, the latest labeled one wins", () => {
    const text = "REV 1 06/01/2024  REV 2 09/17/2025  REV 3 IFC 11/02/2025";
    expect(issueDate(text)).toBe("2025-11-02");
  });
  it("falls back to the newest date when nothing is labeled (no regression)", () => {
    const text = "DRAWN 01/15/2024  CHECKED 2024-03-02  plotted June 30, 2025";
    expect(issueDate(text)).toBe(latestDate(text));
    expect(issueDate(text)).toBe("2025-06-30");
  });
  it("a bare DATE label does NOT promote its date (that's the base date we avoid)", () => {
    // Only a real issue/rev keyword promotes; "DATE" alone must not, or we'd re-pick the base date.
    const text = "DATE 09/17/2025   PRINTED 11/30/2026";
    expect(issueDate(text)).toBe("2026-11-30"); // no issue/rev label → newest wins
  });
  it("returns '' with no readable date", () => {
    expect(issueDate("no dates, just REV nonsense")).toBe("");
  });
  it("readTitleBlockText.date now uses the issue/rev date", () => {
    const text = "PROJECT  DATE: 04/07/2023   REV 2 ISSUED FOR PERMIT 09/17/2025  SHEET C-2";
    expect(readTitleBlockText(text).date).toBe("2025-09-17");
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
  it("maps the spelled-out issue phrase to its code, even without the 'D' (B360 corpus)", () => {
    // The owner's Jacintoport sheets print "ISSUE FOR CONSTRUCTION" (no D) with no short code.
    expect(parseRevision("JACINTOPORT  ARCHITECTURAL  ISSUE FOR CONSTRUCTION")).toBe("IFC");
    expect(parseRevision("ISSUE FOR PERMIT")).toBe("IFP");
    expect(parseRevision("ISSUED FOR BID")).toBe("IFB");
  });
  it("does NOT read the heading 'REVISIONS' as 'Rev S' (B360 — Mesa title blocks)", () => {
    expect(parseRevision("SUBMITTALS / REVISIONS:  NO. DATE DESCRIPTION")).toBe("");
    expect(parseRevision("GENERAL REVISIONS")).toBe("");
    expect(parseRevision("Rev 10")).toBe("REV 10"); // a real lone value still reads
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
