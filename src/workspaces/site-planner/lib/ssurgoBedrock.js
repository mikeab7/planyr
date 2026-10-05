/* B2081251 — SHALLOW-ROCK ZONES from USDA NRCS SSURGO (depth to bedrock), national.
 *
 * Two public, no-key services, both answered a real browser on planyr.io with CORS open (probed 2026-10-05; neither
 * is reachable from the build sandbox, so every parser here is written against the documented formats and the
 * fixture in test/ssurgoBedrock.test.js — the live check is the browser-side harness ui-audit/verify-ssurgo-bedrock.mjs):
 *   1. the SDM WFS (`SDMWGS84Geographic.wfs`, feature type `mapunitpoly`) — the map-unit POLYGONS in the view, each
 *      carrying its `mukey`;
 *   2. Soil Data Access tabular POST (`Tabular/post.rest`) — `muaggatt.brockdepmin`, the SHALLOWEST depth to a
 *      bedrock restriction (cm) in each map unit.
 * The join is mukey. Pure: no Leaflet, no network (the fetcher takes its transport), so it unit-tests in node.
 *
 * WHAT IT MAY NOT CLAIM (LOUD-FAILURE): a map unit with no `brockdepmin` is a unit with no rock recorded in the soil
 * profile (the profile is only described to roughly 6 ft) — that is NOT "no rock", and it is simply not painted. The
 * layer's note says so. A failed fetch never paints "clear": it reports failure. Depth is the SHALLOWEST component of
 * the map unit, so a painted unit means "rock can be this shallow somewhere in it", not "everywhere in it". Screening
 * only — a geotechnical boring governs. */

export const SDA_WFS_URL = "https://sdmdataaccess.sc.egov.usda.gov/Spatial/SDMWGS84Geographic.wfs";
export const SDA_TABULAR_URL = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";
export const WFS_MAX_FEATURES = 1500;
const KEYS_PER_QUERY = 200;
const CM_PER_IN = 2.54;

/* Shallow-rock classes, by depth to the bedrock restriction (inches). Anything ≥ 60 in is not painted. */
export const BEDROCK_CLASSES = [
  { id: "very", maxIn: 20, color: "#7f1d1d", label: "Under 20 in" }, // design-exempt: map ink for a drawn depth class (cartography, not UI chrome)
  { id: "shallow", maxIn: 40, color: "#ea580c", label: "20–40 in" }, // design-exempt: map ink for a drawn depth class (cartography, not UI chrome)
  { id: "moderate", maxIn: 60, color: "#facc15", label: "40–60 in" }, // design-exempt: map ink for a drawn depth class (cartography, not UI chrome)
];
export const BEDROCK_PAINT_MAX_IN = 60;

/* cm → class, or null when there is no depth, it is not a number, or it is ≥ 60 in. Pure. */
export function classifyDepthCm(cm) {
  if (cm == null || cm === "") return null;
  const n = Number(cm);
  if (!Number.isFinite(n) || n < 0) return null;
  const inches = n / CM_PER_IN;
  for (const c of BEDROCK_CLASSES) if (inches < c.maxIn) return c;
  return null;
}

export const depthInchesFromCm = (cm) => Math.round(Number(cm) / CM_PER_IN);

/* The WFS GetFeature URL for the map units in a view. `bb` = { s, w, n, e }. Pure. */
export function buildWfsUrl(bb, { max = WFS_MAX_FEATURES } = {}) {
  const filter = `<Filter><BBOX><PropertyName>Geometry</PropertyName><Box srsName='EPSG:4326'><coordinates>${bb.w},${bb.s} ${bb.e},${bb.n}</coordinates></Box></BBOX></Filter>`;
  return `${SDA_WFS_URL}?SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME=mapunitpoly&FILTER=${encodeURIComponent(filter)}&MAXFEATURES=${max}`;
}

const NS = "(?:[\\w-]+:)?";
const num = (s) => Number(String(s).trim());

/* "x,y x,y …" (GML 2 <coordinates>) or "a b a b …" (GML 3 <posList>) → [[a,b]…]. */
function parseCoordText(txt, isPosList) {
  if (isPosList) {
    const v = String(txt).trim().split(/\s+/).map(num);
    const out = [];
    for (let i = 0; i + 1 < v.length; i += 2) out.push([v[i], v[i + 1]]);
    return out;
  }
  return String(txt).trim().split(/\s+/).map((p) => p.split(",").map(num)).filter((p) => p.length >= 2).map((p) => [p[0], p[1]]);
}

