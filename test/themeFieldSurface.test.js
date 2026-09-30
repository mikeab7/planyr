/* B1998016 — form controls follow the theme (white input + white text in dark mode, Settings > Profile).
 * CI-runnable half of the guard; the browser half is ui-audit/verify-theme-surface-contrast.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const css = readFileSync("src/index.css", "utf8");
const cut = css.indexOf('[data-theme="dark"] {');
const dark = css.slice(cut, cut + 6000);
const light = css.slice(0, cut);
const tok = (block, name) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)[1];
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

describe("theme-aware form controls", () => {
  it("declares color-scheme for both themes", () => {
    expect(/:root\s*\{[^}]*?color-scheme:\s*light/.test(css)).toBe(true);
    expect(/\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark/.test(css)).toBe(true);
  });
  it("--surface-field exists in BOTH theme blocks and text-primary clears 4.5:1 on it", () => {
    for (const [n, blk] of [["light", light], ["dark", dark]]) {
      expect(ratio(tok(blk, "text-primary"), tok(blk, "surface-field")), n).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("has a zero-specificity base fill for text controls", () => {
    expect(/:where\(input:not\(\[type="checkbox"\]\).*, select, textarea\)\s*\{\s*background-color:\s*var\(--surface-field\)/.test(css)).toBe(true);
  });
  it("AuthPanel's field style sets the token background", () => {
    expect(/const field = \{.*background: "var\(--surface-field\)"/.test(readFileSync("src/workspaces/site-planner/components/AuthPanel.jsx", "utf8"))).toBe(true);
  });
  it("no hard-coded white side panels / popovers remain in the Stitcher", () => {
    expect(/background: "#fff"/.test(readFileSync("src/workspaces/doc-review/Stitcher.jsx", "utf8"))).toBe(false);
  });
  it("the browser sweep harness is still in the repo", () => {
    expect(existsSync("ui-audit/verify-theme-surface-contrast.mjs")).toBe(true);
  });
});
