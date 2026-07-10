// B739 — the PDF/PNG export must include the live GIS overlay layers (FEMA floodplain, TxRRC
// pipelines, wetlands, utilities, ground relief). Like the aerial (B735), each ENABLED raster
// layer is re-fetched as a frame-exact TRANSPARENT /export image and composited over the aerial.
// These tests cover the pure builders that make that image line up and carry the right request:
//   • overlayExportPlacement — geometry, SHARED with aerialPlacement (must pixel-align exactly).
//   • overlayExportRequest — which sublayers / rendering rule, derived from the SAME shapers the
//     live layer uses (dynamicLayerOptions / imageLayerOptions), so the print can't drift (PDF-PARITY).
import { describe, it, expect } from "vitest";
import { feetExtentToBbox, aerialPlacement, overlayExportPlacement } from "../src/workspaces/site-planner/lib/arcgis.js";
import { overlayExportRequest, dynamicLayerOptions, imageLayerOptions } from "../src/workspaces/site-planner/lib/layerRequest.js";

const lat0 = 29.7858, lon0 = -95.8244; // Katy-area origin (same band as aerialExport.test.js).
const EXT = { minX: -320, minY: -640, maxX: 980, maxY: 210 };

// Representative registry configs, inline so the test needs no esri-leaflet import (the builders
// are pure and take a cfg — they don't need the live ALL_LAYERS).
const femaCfg = { url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer", layers: [27, 28] };
const mudCfg = { kind: "dynamic", url: "https://example.gis/rest/services/MUD/MapServer", layers: null };
const elevCfg = {
  kind: "esriImage",
  url: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer",
  rendering: { rasterFunction: "Colormap", rasterFunctionArguments: { ColorRamp: { type: "multipart" }, Raster: { rasterFunction: "Stretch" } } },
};

const placeFor = (cfg, opts = {}) => {
  const bbox = feetExtentToBbox(EXT, lat0, lon0);
  const req = overlayExportRequest(cfg, { proxy: false, ...opts });
  return overlayExportPlacement(bbox, lon0, lat0, {
    exportBase: `${req.url}/${req.endpoint}`,
    layersParam: req.layersParam,
    renderingRule: req.renderingRule,
    maxPx: 2400,
  });
};

describe("overlayExportPlacement pixel-aligns with the aerial (B739)", () => {
  it("produces the SAME feet placement/size as aerialPlacement for the same bbox + maxPx", () => {
    const bbox = feetExtentToBbox(EXT, lat0, lon0);
    const a = aerialPlacement(bbox, lon0, lat0, { maxPx: 2400 });
    const o = overlayExportPlacement(bbox, lon0, lat0, { exportBase: "https://x/MapServer/export", layersParam: "show:1", maxPx: 2400 });
    expect(o.x).toBeCloseTo(a.x, 9);
    expect(o.y).toBeCloseTo(a.y, 9);
    expect(o.imgW).toBe(a.imgW);
    expect(o.imgH).toBe(a.imgH);
    expect(o.ftPerPx).toBeCloseTo(a.ftPerPx, 9);
    expect(o.ftPerPxY).toBeCloseTo(a.ftPerPxY, 9);
  });
});

describe("overlayExportPlacement URL shape (B739)", () => {
  it("dynamic layer → transparent png32 /export with the pinned sublayers", () => {
    const p = placeFor(femaCfg);
    expect(p.src).toContain("/MapServer/export?");
    expect(p.src).toContain("format=png32");
    expect(p.src).toContain("transparent=true");
    expect(p.src).toContain("f=image");
    expect(p.src).toContain(`layers=${encodeURIComponent("show:27,28")}`); // show%3A27%2C28
  });
  it("layers:null (MUD) → no layers= param, so the server renders all sublayers", () => {
    const p = placeFor(mudCfg);
    expect(p.src).not.toContain("layers=");
    expect(p.src).toContain("/MapServer/export?");
  });
  it("esriImage → /exportImage carrying the EXACT renderingRule object", () => {
    const p = placeFor(elevCfg);
    expect(p.src).toContain("/ImageServer/exportImage?");
    const m = p.src.match(/renderingRule=([^&]+)/);
    expect(m).toBeTruthy();
    expect(JSON.parse(decodeURIComponent(m[1]))).toEqual(elevCfg.rendering);
  });
});

describe("overlayExportRequest mirrors the live shapers (PDF-PARITY, B739)", () => {
  it("dynamic layersParam mirrors dynamicLayerOptions.layers", () => {
    const req = overlayExportRequest(femaCfg, { proxy: false });
    const { layers } = dynamicLayerOptions(femaCfg, 1, null, {});
    expect(req.layersParam).toBe(`show:${layers.join(",")}`);
    expect(req.endpoint).toBe("export");
    expect(req.renderingRule).toBeNull();
  });
  it("esriImage renderingRule mirrors imageLayerOptions.renderingRule", () => {
    const req = overlayExportRequest(elevCfg, { proxy: false });
    const { renderingRule } = imageLayerOptions(elevCfg, 1, null, {});
    expect(req.renderingRule).toEqual(renderingRule);
    expect(req.endpoint).toBe("exportImage");
    expect(req.layersParam).toBeNull();
  });
  it("proxy on → service url is swapped to the same-origin cache proxy, direct kept for fallback", () => {
    const req = overlayExportRequest(femaCfg, { proxy: true });
    expect(req.url).toContain("/api/gis-cache/");   // proxied service root
    expect(req.direct).toBe(femaCfg.url);            // direct-agency URL retained for the CORS fallback
    expect(req.url).not.toBe(req.direct);
  });
});
