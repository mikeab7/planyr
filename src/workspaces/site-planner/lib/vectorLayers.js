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

// ---------------------------------------------------------------------------
// Source registry — one row per layer. `query` drives the vector pull (endpoint,
// fields, paging, ttl, and the zoom/area gates that decide vector vs. flat image);
// `imageFallback` is the MapServer export used when vectors aren't appropriate.
// Adding a layer = adding a registry ROW, never new code (the jurisdiction.js rule).
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
      outFields: ["FLD_ZONE", "ZONE_SUBTY", "SFHA_TF", "STATIC_BFE"],
      where: "1=1",
      pageSize: 1000,
      maxFeatures: 4000,
      ttl: 30 * 24 * 3600 * 1000, // 30 days — flood layers move slowly
      minVectorZoom: 12,
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
      minVectorZoom: 12,
      maxAreaDeg: 0.5,
    },
    imageFallback: { url: "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer", layers: [0] },
    note: "NWI is for screening only — not a jurisdictional determination.",
  },
};

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/* Build the /query params for a vector source against a lon/lat bbox {w,s,e,n}.
 * An envelope intersect, paged via resultOffset/resultRecordCount. Pure. */
export function buildVectorQuery(source, bbox, { offset = 0 } = {}) {
  const q = source.query;
  return {
    where: q.where,
    geometry: JSON.stringify({
      xmin: bbox.w, ymin: bbox.s, xmax: bbox.e, ymax: bbox.n,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: "esriGeometryEnvelope",
    inSR: 4326,
    outSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields: q.outFields.join(","),
    returnGeometry: "true",
    geometryPrecision: 5,
    resultOffset: offset,
    resultRecordCount: q.pageSize,
    f: "json",
  };
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
export async function fetchVectorFeatures(source, bbox, { fetchJson = defaultFetchJson, maxFeatures } = {}) {
  const q = source.query;
  const cap = maxFeatures ?? q.maxFeatures;
  const features = [];
  let offset = 0;
  let truncated = false;
  // Loop guard: paging can't exceed cap/pageSize rounds + 1; never spin forever.
  for (;;) {
    const j = await fetchJson(buildQueryUrl(q.url, buildVectorQuery(source, bbox, { offset })));
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

/* Convert Esri JSON features ({attributes, geometry:{rings}}) into a GeoJSON
 * FeatureCollection of Polygons. Esri rings are already [[ [lng,lat], ... ], ...],
 * so they pass straight through as Polygon `coordinates`. Features with no rings are
 * skipped. NOTE: this does not split outer rings from holes into separate
 * Polygons/MultiPolygons — for screening, an even-odd fill renders these rings fine;
 * precise outer/hole classification is a later refinement. Pure. */
export function featuresToGeoJson(esriFeatures, { source } = {}) {
  const out = [];
  for (const f of esriFeatures || []) {
    const rings = f && f.geometry && f.geometry.rings;
    if (!rings || !rings.length) continue; // skip null/empty geometry
    out.push({
      type: "Feature",
      properties: f.attributes || {},
      geometry: { type: "Polygon", coordinates: rings },
    });
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
// endpoints. Pure.
function douglasPeucker(pts, tol) {
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

/* Simplify every ring of every feature into a NEW FeatureCollection (originals
 * untouched). Each ring is reduced with Douglas–Peucker but ALWAYS re-closed (first
 * coord === last coord) and never has its endpoints dropped; a ring that collapses
 * below 4 points (a degenerate sliver) is dropped, and a feature left with no rings
 * is dropped. Pure. */
export function simplifyGeoJson(fc, tolDeg = 0.00003) {
  const features = [];
  for (const feat of (fc && fc.features) || []) {
    const rings = (feat.geometry && feat.geometry.coordinates) || [];
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
// reuses the same entry). Pure.
function vectorKey(source, bbox) {
  const r = (n) => Number(n).toFixed(3);
  return `vec:${source.id}:${r(bbox.w)},${r(bbox.s)},${r(bbox.e)},${r(bbox.n)}`;
}

/* Fetch a source's simplified GeoJSON over a bbox THROUGH the browser-local SWR
 * cache (B96): paint the last-good copy instantly, refresh in the background, and
 * always carry the data's age. The cache + clock are injected (the app passes the
 * `gisCache` singleton; tests pass a fresh `createGisCache`). Returns the SWR result
 * reshaped as { data, ts, stale } — `data` is the cached copy if present else the
 * freshly-fetched copy; `ts`/`stale` come from the cache entry. The whole pull→
 * GeoJSON→simplify pipeline is the cache's fetcher, so it only runs on a miss/stale. */
export async function fetchCached(source, bbox, { cache, fetchJson = defaultFetchJson, now } = {}) {
  const key = vectorKey(source, bbox);
  const fetcher = async () => {
    const { features } = await fetchVectorFeatures(source, bbox, { fetchJson });
    return simplifyGeoJson(featuresToGeoJson(features, { source }));
  };
  const { cached, stale, fresh } = cache.swr(key, fetcher, { ttl: source.query.ttl });
  if (cached) {
    // Last-good copy exists: hand it back NOW; if it was stale the background refresh
    // is already running (kicked off by swr) and will swap into the cache. `stale`
    // mirrors the cache entry so the caller can show "refreshing…" honestly.
    return { data: cached.data, ts: cached.ts, stale };
  }
  // Cold cache (no copy to paint): await the first fetch so the caller has geometry.
  const r = await fresh;
  const ts = r.ts != null ? r.ts : (now ? now() : Date.now());
  return { data: r.data, ts, stale: false };
}