const ringsOfPolygon = (polyXml) => {
  const rings = [];
  const re = new RegExp(`<${NS}(coordinates|posList)\\b[^>]*>([^<]+)</${NS}(?:coordinates|posList)>`, "g");
  let m;
  while ((m = re.exec(polyXml))) rings.push(parseCoordText(m[2], m[1] === "posList"));
  return rings.filter((r) => r.length >= 4 && r.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
};

/* Parse a mapunitpoly GetFeature response into { features: [{ mukey, polygons: [[ring, ring…], …] }] } with
 * rings as [lng, lat]. Throws (LOUD) on a WFS exception report or a coordinate order that cannot be reconciled
 * with the requested view — an axis-swapped answer drawn anyway would put soil on the wrong ground. Pure. */
export function parseMapunitGml(text, bb) {
  const s = String(text || "");
  if (/ExceptionReport|ServiceException/i.test(s)) {
    const msg = (s.match(new RegExp(`<${NS}ExceptionText[^>]*>([^<]*)<`, "i")) || s.match(/<ServiceException[^>]*>([^<]*)</i) || [])[1];
    throw new Error(`SDA WFS: ${msg ? msg.trim() : "exception report"}`);
  }
  const members = s.split(new RegExp(`<${NS}(?:featureMember|featureMembers)\\b`)).slice(1);
  const features = [];
  for (const mem of members) {
    const mk = mem.match(new RegExp(`<${NS}mukey\\b[^>]*>\\s*([^<\\s]+)\\s*<`, "i"));
    if (!mk) continue;
    const polygons = [];
    const pre = new RegExp(`<${NS}Polygon\\b[\\s\\S]*?</${NS}Polygon>`, "g");
    let pm;
    while ((pm = pre.exec(mem))) { const r = ringsOfPolygon(pm[0]); if (r.length) polygons.push(r); }
    if (polygons.length) features.push({ mukey: mk[1], polygons });
  }
  if (!features.length) return { features };
  // Axis check: the first vertex must sit near the requested view as [lng,lat]; if only the SWAPPED reading does,
  // the service answered lat-first (GML 3) — flip every ring. Neither → refuse.
  const cx = (bb.w + bb.e) / 2, cy = (bb.s + bb.n) / 2, slack = Math.max(1, (bb.e - bb.w) * 3, (bb.n - bb.s) * 3);
  const p0 = features[0].polygons[0][0][0];
  const near = (x, y) => Math.abs(x - cx) <= slack && Math.abs(y - cy) <= slack;
  if (!near(p0[0], p0[1])) {
    if (!near(p0[1], p0[0])) throw new Error("SDA WFS: polygon coordinates fall outside the requested view in either axis order");
    for (const f of features) f.polygons = f.polygons.map((rings) => rings.map((r) => r.map(([a, b]) => [b, a])));
  }
  return { features };
}

/* The SDA tabular query for a batch of map-unit keys: name + the shallowest bedrock depth (cm). Pure. */
export function buildBedrockQuery(mukeys) {
  const list = mukeys.map((k) => `'${String(k).replace(/[^0-9A-Za-z]/g, "")}'`).join(",");
  return `SELECT mu.mukey, mu.muname, ma.brockdepmin FROM mapunit mu INNER JOIN muaggatt ma ON ma.mukey = mu.mukey WHERE mu.mukey IN (${list})`;
}

/* SDA JSON+COLUMNNAME → Map(mukey → { muname, depthCm }). A row with no depth maps to depthCm null. Pure. */
export function parseBedrockRows(json) {
  const table = json && (json.Table || json.table);
  const out = new Map();
  if (!Array.isArray(table) || table.length < 2) return out;
  const cols = table[0].map((c) => String(c).toLowerCase());
  const iK = cols.indexOf("mukey"), iN = cols.indexOf("muname"), iD = cols.indexOf("brockdepmin");
  if (iK < 0 || iD < 0) throw new Error("SDA tabular: response is missing the mukey / brockdepmin columns");
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    const d = row[iD] == null || row[iD] === "" ? null : Number(row[iD]);
    out.set(String(row[iK]), { muname: iN >= 0 ? row[iN] : null, depthCm: Number.isFinite(d) ? d : null });
  }
  return out;
}

/* Join polygons to depth and keep only the painted classes. Returns [{ mukey, muname, depthCm, cls, polygons }]. Pure. */
export function joinBedrock(features, depths) {
  const out = [];
  for (const f of features) {
    const d = depths.get(String(f.mukey));
    if (!d) continue;
    const cls = classifyDepthCm(d.depthCm);
    if (cls) out.push({ mukey: f.mukey, muname: d.muname, depthCm: d.depthCm, cls, polygons: f.polygons });
  }
  return out;
}

/* Fetch the shallow-rock polygons for a view. `transport` = { text(url, init) , json(url, init) } defaults to fetch.
 * Throws on ANY failure (never resolves an empty list for an error). Returns { polys, total, capped }. */
export async function fetchBedrockView(bb, { fetchImpl = (typeof fetch === "function" ? fetch : null), signal } = {}) {
  if (!fetchImpl) throw new Error("no fetch available");
  const wr = await fetchImpl(buildWfsUrl(bb), signal ? { signal } : undefined);
  if (!wr.ok) throw new Error(`SDA WFS HTTP ${wr.status}`);
  const { features } = parseMapunitGml(await wr.text(), bb);
  const capped = features.length >= WFS_MAX_FEATURES;
  if (!features.length) return { polys: [], total: 0, capped: false };
  const keys = [...new Set(features.map((f) => String(f.mukey)))];
  const depths = new Map();
  for (let i = 0; i < keys.length; i += KEYS_PER_QUERY) {
    const body = JSON.stringify({ format: "JSON+COLUMNNAME", query: buildBedrockQuery(keys.slice(i, i + KEYS_PER_QUERY)) });
    const tr = await fetchImpl(SDA_TABULAR_URL, { method: "POST", headers: { "content-type": "application/json" }, body, ...(signal ? { signal } : {}) });
    if (!tr.ok) throw new Error(`SDA tabular HTTP ${tr.status}`);
    for (const [k, v] of parseBedrockRows(await tr.json())) depths.set(k, v);
  }
  return { polys: joinBedrock(features, depths), total: features.length, capped };
}
