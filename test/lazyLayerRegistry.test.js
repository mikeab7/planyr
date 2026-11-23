// source-scan: sweeps src/ for static imports of the lazy layer files (a behavioural check cannot see an import graph)
/* Batch K stage 1 — the per-state layer files load on demand (lazyLayerFiles.js). The guards that make that safe:
 *  · an UNLOADED layer is still a known layer: its saved on / opacity / above-plan settings are KEPT (never pruned as "unknown" and so
 *    erased on the first save) — the data-loss hazard that made a lazy registry dangerous;
 *  · the default overlays state is identical before and after a file loads;
 *  · the registry's key order (= paint order) is the same whatever order files load in;
 *  · the generated index matches the real files; no eager module imports a lazy file statically. */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { LAZY_LAYER_FILES } from "../src/workspaces/site-planner/lib/lazyLayerFiles.js";
import { LAZY_LAYER_INDEX } from "../src/workspaces/site-planner/lib/lazyLayerIndex.generated.js";
import { buildLazyLayerIndex } from "../src/workspaces/site-planner/lib/lazyLayerIndexBuild.js";

// The house pattern for loading layers.js in a node env (see test/layerRegistryDrift.test.js): the Leaflet-touching leaves are mocked.
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn(), bedrockLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(() => null), cachedPipelineLayer: vi.fn(() => null), cachedCorridorLayer: vi.fn(() => null), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

const GA = LAZY_LAYER_INDEX.georgia.ids[0]; // lazy ids, taken from the index so the test follows the files (ga_hsi, for one, is an EAGER row)
const CO = LAZY_LAYER_INDEX.colorado.ids[0];
const LIB = "../src/workspaces/site-planner/lib/";
/** A FRESH copy of the registry modules with NOTHING preloaded — what production has at first paint. */
async function freshUnloaded() {
  vi.resetModules();
  globalThis.__PLANYR_NO_LAZY_PRELOAD__ = true; // read by the alias target of lazyLayerPreload.js (test/helpers/lazyLayerPreloadAll.js)
  const layers = await import(LIB + "layers.js");
  const prefs = await import(LIB + "layerPrefs.js");
  const opacity = await import(LIB + "layerOpacity.js");
  return { layers, prefs, opacity };
}

