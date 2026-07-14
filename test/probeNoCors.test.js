// B691 — the noCors registry flag: a host that sends no CORS headers must never be
// probed directly from the page (each attempt prints an uncatchable red console error);
// probeService health-checks it through the same-origin B445 proxy ONLY, and a
// disabled/undeployed/unreachable proxy degrades to the SAME optimistic add a direct
// CORS failure produces (B469's constraint — never a hard dependency on the proxy).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// layers.js pulls in Leaflet-facing modules that need a DOM — stub the four offenders
// (values unused by probeService) so the module loads in the node test environment.
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn() }));

import { probeService } from "../src/workspaces/site-planner/lib/layers.js";
import { proxyServiceUrl } from "../src/shared/gis/gisProxyCore.js";

const HOST = "https://arcgisweb.example-nocors.gov/arcgis/rest/services/FLOODZONE";
let seq = 0;
const uniqueUrl = () => `${HOST}/Svc${++seq}/MapServer`; // probeService caches per URL (40s TTL)

const realFetch = global.fetch;
let calls;
const record = (impl) => {
  calls = [];
  global.fetch = vi.fn(async (url, opts) => { calls.push(String(url)); return impl(String(url), opts); });
};
const jsonRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => { delete import.meta.env.VITE_GIS_PROXY; });
afterEach(() => { global.fetch = realFetch; delete import.meta.env.VITE_GIS_PROXY; });

describe("B691 — probeService noCors path", () => {
  it("never touches the host directly; probes exactly the proxy URL; live JSON → ok + fullExtent", async () => {
    const url = uniqueUrl();
    const extent = { xmin: 1, ymin: 2, xmax: 3, ymax: 4, spatialReference: { wkid: 102100 } };
    record(() => jsonRes({ fullExtent: extent }));
    const r = await probeService(url, { noCors: true });
    expect(r.ok).toBe(true);
    expect(r.fullExtent).toEqual(extent);
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(`${proxyServiceUrl(url)}?f=json`);
    expect(calls.some((u) => u.startsWith(HOST))).toBe(false);
  });

  it("a relayed ArcGIS .error body stays an HONEST failure (service stopped ≠ unreachable)", async () => {
    const url = uniqueUrl();
    record(() => jsonRes({ error: { message: "Service FLOODZONE not started", code: 500 } }));
    const r = await probeService(url, { noCors: true });
    expect(r.ok).toBe(false);
    expect(r.unreachable).toBeUndefined();
    expect(r.error).toMatch(/not started/);
    expect(calls.some((u) => u.startsWith(HOST))).toBe(false);
  });

  it("proxy 404 (Function not deployed) → optimistic unreachable, single fetch, zero direct calls", async () => {
    const url = uniqueUrl();
    record(() => jsonRes({}, 404));
    const r = await probeService(url, { noCors: true });
    expect(r).toMatchObject({ ok: false, unreachable: true });
    expect(calls.length).toBe(1); // 404 is non-transient — fetchWithRetry does not retry it
    expect(calls.some((u) => u.startsWith(HOST))).toBe(false);
  });

  it("proxy fetch THROWS → optimistic unreachable, every attempt proxy-only", async () => {
    const url = uniqueUrl();
    record(() => { throw new TypeError("Failed to fetch"); });
    const r = await probeService(url, { noCors: true });
    expect(r).toMatchObject({ ok: false, unreachable: true });
    expect(calls.length).toBeGreaterThan(0);
    for (const u of calls) expect(u.startsWith(HOST)).toBe(false);
  }, 15000);

  it("proxy kill switch (VITE_GIS_PROXY=0) → ZERO fetches, optimistic unreachable", async () => {
    const url = uniqueUrl();
    import.meta.env.VITE_GIS_PROXY = "0";
    record(() => jsonRes({}));
    const r = await probeService(url, { noCors: true });
    expect(r).toMatchObject({ ok: false, unreachable: true });
    expect(calls.length).toBe(0);
  });

  it("regression guard: an entry WITHOUT noCors still probes the direct URL first", async () => {
    const url = uniqueUrl();
    record(() => jsonRes({ fullExtent: null }));
    const r = await probeService(url, {});
    expect(r.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(`${url}?f=json`);
  });
});

describe("B691 — registry carries the flag (source-text guard)", () => {
  const countiesSrc = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/lib/counties.js", import.meta.url)), "utf8");
  it("fb_contours sets noCors: true", () => {
    const block = countiesSrc.slice(countiesSrc.indexOf("fb_contours:"), countiesSrc.indexOf("fb_contours:") + 2200);
    expect(block).toMatch(/noCors:\s*true/);
  });
  it("the ⓘ note names the proxy-health behavior", () => {
    expect(countiesSrc).toMatch(/Health checked via the same-origin proxy/);
  });
});
