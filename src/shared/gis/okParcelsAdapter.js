/* NEW-1 (B2497472, 2026-10-29) — an ArcGIS-REST ↔ OGC-WMS adapter for the State of Oklahoma's STATEWIDE PARCEL MOSAIC
 * (pure: no network, no globals, no DOM; runs in the Pages Function and in tests).
 *
 * WHY. Oklahoma has no ArcGIS REST parcel service, but the Office of Geographic Information's public GeoServer (okmaps.org) publishes
 * the statewide mosaic as `ogi_wms:Statewide_Parcels` — a QUERYABLE WMS layer (`queryable="1"`; its capabilities list GetFeatureInfo
 * with `application/json`). The 2026-10-19 first pass recorded it as "view-only"; GetFeatureInfo — the WMS operation that answers
 * "what is at this point" — returns the parcel's polygon AND its attributes (county, parcelid, accountnumber, owner, acres, trs,
 * dataupdate …), which is everything a click needs. Every Planyr consumer speaks ArcGIS REST (the outline layer, click-to-select,
 * `countyRecord`), so this module translates the `/query` shape into one GetFeatureInfo request and the GeoJSON answer back into
 * `{ attributes, geometry:{rings} }`; a county is then wired with a plain `layerUrl` + `scopeWhere` (`county='Mayes'`) and NOTHING
 * downstream changes. Same shape as the MapGuide adapter (mapguideAdapter.js), whose pure helpers are reused.
 *
 * ACCESS (the rule that must not move). Only the public WMS layer `ogi_wms:Statewide_Parcels` and only the GetFeatureInfo operation —
 * what an anonymous visitor's map client sends. The same GeoServer also lists `ogi_secure:*` workspaces (a separate, secured parcel
 * layer among them); this adapter never names them, sends no key, session or token, and a 401/403 from the server is an error, not
 * something to work around. The host, the layer and the operation are constants here — this is not an open relay.
 *
 * WHAT IT CAN ANSWER. A point ("which lot is here"), and a SMALL envelope (the outline layer's tile cells, ≤ OK_MAX_SPAN_DEG wide).
 * What it cannot: a county-wide attribute search (an account / owner / address typed into the Add-parcel box). GetFeatureInfo only sees
 * the pixels of one map window, and a window the size of a county returns nothing (the layer is scale-gated) or times out — measured
 * 2026-10-29. That is a LOUD 400 ("click the lot"), never an empty list that reads as "no such parcel". */
import { parseQueryGeometry, stableOid, geojsonToRings, arcError } from "./mapguideAdapter.js";

export { arcError };

export const OK_UPSTREAM = "https://okmaps.org/geoserver/wms";
export const OK_LAYER = "ogi_wms:Statewide_Parcels";
export const OK_LAYER_ID = 0;
export const OK_MAX_RECORDS = 1000;
/* The widest envelope one request may cover. A tile cell at the outline layer's floor zoom (16) is ~0.0055° wide; the server answered
 * 0.011° windows in dense towns in 2–9 s and began returning 502 above ~0.011° in places. */
