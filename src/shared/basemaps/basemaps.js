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

/* B427410 — the MAP FINDER's basemap choices, and they are DERIVED FROM `BASEMAPS` rather than
 * written out again.
 *
 * Owner: "do I really need one that just says imagery? Should that not maybe be a background
 * layer itself, so I can choose between Esri or whatever else?" — he is right, and the planner
 * had already answered it: its aerial source is a row inside the Layers panel's Base & terrain
 * group. The finder was the surface left behind, with a separate `Imagery` dropdown in its own
 * strip ABOVE the layer list, divided off from the group the choice belongs to. Passing these
 * through `LayerPanel`'s existing `basemap` prop is what folds it in, so the two surfaces now
 * offer the same choice in the same place.
 *
 * ⛔ DERIVED, not a second literal. The planner's list is hand-written because it carries an
 * "off" state that is not a basemap at all (no backdrop — the drafting paper shows). The finder
 * has no such state: its map always has a base, and an "off" there would just be a blank screen.
 * Everything else is exactly the registry, so mapping it is what guarantees a source added to
 * `BASEMAPS` appears on the finder without anyone remembering to add it here too — which is the
 * mistake the hand-written dropdown was one edit away from making. */
export const FINDER_BASEMAP_CHOICES = Object.entries(BASEMAPS).map(([key, b]) => ({
  key,
  label: b.label,
  title: b.attr ? `${b.label} imagery — ${b.attr.replace(/&copy;/g, "©")}` : b.label,
}));

/* ───────────────────────── NEW-1 (Food map) — the SITE PLAN MAP, defined once ─────────────────────────
 *
 * Owner: "we should default to the site plan module map for the food module, and a good hybrid
 * option as an option." One source of truth: the map the Site Plan module opens on is DEFINED HERE
 * and every surface that wants "the Site Plan map" imports this object — the map finder and the
 * planner canvas read their default aerial source from `SITE_PLAN_BASEMAP.imageryKey`, the finder
 * reads its road-names layer from `ROAD_NAMES_TILES`, and /food builds its default from the whole
 * `SITE_PLAN_BASEMAP`. Change it here and all of them follow. (`test/basemapsShared.test.js` fails
 * if any of them re-inlines a copy.)
 *
 * ⛔ This file lives in `src/shared/`, NOT in site-planner: /food may import nothing from
 * `src/workspaces/site-planner/` (BUNDLE ISOLATION — see the food CLAUDE.md), and a basemap
 * registry is exactly the kind of tiny, dependency-free thing that belongs on neutral ground. */

/* Esri's TRANSPORTATION reference layer — road, highway and rail names + shields. No city or
 * landmark names (those are `PLACE_NAMES_TILES` below). */
export const ROAD_NAMES_TILES = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
  maxNative: 19,
  /* B427410 (×3) — measured: at 0.4 a label's glyph and its white halo fade together into a grey
   * smudge over busy aerial; at 0.85 it reads as crisp as 1.0. */
  defaultOpacity: 0.85,
};

/* Esri's BOUNDARIES-AND-PLACES reference layer — city / neighbourhood / landmark names, drawn
 * with their own halo. Used by the Hybrid basemap. Same host, same key-less terms as the rest. */
export const PLACE_NAMES_TILES = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  maxNative: 19,
};

/* ───────────────────────── NEW-1 (B2018608) — VECTOR roads + labels ─────────────────────────
 *
 * Owner: the raster Esri reference overlay "looks kind of lame, like just the way all the streets
 * pop up. It doesn't look as clean as Apple Maps." Roads and labels are now drawn client-side from
 * VECTOR tiles (MapLibre GL inside the existing Leaflet maps) over the raster imagery. This block
 * is the ONE config entry for that source — swapping providers (MapTiler, Protomaps, a self-hosted
 * PMTiles file) means editing this object and nothing else; the style in `vectorStyle.js` only
 * assumes the OpenMapTiles schema, and no map code names a host.
 *
 * ⛔ No API key lives here or anywhere in the repo. OpenFreeMap needs none; if a swap ever does, it
 * goes in the Cloudflare dashboard env vars (never wrangler.toml, never a `VITE_` var in chat). */
export const VECTOR_SOURCE = {
  id: "openfreemap",
  schema: "openmaptiles",
  /* TileJSON — MapLibre resolves tile URLs, zoom range and bounds from it. */
  tilejson: "https://tiles.openfreemap.org/planet",
  /* Self-hosted (public/map-assets/fonts, Noto Sans — SIL OFL): glyph lookups never leave the
   * origin, so label text does not depend on a third-party font host. Root-relative; resolved to
   * an absolute URL at runtime because the MapLibre worker cannot resolve a relative one. */
  glyphs: "/map-assets/fonts/{fontstack}/{range}.pbf",
  /* OpenFreeMap's terms ask for exactly this credit line (OpenFreeMap + OpenMapTiles + OSM). */
  attribution:
    '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
    '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
    'data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
};

