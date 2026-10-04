/* The city-name GATE, alone in a leaf module (NEW-2, 2026-09-29) — the boot-bundle-safe half.
 *
 * Same shape as `adminBoundaryGate.js`: one comparison the map finder needs at boot ("do city
 * names belong on screen at this zoom at all?"), while the thing it gates
 * (`placeNamesLayer.js` + the name datasets) is reached only through the dynamic import below
 * and never rides the boot bundle. This file imports nothing.
 *
 * THE BAND, plain terms:
 *   zoom 3..13   city / town names. Which names, at which zoom, is `placeNamesData.js`
 *                (big cities first, smaller towns as you close in).
 *   zoom >= 14   nothing. 14 is PARCEL_MINZOOM (parcelDisplayZoom.js), the first zoom at
 *                which any parcel draws, and it is also where the road-name tiles start
 *                (PLACE_NAMES_MIN_ZOOM). The names are gone the moment site work owns the
 *                screen — the plan must stay the most legible thing on it — and they fade
 *                across the last zoom step before that (`placeNamesOpacity`) rather than
 *                vanishing in one jump. No dataset is fetched at 14+.
 * Kept as its own literal (not imported from parcelDisplayZoom) so this leaf stays
 * dependency-free; test/placeNames.test.js pins it to PARCEL_MINZOOM so the two cannot drift.
 */
export const PLACE_NAMES_MIN_ZOOM_LAYER = 3;
export const PLACE_NAMES_MAX_ZOOM = 13;

/* True when city names belong on screen at all. `zoom` may be null before the map has
 * reported one, which must read as "nothing yet", never as zoom 0. */
export const placeNamesVisible = (zoom) =>
  typeof zoom === "number" && zoom >= PLACE_NAMES_MIN_ZOOM_LAYER && zoom <= PLACE_NAMES_MAX_ZOOM;

/* Attach the layer to a map, loading the chunk on first use. Idempotent per map, cached
 * module promise, failed load clears the cache — the `adminBoundaryGate.js` contract. */
let loading = null;
export function attachPlaceNames(map) {
  if (!map) return Promise.resolve(null);
  if (!loading) {
    loading = import("./placeNamesLayer.js").catch((e) => { loading = null; throw e; });
  }
  return loading.then((m) => m.attachPlaceNames(map), () => null);
}

/* ⛔ ONE LABEL PER CITY (NEW-2, 2026-09-30 — owner-reported live on planyr.io: Lewisville, Flower Mound, Carrollton,
 * Coppell, Southlake, The Colony and Hebron each read TWICE, stacked).
 *
 * Two independent passes label a city in the same zoom band (10-13): this layer's canvas names and the
 * city-limits overlay's own labels. Neither knew about the other. The canvas layer is the better instrument
 * (hysteresis, fades, its own zoom animation), so IT keeps every name it is showing, and the city-limits layer
 * drops exactly those — a city the canvas layer left out (collision, not in its dataset) still gets the boundary
 * label, so no city LOSES its name.
 *
 * This registry is the seam. It lives in THIS leaf (imports nothing, already on the boot path) because the
 * canvas layer is a lazy chunk nothing on the boot path may static-import, and the overlay must be able to ask
 * without importing it. `setPlaceNamesShown` also fires `pf:placenames` on the map so the overlay re-places
 * its labels the moment the canvas layer's set changes (the two settle on different frames). */
const shownByMap = new WeakMap();
export const placeNameKey = (name) => String(name == null ? "" : name).trim().toLowerCase();
export function setPlaceNamesShown(map, names) {
  if (!map) return;
  shownByMap.set(map, names instanceof Set ? names : new Set(names || []));
  try { map.fire && map.fire("pf:placenames"); } catch (_) { /* a torn-down map must not throw from a draw frame */ }
}
/* The set of (placeNameKey-normalised) names the canvas layer is currently drawing on `map`; empty when it is
 * off, not attached, or not yet loaded. Never null, so a caller needs no guard. */
export const placeNamesShown = (map) => (map && shownByMap.get(map)) || new Set();
