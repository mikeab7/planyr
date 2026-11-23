import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { VENDOR_COPIES, fontFilesOf } from "../scripts/vendor-sequence.mjs";

const rd = (p) => readFileSync(new URL(`../${p}`, import.meta.url));
const html = rd("public/sequence/index.html").toString("utf8");

describe("Schedule page vendors its third-party files (audit batch A)", () => {
  for (const [from, to] of VENDOR_COPIES) {
    it(`${to} is byte-identical to the pinned ${from}`, () => {
      expect(rd(to).equals(rd(from))).toBe(true);
    });
  }
  it("every font the vendored tabler stylesheet names is vendored", () => {
    const css = rd("public/sequence/vendor/tabler/tabler-icons.min.css").toString("utf8");
    const fonts = fontFilesOf(css);
    expect(fonts.length).toBeGreaterThan(10);
    for (const f of fonts) expect(existsSync(new URL(`../public/sequence/vendor/tabler/fonts/${f}`, import.meta.url)), f).toBe(true);
  });
  it("the page loads supabase-js and the icon font from /sequence/vendor/, never an unpinned CDN", () => {
    expect(html).toContain('href="/sequence/vendor/tabler/tabler-icons.min.css"');
    expect(html).toContain('src="/sequence/vendor/supabase.js"');
    expect(html).not.toMatch(/jsdelivr\.net\/npm\/@(supabase|tabler)/);
  });
  it("the tabler icon font is pinned exactly in package.json", () => {
    const pkg = JSON.parse(rd("package.json").toString("utf8"));
    expect(pkg.devDependencies["@tabler/icons-webfont"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
