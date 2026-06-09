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

/* Convert an ArcGIS polygon feature (rings in State Plane feet) into the app's
 * local polygon: pick the largest outer ring, recenter on its centroid, and
 * flip Y so north points up on screen. Returns [{x,y}] in feet, or null. */
export function featureToParcel(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return null;
  let best = rings[0];
  let bestA = Math.abs(ringArea(rings[0]));
  for (const r of rings) {
    const a = Math.abs(ringArea(r));
    if (a > bestA) {
      best = r;
      bestA = a;
    }
  }
  let cx = 0;
  let cy = 0;
  best.forEach(([x, y]) => {
    cx += x;
    cy += y;
  });
  cx /= best.length;
  cy /= best.length;
  const closed =
    best.length > 1 &&
    best[0][0] === best[best.length - 1][0] &&
    best[0][1] === best[best.length - 1][1];
  const ring = closed ? best.slice(0, -1) : best;
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

/* Convert a lon/lat polygon feature into local feet for the planner, plus the
 * [lat,lng] ring for drawing a highlight on the Leaflet map. Uses a local
 * equirectangular projection about the parcel centroid — exact enough for a
 * single lot (sub-0.3% over a few hundred feet) and avoids depending on the
 * server reprojecting to State Plane. North is flipped up to match the planner. */
export function lngLatFeatureToParcel(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return null;
  let best = rings[0];
  let bestA = Math.abs(ringArea(rings[0]));
  for (const r of rings) {
    const a = Math.abs(ringArea(r));
    if (a > bestA) {
      best = r;
      bestA = a;
    }
  }
  let lon0 = 0;
  let lat0 = 0;
  best.forEach(([x, y]) => {
    lon0 += x;
    lat0 += y;
  });
  lon0 /= best.length;
  lat0 /= best.length;
  const closed =
    best.length > 1 &&
    best[0][0] === best[best.length - 1][0] &&
    best[0][1] === best[best.length - 1][1];
  const ring = closed ? best.slice(0, -1) : best;
  const FT_PER_DEG_LAT = 362776; // ~ feet per degree of latitude
  const FT_PER_DEG_LON = 365223 * Math.cos((lat0 * Math.PI) / 180);
  const points = ring.map(([lon, lat]) => ({
    x: (lon - lon0) * FT_PER_DEG_LON,
    y: -(lat - lat0) * FT_PER_DEG_LAT,
  }));
  const latlngs = ring.map(([lon, lat]) => [lat, lon]);
  return { points, latlngs };
}

// The largest outer ring of a feature as an open [[lon,lat], ...] array (4326).
export function largestRingLngLat(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings || !rings.length) return null;
  let best = rings[0];
  let bestA = Math.abs(ringArea(rings[0]));
  for (const r of rings) {
    const a = Math.abs(ringArea(r));
    if (a > bestA) { best = r; bestA = a; }
  }
  const closed =
    best.length > 1 &&
    best[0][0] === best[best.length - 1][0] &&
    best[0][1] === best[best.length - 1][1];
  return closed ? best.slice(0, -1) : best;
}

const FT_PER_DEG_LAT = 362776; // feet per degree of latitude (≈ constant)
const ftPerDegLon = (lat) => 365223 * Math.cos((lat * Math.PI) / 180);

// Project a lon/lat ring to local feet about a shared origin (north up).
export function lngLatRingToFeet(ring, lon0, lat0) {
  const FT_LON = ftPerDegLon(lat0);
  return ring.map(([lon, lat]) => ({
    x: (lon - lon0) * FT_LON,
    y: -(lat - lat0) * FT_PER_DEG_LAT,
  }));
}

// Feet placement for an aerial export covering a lon/lat bbox, in the same local
// frame (origin lon0/lat0) as the parcels. The export is sized to the *degree*
// aspect so the server returns exactly this bbox (no aspect padding); we then
// stretch it (preserveAspectRatio="none") into the true-feet rectangle using the
// same FT_PER_DEG constants the parcels use, so image and boundary align exactly.
// ftPerPx is the horizontal scale, ftPerPxY the vertical (they differ at this
// latitude — that vertical stretch is what was missing before).
export function aerialPlacement(bbox, lon0, lat0, maxPx = 1400) {
  const FT_LON = ftPerDegLon(lat0);
  const lonSpan = bbox.lonMax - bbox.lonMin;
  const latSpan = bbox.latMax - bbox.latMin;
  let imgW, imgH;
  if (lonSpan >= latSpan) { imgW = maxPx; imgH = Math.max(16, Math.round(maxPx * (latSpan / lonSpan))); }
  else { imgH = maxPx; imgW = Math.max(16, Math.round(maxPx * (lonSpan / latSpan))); }
  const widthFt = lonSpan * FT_LON;
  const heightFt = latSpan * FT_PER_DEG_LAT;
  const src =
    "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export" +
    `?bbox=${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax}` +
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
