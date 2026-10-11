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
    expect(layerSrc).toMatch(/import \{ clipPathValueForCrop \} from "\.\.\/\.\.\/\.\.\/shared\/overlay\/overlayCrop\.js";/);
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

describe("SitePlansSection.jsx — Lock never gates Edit crop (NEW-6, 2026-10-11; supersedes B1783328)", () => {
  it("the Crop button is gated only on the image existing", () => {
    expect(panelSrc).toMatch(/disabled=\{!o\.rasterKey\}\s*\n\s*onClick=\{onStartCrop\}/);
  });
  it("startCrop and commitCrop do not consult `locked`", () => {
    const start = panelSrc.indexOf("const startCrop = async (o) => {");
    expect(panelSrc.slice(start, panelSrc.indexOf("const toggleVisible", start))).not.toMatch(/\.locked/);
  });
});

describe("SitePlansSection.jsx — the crop modal is the shared, portaled CropModal (NEW-1/NEW-3, 2026-10-11)", () => {
  it("renders through CropModal and the tool FILLS the modal", () => {
    const start = panelSrc.indexOf('<CropModal testId="site-plan-crop-modal"');
    const body = panelSrc.slice(start, panelSrc.indexOf("onCommit={commitCrop}", start));
    expect(body).toMatch(/<CropModal/);
    expect(body).toMatch(/<ImageCropTool\s+fill/);
    expect(body).not.toMatch(/maxWidth=\{Math\.max/);
  });
});
