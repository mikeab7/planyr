// v3 UI SPEC Part A — the Yield panel's structure + copy deletions, guarded by source scan
// (the repo's vitest config is DOM-free). The verdict grammar itself is unit-tested in
// test/yieldVerdicts.test.js; this locks in the render wiring.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const at = (needle) => {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`marker not found: ${needle}`);
  return i;
};

describe("A1/A2/A5/A6 — top-to-bottom order", () => {
  it("verdict strip → LAND USE → BUILDINGS → BUILDABILITY render in order", () => {
    const order = [
      'data-testid="yield-verdict-strip"',
      'sectionId="yield-land"',
      'sectionId="yield-buildings"',
      'sectionId="yield-buildability"',
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("the groups carry the v3 titles", () => {
    expect(src).toContain('title="Land use"');
    expect(src).toContain('title="Buildings"');
    expect(src).toContain('title="Buildability"');
    expect(src).toContain('title="Costs"');
  });
});

describe("A5 — LAND USE stacked bar (validated palette) replaces the donut + tiles", () => {
  it("has the four segment fills in spec order", () => {
    const land = src.slice(at('sectionId="yield-land"'), at('sectionId="yield-buildings"'));
    const fills = ["#eda100", "#008300", "#2a78d6", "#eb6834"];
    const idx = fills.map((f) => land.indexOf(f));
    expect(idx.every((i) => i >= 0), "all four fills present").toBe(true);
    expect(idx).toEqual([...idx].sort((a, b) => a - b)); // Buildings, Open space, Pond, Paving
  });

  it("the donut, the KPI tiles, and the standalone Detention rows are gone", () => {
    expect(src.includes('viewBox="0 0 100 100"')).toBe(false); // donut svg
    expect(src.includes('kpi("Site"')).toBe(false);
    expect(src.includes('row("Detention storage"')).toBe(false);
    expect(src.includes('row("Detention %"')).toBe(false);
  });
});

describe("G1/A3 — the provided/required pair renders once (in the strip); the band bar is gone", () => {
  it("RequirementBand and its aria-label pair are removed", () => {
    expect(src.includes("function RequirementBand")).toBe(false);
    expect(src.includes("<RequirementBand")).toBe(false);
    // the old aria-label restated the pair ("provided X of Y ac-ft") — gone
    expect(src.includes("provided ${fmtAcFt(provided)} of ${fmtAcFt(required)} ac-ft")).toBe(false);
  });
});

describe("G8 — the button reads ⚡ Optimize pond, never ⚡ Design pond (visible labels)", () => {
  it("no visible '⚡ Design pond' button label remains", () => {
    // Comments may still reference the old name; the rendered button label must be Optimize.
    expect(src.includes(">\n                ⚡ Design pond\n")).toBe(false);
    expect(src).toContain("⚡ Optimize pond");
  });
});

describe("A9 — footer legend (Yield panel only)", () => {
  it("carries the four provenance tag definitions", () => {
    for (const def of ["measured from your drawing", "adopted criteria", "estimated", "your input"]) {
      expect(src, def).toContain(def);
    }
  });
});
