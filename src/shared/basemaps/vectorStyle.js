/* vectorStyle — NEW-1 (B2018608). The Apple-Maps-over-imagery MapLibre style for Planyr's maps, as a
 * PURE function of the one `VECTOR_SOURCE` config entry (no DOM, no maplibre import — unit-tested).
 *
 * Written in LEAFLET zoom (the numbers an owner sees: metro ≈ 10–11, neighbourhood ≈ 15–16) and
 * converted once, here, to MapLibre's 512-px-tile zoom (`VECTOR_ZOOM_OFFSET`). Assumes only the
 * OpenMapTiles schema (`transportation`, `transportation_name`, `place`, `poi`), so a provider swap
 * is a config edit.
 *
 * What it draws, and why it reads "clean" over aerial:
 *   · Hierarchy — freeways/trunks widest and warm white, primaries narrower, secondaries/tertiaries
 *     thinner still, and LOCAL streets only from neighbourhood zoom (`LOCAL_STREETS_FROM`). The old
 *     overlay drew every road as one thick opaque band; here width AND opacity both step down.
 *   · Thin, slightly translucent strokes with a hairline dark casing so a pale road holds its edge
 *     against bright pavement/roofs without becoming a band.
 *   · Labels — modern sans (Noto Sans), soft halo instead of a heavy black outline, road names that
 *     follow the line, collision ON (never `text-allow-overlap`), ranked so the important name wins.
 *   · Nothing here is interactive; pins/drawing stay in Leaflet above this layer. */
import { VECTOR_ZOOM_OFFSET, ROAD_NAMES_FROM, SITE_ROADS_FROM } from "./basemaps.js";
export { ROAD_NAMES_FROM };

/* Leaflet zoom at which local streets first appear (neighbourhood zoom). Below it they are hidden. */
export const LOCAL_STREETS_FROM = 15;
/* Leaflet zoom from which sparse points of interest appear (Site Plan only — see `includePois`). */
export const POI_FROM = 15;
/* Leaflet zoom from which road NAMES draw (the Layers panel's "not showing at this zoom" note reads this). */

const FONT_REGULAR = ["Noto Sans Regular"];
const FONT_MEDIUM = ["Noto Sans Medium"];
const FONT_ITALIC = ["Noto Sans Italic"];

const gl = (leafletZoom) => leafletZoom - VECTOR_ZOOM_OFFSET;

/* width stops given in Leaflet zoom → a MapLibre interpolate expression. */
const widthByZoom = (stops) => [
  "interpolate", ["exponential", 1.4], ["zoom"],
  ...stops.flatMap(([z, w]) => [gl(z), w]),
];

/* Soft halo — dark, translucent, thin. The old raster labels carried a heavy black outline. */
const TEXT = { color: "#ffffff", halo: "rgba(18, 26, 38, 0.62)", haloWidth: 1.1, haloBlur: 0.8 };

const ROAD_CLASSES = {
  /* [class list, leaflet minzoom, stroke color, opacity, width stops (leaflet zoom → px)] */
  freeway: { classes: ["motorway", "trunk"], minzoom: 6, color: "#fff3c4", opacity: 0.95,
    widths: [[6, 0.7], [10, 1.8], [14, 4.6], [18, 13]] },
  major: { classes: ["primary"], minzoom: 8, color: "#ffffff", opacity: 0.9,
    widths: [[8, 0.5], [11, 1.3], [14, 3.4], [18, 10]] },
  arterial: { classes: ["secondary"], minzoom: 10, color: "#ffffff", opacity: 0.8,
    widths: [[10, 0.5], [13, 1.2], [16, 3.4], [18, 7]] },
  collector: { classes: ["tertiary"], minzoom: 12, color: "#ffffff", opacity: 0.72,
    widths: [[12, 0.5], [14, 1], [16, 2.6], [18, 5.5]] },
  local: { classes: ["minor"], minzoom: LOCAL_STREETS_FROM, color: "#ffffff", opacity: 0.62,
    widths: [[15, 0.7], [17, 2], [19, 4.5]] },
  service: { classes: ["service"], minzoom: LOCAL_STREETS_FROM + 1, color: "#ffffff", opacity: 0.5,
    widths: [[16, 0.5], [18, 1.6], [20, 3]] },
};

