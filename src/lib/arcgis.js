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

// Turn fetch/CORS failures into something actionable for a non-technical user.
export function humanizeError(e) {
  const m = String(e?.message || e);
  if (/failed to fetch|networkerror|load failed|cors/i.test(m))
    return "Couldn't reach the county server (network or CORS block). The endpoint may have moved, or your network is blocking it — meanwhile use the Aerial underlay to trace the parcel by hand.";
  return m;
}
