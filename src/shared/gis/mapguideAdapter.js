/* B2302785 — a MapGuide ↔ ArcGIS-REST adapter (pure: no network, no globals, no DOM; runs in the Pages Function and in tests).
 *
 * WHY. Alabama's 26 Flagship-GIS counties publish their parcels only through Autodesk MapGuide (the county's public
 * `www.alabamagis.com/<County>/` viewer → `fgis-map-<n>.flagshipcloud.com/mapserver<n>`), which has no `/rest/services`. Every
 * Planyr consumer — the esri-leaflet outline layer, click-to-select (`queryAtPoint`), the ID/address search, `countyRecord` — speaks
 * ArcGIS REST. This module translates the ArcGIS `/query` shape into the MapGuide REST extension's `features.geojson` request and the
 * GeoJSON answer back into `{ attributes, geometry:{rings} }`, so a county is wired with a plain `layerUrl` and NOTHING downstream changes.
 *
 * ACCESS. Only what the county's own PUBLIC viewer already does for an anonymous visitor: the `rest/library/<COUNTY>/3_LAYERS/
 * Parcels.LayerDefinition/features.geojson` search endpoint (read by the viewer's mobile search page with no key, no session, no token).
 * Nothing here harvests, replays or fabricates a credential, and a 401/403 from the server is surfaced as an error, never worked around.
 *
 * COORDINATES. The layers are stored in Web Mercator (EPSG:3857). Spatial filters are built in Mercator; geometry is returned in
 * lon/lat by the server itself (`transformto=LL84`), so no projection math touches a returned vertex.
 *
 * IDS. MapGuide's feature `id` is the row index inside ONE response — not stable. ArcGIS consumers (esri-leaflet's tile cache, the
 * dedupe in parcelDisplay) need a stable OBJECTID, so it is a 53-bit hash of the parcel id (`cyrb53`), identical on every request. */

export const MG_SERVERS = [100, 101, 102, 104, 105, 106, 107, 110];
export const MG_MAX_RECORDS = 2000;
export const MG_LAYER_ID = 0;
const COUNTY_RE = /^[A-Z]{3,20}$/;
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;
const ACRE_M2 = 4046.8564224;

export const mgHost = (server) => `fgis-map-${server}.flagshipcloud.com`;
export const mgFeaturesUrl = (server, county) =>
  `https://${mgHost(server)}/mapserver${server}/rest/library/${county}/3_LAYERS/Parcels.LayerDefinition/features.geojson`;

/* The relay path a county row points at. `FeatureServer/0` on purpose: `resolveLayerUrl` accepts it as a finished layer URL and the app's
 * MapServer-only branches (identify fallback, image mode) never apply to it. */
export const mgLayerUrl = (server, county) => `/mg/${server}/${county}/FeatureServer/${MG_LAYER_ID}`;

/** ["106","BIBB","FeatureServer","0","query"] → { server, county, op } or { error }. */
export function parseMgPath(segs) {
  const [srv, county, svc, layer, op, ...rest] = (segs || []).filter(Boolean);
  const server = Number(srv);
  if (!MG_SERVERS.includes(server)) return { error: "unknown MapGuide server" };
  if (!COUNTY_RE.test(county || "")) return { error: "invalid county" };
  if (svc !== "FeatureServer" || String(layer) !== String(MG_LAYER_ID) || rest.length) return { error: "unknown layer" };
  if (op === undefined) return { server, county, op: "meta" };
  if (op === "query") return { server, county, op: "query" };
  return { error: "unsupported operation" };
}

/* ── coordinates ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const R = 6378137;
export const lonLatToMerc = (lng, lat) => [(R * lng * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const fail = (msg) => { const e = new Error(msg); e.mgBadRequest = true; return e; };

/* The query geometry as { xmin, ymin, xmax, ymax } in lon/lat, or { x, y } for a point. Accepts what the app and esri-leaflet send: an
 * esri JSON envelope or point (with a spatialReference), or a bare "x,y" / "xmin,ymin,xmax,ymax" string. A non-geographic inSR is
 * converted from Web Mercator (102100/102113/3857); anything else is refused loudly. */