/* The map's own zoom is Leaflet's (256-px tile) numbering; MapLibre counts 512-px tiles, so its zoom
 * is one LOWER at the same view. The style is written in LEAFLET zoom (what an owner sees) and
 * `vectorStyle.js` subtracts this. */
export const VECTOR_ZOOM_OFFSET = 1;

/* Leaflet zoom from which road NAMES draw. Lives here (not in vectorStyle.js) so the Layers panel's
 * "not showing at this zoom" note can read it without pulling the style module onto the Site route. */
export const ROAD_NAMES_FROM = 11;

/* The pre-vector raster reference overlays survive ONLY as the fallback when the vector source
 * cannot be reached (LOUD-FAILURE: the map must not silently lose its road names). */
const LABELS_ATTR = "Labels &copy; Esri";

/* Tone grade for raw aerial — a little darker and a little less saturated, so roads, labels and pins
 * read on top (Apple does the same). Applied as a CSS filter on the on-screen imagery layer ONLY;
 * the Site Plan PDF/image export stitches its own canvas from the source tiles and is never graded
 * (a graded aerial in an exhibit would misrepresent the site — B550512 path left untouched). */
export const IMAGERY_GRADE = { className: "planyr-imagery-graded", containerClass: "planyr-aerial-bg", brightness: 0.9, saturate: 0.8 };

/* HIGH-DENSITY TILES. A 256-px tile drawn at 256 CSS px is upscaled 2x on a dpr-2 screen (the soft
 * look). Leaflet's `detectRetina` requests one zoom DEEPER and draws at half size — and the
 * provider's native ceiling must drop by one with it, or the deepest request lands on the grey
 * "Map data not yet available" placeholder served as HTTP 200 (B182/B220). Pure, so it is
 * unit-tested at dpr 1/2/3 without a browser. */
export function densityTileOptions(maxNative, dpr) {
  const hi = Number(dpr) > 1;
  return { detectRetina: hi, maxNativeZoom: hi ? Math.max(1, maxNative - 1) : maxNative };
}

/* HYBRID — the default everywhere, and THE Site Plan map: aerial imagery + vector roads and place
 * labels. `imageryKey` names the BASEMAPS entry both Site Plan surfaces default to. */
export const HYBRID_BASEMAP = {
  key: "hybrid",
  label: "Hybrid",
  title: "Aerial imagery with crisp roads and place names",
  imageryKey: "esri",
  imagery: BASEMAPS.esri,
  vector: VECTOR_SOURCE,
  graded: true,
};

/* SATELLITE — the same imagery, toned, with nothing drawn on top. */
export const SATELLITE_BASEMAP = {
  key: "satellite",
  label: "Satellite",
  title: "Aerial imagery only",
  imageryKey: "esri",
  imagery: BASEMAPS.esri,
  vector: null,
  graded: true,
};

/* "The Site Plan map" IS Hybrid — same object, not a copy, so the two can never drift. */
export const SITE_PLAN_BASEMAP = HYBRID_BASEMAP;

/* The choices /food offers, in display order. The FIRST is the default. */
export const SITE_PLAN_BASEMAP_CHOICES = [HYBRID_BASEMAP, SATELLITE_BASEMAP];

/* Resolve a stored/unknown key to a choice — anything unrecognised falls back to the default.
 * Pre-NEW-1 stored values ("siteplan") resolve to Hybrid by the same fallback. */
export function resolveBasemapChoice(key) {
  return SITE_PLAN_BASEMAP_CHOICES.find((c) => c.key === key) || SITE_PLAN_BASEMAP;
}

/* The raster tile layers a choice is made of — the IMAGERY only now (roads and labels are vector;
 * see `vectorLabelLayer.js`). `{ id, url, opts }`, ready for Leaflet. Pure. The B220 rule holds
 * (`maxNativeZoom` = the source's ceiling, minus one at high density) and no entry ever carries a
 * `subdomains` key (B634981). `dpr` defaults to 1 so a caller that does not know it gets the
 * conservative, never-placeholder behaviour. */
export function basemapTileLayers(choice, { dpr = 1 } = {}) {
  const c = choice || SITE_PLAN_BASEMAP;
  const opts = {
    maxZoom: 21, attribution: c.imagery.attr, zIndex: 1,
    ...densityTileOptions(c.imagery.maxNative, dpr),
  };
  if (c.graded) opts.className = IMAGERY_GRADE.className;
  return [{ id: "imagery", url: c.imagery.tiles, opts }];
}

/* The credit line for a choice — imagery credit, plus the vector source's when labels are drawn. */
export function basemapAttribution(choice) {
  const c = choice || SITE_PLAN_BASEMAP;
  return c.vector ? `${c.imagery.attr} · ${c.vector.attribution}` : c.imagery.attr;
}

/* Fallback credit when the raster reference overlay is swapped in. */
export const FALLBACK_LABELS_ATTR = LABELS_ATTR;
