import { describe, it, expect } from "vitest";
import { parseFeet } from "../src/workspaces/doc-review/lib/parseLength.js";

describe("parseFeet — manual Calibrate length entry (B300)", () => {
  it("plain decimal feet, with or without a marker", () => {
    expect(parseFeet("120")).toEqual({ ok: true, ft: 120 });
    expect(parseFeet("120.5")).toEqual({ ok: true, ft: 120.5 });
    expect(parseFeet("120'")).toEqual({ ok: true, ft: 120 });
    expect(parseFeet("120 ft")).toEqual({ ok: true, ft: 120 });
    expect(parseFeet("120feet")).toEqual({ ok: true, ft: 120 });
  });

  it("feet-and-inches, including a fractional inch", () => {
    expect(parseFeet("38'").ft).toBe(38);
    expect(parseFeet('7"').ft).toBeCloseTo(7 / 12, 9);
    expect(parseFeet(`38' 7"`).ft).toBeCloseTo(38 + 7 / 12, 9);
    expect(parseFeet(`38'-7"`).ft).toBeCloseTo(38 + 7 / 12, 9);
    expect(parseFeet(`38'-7 3/4"`).ft).toBeCloseTo(38 + (7 + 0.75) / 12, 9);
    expect(parseFeet(`7 3/4"`).ft).toBeCloseTo((7 + 0.75) / 12, 9);
  });

  it("explicit fractional feet (unit required)", () => {
    expect(parseFeet("1/2 ft").ft).toBeCloseTo(0.5, 9);
    expect(parseFeet("12 1/2 ft").ft).toBeCloseTo(12.5, 9);
    expect(parseFeet("3/4'").ft).toBeCloseTo(0.75, 9);
  });

  // The headline bug: parseFloat("1/8")===1 and parseFloat("1:240")===1 silently
  // mis-calibrate. These must be rejected, not coerced.
  it("rejects scale ratios", () => {
    expect(parseFeet("1:240").ok).toBe(false);
    expect(parseFeet("1:240").message).toMatch(/ratio/i);
    expect(parseFeet('1/4"=1\'').ok).toBe(false);
  });

  it("rejects a bare ambiguous fraction (no unit)", () => {
    expect(parseFeet("1/8").ok).toBe(false);
    expect(parseFeet("3/4").ok).toBe(false);
  });

  it("rejects non-numeric / junk / trailing garbage", () => {
    expect(parseFeet("abc").ok).toBe(false);
    expect(parseFeet("120abc").ok).toBe(false);
    expect(parseFeet("120.5.5").ok).toBe(false);
  });

  it("rejects zero, negative, and empty (empty is a silent cancel)", () => {
    expect(parseFeet("0").ok).toBe(false);
    expect(parseFeet("-5").ok).toBe(false);
    expect(parseFeet("")).toEqual({ ok: false, empty: true });
    expect(parseFeet("   ")).toEqual({ ok: false, empty: true });
    expect(parseFeet(null)).toEqual({ ok: false, empty: true });
  });
});