export function parseQueryGeometry(raw, inSR) {
  if (raw == null || raw === "") return null;
  let g = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("{")) { try { g = JSON.parse(s); } catch (_) { throw fail("unreadable geometry"); } }
    else { const p = s.split(",").map(num); if (p.some((n) => n == null) || (p.length !== 2 && p.length !== 4)) throw fail("unreadable geometry"); g = p.length === 2 ? { x: p[0], y: p[1] } : { xmin: p[0], ymin: p[1], xmax: p[2], ymax: p[3] }; }
  }
  const wkid = Number((g.spatialReference && (g.spatialReference.latestWkid || g.spatialReference.wkid)) || inSR || 4326);
  const toLL = (x, y) => {
    if (wkid === 4326) return [x, y];
    if (wkid === 3857 || wkid === 102100 || wkid === 102113) return [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
    throw fail(`unsupported inSR ${wkid}`);
  };
  if (num(g.x) != null && num(g.y) != null) { const [x, y] = toLL(+g.x, +g.y); return { x, y }; }
  if ([g.xmin, g.ymin, g.xmax, g.ymax].every((v) => num(v) != null)) {
    const [x0, y0] = toLL(+g.xmin, +g.ymin), [x1, y1] = toLL(+g.xmax, +g.ymax);
    return { xmin: Math.min(x0, x1), ymin: Math.min(y0, y1), xmax: Math.max(x0, x1), ymax: Math.max(y0, y1) };
  }
  throw fail("unsupported geometry type (point or envelope only)");
}

/* A point is asked as an exact INTERSECTS (the server's `bbox` is envelope-only and returns neighbours); an envelope rides `bbox`
 * (fast, spatially indexed — an outline view tolerates a neighbour sliver). Both in Web Mercator, the layers' native system. */
export function spatialClause(geom) {
  if (!geom) return null;
  if (geom.x != null) {
    const [x, y] = lonLatToMerc(geom.x, geom.y);
    return { filter: `Geometry INTERSECTS GEOMFROMTEXT('POINT (${x.toFixed(3)} ${y.toFixed(3)})')` };
  }
  const [x0, y0] = lonLatToMerc(geom.xmin, geom.ymin), [x1, y1] = lonLatToMerc(geom.xmax, geom.ymax);
  return { bbox: [x0, y0, x1, y1].map((n) => n.toFixed(3)).join(",") };
}

/* ── where clause ────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const stripParens = (s) => { let t = s.trim(); while (t.startsWith("(") && t.endsWith(")") && balanced(t.slice(1, -1))) t = t.slice(1, -1).trim(); return t; };
const balanced = (s) => { let d = 0, q = false; for (const c of s) { if (c === "'") q = !q; else if (!q && c === "(") d++; else if (!q && c === ")" && --d < 0) return false; } return d === 0 && !q; };
/* Split on a top-level ` AND ` (outside quotes and parentheses). */
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
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

/* The ArcGIS `where` strings the app builds (buildParcelWhere): `UPPER(F) LIKE UPPER('%x%')`, `F = 123`, `F = 'x'`, `F LIKE '…'`, joined with
 * AND, and `1=1`. Returns an FDO filter string or null (no attribute filter). Anything else is a LOUD 400 — never a silently different query. */
export function translateWhere(where) {
  const w = String(where == null ? "1=1" : where).trim();
  if (!w || /^1\s*=\s*1$/.test(w)) return null;
  const out = [];
  for (const raw of splitAnd(stripParens(w))) {
    const c = stripParens(raw);
    if (/^1\s*=\s*1$/.test(c)) continue;
    let m = /^(?:UPPER\(\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s+LIKE\s+(?:UPPER\(\s*)?'((?:[^']|'')*)'\s*\)?$/i.exec(c);
    if (m && FIELD_RE.test(m[1])) { out.push(`${m[1]} LIKE ${lit(m[2].replace(/''/g, "'").toUpperCase())}`); continue; }
    m = /^(?:UPPER\(\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*=\s*(?:UPPER\(\s*)?'((?:[^']|'')*)'\s*\)?$/i.exec(c);
    if (m && FIELD_RE.test(m[1])) { out.push(`${m[1]} = ${lit(m[2].replace(/''/g, "'"))}`); continue; }
    m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(c);
    if (m && FIELD_RE.test(m[1])) { out.push(`${m[1]} = ${m[2]}`); continue; }
    throw fail(`unsupported where clause: ${c.slice(0, 80)}`);
  }
  return out.length ? out.join(" AND ") : null;
}

