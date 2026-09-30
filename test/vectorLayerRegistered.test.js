/* B1990960 (recurrence) — EVERY `kind: "vector"` ROW IN layers.js MUST HAVE A REGISTERED VECTOR SOURCE.
 *
 * The Georgia county/city rows shipped in #1895 with a layers.js entry and a GIS_SOURCES row but NO
 * `VECTOR_SOURCES` entry. `cachedVectorLayer` returns null for an unregistered id, the panel reported
 * "no vector source registered", and NOTHING DREW on the owner's signed-in Adairsville site — while every
 * sandbox test was green, because none of them asked the loader's own question. This asks it: for each
 * vector row, is there a source the loader can read, and does it point at the same service the row (and
 * the jurisdiction identify) names — one source of truth, the B176 invariant. */
import { describe, it, expect, vi } from "vitest";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";
import { VECTOR_SOURCES } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";

const vectorRows = Object.entries(ALL_LAYERS).filter(([, c]) => c.kind === "vector");

/* Rows that are STILL on the live (uncached) path because they have no VECTOR_SOURCES entry. Since this fix
 * `layers.js` draws them through the live esri layer instead of failing, so they are not dead — but they
 * skip the cache, the name labels and the hover identify. SHRINK-ONLY: register a row and delete it here;
 * never add to this list to make a new row pass (register it). Found by this guard on 2026-09-30. */
const LIVE_PATH_ONLY = ["co_city", "co_isd", "co_road", "co_metro_districts", "co_water_districts", "mhfd_drainage", "mhfd_easements"];

describe("every vector layer row has a registered vector source", () => {
  it("the census sees vector rows at all (a guard that finds none is vacuous)", () => {
    expect(vectorRows.length).toBeGreaterThan(5);
    expect(vectorRows.map(([k]) => k)).toEqual(expect.arrayContaining(["jur_county", "ga_county", "ga_city"]));
  });
  it("no vector row is missing from VECTOR_SOURCES", () => {
    const missing = vectorRows.map(([k]) => k).filter((k) => !VECTOR_SOURCES[k] && !LIVE_PATH_ONLY.includes(k));
    expect(missing, `layers.js vector rows with no VECTOR_SOURCES entry — register them in vectorLayers.js (do NOT add to LIVE_PATH_ONLY): ${missing.join(", ")}`).toEqual([]);
  });
  it("the live-path allowlist is exact, shrink-only, and every row on it has a url to draw from", () => {
    for (const k of LIVE_PATH_ONLY) {
      expect(VECTOR_SOURCES[k], `${k} is now registered — remove it from LIVE_PATH_ONLY`).toBeUndefined();
      expect(ALL_LAYERS[k]?.url, `${k} has no url, so the live path cannot draw it`).toBeTruthy();
    }
  });
  it("layers.js draws an unregistered vector row through the live layer instead of failing (the actual bug)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/workspaces/site-planner/lib/layers.js", import.meta.url), "utf8");
    const branch = src.slice(src.indexOf('cfg.kind === "vector"'), src.indexOf('cfg.kind === "vectorLine"'));
    expect(branch).toMatch(/else if \(cfg\.url\)/);
    expect(branch).toMatch(/buildFeatureLayer\(cfg/);
  });
  it("each registered source queries the service its layer row names", () => {
    for (const [k, cfg] of vectorRows) {
      const src = VECTOR_SOURCES[k];
      if (!src) continue;
      expect(src.id, k).toBe(k);
      if (!src.query || typeof src.query.url !== "string") continue; // multi-service rows (jur_etj's regional mosaic) name no single url
      expect(String(src.query.url).replace(/\/query$/, ""), k).toBe(String(cfg.url).replace(/\/query$/, ""));
    }
  });
  it("the Georgia rows read the DCA registry rows and query only Georgia fields", () => {
    expect(VECTOR_SOURCES.ga_county.query.url).toBe(GIS_SOURCES.countyGa.serviceUrl + "/query");
    expect(VECTOR_SOURCES.ga_city.query.url).toBe(GIS_SOURCES.cityGa.serviceUrl + "/query");
    expect(VECTOR_SOURCES.ga_county.labelField).toBe(GIS_SOURCES.countyGa.fields.name);
    expect(VECTOR_SOURCES.ga_city.labelField).toBe(GIS_SOURCES.cityGa.fields.name);
    expect(VECTOR_SOURCES.ga_county.nameTemplate).toMatch(/County/);
    for (const k of ["ga_county", "ga_city"]) expect(JSON.stringify(VECTOR_SOURCES[k])).not.toMatch(/Texas|TxDOT|TxGIO|CNTY_NM|city_name/);
  });
});
