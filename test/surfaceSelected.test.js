/* B1873392 — selected/active rows use the theme token, never a literal light fill, and
 * text-primary clears WCAG AA (4.5:1) on it in BOTH themes. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/index.css", "utf8");
const tok = (block, name) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)[1];
const dark = css.slice(css.indexOf('[data-theme="dark"] {'));
const light = css.slice(0, css.indexOf('[data-theme="dark"] {'));
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

describe("--surface-selected", () => {
  for (const [name, blk] of [["light", light], ["dark", dark]]) {
    it(`${name}: text-primary on selected row >= 4.5:1`, () => {
      const r = ratio(tok(blk, "text-primary"), tok(blk, "surface-selected"));
      console.log(`${name} contrast`, r.toFixed(2));
      expect(r).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("no selected-row background is the literal cream hex", () => {
    for (const f of ["src/workspaces/site-planner/MapFinder.jsx", "src/workspaces/doc-review/DocReview.jsx"]) {
      expect(readFileSync(f, "utf8").includes('? "#fbf3ee"'), f).toBe(false);
    }
  });
});
