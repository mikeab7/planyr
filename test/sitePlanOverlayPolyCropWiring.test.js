/* NEW-1 (B1783328) — polygon crop for a Map/Comps site-plan overlay (`site_plan_overlays`,
 * rendered by rotatedImageLayer.js — a plain <img> in a Leaflet pane, NOT the SVG canvas the
 * OTHER overlay system in SitePlanner.jsx uses; overlayCropWiring.test.js covers that separate,
 * older feature). Source guards proving the wiring an integration test can't easily reach here
 * without a signed-in Supabase account (this feature has no logged-out/local path at all).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const layerSrc = readFileSync("src/workspaces/site-planner/lib/rotatedImageLayer.js", "utf8");
const panelSrc = readFileSync("src/shared/sitePlans/components/SitePlansSection.jsx", "utf8");

describe("rotatedImageLayer.js — ONE clip mechanism for both crop shapes", () => {
  it("imports the shared clip-path function rather than hand-rolling inset() math itself", () => {
    expect(layerSrc).toMatch(/import \{ clipPathValueForCrop \} from "\.\/overlayCrop\.js";/);
  });
  it("applyCrop delegates entirely to clipPathValueForCrop — no second render path", () => {
    const start = layerSrc.indexOf("const applyCrop = (crop) => {");
    const body = layerSrc.slice(start, layerSrc.indexOf("};", start));
    expect(body).toMatch(/img\.style\.clipPath = clipPathValueForCrop\(crop, imgW, imgH\);/);
    // Never reintroduce a hand-rolled `inset(` string here — that's exactly the second render
    // path clipPathValueForCrop exists to prevent.
    expect(body).not.toMatch(/inset\(/);
  });
});

describe("SitePlansSection.jsx — a locked overlay refuses a crop edit (B1154369 never covered this control)", () => {
  it("the Crop button is disabled while the overlay is placed and locked", () => {
    expect(panelSrc).toMatch(/disabled=\{!o\.rasterKey \|\| \(placed && o\.locked\)\}/);
  });
  it("startCrop refuses to open the tool on a locked overlay (defense in depth, not just the disabled button)", () => {
    const start = panelSrc.indexOf("const startCrop = async (o) => {");
    const body = panelSrc.slice(start, panelSrc.indexOf("};", start));
    expect(body).toMatch(/overlayPlaced\(o\) && o\.locked/);
  });
  it("commitCrop also refuses a locked overlay, mirroring commitPlacement's own existing.locked guard", () => {
    const start = panelSrc.indexOf("const commitCrop = async (crop) => {");
    const body = panelSrc.slice(start, panelSrc.indexOf("await patchAndReload(o, { crop });", start));
    expect(body).toMatch(/overlayPlaced\(o\) && o\.locked/);
  });
});
