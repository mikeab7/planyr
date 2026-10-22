/* NEW-1 (Tennessee, all 95 counties; B2417xxx provisional) — the engine behind ui-audit/sweep-tn-counties.mjs.
 *
 * It asks, for EVERY Tennessee county the app ships a polygon for, the three questions the owner's coworkers will ask — using the app's OWN
 * modules at HEAD, never a hand-picked URL:
 *   A  click      — `candidateCountiesForPoint` → `identifyWithLineFallback` → `queryAtPoint` (the exact Select-parcels click), then the card's own
 *                   readers (`idAttrFor`, `countyRecord`) for parcel id / owner / acreage.
 *   B  outlines   — `displaySourcesForView` (which layers the Select-parcels outline layer draws for a view) at the zoom the map uses
 *                   (`max(PARCEL_VECTOR_MINZOOM, displayMinZoomOf(key))`), then the same envelope query esri-leaflet issues for each 512-px cell of a
 *                   desktop-sized view, with the same wire form (hosted FeatureServers answer f=geojson; everything else f=json) and the same feature
 *                   keying (`ensureFeatureIds` when the build has it, else the raw `feature.id` — which is how the B2416496 collapse shows up here).
 *   C  id search  — the Site search box's own id path (`resolveParcelId` / `tnParcelIdPlan`) fed the id A returned.
 *
 * ⛔ A NULL IS NOT A VERDICT (STANDING RULE #2, FOREGROUND-OR-VOID §6): every row carries `knownGood` context — the run is declared VOID by the CLI
 * unless the control counties (Davidson, Rutherford — recorded passes) report A/B/C green. The Comptroller layer answers in 4–25 s, so a timeout is
 * retried and re-measured with a long timeout BEFORE it is called a failure; the row says which ("slow: answers in 21 s, the app gives up at 8 s")
 * and a slow answer is never recorded as "no data".
 *
 * Network only; the points it picks are scaffolding (a real lot inside the county polygon, not near its edge) — the verdicts come from the app code. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const RELAY_BASE = "https://planyr.io";

/** Root-relative layer urls ("/gis-proxy/…") are the deployed relay's; in Node there is no origin, so resolve them against the live site. */
export function installRelayFetch(base = RELAY_BASE) {
  if (globalThis.__tnSweepRelay) return;
  const real = globalThis.fetch;
  globalThis.fetch = (u, o) => real(typeof u === "string" && u.startsWith("/") ? base + u : u, o);
  globalThis.__tnSweepRelay = true;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lazy-load the app modules (after the relay shim, so their module-level fetches resolve) and the bundled county polygons. */
export async function loadApp() {
  installRelayFetch();
  const lib = (p) => import(`../../src/workspaces/site-planner/lib/${p}`);
  const [polys, counties, arcgis, identify, appraisal, query, idSearch, tnId, zoom, wire, esriRings, area] = await Promise.all([
    lib("countyPolygons.js"), lib("counties.js"), lib("arcgis.js"), lib("identifyWithFallback.js"), lib("appraisal.js"),
    lib("parcelQuery.js"), lib("parcelIdSearch.js"), lib("tnParcelId.js"), lib("parcelDisplayZoom.js"), lib("parcelQueryWire.js"),
    lib("esriRings.js"), lib("parcelArea.js"),
  ]);
  await polys.setCountyPolygons(JSON.parse(readFileSync(resolve(ROOT, "public/geo/county-polygons.json"), "utf8")));
  /* resolveGisUrl() reads window.location.origin when a layer url is root-relative ("/gis-proxy/…"); set AFTER the imports so nothing branches on it at load. */
  if (typeof window === "undefined") globalThis.window = { location: { origin: RELAY_BASE } };
  return { polys, counties, arcgis, identify, appraisal, query, idSearch, tnId, zoom, wire, esriRings, area };
}

/** The 95 Tennessee counties of the bundled polygon asset: { name, fips, bbox:[minLat,minLng,maxLat,maxLng] } (the roster's own bbox is [minLng,minLat,maxLng,maxLat]). */
export function tennesseeCounties(app) {
  return app.polys.countyRoster().filter((c) => c.state === "TN")
    .map((c) => ({ ...c, bbox: [c.bbox[1], c.bbox[0], c.bbox[3], c.bbox[2]] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const bare = (n) => String(n || "").replace(/\s+(County|Parish)$/i, "").trim();

/** What the routing SHOULD be for a county, derived from the config rather than typed: its own wired row, else the statewide composite unless it excludes the county. */
export function expectedSource(app, county) {
  const { COUNTIES_MAP, countyKeyForName, statewideExcludesCounty, statewideKeysForState } = app.counties;
  const key = countyKeyForName(county.name, "TN");
  if (key && COUNTIES_MAP[key] && !COUNTIES_MAP[key].statewide) return { key, kind: "own" };
  const sw = statewideKeysForState("TN").filter((k) => !statewideExcludesCounty(k, county.name));
  return sw.length ? { key: sw[0], kind: "statewide" } : { key: null, kind: "none" };
}

/* ---------- plain ArcGIS reads (scaffolding: picking the test lot; not the verdicts) ---------- */
async function getJson(url, params, { timeoutMs = 60000 } = {}) {
  const u = new URL(url, RELAY_BASE);
  for (const [k, v] of Object.entries({ f: "json", ...params })) if (v != null) u.searchParams.set(k, String(v));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(u.toString(), { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j && j.error) throw new Error(`ArcGIS ${j.error.code}: ${j.error.message}`);
    return j;
  } finally { clearTimeout(t); }
}
async function withRetry(fn, tries = 3, gap = 4000) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(gap * (i + 1)); }
  }
  throw last;
}

const ENV = (lng, lat, half) => JSON.stringify({ xmin: lng - half, ymin: lat - half, xmax: lng + half, ymax: lat + half, spatialReference: { wkid: 4326 } });

/** Every point on a 17×17 grid of the county's bbox that the bundled polygons place INSIDE this county and not near its edge, nearest the bbox centre first. */
export function interiorCandidates(app, county) {
  const [s, w, n, e] = county.bbox;
  const N = 16, pts = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const lat = s + ((n - s) * i) / N, lng = w + ((e - w) * j) / N;
    const r = app.polys.resolveCounty(lat, lng);
    if (r.status === "ok" && r.state === "TN" && r.fips === county.fips && !r.nearEdge) pts.push({ lat, lng });
  }
  const cy = (s + n) / 2, cx = (w + e) / 2;
  return pts.sort((a, b) => Math.hypot(a.lat - cy, a.lng - cx) - Math.hypot(b.lat - cy, b.lng - cx));
}

/** One real lot inside the county: query the county's routed layer around interior grid points, take the lot whose own interior point the polygons also
 *  place inside the county (not near the edge), preferring owner-bearing lots of a plausible size near the middle. Null when the layer yields none. */
export async function pickLot(app, county, route) {
  const cfg = app.counties.COUNTIES_MAP[route.key];
  if (!cfg || !cfg.layerUrl) return null;
  const url = String(cfg.layerUrl).replace(/\/+$/, "");
  const cands = interiorCandidates(app, county);
  const tried = new Set();
  for (const p of cands.slice(0, 40)) {
    const k = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
    if (tried.has(k)) continue;
    tried.add(k);
    for (const half of [0.004, 0.012]) {
      let j;
      try {
        j = await withRetry(() => getJson(url + "/query", {
          geometry: ENV(p.lng, p.lat, half), geometryType: "esriGeometryEnvelope", inSR: 4326, spatialRel: "esriSpatialRelIntersects",
          outFields: "*", returnGeometry: "true", outSR: 4326, resultRecordCount: 200,
          ...(route.kind === "statewide" ? { where: `COUNTY_NAME='${bare(county.name)}'` } : {}),
        }));
      } catch (_e) { continue; }
      const lots = [];
      for (const f of j.features || []) {
        const ip = app.idSearch.interiorPointOf(f);
        if (!ip) continue;
        const r = app.polys.resolveCounty(ip.lat, ip.lng);
        if (!(r.status === "ok" && r.fips === county.fips && !r.nearEdge)) continue;
        const rec = app.appraisal.countyRecord(f.attributes || {}, { idField: cfg.idField, addrField: cfg.addrField });
        const pr = app.arcgis.lngLatFeatureToParcel(f);
        const acres = pr ? app.area.parcelGrossSqft({ points: pr.points }) / app.area.SQFT_PER_ACRE : 0;
        if (acres < 0.2 || acres > 60) continue;
        const score = (rec.owner ? 0 : 5) + (rec.account ? 0 : 5) + Math.hypot(ip.lat - p.lat, ip.lng - p.lng) * 100;
        lots.push({ ip, score, acres });
      }
      if (lots.length) { lots.sort((a, b) => a.score - b.score); return { lat: lots[0].ip.lat, lng: lots[0].ip.lng, via: url }; }
    }
  }
  return null;
}

/** Named places the app ships (the two place-name assets) that the bundled polygons put INSIDE this county, not near its edge. */
export function townsIn(app, county) {
  const out = [];
  for (const f of ["place-names-towns.json", "place-names.json"]) {
    const d = JSON.parse(readFileSync(resolve(ROOT, "public/geo", f), "utf8"));
    const sc = d.scale || 1000;
    for (const [name, la, lo] of d.places) {
      const lat = la / sc, lng = lo / sc;
      if (lat < county.bbox[0] || lat > county.bbox[2] || lng < county.bbox[1] || lng > county.bbox[3]) continue;
      const r = app.polys.resolveCounty(lat, lng);
      if (r.status === "ok" && r.state === "TN" && r.fips === county.fips && !r.nearEdge) out.push({ name, lat, lng });
    }
  }
  return out;
}

/** The DENSEST place in the county — the lot count in one 512-px cell at zoom 16 around each named place, largest wins — and a real lot nearest its middle.
 *  A rural lot cannot show a record-cap or a slow-answer problem; a town centre can. Null when the county has no named place or the source answers no lot there. */
export async function pickDenseLot(app, county, route) {
  const cfg = app.counties.COUNTIES_MAP[route.key];
  if (!cfg || !cfg.layerUrl) return null;
  const url = String(cfg.layerUrl).replace(/\/+$/, "");
  const towns = townsIn(app, county);
  const half = 0.0055;
  const scope = route.kind === "statewide" ? { where: `COUNTY_NAME='${bare(county.name)}'` } : {};
  const counted = [];
  for (const t of towns.slice(0, 14)) {
    try {
      const j = await withRetry(() => getJson(url + "/query", { geometry: ENV(t.lng, t.lat, half), geometryType: "esriGeometryEnvelope", inSR: 4326, spatialRel: "esriSpatialRelIntersects", returnCountOnly: "true", ...scope }));
      counted.push({ ...t, n: j.count || 0 });
    } catch (_e) { /* a town that cannot be counted is skipped */ }
  }
  counted.sort((a, b) => b.n - a.n);
  for (const t of counted.slice(0, 3)) {
    if (!t.n) break;
    let j;
    try {
      j = await withRetry(() => getJson(url + "/query", { geometry: ENV(t.lng, t.lat, 0.0025), geometryType: "esriGeometryEnvelope", inSR: 4326, spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "true", outSR: 4326, resultRecordCount: 100, ...scope }));
    } catch (_e) { continue; }
    const lots = [];
    for (const f of j.features || []) {
      const ip = app.idSearch.interiorPointOf(f);
      if (!ip) continue;
      const r = app.polys.resolveCounty(ip.lat, ip.lng);
      if (!(r.status === "ok" && r.fips === county.fips && !r.nearEdge)) continue;
      const rec = app.appraisal.countyRecord(f.attributes || {}, { idField: cfg.idField, addrField: cfg.addrField });
      lots.push({ ip, score: (rec.owner ? 0 : 5) + (rec.account ? 0 : 5) + Math.hypot(ip.lat - t.lat, ip.lng - t.lng) * 1000 });
    }
    if (lots.length) { lots.sort((a, b) => a.score - b.score); return { lat: lots[0].ip.lat, lng: lots[0].ip.lng, town: t.name, lotsInCell: t.n }; }
  }
  return null;
}

/** The columns a parcel-id search reads on any Tennessee source (its id, its link, the Comptroller's separate map / group / parcel, Shelby's PAID, the county id). */
const MATCH_KEYS = new Set(["CMAP", "GP", "PARCEL", "GISLINK", "COUNTY_ID", "COUNTY_NAME", "gislink_1", "L15Parce_2", "PAID", "PARCELID", "TAX_MAP_NO", "STANPAR", "ParcelID", "PARCEL_ID", "parcelno"]);

/* ---------- Check A — the click ---------- */
/** The click, exactly as MapFinder.handleClick routes it. `timeoutMs` is the APP's (8 s); a timeout is re-measured with a long one to tell slow from dead. */
export async function checkA(app, county, route, pt) {
  const { counties, identify, arcgis, appraisal, query, area } = app;
  await app.polys.loadCountyPolygons?.();
  const cands = counties.candidateCountiesForPoint(pt.lat, pt.lng)
    .map((k) => ({ county: k, url: counties.COUNTIES_MAP[k] && counties.COUNTIES_MAP[k].layerUrl, statewide: counties.STATEWIDE_KEYS.includes(k) }))
    .filter((c) => c.url);
  const ident = counties.countyIdentity(pt.lat, pt.lng);
  const out = { routed: cands.map((c) => c.county), identity: ident.status === "ok" || ident.status === "no-source" ? ident.name : ident.status, expected: route.key };
  if (route.kind === "none") {
    // The honest gap: no candidate, and the exact sentence the click shows.
    out.note = counties.noParcelSourceNote(ident);
    out.pass = !cands.length && /no parcel data wired here yet/i.test(out.note || "");
    out.reason = out.pass ? "named gap — honest message" : `expected the named-gap message, got ${JSON.stringify(out.note)} with ${cands.length} candidate(s)`;
    out.gap = true;
    return out;
  }
  if (!cands.some((c) => c.county === route.key)) {
    out.pass = false; out.reason = `routing did not include ${route.key} (got ${out.routed.join(",") || "nothing"})`;
    return out;
  }
  const t0 = Date.now();
  let attempts = 0, res = null, slowMs = null;
  for (; attempts < 3; attempts++) {
    res = await identify.identifyWithLineFallback({
      primary: cands, lng: pt.lng, lat: pt.lat,
      neighbours: () => counties.lineNeighbourKeysForPoint(pt.lat, pt.lng).map((k) => ({ county: k, url: counties.COUNTIES_MAP[k].layerUrl, statewide: counties.STATEWIDE_KEYS.includes(k) })).filter((c) => c.url),
    });
    if (res.hits.length) break;
    if (res.responded === 0) await sleep(3000 * (attempts + 1)); else break; // answered-empty is a verdict; silence is retried
  }
  out.attempts = attempts + 1;
  out.ms = Date.now() - t0;
  if (!res.hits.length) {
    if (res.responded === 0) {
      /* the app gave up — is the source slow, or dead? Re-ask with a long timeout. */
      try {
        const t1 = Date.now();
        const j = await getJson(String(counties.COUNTIES_MAP[route.key].layerUrl).replace(/\/+$/, "") + "/query", {
          geometry: JSON.stringify({ x: pt.lng, y: pt.lat, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint", inSR: 4326,
          spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "false", resultRecordCount: 1,
          ...(route.kind === "statewide" ? { where: `COUNTY_NAME='${bare(county.name)}'` } : {}),
        }, { timeoutMs: 60000 });
        slowMs = Date.now() - t1;
        const errs = [...new Set((res.sources || []).map((x) => x.error && (x.error.kind || x.error.message)).filter(Boolean))].join("/") || "no error";
        out.reason = slowMs * 1 >= arcgis.PARCEL_FETCH_TIMEOUT_MS
          ? `slow: the app's ${Math.round(arcgis.PARCEL_FETCH_TIMEOUT_MS / 1000)} s limit was hit ${attempts + 1}× (${errs}); a 60 s ask answered in ${(slowMs / 1000).toFixed(1)} s with ${(j.features || []).length} feature(s)`
          : `the app's request failed ${attempts + 1}× (${errs}) although a plain request answered in ${(slowMs / 1000).toFixed(1)} s with ${(j.features || []).length} feature(s)`;
      } catch (e) { out.reason = `server silent: ${e.message}`; }
      out.slow = slowMs;
    } else out.reason = `server answered, no lot at the point (${res.responded} source(s) responded)`;
    out.pass = false;
    return out;
  }
  const hit = res.hits[0];
  const attrs = hit.feature.attributes || {};
  const cfg = counties.COUNTIES[hit.county] || counties.COUNTIES_MAP[hit.county] || {};
  const id = query.idAttrFor(hit.county, attrs);
  const rec = appraisal.countyRecord(attrs, { idField: cfg.idField, addrField: cfg.addrField });
  const pr = arcgis.lngLatFeatureToParcel(hit.feature);
  const measured = pr ? area.parcelGrossSqft({ points: pr.points }) / area.SQFT_PER_ACRE : null;
  Object.assign(out, {
    hitSource: hit.county, id, owner: rec.owner, address: rec.address, deedAcres: rec.deedAcres, measuredAcres: measured != null ? +measured.toFixed(2) : null,
    via: res.via, countyAttr: attrs.COUNTY_NAME || attrs.COUNTY || null, attrKeys: Object.keys(attrs),
  });
  const blanks = [];
  if (!id) blanks.push("id");
  if (!rec.owner) blanks.push("owner");
  if (!(rec.deedAcres || measured)) blanks.push("acres");
  out.blank = blanks;
  out.pass = hit.county === route.key && !!id;
  out.reason = out.pass ? (blanks.length ? `lot found; blank: ${blanks.join(", ")}` : "lot found, all fields filled")
    : hit.county !== route.key ? `answered by ${hit.county}, expected ${route.key}` : "lot found but no parcel id";
  out.feature = hit.feature;
  /* the attribute subset an offline test needs to replay the id round trip (test/tnIdRoundTrip.test.js) */
  out.matchAttrs = Object.fromEntries(Object.entries(attrs).filter(([k]) => MATCH_KEYS.has(k)));
  return out;
}

/* ---------- Check B — the outlines ---------- */
const TILE = 512;
const OUTLINE_HANG_MS = 8000; // parcelOutlineSet.OUTLINE_LOAD_TIMEOUT_MS — a cell slower than this is the 'slow server' banner
/** Degrees spanned by `px` CSS px at web-mercator zoom z, at latitude lat: [dLng, dLat]. */
function pxDeg(z, lat, px) {
  const dLng = (360 * px) / (256 * 2 ** z);
  return [dLng, dLng * Math.cos((lat * Math.PI) / 180)];
}

const _meta = new Map();
/** The outFields the outline layer asks for: its id field (swapped for the layer's real one by `outlineFieldsFor`) plus the lot-number column it draws. */
async function outlineFields(app, url) {
  if (!_meta.has(url)) _meta.set(url, withRetry(() => getJson(url, {}, { timeoutMs: 60000 }), 3, 3000).catch(() => null));
  const meta = await _meta.get(url);
  const lot = app.counties.lotNumberFieldForUrl(url);
  return app.zoom.outlineFieldsFor(meta, ["OBJECTID", ...(lot ? [lot] : [])]);
}

/** What esri-leaflet's featureLayer asks for one cell: envelope in 4326, the id field, geometry. Mirrors the wire form of parcelDisplay.makeParcelLayer
 *  (precision 6, simplifyFactor 0.5 → maxAllowableOffset left to the server) closely enough for a feature COUNT; the live run drives the real layer. */
async function queryCell(app, cfg, route, county, bounds) {
  const url = String(cfg.layerUrl).replace(/\/+$/, "");
  const hosted = app.wire.isArcgisOnline(url);
  const params = {
    where: route.kind === "statewide" ? `COUNTY_NAME='${bare(county.name)}'` : "1=1",
    geometry: JSON.stringify({ xmin: bounds.west, ymin: bounds.south, xmax: bounds.east, ymax: bounds.north, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryEnvelope", inSR: 4326, spatialRel: "esriSpatialRelIntersects", outFields: (await outlineFields(app, url)).join(","), returnGeometry: "true", outSR: 4326, geometryPrecision: 6,
    f: hosted ? "geojson" : "json",
  };
  const j = await withRetry(() => getJson(url + "/query", params, { timeoutMs: 60000 }), 3, 3000);
  return { hosted, json: j };
}

/** Feature identity as the outline layer keys it: server `feature.id`, else (build has it) `ensureFeatureIds`, else nothing. */
function keyLots(app, queried) {
  const { hosted, json } = queried;
  let feats;
  if (hosted) {
    feats = (json.features || []).map((f) => ({ id: f.id, props: f.properties || {}, geometry: f.geometry }));
    if (typeof app.wire.ensureFeatureIds === "function") {
      try {
        const gj = app.wire.ensureFeatureIds(json.features || [], json) || json.features || [];
        feats = gj.map((f) => ({ id: f.id, props: f.properties || {}, geometry: f.geometry }));
      } catch (_e) { /* the shape differs between builds; fall through with raw ids */ }
    }
  } else {
    const idName = json.objectIdFieldName || ((json.fields || []).find((f) => f.type === "esriFieldTypeOID") || {}).name;
    feats = (json.features || []).map((f) => ({ id: idName && f.attributes ? f.attributes[idName] : undefined, props: f.attributes || {}, geometry: f.geometry }));
  }
  return { feats, exceeded: !!(json.exceededTransferLimit || (json.properties && json.properties.exceededTransferLimit)) };
}

export async function checkB(app, county, route, pt, a) {
  const { counties, zoom } = app;
  const out = { expected: route.key };
  if (route.kind === "none") { out.gap = true; out.pass = true; out.reason = "named gap — no outline source by design"; out.sources = []; return out; }
  const z = Math.max(zoom.PARCEL_VECTOR_MINZOOM, counties.displayMinZoomOf(route.key));
  out.zoom = z;
  const [dLng, dLat] = pxDeg(z, pt.lat, 1280), [, dLat2] = pxDeg(z, pt.lat, 800);
  const view = { south: pt.lat - dLat2 / 2, north: pt.lat + dLat2 / 2, west: pt.lng - dLng / 2, east: pt.lng + dLng / 2 };
  const sources = counties.displaySourcesForView(view);
  out.sources = sources;
  if (!sources.includes(route.key)) { out.pass = false; out.reason = `the outline layer would not draw ${route.key} here (draws: ${sources.join(",") || "nothing"})`; return out; }
  const cfg = counties.COUNTIES_MAP[route.key];
  /* the cells esri-leaflet requests: 512-px cells of the zoom grid that the view touches */
  const cellDeg = (360 * TILE) / (256 * 2 ** z);
  const cellDegLat = cellDeg * Math.cos((pt.lat * Math.PI) / 180);
  const c0 = Math.floor((view.west + 180) / cellDeg), c1 = Math.floor((view.east + 180) / cellDeg);
  const r0 = Math.floor((view.south + 90) / cellDegLat), r1 = Math.floor((view.north + 90) / cellDegLat);
  const held = new Map();
  let exceeded = 0, idless = 0, cells = 0, errors = 0, maxCell = 0, ms = 0, maxCellMs = 0;
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
    const bounds = { west: c * cellDeg - 180, east: (c + 1) * cellDeg - 180, south: r * cellDegLat - 90, north: (r + 1) * cellDegLat - 90 };
    cells++;
    try {
      const t0 = Date.now();
      const q = await queryCell(app, cfg, route, county, bounds);
      ms += Date.now() - t0;
      maxCellMs = Math.max(maxCellMs, Date.now() - t0);
      const { feats, exceeded: ex } = keyLots(app, q);
      if (ex) exceeded++;
      maxCell = Math.max(maxCell, feats.length);
      for (const f of feats) { if (f.id == null) idless++; held.set(f.id == null ? "undefined" : `id:${f.id}`, f); }
    } catch (e) { errors++; out.error = e.message; }
  }
  out.cells = cells; out.errors = errors; out.exceededCells = exceeded; out.held = held.size; out.idlessFeatures = idless; out.maxCell = maxCell; out.ms = ms; out.maxCellMs = maxCellMs;
  /* is the clicked lot among the held ones? (point-in-polygon on the held geometry, GeoJSON or Esri) */
  const inRing = (ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > pt.lat) !== (yj > pt.lat)) && (pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi)) ins = !ins; } return ins; };
  let clickedHeld = false;
  for (const f of held.values()) {
    const g = f.geometry; if (!g) continue;
    const rings = g.rings || (g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : []);
    if (rings.some(inRing)) { clickedHeld = true; break; }
  }
  out.clickedLotHeld = clickedHeld;
  const problems = [];
  if (errors) problems.push(`${errors}/${cells} cell request(s) failed (${out.error})`);
  if (held.size < 2) problems.push(`only ${held.size} lot(s) held in a view of ${cells} cell(s)`);
  if (idless && held.has("undefined") && held.size <= 1) problems.push(`${idless} feature(s) came back with no id and collapsed to ${held.size} (the B2416496 collapse)`);
  else if (idless) problems.push(`${idless} feature(s) with no feature id (held ${held.size})`);
  if (exceeded) problems.push(`${exceeded}/${cells} cell(s) hit the server's record cap — outlines truncated`);
  if (!clickedHeld) problems.push("the clicked lot is not among the lots held");
  if (maxCellMs > OUTLINE_HANG_MS) problems.push(`slow: one cell took ${(maxCellMs / 1000).toFixed(1)} s, past the outline layer's ${OUTLINE_HANG_MS / 1000} s hang-guard (the app would pull the layer and show its slow-server notice)`);
  out.pass = problems.length === 0;
  out.reason = out.pass ? `${held.size} lots held over ${cells} cell(s) at zoom ${z}` : problems.join("; ");
  return out;
}

