#!/usr/bin/env node
/* Build county PARCEL snapshots and upload them to Google Drive (B629).
 *
 * Runs in CI (.github/workflows/parcel-snapshot.yml), NOT in the browser. Per county it: pages the
 * whole parcel set from a reachable source, shrinks it (buildSnapshotFC — strip fields + quantize),
 * gzips it, VALIDATES a minimum parcel count (so a silently county-clipped/empty pull can never
 * replace a good snapshot — the B369 lesson), and uploads `<county>.json.gz` + `<county>.meta.json`
 * to the shared `Planyr/parcelcache` Drive folder that functions/api/parcel-cache serves. On any
 * failure it KEEPS the last-good Drive copy (capture-when-up, serve-when-down) and exits non-zero so
 * the workflow opens a @claude issue.
 *
 * SOURCE-RESILIENT (B629 NEW-1): each county carries an ORDERED list of candidate providers, tried
 * in turn until one clears its min-count — so one host going dark fails over automatically instead
 * of blocking the build. Three provider kinds:
 *   • { kind:"query", url, where }         — a direct /query with a where-clause (the source has a
 *                                            county field, or IS one county, e.g. FBCAD).
 *   • { kind:"county-poly", url, county }  — the source has NO county field, so fetch that county's
 *                                            boundary polygon (TxDOT) and POST-spatial-query the
 *                                            parcels layer scoped to it. (No SOURCES entry uses this
 *                                            today — the AGO StratMap mirror it was built for died,
 *                                            B1639698 — but it's generic, tested infrastructure kept
 *                                            for a future query-capable-but-county-less source.)
 *   • { kind:"identify-tile", url, county } — the source's /query is DISABLED (TXGIO_PARCELS, B627),
 *                                            so extract via recursive /identify over envelope tiles
 *                                            instead. See `identifyTileCounty`'s own header.
 *
 * Usage:
 *   node scripts/build-parcel-snapshot.mjs                 # all counties → Drive (needs GOOGLE_* env)
 *   node scripts/build-parcel-snapshot.mjs --county=chambers
 *   node scripts/build-parcel-snapshot.mjs --dry-run --county=chambers --max=1
 *        # dry-run: fetch + transform + gzip only, no Drive; --max limits pages for a quick test
 */
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { buildSnapshotFC, esriRingsToGeoJsonGeometry } from "../src/shared/gis/parcelSnapshotBuild.js";

const PAGE = 2000; // ArcGIS maxRecordCount for these layers
const UA = { "user-agent": "Mozilla/5.0 (compatible; PlanyrParcelSnapshot/1.0; +https://planyr.io)" };

// ✅ FIXED 2026-09-15 (B1639698 amendment) — the dead AGO StratMap mirror (owner
// `TPWD_LawEnforcement`, taken down; returned HTTP 200 with `{"error":{"code":400,"message":
// "Invalid URL"}}` at the SERVICE ROOT) is GONE from SOURCES below. The replacement is the SAME
// government TxGIO service the live app's click path uses (`TXGIO_PARCELS`, identical to
// counties.js's `TXGIO_STATEWIDE_LAYER`) — confirmed live to carry both Chambers and Waller. Its
// `/query` op is permanently disabled (B627) and `returnCountOnly` is unsupported too (same
// service, same limitation), so a bulk page can't ask "how many total" or page by offset the way
// FBCAD does. `identifyTileCounty` below is the substitute: /identify accepts an ENVELOPE
// geometry, not just a point, so a rectangle tiled over the county's own bounding box works as a
// bulk spatial query — completeness is judged PER TILE (did THIS request come back at the
// server's own declared per-request ceiling?), never from a total feature count for the county,
// which this service cannot supply. See `identifyTileCounty`'s own header for the full mechanism.
//
// The state's own parcels MapServer — authoritative + HAS a `county` field. Its /query stays a
// preferred-when-healthy first attempt (self-heals for free if TxGIO ever re-enables it — a
// single fast-failing request costs nothing in a nightly job); identify-tile is the reliable path.
const TXGIO_PARCELS = "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0";
// TxDOT statewide county boundaries (query-enabled, reliable) — the scoping polygon source.
const COUNTY_BOUNDARIES = "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/Texas_County_Boundaries/FeatureServer/0";