/* ── request ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const truthy = (v) => v === true || /^true$/i.test(String(v));
const outFieldList = (v) => (v == null || v === "" || v === "*" ? null : String(v).split(",").map((s) => s.trim()).filter(Boolean));

/* ArcGIS /query params (an object of strings) → { mode, params } where params are the MapGuide features.geojson query string entries.
 * mode: "features" | "ids" | "count". Throws a `mgBadRequest` error for anything the adapter cannot answer truthfully. */
export function arcQueryToMg(p) {
  const outSR = Number(p.outSR || 4326);
  if (outSR !== 4326) throw fail(`unsupported outSR ${outSR} (4326 only)`);
  if (p.objectIds) throw fail("objectIds is not supported");
  if (p.resultOffset && Number(p.resultOffset) > 0) throw fail("resultOffset is not supported");
  if (p.outStatistics || p.groupByFieldsForStatistics) throw fail("statistics are not supported");
  const mode = truthy(p.returnCountOnly) ? "count" : truthy(p.returnIdsOnly) ? "ids" : "features";
  const geom = parseQueryGeometry(p.geometry, p.inSR);
  if (geom && p.spatialRel && !/Intersects/i.test(p.spatialRel)) throw fail(`unsupported spatialRel ${p.spatialRel}`);
  const sp = spatialClause(geom);
  const attr = translateWhere(p.where);
  const filter = [attr, sp && sp.filter].filter(Boolean).join(" AND ") || null;
  const wantGeom = mode === "features" && !/^false$/i.test(String(p.returnGeometry == null ? "true" : p.returnGeometry));
  const fields = outFieldList(p.outFields);
  const want = Math.min(Math.max(Number(p.resultRecordCount) || MG_MAX_RECORDS, 1), MG_MAX_RECORDS);
  const params = { maxfeatures: String(want + 1), transformto: "LL84" }; // +1 → exceededTransferLimit is knowable
  if (filter) params.filter = filter;
  if (sp && sp.bbox) params.bbox = sp.bbox;
  /* Slim request: an id-only/outline query asks for the id column (+ geometry); an attribute request asks for everything. */
  const slim = mode !== "features" || (fields && fields.every((f) => /^(objectid|parcel_id|fid)$/i.test(f)));
  if (slim) params.properties = wantGeom ? "PARCEL_ID,GISKEY,Geometry" : "PARCEL_ID,GISKEY";
  return { mode, params, want, wantGeom, fields };
}

/* ── response ────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/** cyrb53 — a stable 53-bit string hash (fits a JS safe integer, so it is a legal ArcGIS OBJECTID). */
export function stableOid(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const signedArea = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]); return a / 2; };
/* ESRI convention: an outer ring runs clockwise (negative signed area), a hole counter-clockwise. esri-leaflet's arcgis→GeoJSON reader
 * decides outer-vs-hole from that winding, so it has to be right. */
const orient = (ring, clockwise) => ((signedArea(ring) < 0) === clockwise ? ring : ring.slice().reverse());

export function geojsonToRings(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : null;
  if (!polys) return null;
  const rings = [];
  for (const poly of polys) poly.forEach((ring, i) => { if (ring && ring.length >= 4) rings.push(orient(ring, i === 0)); });
  return rings.length ? rings : null;
}

/** Acres from lon/lat rings (local equirectangular — well under 0.1% off at lot scale). Outer rings add, holes subtract. */
export function ringsAcres(rings) {
  if (!rings || !rings.length) return null;
  const lat0 = rings[0].reduce((s, p) => s + p[1], 0) / rings[0].length;
  const kx = 111319.49 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  /* ESRI winding (see `orient`): an outer ring is clockwise → negative signed area → adds; a hole is counter-clockwise → positive → subtracts. */
  let m2 = 0;
  for (const r of rings) m2 -= signedArea(r.map((p) => [p[0] * kx, p[1] * ky]));
  const acres = Math.abs(m2) / ACRE_M2;
  return Math.round(acres * 1000) / 1000;
}

const clean = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v);
const round = (n) => Math.round(n * 1e7) / 1e7;

