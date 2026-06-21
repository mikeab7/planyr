import { describe, it, expect } from "vitest";
import {
  numberToConcept,
  conceptLettersToNumber,
  parseConceptIndex,
  nextConceptName,
} from "../src/workspaces/site-planner/lib/conceptName.js";

describe("numberToConcept — bijective base-26 (NEW-1/NEW-2)", () => {
  it("maps the single-letter range A–Z", () => {
    expect(numberToConcept(1)).toBe("A");
    expect(numberToConcept(2)).toBe("B");
    expect(numberToConcept(26)).toBe("Z");
  });
  it("rolls past Z spreadsheet-style (AA, AB, …) instead of crashing at 27", () => {
    expect(numberToConcept(27)).toBe("AA");
    expect(numberToConcept(28)).toBe("AB");
    expect(numberToConcept(52)).toBe("AZ");
    expect(numberToConcept(53)).toBe("BA");
    expect(numberToConcept(702)).toBe("ZZ");
    expect(numberToConcept(703)).toBe("AAA");
  });
  it("guards non-positive / NaN with an empty string", () => {
    expect(numberToConcept(0)).toBe("");
    expect(numberToConcept(-3)).toBe("");
    expect(numberToConcept(NaN)).toBe("");
  });
});

describe("conceptLettersToNumber — inverse of numberToConcept", () => {
  it("inverts the single- and multi-letter ranges", () => {
    expect(conceptLettersToNumber("A")).toBe(1);
    expect(conceptLettersToNumber("Z")).toBe(26);
    expect(conceptLettersToNumber("AA")).toBe(27);
    expect(conceptLettersToNumber("ZZ")).toBe(702);
  });
  it("is round-trip stable for a wide range", () => {
    for (const n of [1, 5, 26, 27, 100, 701, 702, 703, 1000]) {
      expect(conceptLettersToNumber(numberToConcept(n))).toBe(n);
    }
  });
  it("rejects non-letters", () => {
    expect(conceptLettersToNumber("A1")).toBeNull();
    expect(conceptLettersToNumber("")).toBeNull();
    expect(conceptLettersToNumber(3)).toBeNull();
  });
});

describe("parseConceptIndex — only exact concept labels count", () => {
  it("parses a clean concept label (case / spacing tolerant)", () => {
    expect(parseConceptIndex("Concept A")).toBe(1);
    expect(parseConceptIndex("concept b")).toBe(2);
    expect(parseConceptIndex("  Concept   AA  ")).toBe(27);
  });
  it("ignores non-concept names so they never feed the sequence", () => {
    expect(parseConceptIndex("Plan 1")).toBeNull();
    expect(parseConceptIndex("Concept 3")).toBeNull();
    expect(parseConceptIndex("Concept A (copy)")).toBeNull();
    expect(parseConceptIndex("My concept")).toBeNull();
    expect(parseConceptIndex(null)).toBeNull();
    expect(parseConceptIndex(undefined)).toBeNull();
  });
});

describe("nextConceptName — per-site sequencing past the highest letter", () => {
  it("starts at Concept A for an empty / fresh site", () => {
    expect(nextConceptName([])).toBe("Concept A");
    expect(nextConceptName()).toBe("Concept A");
  });
  it("a site whose only plans are legacy 'Plan N' still starts at Concept A", () => {
    expect(nextConceptName(["Plan 1", "Plan 2"])).toBe("Concept A");
  });
  it("continues one past the highest existing concept", () => {
    expect(nextConceptName(["Concept A"])).toBe("Concept B");
    expect(nextConceptName(["Concept A", "Concept B", "Concept C"])).toBe("Concept D");
  });
  it("does NOT reuse a deleted gap — goes past the max, not into the hole", () => {
    // "Concept A" was deleted; "Concept B" remains → next is C, never A again.
    expect(nextConceptName(["Concept B"])).toBe("Concept C");
    expect(nextConceptName(["Concept A", "Concept C"])).toBe("Concept D");
  });
  it("rolls into the AA range when the site reaches 26 concepts", () => {
    expect(nextConceptName(["Concept Z"])).toBe("Concept AA");
    expect(nextConceptName(["Concept AA", "Concept AB"])).toBe("Concept AC");
  });
  it("ignores user-edited / unrelated names mixed in", () => {
    expect(nextConceptName(["Concept A", "South layout", "Plan 7", "Concept B"])).toBe("Concept C");
  });
});
