/* Audit M2: money, acres and short-date formatters moved to shared/units with their bodies untouched.
 * Each is pinned against a verbatim copy of the body the call site carried before. */
import { describe, it, expect } from "vitest";
import { usdWhole, usdFixed, usdUpTo2, acresTwoOrBlank, acresTiered } from "../src/shared/units/numberFormat.js";
import { shortMonthDay, shortDateWithYear } from "../src/shared/units/dateFormat.js";

const oldWhole = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const oldFixed = (n, maxFrac = 0) => `$${n.toLocaleString("en-US", { minimumFractionDigits: maxFrac, maximumFractionDigits: maxFrac })}`;
const oldUpTo2 = (n) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const oldAc2 = (a) => (Number.isFinite(a) ? `${a.toFixed(2)} AC` : "");
const oldAcT = (a) => (a < 0.1 ? "<0.1 AC" : `${a < 10 ? a.toFixed(1) : Math.round(a)} AC`);
const oldShort = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const oldWithYear = (s) => {
  try { return s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""; } catch (_) { return ""; }
};

const nums = [0, 0.04, 0.1, 0.5, 9.94, 10, 12.345, 120.5, 999, 1234.5, 1234567.891];
describe("money and acres", () => {
  it("usdWhole", () => nums.forEach((n) => expect(usdWhole(n)).toBe(oldWhole(n))));
  it("usdFixed", () => nums.forEach((n) => { expect(usdFixed(n)).toBe(oldFixed(n)); expect(usdFixed(n, 2)).toBe(oldFixed(n, 2)); }));
  it("usdUpTo2", () => [...nums, "7.5", "3"].forEach((n) => expect(usdUpTo2(n)).toBe(oldUpTo2(n))));
  it("acresTwoOrBlank", () => [...nums, NaN, Infinity, undefined].forEach((n) => expect(acresTwoOrBlank(n)).toBe(oldAc2(n))));
  it("acresTiered", () => nums.forEach((n) => expect(acresTiered(n)).toBe(oldAcT(n))));
});
describe("short dates", () => {
  const stamps = ["2026-11-24T03:00:00Z", "2025-01-02", 1700000000000, new Date(2024, 5, 9).getTime()];
  it("shortMonthDay matches the toLocaleDateString body", () => stamps.forEach((t) => expect(shortMonthDay(t)).toBe(oldShort(t))));
  it("shortDateWithYear", () => [...stamps, "", null, undefined, "not a date"].forEach((s) => expect(shortDateWithYear(s)).toBe(oldWithYear(s))));
});
