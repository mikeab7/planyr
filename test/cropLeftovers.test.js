// B2066224–B2066227 — source guards for the crop-tool leftovers. The behaviour itself is walked in a real
// browser by ui-audit/verify-crop-leftovers.mjs; these keep the four decisions from being quietly undone.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const tool = readFileSync("src/shared/sitePlans/components/ImageCropTool.jsx", "utf8");
const planner = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");

describe("crop tool leftovers", () => {
  it("Done carries the other shape whenever the person put one there (B2066224)", () => {
    expect(tool).toMatch(/const otherShapes = \(\) =>/);
    expect(tool).toMatch(/polySeedRef/);
    // the dormant polygon is no longer gated on the overlay having had one before the tool opened
    expect(tool).not.toMatch(/initialPtsRef\.current && !isFullImagePoly\(polyPts, imgW, imgH\)\s*\n\s*\? normalizePolyCrop/);
  });
  it("Enter closes a drafting polygon even with a toolbar button focused (B2066225)", () => {
    expect(tool).toMatch(/k === "Enter" && tag === "BUTTON" && !\(mode === "poly" && !polyClosed\)/);
  });
  it("Reset to full page precedes Clear polygon so it never moves between modes (B2066226)", () => {
    expect(tool.indexOf('data-testid="crop-reset"')).toBeGreaterThan(0);
    expect(tool.indexOf('data-testid="crop-reset"')).toBeLessThan(tool.indexOf('data-testid="crop-clear-polygon"'));
  });
  it("the collapsed overlay row carries its own Crop entry (B2066227)", () => {
    expect(planner).toMatch(/overlay-crop-open-row-\$\{o\.id\}/);
  });
});
