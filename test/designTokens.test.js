import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTROL_H, FONT_SIZE, SPACE } from "../src/shared/ui/designTokens.js";

// B809906 — the spacing/type/control-height scales are additive siblings of radius.js's RADIUS
// (which already is the single source of truth for corner radii, B427411). Locks the audited
// values in place and keeps the CSS mirror in index.css from drifting out of step with the JS —
// same "two representations of one fact must agree" shape as palette.js vs index.css's color vars.

describe("designTokens — the values are the audited modal values, not invented", () => {
  it("CONTROL_H has the three real height tiers found on <button> elements", () => {
    expect(CONTROL_H).toEqual({ sm: 22, md: 26, lg: 30 });
  });

  it("FONT_SIZE covers the button font-size ladder, ascending", () => {
    const keys = Object.keys(FONT_SIZE);
    const values = Object.values(FONT_SIZE);
    expect(values).toEqual([10, 10.5, 11, 11.5, 12, 12.5, 13, 14]);
    expect(values.every((v, i) => i === 0 || v > values[i - 1])).toBe(true);
    expect(keys.length).toBe(8);
  });

  it("SPACE is a conventional ascending scale rooted at the app's own common padding numbers", () => {
    const values = Object.values(SPACE);
    expect(values).toEqual([2, 4, 6, 8, 10, 12, 16]);
    expect(values.every((v, i) => i === 0 || v > values[i - 1])).toBe(true);
  });
});

describe("designTokens — the CSS mirror in index.css agrees with the JS, token for token", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/index.css", import.meta.url)), "utf8");
  const cssVar = (name) => {
    const m = css.match(new RegExp(`--${name}:\\s*([\\d.]+)px;`));
    return m ? parseFloat(m[1]) : null;
  };

  it("every SPACE step has a matching --space-* var of the same value", () => {
    for (const [key, val] of Object.entries(SPACE)) {
      expect(cssVar(`space-${key}`), `--space-${key}`).toBe(val);
    }
  });

  it("every FONT_SIZE step has a matching --font-* var of the same value", () => {
    for (const [key, val] of Object.entries(FONT_SIZE)) {
      expect(cssVar(`font-${key}`), `--font-${key}`).toBe(val);
    }
  });

  it("every CONTROL_H step has a matching --control-h-* var of the same value", () => {
    for (const [key, val] of Object.entries(CONTROL_H)) {
      expect(cssVar(`control-h-${key}`), `--control-h-${key}`).toBe(val);
    }
  });
});
