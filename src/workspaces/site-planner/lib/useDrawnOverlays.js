/* The overlay state a MAP SURFACE DRAWS FROM (NEW-1, Imagery & Layers redesign).
 *
 * The app-shared `overlays` is the user's saved choice — what the checkboxes show, what
 * `layerOverrides` persists, what undo restores. What a surface DRAWS is that choice filtered by two
 * things that are not choices: Hide Layers (a session-only pill) and a row that cannot serve this
 * site's location (a layer left ON at a place its source does not cover is kept in saved state and
 * simply not drawn there). Both resolve through the one pure `drawnOverlaysOf`; this hook only adds
 * the memo, so the result keeps the INPUT's identity whenever nothing is filtered (B385040 — three
 * effects key off the overlays object identity and one of them re-stages the whole stack). */
import { useMemo } from "react";
import { ALL_LAYERS } from "./layers.js";
import { drawnOverlaysOf } from "./layerPanelModel.js";
import { useLayersHidden } from "./layerHide.js";

export function useDrawnOverlays(overlays, state, loc) {
  const hideAll = useLayersHidden();
  const lat = loc && Number.isFinite(Number(loc.lat)) ? Number(loc.lat) : null;
  const lng = loc && Number.isFinite(Number(loc.lng)) ? Number(loc.lng) : null;
  return useMemo(
    () => drawnOverlaysOf(overlays, { hideAll, layers: ALL_LAYERS, scope: { state: state || null, loc: lat != null && lng != null ? { lat, lng } : null } }),
    [overlays, hideAll, state, lat, lng],
  );
}