export const OK_MAX_SPAN_DEG = 0.0125;
const POINT_HALF_DEG = 0.0006;   // a 1.2 m-per-pixel window around the clicked point (proven 2026-10-29)
const POINT_PX = 101;
const ENVELOPE_PX = 256;
const POINT_BUFFER_PX = 3;

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
const COUNTY_RE = /^[A-Za-z][A-Za-z .'-]{1,30}$/;
const fail = (msg) => { const e = new Error(msg); e.mgBadRequest = true; return e; };
const truthy = (v) => v === true || /^true$/i.test(String(v));

export const okLayerUrl = () => `/okparcels/FeatureServer/${OK_LAYER_ID}`;

/** ["FeatureServer","0"] → { op:"meta" }; [..,"query"] → { op:"query" }; anything else { error }. */
export function parseOkPath(segs) {
  const [svc, layer, op, ...rest] = (segs || []).filter(Boolean);
  if (svc !== "FeatureServer" || String(layer) !== String(OK_LAYER_ID) || rest.length) return { error: "unknown layer" };
  if (op === undefined) return { op: "meta" };
  if (op === "query") return { op: "query" };
  return { error: "unsupported operation" };
}

/* ── where clause ───────────────────────────────────────────────────────────────
 * What the app sends to a scoped statewide row: `county='Mayes'` (the row's scopeWhere), optionally AND-ed with one search clause
 * (`UPPER(parcelid) LIKE UPPER('%x%')`, `owner = 'x'`, `acres = 3`). The county scope is sent UPSTREAM as CQL (so a neighbouring county's
 * lots can never use up the feature budget); search clauses are applied here, on what came back. */
const stripParens = (s) => { let t = s.trim(); while (t.startsWith("(") && t.endsWith(")") && balanced(t.slice(1, -1))) t = t.slice(1, -1).trim(); return t; };
const balanced = (s) => { let d = 0, q = false; for (const c of s) { if (c === "'") q = !q; else if (!q && c === "(") d++; else if (!q && c === ")" && --d < 0) return false; } return d === 0 && !q; };
function splitAnd(s) {
  const parts = []; let d = 0, q = false, last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") q = !q;
    else if (!q && c === "(") d++;
    else if (!q && c === ")") d--;
    else if (!q && d === 0 && /^\sAND\s/i.test(s.slice(i, i + 5))) { parts.push(s.slice(last, i)); last = i + 5; i += 4; }
  }
  parts.push(s.slice(last));
  return parts;
}
const unq = (s) => s.replace(/''/g, "'");

/** → { county: string|null, filters: [{ field, op: "like"|"eq", value }] }. Anything it does not recognise is a LOUD 400. */
export function translateWhereOk(where) {
  const w = String(where == null ? "1=1" : where).trim();
  const out = { county: null, filters: [] };
  if (!w || /^1\s*=\s*1$/.test(w)) return out;
  for (const raw of splitAnd(stripParens(w))) {
    const c = stripParens(raw);
    if (/^1\s*=\s*1$/.test(c)) continue;
    let m = /^county\s*=\s*'((?:[^']|'')*)'$/i.exec(c);
    if (m) { const v = unq(m[1]); if (!COUNTY_RE.test(v)) throw fail("unreadable county scope"); out.county = v; continue; }
    m = /^(?:UPPER\(\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s+LIKE\s+(?:UPPER\(\s*)?'((?:[^']|'')*)'\s*\)?$/i.exec(c);
    if (m && FIELD_RE.test(m[1])) { out.filters.push({ field: m[1].toLowerCase(), op: "like", value: unq(m[2]).toUpperCase() }); continue; }
    m = /^(?:UPPER\(\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*=\s*(?:UPPER\(\s*)?'((?:[^']|'')*)'\s*\)?$/i.exec(c);
    if (m && FIELD_RE.test(m[1])) { out.filters.push({ field: m[1].toLowerCase(), op: "eq", value: unq(m[2]).toUpperCase() }); continue; }
    m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(c);
    if (m && FIELD_RE.test(m[1])) { out.filters.push({ field: m[1].toLowerCase(), op: "eq", value: m[2] }); continue; }
    throw fail(`unsupported where clause: ${c.slice(0, 80)}`);
  }
  return out;
}

/** SQL-LIKE ('%' wildcard) → anchored test, case-insensitive. */
const likeTest = (pattern) => {
  const re = new RegExp("^" + pattern.split("%").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, ".")).join(".*") + "$", "i");
  return (s) => re.test(String(s == null ? "" : s));
};
const matchFilters = (props, filters) => filters.every((f) => {
  const v = props[f.field];
  if (f.op === "eq") return String(v == null ? "" : v).trim().toUpperCase() === f.value;
  return likeTest(f.value)(v);
});

/* ── request ────────────────────────────────────────────────────────────────────── */
const isoCountyKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

