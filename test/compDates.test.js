import { describe, it, expect } from "vitest";
import { parseTypedDate, formatDateDisplay } from "../src/shared/comps/lib/compDates.js";

describe("compDates: parseTypedDate — flexible input, canonical ISO out", () => {
  it("accepts ISO", () => {
    expect(parseTypedDate("2027-06-01")).toBe("2027-06-01");
  });
  it("accepts slash-numeric, month-first, 2- or 4-digit year", () => {
    expect(parseTypedDate("6/1/27")).toBe("2027-06-01");
    expect(parseTypedDate("06/01/2027")).toBe("2027-06-01");
  });
  it("accepts dash-numeric", () => {
    expect(parseTypedDate("6-1-27")).toBe("2027-06-01");
  });
  it("accepts a month name in several punctuations", () => {
    expect(parseTypedDate("June 1, 2027")).toBe("2027-06-01");
    expect(parseTypedDate("June 1 2027")).toBe("2027-06-01");
    expect(parseTypedDate("Jun-1-27")).toBe("2027-06-01");
    expect(parseTypedDate("Jun 1 27")).toBe("2027-06-01");
  });
  it("2-digit years pivot at 50, matching compParse.js's findDateToken", () => {
    expect(parseTypedDate("1/1/49")).toBe("2049-01-01");
    expect(parseTypedDate("1/1/51")).toBe("1951-01-01");
  });
  it("rejects a calendar-impossible day rather than silently storing it", () => {
    expect(parseTypedDate("2/31/2027")).toBeNull();
    expect(parseTypedDate("Feb 30 2027")).toBeNull();
  });
  it("returns null for garbage or empty input — never guesses", () => {
    expect(parseTypedDate("")).toBeNull();
    expect(parseTypedDate("   ")).toBeNull();
    expect(parseTypedDate("not a date")).toBeNull();
    expect(parseTypedDate(null)).toBeNull();
    expect(parseTypedDate(undefined)).toBeNull();
  });
});

describe("compDates: formatDateDisplay — ISO -> mm/dd/yy", () => {
  it("formats a real ISO date", () => {
    expect(formatDateDisplay("2027-06-01")).toBe("06/01/27");
    expect(formatDateDisplay("2026-01-01")).toBe("01/01/26");
  });
  it("pads single-digit month/day", () => {
    expect(formatDateDisplay("2026-3-5")).toBe("03/05/26");
  });
  it("empty/null renders as empty string, never a fabricated date", () => {
    expect(formatDateDisplay(null)).toBe("");
    expect(formatDateDisplay("")).toBe("");
    expect(formatDateDisplay(undefined)).toBe("");
  });
});

describe("compDates: round-trip — an unedited display value re-parses to the identical ISO", () => {
  it("mm/dd/yy shown at rest parses back to the same ISO it came from", () => {
    const isos = ["2027-06-01", "2026-01-01", "2026-12-31", "2030-02-28"];
    for (const iso of isos) {
      expect(parseTypedDate(formatDateDisplay(iso))).toBe(iso);
    }
  });
});
