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
 * of blocking the build. Two provider kinds:
 *   • { kind:"query", url, where }        — a direct /query with a where-clause (the source has a
 *                                           county field, or IS one county, e.g. FBCAD).
 *   • { kind:"county-poly", url, county } — the source has NO county field (the AGO StratMap layer),
 *                                           so fetch that county's boundary polygon (TxDOT) and
 *                                           POST-spatial-query the parcels layer scoped to it.
 *
 * WHY the AGO StratMap layer is primary for Chambers/Waller (2026-07-04): the Texas state parcel
 * `/query` went dark on BOTH hosts at once — `feature.tnris.org` 503, and `feature.geographic.texas.gov`
 * returns 400 "operation is not supported" (the B627 outage). The public ArcGIS-Online-hosted
 * "StratMap25" FeatureServer (TPWD-owned, services1.arcgis.com) is the same StratMap data, 2025
 * vintage, query-enabled, on an independent host — verified live: Chambers 38,293 · Waller 48,741.
 *
 * Usage:
 *   node scripts/build-parcel-snapshot.mjs                 # all counties → Drive (needs GOOGLE_* env)
 *   node scripts/build-parcel-snapshot.mjs --county=chambers
 *   node scripts/build-parcel-snapshot.mjs --dry-run --county=chambers --max=1
 *        # dry-run: fetch + transform + gzip only, no Drive; --max limits pages for a quick test
 */
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { buildSnapshotFC } from "../src/shared/gis/parcelSnapshotBuild.js";

const PAGE = 2000; // ArcGIS maxRecordCount for these layers
const UA = { "user-agent": "Mozilla/5.0 (compatible; PlanyrParcelSnapshot/1.0; +https://planyr.io)" };

// The AGO-hosted StratMap 2025 parcels FeatureServer (query-enabled, reliable, independent of the
// dark TxGIO /query). Has NO county field, so county pulls scope by the county polygon.
const AGO_STRATMAP = "https://services1.arcgis.com/1mtXwieMId59thmg/arcgis/rest/services/2019_Texas_Parcels_StratMap/FeatureServer/0";
// The state's own parcels MapServer — authoritative + HAS a `county` field, but its /query is dark
// as of 2026-07-04 (B627). Kept as a preferred-when-healthy fallback: it fails fast while dark and
// the build falls through to the AGO source; when TxGIO re-enables /query it takes over again.
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
      { kind: "county-poly", url: AGO_STRATMAP, county: "Chambers" },
      { kind: "query", url: TXGIO_PARCELS, where: "county='CHAMBERS'" }, // preferred when its /query is healthy again
    ],
  },
  waller: {
    minCount: 20000, // verified ~48,741
    sources: [
      { kind: "county-poly", url: AGO_STRATMAP, county: "Waller" },
      { kind: "query", url: TXGIO_PARCELS, where: "county='WALLER'" },
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

/* Page every feature from one provider as GeoJSON (outSR 4326). A county-poly provider POSTs (the
 * polygon is too big for a URL); a plain query GETs. `maxPages` caps the pull for a dry-run.
 * Throws on any HTTP/ArcGIS error so the caller falls through to the next candidate. */
async function pageProvider(provider, { bbox, maxPages = Infinity } = {}) {
  const base = `${provider.url.replace(/\/+$/, "")}/query`;
  const rings = provider.kind === "county-poly" ? await fetchCountyPolygon(provider.county) : null;
  const usePost = provider.kind === "county-poly";
  const feats = [];
  for (let page = 0; page < maxPages; page++) {
    const params = { ...queryParamsFor(provider, rings, bbox), resultOffset: String(page * PAGE), resultRecordCount: String(PAGE) };
    let res;
    if (usePost) res = await fetch(base, { method: "POST", headers: { ...UA, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
    else res = await fetch(`${base}?${new URLSearchParams(params)}`, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status} paging ${provider.url} @page${page}`);
    const j = await res.json();
    if (j.error) throw new Error(`ArcGIS error paging ${provider.url}: ${j.error.message || JSON.stringify(j.error)}`);
    const batch = (j.features || []).filter((f) => f && f.geometry);
    feats.push(...batch);
    if (batch.length < PAGE) break; // last page
  }
  return feats;
}

/* Stamp the county name onto every feature (the AGO StratMap layer has no county field, but the
 * "Cached copy · <County>" badge + the app read `county` off the attributes). Mutates + returns fc. */
export function stampCounty(fc, county) {
  const cty = String(county).toUpperCase();
  for (const f of fc.features) if (f.properties && !f.properties.county) f.properties.county = cty;
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
 * copies (create-then-delete = no gap for a concurrent reader; mirrors the B445 store()). */
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
