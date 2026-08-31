/* Keeps one rotatedImageLayer (lib/rotatedImageLayer.js) per visible site-plan overlay in
 * sync with the `overlays` list — mount/update/teardown, so MapFinder's render effect stays a
 * plain declarative list rather than hand-managing Leaflet layer lifecycles inline (B848848).
 */
import { useEffect, useRef } from "react";
import { createRotatedImageLayer } from "./rotatedImageLayer.js";
import { overlayCornersLatLon } from "../../../shared/sitePlans/lib/overlayGeoref.js";
import { downloadOverlayRasterUrl } from "../../../shared/sitePlans/lib/overlayRasterStorage.js";

// Resolved raster object URLs, cached by Storage key for the tab's lifetime — a raster's
// bytes don't change once anchored, so there is nothing to invalidate here.
const rasterUrlCache = new Map();
async function resolveRasterUrl(key) {
  if (!key) return null;
  if (rasterUrlCache.has(key)) return rasterUrlCache.get(key);
  const p = downloadOverlayRasterUrl(key);
  rasterUrlCache.set(key, p);
  return p;
}

/** `map` — the Leaflet map instance (may be null before it's created). `overlays` — the
 * current site-plan-overlay list. `clickableId` — at most one overlay id that should consume
 * clicks (the others stay click-through); `onOverlayClick(overlay, latlng)` fires for it. */
export function useSitePlanOverlayLayers(map, overlays, clickableId, onOverlayClick) {
  const layersRef = useRef(new Map()); // overlay id -> layer handle
  const clickRef = useRef(onOverlayClick);
  clickRef.current = onOverlayClick;

  useEffect(() => {
    if (!map) return undefined;
    const layers = layersRef.current;
    const seen = new Set();
    for (const o of overlays || []) {
      if (!o.controlPoints || o.controlPoints.length < 2) continue; // not anchored yet — nothing to paint
      seen.add(o.id);
      let handle = layers.get(o.id);
      if (!handle) { handle = createRotatedImageLayer(map); layers.set(o.id, handle); }
      const corners = overlayCornersLatLon(o.controlPoints, o.imgW, o.imgH);
      if (corners) { handle.setCorners(corners); handle.setSize(o.imgW, o.imgH); }
      handle.setOpacity(o.opacity);
      handle.setVisible(o.visible);
      handle.setClickable(o.id === clickableId ? (latlng) => clickRef.current && clickRef.current(o, latlng) : null);
      if (o.rasterKey && !handle._srcSet) {
        handle._srcSet = true;
        resolveRasterUrl(o.rasterKey).then((url) => { if (url) handle.setImage(url); });
      }
    }
    for (const [id, handle] of layers) {
      if (!seen.has(id)) { handle.destroy(); layers.delete(id); }
    }
    return undefined;
  }, [map, overlays, clickableId]);

  // Full teardown when the map itself goes away (route switch).
  useEffect(() => () => { for (const handle of layersRef.current.values()) handle.destroy(); layersRef.current.clear(); }, [map]);
}
