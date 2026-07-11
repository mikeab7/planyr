import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* Anti-drift guards for the B760–B762 Layers-panel overhaul. These config files are edited
 * by many concurrent sessions; a string-level check fails loudly if a merge silently reverts
 * the de-text / merged-toggle / county-fold wiring. (The rendered-DOM behaviour is covered by
 * ui-audit/layerpanel-verify.mjs + test/layerPanelInfo.test.js; these pin the source config the
 * live map paint depends on — the dashed-ETJ style, the merge keys, the fold relabel.) */
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("B761 — merged City-limits-&-ETJ config (solid limits / dashed same-hue ETJ)", () => {
  const layers = read("../src/workspaces/site-planner/lib/layers.js");
  const overlay = read("../src/workspaces/site-planner/lib/vectorOverlay.js");

  it("jur_city is the merge primary with the composite label", () => {
    expect(layers).toMatch(/mergeWith: "jur_etj"/);
    expect(layers).toMatch(/mergeLabel: "City limits & ETJ"/);
  });

  it("jur_etj is the SAME hue as city and dashed", () => {
    // both hues are the city blue; ETJ is distinguished by dash, not color.
    expect((layers.match(/#1d4ed8/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(layers).toMatch(/jur_etj:[\s\S]*?dash: true/);
  });

  it("the boundary renderer emits dashArray when cfg.dash is set", () => {
    expect(overlay).toMatch(/cfg\.dash \? \{ dashArray:/);
  });
});

describe("B762 — Fort Bend single-layer county folds into Basemap", () => {
  it("fb_contours is relabeled for its new home under the USGS contour row", () => {
    const counties = read("../src/workspaces/site-planner/lib/counties.js");
    expect(counties).toMatch(/label: "1-ft contours \(Fort Bend DD\)"/);
  });
  it("the panel folds a single-layer county and gates its own group on ≥2 layers", () => {
    const panel = read("../src/workspaces/site-planner/components/LayerPanel.jsx");
    expect(panel).toMatch(/Object\.keys\(jur\.layers \|\| \{\}\)\.length === 1/); // fold rule
    expect(panel).toMatch(/Object\.keys\(jur\.layers \|\| \{\}\)\.length >= 2/);  // ≥2 → own group
  });
});

describe("B760 — the group disclaimer paragraphs are gone, one footer remains", () => {
  const panel = read("../src/workspaces/site-planner/components/LayerPanel.jsx");
  it("no per-group screening paragraphs survive as visible text", () => {
    expect(panel).not.toMatch(/has jurisdiction/);                     // the Jurisdictions paragraph
    expect(panel).not.toMatch(/Field evidence for screening/);
    expect(panel).not.toMatch(/Local agency layers for this county/);
    expect(panel).not.toMatch(/verify with the issuing agency/);
    expect(panel).not.toMatch(/const groupNote =/);                    // the paragraph style is retired
  });
  it("exactly one screening footer", () => {
    expect((panel.match(/Screening data — verify before relying on it\./g) || []).length).toBe(1);
  });
});
