/* Leaflet point symbology for the shared map layers (NEW-1).
 *
 * THE BUG THIS FIXES. A GeoJSON POINT handed to `L.geoJSON` — or to esri-leaflet's
 * `featureLayer`, which delegates to `L.GeoJSON.geometryToLayer` — with NO `pointToLayer`
 * gets Leaflet's documented default: `L.marker(latlng)` wearing `L.Icon.Default`. Nothing in
 * this repo ever configured `L.Icon.Default`'s image paths for the bundler, so that icon's
 * PNG 404s and the browser paints its broken-image glyph plus the marker's alt text — the
 * string "Marker", clipped by the icon box to read "Mark". That is exactly what the owner saw
 * standing where the HIFLD substations should be: two broken-image icons labelled "Mark".
 *
 * Every OTHER `L.marker` call site in the repo passes an explicit icon (MapFinder's
 * `sitePinIcon`, terrainLayers' `labelIcon`, vectorOverlay's label `divIcon`), which is why
 * ONLY GeoJSON point features were affected — and substations are points.
 *
 * TWO fixes live here, deliberately belt-and-braces:
 *   1. `pointToLayerFor` — the real fix. A point becomes a styled `L.circleMarker` in the
 *      source's own colour/weight, exactly how evidenceLayers.js already draws OSM power
 *      points, so a point reads as a deliberate symbol rather than a dropped pin. Routing
 *      points through `pointToLayer` ALSO makes them ordinary interactive vector layers, so
 *      the hover identify (NEW-2) reaches them with no extra wiring.
 *   2. `installDefaultMarkerIcon` — the safety net. Points `L.Icon.Default` at the real
 *      bundled PNGs so that if a future call site ever forgets `pointToLayer` again, it
 *      degrades to an honest pin instead of a broken image.
 *
 * Kept in its own tiny module because it imports leaflet: `layerRequest.js` is deliberately
 * leaflet-free (it must stay unit-testable in the node test env), so the PURE half of this —
 * `pointSymbolOptions` — lives there and this module only supplies the leaflet glue.
 */
import L from "leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import { pointSymbolOptions } from "./layerRequest.js";

let installed = false;

/* Give L.Icon.Default real, bundler-resolved image URLs. Idempotent (Leaflet's default
 * icon is global state, so it only ever needs doing once) and safe to call from any module
 * that might create the first marker. */
export function installDefaultMarkerIcon() {
  if (installed) return;
  installed = true;
  try {
    // `_getIconUrl` is Leaflet's own path-guessing hook; it derives a URL from the <script>
    // location, which is meaningless under a bundler. mergeOptions supplies the resolved
    // URLs instead, and deleting the hook stops Leaflet preferring its guess.
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });
  } catch (_) { /* a leaflet build without Icon.Default is not worth crashing the map over */ }
}

/* The `pointToLayer` for a layer config: a circleMarker in the source's own colour, sized
 * from `pointSymbolOptions` (pure). `interactive` follows the layer — an interactive layer's
 * points must accept pointer events for the hover identify to fire on them. */
export function pointToLayerFor(cfg, opacity, { interactive = false } = {}) {
  return (_feature, latlng) => L.circleMarker(latlng, { ...pointSymbolOptions(cfg, opacity), interactive });
}
