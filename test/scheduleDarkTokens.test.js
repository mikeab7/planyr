// source-scan: reads the Schedule page's :root token blocks (the page is a standalone HTML file that cannot run in node).
/* Audit batch J2 — the Schedule follows the app theme. Its text/surface token pairs must clear WCAG AA (4.5:1) in BOTH themes,
   and the dark values must equal the app's own dark tokens in src/index.css (the page copies them: an iframe has no access to
   the parent's CSS variables), so the two cannot drift apart. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { sequencePageSource } from "./helpers/sequenceSource.js";
const page = sequencePageSource();
const appCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

const block = (src, re) => {
  const m = src.match(re);
  if (!m) throw new Error("block not found: " + re);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((x) => [x[1], x[2]]));
};
const light = block(page, /\n:root \{([^}]*)\}/);
const dark = block(page, /:root\[data-theme="dark"\] \{([^}]*)\}/);
const appDark = block(appCss, /\[data-theme="dark"\] \{([\s\S]*?)\n\}/);

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("Schedule theme tokens", () => {
  for (const [name, t] of [["light", light], ["dark", dark]]) {
    for (const [fg, bgs] of [["txt", ["bg", "surf"]], ["mut", ["bg", "surf"]], ["amber", ["bg"]], ["blue", ["bg"]]]) {
      for (const bg of bgs) {
        it(`${name}: --${fg} on --${bg} is at least 4.5:1`, () => {
          expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
  it("the dark surfaces and text are the app's own dark tokens", () => {
    expect(dark.bg.toLowerCase()).toBe(appDark["surface-raised"].toLowerCase());
    expect(dark.surf.toLowerCase()).toBe(appDark["surface-field"].toLowerCase());
    expect(dark.bd.toLowerCase()).toBe(appDark["border-default"].toLowerCase());
    expect(dark.bd2.toLowerCase()).toBe(appDark["border-strong"].toLowerCase());
    expect(dark.txt.toLowerCase()).toBe(appDark["text-primary"].toLowerCase());
    expect(dark.mut.toLowerCase()).toBe(appDark["text-tertiary"].toLowerCase());
  });
  it("the shell sends planar:theme and the page listens for it", () => {
    const shell = readFileSync(new URL("../src/workspaces/scheduler/Scheduler.jsx", import.meta.url), "utf8");
    expect(shell).toContain('type: "planar:theme"');
    expect(readFileSync(new URL("../public/sequence/boot.js", import.meta.url), "utf8")).toContain('m.type!=="planar:theme"');
  });
});

describe("Schedule confirmations (audit batch J3)", () => {
  it("the page asks through askConfirm, never the browser's native confirm / alert box", () => {
    const code = page.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/window\.confirm\(/);
    expect(code).not.toMatch(/(^|[^.\w])alert\(/m);
    expect(code).toContain("const askConfirm");
  });
});
