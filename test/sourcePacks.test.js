// source-scan: sweeps src/ for static imports of the lazy GIS source pack files and for eager reads of pack-only registry keys (a behavioural check cannot see an import graph)
/* Batch K stage 3 (B2671306) — the GIS source registry splits into an eager CORE (sources.js) and on-demand PACKS (sources<Name>.js, loaded by sourcePacks.js).
 * The guards that make that safe:
 *  · ALL-LOADED IS BYTE-IDENTICAL to the old single registry: same keys, SAME ORDER, same row content (test/fixtures/gisSourcesBaseline.json was dumped before the split);
 *  · "NOT LOADED YET" IS NEVER "NO DATA": a pack key read early THROWS a message naming its pack (never an undefined), and a failed pack load is LOUD and RETRIED;
 *  · jurisdiction — the code that reads the registry ~100 times at load — sees EXACTLY the same rows with nothing loaded as with everything loaded, so it can never
 *    show a wrong jurisdiction while a pack is loading (its rows are all core);
 *  · every lazy layer file loads through its REAL loader with nothing preloaded (so each declares every pack it reads), and a layer file's own rows are in the registry
 *    before it runs;
 *  · no eager module reads a pack-only key, and the app never imports the all-packs tooling modules. */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// The house pattern for loading layers.js in a node env (see test/lazyLayerRegistry.test.js): the Leaflet-touching leaves are mocked.
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn(), bedrockLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(() => null), cachedPipelineLayer: vi.fn(() => null), cachedCorridorLayer: vi.fn(() => null), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

const GIS = "../src/shared/gis/";
const LIB = "../src/workspaces/site-planner/lib/";
const BASE = JSON.parse(readFileSync(new URL("./fixtures/gisSourcesBaseline.json", import.meta.url), "utf8"));
const h = (o) => createHash("sha1").update(JSON.stringify(o, (_k, v) => (typeof v === "function" || v instanceof RegExp ? String(v) : v))).digest("hex").slice(0, 10);

/** A FRESH copy of the modules with NOTHING preloaded — what production has at first paint. */
async function fresh() {
  vi.resetModules();
  globalThis.__PLANYR_NO_SOURCE_PACK_PRELOAD__ = true; // read by the alias target of sourcePacksPreload.js (test/helpers/sourcePacksPreloadAll.js)
  globalThis.__PLANYR_NO_LAZY_PRELOAD__ = true; // same, for lazyLayerPreload.js (test/helpers/lazyLayerPreloadAll.js)
  const sources = await import(GIS + "sources.js");
  const packs = await import(GIS + "sourcePacks.js");
  delete globalThis.__PLANYR_NO_SOURCE_PACK_PRELOAD__;
  delete globalThis.__PLANYR_NO_LAZY_PRELOAD__;
  return { sources, packs };
}

describe("all packs loaded = the old registry, byte for byte", () => {
  it("same keys in the same order, same rows, same fixture-reach table", async () => {
    const s = await import(GIS + "sources.js"); // vitest aliases the preload seam: every pack is merged
    expect(Object.keys(s.GIS_SOURCES)).toEqual(BASE.order);
    for (const k of BASE.order) expect(h(s.GIS_SOURCES[k]), k).toBe(BASE.rows[k]);
    expect(Object.keys(s.SOURCE_FIXTURE_REACH)).toEqual(BASE.reachOrder);
    for (const k of BASE.reachOrder) expect(h(s.SOURCE_FIXTURE_REACH[k]), k).toBe(BASE.reach[k]);
    expect(h(s.SOURCE_FIXTURE_REACH_PENDING)).toBe(BASE.pending);
    expect(h(s.SOURCE_STATE_SCOPE)).toBe(BASE.scope);
  });

  it("the generated index agrees with the files (run `npm run source-pack-index` when this fails)", async () => {
    const env = await fresh();
    const { buildSourcePackIndex } = await import(GIS + "sourcePackIndexBuild.js");
    const idx = await import(GIS + "sourcePackIndex.generated.js");
    const built = await buildSourcePackIndex({ coreKeys: Object.keys(env.sources.GIS_SOURCES), coreReach: Object.keys(env.sources.SOURCE_FIXTURE_REACH), prevOrder: idx.SOURCE_KEY_ORDER, prevReach: idx.SOURCE_REACH_ORDER });
    expect(idx.SOURCE_PACK_KEYS).toEqual(built.packs);
    expect(idx.SOURCE_KEY_ORDER).toEqual(built.order);
    expect(idx.SOURCE_REACH_ORDER).toEqual(built.reachOrder);
    expect(env.packs.SOURCE_PACK_IDS).toEqual(Object.keys(idx.SOURCE_PACK_KEYS));
  });
});

