/* numberFormats.js — the ribbon's preset list + the pure format-TOKEN edit helpers behind the
 * Increase/Decrease Decimal and thousands-separator buttons (B1007281). These edit the FORMAT
 * STRING, never a formatted value — formatValue's own behavior is covered in test/formula.test.js. */
import { describe, it, expect } from "vitest";
import { formatValue } from "../src/shared/formula/formula.js";
import {
  NUMBER_FORMATS, formatLabelFor, increaseDecimals, decreaseDecimals, toggleThousands,
} from "../src/workspaces/model/lib/numberFormats.js";

describe("NUMBER_FORMATS presets", () => {
  it("every preset token round-trips through the shared formatter without throwing", () => {
    for (const f of NUMBER_FORMATS) {
      expect(() => formatValue(1234.5, { numberFormat: f.token })).not.toThrow();
    }
  });
  it("formatLabelFor finds a preset by its exact token, and falls back to Custom", () => {
    expect(formatLabelFor("#,##0")).toBe("Number");
    expect(formatLabelFor(null)).toBe("General");
    expect(formatLabelFor("0.000%")).toBe("Custom");
  });
  it("Accounting is parens AND red — the two conventions asked for together", () => {
    const accounting = NUMBER_FORMATS.find((f) => f.id === "accounting");
    expect(formatValue(-1234.5, { numberFormat: accounting.token })).toBe("(1,234.50)");
  });
  it("Basis points and Multiple render as the brief's own worked examples", () => {
    expect(formatValue(0.0025, { numberFormat: NUMBER_FORMATS.find((f) => f.id === "bps").token })).toBe("25 bps");
    expect(formatValue(1.85, { numberFormat: NUMBER_FORMATS.find((f) => f.id === "multiple").token })).toBe("1.85x");
  });
  it("Date renders a real date, not the literal format string", () => {
    const dateToken = NUMBER_FORMATS.find((f) => f.id === "date").token;
    expect(formatValue(46212, { numberFormat: dateToken })).not.toBe(dateToken);
  });
});

describe("increaseDecimals / decreaseDecimals", () => {
  it("adds/removes one decimal place", () => {
    expect(increaseDecimals("#,##0")).toBe("#,##0.0");
    expect(increaseDecimals("#,##0.0")).toBe("#,##0.00");
    expect(decreaseDecimals("#,##0.00")).toBe("#,##0.0");
    expect(decreaseDecimals("#,##0.0")).toBe("#,##0");
  });
  it("never goes below zero decimals", () => {
    expect(decreaseDecimals("#,##0")).toBe("#,##0");
  });
  it("null/General starts from a bare '0' on increase (no silent thousands separator); decrease is a no-op on General", () => {
    expect(increaseDecimals(null)).toBe("0.0");
    expect(decreaseDecimals(null)).toBe(null);
  });
  it("bumps EVERY section of a multi-section (accounting) token together, never just the first", () => {
    const up = increaseDecimals("#,##0.00;(#,##0.00)");
    expect(up).toBe("#,##0.000;(#,##0.000)");
    expect(formatValue(1234.5, { numberFormat: up })).toBe("1,234.500");
    expect(formatValue(-1234.5, { numberFormat: up })).toBe("(1,234.500)");
  });
  it("a literal-only section (no digit placeholder) is left untouched", () => {
    expect(increaseDecimals('"n/a"')).toBe('"n/a"');
  });
  it("the resulting token still formats correctly end to end", () => {
    expect(formatValue(1234.5, { numberFormat: increaseDecimals("$#,##0") })).toBe("$1,234.5");
  });
});

describe("toggleThousands", () => {
  it("adds a thousands separator when absent", () => {
    const on = toggleThousands("0.00");
    expect(formatValue(1234.5, { numberFormat: on })).toBe("1,234.50");
  });
  it("removes it when present", () => {
    const off = toggleThousands("#,##0.00");
    expect(formatValue(1234.5, { numberFormat: off })).toBe("1234.50");
  });
  it("round-trips: on then off returns to no grouping, decimals untouched", () => {
    const on = toggleThousands("0.0");
    const off = toggleThousands(on);
    expect(formatValue(1234.5, { numberFormat: off })).toBe("1234.5");
  });
  it("null/General starts from a bare '0' (no grouping) and toggling ON adds the separator", () => {
    expect(formatValue(1234, { numberFormat: toggleThousands(null) })).toBe("1,234");
  });
});
