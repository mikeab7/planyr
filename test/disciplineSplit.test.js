import { describe, it, expect } from "vitest";
import { resolvePageDiscipline, smoothDisciplines, splitByDiscipline, buildFilingPlan } from "../src/shared/files/disciplineSplit.js";

// A per-page record as readTitleBlockText / readSheetMeta produce it.
const pg = (n, o = {}) => ({ pageNum: n, hasText: true, discipline: "Other", item: "Document", sheetNumber: "", ...o });

describe("resolvePageDiscipline — prefix-first", () => {
  it("trusts the sheet code's letter prefix over a skewed keyword discipline", () => {
    // The real Jacintoport make-ready case: sheet A5.00 read as Structural from cross-refs.
    expect(resolvePageDiscipline(pg(1, { sheetNumber: "A5.00", discipline: "Structural" }))).toBe("Architectural");
    expect(resolvePageDiscipline(pg(1, { sheetNumber: "M-1", discipline: "Architectural" }))).toBe("Mechanical");
    expect(resolvePageDiscipline(pg(1, { sheetNumber: "C-2.01", discipline: "Other" }))).toBe("Civil");
  });
  it("falls back to the keyword discipline when there is no code prefix", () => {
    expect(resolvePageDiscipline(pg(1, { sheetNumber: "25", discipline: "Architectural" }))).toBe("Architectural");
    expect(resolvePageDiscipline(pg(1, { sheetNumber: "", discipline: "Civil" }))).toBe("Civil");
  });
  it("returns UNKNOWN for a page with neither a code nor a confident discipline", () => {
    expect(resolvePageDiscipline(pg(1, { discipline: "Other" }))).toBe("");
    expect(resolvePageDiscipline(pg(1, { hasText: false }))).toBe("");
  });
});

describe("smoothDisciplines — sticky covers/notes + lone-page denoise", () => {
  it("carries a discipline forward across an unknown (cover/notes) page", () => {
    const pages = [pg(1, { sheetNumber: "C-1" }), pg(2), pg(3, { sheetNumber: "C-3" })];
    const raw = ["Civil", "", "Civil"];
    expect(smoothDisciplines(pages, raw)).toEqual(["Civil", "Civil", "Civil"]);
  });
  it("fills a leading unknown from the first known discipline", () => {
    const pages = [pg(1), pg(2, { sheetNumber: "A-1" })];
    expect(smoothDisciplines(pages, ["", "Architectural"])).toEqual(["Architectural", "Architectural"]);
  });
  it("pulls a lone codeless misread back to two agreeing neighbors", () => {
    const pages = [pg(1, { sheetNumber: "A-1" }), pg(2, { discipline: "Structural" }), pg(3, { sheetNumber: "A-3" })];
    expect(smoothDisciplines(pages, ["Architectural", "Structural", "Architectural"])).toEqual(["Architectural", "Architectural", "Architectural"]);
  });
  it("does NOT override a lone page that carries its OWN sheet code", () => {
    const pages = [pg(1, { sheetNumber: "A-1" }), pg(2, { sheetNumber: "S-1" }), pg(3, { sheetNumber: "A-3" })];
    expect(smoothDisciplines(pages, ["Architectural", "Structural", "Architectural"])).toEqual(["Architectural", "Structural", "Architectural"]);
  });
});