// Per-county build config: a min-count floor a good snapshot must clear + an ordered candidate list.
export const SOURCES = {
  fortbend: {
    minCount: 300000, // ~385k
    sources: [{ kind: "query", url: "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0", where: "1=1" }],
  },
  chambers: {
    minCount: 20000, // verified ~38,293
    sources: [
      { kind: "query", url: TXGIO_PARCELS, where: "county='CHAMBERS'" }, // self-heals if TxGIO ever re-enables /query
      { kind: "identify-tile", url: TXGIO_PARCELS, county: "Chambers" },
    ],
  },
  waller: {
    minCount: 20000, // verified ~48,741
    sources: [
      { kind: "query", url: TXGIO_PARCELS, where: "county='WALLER'" },
      { kind: "identify-tile", url: TXGIO_PARCELS, county: "Waller" },
    ],
  },
};

const arg = (name, def = null) => { const m = process.argv.find((a) => a.startsWith(`--${name}=`)); return m ? m.split("=").slice(1).join("=") : def; };
const has = (name) => process.argv.includes(`--${name}`);
const log = (...a) => console.log("[parcel-snapshot]", ...a);

/* Fetch one county's boundary polygon rings ([[[lng,lat]…]…], 4326) from the TxDOT county layer.
 * Throws on failure so the caller can fall through to the next candidate source. */
async function fetchCountyPolygon(county) {
  const q = new URLSearchParams({ where: `CNTY_NM='${county}'`, outFields: "CNTY_NM", returnGeometry: "true", outSR: "4326", f: "json" });
  const res = await fetch(`${COUNTY_BOUNDARIES}/query?${q}`, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${county} boundary`);
  const j = await res.json();
  if (j.error) throw new Error(`boundary query error: ${j.error.message || JSON.stringify(j.error)}`);
  const rings = j.features && j.features[0] && j.features[0].geometry && j.features[0].geometry.rings;
  if (!rings || !rings.length) throw new Error(`no boundary polygon for ${county}`);
  return rings;
}

/* The /query params (minus paging) for a provider. Pure — unit-tested. A `county-poly` provider
 * carries the pre-fetched `rings` as a spatial filter (POSTed); a `query` provider a where-clause. */
export function queryParamsFor(provider, rings, bbox) {
  const p = { where: provider.where || "1=1", outFields: "*", returnGeometry: "true", outSR: "4326", f: "geojson" };
  if (provider.kind === "county-poly") {
    p.geometry = JSON.stringify({ rings, spatialReference: { wkid: 4326 } });
    p.geometryType = "esriGeometryPolygon"; p.inSR = "4326"; p.spatialRel = "esriSpatialRelIntersects";
  } else if (bbox) {
    p.geometry = bbox; p.geometryType = "esriGeometryEnvelope"; p.inSR = "4326"; p.spatialRel = "esriSpatialRelIntersects";
  }
  return p;
}

// The layer's own maxRecordCount ceiling, so tile-splitting never invents a magic number. Falls
// back to a conservative default if metadata is unreachable/silent — this is only a SPLIT
// heuristic (whether to trust THIS tile's page or subdivide it), never a stand-in for the
// county's total feature count, which this service cannot supply (returnCountOnly is disabled).
const IDENTIFY_TILE_CAP_FALLBACK = 1000;
export async function layerMaxRecordCount(layerUrl, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${layerUrl.replace(/\/+$/, "")}?f=json`, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const n = Number(j && j.maxRecordCount);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (_) { /* fall through to the conservative default */ }
  return IDENTIFY_TILE_CAP_FALLBACK;
}

// A tile's [w,s,e,n] envelope → its four quadrants (pure — unit-tested).
export function quarterSplit([w, s, e, n]) {
  const mx = (w + e) / 2, my = (s + n) / 2;
  return [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]];
}

// Bounding box of a set of Esri-style rings ([[[x,y],…],…] or a flat ring list). Pure.
export function boundsOfRings(rings) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n];
}

