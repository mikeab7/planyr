// B1064 step 1 — the Yield / Drainage panels and NumInput are importable modules now (they were private to the 36k-line
// SitePlanner.jsx), so the empty / default states can be rendered to a string in plain Node — the same pattern 40+ suites use.
// What this proves: the module loads with no planner state, a panel with nothing computed yet renders its honest empty
// state (never a throw, never a naked number), and the render is a pure function of its props. The byte-for-byte comparison
// against the live app lives in ui-audit/capture-plan-html.mjs; this is the always-on, browser-free half.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DrainagePanel, ProvenanceLegend, CostDisclosure } from "../src/workspaces/site-planner/components/YieldDrainagePanels.jsx";
import { NumInput } from "../src/workspaces/site-planner/components/NumInput.jsx";

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const emptyDrainage = () => renderToStaticMarkup(createElement(DrainagePanel, {
  drainage: null, heat: { available: false }, onMitOpenChange() {}, floodExposure: null, siteId: null, siteState: null, headerSlot: null,
}));

describe("DrainagePanel — nothing computed yet", () => {
  it("renders its testid, the buildings-in-floodplain row, and no number it has no rule record for", () => {
    const html = emptyDrainage();
    expect(html).toContain('data-testid="drainage-panel"');
    expect(html).toContain('data-flat-panel="1"');
    expect(text(html)).toContain("Buildings in the floodplain");
    // RULES-AS-DATA: with no drainage context there is no detention verdict, requirement or margin to print.
    expect(text(html)).not.toMatch(/AC-FT/i);
    expect(text(html)).not.toMatch(/SHORT|COVERED/);
  });

  it("is a pure function of its props — two renders of the same props are byte-identical", () => {
    expect(emptyDrainage()).toBe(emptyDrainage());
  });
});

describe("ProvenanceLegend — the one definition of the five source tags", () => {
  it("names PLAN / CODE / EST / YOU / SURVEY with their plain-language meanings", () => {
    const t = text(renderToStaticMarkup(createElement(ProvenanceLegend, {})));
    for (const [tag, meaning] of [["PLAN", "measured from your drawing"], ["CODE", "adopted criteria"], ["EST", "estimated"], ["YOU", "your input"], ["SURVEY", "from terrain data"]]) {
      expect(t, tag).toContain(tag);
      expect(t, tag).toContain(meaning);
    }
  });
});

describe("CostDisclosure — a closed disclosure shows its label and hides its body", () => {
  it("renders the label and not the children until opened", () => {
    const t = text(renderToStaticMarkup(createElement(CostDisclosure, { label: "Earthwork cost", summary: null }, createElement("span", null, "UNIT-PRICE-INPUTS"))));
    expect(t).toContain("Earthwork cost");
    expect(t).not.toContain("UNIT-PRICE-INPUTS");
  });
});

describe("NumInput — the edit-on-commit field", () => {
  it("shows the committed value in a decimal-keyboard input named for screen readers", () => {
    const html = renderToStaticMarkup(createElement(NumInput, { value: 12.5, onCommit() {}, ariaLabel: "Width" }));
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('aria-label="Width"');
    expect(html).toContain('value="12.5"');
  });
});