/** ArcGIS /query params → { mode, gfi: URLSearchParams entries, geom, scope, filters, want, wantGeom, fields }. Throws `mgBadRequest` for anything it cannot answer truthfully. */
export function arcQueryToOk(p) {
  const outSR = Number(p.outSR || 4326);
  if (outSR !== 4326) throw fail(`unsupported outSR ${outSR} (4326 only)`);
  if (p.objectIds) throw fail("objectIds is not supported");
  if (p.resultOffset && Number(p.resultOffset) > 0) throw fail("resultOffset is not supported");
  if (p.outStatistics || p.groupByFieldsForStatistics) throw fail("statistics are not supported");
  const mode = truthy(p.returnCountOnly) ? "count" : truthy(p.returnIdsOnly) ? "ids" : "features";
  const geom = parseQueryGeometry(p.geometry, p.inSR);
  if (geom && p.spatialRel && !/Intersects/i.test(p.spatialRel)) throw fail(`unsupported spatialRel ${p.spatialRel}`);
  if (!geom) throw fail("Oklahoma's statewide parcel service can only be asked about a place on the map — click the lot (a search by account, owner or address across a whole county is not available from it)");
  const { county, filters } = translateWhereOk(p.where);
  const want = Math.min(Math.max(Number(p.resultRecordCount) || OK_MAX_RECORDS, 1), OK_MAX_RECORDS);
  const wantGeom = mode === "features" && !/^false$/i.test(String(p.returnGeometry == null ? "true" : p.returnGeometry));
  const fields = (p.outFields == null || p.outFields === "" || p.outFields === "*") ? null : String(p.outFields).split(",").map((s) => s.trim()).filter(Boolean);

  let bbox, width, height, x, y, buffer, count;
  if (geom.x != null) {
    bbox = [geom.x - POINT_HALF_DEG, geom.y - POINT_HALF_DEG, geom.x + POINT_HALF_DEG, geom.y + POINT_HALF_DEG];
    width = height = POINT_PX; x = y = Math.floor(POINT_PX / 2); buffer = POINT_BUFFER_PX; count = 8;
  } else {
    const span = Math.max(geom.xmax - geom.xmin, geom.ymax - geom.ymin);
    if (!(span > 0)) throw fail("empty envelope");
    if (span > OK_MAX_SPAN_DEG) throw fail(`area too large for the statewide parcel service (${span.toFixed(4)}° wide; zoom in to ${OK_MAX_SPAN_DEG}° or less)`);
    const cx = (geom.xmin + geom.xmax) / 2, cy = (geom.ymin + geom.ymax) / 2, h = span / 2;
    bbox = [cx - h, cy - h, cx + h, cy + h];
    width = height = ENVELOPE_PX; x = y = ENVELOPE_PX / 2; buffer = Math.ceil(ENVELOPE_PX * 0.72) + 4; // half-diagonal + margin: the whole window
    count = want + 1; // +1 → exceededTransferLimit is knowable
  }
  const gfi = {
    service: "WMS", version: "1.1.1", request: "GetFeatureInfo", layers: OK_LAYER, query_layers: OK_LAYER, styles: "", srs: "EPSG:4326",
    bbox: bbox.map((n) => n.toFixed(7)).join(","), width: String(width), height: String(height), x: String(x), y: String(y),
    info_format: "application/json", feature_count: String(count), buffer: String(buffer),
  };
  if (county) gfi.cql_filter = `county='${county.replace(/'/g, "''")}'`;
  return { mode, gfi, geom, scope: county, filters, want, wantGeom, fields };
}

export const okUpstreamUrl = (q) => `${OK_UPSTREAM}?${new URLSearchParams(q.gfi).toString()}`;

/* ── response ───────────────────────────────────────────────────────────────────── */
const ringContains = (ring, x, y) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
/* ESRI winding: outer rings clockwise (negative area). A point is inside the polygon when it is inside an odd number of rings. */
const pointInRings = (rings, x, y) => rings.reduce((n, r) => n + (ringContains(r, x, y) ? 1 : 0), 0) % 2 === 1;
const ringsBox = (rings) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
};
const round = (n) => Math.round(n * 1e7) / 1e7;
const clean = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v);