const roadFilter = (classes) => ["all", ["in", ["get", "class"], ["literal", classes]],
  ["!=", ["get", "brunnel"], "tunnel"]];

function roadLayers(floor) {
  const layers = [];
  for (const [id, r] of Object.entries(ROAD_CLASSES)) {
    /* Hairline casing first (below the stroke): keeps a pale road legible on bright roofs/pavement. */
    layers.push({
      id: `road-${id}-casing`, type: "line", source: "vec", "source-layer": "transportation",
      minzoom: gl(Math.max(r.minzoom, floor)), filter: roadFilter(r.classes),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "rgba(10, 16, 24, 0.55)", "line-opacity": r.opacity * 0.55,
        "line-width": widthByZoom(r.widths.map(([z, w]) => [z, w + 0.9])) },
    });
    layers.push({
      id: `road-${id}`, type: "line", source: "vec", "source-layer": "transportation",
      minzoom: gl(Math.max(r.minzoom, floor)), filter: roadFilter(r.classes),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": r.color, "line-opacity": r.opacity, "line-width": widthByZoom(r.widths) },
    });
  }
  return layers;
}

/* Road names follow the road line. Ranked by class so freeways win a contested spot. */
function roadNameLayers(floor) {
  const rank = ["match", ["get", "class"], "motorway", 0, "trunk", 1, "primary", 2, "secondary", 3,
    "tertiary", 4, 5];
  const labelFilter = (classes) => ["in", ["get", "class"], ["literal", classes]];
  const base = {
    type: "symbol", source: "vec", "source-layer": "transportation_name",
    layout: {
      "symbol-placement": "line",
      "symbol-sort-key": rank,
      "text-field": ["coalesce", ["get", "name"], ["get", "ref"]],
      "text-font": FONT_MEDIUM,
      "text-size": ["interpolate", ["linear"], ["zoom"], gl(11), 10, gl(15), 11.5, gl(18), 14],
      "text-letter-spacing": 0.02,
      "text-max-angle": 30,
      "symbol-spacing": 320,
      "text-padding": 6,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
    },
    paint: { "text-color": TEXT.color, "text-halo-color": TEXT.halo,
      "text-halo-width": TEXT.haloWidth, "text-halo-blur": TEXT.haloBlur },
  };
  return [
    { ...base, id: "roadname-major", minzoom: gl(Math.max(ROAD_NAMES_FROM, floor)), filter: labelFilter(["motorway", "trunk", "primary", "secondary"]) },
    { ...base, id: "roadname-collector", minzoom: gl(Math.max(14, floor)), filter: labelFilter(["tertiary"]) },
    { ...base, id: "roadname-local", minzoom: gl(Math.max(LOCAL_STREETS_FROM + 1, floor)), filter: labelFilter(["minor", "service"]),
      layout: { ...base.layout, "text-size": ["interpolate", ["linear"], ["zoom"], gl(16), 10, gl(19), 12.5] } },
  ];
}

function placeLayers() {
  const placeBase = (id, classes, min, max, size, extra = {}) => ({
    id, type: "symbol", source: "vec", "source-layer": "place",
    minzoom: gl(min), ...(max != null ? { maxzoom: gl(max) } : {}),
    filter: ["in", ["get", "class"], ["literal", classes]],
    layout: {
      "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
      "text-font": FONT_MEDIUM, "text-size": size, "text-max-width": 7,
      "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
      "text-padding": 8, "text-allow-overlap": false, "text-ignore-placement": false,
      ...(extra.layout || {}),
    },
    paint: { "text-color": TEXT.color, "text-halo-color": TEXT.halo, "text-halo-width": 1.3,
      "text-halo-blur": 1, ...(extra.paint || {}) },
  });
  return [
    placeBase("place-city", ["city"], 5, 14, ["interpolate", ["linear"], ["zoom"], gl(5), 12, gl(12), 19]),
    placeBase("place-town", ["town"], 8, 15, ["interpolate", ["linear"], ["zoom"], gl(8), 11, gl(14), 15]),
    placeBase("place-suburb", ["suburb", "village", "hamlet"], 11, 17,
      ["interpolate", ["linear"], ["zoom"], gl(11), 10.5, gl(16), 13],
      { layout: { "text-transform": "uppercase", "text-letter-spacing": 0.08, "text-font": FONT_REGULAR },
        paint: { "text-color": "rgba(255,255,255,0.92)" } }),
    placeBase("place-neighbourhood", ["neighbourhood", "quarter"], 14, 18,
      ["interpolate", ["linear"], ["zoom"], gl(14), 10, gl(17), 12.5],
      { layout: { "text-font": FONT_ITALIC } }),
  ];
}