/** One GeoJSON feature → { attributes, geometry? }. Strings are trimmed (the county pads its columns); MG_TOOLTIP is the viewer's hover text. */
export function featureToArc(f, { wantGeom, fields }) {
  const props = f.properties || {};
  const key = String(props.PARCEL_ID != null && String(props.PARCEL_ID).trim() !== "" ? props.PARCEL_ID : props.GISKEY != null ? props.GISKEY : "").trim();
  const rings = wantGeom || !fields || fields.some((x) => /acre/i.test(x)) ? geojsonToRings(f.geometry) : null;
  const attributes = { OBJECTID: stableOid(key || JSON.stringify(props)) };
  const only = fields && !fields.includes("*") ? new Set(fields.map((x) => x.toLowerCase())) : null;
  for (const [k, v] of Object.entries(props)) {
    if (k === "MG_TOOLTIP") continue;
    if (only && !only.has(k.toLowerCase())) continue;
    attributes[k] = clean(v);
  }
  if (!fields) { const ac = ringsAcres(rings || geojsonToRings(f.geometry)); if (ac != null) attributes.GIS_ACRES = ac; }
  const out = { attributes };
  if (wantGeom) { if (!rings) return null; out.geometry = { rings: rings.map((r) => r.map((p) => [round(p[0]), round(p[1])])) }; }
  return out;
}

/* The layer also carries each lot's LABEL POINT as a second feature with the same parcel id (a Point beside its Polygon), so every mode
 * dedupes on the stable OBJECTID — a count or an attribute-only query must not see a lot twice — and a geometry request drops the
 * points (featureToArc returns null for a feature with no ring). */
function uniqueArc(take, q, opts) {
  const seen = new Set(), out = [];
  for (const f of take) {
    const a = featureToArc(f, opts);
    if (!a || seen.has(a.attributes.OBJECTID)) continue;
    seen.add(a.attributes.OBJECTID); out.push(a);
  }
  return out;
}

/** The whole answer for one /query. `gj` is the parsed features.geojson body. */
export function mgToArcQuery(gj, q) {
  const feats = Array.isArray(gj && gj.features) ? gj.features : [];
  const exceeded = feats.length > q.want;
  const take = feats.slice(0, q.want);
  if (q.mode === "count") return { count: uniqueArc(take, q, { wantGeom: false, fields: ["OBJECTID"] }).length };
  if (q.mode === "ids") return { objectIdFieldName: "OBJECTID", objectIds: uniqueArc(take, q, { wantGeom: false, fields: ["OBJECTID"] }).map((x) => x.attributes.OBJECTID) };
  const features = uniqueArc(take, q, q);
  const body = {
    objectIdFieldName: "OBJECTID", globalIdFieldName: "", geometryType: "esriGeometryPolygon",
    spatialReference: { wkid: 4326, latestWkid: 4326 }, hasZ: false, hasM: false, features,
  };
  if (exceeded) body.exceededTransferLimit = true;
  return body;
}

/* The columns every one of the 26 counties publishes (measured through the relay on each county's own layer, 2026-10-16). Layer metadata is
 * STATIC on purpose: sampling "the first feature" from the server for it took 19 s on Walker (an unfiltered scan with a coordinate
 * transform), and the outline layer waits on this answer before it asks for a single lot. `/query` with outFields=* still returns every
 * column a county actually has; this list is only what the app's field detection (id / address / owner) needs to see. */
export const MG_CORE_FIELDS = ["MAILING1", "MAILING2", "MAILING3", "NAME", "NAME2", "PARCEL_ID", "P_ADDRESS", "GISKEY", "TOTALLAND", "TOTALVALUE"];

/** Layer metadata (`?f=json` on the layer URL). */
export function layerMetadata(county) {
  const fields = [{ name: "OBJECTID", alias: "OBJECTID", type: "esriFieldTypeOID" }];
  for (const n of MG_CORE_FIELDS) fields.push({ name: n, alias: n, type: "esriFieldTypeString", length: 255 });
  fields.push({ name: "GIS_ACRES", alias: "GIS_ACRES", type: "esriFieldTypeDouble" });
  return {
    currentVersion: 10.81, id: MG_LAYER_ID, name: `${county} Parcels`, type: "Feature Layer", geometryType: "esriGeometryPolygon",
    objectIdField: "OBJECTID", displayField: "PARCEL_ID", capabilities: "Query", supportedQueryFormats: "JSON",
    maxRecordCount: MG_MAX_RECORDS, supportsAdvancedQueries: false, hasAttachments: false,
    advancedQueryCapabilities: { supportsPagination: false, supportsStatistics: false, supportsOrderBy: false },
    fields,
  };
}

export const arcError = (code, message) => ({ error: { code, message, details: [] } });
