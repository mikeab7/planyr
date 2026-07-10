/* Cached VECTOR GIS layers — FEMA flood zones + NWI wetlands (Site Planner).
 *
 * Plain-English: instead of asking the county/federal server for a fresh picture
 * (a flat "image" tile) every time the map moves, this pulls the actual SHAPES
 * (vectors — the flood-zone and wetland polygons themselves) once, draws them
 * locally, and remembers the last-good copy in the browser so they pop up instantly
 * next time. Real shapes also mean we can colour each zone by its risk and read its
 * attributes (zone letter, BFE) — not possible from a flat picture.
 *
 * This is the PURE engine: a registry-driven ArcGIS connector that mirrors
 * `jurisdiction.js` (one connector, parameterized per source) and rides the same
 * browser-local SWR cache (`gisCache.js`). It is deliberately free of Leaflet/DOM so
 * the heavy paging + geometry simplify can move to a Web Worker later. Everything
 * takes an injectable `fetchJson` + cache + clock so it unit-tests in Node with no
 * network and no browser.
 *
 * Screening-only, always: every source carries a `note` and the data's age; a flood
 * map or wetland line here is a flag to verify with the authority, never a legal
 * determination. When the area is too big or zoomed too far out (too many polygons),
 * `decideVectorOrImage` falls back to the flat image service so the map stays fast.
 */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { pipelineStyleFor } from "./pipelineCommodity.js";

