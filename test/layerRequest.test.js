import { describe, it, expect } from "vitest";
import {
  TRANSIENT_STATUS, isTransientStatus,
  dynamicLayerOptions, imageLayerOptions, featureLayerOptions, featureRetryDecision,
  wireRasterStatus, RASTER_STALL_MS,
} from "../src/workspaces/site-planner/lib/layerRequest.js";

// A fake leaflet/esri layer: records event handlers, lets a test emit them, and carries a
// writable `.onRemove` (wireRasterStatus wraps it, like Leaflet's removal hook).
function fakeLayer() {
  const h = {};
  return {
    on(evt, fn) { (h[evt] || (h[evt] = [])).push(fn); return this; },
    emit(evt) { (h[evt] || []).forEach((fn) => fn()); },
    onRemove: null,
  };
}
// Controllable timers so the stall watchdog fires deterministically (no real waiting).
function fakeTimers() {
  let pending = [];
  const setTimer = (fn) => { const t = { fn, cleared: false }; pending.push(t); return t; };
  const clearTimer = (t) => { if (t) t.cleared = true; };
  const flush = () => { const due = pending; pending = []; due.forEach((t) => { if (!t.cleared) t.fn(); }); };
  return { setTimer, clearTimer, flush };
}
// Collect onStatus(id, state, msg) calls.
function statusSpy() {
  const calls = [];
  const onStatus = (id, state, msg) => calls.push({ id, state, msg });
  onStatus.calls = calls;
  onStatus.last = () => calls[calls.length - 1];
  onStatus.states = () => calls.map((c) => c.state);
  return onStatus;
}

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

// ---------------------------------------------------------------------------
// NEW-3/B790: honest raster-layer status — no false "loaded" over a blank map.
describe("wireRasterStatus — never a false 'loaded'; honest 'slow' on a silent stall", () => {
  it("does NOT emit any status on wire (the caller sets 'loading'; no optimistic 'loaded')", () => {
    const l = fakeLayer(); const t = fakeTimers(); const onStatus = statusSpy();
    wireRasterStatus(l, { k: "fema", label: "FEMA", onStatus, setTimer: t.setTimer, clearTimer: t.clearTimer });
    expect(onStatus.calls).toEqual([]); // the old bug reported "loaded" here
  });

  it("flips to amber 'slow' when no 'load' arrives within the stall window", () => {
    const l = fakeLayer(); const t = fakeTimers(); const onStatus = statusSpy();
    wireRasterStatus(l, { k: "fema", label: "FEMA flood zones", onStatus, setTimer: t.setTimer, clearTimer: t.clearTimer });
    t.flush(); // watchdog fires
    expect(onStatus.last().state).toBe("slow");
    expect(onStatus.last().msg).toMatch(/slow or unavailable|missing data/i);
  });

  it("a real 'load' settles to 'loaded' and cancels the stall watchdog", () => {
    const l = fakeLayer(); const t = fakeTimers(); const onStatus = statusSpy();
    wireRasterStatus(l, { k: "fema", label: "FEMA", onStatus, setTimer: t.setTimer, clearTimer: t.clearTimer });
    l.emit("load");
    expect(onStatus.last().state).toBe("loaded");
    t.flush(); // the watchdog must have been cleared → no 'slow'
    expect(onStatus.states()).not.toContain("slow");
  });

  it("reports the cached-copy age (reportAge) only after a PROXY load", () => {
    const l = fakeLayer(); const t = fakeTimers(); let ages = 0;
    wireRasterStatus(l, { k: "fema", label: "FEMA", proxy: true, onStatus: statusSpy(), reportAge: () => { ages++; }, setTimer: t.setTimer, clearTimer: t.clearTimer });
    l.emit("load");
    expect(ages).toBe(1);
  });

  it("recovers: a later 'load' after a 'slow' flips the row back to 'loaded'", () => {
    const l = fakeLayer(); const t = fakeTimers(); const onStatus = statusSpy();
    wireRasterStatus(l, { k: "fema", label: "FEMA", onStatus, setTimer: t.setTimer, clearTimer: t.clearTimer });
    t.flush(); // → slow
    expect(onStatus.last().state).toBe("slow");
    l.emit("loading"); // esri re-requests on the next pan → neutral + re-arm
    expect(onStatus.last().state).toBe("loading");
    l.emit("load");
    expect(onStatus.last().state).toBe("loaded");
  });

  it("a proxy 'requesterror' takes the direct fallback ONCE, without a premature 'failed'", () => {
    const l = fakeLayer(); const t = fakeTimers(); const onStatus = statusSpy(); let fell = 0;
    wireRasterStatus(l, {
      k: "fema", label: "FEMA", proxy: true, onStatus,
      onProxyFallback: () => { fell++; }, setTimer: t.setTimer, clearTimer: t.clearTimer,
    });
    l.emit("requesterror");
    expect(fell).toBe(1);
    expect(onStatus.states()).not.toContain("failed"); // the direct layer settles its own status
    l.emit("requesterror"); // already fell back → now a real 'failed'
    expect(onStatus.last().state).toBe("failed");
  });

  it("a non-proxy 'requesterror' (no fallback) → 'failed'", () => {
    const l = fakeLayer(); const t = fakeTimers(); const onStatus = statusSpy();
    wireRasterStatus(l, { k: "fema", label: "FEMA", proxy: false, onStatus, setTimer: t.setTimer, clearTimer: t.clearTimer });
    l.emit("requesterror");
    expect(onStatus.last().state).toBe("failed");
  });

  it("clears the watchdog on removal (no 'slow' fires on a detached layer)", () => {
    const l = fakeLayer(); const t = fakeTimers(); const onStatus = statusSpy();
    wireRasterStatus(l, { k: "fema", label: "FEMA", onStatus, setTimer: t.setTimer, clearTimer: t.clearTimer });
    l.onRemove(); // toggled off
    t.flush();
    expect(onStatus.states()).not.toContain("slow");
  });

  it("gates a late watchdog to the still-current layer via isActive()", () => {
    const l = fakeLayer(); const t = fakeTimers(); const onStatus = statusSpy();
    wireRasterStatus(l, { k: "fema", label: "FEMA", onStatus, isActive: () => false, setTimer: t.setTimer, clearTimer: t.clearTimer });
    t.flush();
    expect(onStatus.states()).not.toContain("slow");
  });

  it("RASTER_STALL_MS is a sane, generous default (well past a healthy load, under a minute)", () => {
    expect(RASTER_STALL_MS).toBeGreaterThanOrEqual(8000);
    expect(RASTER_STALL_MS).toBeLessThanOrEqual(60000);
  });
});