describe("lazy layer registry", () => {
  let env;
  beforeAll(async () => { env = await freshUnloaded(); });

  it("starts without the lazy rows (the point of the split) and with an index for every file", () => {
    expect(env.layers.ALL_LAYERS[GA]).toBeUndefined();
    expect(env.layers.ALL_LAYERS.fema).toBeTruthy();
    for (const f of LAZY_LAYER_FILES) expect(LAZY_LAYER_INDEX[f.key]?.ids.length).toBeGreaterThan(0);
  });

  it("an unloaded layer is still a KNOWN layer", () => {
    expect(env.layers.isLayerId(GA)).toBe(true);
    expect(env.layers.isLayerId(CO)).toBe(true);
    expect(env.layers.isLayerId("no_such_layer")).toBe(false);
  });

  it("PRESERVES saved on/off for layers of a file that has not loaded (the data-loss guard)", () => {
    const saved = { fema: true, [GA]: true, [CO]: false, no_such_layer: true };
    expect(env.prefs.sanitizeLayerOverrides(saved)).toEqual({ fema: true, [GA]: true, [CO]: false });
    // a full overlays state built BEFORE the file loaded round-trips the saved override unchanged
    const overlays = env.prefs.overlaysWithOverrides({ [GA]: true });
    expect(overlays[GA].on).toBe(true);
    expect(env.prefs.overridesFromOverlays(overlays)).toEqual({ [GA]: true });
  });

  it("PRESERVES saved opacity for layers of a file that has not loaded", () => {
    const { sanitizeLayerOpacity, opacityPatch, applyLayerOpacity } = env.opacity;
    expect(sanitizeLayerOpacity({ [GA]: 0.4, no_such_layer: 0.4 })).toEqual({ [GA]: 0.4 });
    expect(opacityPatch({}, { [GA]: 0.4 }, { [GA]: 0.4 })).toEqual({ [GA]: 0.4 }); // not pruned to null
    expect(opacityPatch({ [GA]: 0.4 }, { [GA]: 0.4 }, { [GA]: 0.4 })).toEqual({});
    const o = applyLayerOpacity(env.layers.defaultOverlayState(), { [GA]: 0.4 });
    expect(o[GA].opacity).toBe(0.4);
  });

  it("PRESERVES saved 'above plan' only for lifts the index says are liftable", () => {
    const liftable = LAZY_LAYER_FILES.flatMap((f) => LAZY_LAYER_INDEX[f.key].lift)[0];
    const notLiftable = LAZY_LAYER_FILES.flatMap((f) => LAZY_LAYER_INDEX[f.key].ids.filter((id) => !LAZY_LAYER_INDEX[f.key].lift.includes(id)))[0];
    expect(env.prefs.sanitizeLayerAbove({ [liftable]: true, [notLiftable]: true })).toEqual({ [liftable]: true });
  });

  it("the default overlays state is the same before and after a file loads", async () => {
    const before = env.layers.defaultOverlayState();
    await env.layers.ensureAllLayerFiles();
    const after = env.layers.defaultOverlayState();
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(after).toEqual(before);
    expect(env.layers.ALL_LAYERS[GA]).toBeTruthy();
  });

  it("registry key order (the paint order) is the same whatever order the files load in", async () => {
    const a = await freshUnloaded();
    await a.layers.ensureLayerFiles(["colorado"]); await a.layers.ensureLayerFiles(["desoto"]); await a.layers.ensureLayerFiles(["oklahoma", "georgia"]);
    await a.layers.ensureAllLayerFiles();
    const b = await freshUnloaded();
    await b.layers.ensureAllLayerFiles();
    expect(Object.keys(a.layers.ALL_LAYERS)).toEqual(Object.keys(b.layers.ALL_LAYERS));
    expect(Object.keys(a.layers.MERGE_GROUPS)).toEqual(Object.keys(b.layers.MERGE_GROUPS));
    // …and equals the order the rows had when they were static: eager rows, then the files in lazyLayerFiles.js order
    const expected = [...Object.keys(a.layers.ALL_LAYERS).filter((id) => !a.layers.lazyFileOf(id)), ...LAZY_LAYER_FILES.flatMap((f) => LAZY_LAYER_INDEX[f.key].ids)];
    expect(Object.keys(a.layers.ALL_LAYERS)).toEqual(expected);
  });

  it("loading one file adds only its rows, normalised to full opacity, and announces once", async () => {
    const e = await freshUnloaded();
    let n = 0; e.layers.subscribeLayerRegistry(() => { n++; });
    const before = Object.keys(e.layers.ALL_LAYERS).length;
    await e.layers.ensureLayerFiles(["colorado"]);
    await e.layers.ensureLayerFiles(["colorado"]); // idempotent
    expect(Object.keys(e.layers.ALL_LAYERS).length).toBe(before + LAZY_LAYER_INDEX.colorado.ids.length);
    expect(e.layers.ALL_LAYERS[CO].opacity).toBe(1);
    expect(n).toBe(1);
    expect(e.layers.lazyFilesForIds([CO, GA])).toEqual(["georgia"]);
  });

  it("file selection by state: a Colorado site wants Colorado's file and not Georgia's", async () => {
    const e = await freshUnloaded();
    const co = e.layers.lazyFilesForStates(["CO"]);
    expect(co).toContain("colorado"); expect(co).not.toContain("georgia");
    expect(e.layers.lazyFilesForStates([])).toHaveLength(LAZY_LAYER_FILES.length); // unknown state → everything
  });
});

describe("lazy layer index + imports", () => {
  it("lazyLayerIndex.generated.js matches the real files (run `npm run layer-index` if this fails)", async () => {
    expect(JSON.parse(JSON.stringify(LAZY_LAYER_INDEX))).toEqual(await buildLazyLayerIndex());
  });

  it("layer ids are unique across every file and the eager rows", async () => {
    const e = await freshUnloaded();
    const seen = new Set(Object.keys(e.layers.ALL_LAYERS));
    for (const f of LAZY_LAYER_FILES) for (const id of LAZY_LAYER_INDEX[f.key].ids) { expect(seen.has(id), id).toBe(false); seen.add(id); }
  });

  it("no eager module imports a lazy layer file statically", () => {
    const root = path.resolve(__dirname, "../src");
    const lazyFiles = [...readFileSync(path.resolve(__dirname, "../src/workspaces/site-planner/lib/lazyLayerFiles.js"), "utf8").matchAll(/import\("\.\/([A-Za-z]+)\.js"\)/g)].map((m) => m[1]);
    expect(lazyFiles).toHaveLength(LAZY_LAYER_FILES.length);
    const offenders = [];
    const walk = (d) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|mjs)$/.test(n)) {
      if (lazyFiles.includes(n.replace(/\.(jsx?|mjs)$/, ""))) continue; // a lazy file may import another
      const src = readFileSync(p, "utf8");
      for (const lf of lazyFiles) if (new RegExp(`(?:^|\\n)\\s*(?:import|export)[^\\n;]*from\\s+["'][./]*(?:[\\w./-]*/)?${lf}(?:\\.js)?["']`).test(src)) offenders.push(`${path.relative(root, p)} → ${lf}`);
    } } };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