describe("production shape: the core alone, then packs on demand", () => {
  let env;
  beforeAll(async () => { env = await fresh(); });

  it("starts with only core rows — no state's rows are resident until something needs them", () => {
    const keys = Object.keys(env.sources.GIS_SOURCES);
    expect(keys.length).toBeLessThan(BASE.order.length - 150);
    expect(env.sources.GIS_SOURCES.flood).toBeTruthy();
    expect(env.sources.GIS_SOURCES.county).toBeTruthy();
    expect(env.sources.GIS_SOURCES.okRoad).toBeUndefined();
    expect(env.sources.loadedSourcePacks()).toEqual([]);
  });

  it("a pack key read early is LOUD and names its pack — never an undefined that reads as 'no source'", () => {
    expect(() => env.sources.gisSource("okRoad")).toThrow(/"oklahoma" source pack, which has not loaded yet/);
    expect(() => env.sources.gisSource("weldZoning")).toThrow(/"colorado" source pack/);
    expect(() => env.sources.gisSource("definitelyNotAKey")).toThrow(/unknown source key/);
    expect(env.sources.gisSource("flood").key).toBe("flood");
  });

  it("a failed load is LOUD (console.error + rejection), registers nothing, and the next ask retries", async () => {
    const entry = env.packs.SOURCE_PACKS.find((p) => p.id === "georgia");
    const real = entry.load;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    entry.load = () => Promise.reject(new Error("chunk fetch failed"));
    await expect(env.packs.ensureSourcePacks(["georgia"])).rejects.toThrow("chunk fetch failed");
    expect(err).toHaveBeenCalled();
    expect(env.sources.sourcePackLoaded("georgia")).toBe(false);
    expect(env.sources.GIS_SOURCES.gaRecharge).toBeUndefined();
    entry.load = real;
    err.mockRestore();
    expect(await env.packs.ensureSourcePacks(["georgia"])).toBe(true);
    expect(env.sources.sourcePackLoaded("georgia")).toBe(true);
    expect(h(env.sources.GIS_SOURCES.gaRecharge)).toBe(BASE.rows.gaRecharge);
    await expect(env.packs.ensureSourcePacks(["no-such-pack"])).rejects.toThrow(/unknown source pack/);
  });

  it("packs loaded in ANY order land in the original key order, with identical rows", async () => {
    const order = [...env.packs.SOURCE_PACK_IDS].reverse();
    for (const id of order) await env.packs.ensureSourcePacks([id]);
    expect(Object.keys(env.sources.GIS_SOURCES)).toEqual(BASE.order);
    for (const k of BASE.order) expect(h(env.sources.GIS_SOURCES[k]), k).toBe(BASE.rows[k]);
    expect(Object.keys(env.sources.SOURCE_FIXTURE_REACH)).toEqual(BASE.reachOrder);
    expect(env.packs.packsForKeys(["flood", "okRoad", "weldZoning", "gaRecharge"]).sort()).toEqual(["colorado", "georgia", "oklahoma"]);
  });
});

describe("what the eager code reads at load never depends on a pack", () => {
  it("jurisdiction's registry rows are the SAME with nothing loaded as with everything loaded (never a wrong jurisdiction while a pack loads)", async () => {
    const all = await import(LIB + "jurisdiction.js");
    const snap = (m) => JSON.stringify([m.JURISDICTION_SOURCES, m.ETJ_SOURCES], (_k, v) => (typeof v === "function" || v instanceof RegExp ? String(v) : v));
    const allSnap = snap(all);
    await fresh();
    globalThis.__PLANYR_NO_SOURCE_PACK_PRELOAD__ = true;
    const bare = await import(LIB + "jurisdiction.js");
    delete globalThis.__PLANYR_NO_SOURCE_PACK_PRELOAD__;
    expect(snap(bare)).toBe(allSnap);
    expect(Object.keys(bare.JURISDICTION_SOURCES).length).toBeGreaterThan(5);
  });

  it("the eager analysis / layer / vector modules import with nothing loaded and build their rows", async () => {
    vi.resetModules();
    globalThis.__PLANYR_NO_SOURCE_PACK_PRELOAD__ = true;
    globalThis.__PLANYR_NO_LAZY_PRELOAD__ = true;
    try {
      const analysis = await import(LIB + "siteAnalysis.js");
      const layers = await import(LIB + "layers.js");
      await import(LIB + "vectorLayers.js");
      await import(LIB + "detentionRules.js");
      await import(LIB + "oklahomaStatic.js");
      expect(Object.keys(analysis).length).toBeGreaterThan(0);
      expect(Object.keys(layers.ALL_LAYERS).length).toBeGreaterThan(10);
    } finally {
      delete globalThis.__PLANYR_NO_SOURCE_PACK_PRELOAD__;
      delete globalThis.__PLANYR_NO_LAZY_PRELOAD__;
    }
  });
});