// A field lookup that doesn't care about case — /identify capitalizes attribute names
// (PROP_ID, COUNTY, …) while the layer's own metadata lists them lowercase (prop_id, county, …).
export function attrValue(attrs, name) {
  if (!attrs) return undefined;
  const key = Object.keys(attrs).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : attrs[key];
}

const IDENTIFY_TILE_MIN_SPAN_DEG = 0.0008; // ~250 ft — floor so a bad cap read can't recurse forever
const IDENTIFY_TILE_MAX_DEPTH = 18;

/* One /identify call over an ENVELOPE (not a single click point) — the operation honors a
 * rectangle exactly like it honors a point, which is what turns it into a bulk spatial query for a
 * service whose /query is disabled (B627). Returns the raw `results` array (Esri JSON). */
export async function identifyEnvelope(layerUrl, [w, s, e, n], { fetchImpl = fetch } = {}) {
  const m = /^(.*\/MapServer)\/(\d+)\/?$/i.exec(layerUrl.replace(/\/+$/, ""));
  if (!m) throw new Error(`identify-tile needs a .../MapServer/<id> layer url, got ${layerUrl}`);
  const [, service, id] = m;
  const params = new URLSearchParams({
    f: "json",
    geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryEnvelope",
    sr: "4326",
    layers: `all:${id}`,
    tolerance: "0",
    mapExtent: `${w},${s},${e},${n}`,
    imageDisplay: "700,700,96",
    returnGeometry: "true",
  });
  const res = await fetchImpl(`${service}/identify?${params}`, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} identify-tile ${layerUrl} @${w},${s},${e},${n}`);
  const j = await res.json();
  if (j.error) throw new Error(`identify error: ${j.error.message || JSON.stringify(j.error)}`);
  return j.results || [];
}

/* Extract every parcel of ONE county from a /query-disabled MapServer by recursively subdividing
 * its bounding box into ENVELOPE tiles and asking /identify per tile — the substitute for a bulk
 * /query this service (TXGIO_PARCELS) permanently disabled (B627), whose `returnCountOnly` is ALSO
 * unsupported, so nothing here may ask "how many total" either.
 *
 * A tile is trusted whole when its own result count is BELOW the layer's declared
 * maxRecordCount (`layerMaxRecordCount`); a tile AT that ceiling is a possibly-arbitrary subset —
 * its contents are discarded and it is split into four instead, so completeness never depends on
 * the county's total feature count, only on whether ONE request came back at the server's own
 * per-request limit. Results are deduped by PROP_ID (falling back to OBJECTID, then kept
 * undeduplicated as a last resort) because adjacent tiles legitimately re-return a parcel that
 * straddles their shared edge, and filtered to the target county via the identify response's own
 * COUNTY attribute (both read case-insensitively via `attrValue` — see its own header) — the
 * bounding-box root is a rectangle, so a corner tile can genuinely reach into a neighboring
 * county. Returns GeoJSON Features, ready for `buildSnapshotFC`. */
export async function identifyTileCounty(layerUrl, county, { fetchImpl = fetch, ringsFetcher = fetchCountyPolygon, bbox = null, maxTiles = Infinity } = {}) {
  const root = bbox ? bbox.split(",").map(Number) : boundsOfRings(await ringsFetcher(county));
  const cap = await layerMaxRecordCount(layerUrl, { fetchImpl });
  const found = new Map();
  let unkeyed = 0, tiles = 0;
  const queue = [{ box: root, depth: 0 }];
  while (queue.length) {
    if (tiles >= maxTiles) break;
    const { box, depth } = queue.shift();
    tiles++;
    const results = await identifyEnvelope(layerUrl, box, { fetchImpl });
    const spanDeg = Math.min(box[2] - box[0], box[3] - box[1]);
    if (results.length >= cap && depth < IDENTIFY_TILE_MAX_DEPTH && spanDeg > IDENTIFY_TILE_MIN_SPAN_DEG) {
      for (const child of quarterSplit(box)) queue.push({ box: child, depth: depth + 1 });
      continue; // a capped page's CONTENTS are an arbitrary subset — only its children are trusted
    }
    for (const r of results) {
      if (!r || !r.geometry || !r.geometry.rings) continue;
      const attrs = r.attributes || {};
      const cty = attrValue(attrs, "county");
      if (cty && String(cty).toUpperCase() !== String(county).toUpperCase()) continue; // a neighbor the bbox reached
      const key = attrValue(attrs, "prop_id") ?? attrValue(attrs, "objectid");
      found.set(key != null ? String(key) : `__unkeyed_${unkeyed++}`, r);
    }
  }
  return [...found.values()]
    .map((r) => ({ type: "Feature", properties: r.attributes || {}, geometry: esriRingsToGeoJsonGeometry(r.geometry.rings) }))
    .filter((f) => f.geometry);
}

/* Page every feature from one provider as GeoJSON (outSR 4326). A county-poly provider POSTs (the
 * polygon is too big for a URL); a plain query GETs. `maxPages` caps the pull for a dry-run.
 * Throws on any HTTP/ArcGIS error so the caller falls through to the next candidate. */
export async function pageProvider(provider, { bbox, maxPages = Infinity, fetchImpl = fetch, ringsFetcher = fetchCountyPolygon } = {}) {
  if (provider.kind === "identify-tile")
    return identifyTileCounty(provider.url, provider.county, { fetchImpl, ringsFetcher, bbox, maxTiles: maxPages });
  const base = `${provider.url.replace(/\/+$/, "")}/query`;
  const rings = provider.kind === "county-poly" ? await ringsFetcher(provider.county) : null;
  const usePost = provider.kind === "county-poly";
  const feats = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const params = { ...queryParamsFor(provider, rings, bbox), resultOffset: String(offset), resultRecordCount: String(PAGE) };
    let res;
    if (usePost) res = await fetchImpl(base, { method: "POST", headers: { ...UA, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
    else res = await fetchImpl(`${base}?${new URLSearchParams(params)}`, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status} paging ${provider.url} @${offset}`);
    const j = await res.json();
    if (j.error) throw new Error(`ArcGIS error paging ${provider.url}: ${j.error.message || JSON.stringify(j.error)}`);
    const raw = j.features || [];
    for (const f of raw) if (f && f.geometry) feats.push(f);
    // Advance by the rows ACTUALLY returned (not a fixed PAGE) and page by the server's OWN
    // "there's more" flag — a transient short page must NOT end the pull (the Waller 26k-vs-49k
    // bug: `batch.length < PAGE` stopped early when a mid-pull page came back <2000).
    offset += raw.length;
    const more = !!(j.exceededTransferLimit || (j.properties && j.properties.exceededTransferLimit));
    if (!more || raw.length === 0) break;
  }
  return feats;
}

