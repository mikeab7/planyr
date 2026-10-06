/* NEW-1 (B2112576) — the React half of the "layer hidden at this zoom" toast, shared by the project
 * canvas (SitePlanner) and the Map/Select-a-project overview (MapFinder) so the two surfaces cannot
 * hold two copies of the rule. The decision itself is the pure `nextHiddenToast`
 * (layerHiddenToast.js); this only feeds it the live zoom + the overlays on a short SETTLE debounce
 * (a gesture hovering at a gate cannot flicker toasts) and speaks through the shared toast stack.
 *
 *   enabled   — false while the surface is hidden/inactive/not yet at its real framed view
 *   zoom      — the surface's live zoom (Leaflet zoom units), null until known
 *   overlays  — the app-shared `{ [layerId]: { on } }` map
 *   pushToast / dismissByKey — from useToasts()
 *   zoomTo    — (targetZoom) => void; the surface's own animated zoom to a level inside the range
 *
 * When the last hidden layer starts drawing again (zoomed in by wheel, say) the toast is withdrawn
 * rather than left claiming something that is no longer true.
 */
import { useEffect, useRef } from "react";
import { ALL_LAYERS } from "./layers.js";
import { nextHiddenToast } from "./layerHiddenToast.js";

export const LAYER_HIDDEN_TOAST_KEY = "layer-hidden-at-zoom";
export const LAYER_HIDDEN_SETTLE_MS = 250;

export function useLayerHiddenToast({ enabled, zoom, overlays, pushToast, dismissByKey, zoomTo }) {
  const announcedRef = useRef(null);
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;
  useEffect(() => {
    if (!enabled || typeof zoom !== "number") return undefined;
    const t = setTimeout(() => {
      const layers = Object.keys(overlays || {}).map((id) => ({ id, cfg: ALL_LAYERS[id], on: !!overlays[id]?.on }));
      const r = nextHiddenToast(announcedRef.current, layers, zoom);
      announcedRef.current = r.announced;
      if (r.toast) {
        const { action } = r.toast;
        pushToast({
          text: r.toast.text, dedupeKey: LAYER_HIDDEN_TOAST_KEY,
          action: action ? { label: action.label, onClick: () => zoomToRef.current && zoomToRef.current(action.target, action.label) } : null,
        });
      } else if (r.announced.size === 0 && dismissByKey) {
        dismissByKey(LAYER_HIDDEN_TOAST_KEY);
      }
    }, LAYER_HIDDEN_SETTLE_MS);
    return () => clearTimeout(t);
  }, [enabled, zoom, overlays]); // eslint-disable-line react-hooks/exhaustive-deps
}
