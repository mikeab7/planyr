/* Keeps one rotatedImageLayer (lib/rotatedImageLayer.js) per visible site-plan overlay in sync
 * with the `overlays` list, plus ONE placement-handles controller (lib/overlayPlacementHandles.js)
 * for whichever overlay is currently "active" (armed for direct-manipulation editing) — so
 * MapFinder's render effect stays a plain declarative list rather than hand-managing Leaflet
 * layer lifecycles inline (B848496).
 *
 * Click behavior on an overlay's own image is mode-dependent: while `pinTargetId` names an
 * overlay (the "pin a comp to this plan" flow), only that overlay is clickable and a click
 * reports the map lat/lon (`onPinClick`); otherwise every unlocked, visible overlay is
 * clickable and a click selects it for editing (`onSelect`) — mirroring the Site Planner's own
 * click-to-select-a-reference-image behavior.
 */
import { useEffect, useRef } from "react";
import { createRotatedImageLayer } from "./rotatedImageLayer.js";
import { overlayCornersFromPlacement } from "../../../shared/sitePlans/lib/overlayGeoref.js";
import { overlayPlaced } from "../../../shared/sitePlans/lib/sitePlanOverlays.js";
import { downloadOverlayRasterUrl } from "../../../shared/sitePlans/lib/overlayRasterStorage.js";

// Resolved raster object URLs, cached by Storage key for the tab's lifetime — a raster's
// bytes don't change once placed, so there is nothing to invalidate here.
const rasterUrlCache = new Map();
async function resolveRasterUrl(key) {
  if (!key) return null;
  if (rasterUrlCache.has(key)) return rasterUrlCache.get(key);
  const p = downloadOverlayRasterUrl(key);
  rasterUrlCache.set(key, p);
  return p;
}

/** `map` — the Leaflet map instance (may be null before it's created). `overlays` — the
 * current site-plan-overlay list. `pinTargetId` — at most one overlay id armed for "pin a comp
 * here" clicks; `onPinClick(overlay, latlng)` fires for it. `activeId` — the overlay currently
 * armed for move/scale/rotate editing; `onSelect(id)` fires when the user clicks an inactive
 * overlay's image (to select it); `onCommitPlacement(id, {centerLat,centerLon,ftPerPx,
 * rotationDeg})` fires once per drag gesture, on release. */
export function useSitePlanOverlayLayers(map, overlays, { pinTargetId, onPinClick, activeId, onSelect, onCommitPlacement } = {}) {
  const layersRef = useRef(new Map()); // overlay id -> layer handle
  const handlesRef = useRef(null);
  const cbRef = useRef({});
  cbRef.current = { pinTargetId, onPinClick, activeId, onSelect, onCommitPlacement };
  const stateRef = useRef({ overlays, activeId }); // latest, read by the async-loaded handles controller
  stateRef.current = { overlays, activeId };

  // Arms/disarms the placement-handles controller for whichever overlay is currently active.
  // Called from both effects below (the image-layer sync, and once the handles module itself
  // finishes loading) so an overlay armed for editing before the lazy chunk arrives still gets
  // its handles shown the instant it does, rather than waiting for an unrelated re-render.
  const syncHandles = () => {
    const h = handlesRef.current;
    if (!h) return;
    const layers = layersRef.current;
    const { overlays: ovs, activeId: aid } = stateRef.current;
    const active = (ovs || []).find((o) => o.id === aid && o.visible !== false && overlayPlaced(o));
    if (active) {
      h.show(active, active.imgW, active.imgH, {
        onLive: (placement) => {
          const layer = layers.get(active.id);
          if (!layer) return;
          const corners = overlayCornersFromPlacement(placement, active.imgW, active.imgH);
          if (corners) { layer.setCorners(corners); layer.setSize(active.imgW, active.imgH); }
        },
        onCommit: (placement) => { cbRef.current.onCommitPlacement && cbRef.current.onCommitPlacement(active.id, placement); },
      });
    } else {
      h.hide();
    }
  };

  // The move/scale/rotate CHROME is a real, if small, chunk of Leaflet-adjacent code that most
  // visits to the Site route never touch (no site plan armed for editing) — dynamic-imported so
  // it never rides the eager Site-route bundle, matching every other rarely-needed piece of this
  // file's own critical-path discipline (see B1064's tracked bundle-budget note).
  useEffect(() => {
    if (!map) return undefined;
    let cancelled = false;
    import("./overlayPlacementHandles.js").then(({ createPlacementHandles }) => {
      if (cancelled) return;
      handlesRef.current = createPlacementHandles(map);
      syncHandles();
    });
    return () => {
      cancelled = true;
      handlesRef.current?.destroy();
      handlesRef.current = null;
    };
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!map) return undefined;
    const layers = layersRef.current;
    const seen = new Set();
    for (const o of overlays || []) {
      if (!overlayPlaced(o)) continue; // not placed yet — nothing to paint
      seen.add(o.id);
      let handle = layers.get(o.id);
      if (!handle) { handle = createRotatedImageLayer(map); layers.set(o.id, handle); }
      const corners = overlayCornersFromPlacement(o, o.imgW, o.imgH);
      if (corners) { handle.setCorners(corners); handle.setSize(o.imgW, o.imgH); }
      handle.setOpacity(o.opacity);
      handle.setVisible(o.visible);
      if (pinTargetId === o.id) {
        handle.setClickable((latlng) => cbRef.current.onPinClick && cbRef.current.onPinClick(o, latlng));
      } else if (!o.locked && !pinTargetId) {
        handle.setClickable(() => cbRef.current.onSelect && cbRef.current.onSelect(o.id));
      } else {
        handle.setClickable(null);
      }
      if (o.rasterKey && !handle._srcSet) {
        handle._srcSet = true;
        resolveRasterUrl(o.rasterKey).then((url) => { if (url) handle.setImage(url); });
      }
    }
    for (const [id, handle] of layers) {
      if (!seen.has(id)) { handle.destroy(); layers.delete(id); }
    }

    syncHandles();
    return undefined;
  }, [map, overlays, activeId, pinTargetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Full teardown when the map itself goes away (route switch).
  useEffect(() => () => { for (const handle of layersRef.current.values()) handle.destroy(); layersRef.current.clear(); }, [map]);
}
