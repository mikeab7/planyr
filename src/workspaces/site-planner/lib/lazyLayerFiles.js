/* The per-state layer files that load ON DEMAND (batch K stage 1, 2026-11-23) — NOT in the Site route's first download.
 *
 * Each file declares a whole state's / county's map layers. They used to be imported statically by layers.js, which put ~330 KB of
 * minified code in front of every first paint although a Houston site never needs Colorado's. Now layers.js holds a slim, GENERATED
 * index of their ids (lazyLayerIndex.generated.js) and loads a file when something needs its rows: a layer of it is switched on, the
 * Layers panel opens on a site in its state, Site Analysis offers one of its pills, or an export draws it.
 *
 * ORDER IS THE PAINT / PANEL ORDER. ALL_LAYERS' key order is the on-screen paint order (exportSheet.js), so this array's order is the order
 * the rows had when they were static — layers.js re-sorts the registry into it after every load, so loading Colorado after Georgia can never
 * change which of two overlapping layers is on top. `mergeRank` is the same for MERGE_GROUPS.
 *
 * ⛔ Adding a file: add it HERE, run `npm run layer-index` (regenerates lazyLayerIndex.generated.js — test/lazyLayerRegistry.test.js fails
 * until you do), and never import the file statically from an eager module (test/lazyLayerRegistry.test.js sweeps for that too). A
 * constant an eager module needs lives in a small side file the layer file re-exports (oklahomaStatic.js, niceCase.js, pipeSizeLabel.js). */
export const LAZY_LAYER_FILES = [
  { key: "desoto", load: () => import("./desotoLayers.js"), pick: (m) => ({ layers: m.DESOTO_LAYERS, vintage: m.DESOTO_VINTAGE }) },
  { key: "sugarland", mergeRank: 2, load: () => import("./sugarLandLayers.js"), pick: (m) => ({ layers: m.SUGARLAND_LAYERS, vintage: m.SUGARLAND_VINTAGE, merge: m.SUGARLAND_MERGE_GROUPS }) },
  { key: "fortbend", mergeRank: 3, load: () => import("./fortBendLayers.js"), pick: (m) => ({ layers: m.FORTBEND_LAYERS, vintage: m.FORTBEND_VINTAGE, merge: m.FORTBEND_MERGE_GROUPS }) },
  { key: "nashville", load: () => import("./nashvilleLayers.js"), pick: (m) => ({ layers: m.NASHVILLE_LAYERS, vintage: m.NASHVILLE_VINTAGE }) },
  { key: "nashvilleBuffers", mergeRank: 4, load: () => import("./nashvilleBufferLayers.js"), pick: (m) => ({ layers: m.NASHVILLE_BUFFER_LAYERS, merge: m.NASHVILLE_BUFFER_MERGE_GROUPS }) },
  { key: "georgia", mergeRank: 5, load: () => import("./georgiaLayers.js"), pick: (m) => ({ layers: m.GEORGIA_LAYERS, vintage: m.GEORGIA_VINTAGE, merge: m.GEORGIA_MERGE_GROUPS }) },
  { key: "colorado", load: () => import("./coloradoLayers.js"), pick: (m) => ({ layers: m.COLORADO_LAYERS, vintage: m.COLORADO_VINTAGE }) },
  { key: "tennessee", mergeRank: 6, load: () => import("./tennesseeLayers.js"), pick: (m) => ({ layers: m.TN_LAYERS, merge: m.TN_MERGE_GROUPS }) },
  { key: "mississippi", load: () => import("./mississippiLayers.js"), pick: (m) => ({ layers: m.MISSISSIPPI_LAYERS, vintage: m.MISSISSIPPI_VINTAGE }) },
  { key: "florida", load: () => import("./floridaLayers.js"), pick: (m) => ({ layers: m.FLORIDA_LAYERS, vintage: m.FLORIDA_VINTAGE }) },
  { key: "oklahoma", mergeRank: 1, load: () => import("./oklahomaLayers.js"), pick: (m) => ({ layers: m.OK_LAYERS, vintage: m.OK_VINTAGE, merge: m.OK_MERGE_GROUPS }) },
  { key: "chambers", mergeRank: 7, load: () => import("./chambersLayers.js"), pick: (m) => ({ layers: m.CHAMBERS_LAYERS, vintage: m.CHAMBERS_VINTAGE, merge: m.CHAMBERS_MERGE_GROUPS }) },
  { key: "houstonMetro", load: () => import("./houstonMetroLayers.js"), pick: (m) => ({ layers: m.HOUSTON_METRO_LAYERS, vintage: m.HOUSTON_METRO_VINTAGE }) },
  { key: "txCityZoning", load: () => import("./txCityZoningLayers.js"), pick: (m) => ({ layers: m.TX_CITY_ZONING_LAYERS, vintage: m.TX_CITY_ZONING_VINTAGE }) },
];
