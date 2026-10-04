/* vectorLabelLayer — NEW-1 (B2018608). Adds the vector roads + labels (MapLibre GL, styled by
 * `vectorStyle.js`) to an EXISTING Leaflet map, below the markers and above the aerial. ONE helper,
 * called by Food and the Site Plan map finder alike, so the two cannot drift (never fork a Food-only
 * copy).
 *
 * Why this shape:
 *   · LAZY. MapLibre is ~800 KB; it is `import()`ed only when a Hybrid map mounts, so it never rides
 *     the entry or the Site/Food boot bundles. Satellite never loads it at all.
 *   · Its own Leaflet PANE (`planyrVectorLabels`, z 250): above the tile pane (200) so labels sit on
 *     the aerial, below overlay (400) / marker (600) panes so pins, parcels, FEMA and drawing tools
 *     all paint above it and labels yield to them. `pointer-events: none` — it can never eat a press.
 *   · Lockstep with Leaflet's zoom/pan animations is the plugin's job (it transforms its canvas on
 *     `zoomanim`); this file adds no view logic of its own (B842528's lesson — no second zoom model).
 *   · LOUD-FAILURE: if the vector source cannot be reached (blocked host, CORS, outage) the map does
 *     not silently lose its road names — it swaps in the old Esri raster road-names overlay and
 *     reports `failed` through `onStatus` so the surface can say so. */
import { VECTOR_SOURCE, ROAD_NAMES_TILES, FALLBACK_LABELS_ATTR, densityTileOptions } from "./basemaps.js";
import { buildVectorStyle, absoluteGlyphsUrl } from "./vectorStyle.js";

export const VECTOR_PANE = "planyrVectorLabels";
const VECTOR_PANE_Z = 250;
/* No `load` within this long ⇒ treat the source as unreachable and fall back. */
const LOAD_DEADLINE_MS = 12000;

/* Pure: the MapLibre constructor options the plugin is handed. Exported so the test can assert the
 * label-collision / non-interactive contract without a browser. */
export function vectorLayerOptions(source = VECTOR_SOURCE, { includePois = true, origin } = {}) {
  const o = origin || (typeof location !== "undefined" ? location.origin : "");
  return {
    style: buildVectorStyle(source, absoluteGlyphsUrl(source, o), { includePois }),
    pane: VECTOR_PANE,
    interactive: false,
    attributionControl: false,
    // The label placement already runs with collision ON in the style; a short fade keeps labels
    // from popping while a zoom settles.
    fadeDuration: 150,
  };
}

function ensurePane(map) {
  let pane = map.getPane(VECTOR_PANE);
  if (!pane) {
    pane = map.createPane(VECTOR_PANE);
    pane.style.zIndex = String(VECTOR_PANE_Z);
    pane.style.pointerEvents = "none";
  }
  return pane;
}

/* `L` is the app's Leaflet; `onStatus("loading" | "ready" | "failed")`. Returns `{ remove, status }`.
 * Safe to call remove() at any moment, including before the lazy chunk has arrived. */
export function addVectorLabels(L, map, { source = VECTOR_SOURCE, includePois = true, onStatus } = {}) {
  let removed = false;
  let status = "loading";
  let glLayer = null;
  let fallback = null;
  let deadline = null;
  const say = (s) => { status = s; try { onStatus && onStatus(s); } catch (_) { /* a status sink must never break the map */ } };

  const useFallback = (why) => {
    if (removed || fallback) return;
    console.error("vectorLabelLayer: vector roads/labels unavailable — using the raster road names", why);
    if (glLayer) { try { map.removeLayer(glLayer); } catch (_) { /* already gone */ } glLayer = null; }
    try {
      fallback = L.tileLayer(ROAD_NAMES_TILES.url, {
        maxZoom: 21, opacity: ROAD_NAMES_TILES.defaultOpacity, zIndex: 2,
        attribution: FALLBACK_LABELS_ATTR,
        ...densityTileOptions(ROAD_NAMES_TILES.maxNative, typeof window !== "undefined" ? window.devicePixelRatio : 1),
      }).addTo(map);
    } catch (e) { console.error("vectorLabelLayer: raster fallback failed too", e); }
    say("failed");
  };

  // The credit OpenFreeMap's terms ask for. Surfaces with Leaflet's own control get it here; Food runs
  // `attributionControl:false` and renders `basemapAttribution()` itself (a no-op here).
  const credit = source.attribution;
  if (map.attributionControl && credit) map.attributionControl.addAttribution(credit);

  (async () => {
    try {
      ensurePane(map);
      const [{ maplibreGL }] = await Promise.all([
        import("@maplibre/maplibre-gl-leaflet"),
        import("maplibre-gl/dist/maplibre-gl.css"),
      ]);
      if (removed) return;
      glLayer = maplibreGL(vectorLayerOptions(source, { includePois })).addTo(map);
      const gl = glLayer.getMaplibreMap();
      let settled = false;
      const ok = () => { if (settled || removed) return; settled = true; clearTimeout(deadline); say("ready"); };
      gl.on("load", ok);
      // An error BEFORE the first load is the style / TileJSON / first tiles failing — the source is
      // unreachable. (A later single-tile 404 is ordinary and is left alone.)
      gl.on("error", (e) => { if (!settled) { settled = true; clearTimeout(deadline); useFallback(e && e.error); } });
      deadline = setTimeout(() => { if (!settled) { settled = true; useFallback(new Error("vector source timed out")); } }, LOAD_DEADLINE_MS);
      // Test/diagnostic handle: the live MapLibre map, read-only use.
      map.__vectorLabelsGL = gl;
    } catch (e) {
      useFallback(e);
    }
  })();

  say("loading");
  return {
    get status() { return status; },
    remove() {
      removed = true;
      clearTimeout(deadline);
      if (map.attributionControl && credit) { try { map.attributionControl.removeAttribution(credit); } catch (_) { /* gone */ } }
      for (const l of [glLayer, fallback]) { if (l) { try { map.removeLayer(l); } catch (_) { /* already gone */ } } }
      glLayer = null; fallback = null;
      if (map.__vectorLabelsGL) delete map.__vectorLabelsGL;
    },
  };
}
