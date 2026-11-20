/* B2589680 — the printed / exported sheet carries the aerial EXACTLY when the map is showing it.
 * The print panel's "Aerial" checkbox is gone (it only ever wrote the plan-level `showAerial`); the export used to ignore that value
 * ("always include the aerial, even if it's hidden on screen"), so hiding the aerial on the map never reached the PDF.
 * No browser here: the pure rule + a source check that BOTH export seams (the stitched/dynamic capture and the pinned-underlay
 * fallback) are gated on it and that the planner hands the export the live value. Live proof: ui-audit/verify-print-aerial-follows-map-live.mjs (V2038736). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { aerialWantedOnSheet, isAerialVisible, withAerialVisible } from "../src/workspaces/site-planner/lib/aerialVisibility.js";

const read = (p) => readFileSync(new URL("../src/workspaces/site-planner/" + p, import.meta.url), "utf8");

describe("aerialWantedOnSheet", () => {
  it("follows the plan-level toggle; an unset value reads as shown", () => {
    expect(aerialWantedOnSheet(true)).toBe(true);
    expect(aerialWantedOnSheet(false)).toBe(false);
    expect(aerialWantedOnSheet(undefined)).toBe(true);
  });
  it("agrees with the map's own toggle for a stored plan (settings.aerialHidden)", () => {
    expect(aerialWantedOnSheet(isAerialVisible({}))).toBe(true);
    expect(aerialWantedOnSheet(isAerialVisible({ aerialHidden: true }))).toBe(false);
    expect(aerialWantedOnSheet(isAerialVisible(withAerialVisible({ aerialHidden: true }, true)))).toBe(true);
  });
});

describe("the export honours it at both seams, and the planner passes it", () => {
  const src = read("lib/exportSheet.js");
  it("exportAerialForFrame captures nothing for an aerial the map is not showing", () => {
    expect(src).toMatch(/if \(!origin \|\| !basemapOn \|\| !aerialWantedOnSheet\(showAerial\)\) return null;/);
  });
  it("buildExportSvgRaw draws neither the live capture nor the pinned map snapshot when the map is not showing it", () => {
    expect(src).toMatch(/if \(!aerialWantedOnSheet\(showAerial\)\) \{[\s\S]*?\} else if \(exportAerial\) \{/);
    expect(src).not.toMatch(/Always include the aerial \(even if it's hidden on screen\)/);
  });
  it("the ctx destructure takes showAerial (default shown, so other callers are unchanged)", () => {
    expect(src).toMatch(/showAerial = true,/);
  });
  it("SitePlanner's exportCtx hands the export the live plan-level value", () => {
    const planner = read("SitePlanner.jsx");
    const ctx = planner.slice(planner.indexOf("const exportCtx = () => ({"));
    expect(ctx.slice(0, 2500)).toMatch(/\n\s+showAerial,/);
  });
});
