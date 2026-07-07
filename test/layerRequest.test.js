import { describe, it, expect } from "vitest";
import {
  TRANSIENT_STATUS, isTransientStatus,
  dynamicLayerOptions, imageLayerOptions, featureLayerOptions, featureRetryDecision,
} from "../src/workspaces/site-planner/lib/layerRequest.js";

// ---------------------------------------------------------------------------
describe("isTransientStatus — what counts as a retryable blip", () => {
  it("429 + 5xx are transient; 2xx/4xx are not", () => {
    expect(TRANSIENT_STATUS).toEqual([429, 500, 502, 503, 504]);
    for (const c of [429, 500, 502, 503, 504]) expect(isTransientStatus(c)).toBe(true);
    for (const c of [200, 301, 400, 401, 403, 404]) expect(isTransientStatus(c)).toBe(false);
  });
  it("coerces strings and ignores junk", () => {
    expect(isTransientStatus("503")).toBe(true);
    expect(isTransientStatus(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NEW-5/B287 — esri-leaflet FeatureLayer queries get retry/backoff. The DECISION is a
// pure function; attachFeatureRetry (in layers.js) just wires it to the live layer.
describe("featureRetryDecision — transient retry/backoff policy", () => {
  it("retries a transient 5xx with exponential backoff (400 → 800 → 1600)", () => {
    expect(featureRetryDecision(503, 0)).toEqual({ retry: true, delayMs: 400 });
    expect(featureRetryDecision(503, 1)).toEqual({ retry: true, delayMs: 800 });
    expect(featureRetryDecision(503, 2)).toEqual({ retry: true, delayMs: 1600 });
  });
  it("gives up after `max` retries (then the caller reports failed)", () => {
    expect(featureRetryDecision(503, 3).retry).toBe(false);
    expect(featureRetryDecision(503, 3, 5).retry).toBe(true); // a higher cap keeps going
  });
  it("retries a CODELESS blip (network / CORS hiccup has no http code)", () => {
    expect(featureRetryDecision(null, 0).retry).toBe(true);
    expect(featureRetryDecision(undefined, 1).retry).toBe(true);
  });
  it("does NOT retry a hard 4xx — that's permanent, not a blip", () => {
    expect(featureRetryDecision(404, 0).retry).toBe(false);
    expect(featureRetryDecision(400, 0).retry).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The request builders shape the ONLY map request a layer makes. They take cfg +
// opacity and nothing about coverage (the NEW-1 hard rule — see coverage.test.js).
describe("layer option builders", () => {
  it("dynamicLayerOptions passes the pinned sublayer set through whole + sets f=image", () => {
    const o = dynamicLayerOptions({ url: "u", layers: [2, 6] }, 0.85, "envpane");
    expect(o).toEqual({ url: "u", opacity: 0.85, f: "image", pane: "envpane", layers: [2, 6] });
  });
  it("dynamicLayerOptions omits layers when the config pins none (render all)", () => {
    const o = dynamicLayerOptions({ url: "u" }, 0.8);
    expect(o).toEqual({ url: "u", opacity: 0.8, f: "image" });
    expect(o).not.toHaveProperty("layers");
  });
  it("imageLayerOptions carries a rendering rule when present", () => {
    expect(imageLayerOptions({ url: "u", rendering: "Hillshade" }, 0.55, "p"))
      .toEqual({ url: "u", opacity: 0.55, pane: "p", renderingRule: { rasterFunction: "Hillshade" } });
    expect(imageLayerOptions({ url: "u" }, 0.5)).toEqual({ url: "u", opacity: 0.5 });
  });
  it("imageLayerOptions passes an OBJECT rendering rule through whole (B703 custom chain)", () => {
    const chain = {
      rasterFunction: "Colormap",
      rasterFunctionArguments: {
        Raster: { rasterFunction: "Stretch", rasterFunctionArguments: { DRA: true } },
      },
    };
    const o = imageLayerOptions({ url: "u", rendering: chain }, 0.55, "p");
    expect(o.renderingRule).toBe(chain); // verbatim, NOT re-wrapped as { rasterFunction: {…} }
  });
  it("featureLayerOptions builds a non-interactive vector style at the given opacity", () => {
    const o = featureLayerOptions({ url: "u", color: "#123456", weight: 3 }, 0.7, "p");
    expect(o.url).toBe("u");
    expect(o.interactive).toBe(false);
    expect(o.minZoom).toBe(10);
    expect(o.style()).toMatchObject({ color: "#123456", weight: 3, opacity: 0.7, fillOpacity: 0 });
  });
});
