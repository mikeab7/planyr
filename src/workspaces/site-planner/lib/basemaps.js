/* Shared aerial basemap SOURCE registry (B693) — the single list of free aerial
 * imagery sources, used by BOTH surfaces: the map finder's Imagery dropdown and the
 * planner's Basemap control (Off / Aerial / USGS in the shared Layers panel), so the
 * two never offer different choices. Moved here from MapFinder.jsx when the planner
 * gained a source picker; the planner's old single-source GEO_BASEMAP constant was
 * retired into BASEMAPS.esri (same tiles/ceiling/attribution).
 *
 * Free aerial sources (no API key). Both are ArcGIS MapServers that support
 * both XYZ tiles (for the map) and `export` (for the planner underlay capture).
 * `maxNative` = each provider's native imagery ceiling (Esri z19 ≈ 0.3 m/px; USGS
 * z16). This is REQUIRED per source and must not be dropped in a refactor: past its
 * ceiling a provider returns the gray "Map data not yet available" placeholder as an
 * HTTP 200 (not an error), so Leaflet's error-tile fallback never fires and the whole
 * view goes blank. The consuming imagery layers clamp fetches to this ceiling (minus
 * the retina offset) and let maxZoom upscale the deepest real tile beyond it. Any new
 * source MUST carry its own `maxNative`. (B220 — recurrence of B182)
 */
export const BASEMAPS = {
  esri: {
    label: "Esri",
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    export: "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export",
    maxNative: 19,
    attr: "Imagery &copy; Esri, Maxar",
  },
  usgs: {
    label: "USGS",
    tiles: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    export: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export",
    maxNative: 16,
    attr: "Imagery &copy; USGS",
  },
};

/* The planner Basemap control's choices, in display order. "off" is a planner-only
 * state (no backdrop — the drafting paper shows); the map finder always has a base. */
export const PLANNER_BASEMAP_CHOICES = [
  { key: "off", label: "Off", title: "No aerial — plain drafting background" },
  { key: "esri", label: "Aerial", title: "Esri World Imagery — sharpest at deep zoom (native to z19)" },
  { key: "usgs", label: "USGS", title: "USGS imagery — federal source; tops out around neighborhood zoom (native to z16)" },
];
