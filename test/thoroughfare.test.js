/* Unit tests for the canonical thoroughfare classification vocabulary (B720). Pure library that
 * the schema CHECK constraints, the ingestion crosswalks (B721/B722), the overlay legend (B723),
 * and the parcel analysis (B724) all share — so it must never drift. */
import { describe, it, expect } from "vitest";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  isClassification,
  normalizeClassification,
  STATUSES,
  normalizeStatus,
} from "../src/shared/thoroughfare/classification.js";

describe("classification vocabulary", () => {
  it("matches the DB CHECK enum exactly (order aside)", () => {
    // Mirror of the thoroughfare_segments / jurisdiction_row_standards CHECK constraint.
    const dbEnum = [
      "freeway",
      "major_thoroughfare",
      "transit_corridor",
      "collector_major",
      "collector_minor",
      "other",
    ];
    expect([...CLASSIFICATIONS].sort()).toEqual([...dbEnum].sort());
  });
  it("gives every classification exactly one label", () => {
    expect(Object.keys(CLASSIFICATION_LABELS).sort()).toEqual([...CLASSIFICATIONS].sort());
    for (const c of CLASSIFICATIONS) expect(CLASSIFICATION_LABELS[c]).toBeTruthy();
  });
  it("orders loudest → quietest (freeway first, other last)", () => {
    expect(CLASSIFICATIONS[0]).toBe("freeway");
    expect(CLASSIFICATIONS[CLASSIFICATIONS.length - 1]).toBe("other");
  });
  it("isClassification guards the enum", () => {
    expect(isClassification("freeway")).toBe(true);
    expect(isClassification("boulevard")).toBe(false);
    expect(isClassification("")).toBe(false);
  });
});

describe("normalizeClassification", () => {
  const cw = {
    "major thoroughfare": "major_thoroughfare",
    "principal arterial": "major_thoroughfare",
    collector: "collector_major",
    fwy: "freeway",
  };
  it("maps a raw value through the crosswalk", () => {
    expect(normalizeClassification("Major Thoroughfare", cw)).toBe("major_thoroughfare");
    expect(normalizeClassification("collector", cw)).toBe("collector_major");
  });
  it("is case- and whitespace-insensitive", () => {
    expect(normalizeClassification("  FWY ", cw)).toBe("freeway");
    expect(normalizeClassification("PRINCIPAL ARTERIAL", cw)).toBe("major_thoroughfare");
  });
  it("falls back to 'other' for unknown / blank / null / undefined", () => {
    expect(normalizeClassification("cul-de-sac", cw)).toBe("other");
    expect(normalizeClassification("", cw)).toBe("other");
    expect(normalizeClassification(null, cw)).toBe("other");
    expect(normalizeClassification(undefined)).toBe("other");
  });
  it("rejects a crosswalk target that isn't itself canonical", () => {
    expect(normalizeClassification("x", { x: "not_a_class" })).toBe("other");
  });
  it("always returns a canonical value", () => {
    for (const raw of ["", "freeway", "random", "MAJOR THOROUGHFARE", null]) {
      expect(isClassification(normalizeClassification(raw, cw))).toBe(true);
    }
  });
});

describe("normalizeStatus", () => {
  it("collapses future-road spellings to 'proposed'", () => {
    for (const s of ["proposed", "Future", "PLANNED", " ultimate "]) {
      expect(normalizeStatus(s)).toBe("proposed");
    }
  });
  it("defaults everything else to 'existing'", () => {
    for (const s of ["existing", "", null, undefined, "in service"]) {
      expect(normalizeStatus(s)).toBe("existing");
    }
  });
  it("STATUSES enumerates exactly the two states", () => {
    expect(STATUSES).toEqual(["existing", "proposed"]);
  });
});
