/* Minimal Esri ArcGIS REST client — just enough to look up a parcel and turn
 * its geometry into a polygon in local feet. All requests run in the browser,
 * so they depend on the target server allowing CORS (Esri's do, by default).
 */
import { FEET_WKID } from "./counties.js";

async function fetchJson(url, params) {
  const u = new URL(url);
  u.searchParams.set("f", "json");
  if (params)
    for (const [k, v] of Object.entries(params))
      if (v != null) u.searchParams.set(k, String(v));
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`Server returned HTTP ${res.status}.`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "ArcGIS query error.");
  return j;
}

const trim = (s) => s.replace(/\/+$/, "");

// Layer metadata: name, geometry type, and field list.
export async function getLayerInfo(layerUrl) {
  const j = await fetchJson(layerUrl);
  return {
    name: j.name,
    type: j.type,
    geometryType: j.geometryType,
    fields: (j.fields || []).map((f) => ({
      name: f.name,
      alias: f.alias,
      type: f.type,
    })),
  };
}

// All layers in a MapServer/FeatureServer root.
export async function listLayers(serviceUrl) {
  const j = await fetchJson(trim(serviceUrl) + "/layers");
  return (j.layers || []).map((l) => ({
    id: l.id,
    name: l.name,
    geometryType: l.geometryType,
    type: l.type,
  }));
}

// If a service-root URL was given, resolve it to the best parcels layer URL.
export async function resolveLayerUrl(url) {
  if (/\/(MapServer|FeatureServer)\/\d+\/?$/i.test(url)) return trim(url);
  if (/\/(MapServer|FeatureServer)\/?$/i.test(url)) {
    const layers = await listLayers(url);
    if (!layers.length) throw new Error("That service has no layers.");
    const polys = layers.filter((l) => /polygon/i.test(l.geometryType || ""));
    const pick =
      polys.find((l) => /parcel/i.test(l.name || "")) ||
      layers.find((l) => /parcel/i.test(l.name || "")) ||
      polys[0] ||
      layers[0];
    return trim(url) + "/" + pick.id;
  }
  return trim(url); // assume it's already a layer URL
}

// Query features, returning geometry in Texas State Plane feet (EPSG:2278).
export async function queryFeatures(
  layerUrl,
  { where = "1=1", outFields = "*", count = 8, outSR = FEET_WKID } = {}
) {
  const j = await fetchJson(trim(layerUrl) + "/query", {
    where,
    outFields,
    returnGeometry: "true",
    outSR,
    resultRecordCount: count,
  });
  return j.features || [];
}

function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    a += r[i][0] * r[j][1] - r[j][0] * r[i][1];
  }
  return a / 2;
}

// The outer-boundary ring of an ArcGIS polygon. Outer rings and holes wind oppositely;
// the largest ring by |area| is always an outer boundary (a hole can't exceed the ring
// that contains it), so picking the max-|area| ring can never select a hole — even on a
// multipart feature whose biggest hole exceeds a small separate part (B36c).
function largestRing(rings) {
  let best = rings[0], bestA = Math.abs(ringArea(rings[0]));
  for (const r of rings) { const a = Math.abs(ringArea(r)); if (a > bestA) { best = r; bestA = a; } }
  return best;
}

// Area-weighted centroid of a ring [[x,y],…] — unbiased by vertex density (a plain
// vertex average drifts toward a densely-digitized curved edge). Falls back to the
// vertex mean only for a degenerate (zero-area) ring (B36c).
function ringCentroid(r) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < r.length; i++) {
    const j = (i + 1) % r.length;
    const cross = r[i][0] * r[j][1] - r[j][0] * r[i][1];
    a += cross; cx += (r[i][0] + r[j][0]) * cross; cy += (r[i][1] + r[j][1]) * cross;
  }
  if (Math.abs(a) < 1e-9) { let vx = 0, vy = 0; r.forEach(([x, y]) => { vx += x; vy += y; }); return [vx / r.length, vy / r.length]; }
  a *= 0.5; return [cx / (6 * a), cy / (6 * a)];
}

