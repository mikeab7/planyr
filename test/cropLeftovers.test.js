// B2066224–B2066227 — source guards for the crop-tool leftovers. The behaviour itself is walked in a real
// browser by ui-audit/verify-crop-leftovers.mjs; these keep the four decisions from being quietly undone.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const tool = readFileSync("src/shared/sitePlans/components/ImageCropTool.jsx", "utf8");
const planner = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");

describe("crop tool leftovers", () => {
  it("Done saves ONLY the active mode's shape — no hidden rectangle/polygon rides along (NEW-5, supersedes B2066224)", () => {
    expect(tool).not.toMatch(/otherShapes|polySeedRef|dormant/);
    expect(tool).not.toContain("is kept too");
    expect(tool).not.toContain("crop-keeps-other");
  });
  it("Enter closes a drafting polygon even with a toolbar button focused (B2066225)", () => {
    expect(tool).toMatch(/k === "Enter" && tag === "BUTTON" && !\(mode === "poly" && !polyClosed\)/);
  });
  it("ONE reset action: Reset to full page; no separate Clear polygon (NEW-5, supersedes B2066226)", () => {
    expect(tool).toContain('data-testid="crop-reset"');
    expect(tool).not.toContain("crop-clear-polygon");
    expect(tool).not.toContain("Clear polygon");
  });
  it("the panel carries ONE Crop entry (B2066227's second, row-level button was retired by the Overlays redesign — owner: one crop control)", () => {
    const panel = readFileSync("src/workspaces/site-planner/components/OverlaysPanel.jsx", "utf8");
    expect((panel.match(/data-testid="overlay-crop-open"/g) || []).length).toBe(1);
    expect(planner).not.toMatch(/overlay-crop-open-row-/);
  });
});