describe("splitByDiscipline", () => {
  it("a single-discipline set → not multi, one dominant", () => {
    const pages = [pg(1, { sheetNumber: "C-1", discipline: "Civil" }), pg(2, { sheetNumber: "C-2", discipline: "Civil" })];
    const r = splitByDiscipline(pages);
    expect(r.multiDiscipline).toBe(false);
    expect(r.dominant.discipline).toBe("Civil");
  });

  it("majority vote fixes a cover that names another discipline (Mesa Mechanical case)", () => {
    // Page 1 (cover) reads Architectural; pages 2–5 are Mechanical. Dominant must be Mechanical.
    const pages = [
      pg(1, { discipline: "Architectural" }),
      pg(2, { sheetNumber: "M-1", discipline: "Mechanical" }),
      pg(3, { sheetNumber: "M-2", discipline: "Mechanical" }),
      pg(4, { sheetNumber: "M-3", discipline: "Mechanical" }),
      pg(5, { sheetNumber: "M-4", discipline: "Mechanical" }),
    ];
    const r = splitByDiscipline(pages);
    expect(r.dominant.discipline).toBe("Mechanical");
    expect(r.multiDiscipline).toBe(false); // the lone arch cover folds in (no code, 1 page)
  });

  it("splits a genuine multi-discipline set into standalone discipline sets (Bergstrom case)", () => {
    const pages = [
      pg(1, { sheetNumber: "A-1", discipline: "Architectural" }),
      pg(2, { sheetNumber: "A-2", discipline: "Architectural" }),
      pg(3, { sheetNumber: "S-1", discipline: "Structural" }),
      pg(4, { sheetNumber: "S-2", discipline: "Structural" }),
      pg(5, { sheetNumber: "S-3", discipline: "Structural" }),
      pg(6, { sheetNumber: "A-3", discipline: "Architectural" }),
    ];
    const r = splitByDiscipline(pages);
    expect(r.multiDiscipline).toBe(true);
    const discs = r.standaloneSets.map((s) => s.discipline).sort();
    expect(discs).toEqual(["Architectural", "Structural"]);
    // The two architectural blocks (pages 1-2 and 6) merge into one filing set.
    const arch = r.standaloneSets.find((s) => s.discipline === "Architectural");
    expect(arch.pageNums.sort((a, b) => a - b)).toEqual([1, 2, 6]);
  });

  it("does not create a junk 1-page set for a lone codeless cross-ref page", () => {
    const pages = [
      pg(1, { sheetNumber: "C-1", discipline: "Civil" }),
      pg(2, { sheetNumber: "C-2", discipline: "Civil" }),
      pg(3, { discipline: "Electrical" }), // a single codeless page — folds in, not its own set
      pg(4, { sheetNumber: "C-3", discipline: "Civil" }),
    ];
    const r = splitByDiscipline(pages);
    expect(r.multiDiscipline).toBe(false);
    expect(r.dominant.discipline).toBe("Civil");
  });

  it("flags scanned (no-text) pages honestly", () => {
    const pages = [pg(1, { hasText: false }), pg(2, { hasText: false })];
    const r = splitByDiscipline(pages);
    expect(r.scannedPages).toEqual([1, 2]);
    expect(r.dominant.discipline).toBe("Other");
  });

  it("empty input degrades cleanly", () => {
    const r = splitByDiscipline([]);
    expect(r.multiDiscipline).toBe(false);
    expect(r.sets).toEqual([]);
  });
});

describe("buildFilingPlan — B537: tolerates a set missing pageNums (malformed input, no crash)", () => {
  it("degrades a pageNums-less set in split.sets to 0 instead of throwing 'not iterable'", () => {
    const split = { multiDiscipline: false, dominant: { discipline: "Civil", item: "Civil Set" },
      sets: [{ discipline: "Civil" /* pageNums missing */ }], standaloneSets: [] };
    expect(() => buildFilingPlan(split, 3)).not.toThrow();
    const plan = buildFilingPlan(split, 3);
    expect(plan[0].pageNums).toEqual([1, 2, 3]); // falls back to totalPages
  });
  it("a multi-discipline split with a pageNums-less standalone set does not throw", () => {
    const split = { multiDiscipline: true, dominant: { discipline: "Civil" },
      standaloneSets: [{ discipline: "Civil", pageNums: [1, 2] }, { discipline: "Survey" /* no pageNums */ }],
      sets: [{ discipline: "Civil", pageNums: [1, 2] }, { discipline: "Survey" }] };
    expect(() => buildFilingPlan(split, 4)).not.toThrow();
  });
});