/* Sparse, ranked points of interest — only the landmark classes, and only the top-ranked per tile.
 * Off on /food (`includePois: false`): the restaurant pins ARE the points of interest there, and a
 * basemap label under a pin is exactly the collision the owner called out. */
function poiLayer() {
  return {
    id: "poi-landmarks", type: "symbol", source: "vec", "source-layer": "poi", minzoom: gl(POI_FROM),
    filter: ["all",
      ["in", ["get", "class"], ["literal", ["hospital", "college", "school", "stadium", "park", "airport",
        "shop", "railway", "bus", "harbor", "attraction", "golf"]]],
      ["<=", ["coalesce", ["get", "rank"], 99], 12]],
    layout: {
      "text-field": ["get", "name"], "text-font": FONT_REGULAR,
      "text-size": ["interpolate", ["linear"], ["zoom"], gl(15), 10, gl(18), 12],
      "text-max-width": 7, "text-anchor": "center", "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
      "text-padding": 10, "text-allow-overlap": false, "text-ignore-placement": false, "text-optional": true,
    },
    paint: { "text-color": "rgba(255,255,255,0.9)", "text-halo-color": TEXT.halo, "text-halo-width": 1,
      "text-halo-blur": 0.8 },
  };
}

/* The style. `glyphsUrl` must be ABSOLUTE (the MapLibre worker cannot resolve a relative URL);
 * `source` is the `VECTOR_SOURCE` config entry. */
export function buildVectorStyle(source, glyphsUrl, { includePois = true, mode = "hybrid" } = {}) {
  /* "site" = the Site Plan map's close-zoom roads: road lines + road names ONLY, nothing before
   * SITE_ROADS_FROM, no vector places (the city names are Planyr's own layer there) and no POIs.
   * "hybrid" = the full Apple/Google-like style with everything phasing in by importance. */
  const site = mode === "site";
  const floor = site ? SITE_ROADS_FROM : 0;
  const layers = [...roadLayers(floor), ...roadNameLayers(floor)];
  if (!site) layers.push(...placeLayers());
  if (!site && includePois) layers.push(poiLayer());
  return {
    version: 8,
    name: site ? "planyr-site-plan-roads" : "planyr-hybrid-labels",
    glyphs: glyphsUrl,
    sources: { vec: { type: "vector", url: source.tilejson } },
    /* Transparent background: this style paints ONLY on top of the aerial. */
    layers,
  };
}

/* Absolute glyph URL from the config's root-relative one. */
export function absoluteGlyphsUrl(source, origin) {
  return /^https?:\/\//.test(source.glyphs) ? source.glyphs : `${origin}${source.glyphs}`;
}

/* Which road layers a given Leaflet zoom actually draws — the pure answer the tests assert
 * ("local streets hidden at metro zoom, shown at neighbourhood zoom"), computed from the SAME
 * minzoom the style carries, so it cannot disagree with it. */
export function visibleRoadClassesAt(leafletZoom, mode = "hybrid") {
  const floor = mode === "site" ? SITE_ROADS_FROM : 0;
  const z = gl(leafletZoom);
  const out = new Set();
  for (const r of Object.values(ROAD_CLASSES)) if (z >= gl(Math.max(r.minzoom, floor))) r.classes.forEach((c) => out.add(c));
  return out;
}
