/* generalFit.js — Excel-style column-width fit for General-format numbers (NEW-1: General format
 * prints full float precision and spills across neighbouring cells).
 *
 * `measure` is the pluggable (text) => width the module takes — these tests use a deterministic
 * one-unit-per-character stand-in (the same "no DOM required" shape textWrap.js's own tests use
 * for `heuristicWidth`) so the ladder logic is provable without a browser. SheetView.jsx wires
 * the real thing to a <canvas> measureText call; that live behavior is proven separately in this
 * PR's own headless-browser pass (see the item's VERIFICATION.md entry), not re-derived here.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { fitGeneralNumber } from "../src/workspaces/model/lib/generalFit.js";

const chars = (s) => s.length; // 1 width unit per character — deterministic, no canvas needed

describe("fitGeneralNumber", () => {
  it("returns full precision untouched when the column is wide enough", () => {
    expect(fitGeneralNumber(1 / 3, 100, chars)).toBe("0.333333333333333");
    expect(fitGeneralNumber(Math.PI, 100, chars)).toBe("3.14159265358979");
  });

  it("=1/3 in a narrowed column reduces DECIMAL PLACES, never the leading digit — matches Excel's own default-width answer", () => {
    // The owner's own worked example: a default-width Excel column shows 0.333333333 (11 chars).
    expect(fitGeneralNumber(1 / 3, 11, chars)).toBe("0.333333333");
  });

  it("=PI() narrows the same way, to the same budget", () => {
    expect(fitGeneralNumber(Math.PI, 11, chars)).toBe("3.141592654"); // rounds the trimmed digit, doesn't truncate it
  });

  it("a real project-data-shaped value (Site.Acres) narrows identically to the formula cases above", () => {
    expect(fitGeneralNumber(9.51430089531681, 11, chars)).toBe("9.514300895");
  });

  it("HOSTILE — a very large number (1E20) has no fractional part to trim, so it goes straight to scientific notation", () => {
    expect(fitGeneralNumber(1e20, 8, chars)).toBe("1E+20");
  });

  it("HOSTILE — a very small number (1/300000) never rounds down to a bare, meaningless 0 — it falls to scientific first", () => {
    const out = fitGeneralNumber(1 / 300000, 6, chars);
    expect(out).not.toBe("0");
    expect(Number(out.replace("E", "e"))).toBeCloseTo(1 / 300000, 6);
  });

  it("HOSTILE — a negative number with many digits narrows the same way, sign included", () => {
    expect(fitGeneralNumber(-123456789.123456, 13, chars)).toBe("-123456789.12");
  });

  it("HOSTILE — nothing legible fits at all: falls back to a column-filling run of '#', never spilling text", () => {
    const out = fitGeneralNumber(123456789.123456, 3, chars);
    expect(out).toBe("###");
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("an already-tiny column still shows at least one '#', never an empty string", () => {
    expect(fitGeneralNumber(123456, 0, chars)).toBe("#");
  });

  it("every fitted candidate actually measures within the given width (never returns something wider than asked)", () => {
    const cases = [1 / 3, Math.PI, 1e20, 1 / 300000, -123456789.123456, 0, 42, -0.5];
    for (const v of cases) {
      for (const width of [3, 6, 8, 11, 20, 100]) {
        const out = fitGeneralNumber(v, width, chars);
        expect(chars(out)).toBeLessThanOrEqual(Math.max(1, width));
      }
    }
  });

  it("round numbers in scientific notation don't carry a fake trailing .0 the value never had", () => {
    // 1e20 is exact; Excel's own scientific General form is the minimal "1E+20", never "1.0E+20".
    expect(fitGeneralNumber(1e20, 20, chars)).toBe("1E+20");
  });

  it("zero always fits and is never mangled", () => {
    expect(fitGeneralNumber(0, 1, chars)).toBe("0");
  });
});

// SheetView.jsx's own render wiring can't be exercised here — the shared vitest config runs a
// pure Node environment (no jsdom, no real flexbox layout: see vitest.config.* for why), and the
// live flex-overflow behaviour is instead proven headless-browser-side for this PR (see the
// item's VERIFICATION.md entry). What CAN be pinned here, cheaply and without a browser, is the
// three source-level facts that made the bug possible and must not silently regress:
describe("SheetView.jsx — General-format cell rendering (source guards)", () => {
  const src = readFileSync("src/workspaces/model/components/SheetView.jsx", "utf8");

  it("the per-cell box pins its own automatic minimum size to 0 — the actual root cause of the spill (a flex item with `flex: 0 0 Wpx` still grows past W to fit un-wrappable nowrap content unless its OWN min-width is pinned, not just its inner span's)", () => {
    expect(src).toMatch(/flex: `0 0 \$\{w\}px`,\s*\n\s*\/\/ NEW-1[\s\S]{0,1200}minWidth: 0,/);
  });

  it("the non-editing render path paints the FITTED text, not the raw display string, so the fit can't silently go dead", () => {
    expect(src).toContain("{shownText}");
    // the spill overlay (long TEXT over empty neighbours) is a deliberately separate, unrelated
    // path — numbers never spill (TEXT_ALIGN/spillCols already gate that on `kind === "text"`).
    expect(src).toMatch(/spillWidth[\s\S]{0,120}>\{cell\.display\}<\/span>/);
  });

  it("the fit only ever engages for General (unformatted) numbers — an explicit numberFormat (Currency, Percent, …) is gated out, never re-rounded by this path", () => {
    expect(src).toMatch(/cell\.kind === "number"[\s\S]{0,40}formatAt\(sheet, r, c\) == null/);
  });
});
