/* The GIS source PACKS load ON DEMAND (batch K stage 3, 2026-11-23, B2671306) — NOT in the Site route's first download.
 *
 * sources.js is the slim eager core of the registry. Every row only one state's / county's layer file or the audits read lives in a pack file instead, and a pack is
 * merged into the SAME `GIS_SOURCES` object (sources.js `registerSourcePack`) before the layer file that reads it runs: lazyLayerFiles.js names the packs each layer file
 * needs and its loader awaits them first, so a layer file never executes against a half-filled registry.
 *
 * ⛔ A FAILED LOAD IS LOUD AND RETRIED: the promise rejects, nothing is registered, the next ask tries again (the layer loader in layers.js already surfaces a rejected
 * load and retries). ⛔ NEVER read a pack key from an eager module — it would be `undefined` until the pack arrives; `gisSource(key)` names the missing pack, and
 * test/sourcePacks.test.js sweeps for the direct reads. ⛔ Adding a row: put it in the eager core ONLY if an eager module reads it at load; otherwise in the pack of the
 * layer file that reads it. Then `npm run source-pack-index` (test/sourcePacks.test.js fails until you do). */
import { registerSourcePack, sourcePackLoaded, sourcePackOfKey } from "./sources.js";

/* `load()` resolves `{ sources, reach }` — the rows and the fixture-reach overrides of the pack. */
export const SOURCE_PACKS = [
  { id: "houstonMetro", load: () => import("./sourcesHoustonMetro.js").then((m) => ({ sources: m.HOUSTON_METRO_SOURCES, reach: m.HOUSTON_METRO_FIXTURE_REACH })) },
  { id: "florida", load: () => import("./sourcesFlorida.js").then((m) => ({ sources: m.FLORIDA_SOURCES, reach: m.FLORIDA_FIXTURE_REACH })) },
  { id: "oklahoma", load: () => import("./sourcesOk.js").then((m) => ({ sources: m.OK_SOURCES, reach: m.OK_FIXTURE_REACH })) },
  { id: "txCityZoning", load: () => import("./sourcesTxCityZoning.js").then((m) => ({ sources: m.TX_CITY_ZONING_SOURCES, reach: m.TX_CITY_ZONING_FIXTURE_REACH })) },
  { id: "sugarland", load: () => import("./sourcesSugarLand.js").then((m) => ({ sources: m.SUGARLAND_SOURCES, reach: m.SUGARLAND_FIXTURE_REACH })) },
  { id: "fortbend", load: () => import("./sourcesFortBend.js").then((m) => ({ sources: m.FORTBEND_SOURCES, reach: m.FORTBEND_FIXTURE_REACH })) },
  { id: "nashvilleBuffers", load: () => import("./sourcesNashvilleBuffers.js").then((m) => ({ sources: m.NASHVILLE_BUFFER_SOURCES, reach: m.NASHVILLE_BUFFER_FIXTURE_REACH })) },
  { id: "nashville", load: () => import("./sourcesNashville.js").then((m) => ({ sources: m.NASHVILLE_SOURCES, reach: m.NASHVILLE_FIXTURE_REACH })) },
  { id: "tennessee", load: () => Promise.all([import("./sourcesTennessee.js"), import("./sourcesRutherford.js")]).then(([t, r]) => ({ sources: { ...t.TENNESSEE_SOURCES, ...r.RUTHERFORD_SOURCES }, reach: { ...t.TENNESSEE_FIXTURE_REACH, ...r.RUTHERFORD_FIXTURE_REACH } })) },
  { id: "georgia", load: () => import("./sourcesGeorgia.js").then((m) => ({ sources: m.GEORGIA_SOURCES, reach: m.GEORGIA_FIXTURE_REACH })) },
  { id: "colorado", load: () => import("./sourcesColorado.js").then((m) => ({ sources: m.COLORADO_SOURCES, reach: m.COLORADO_FIXTURE_REACH })) },
  { id: "mississippi", load: () => import("./sourcesMississippi.js").then((m) => ({ sources: m.MISSISSIPPI_SOURCES, reach: m.MISSISSIPPI_FIXTURE_REACH })) },
  { id: "registryOnly", load: () => import("./sourcesRegistryOnly.js").then((m) => ({ sources: m.REGISTRY_ONLY_SOURCES, reach: m.REGISTRY_ONLY_FIXTURE_REACH })) },
];
const BY_ID = Object.fromEntries(SOURCE_PACKS.map((p) => [p.id, p]));
export const SOURCE_PACK_IDS = Object.freeze(SOURCE_PACKS.map((p) => p.id));

const inflight = new Map();
/** Load the named packs into the registry (idempotent; concurrent calls share the work). REJECTS on failure and leaves the pack unregistered, so the next call retries. */
export function ensureSourcePacks(ids) {
  const todo = [...new Set(ids || [])].filter((id) => !sourcePackLoaded(id));
  return Promise.all(todo.map((id) => {
    const p = BY_ID[id];
    if (!p) return Promise.reject(new Error(`[gis-sources] unknown source pack "${id}"`));
    if (!inflight.has(id)) {
      inflight.set(id, p.load().then((rows) => { inflight.delete(id); return registerSourcePack(id, rows); }, (e) => {
        inflight.delete(id);
        console.error(`[gis-sources] source pack "${id}" failed to load — it will be retried on the next ask`, e);
        throw e;
      }));
    }
    return inflight.get(id);
  })).then((r) => r.some(Boolean));
}
/** The packs holding these registry keys (keys in the eager core need none). */
export const packsForKeys = (keys) => [...new Set((keys || []).map(sourcePackOfKey).filter(Boolean))];
export const ensureSourcePacksForKeys = (keys) => ensureSourcePacks(packsForKeys(keys));
/** Every pack — for tooling that audits the whole registry (never the app). */
export const loadAllSourcePacks = () => ensureSourcePacks(SOURCE_PACK_IDS);
