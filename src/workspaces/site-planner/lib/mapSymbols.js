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
import { pointSymbolOptions } from "./layerRequest.js";

/* The fallback pin, as an inline SVG data URI rather than Leaflet's bundled PNGs.
 *
 * WHY NOT THE PNGs. Importing leaflet's three marker images is the obvious fix, and it works — but
 * each is under Vite's 4 KB `assetsInlineLimit`, so all three base64-inline into the planner chunk:
 * ~6 KB of JS on the site route's critical path, permanently, for images that should never be
 * fetched at all. Both Vite-5 ways of emitting them as separate files were tried and neither works
 * on this version (`?no-inline` is Vite 6; `new URL(…, import.meta.url)` against a node_modules
 * path emits nothing), and a silently-broken fallback would be worse than a heavy one.
 *
 * So the requirement was re-read rather than brute-forced. What this has to guarantee is that an
 * accidental default marker "degrades to a REAL PIN instead of a broken image" — not that it is
 * byte-identical to Leaflet's blue pin. A hand-authored teardrop does that in ~400 bytes instead of
 * ~6 KB: same guarantee, 1/15th the cost, no vendored copies of a dependency's assets to drift out
 * of sync with the leaflet version. URL-encoded (not base64) because it is both smaller and legible
 * in a diff. Deliberately uses the danger token's hue so a pin that DOES appear reads as "something
 * forgot its symbol", i.e. it is a visible bug report rather than a silently plausible marker. */
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">'
  + '<path d="M12.5 0.5C6 .5.75 5.75.75 12.25.75 21 12.5 40.5 12.5 40.5S24.25 21 24.25 12.25C24.25 5.75 19 .5 12.5.5z"'
  + ' fill="%23b91c1c" stroke="%23fff" stroke-width="1.5"/>'
  + '<circle cx="12.5" cy="12" r="4.5" fill="%23fff"/></svg>';
const PIN_URI = `data:image/svg+xml,${PIN_SVG}`;
const iconUrl = PIN_URI, iconRetinaUrl = PIN_URI;

let installed = false;

/* Give L.Icon.Default an image URL that actually resolves. Idempotent (Leaflet's default icon is
 * global state, so it only ever needs doing once) and safe to call from any module that might
 * create the first marker. */
export function installDefaultMarkerIcon() {
  if (installed) return;
  installed = true;
  try {
    // `_getIconUrl` is Leaflet's own path-guessing hook; it derives a URL from the <script>
    // location, which is meaningless under a bundler. mergeOptions supplies the resolved
    // URLs instead, and deleting the hook stops Leaflet preferring its guess.
    delete L.Icon.Default.prototype._getIconUrl;
    // shadowUrl null on purpose: Leaflet appends a SECOND <img> for the shadow, and a fallback
    // has no business adding a second request (or a second thing that can fail to load).
    L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl: null });
  } catch (_) { /* a leaflet build without Icon.Default is not worth crashing the map over */ }
}

/* The `pointToLayer` for a layer config: a circleMarker in the source's own colour, sized
 * from `pointSymbolOptions` (pure). `interactive` follows the layer — an interactive layer's
 * points must accept pointer events for the hover identify to fire on them. */
export function pointToLayerFor(cfg, opacity, { interactive = false } = {}) {
  return (_feature, latlng) => L.circleMarker(latlng, { ...pointSymbolOptions(cfg, opacity), interactive });
}