const ringClosed = (r) => r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];

/* Convert an ArcGIS polygon feature (rings in State Plane feet) into the app's
 * local polygon: pick the outer ring, recenter on its area centroid, and flip Y so
 * north points up on screen. Returns [{x,y}] in feet, or null. */
export function featureToParcel(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return null;
  const best = largestRing(rings);
  const [cx, cy] = ringCentroid(best);
  const ring = ringClosed(best) ? best.slice(0, -1) : best;
  return ring.map(([x, y]) => ({ x: x - cx, y: -(y - cy) }));
}

// Find the parcel polygon under a clicked map point. Returns the ArcGIS feature
// with geometry in lon/lat (EPSG:4326), which every service supports, or null.
export async function queryAtPoint(layerUrl, lng, lat) {
  const geometry = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
  const j = await fetchJson(trim(layerUrl) + "/query", {
    geometry,
    geometryType: "esriGeometryPoint",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    outSR: 4326,
  });
  return (j.features || [])[0] || null;
}

/* Identify the parcel under a clicked point across several candidate counties at
 * once — so the user never has to pre-pick a county. Each candidate is
 * { county, url } (the county's resolved parcel-layer URL). Queries them in
 * parallel and returns EVERY hit as { county, feature } (a click that straddles a
 * county line can legitimately hit two — the caller merges). A candidate whose
 * service is down/unreachable is skipped (its rejection swallowed) rather than
 * failing the whole identify, so a sibling county can still answer. Returns [] when
 * nothing matched anywhere. */
export async function identifyParcelAcross(candidates, lng, lat) {
  const results = await Promise.allSettled(
    (candidates || []).map(async ({ county, url }) => {
      const feature = await queryAtPoint(url, lng, lat);
      return feature ? { county, feature } : null;
    })
  );
  return results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
}

/* Convert a lon/lat polygon feature into local feet for the planner, plus the
 * [lat,lng] ring for drawing a highlight on the Leaflet map. Uses a local
 * equirectangular projection about the parcel centroid — exact enough for a
 * single lot (sub-0.3% over a few hundred feet) and avoids depending on the
 * server reprojecting to State Plane. North is flipped up to match the planner. */
export function lngLatFeatureToParcel(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return null;
  const best = largestRing(rings);
  const [lon0, lat0] = ringCentroid(best);
  const ring = ringClosed(best) ? best.slice(0, -1) : best;
  const FT_PER_DEG_LAT = 365223; // feet per degree latitude (Web-Mercator sphere base)
  const FT_PER_DEG_LON = 365223 * Math.cos((lat0 * Math.PI) / 180);
  const points = ring.map(([lon, lat]) => ({
    x: (lon - lon0) * FT_PER_DEG_LON,
    y: -(lat - lat0) * FT_PER_DEG_LAT,
  }));
  const latlngs = ring.map(([lon, lat]) => [lat, lon]);
  return { points, latlngs };
}

// The outer ring of a feature as an open [[lon,lat], ...] array (4326).
export function largestRingLngLat(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return null;
  const best = largestRing(rings);
  return ringClosed(best) ? best.slice(0, -1) : best;
}

/* EVERY outer-boundary ring of a (possibly MULTIPART) polygon feature, each as an
 * open [[lon,lat], ...] array (4326). A parcel can legitimately be several separate
 * pieces under one account — e.g. "TRS 3 & 5" is two physically separate tracts —
 * and the largest-ring-only pick (B36c) silently dropped the smaller piece: a click
 * in it registered the account but highlighted (and imported) only the biggest
 * tract, so the clicked piece "wouldn't select" and a neighbour appeared to. This
 * returns all outer parts so callers can highlight + plan every tract. Holes (rings
 * wound opposite to the outers) are excluded — the planner parcel model has no
 * donut support and the prior behaviour already ignored them. Returns [] if none. */
