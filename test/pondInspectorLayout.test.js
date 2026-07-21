// FINAL UI SPEC Part A — the pond inspector's new top-to-bottom structure and the copy
// deletions, guarded by source scan (the repo's vitest config is DOM-free). Order is checked
// by the position of stable render markers in SitePlanner.jsx.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const at = (needle) => {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`marker not found: ${needle}`);
  return i;
};

describe("A1 — inspector section order (top → bottom)", () => {
  it("At-a-glance → chips → the four groups render in the fixed order", () => {
    const order = [
      "{g_atAGlance}",
      "{g_chipRow}",
      'sectionId="pond-sizing"',
      'sectionId="pond-outlet"',
      'sectionId="pond-flood"',
      'sectionId="pond-appearance"',
    ].map(at);
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
  });

  it("the four groups carry exactly the spec titles", () => {
    expect(src).toContain('title="Sizing & criteria"');
    expect(src).toContain('title="Outlet & storms"');
    expect(src).toContain('title="Flood & datum notes"');
    expect(src).toContain('title="Appearance"');
  });

  it("the at-a-glance rows carry the spec labels", () => {
    for (const label of ["Water footprint", "Land take (incl. berm)", "Rim (top of bank)", "Holds", "At a glance"]) {
      expect(src, label).toContain(label);
    }
  });

  it("status cards + design-change card remain above the at-a-glance", () => {
    expect(at("statusLines.length > 0")).toBeLessThan(at("{g_atAGlance}"));
    expect(at("<DesignChangeSummaryCard")).toBeLessThan(at("{g_atAGlance}"));
  });
});

describe("A2 — deleted visible sentences are gone (content preserved only inside ⓘ popovers)", () => {
  const goneEntirely = [
    "Cut outside or above the trigger floodplain earns no screening mitigation credit",
    "Solved off the ESTIMATED water surface (grade @ Zone A boundary) — never off gross.",
    "Targets = the site requirement minus what the OTHER ponds already provide",
    "Pond land take incl. the ", // the old inline land-take sentence (at-a-glance ⓘ says "includes the")
    'mitigation ${assist.mitigation.covered ? "covered ✓"', // the redundant assistant status line
  ];
  for (const s of goneEntirely) {
    it(`removed: ${s.slice(0, 48)}…`, () => {
      expect(src.includes(s)).toBe(false);
    });
  }

  it("the pond's inline geometry paragraph is suppressed (moved to the header ⓘ)", () => {
    // The generic polygon paragraph still exists for non-ponds, but ponds short-circuit to null.
    expect(src).toContain('selEl.type === "pond" ? null : (');
  });
});
