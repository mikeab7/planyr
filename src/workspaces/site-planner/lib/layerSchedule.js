/* layerSchedule — the order GIS overlays are allowed to start loading in, and how many at
 * a time (NEW-3). Pure policy; the idle scheduling itself lives in SitePlanner.
 *
 * WHY. Restoring a site's previously-enabled overlays fired 465 requests across 17 hosts in
 * one pass (planyr.io 180, services.arcgis.com 123, and fifteen more) — all of it competing
 * with the very first paint. The map must be DRAWN and DRAGGABLE first; overlays fill in
 * behind an already-usable map, in the order that matters most to a screening decision.
 *
 * The order is by what a developer looks at first, not by cost: what constrains the deal
 * (flood, pipelines) before what merely describes it (imagery vintage, street-level photos).
 * Within a tier the caller's own order is preserved, so a layer never jumps around between
 * sessions.
 */

/* Highest tier first. A layer kind or id not named here lands in the default tier. */
const TIER_BY_KIND = {
  esriImage: 1,      // FEMA flood, wetlands, relief — the deal-shaping rasters
  dynamic: 1,
  vector: 2,         // jurisdiction / county / ETJ boundaries
  vectorLine: 2,     // pipelines
  pipelineCorridor: 2,
  esriFeature: 3,
  contours: 4,       // client-computed terrain — expensive, rarely the first question
  flowdir: 4,
  overpass: 5,       // crowd sources — slowest, least decisive
  mapillary: 5,
};

/* Ids that outrank their kind: flood and pipelines are what a site dies on. */
const PRIORITY_IDS = new Set(["fema_nfhl", "fema_flood", "floodplain", "pipelines", "pipeline_corridor"]);

export const layerTier = (id, cfg) => {
  if (PRIORITY_IDS.has(id)) return 0;
  const t = TIER_BY_KIND[cfg && cfg.kind];
  return Number.isFinite(t) ? t : 3;
};

/* How many layers may begin loading per idle slice. Small enough that the connection is
 * never flooded (which is what starved the coarse basemap backfill), big enough that a
 * fully-enabled panel finishes in a couple of seconds. */
export const LAYER_STAGE_SIZE = 4;

/* The ids that are ON, in the order they should be admitted. Stable: equal-tier layers keep
 * the registry's own order, so the sequence is the same every session. */
export function orderLayersByPriority(overlays, allLayers) {
  const ids = Object.keys(allLayers || {}).filter((k) => overlays && overlays[k] && overlays[k].on);
  return ids
    .map((id, i) => ({ id, i, tier: layerTier(id, allLayers[id]) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .map((x) => x.id);
}

/* The set admitted once `staged` slices have run. Exported so the test can assert the
 * staging actually widens rather than replacing. */
export function admittedAfter(order, staged, stageSize = LAYER_STAGE_SIZE) {
  return new Set(order.slice(0, Math.max(0, staged) * stageSize));
}