describe("every lazy layer file loads through its REAL loader with nothing preloaded", () => {
  it("each file declares every pack it reads: the whole lazy set loads, and the layers match the generated layer index", async () => {
    vi.resetModules();
    globalThis.__PLANYR_NO_SOURCE_PACK_PRELOAD__ = true;
    globalThis.__PLANYR_NO_LAZY_PRELOAD__ = true;
    let layers; let files; let sources;
    try {
      sources = await import(GIS + "sources.js");
      files = await import(LIB + "lazyLayerFiles.js");
      layers = await import(LIB + "layers.js");
    } finally { delete globalThis.__PLANYR_NO_SOURCE_PACK_PRELOAD__; delete globalThis.__PLANYR_NO_LAZY_PRELOAD__; }
    expect(sources.loadedSourcePacks()).toEqual([]);
    for (const f of files.LAZY_LAYER_FILES) expect(Array.isArray(f.packs), `${f.key} must declare its source packs`).toBe(true);
    await layers.ensureAllLayerFiles();
    const index = (await import(LIB + "lazyLayerIndex.generated.js")).LAZY_LAYER_INDEX;
    for (const f of files.LAZY_LAYER_FILES) for (const id of index[f.key].ids) expect(layers.ALL_LAYERS[id], `${f.key}:${id}`).toBeTruthy();
    // Every pack a layer file names is now registered; the one pack no layer reads (registryOnly) is still NOT loaded — it is tooling's.
    for (const f of files.LAZY_LAYER_FILES) for (const p of f.packs) expect(sources.sourcePackLoaded(p), `${f.key} → ${p}`).toBe(true);
    expect(sources.sourcePackLoaded("registryOnly")).toBe(false);
  });
});

/* ── source sweeps ── */
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(js|jsx)$/.test(n)) out.push(p);
  }
  return out;
}
const SRC = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), "../src");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PACK_FILE = /shared\/gis\/sources(Colorado|Georgia|Tennessee|Mississippi|RegistryOnly|Florida|Ok|HoustonMetro|TxCityZoning|SugarLand|FortBend|Waller|Nashville|NashvilleBuffers|Rutherford)\.js$/;

describe("the sweeps", () => {
  const files = walk(SRC);
  it("no module outside the loaders imports a pack file, and the app never imports the all-packs tooling modules", () => {
    const allowed = /shared\/gis\/(sourcePacks|sourcePacksAll|sourcesAll|sourcePackIndexBuild)\.js$|shared\/gis\/sourceFixtures[A-Za-z]*\.js$|shared\/gis\/sources[A-Za-z]*\.js$/;
    const bad = [];
    for (const f of files) {
      if (allowed.test(f)) continue;
      const t = strip(readFileSync(f, "utf8"));
      if (/from\s+["'][^"']*gis\/sources(?!\.js)[A-Za-z]+\.js["']|import\(\s*["'][^"']*gis\/sources(?!\.js)[A-Za-z]+\.js/.test(t)) bad.push(path.relative(SRC, f));
      if (/sourcePacksAll\.js|gis\/sourcesAll\.js/.test(t)) bad.push(path.relative(SRC, f));
    }
    expect(bad).toEqual([]);
    // sourcesAll / sourcePacksAll are tooling's: only each other and the index builder may import them.
    for (const f of files) {
      const t = strip(readFileSync(f, "utf8"));
      if (/sourcePacksAll\.js/.test(t)) expect(/sourcesAll\.js$|sourcePackIndexBuild\.js$/.test(f), f).toBe(true);
    }
  });

  it("no eager module reads a pack-only registry key — only the lazy layer file(s) that declare its pack (and the fixtures / pack files) may", async () => {
    const idx = await import(GIS + "sourcePackIndex.generated.js");
    const lf = await import(LIB + "lazyLayerFiles.js");
    const fileOfLayer = (key) => ({ desoto: "desotoLayers", sugarland: "sugarLandLayers", fortbend: "fortBendLayers", waller: "wallerLayers", nashville: "nashvilleLayers", nashvilleBuffers: "nashvilleBufferLayers", georgia: "georgiaLayers", colorado: "coloradoLayers", tennessee: "tennesseeLayers", mississippi: "mississippiLayers", florida: "floridaLayers", oklahoma: "oklahomaLayers", chambers: "chambersLayers", houstonMetro: "houstonMetroLayers", txCityZoning: "txCityZoningLayers" })[key];
    const ownersOf = (pack) => lf.LAZY_LAYER_FILES.filter((f) => f.packs.includes(pack)).map((f) => fileOfLayer(f.key) + ".js");
    const texts = Object.fromEntries(files.filter((f) => !PACK_FILE.test(f) && !/shared\/gis\/(sources|sourceFixtures|sourcePack)/.test(f) && !/sourcesAll|sourcePacks/.test(f)).map((f) => [f, strip(readFileSync(f, "utf8"))]));
    const bad = [];
    for (const [pack, keys] of Object.entries(idx.SOURCE_PACK_KEYS)) {
      const owners = ownersOf(pack);
      for (const k of keys) {
        const re = new RegExp(`(["'\`]${k}["'\`]|GIS_SOURCES\\.${k}\\b)`);
        for (const [f, t] of Object.entries(texts)) if (re.test(t) && !owners.includes(path.basename(f))) bad.push(`${path.relative(SRC, f)} reads ${k} (pack ${pack})`);
      }
    }
    expect(bad).toEqual([]);
  });
});
