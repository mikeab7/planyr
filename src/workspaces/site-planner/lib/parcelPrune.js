/* B1976336 — release outline features esri-leaflet would hold forever. See makeParcelLayer in parcelDisplay.js. */
/* Drop every feature esri-leaflet holds that no CURRENT cell covers, and forget the cells (and their
 * cached id lists) that left, so returning to them re-requests instead of re-adding nothing. Reaches
 * three private fields of esri-leaflet's FeatureManager (`_cells`, `_cache`, `_activeCells`,
 * `_currentSnapshot`); every access is guarded so a library change degrades to "no prune", never a
 * throw. Pure (no Leaflet import) so it is unit-testable. Returns how many features were dropped. */
export function pruneToLiveCells(layer) {
  const cells = layer._cells, cache = layer._cache, layers = layer._layers;
  if (!cells || !cache || !layers || typeof layer.removeLayers !== "function") return 0;
  const cellKeyToCache = (key) => { // `_cells` keys are "x:y:z"; `_cache` keys are "z:x:y"
    const [x, y, z] = String(key).split(":");
    return `${z}:${x}:${y}`;
  };
  const live = new Set();
  Object.keys(cells).forEach((k) => (cache[cellKeyToCache(k)] || []).forEach((id) => live.add(id)));
  const liveCacheKeys = new Set(Object.keys(cells).map(cellKeyToCache));
  const liveStr = new Set([...live].map(String));
  const drop = Object.keys(layers).filter((id) => !liveStr.has(String(id)));
  if (drop.length) layer.removeLayers(drop, true);
  Object.keys(cache).forEach((ck) => { if (!liveCacheKeys.has(ck)) delete cache[ck]; });
  if (layer._activeCells) Object.keys(layer._activeCells).forEach((k) => { if (!cells[k]) delete layer._activeCells[k]; });
  if (Array.isArray(layer._currentSnapshot)) layer._currentSnapshot = layer._currentSnapshot.filter((id) => layers[id]);
  return drop.length;
}
