import { describe, it, expect } from "vitest";
import {
  parcelProvenance, provenanceLabel, PARCEL_SOURCES, PARCEL_FIELDS,
  cleanText, parseAcres, parcelNetSqft, parcelGrossSqft, parcelExceptSqft, acreageComparison, SQFT_PER_ACRE,
} from "../src/workspaces/site-planner/lib/parcelRecord.js";

// A 43,560 SF square = exactly one acre.
const ONE_ACRE = [{ x: 0, y: 0 }, { x: 208.7103, y: 0 }, { x: 208.7103, y: 208.7103 }, { x: 0, y: 208.7103 }];
const sq = (x0, y0, s) => [{ x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s }];

describe("parcelProvenance — a hand-drawn lot must never read as a county record", () => {
  it("honours an explicit source", () => {
    expect(parcelProvenance({ source: "deed" })).toBe("deed");
    expect(parcelProvenance({ source: "drawn" })).toBe("drawn");
    expect(parcelProvenance({ source: "county" })).toBe("county");
  });
  it("infers COUNTY for a legacy parcel carrying an appraisal record or a GIS key", () => {
    expect(parcelProvenance({ attrs: { OWNER: "ACME" } })).toBe("county");
    expect(parcelProvenance({ gisKey: "harris:123" })).toBe("county");
  });
  it("infers DRAWN for anything else — never `deed`, which is only ever stamped at promotion", () => {
    expect(parcelProvenance({ points: ONE_ACRE })).toBe("drawn");
    expect(parcelProvenance({})).toBe("drawn");
    expect(parcelProvenance(null)).toBe("drawn");
  });
  it("ignores a source value that isn't one of the known three", () => {
    expect(parcelProvenance({ source: "survey" })).toBe("drawn");
    expect(parcelProvenance({ source: "survey", attrs: {} })).toBe("county");
    expect(PARCEL_SOURCES).toEqual(["county", "deed", "drawn"]);
  });
  it("has a label for every source, and they read differently", () => {
    const shorts = PARCEL_SOURCES.map((s) => provenanceLabel({ source: s }).short);
    expect(new Set(shorts).size).toBe(3);
    expect(provenanceLabel({ source: "drawn" }).long).toMatch(/hand/i);
    expect(provenanceLabel({ source: "deed" }).long).toMatch(/metes/i);
  });
});

describe("typed field normalization", () => {
  it("stores an empty field as null, never an empty string", () => {
    expect(cleanText("  ")).toBe(null);
    expect(cleanText("")).toBe(null);
    expect(cleanText(null)).toBe(null);
    expect(cleanText("  123 Main St ")).toBe("123 Main St");
  });
  it("reads an acreage, and refuses anything that isn't a positive number", () => {
    expect(parseAcres("12.50")).toBe(12.5);
    expect(parseAcres("12.5 AC")).toBe(12.5);
    expect(parseAcres(12.5)).toBe(12.5);
    expect(parseAcres("0")).toBe(null);    // never 0 — that would read as "the record says zero"
    expect(parseAcres("-3")).toBe(null);
    expect(parseAcres("abc")).toBe(null);
    expect(parseAcres("")).toBe(null);
    expect(parseAcres(null)).toBe(null);
  });
  it("lists the typed fields in panel order", () => {
    expect(PARCEL_FIELDS.map((f) => f.key)).toEqual(["label", "owner", "acct", "addr"]);
  });
});

describe("measured area, net of save-and-except holes", () => {
  it("measures a plain ring", () => {
    expect(parcelNetSqft({ points: ONE_ACRE })).toBeCloseTo(SQFT_PER_ACRE, 0);
    expect(parcelGrossSqft({ points: ONE_ACRE })).toBeCloseTo(SQFT_PER_ACRE, 0);
    expect(parcelExceptSqft({ points: ONE_ACRE })).toBe(0);
  });
  it("deducts the exceptions — a save-and-except tract is not part of the land you own", () => {
    const pc = { points: sq(0, 0, 1000), exceptions: [{ pts: sq(100, 100, 200), label: "Save & except" }] };
    expect(parcelGrossSqft(pc)).toBeCloseTo(1e6, 3);
    expect(parcelExceptSqft(pc)).toBeCloseTo(40000, 3);
    expect(parcelNetSqft(pc)).toBeCloseTo(960000, 3);
  });
  it("accepts bare rings as exceptions and never goes negative", () => {
    expect(parcelNetSqft({ points: sq(0, 0, 100), exceptions: [sq(0, 0, 100)] })).toBe(0);
    expect(parcelNetSqft({ points: sq(0, 0, 100), exceptions: [sq(0, 0, 500)] })).toBe(0);
  });
  it("degenerate input measures zero rather than throwing", () => {
    expect(parcelNetSqft(null)).toBe(0);
    expect(parcelNetSqft({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBe(0);
    expect(parcelExceptSqft({ exceptions: [{ pts: [{ x: 0, y: 0 }] }] })).toBe(0);
  });
});

describe("acreageComparison — stated and measured are both true, and the gap is the point", () => {
  it("reports both, and how far apart they are", () => {
    const c = acreageComparison({ points: ONE_ACRE, statedAcres: 1.05 });
    expect(c.measured).toBeCloseTo(1, 4);
    expect(c.stated).toBe(1.05);
    expect(c.diffFrac).toBeCloseTo(0.0476, 3);
    expect(c.agreement).toBe("close");
  });
  it("bands the agreement the same way the county geometry check does", () => {
    expect(acreageComparison({ points: ONE_ACRE, statedAcres: 1.01 }).agreement).toBe("match");
    expect(acreageComparison({ points: ONE_ACRE, statedAcres: 1.04 }).agreement).toBe("close");
    expect(acreageComparison({ points: ONE_ACRE, statedAcres: 1.5 }).agreement).toBe("off");
  });
  it("nothing to compare → no verdict, never a false match", () => {
    const c = acreageComparison({ points: ONE_ACRE });
    expect(c.stated).toBe(null);
    expect(c.diffFrac).toBe(null);
    expect(c.agreement).toBe(null);
  });
  it("compares against the NET measured area, so an except hole doesn't read as a shortfall", () => {
    const pc = { points: sq(0, 0, 1000), exceptions: [{ pts: sq(100, 100, 200) }], statedAcres: 960000 / SQFT_PER_ACRE };
    expect(acreageComparison(pc).agreement).toBe("match");
  });
});
