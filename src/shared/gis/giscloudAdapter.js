/* NEW-1 (Missouri second pass, 2026-10-29) — a GIS Cloud ↔ ArcGIS-REST adapter (pure: no network, no globals, no DOM; runs in the Pages Function and in tests).
 *
 * WHY. Clinton and Hickory counties (Missouri) publish their parcels as the public map their county GIS contractor (Mapping Solutions) keeps on GIS Cloud
 * (`clintoncountymo.giscloud.com`, `hickorycountymo.giscloud.com`). GIS Cloud has no `/rest/services`; every Planyr consumer — the esri-leaflet outline layer,
 * click-to-select (`queryAtPoint`), the ID/address search, `countyRecord` — speaks ArcGIS REST. This module is the same idea as `mapguideAdapter.js`: it
 * translates the ArcGIS `/query` shape into GIS Cloud's `layers/<id>/features.json` request and the GeoJSON-ish answer back into
 * `{ attributes, geometry:{rings} }`, so a county is wired with a plain `layerUrl` (`/gc/<key>/FeatureServer/0`) and NOTHING downstream changes.
 *
 * ACCESS (the rule that must not move). Only what an anonymous visitor to the county's public map already gets from GIS Cloud's own public REST API: no key,
 * no session, no cookie, no token — the request carries none and the response is read as it comes. The layer id is chosen from the fixed table below, never
 * from the caller, and the only filters that ever reach GIS Cloud are the three `where` shapes `translateWhere` accepts and a bounding box, so this is not an
 * open relay and not a free-SQL pass-through. A 401/403 from the server is surfaced as an error, never worked around.
 *
 * COORDINATES. `epsg=4326` makes GIS Cloud return lon/lat itself (the maps are stored in Web Mercator / UTM 15N), so no projection math touches a vertex.
 * `bounds=` is a bounding-box overlap test (a neighbour's sliver can ride along), so a POINT is asked as a tiny box and then decided exactly here
 * (even-odd point-in-polygon over every ring) — the answer is the lot the point is in, never its neighbour.
 *
 * IDS. GIS Cloud's `__id` is the row id inside the layer (stable between requests); it is the OBJECTID. */
import {
  parseQueryGeometry, geojsonToRings, ringsAcres, arcError, splitAnd, stripParens, lit, truthy, outFieldList, fail,
} from "./mapguideAdapter.js";

export { arcError };
export const GC_API = "https://api.giscloud.com/1";
export const GC_MAX_RECORDS = 2000;
export const GC_LAYER_ID = 0;
const KEY_RE = /^[a-z]{3,20}$/;
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
const POINT_PAD = 0.00002; // degrees (~2 m): the box a point is asked in before the exact point-in-polygon test

/* The public maps. `layerId` is the GIS Cloud layer (read from the county's own map: `…/rest/1/maps/<defaultMapId>/layers.json`); `id`/`addr`/`owner`/`acres`
 * are the county's own column names (MEASURED 2026-10-29). `fields` is what layer metadata advertises so the app's field detection sees them. */
export const GC_MAPS = {
  clinton: {
    county: "Clinton", layerId: "4976776", mapId: "883990", id: "parcel_num", addr: "siteaddres", owner: "deedholder", acres: "deeded_acr",
    fields: ["parcel_num", "parcel", "legal", "s_t_r", "siteaddres", "deedholder", "mailing_ad", "mailing__1", "mailing__2", "mailing__3", "mailing__4", "city", "state", "subdivdesc", "deeded_acr", "sale_date"],
  },
  hickory: {
    county: "Hickory", layerId: "2619197", mapId: "505668", id: "parcel", addr: "address_1", owner: "name", acres: "acres",
    fields: ["parcel", "name", "address_1", "address_3", "acres", "twp", "range", "sect"],
  },
};

export const gcFeaturesUrl = (key) => `${GC_API}/layers/${GC_MAPS[key].layerId}/features.json`;
export const gcLayerUrl = (key) => `/gc/${key}/FeatureServer/${GC_LAYER_ID}`;

