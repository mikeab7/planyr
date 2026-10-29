/* CHARACTERIZATION of src/shared/units/numberFormat.js (NEW-1 refactor).
 *
 * The 28 private f0/f1/f2 formatters were moved into one module WITHOUT unifying their three styles
 * (comma / plain / en-US pinned) — a user-visible change is a separate decision. This file is the
 * proof of "no output changed": every OLD body is copied below VERBATIM (as it stood on main at
 * d0c93cd), fed the same inputs as the new export, and the two must agree to the character — for
 * a number, a non-number and a throw alike.
 *
 * Run under the platform locale AND under a comma-decimal locale (de-DE), because four of the
 * old bodies read the browser locale and four pin en-US, and a refactor that quietly swapped one
 * for the other would be invisible under en-US alone. de-DE is simulated by making a locale-less
 * `toLocaleString()` behave as if the browser's language were German; the pinned "en-US" calls are
 * left alone, which is exactly how a real German browser treats them.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as nf from "../src/shared/units/numberFormat.js";

const OLD = {
  // shared/markup/measure.js · doc-review/Stitcher.jsx · SitePlanner.jsx · DocReview.jsx · trailerRows.js · pondChangeSummary.js · measureLabel.fmtInt
  commaInt: (n) => Math.round(n).toLocaleString(),
  commaDec1: (n) => (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  // …and measureLabel.fmt2 · pondLabelText.js
  commaDec2: (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  // areaUnits.js `int` / `two`
  commaIntOrZero: (n) => Math.round(Number(n) || 0).toLocaleString(),
  commaDec2OrZero: (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  // pondVerdict.js · ledgerBalancer.js
  usInt: (n) => Math.round(n).toLocaleString("en-US"),
  // GradingController · GradingPanels · pondVerdict · buildingGrade · ffeSuggest · tailwaterSource · pondChangeSummary · pondScreeningGuards · groundReadout · ledgerBalancer · pondSectionModel
  plainDec1: (v) => (Math.round(v * 10) / 10).toFixed(1),
  // pondChangeSummary · ledgerBalancer · proposedSurface
  plainDec2: (n) => (Math.round(n * 100) / 100).toFixed(2),
  // ffeBalance.js (inner)
  fixedDec1: (v) => v.toFixed(1),
  // RoadCrossSectionDialog.jsx
  trimInt: (n) => (Number.isFinite(n) ? Math.round(n).toString() : "—"),
  trimDec1: (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : "—"),
};

const INPUTS = [0, 0.05, 999.95, 1234.5, 5280.55, -3.25, NaN, Infinity, undefined, null, 1.45, 1234567.891, "12.5", 1e21];

const run = (fn, x) => { try { return String(fn(x)); } catch (e) { return `THROWS ${e.constructor.name}`; } };

const realToLocale = Number.prototype.toLocaleString;
afterEach(() => { Number.prototype.toLocaleString = realToLocale; });
function pretendBrowserLocale(tag) {
  Number.prototype.toLocaleString = function (locales, opts) { return realToLocale.call(this, locales === undefined ? tag : locales, opts); };
}

describe("every moved formatter prints exactly what the private copy printed", () => {
  for (const [label, setup] of [["platform locale", () => {}], ["comma-decimal browser (de-DE)", () => pretendBrowserLocale("de-DE")]]) {
    it(`under ${label}`, () => {
      setup();
      const diffs = [];
      for (const name of Object.keys(OLD)) {
        expect(typeof nf[name], `numberFormat.js must export ${name}`).toBe("function");
        for (const x of INPUTS) {
          const a = run(OLD[name], x), b = run(nf[name], x);
          if (a !== b) diffs.push(`${name}(${String(x)}): old ${a} ≠ new ${b}`);
        }
      }
      expect(diffs).toEqual([]);
    });
  }

  it("the module exports exactly the characterized set (a new variant needs a verbatim old body here)", () => {
    expect(Object.keys(nf).sort()).toEqual(Object.keys(OLD).sort());
  });

  it("the three styles still differ where they always did (no accidental unification)", () => {
    expect(nf.commaInt(1234.5)).toBe((1235).toLocaleString());
    expect(nf.plainDec1(1234.5)).toBe("1234.5");
    expect(nf.commaDec2OrZero(NaN)).toBe(OLD.commaDec2OrZero(0));
    expect(nf.usInt(1234567)).toBe("1,234,567");
    expect(nf.trimDec1(12)).toBe("12");
    expect(nf.trimDec1(NaN)).toBe("—");
    expect(nf.fixedDec1(1.45)).not.toBe(nf.plainDec1(1.45));
  });

  it("pinned en-US stays pinned under a German browser; the others follow the browser", () => {
    pretendBrowserLocale("de-DE");
    expect(nf.usInt(1234567)).toBe("1,234,567");
    expect(nf.commaInt(1234567)).toBe(realToLocale.call(1234567, "de-DE"));
  });
});
