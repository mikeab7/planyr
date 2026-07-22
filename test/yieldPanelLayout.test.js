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

// ── Follow-up punch list (live-verification fixes) ──────────────────────────────────
describe("punch 1 — the steady-state freshness clock + standalone Re-check pill are gone", () => {
  it("the deleted clock render templates are gone (only the header 'Flood data … ago' remains)", () => {
    expect(src.includes("remembered from your last check")).toBe(false);
    expect(src.includes('"Checked this session"')).toBe(false);
    expect(src.includes("As of ${checkedOnDate}")).toBe(false);
    expect(src.includes("As of ${label}")).toBe(false);
  });
});

describe("punch 2 — the verdict sentence never ellipsizes; the strip carries no ⚡ button", () => {
  const strip = src.slice(at("the VERDICT STRIP"), at("DETENTION DETAIL (open)"));
  it("the sentence span has no textOverflow ellipsis", () => {
    expect(strip.includes("yield-verdict-sentence")).toBe(true);
    expect(strip.includes('textOverflow: "ellipsis"')).toBe(false);
  });
  it("no Optimize-pond button wiring inside the strip block", () => {
    // The comment explains the button lives in DETENTION DETAIL; the WIRING must be absent here.
    expect(strip.includes("onClick={drainage.onDesignPond}")).toBe(false);
    expect(strip.includes("<button")).toBe(false);
  });
});

describe("punch 4 — DETENTION DETAIL: prior detail folds into Assumptions & method; visible = per-pond + explainer + basis", () => {
  it("the det groupFold passes detR as opts.method and the visible body is the spec's items", () => {
    expect(src).toContain('groupFold("det", "Detention detail"');
    expect(src).toContain("method: detR");
    expect(src).toContain("Requirement basis");
    expect(src).toContain("ac-ft counts");
    expect(src).toContain("so none counts yet. Raising the rim fixes this.");
  });
});

describe("punch 5 — the cited em dashes are swept to colons / middots", () => {
  it("SitePlanner strings", () => {
    expect(src).toContain("for this county: verify with the county engineer");
    expect(src.includes("for this county — verify")).toBe(false);
    expect(src).toContain("Zone A with no published BFE: the governing");
    expect(src).toContain("Rate-control district: the volume above");
    // the two rendered reviewing-agency <option> labels now use a middot (comments elsewhere
    // may still document the old "Auto — detected" wording, so scope to the rendered forms).
    expect(src).toContain('Auto{ac.detectedLabel ? ` · detected: ');
    expect(src).toContain('Auto · detected: {(fm.rules');
    expect(src.includes('">Auto — detected:')).toBe(false);
  });
  it("the BKDD overlay data string (detentionRules.js)", () => {
    const rules = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/lib/detentionRules.js", import.meta.url)), "utf8");
    expect(rules).toContain("in Brookshire–Katy DD: rate-control detention");
    expect(rules.includes("Brookshire–Katy DD — rate-control")).toBe(false);
  });
});

describe("punch 6/7/8 — group summaries", () => {
  it("BUILDINGS is '{n} · {sf} sf'; COSTS is 'not priced yet' when unpriced; BUILDABILITY is gated", () => {
    expect(src).toContain("${buildingCount || 0} · ${f0(bldg)} sf");
    expect(src).toContain('"not priced yet"');
    expect(src.includes('summary="road + earthwork"')).toBe(false);
    // the BUILDABILITY group renders only when it has FFE detail
    expect(src).toContain("drainageBlocks.ffeR.length > 0");
  });
});