// ---------------------------------------------------------------------------
// Source registry — one row per layer. `query` drives the vector pull (endpoint,
// fields, paging, ttl, and the zoom/area gates that decide vector vs. flat image);
// `imageFallback` is the MapServer export used when vectors aren't appropriate.
// Adding a layer = adding a registry ROW, never new code (the jurisdiction.js rule).
//
// Detail TIERS (B694): a source may declare `query.tiers` — ordered coarse→fine, the
// first tier whose `maxZoom` covers the current zoom wins (no maxZoom = catch-all).
// A tier sets the SERVER-side generalization (`offsetDeg` → maxAllowableOffset: the
// agency thins the vertices before they ever cross the wire — same effect as our
// client Douglas–Peucker, minus the payload) and its cache scope: "all" = ONE
// source-level pull/entry (a statewide/region-wide boundary set — measured 2026-07-07:
// 254 TX counties @0.002° = 337 KB, H-GAC ETJ @0.001° = 204 KB, both under the 512 KB
// gisCache entry cap, so no per-county splitting); "bbox" = per-view pulls whose bbox
// snaps OUTWARD to a `cellDeg` grid so small pans reuse the same cache entry.
// ---------------------------------------------------------------------------
export const VECTOR_SOURCES = {
  fema: {
    id: "fema",
    label: "FEMA flood zones",
    style: "fema",
    // NOTE: sublayer index 28 = "Flood Hazard Zones" (the zone polygons) on the
    // public NFHL MapServer. FEMA occasionally renumbers the NFHL sublayers — this
    // must be live-verified against /NFHL/MapServer/layers; if it moved it's a
    // one-line registry edit here (and in imageFallback.layers below).
    query: {
      url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query",
      // DEPTH (Zone AO sheet-flow depth) + V_DATUM (datum honesty) joined for the
      // floodplain-mitigation engine (B707). keyRev busts the 30-day cache when the
      // field list changes — without it, stale attribute-less entries would serve
      // for a whole TTL (the same "registry retune must bust the cache" rule the
      // tier comment on vectorKey documents).
      keyRev: 2,
      outFields: ["FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE", "DEPTH", "V_DATUM"],
      where: "1=1",
      pageSize: 1000,
      maxFeatures: 4000,
      ttl: 30 * 24 * 3600 * 1000, // 30 days — flood layers move slowly
      minVectorZoom: 15,
      maxAreaDeg: 0.5,
    },
    imageFallback: { url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer", layers: [27, 28] },
    note: "FEMA NFHL flood zone — screening only; verify with the official FEMA Flood Map Service Center.",
  },
  wetlands: {
    id: "wetlands",
    label: "Wetlands (NWI)",
    style: "nwi",
    query: {
      url: "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query",
      outFields: ["WETLAND_TYPE", "ATTRIBUTE"],
      where: "1=1",
      pageSize: 1000,
      maxFeatures: 4000,
      ttl: 30 * 24 * 3600 * 1000,
      minVectorZoom: 15,
      maxAreaDeg: 0.5,
    },
    imageFallback: { url: "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer", layers: [0] },
    note: "NWI is for screening only — not a jurisdictional determination.",
  },

  /* Pipelines (RRC T-4) — vector LINE layer (B751). Reuses the SAME authoritative statewide RRC
   * service the Site Analysis pipeline count reads (sources.js `pipelines`, layer 13) so the map
   * and the analysis agree (the B517 invariant — one source of truth, no fork). Rendered as crisp
   * polylines colored by commodity (style "pipeline", fixed map-symbology hex, weight = hazard)
   * when zoomed in; falls back to the RRC `/export` raster (imageFallback) when zoomed far out —
   * statewide pipeline density is too heavy to draw as vector. The `outFields` are the registry's
   * exact columns (operator/commodity/diameter/status/system/county), so the click-identify reads
   * the same fields the analysis maps. */
  txrrc_pipe: {
    id: "txrrc_pipe",
    label: "Pipelines (TxRRC)",
    style: "pipeline",
    geometryType: "line",
    commodityField: GIS_SOURCES.pipelines.fields.commodity, // "COMMODITY_DESCRIPTION"
    sourceName: GIS_SOURCES.pipelines.provider, // "Railroad Commission of Texas (RRC) — statewide"
    // Click-identify rows (B751) — the same registry columns the analysis reads (one source of
    // truth). Commodity is the headline; diameter surfaces HERE since weight encodes hazard.
    identifyFields: [
      { label: "Operator", field: GIS_SOURCES.pipelines.fields.operator },
      { label: "Diameter", field: GIS_SOURCES.pipelines.fields.diameter, unit: "in" },
      { label: "Status", field: GIS_SOURCES.pipelines.fields.status },
      { label: "System", field: GIS_SOURCES.pipelines.fields.system },
    ],
    identifyNote: "RRC T-4 permit route — schematic, not a surveyed location.",
    query: {
      url: GIS_SOURCES.pipelines.serviceUrl + "/" + GIS_SOURCES.pipelines.layerId + "/query", // …/MapServer/13/query
      outFields: Object.values(GIS_SOURCES.pipelines.fields), // OPERATOR, COMMODITY_DESCRIPTION, DIAMETER, STATUS, SYSTEM_NAME, COUNTY_NAME
      where: "1=1",
      pageSize: 1000,
      maxFeatures: 6000,
      ttl: 7 * 24 * 3600 * 1000, // RRC permit data updates continuously; a week keeps the cached copy fresh-ish
      minVectorZoom: 13,          // crisp vector at site / neighborhood zoom; raster below (statewide density)
      maxAreaDeg: 0.2,            // a county-plus view is too dense to pull/draw as vector → raster fallback
    },
    imageFallback: {
      url: GIS_SOURCES.pipelines.serviceUrl,
      layers: [GIS_SOURCES.pipelines.layerId], // [13] — the same sublayer the vector pull queries
    },
    note: "RRC T-4 permit routes — schematic, not surveyed locations.",
  },

  /* Jurisdiction BOUNDARY layers (B694) — county / city / ETJ move off live per-pan
   * esri-leaflet fetches onto this cached tier so they PAINT INSTANTLY from the
   * last-good copy (and a TxDOT/TxGIO 503 can only slow the background refresh,
   * never the paint). Endpoints come from the same GIS_SOURCES registry rows the
   * jurisdiction *identify* uses — the B176 invariant: one source of truth, so the
   * boundary you see is the boundary the identify reports. These sources have NO
   * flat-image fallback service; their `liveFallback` marks that a vector failure
   * falls back to the previous live esri-leaflet featureLayer path instead (see
   * vectorOverlay.js), so a CORS/query failure never blanks the layer.
   * Label/identify fields (B695) ride the same pull: CNTY_NM / city_name / CITY are
   * the exact columns jurisdiction.js already reads. */
  jur_county: {
    id: "jur_county",
    label: "County boundaries",
    labelField: "CNTY_NM",
    // County-name labels on the map (B695): on at region zoom, off at parcel zoom
    // (you're inside one county there — the label is noise).
    labelZoom: { min: 6, max: 11 },
    // Click-identify popover (B695): name line + the has-jurisdiction wording the
    // Layers panel already teaches (one disclaimer, reused — never a new claim).
    nameTemplate: "{name} County",
    identifyNote: "This county has jurisdiction here (it can tax/regulate) — a boundary is not a utility service area. Screening only.",
    sourceName: "TxDOT TPP (statewide)",
    liveFallback: true,
    query: {
      url: GIS_SOURCES.county.serviceUrl + "/query",
      outFields: ["CNTY_NM", "FIPS_ST_CNTY_CD"],
      where: "1=1",
      pageSize: 1000,
      maxFeatures: 4000,
      ttl: 30 * 24 * 3600 * 1000, // county lines ~never change
      minVectorZoom: 0,           // boundaries are ALWAYS vector — that's the point
      maxAreaDeg: Infinity,
      tiers: [
        // ONE statewide entry serves every low/mid zoom instantly (254 features, ~340 KB).
        { maxZoom: 11, scope: "all", offsetDeg: 0.002, precision: 4 },
        // Zoomed in near a line: a fine per-view pull (a handful of counties).
        { scope: "bbox", offsetDeg: 0.0002, precision: 5, cellDeg: 0.25 },
      ],
    },
    note: "Texas county lines (TxDOT).",
  },
  jur_city: {
    id: "jur_city",
    label: "City limits",
    labelField: "city_name",
    labelZoom: { min: 10, max: 13 },
    nameTemplate: "{name} — city limits",
    identifyNote: "Inside this line is in the city (it has jurisdiction — can tax/regulate); outside is unincorporated or another city. NOT proof of utility service. Screening only.",
    sourceName: "TxGIO (statewide)",
    liveFallback: true,
    query: {
      url: GIS_SOURCES.city.serviceUrl + "/query",
      outFields: ["city_name"],
      where: "1=1",
      pageSize: 1000,
      maxFeatures: 4000,
      ttl: 14 * 24 * 3600 * 1000, // annexations move city limits occasionally
      minVectorZoom: 0,
      maxAreaDeg: Infinity,
      // Statewide city limits are too heavy for one entry (unlike counties), so the
      // city tier is ALWAYS bbox-scoped. Cell sizing matters: at z9 a snapped metro
      // cell can hold hundreds of cities (a full DFW cell measured ~560 KB stored
      // @0.001°/4dp — over the 512 KB entry cap → L1-only, no persistence), so the
      // widest tier thins harder (0.003° ≈ 300 m — fine for metro-zoom screening
      // lines); a mid tier takes over where the viewport is a single metro slice.
      tiers: [
        { maxZoom: 10, scope: "bbox", offsetDeg: 0.003, precision: 3, cellDeg: 1 },
        { maxZoom: 12, scope: "bbox", offsetDeg: 0.001, precision: 4, cellDeg: 0.5 },
        { scope: "bbox", offsetDeg: 0.0002, precision: 5, cellDeg: 0.25 },
      ],
    },
    note: "Texas city limits (TxGIO).",
  },
  jur_etj: {
    id: "jur_etj",
    label: "City ETJ (Houston region)",
    labelField: "CITY",
    titleCaseLabel: true, // H-GAC publishes ALL-CAPS city names
    labelZoom: { min: 10, max: 13 },
    nameTemplate: "{name} — ETJ",
    identifyNote: "This city's ETJ (extraterritorial jurisdiction) — its limited reach OUTSIDE its city limits. Not annexation and not utility service. Screening only.",
    sourceName: "H-GAC (Houston-Galveston Area Council)",
    liveFallback: true,
    query: {
      url: GIS_SOURCES.etj_hgac.serviceUrl + "/query",
      outFields: ["CITY"],
      where: "1=1",
      pageSize: 1000,
      maxFeatures: 4000,
      ttl: 14 * 24 * 3600 * 1000, // ETJ is volatile-ish (SB2038 releases, annexations)
      minVectorZoom: 0,
      maxAreaDeg: Infinity,
      tiers: [
        // The whole 13-county H-GAC region fits ONE entry (608 features, ~200 KB @0.001°).
        { maxZoom: 12, scope: "all", offsetDeg: 0.001, precision: 4 },
        { scope: "bbox", offsetDeg: 0.0002, precision: 5, cellDeg: 0.25 },
      ],
    },
    note: "City ETJ across the H-GAC 13-county region.",
  },
};

// ---------------------------------------------------------------------------
// Detail tiers (B694) — pure helpers.
// ---------------------------------------------------------------------------

/* Pick the detail tier for a zoom: the first tier whose maxZoom covers it (tiers are
 * ordered coarse→fine; a tier with no maxZoom is the catch-all). Sources without
 * tiers (FEMA/NWI) return null and keep their original single-detail behavior. With
 * no zoom hint, the coarsest tier wins (cheapest, always-valid answer). Pure. */
export function pickTier(source, zoom) {
  const tiers = source && source.query && source.query.tiers;
  if (!tiers || !tiers.length) return null;
  if (typeof zoom !== "number") return tiers[0];
  for (const t of tiers) if (t.maxZoom == null || zoom <= t.maxZoom) return t;
  return tiers[tiers.length - 1];
}

/* Snap a bbox OUTWARD to a `cellDeg` grid, so nearby views land on the same cache
 * entry (a pan within the cell = a cache hit, not a new pull). Rounded to 6 dp to
 * kill float dust. Pure. */
export function snapBbox(bbox, cellDeg) {
  const r6 = (n) => Math.round(n * 1e6) / 1e6;
  return {
    w: r6(Math.floor(bbox.w / cellDeg) * cellDeg),
    s: r6(Math.floor(bbox.s / cellDeg) * cellDeg),
    e: r6(Math.ceil(bbox.e / cellDeg) * cellDeg),
    n: r6(Math.ceil(bbox.n / cellDeg) * cellDeg),
  };
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/* Build the /query params for a vector source against a lon/lat bbox {w,s,e,n}.
 * An envelope intersect, paged via resultOffset/resultRecordCount. A `tier` adds
 * server-side generalization (maxAllowableOffset — the agency thins vertices before
 * sending) and, when tier.scope === "all", drops the spatial filter entirely (one
 * source-level pull; bbox may be null then). Pure. */
export function buildVectorQuery(source, bbox, { offset = 0, tier = null } = {}) {
  const q = source.query;
  const p = {
    where: q.where,
    outSR: 4326,
    outFields: q.outFields.join(","),
    returnGeometry: "true",
    geometryPrecision: (tier && tier.precision) || 5,
    resultOffset: offset,
    resultRecordCount: q.pageSize,
    f: "json",
  };
  if (!tier || tier.scope !== "all") {
    p.geometry = JSON.stringify({
      xmin: bbox.w, ymin: bbox.s, xmax: bbox.e, ymax: bbox.n,
      spatialReference: { wkid: 4326 },
    });
    p.geometryType = "esriGeometryEnvelope";
    p.inSR = 4326;
    p.spatialRel = "esriSpatialRelIntersects";
  }
  if (tier && tier.offsetDeg) p.maxAllowableOffset = tier.offsetDeg;
  return p;
}

/* Compose a full /query URL from a base + params (skips null/undefined). Mirrors
 * jurisdiction.js's buildQueryUrl; `f` is carried in the params here. Pure. */
export function buildQueryUrl(baseUrl, params) {
  const u = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  return u.toString();
}

// Default browser fetch → parsed ArcGIS JSON (throws on HTTP / ArcGIS error). The
// app injects this; tests inject a fake. Kept here so the engine is self-contained.
async function defaultFetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Server returned HTTP ${res.status}.`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "ArcGIS query error.");
  return j;
}

/* Page through a vector source's features over a bbox. Loops the /query, throwing
 * the server's message on `j.error`, accumulating `j.features`, and continuing while
 * the server says `exceededTransferLimit === true` AND we're under the feature cap —
 * bumping the offset by the page size each round. Hard-caps at maxFeatures and flags
 * `truncated` when there was more than we kept. `fetchJson` is injected. */
export async function fetchVectorFeatures(source, bbox, { fetchJson = defaultFetchJson, maxFeatures, tier = null } = {}) {
  const q = source.query;
  const cap = maxFeatures ?? q.maxFeatures;
  const features = [];
  let offset = 0;
  let truncated = false;
  // Loop guard: paging can't exceed cap/pageSize rounds + 1; never spin forever.
  for (;;) {
    const j = await fetchJson(buildQueryUrl(q.url, buildVectorQuery(source, bbox, { offset, tier })));
    if (j && j.error) throw new Error(j.error.message || "ArcGIS query error.");
    const batch = (j && j.features) || [];
    if (!batch.length) break; // empty page → nothing left (also guards a server that wrongly keeps flagging more)
    for (const f of batch) {
      if (features.length >= cap) { truncated = true; break; }
      features.push(f);
    }
    if (features.length >= cap) { truncated = true; break; }
    if (!(j && j.exceededTransferLimit === true)) break; // server says: that's all
    offset += q.pageSize;
  }
  return { features, truncated };
}

// ---------------------------------------------------------------------------
// Esri JSON → GeoJSON
// ---------------------------------------------------------------------------

/* Convert Esri JSON features into a GeoJSON FeatureCollection. Handles BOTH geometry
 * shapes the app pulls:
 *   • polygons  ({geometry:{rings}})  → Polygon (rings pass straight through as [lng,lat])
 *   • polylines ({geometry:{paths}})  → LineString (1 path) / MultiLineString (n paths)
 * (B751 added the polyline path for the RRC pipelines layer.) Esri coords are already
 * [lng,lat], so they pass through unchanged. Features with no usable geometry are skipped.
 * NOTE: polygons don't split outer rings from holes — for screening, an even-odd fill renders
 * these rings fine; precise outer/hole classification is a later refinement. Pure. */
export function featuresToGeoJson(esriFeatures, { source } = {}) {
  const out = [];
  for (const f of esriFeatures || []) {
    const g = f && f.geometry;
    if (!g) continue;
    if (g.rings && g.rings.length) {
      out.push({ type: "Feature", properties: f.attributes || {}, geometry: { type: "Polygon", coordinates: g.rings } });
    } else if (g.paths && g.paths.length) {
      const parts = g.paths.filter((p) => p && p.length >= 2);
      if (!parts.length) continue; // no drawable part
      const geometry = parts.length === 1
        ? { type: "LineString", coordinates: parts[0] }
        : { type: "MultiLineString", coordinates: parts };
      out.push({ type: "Feature", properties: f.attributes || {}, geometry });
    }
    // else: null/empty geometry — skip
  }
  return { type: "FeatureCollection", features: out, style: source ? source.style : undefined };
}

// ---------------------------------------------------------------------------
// Geometry simplify (Douglas–Peucker) — shrink dense rings for fast rendering.
// ---------------------------------------------------------------------------

// Perpendicular distance (in degrees) from point p to the segment a→b. Pure.
function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Classic recursive Douglas–Peucker over an open point list. Always keeps the two
// endpoints. Pure. Coordinate-agnostic (works in degrees, pixels, feet — tolerance is
// in the same units as the points); exported for the B704 contour pipeline, which runs
// it in GRID/PIXEL space (a degree-space tolerance would be anisotropic on the ground).
export function douglasPeucker(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  let maxD = -1, idx = -1;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > tol) {
    const left = douglasPeucker(pts.slice(0, idx + 1), tol);
    const right = douglasPeucker(pts.slice(idx), tol);
    return left.slice(0, -1).concat(right); // drop the shared joint
  }
  return [a, b];
}

/* Simplify every feature's geometry into a NEW FeatureCollection (originals untouched),
 * dispatching on geometry type:
 *   • Polygon           — each ring reduced with Douglas–Peucker, ALWAYS re-closed (first ===
 *                         last), a ring collapsing below 4 points dropped, an empty feature dropped.
 *   • LineString /      — each open path reduced with Douglas–Peucker (endpoints always kept), a
 *     MultiLineString     part collapsing below 2 points dropped, an empty feature dropped. (B751.)
 * Pure. */
export function simplifyGeoJson(fc, tolDeg = 0.00003) {
  const features = [];
  for (const feat of (fc && fc.features) || []) {
    const geom = feat.geometry;
    const type = geom && geom.type;
    if (type === "LineString" || type === "MultiLineString") {
      const parts = type === "MultiLineString" ? geom.coordinates : [geom.coordinates];
      const outParts = [];
      for (const part of parts || []) {
        if (!part || part.length < 2) continue;
        const simp = douglasPeucker(part, tolDeg);
        if (simp.length < 2) continue; // collapsed below a segment — drop
        outParts.push(simp);
      }
      if (!outParts.length) continue;
      const outGeom = outParts.length === 1
        ? { type: "LineString", coordinates: outParts[0] }
        : { type: "MultiLineString", coordinates: outParts };
      features.push({ type: "Feature", properties: feat.properties, geometry: outGeom });
      continue;
    }
    // Polygon (default)
    const rings = (geom && geom.coordinates) || [];
    const outRings = [];
    for (const ring of rings) {
      if (!ring || ring.length < 4) continue; // already degenerate — drop
      const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
      // Simplify the OPEN ring (exclude the duplicate closing vertex), then re-close.
      const open = closed ? ring.slice(0, -1) : ring.slice();
      let simp = douglasPeucker(open, tolDeg);
      simp = simp.concat([simp[0]]); // re-close: first === last
      if (simp.length < 4) continue;  // collapsed below a triangle+close — drop
      outRings.push(simp);
    }
    if (!outRings.length) continue;
    features.push({
      type: "Feature",
      properties: feat.properties,
      geometry: { type: "Polygon", coordinates: outRings },
    });
  }
  return { type: "FeatureCollection", features, style: fc ? fc.style : undefined };
}

// ---------------------------------------------------------------------------
// Screening symbology — colour each polygon by its risk / wetland class.
// ---------------------------------------------------------------------------

// NWI wetland-type → a conventional palette (greens for freshwater veg, blues for
// open water, teals for estuarine/marine). Unknown types fall to a neutral grey.
const NWI_COLORS = {
  "Freshwater Emergent Wetland": "#2e8b57",
  "Freshwater Forested/Shrub Wetland": "#228b22",
  "Freshwater Pond": "#1e90ff",
  "Lake": "#4169e1",
  "Riverine": "#5f9ea0",
  "Estuarine and Marine Wetland": "#20b2aa",
  "Estuarine and Marine Deepwater": "#008b8b",
  Other: "#6b7280",
};

/* Stroke/fill for one feature's properties under a source's style. Order matters for
 * FEMA: floodway and coastal V/VE win over the generic high-risk SFHA test (a
 * floodway IS an SFHA, but the more specific, higher-hazard label should show). Pure. */
export function styleFor(source, props) {
  const style = source && source.style;
  const p = props || {};
  if (style === "fema") {
    if (p.ZONE_SUBTY === "FLOODWAY") return { color: "#991b1b", weight: 1, fillColor: "#dc2626", fillOpacity: 0.45 };
    if (String(p.FLD_ZONE || "").startsWith("V")) return { color: "#5b21b6", weight: 1, fillColor: "#7c3aed", fillOpacity: 0.4 };
    if (p.SFHA_TF === "T") return { color: "#1d4ed8", weight: 1, fillColor: "#2563eb", fillOpacity: 0.35 };
    if (String(p.ZONE_SUBTY || "").includes("0.2 PCT")) return { color: "#b45309", weight: 1, fillColor: "#f59e0b", fillOpacity: 0.2 };
    return { color: "#9ca3af", weight: 0.5, fillColor: "#9ca3af", fillOpacity: 0.08 }; // X / minimal
  }
  if (style === "nwi") {
    const c = NWI_COLORS[p.WETLAND_TYPE] || NWI_COLORS.Other;
    return { color: c, weight: 1, fillColor: c, fillOpacity: 0.4 };
  }
  if (style === "pipeline") {
    // B751: color/weight/dash by commodity (fixed map symbology, hazard-encoded). The
    // crosswalk field name comes off the source's registry field map (COMMODITY_DESCRIPTION).
    const field = (source && source.commodityField) || "COMMODITY_DESCRIPTION";
    return pipelineStyleFor(p, 1, field);
  }
  // Unknown style — a safe neutral so a new source never renders invisibly.
  return { color: "#6b7280", weight: 1, fillColor: "#6b7280", fillOpacity: 0.3 };
}

// ---------------------------------------------------------------------------
// Vector vs. flat-image decision — keep the map fast and the server happy.
// ---------------------------------------------------------------------------

/* Decide whether to draw real polygons ("vector") or fall back to the flat image
 * service ("image") for a source at the current view. Image wins when: the source
 * has no vector query at all (image-only), a prior vector pull errored, the view is
 * zoomed out past the source's minVectorZoom, or the bbox covers more area than
 * maxAreaDeg (too many polygons to pull/draw smoothly). Otherwise vector. Pure. */
export function decideVectorOrImage(source, { zoom, bboxAreaDeg, lastVectorError } = {}) {
  const q = source && source.query;
  if (!q) return "image"; // image-only source
  if (lastVectorError) return "image";
  if (typeof zoom === "number" && zoom < q.minVectorZoom) return "image";
  if (typeof bboxAreaDeg === "number" && bboxAreaDeg > q.maxAreaDeg) return "image";
  return "vector";
}

// ---------------------------------------------------------------------------
// Cached fetch (browser-cache tier only — no cloud) — the SWR entry point.
// ---------------------------------------------------------------------------

// A stable cache key per source + bbox (bbox rounded to 3 decimals so a tiny pan
// reuses the same entry). A tier stamps its FULL detail level — offset AND
// precision — into the key (coarse and fine pulls must never overwrite each other,
// and a registry precision retune must bust the cache rather than serve old-detail
// geometry for a whole TTL); a source-level "all" tier has ONE key regardless of
// view. Exported for the overlay + tests. Pure.
export function vectorKey(source, bbox, tier = null) {
  const r = (n) => Number(n).toFixed(3);
  const det = tier ? `@${tier.offsetDeg}p${(tier.precision) || 5}` : "";
  // A registry FIELD-LIST change must bust the cache too (B707: fema gained
  // DEPTH/V_DATUM) — sources without keyRev keep their existing keys untouched.
  const rev = source.query && source.query.keyRev ? `!r${source.query.keyRev}` : "";
  if (tier && tier.scope === "all") return `vec:${source.id}:all${det}${rev}`;
  const box = `${r(bbox.w)},${r(bbox.s)},${r(bbox.e)},${r(bbox.n)}`;
  return `vec:${source.id}:${box}${det}${rev}`;
}

/* Fetch a source's simplified GeoJSON over a bbox THROUGH the browser-local SWR
 * cache (B96): paint the last-good copy instantly, refresh in the background, and
 * always carry the data's age. The cache + clock are injected (the app passes the
 * `gisCache` singleton; tests pass a fresh `createGisCache`). Returns the SWR result
 * reshaped as { data, ts, stale } — `data` is the cached copy if present else the
 * freshly-fetched copy; `ts`/`stale` come from the cache entry. The whole pull→
 * GeoJSON→simplify pipeline is the cache's fetcher, so it only runs on a miss/stale.
 *
 * Tiered sources (B694): pass `zoom` so the detail tier is picked here — a "bbox"
 * tier snaps the bbox outward to its grid cell (pan-stable key), an "all" tier
 * ignores the view entirely (one source-level entry). Tiered pulls skip the client
 * Douglas–Peucker: the server already generalized to the tier's maxAllowableOffset.
 * Pass `onFresh` to learn when a stale entry's background refresh lands (so a map
 * layer can swap the new geometry in without waiting for the next pan). */
export async function fetchCached(source, bbox, { cache, fetchJson = defaultFetchJson, now, zoom, onFresh } = {}) {
  const tier = pickTier(source, zoom);
  const effBbox = tier && tier.scope !== "all" && tier.cellDeg ? snapBbox(bbox, tier.cellDeg) : bbox;
  const key = vectorKey(source, effBbox, tier);
  const fetcher = async () => {
    const { features, truncated } = await fetchVectorFeatures(source, tier && tier.scope === "all" ? null : effBbox, { fetchJson, tier });
    const fc = featuresToGeoJson(features, { source });
    const out = tier ? fc : simplifyGeoJson(fc);
    // Surface the maxFeatures cap on the stored payload (B707): a capped pull is an
    // UNDERCOUNT — consumers (the mitigation engine) must flag it, never read it as
    // "everything". Silent truncation is the fabricated-all-clear class.
    if (truncated) out.truncated = true;
    return out;
  };
  const { cached, stale, fresh } = cache.swr(key, fetcher, { ttl: source.query.ttl, onFresh });
  if (cached) {
    // Last-good copy exists: hand it back NOW; if it was stale the background refresh
    // is already running (kicked off by swr) and will swap into the cache. `stale`
    // mirrors the cache entry so the caller can show "refreshing…" honestly.
    return { data: cached.data, ts: cached.ts, stale };
  }
  // Cold cache (no copy to paint): await the first fetch so the caller has geometry.
  const r = await fresh;
  if (r && r.error && !r.data) throw r.error; // cold + failed fetch: surface it (LOUD) — the overlay decides the fallback
  const ts = r.ts != null ? r.ts : (now ? now() : Date.now());
  return { data: r.data, ts, stale: false };
}