/** ["clinton","FeatureServer","0","query"] → { key, op } or { error }. */
export function parseGcPath(segs) {
  const [key, svc, layer, op, ...rest] = (segs || []).filter(Boolean);
  if (!KEY_RE.test(key || "") || !Object.prototype.hasOwnProperty.call(GC_MAPS, key)) return { error: "unknown map" };
  if (svc !== "FeatureServer" || String(layer) !== String(GC_LAYER_ID) || rest.length) return { error: "unknown layer" };
  if (op === undefined) return { key, op: "meta" };
  if (op === "query") return { key, op: "query" };
  return { error: "unsupported operation" };
}

/* ── where clause ─────────────────────────────────────────────────────────────
 * The ArcGIS `where` strings the app builds (buildParcelWhere): `UPPER(F) LIKE UPPER('%x%')`, `F = 123`, `F = 'x'`, `F LIKE '…'`, joined with AND, and `1=1`.
 * Returns the GIS Cloud `where` (the same shape, the field name checked against the layer's own columns, the literal quoted by us) or null.
 * Anything else is a LOUD 400 — never a silently different query, never free SQL. */
export function translateWhere(where, key) {
  const w = String(where == null ? "1=1" : where).trim();
  if (!w || /^1\s*=\s*1$/.test(w)) return null;
  const cols = new Set(GC_MAPS[key].fields.map((f) => f.toLowerCase()));
  const col = (name) => { if (!FIELD_RE.test(name) || !cols.has(name.toLowerCase())) throw fail(`unknown column ${String(name).slice(0, 40)}`); return name.toLowerCase(); };
  const out = [];
  for (const raw of splitAnd(stripParens(w))) {
    const c = stripParens(raw);
    if (/^1\s*=\s*1$/.test(c)) continue;
    let m = /^(?:UPPER\(\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s+LIKE\s+(?:UPPER\(\s*)?'((?:[^']|'')*)'\s*\)?$/i.exec(c);
    if (m) { out.push(`UPPER(${col(m[1])}) LIKE UPPER(${lit(m[2].replace(/''/g, "'"))})`); continue; }
    m = /^(?:UPPER\(\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*=\s*(?:UPPER\(\s*)?'((?:[^']|'')*)'\s*\)?$/i.exec(c);
    if (m) { out.push(`UPPER(${col(m[1])}) = UPPER(${lit(m[2].replace(/''/g, "'"))})`); continue; }
    m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(c);
    if (m) { out.push(`${col(m[1])} = ${m[2]}`); continue; }
    throw fail(`unsupported where clause: ${c.slice(0, 80)}`);
  }
  return out.length ? out.join(" AND ") : null;
}

/* ── request ──────────────────────────────────────────────────────────────── */
/** ArcGIS /query params (an object of strings) → { mode, params, point, want, wantGeom, fields }; `params` are the GIS Cloud query-string entries. */
export function arcQueryToGc(p, key) {
  const outSR = Number(p.outSR || 4326);
  if (outSR !== 4326) throw fail(`unsupported outSR ${outSR} (4326 only)`);
  if (p.objectIds) throw fail("objectIds is not supported");
  if (p.resultOffset && Number(p.resultOffset) > 0) throw fail("resultOffset is not supported");
  if (p.outStatistics || p.groupByFieldsForStatistics) throw fail("statistics are not supported");
  const mode = truthy(p.returnCountOnly) ? "count" : truthy(p.returnIdsOnly) ? "ids" : "features";
  const geom = parseQueryGeometry(p.geometry, p.inSR);
  if (geom && p.spatialRel && !/Intersects/i.test(p.spatialRel)) throw fail(`unsupported spatialRel ${p.spatialRel}`);
  const params = { epsg: "4326", geometry: "geojson" };
  let point = null;
  if (geom && geom.x != null) {
    point = { x: geom.x, y: geom.y };
    params.bounds = [geom.x - POINT_PAD, geom.y - POINT_PAD, geom.x + POINT_PAD, geom.y + POINT_PAD].map((n) => n.toFixed(7)).join(",");
  } else if (geom) {
    params.bounds = [geom.xmin, geom.ymin, geom.xmax, geom.ymax].map((n) => Number(n).toFixed(7)).join(",");
  }
  const attr = translateWhere(p.where, key);
  if (attr) params.where = attr;
  const wantGeom = mode === "features" && !/^false$/i.test(String(p.returnGeometry == null ? "true" : p.returnGeometry));
  const want = Math.min(Math.max(Number(p.resultRecordCount) || GC_MAX_RECORDS, 1), GC_MAX_RECORDS);
  return { mode, params, point, want, wantGeom, fields: outFieldList(p.outFields), key };
}