export function outerRingsLngLat(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return [];
  // Outer rings and holes wind oppositely (ArcGIS: outers clockwise, holes CCW);
  // the largest |area| ring is always an outer boundary, so its winding sign marks
  // the outers. Keep same-sign, non-degenerate rings; drop the opposite-sign holes.
  const areas = rings.map(ringArea);
  let outerSign = 1, bestA = -1;
  areas.forEach((a) => { if (Math.abs(a) > bestA) { bestA = Math.abs(a); outerSign = Math.sign(a) || 1; } });
  return rings
    .filter((_, i) => areas[i] !== 0 && Math.sign(areas[i]) === outerSign)
    .map((r) => (ringClosed(r) ? r.slice(0, -1) : r));
}

// Feet per degree using the Web-Mercator sphere base (2πR/360 ≈ 365223 ft) for
// BOTH axes — so the local equirectangular feet model is a linearization of
// spherical Mercator and overlays a Web-Mercator aerial basemap with no axis
// distortion (the planner/map both render on such a basemap).
const FT_PER_DEG_LAT = 365223;
const ftPerDegLon = (lat) => 365223 * Math.cos((lat * Math.PI) / 180);

// Project a lon/lat ring to local feet about a shared origin (north up).
export function lngLatRingToFeet(ring, lon0, lat0) {
  const FT_LON = ftPerDegLon(lat0);
  return ring.map(([lon, lat]) => ({
    x: (lon - lon0) * FT_LON,
    y: -(lat - lat0) * FT_PER_DEG_LAT,
  }));
}

// Inverse of the above: a planner-feet point back to [lat, lng] for Leaflet,
// given the site's geographic origin. Lets the map redraw saved-site footprints.
export function feetToLatLng(pt, lat0, lon0) {
  return [lat0 - pt.y / FT_PER_DEG_LAT, lon0 + pt.x / ftPerDegLon(lat0)];
}

// Feet placement for an aerial export covering a lon/lat bbox, in the same local
// frame (origin lon0/lat0) as the parcels. The export is sized to the *degree*
// aspect so the server returns exactly this bbox (no aspect padding); we then
// stretch it (preserveAspectRatio="none") into the true-feet rectangle using the
// same FT_PER_DEG constants the parcels use, so image and boundary align exactly.
// ftPerPx is the horizontal scale, ftPerPxY the vertical (they differ at this
// latitude — that vertical stretch is what was missing before).
export function aerialPlacement(bbox, lon0, lat0, opts = {}) {
  const maxPx = opts.maxPx || 1800;
  const exportBase =
    opts.exportBase ||
    "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export";
  const FT_LON = ftPerDegLon(lat0);
  const lonSpan = bbox.lonMax - bbox.lonMin;
  const latSpan = bbox.latMax - bbox.latMin;
  let imgW, imgH;
  if (lonSpan >= latSpan) { imgW = maxPx; imgH = Math.max(16, Math.round(maxPx * (latSpan / lonSpan))); }
  else { imgH = maxPx; imgW = Math.max(16, Math.round(maxPx * (lonSpan / latSpan))); }
  const widthFt = lonSpan * FT_LON;
  const heightFt = latSpan * FT_PER_DEG_LAT;
  const src =
    `${exportBase}?bbox=${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax}` +
    `&bboxSR=4326&imageSR=4326&size=${imgW},${imgH}&format=jpg&transparent=false&f=image`;
  return {
    src,
    imgW,
    imgH,
    ftPerPx: widthFt / imgW,
    ftPerPxY: heightFt / imgH,
    x: (bbox.lonMin - lon0) * FT_LON,
    y: -(bbox.latMax - lat0) * FT_PER_DEG_LAT,
  };
}

// Turn fetch/CORS failures into something actionable for a non-technical user.
export function humanizeError(e) {
  const m = String(e?.message || e);
  if (/failed to fetch|networkerror|load failed|cors/i.test(m))
    return "Couldn't reach the county server (network or CORS block). The endpoint may have moved, or your network is blocking it — meanwhile use the Aerial underlay to trace the parcel by hand.";
  return m;
}
