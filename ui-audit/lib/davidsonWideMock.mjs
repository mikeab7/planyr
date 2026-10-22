/* A synthetic Davidson County (Nashville) parcel service for the wide-view harness — shaped like the real one that was measured live on
 * 2026-10-22 (Parcels_view FeatureServer: Shape__Area in square FEET, maxRecordCount 2000, OBJECTID, STANPAR), but deterministic and offline.
 * Lots of three known sizes tile the ground around 20 Culvert St, so a harness can say EXACTLY which lots a stage must draw:
 *   house  60×100 ft  = 6,000 ft²   (0.138 ac)   hidden at wide AND mid
 *   mid    100×130 ft = 13,000 ft²  (0.298 ac)   drawn at mid, hidden at wide
 *   big    200×200 ft = 40,000 ft²  (0.918 ac)   drawn at both
 *   huge   450×450 ft = 202,500 ft² (4.65 ac)   drawn at both, and large enough on screen to hold a parcel-ID label at the mid stage
 * The mock honours the parts of /query the app relies on: an envelope (comma form or esri JSON) or a point, `where` of 1=1 or
 * `Shape__Area >= N`, outFields, returnGeometry, f=json|geojson, maxAllowableOffset (ignored), and the 2,000 record cap with
 * exceededTransferLimit (top-level for json, under `properties` for geojson — as ArcGIS Online does). */
export const CULVERT = { lat: 36.1376, lng: -86.75346 };
export const DAVIDSON_URL = "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Parcels_view/FeatureServer/0";
export const SIZES = { house: [60, 100], mid: [100, 130], big: [200, 200], huge: [450, 450] };
const PITCH = 480; // ft between lot origins (every lot fits inside its cell)
const FT = 0.3048;
const kx = 111320 * Math.cos((CULVERT.lat * Math.PI) / 180), ky = 110574;
const N = 70;

export function typeOf(i, j) { if ((((i * 3 + j * 5) % 7) + 7) % 7 === 0) return "huge"; const k = (((i * 7 + j * 3) % 5) + 5) % 5; return k < 3 ? "house" : k === 3 ? "mid" : "big"; }
export function lotAtCell(i, j) {
  const kind = typeOf(i, j), [w, h] = SIZES[kind];
  const x0 = i * PITCH * FT, y0 = j * PITCH * FT;
  const lng = (x) => CULVERT.lng + x / kx, lat = (y) => CULVERT.lat + y / ky;
  const ring = [[lng(x0), lat(y0)], [lng(x0 + w * FT), lat(y0)], [lng(x0 + w * FT), lat(y0 + h * FT)], [lng(x0), lat(y0 + h * FT)], [lng(x0), lat(y0)]];
  return { id: (i + 1000) * 10000 + (j + 1000), kind, area: w * h, ring, i, j, centre: [lat(y0 + (h * FT) / 2), lng(x0 + (w * FT) / 2)] };
}
export function* allLots() { for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) yield lotAtCell(i, j); }
const LOTS = [...allLots()];
const box = (l) => { const xs = l.ring.map((p) => p[0]), ys = l.ring.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
for (const l of LOTS) l.box = box(l);
export const LOT_COUNT = LOTS.length;

/** How many lots of each kind intersect [w,s,e,n] and meet `minFt2`. */
export function expectedIn(env, minFt2 = 0) {
  const out = { house: 0, mid: 0, big: 0, huge: 0, total: 0 };
  for (const l of LOTS) {
    if (l.area < minFt2) continue;
    if (l.box[0] > env[2] || l.box[2] < env[0] || l.box[1] > env[3] || l.box[3] < env[1]) continue;
    out[l.kind]++; out.total++;
  }
  return out;
}

const META = JSON.stringify({
  name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", objectIdField: "OBJECTID", maxRecordCount: 2000,
  fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }, { name: "STANPAR", type: "esriFieldTypeString", alias: "STANPAR" }, { name: "Shape__Area", type: "esriFieldTypeDouble", alias: "Shape__Area" }],
  capabilities: "Query,Extract", extent: { xmin: -87.2, ymin: 35.9, xmax: -86.5, ymax: 36.4, spatialReference: { wkid: 4326 } },
});

function parseEnv(p) {
  const g = p.get("geometry");
  if (!g) return null;
  if (g.trim().startsWith("{")) { const j = JSON.parse(g); if ("xmin" in j) return { env: [j.xmin, j.ymin, j.xmax, j.ymax] }; if ("x" in j) return { point: [j.x, j.y] }; return null; }
  const a = g.split(",").map(Number);
  return a.length === 4 ? { env: a } : { point: a };
}

/** Answer one /query (params already parsed). Returns { status, body, meta } where meta = { where, env, minFt2, lots }. */
export function answerQuery(p) {
  const f = p.get("f") || "json";
  const where = p.get("where") || "1=1";
  const m = /Shape__Area\s*>=\s*([0-9.]+)/i.exec(where);
  const minFt2 = m ? Number(m[1]) : 0;
  const shape = parseEnv(p);
  let hits = LOTS;
  if (shape && shape.env) hits = LOTS.filter((l) => !(l.box[0] > shape.env[2] || l.box[2] < shape.env[0] || l.box[1] > shape.env[3] || l.box[3] < shape.env[1]));
  else if (shape && shape.point) hits = LOTS.filter((l) => shape.point[0] >= l.box[0] && shape.point[0] <= l.box[2] && shape.point[1] >= l.box[1] && shape.point[1] <= l.box[3]);
  if (minFt2) hits = hits.filter((l) => l.area >= minFt2);
  if (p.get("returnCountOnly") === "true") return { status: 200, body: JSON.stringify({ count: hits.length }), meta: { where, minFt2, lots: hits.length } };
  const exceeded = hits.length > 2000;
  const rows = hits.slice(0, 2000);
  const withGeom = p.get("returnGeometry") !== "false";
  let body;
  if (f === "geojson") {
    body = JSON.stringify({ type: "FeatureCollection", ...(exceeded ? { properties: { exceededTransferLimit: true } } : {}), features: rows.map((l) => ({ type: "Feature", id: l.id, properties: { OBJECTID: l.id, STANPAR: `S${l.id}`, Shape__Area: l.area }, geometry: withGeom ? { type: "Polygon", coordinates: [l.ring] } : null })) });
  } else {
    body = JSON.stringify({ objectIdFieldName: "OBJECTID", geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }], ...(exceeded ? { exceededTransferLimit: true } : {}), features: rows.map((l) => ({ attributes: { OBJECTID: l.id, STANPAR: `S${l.id}`, Shape__Area: l.area }, ...(withGeom ? { geometry: { rings: [l.ring] } } : {}) })) });
  }
  return { status: 200, body, meta: { where, env: shape && shape.env, minFt2, lots: rows.length, exceeded } };
}
export const metaBody = () => META;
