import { describe, it, expect } from "vitest";
import { formatShortDate, daysUntil } from "../src/workspaces/dashboard/lib/dashboardDates.js";

describe("formatShortDate", () => {
  it("formats a plain YYYY-MM-DD date without a timezone shift", () => {
    expect(formatShortDate("2026-09-10")).toBe(new Date(2026, 8, 10).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  });
  it("returns null for empty/unparseable input", () => {
    expect(formatShortDate(null)).toBe(null);
    expect(formatShortDate("")).toBe(null);
    expect(formatShortDate("not a date")).toBe(null);
  });
});

describe("daysUntil", () => {
  it("counts whole calendar days from now to a future date", () => {
    const now = new Date(2026, 8, 1, 15, 30).getTime(); // Sep 1, mid-afternoon
    expect(daysUntil("2026-09-08", now)).toBe(7);
  });
  it("returns a negative count for a past date", () => {
    const now = new Date(2026, 8, 10).getTime();
    expect(daysUntil("2026-09-01", now)).toBe(-9);
  });
  it("returns null for empty/unparseable input", () => {
    expect(daysUntil(null)).toBe(null);
    expect(daysUntil("nope")).toBe(null);
  });
});