/* ---------- Check C — parcel-id search ---------- */
const bareName = (n) => String(n).replace(/\s+County$/i, "");
const FAR_EAST = { lat: 36.4, lng: -82.4 }, FAR_WEST = { lat: 35.15, lng: -90.05 }; // a map NOT over the county (the far end of the state), for the "does the id stand on its own" reading
const sameLot = (app, a, res) => {
  const norm = (v) => String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return norm(app.query.idAttrFor(res.county, (res.feature && res.feature.attributes) || {})) === norm(a.id);
};
/** Feed the id Check A returned back through the Site search's own path (`resolveParcelId`) three ways:
 *   with the map over the county (what a person looking at the county does), with the county named first ("Anderson <id>"), and with the map ELSEWHERE (does the id stand alone?).
 *  Pass = the first two land on the same lot; `unique` records the third (a control-map id repeats across counties, so it need not hold). */
export async function checkC(app, county, route, a) {
  const out = { expected: route.key };
  if (route.kind === "none") { out.gap = true; out.pass = true; out.reason = "named gap — no source to search"; return out; }
  if (!a || !a.id) { out.pass = false; out.reason = "check A returned no parcel id to search for"; return out; }
  const near = a.feature ? app.idSearch.interiorPointOf(a.feature) : null;
  const run = (text, nearPt) => app.idSearch.resolveParcelId(text, { near: nearPt, retryMs: 800 }).catch((e) => ({ status: "error", message: e.message }));
  const r1 = await run(a.id, near);
  out.status = r1.status;
  if (r1.status === "none") { out.pass = false; out.reason = `Site search does not read "${a.id}" as a parcel id (the box would geocode it as an address)`; return out; }
  if (r1.status !== "found") { out.pass = false; out.reason = `search says ${r1.status}${r1.message ? `: ${r1.message}` : ""}${r1.tried ? ` (asked ${r1.tried.join(", ")})` : ""}`; return out; }
  out.landedOn = r1.county; out.foundId = app.query.idAttrFor(r1.county, (r1.feature && r1.feature.attributes) || {}); out.point = r1.point;
  const okMapOver = r1.county === route.key && sameLot(app, a, r1) && !!near;
  const FAR = near && near.lng < -86.5 ? FAR_EAST : FAR_WEST;
  const r2 = await run(`${bareName(county.name)} ${a.id}`, FAR);
  const okNamed = r2.status === "found" && r2.county === route.key && sameLot(app, a, r2);
  const r3 = await run(a.id, FAR);
  out.unique = r3.status === "found" && r3.county === route.key && sameLot(app, a, r3);
  if (r1.alsoIn) out.alsoIn = r1.alsoIn;
  out.pass = okMapOver && okNamed;
  const why = [];
  if (!okMapOver) why.push(r1.county !== route.key ? `with the map over the county it landed in ${r1.county}` : "with the map over the county it found a different lot");
  if (!okNamed) why.push(`"${bareName(county.name)} ${a.id}" → ${r2.status}${r2.county && r2.county !== route.key ? ` in ${r2.county}` : ""}`);
  out.reason = out.pass ? (out.unique ? "found the same lot, from anywhere" : `found the same lot with the map over the county or the county named; the id also exists in ${(r1.alsoIn || ["other counties"]).join(", ")}`) : why.join("; ");
  return out;
}
