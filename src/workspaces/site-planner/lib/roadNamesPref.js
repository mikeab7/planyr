/* Road names on the planner canvas — the DEVICE-LEVEL on/off + opacity memory (NEW-1).
 *
 * Deliberately a device pref, not per-site memory: `layerOverrides` is a sparse boolean map of GIS
 * overlays whose every consumer (undo frames, merges, the cloud row) speaks plain booleans, and the
 * road-name layer is a reference label, not a GIS overlay — a numeric opacity there would be a new
 * site-model field for a presentation taste. Per-viewer convenience only: every access is guarded,
 * and a blocked/empty store simply yields the defaults (labels ON, the finder's opacity). Pure. */
import { ROAD_NAMES_TILES } from "../../../shared/basemaps/basemaps.js";

export const ROAD_NAMES_PREF_KEY = "planyr:roadNames";
export const ROAD_NAMES_DEFAULT = { on: true, opacity: ROAD_NAMES_TILES.defaultOpacity };

export function normalizeRoadNamesPref(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const op = Number(o.opacity);
  return {
    on: typeof o.on === "boolean" ? o.on : ROAD_NAMES_DEFAULT.on,
    opacity: Number.isFinite(op) && op >= 0 && op <= 1 ? op : ROAD_NAMES_DEFAULT.opacity,
  };
}

export function loadRoadNamesPref(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try { return normalizeRoadNamesPref(JSON.parse(storage.getItem(ROAD_NAMES_PREF_KEY))); }
  catch (_) { return { ...ROAD_NAMES_DEFAULT }; }
}

export function saveRoadNamesPref(pref, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try { storage.setItem(ROAD_NAMES_PREF_KEY, JSON.stringify(normalizeRoadNamesPref(pref))); return true; }
  catch (_) { return false; }
}