/* Stamp the county name onto every feature that doesn't already carry one, so the "Cached copy ·
 * <County>" badge + the app's own `county` attribute read always have something. Checked
 * case-insensitively (`attrValue`) — /identify's own `COUNTY` attribute must count as already
 * present, or every identify-tile feature would end up with BOTH a `COUNTY` and a redundant
 * lowercase `county` key. Mutates + returns fc. */
export function stampCounty(fc, county) {
  const cty = String(county).toUpperCase();
  for (const f of fc.features) if (f.properties && attrValue(f.properties, "county") == null) f.properties.county = cty;
  return fc;
}

async function buildCounty(county, { dryRun, bbox, maxPages }) {
  const cfg = SOURCES[county];
  if (!cfg) throw new Error(`unknown county ${county}`);

  // Try each candidate source in order; the first that pages AND clears the min-count wins.
  let fc = null, usedSource = null, count = 0;
  const problems = [];
  for (const src of cfg.sources) {
    const label = `${src.kind}:${src.url}`;
    try {
      log(`${county}: trying ${label}${src.county ? ` (poly:${src.county})` : src.where ? ` (${src.where})` : ""}…`);
      const raw = await pageProvider(src, { bbox, maxPages });
      const built = stampCounty(buildSnapshotFC(raw, { decimals: 6 }), county);
      const n = built.features.length;
      if (!bbox && !maxPages && n < cfg.minCount) { problems.push(`${label} → only ${n} (< min ${cfg.minCount})`); log(`${county}: ${label} returned ${n} (< min ${cfg.minCount}) — trying next`); continue; }
      fc = built; usedSource = src.url; count = n; break;
    } catch (e) { problems.push(`${label} → ${e.message}`); log(`${county}: ${label} failed — ${e.message}`); }
  }
  if (!fc) throw new Error(`${county}: no source produced a valid snapshot [${problems.join(" | ")}]`);
  log(`${county}: ${count} parcels from ${usedSource}`);

  const generatedAt = new Date().toISOString();
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(fc)), { level: 9 });
  const meta = { generatedAt, count, source: usedSource, bbox: fc.bbox };
  log(`${county}: gz ${(gz.length / 1e6).toFixed(1)} MB · vintage ${generatedAt}`);

  if (dryRun) { log(`${county}: DRY-RUN — not uploading (would write ${county}.json.gz + ${county}.meta.json)`); return { county, count, bytes: gz.length }; }
  await uploadToDrive(county, gz, meta);
  log(`${county}: uploaded ✓`);
  return { county, count, bytes: gz.length };
}