/* ── response ─────────────────────────────────────────────────────────────── */
/* Even-odd containment over every ring of a (Multi)Polygon's rings (a hole is a ring too, so it excludes — the rule the map draws by). */
export function ringsContain(rings, x, y) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const clean = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v);
const round = (n) => Math.round(n * 1e7) / 1e7;

/** One GIS Cloud feature → { attributes, geometry? } or null (no usable polygon / not the lot the point is in). */
export function featureToArc(f, q) {
  const oid = Number(f.__id);
  if (!Number.isSafeInteger(oid)) return null;
  const rings = geojsonToRings(f.__geometry);
  if (!rings) return null;
  if (q.point && !ringsContain(rings, q.point.x, q.point.y)) return null;
  const only = q.fields && !q.fields.includes("*") ? new Set(q.fields.map((x) => x.toLowerCase())) : null;
  const attributes = { OBJECTID: oid };
  for (const [k, v] of Object.entries(f.data || {})) {
    if (only && !only.has(k.toLowerCase())) continue;
    attributes[k] = clean(v);
  }
  if (!only) { const ac = ringsAcres(rings); if (ac != null) attributes.GIS_ACRES = ac; }
  const out = { attributes };
  if (q.wantGeom) out.geometry = { rings: rings.map((r) => r.map((p) => [round(p[0]), round(p[1])])) };
  return out;
}

/** The whole answer for one /query. `gj` is the parsed `features.json` body. */
export function gcToArcQuery(gj, q) {
  const raw = Array.isArray(gj && gj.data) ? gj.data : [];
  const all = raw.map((f) => featureToArc(f, q)).filter(Boolean);
  const exceeded = all.length > q.want || raw.length >= 5000; // 5000 is GIS Cloud's page size: a full page means there may be more
  const take = all.slice(0, q.want);
  if (q.mode === "count") return { count: take.length };
  if (q.mode === "ids") return { objectIdFieldName: "OBJECTID", objectIds: take.map((x) => x.attributes.OBJECTID) };
  const body = {
    objectIdFieldName: "OBJECTID", globalIdFieldName: "", geometryType: "esriGeometryPolygon",
    spatialReference: { wkid: 4326, latestWkid: 4326 }, hasZ: false, hasM: false, features: take,
  };
  if (exceeded) body.exceededTransferLimit = true;
  return body;
}

/** Layer metadata (`?f=json` on the layer URL). STATIC on purpose (see `MG_CORE_FIELDS`): the outline layer waits on this before it asks for one lot. */
export function layerMetadata(key) {
  const m = GC_MAPS[key];
  const fields = [{ name: "OBJECTID", alias: "OBJECTID", type: "esriFieldTypeOID" }];
  for (const n of m.fields) fields.push({ name: n, alias: n, type: "esriFieldTypeString", length: 255 });
  fields.push({ name: "GIS_ACRES", alias: "GIS_ACRES", type: "esriFieldTypeDouble" });
  return {
    currentVersion: 10.81, id: GC_LAYER_ID, name: `${m.county} County Parcels`, type: "Feature Layer", geometryType: "esriGeometryPolygon",
    objectIdField: "OBJECTID", displayField: m.id, capabilities: "Query", supportedQueryFormats: "JSON",
    maxRecordCount: GC_MAX_RECORDS, supportsAdvancedQueries: false, hasAttachments: false,
    advancedQueryCapabilities: { supportsPagination: false, supportsStatistics: false, supportsOrderBy: false },
    fields,
  };
}
