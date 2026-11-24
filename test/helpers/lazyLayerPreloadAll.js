/* TEST-ONLY (aliased over lazyLayerPreload.js by vitest.config.js): every lazy layer file imported, so the unit suites see the full registry synchronously.
 * Imported DYNAMICALLY (top-level await) and only when the preload is wanted: a layer file reads its GIS_SOURCES rows at module load (batch K stage 3), so a suite that
 * asks for the production-shaped "nothing loaded yet" registry (globalThis.__PLANYR_NO_LAZY_PRELOAD__ — test/lazyLayerRegistry.test.js, test/sourcePacks.test.js, after
 * vi.resetModules()) must not evaluate them here. */
const LIB = "../../src/workspaces/site-planner/lib/";
const NO = !!globalThis.__PLANYR_NO_LAZY_PRELOAD__;
const mods = NO ? [] : await Promise.all([
  import(LIB + "desotoLayers.js"),
  import(LIB + "sugarLandLayers.js"),
  import(LIB + "fortBendLayers.js"),
  import(LIB + "nashvilleLayers.js"),
  import(LIB + "nashvilleBufferLayers.js"),
  import(LIB + "georgiaLayers.js"),
  import(LIB + "coloradoLayers.js"),
  import(LIB + "tennesseeLayers.js"),
  import(LIB + "mississippiLayers.js"),
  import(LIB + "floridaLayers.js"),
  import(LIB + "oklahomaLayers.js"),
  import(LIB + "chambersLayers.js"),
  import(LIB + "houstonMetroLayers.js"),
  import(LIB + "txCityZoningLayers.js"),
  import(LIB + "wallerLayers.js"),
]);
export const PRELOADED = NO ? null : {
  desoto: mods[0],
  sugarland: mods[1],
  fortbend: mods[2],
  nashville: mods[3],
  nashvilleBuffers: mods[4],
  georgia: mods[5],
  colorado: mods[6],
  tennessee: mods[7],
  mississippi: mods[8],
  florida: mods[9],
  oklahoma: mods[10],
  chambers: mods[11],
  houstonMetro: mods[12],
  txCityZoning: mods[13],
  waller: mods[14],
};