/* Upload the snapshot + meta to the shared Drive `parcelcache` folder, then drop older same-name
 * copies (create-then-delete = no gap for a concurrent reader; mirrors the B445 store()).
 * Hard client.del is DELIBERATE (NEW-F2): regenerable cache, not user data — no trash needed. */
async function uploadToDrive(county, gzBytes, meta) {
  const { storageConfig, defaultDriveClientFactory } = await import("../server/storage/index.js");
  const client = defaultDriveClientFactory(storageConfig(process.env).drive);
  if (!client) throw new Error("Drive not configured (need GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN + PLANYR_STORAGE_BACKEND=drive)");
  const folderId = await client.folderId("parcelcache");
  const put = async (name, bytes, contentType) => {
    const created = await client.create({ bytes: new Uint8Array(bytes), contentType, name, parentFolderId: folderId });
    const dupes = (await client.list({ parentFolderId: folderId }).catch(() => [])) || [];
    for (const f of dupes) if (f.name === name && f.id !== (created && created.id)) await client.del(f.id).catch(() => {});
  };
  await put(`${county}.json.gz`, gzBytes, "application/gzip");
  await put(`${county}.meta.json`, Buffer.from(JSON.stringify(meta)), "application/json");
}

async function main() {
  const dryRun = has("dry-run");
  const only = arg("county");
  const bbox = arg("bbox"); // "w,s,e,n" — optional dry-run envelope
  const maxPages = arg("max") ? Number(arg("max")) : (bbox ? 1 : 0) || Infinity; // dry-run page cap

  // Pre-turn-on silence: until the owner adds the GitHub Actions Drive secrets (OWNER-TODO), this
  // job can't upload anything, so exit CLEANLY (0) instead of failing + filing a nightly @claude
  // issue for a feature that isn't switched on yet. The workflow's "close on green" step then
  // auto-closes any stale failure issue. (Dry-run skips this — it never touches Drive.)
  if (!dryRun) {
    const { storageConfig, defaultDriveClientFactory } = await import("../server/storage/index.js");
    if (!defaultDriveClientFactory(storageConfig(process.env).drive)) {
      log("Drive not configured (GitHub Actions secrets not set yet) — the parcel cache isn't turned on; nothing to do. Exiting cleanly.");
      return;
    }
  }

  const counties = only ? [only] : Object.keys(SOURCES);
  const results = [];
  const failures = [];
  for (const c of counties) {
    try { results.push(await buildCounty(c, { dryRun, bbox, maxPages: maxPages === Infinity ? undefined : maxPages })); }
    catch (e) { failures.push({ county: c, error: e.message }); log(`${c}: FAILED — ${e.message} (keeping last-good)`); }
  }
  log(`done · ok=${results.length} failed=${failures.length}`);
  if (failures.length) process.exit(1); // workflow files a @claude issue; last-good Drive copies stay
}

// Only auto-run when executed directly (so tests can import the pure helpers without triggering a build).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { log("fatal", e); process.exit(1); });
}