/** One GeoJSON feature → { attributes, geometry? } | null (not a polygon, or outside the asked place). */
export function featureToArcOk(f, q) {
  const props = f.properties || {};
  const rings = geojsonToRings(f.geometry);
  if (!rings) return null;
  if (q.scope && isoCountyKey(props.county) !== isoCountyKey(q.scope)) return null; // belt and braces: the CQL already scoped it
  if (!matchFilters(props, q.filters)) return null;
  if (q.geom.x != null) { if (!pointInRings(rings, q.geom.x, q.geom.y)) return null; }
  else {
    const b = ringsBox(rings);
    if (b[2] < q.geom.xmin || b[0] > q.geom.xmax || b[3] < q.geom.ymin || b[1] > q.geom.ymax) return null;
  }
  const key = `${props.county}|${props.parcelid}|${props.accountnumber}`;
  const attributes = { OBJECTID: stableOid(key) };
  const only = q.fields ? new Set(q.fields.map((x) => x.toLowerCase())) : null;
  for (const [k, v] of Object.entries(props)) {
    if (only && !only.has(k.toLowerCase())) continue;
    attributes[k] = clean(v);
  }
  const out = { attributes };
  if (q.wantGeom) out.geometry = { rings: rings.map((r) => r.map((p) => [round(p[0]), round(p[1])])) };
  return out;
}

/** The whole answer for one /query. `gj` is the parsed GetFeatureInfo GeoJSON. */
export function okToArcQuery(gj, q) {
  const feats = Array.isArray(gj && gj.features) ? gj.features : [];
  const seen = new Set(), all = [];
  for (const f of feats) {
    const a = featureToArcOk(f, q);
    if (!a || seen.has(a.attributes.OBJECTID)) continue;
    seen.add(a.attributes.OBJECTID); all.push(a);
  }
  /* The upstream was asked for `want + 1` (envelope) — more than `want` back means the window held more than we may return. */
  const exceeded = all.length > q.want || (q.geom.x == null && feats.length > q.want);
  const take = all.slice(0, q.want);
  if (q.mode === "count") return { count: take.length };
  if (q.mode === "ids") return { objectIdFieldName: "OBJECTID", objectIds: take.map((a) => a.attributes.OBJECTID) };
  const body = {
    objectIdFieldName: "OBJECTID", globalIdFieldName: "", geometryType: "esriGeometryPolygon",
    spatialReference: { wkid: 4326, latestWkid: 4326 }, hasZ: false, hasM: false, features: take,
  };
  if (exceeded) body.exceededTransferLimit = true;
  return body;
}

/* The columns the layer publishes (read from a live GetFeatureInfo answer 2026-10-29). STATIC on purpose: the outline layer waits on
 * layer metadata before it asks for a single lot, and the only way to discover columns from this service is a map request. */
export const OK_FIELDS = [
  ["county", "esriFieldTypeString"], ["accountnumber", "esriFieldTypeDouble"], ["parcelid", "esriFieldTypeString"], ["owner", "esriFieldTypeString"],
  ["deedbook", "esriFieldTypeString"], ["deedpage", "esriFieldTypeString"], ["combldgcnt", "esriFieldTypeInteger"], ["resibldgcnt", "esriFieldTypeInteger"],
  ["mohobldgcnt", "esriFieldTypeInteger"], ["miscbldgcnt", "esriFieldTypeInteger"], ["schooldistrict", "esriFieldTypeString"], ["acres", "esriFieldTypeDouble"],
  ["community", "esriFieldTypeString"], ["iproplogiclink", "esriFieldTypeString"], ["trs", "esriFieldTypeString"], ["dataupdate", "esriFieldTypeString"],
  ["shapeupdate", "esriFieldTypeString"], ["shape_length", "esriFieldTypeDouble"], ["shape_area", "esriFieldTypeDouble"],
];

export function layerMetadata() {
  const fields = [{ name: "OBJECTID", alias: "OBJECTID", type: "esriFieldTypeOID" }];
  for (const [n, t] of OK_FIELDS) fields.push({ name: n, alias: n, type: t, ...(t === "esriFieldTypeString" ? { length: 255 } : {}) });
  return {
    currentVersion: 10.81, id: OK_LAYER_ID, name: "Oklahoma statewide parcels (Office of Geographic Information)", type: "Feature Layer", geometryType: "esriGeometryPolygon",
    objectIdField: "OBJECTID", displayField: "parcelid", capabilities: "Query", supportedQueryFormats: "JSON",
    maxRecordCount: OK_MAX_RECORDS, supportsAdvancedQueries: false, hasAttachments: false,
    advancedQueryCapabilities: { supportsPagination: false, supportsStatistics: false, supportsOrderBy: false },
    extent: { xmin: -103.962, ymin: 33.634, xmax: -94.433, ymax: 37.0, spatialReference: { wkid: 4326, latestWkid: 4326 } },
    fields,
  };
}

