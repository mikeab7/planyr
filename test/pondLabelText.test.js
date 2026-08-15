// NEW-1 — the pond MAP label says the pond's name and its acreage. Nothing else.
//
// Owner, 2026-08-06, verbatim: "the pond label — not just the footprint. And honestly, maybe we
// just get rid of the square feet from the label as well. Get rid of footprint and get rid of
// square feet, leave the acreage."
//
//   was:  Detention Pond / footprint 6.58 AC · 286,648 SF
//   now:  Detention Pond / 6.58 AC
//
// This drives the REAL builder (lib/pondLabelText.js) rather than grepping SitePlanner.jsx for a
// string, so the assertion survives a refactor of the call site. The rendered-DOM proof — on the
// real Goose Creek and Tsakiris geometry, on screen AND on the exported sheet — is
// ui-audit/verify-pond-label-fit.mjs; this is the cheap always-on guard beneath it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pondAreaLabelLine, pondAreaDeltaLine } from "../src/workspaces/site-planner/lib/pondLabelText.js";
import { labelForms } from "../src/workspaces/site-planner/lib/labelFitLadder.js";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("the pond area line is acreage and nothing else", () => {
  it("renders just the acreage — the owner's Tsakiris figure, exactly", () => {
    // 286,648 SF is the real Tsakiris / Concept A pond footprint the owner quoted.
    expect(pondAreaLabelLine(286648)).toBe("6.58 AC");
  });

  it("carries no 'footprint' word and no square-footage figure", () => {
    for (const sf of [1234, 43560, 286648, 1_250_000]) {
      const line = pondAreaLabelLine(sf);
      expect(line).not.toMatch(/footprint/i);
      expect(line).not.toMatch(/\bsf\b/);
      expect(line).toMatch(/^[\d,]+\.\d{2} AC$/);
    }
  });

  it("the expansion increment line got the same trim, signed", () => {
    expect(pondAreaDeltaLine(43560)).toBe("+1.00 AC");
    expect(pondAreaDeltaLine(-21780)).toBe("−0.50 AC");
    for (const d of [43560, -21780]) {
      expect(pondAreaDeltaLine(d)).not.toMatch(/footprint/i);
      expect(pondAreaDeltaLine(d)).not.toMatch(/\bsf\b/);
    }
  });

  it("is a single ATOM, so it hands the fit ladder nothing to reflow", () => {
    // A one-line-per-fact label has only the `inline` form: no stacked rung, no abbrev rung.
    // That is the intended consequence of the trim — the label now FITS instead of reflowing.
    const forms = labelForms(["Detention Pond", pondAreaLabelLine(286648)]);
    expect(forms.map((f) => f.rung)).toEqual(["inline"]);
    expect(forms[0].lines).toEqual(["Detention Pond", "6.58 AC"]);
  });

  it("the trim is a straight reduction — the area line is less than a third of its old width", () => {
    const before = "footprint 6.58 AC · 286,648 SF";   // the shipped line before this change
    const after = pondAreaLabelLine(286648);
    expect(before.length).toBe(30);
    expect(after.length).toBe(7);
    expect(after.length).toBeLessThan(before.length / 3);
  });
});

describe("source guard — both pond call sites use the shared builder, and the panel is untouched", () => {
  it("the map label's two area call sites go through pondAreaLabelLine", () => {
    expect(src).toContain("lines.push(pondAreaLabelLine(area));");
    expect(src).toContain("lines.push(pondAreaLabelLine(exA));");
    // …and no pond map line reconstructs the old wide form.
    expect(src.includes("`footprint ${f2(sf / SQFT_PER_ACRE)} AC`")).toBe(false);
    expect(src.includes("ac footprint`")).toBe(false);
  });

  it("the pond INSPECTOR keeps its own rows — this change is the map label only", () => {
    // Explicitly OUT of scope (owner): the Properties panel still spells the split out in full.
    expect(src).toContain("AC water surface</span>");
    expect(src).toMatch(/Berm ring/);
    expect(src).toMatch(/Land take/);
  });
});
