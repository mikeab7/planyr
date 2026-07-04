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
 * Usage:
 *   node scripts/build-parcel-snapshot.mjs                 # all counties → Drive (needs GOOGLE_* env)
 *   node scripts/build-parcel-snapshot.mjs --county=chambers
 *   node scripts/build-parcel-snapshot.mjs --dry-run --county=fortbend --bbox=-95.83,29.75,-95.80,29.78
 *        # dry-run: fetch + transform + gzip only, no Drive; --bbox limits the pull for a quick test
 *
 * SNAPSHOT SOURCE NOTE: Chambers/Waller ride the State/TxGIO layer whose /query is DISABLED, so we
 * pull them from the TNRIS StratMap mirror (same data, query-enabled). If a source URL is wrong the
 * run fails + keeps last-good + files an issue — the app is unaffected (stays on live). Confirm/adjust
 * the SOURCES urls on the first CI run.
 */
import zlib from "node:zlib";
import { buildSnapshotFC } from "../src/shared/gis/parcelSnapshotBuild.js";

const PAGE = 2000; // ArcGIS maxRecordCount for these layers
const UA = { "user-agent": "Mozilla/5.0 (compatible; PlanyrParcelSnapshot/1.0; +https://planyr.io)" };

// Per-county build sources. Each is an ArcGIS layer /query endpoint + an optional county scope +
// a min-count floor a good snapshot must clear. `sources` is tried in order (first success wins).
const SOURCES = {
  fortbend: {
    minCount: 300000,
    sources: [{ url: "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0", where: "1=1" }],
  },
  // ⚠ SOURCE UNCONFIRMED for Chambers/Waller. The first nightly run (2026-07-04) proved the guessed
  // `feature.tnris.org` host is DEAD ("fetch failed" from CI with open egress), and TxGIO's own
  // `feature.geographic.texas.gov` /query is still DISABLED (the B627 outage — not self-healed). So a
  // WORKING queryable/bulk source must be found from an open-egress machine (see the Cowork brief):
  //   • a query-enabled StratMap mirror (an ArcGIS FeatureServer whose /query works), OR
  //   • the TxGIO/StratMap BULK parcel download (a file at the TxGIO data hub — would need this builder
  //     to fetch + unzip + parse a shapefile/GDB instead of paging /query), OR
  //   • Chambers/Waller CAD's own hosted layer.
  // Until then these two counties fail loudly (the @claude issue is the correct "find the source"
  // signal); Fort Bend's source below is confirmed working. Keep the `where` county scope on whatever
  // statewide/mirror source is wired.
  chambers: {
    minCount: 15000,
    sources: [{ url: "https://feature.tnris.org/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0", where: "county='CHAMBERS'" }],
  },
  waller: {
    minCount: 10000,
    sources: [{ url: "https://feature.tnris.org/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0", where: "county='WALLER'" }],
  },
};

const arg = (name, def = null) => { const m = process.argv.find((a) => a.startsWith(`--${name}=`)); return m ? m.split("=").slice(1).join("=") : def; };
const has = (name) => process.argv.includes(`--${name}`);
const log = (...a) => console.log("[parcel-snapshot]", ...a);

/* Page every feature from an ArcGIS layer as GeoJSON (outSR 4326). Optional bbox limits the pull
 * (dry-run testing). Throws on an HTTP/ArcGIS error so keep-last-good kicks in. */
async function pageAll(url, where, bbox) {
  const feats = [];
  const geom = bbox ? { geometry: bbox, geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects" } : {};
  for (let offset = 0; ; offset += PAGE) {
    const q = new URLSearchParams({ where, outFields: "*", returnGeometry: "true", outSR: "4326", f: "geojson", resultOffset: String(offset), resultRecordCount: String(PAGE), ...geom });
    const res = await fetch(`${url.replace(/\/+$/, "")}/query?${q}`, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status} paging ${url} @${offset}`);
    const j = await res.json();
    if (j.error) throw new Error(`ArcGIS error paging ${url}: ${j.error.message || JSON.stringify(j.error)}`);
    const batch = (j.features || []).filter((f) => f && f.geometry);
    feats.push(...batch);
    if (batch.length < PAGE) break; // last page
    if (bbox && feats.length >= PAGE) break; // dry-run: one page over the bbox is enough
  }
  return feats;
}

async function buildCounty(county, { dryRun, bbox }) {
  const cfg = SOURCES[county];
  if (!cfg) throw new Error(`unknown county ${county}`);
  let raw = null, usedSource = null, lastErr = null;
  for (const src of cfg.sources) {
    try { log(`${county}: paging ${src.url} (${src.where})…`); raw = await pageAll(src.url, src.where, bbox); usedSource = src.url; break; }
    catch (e) { lastErr = e; log(`${county}: source failed — ${e.message}`); }
  }
  if (!raw) throw new Error(`${county}: all sources failed (${lastErr && lastErr.message})`);

  const fc = buildSnapshotFC(raw, { decimals: 6 });
  const count = fc.features.length;
  log(`${county}: ${count} parcels after transform`);
  if (!bbox && count < cfg.minCount) throw new Error(`${county}: only ${count} parcels (< min ${cfg.minCount}) — refusing to replace last-good`);

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
  const bbox = arg("bbox"); // "w,s,e,n" — dry-run pull limiter

  // Pre-turn-on silence: until the owner adds the GitHub Actions Drive secrets (OWNER-TODO), this
  // job can't upload anything, so exit CLEANLY (0) instead of paging sources + failing + filing a
  // nightly @claude issue for a feature that simply isn't switched on yet. The workflow's
  // "close on green" step then auto-closes any stale failure issue. Once the secrets land it runs
  // for real. (Dry-run skips this check — it never touches Drive.)
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
    try { results.push(await buildCounty(c, { dryRun, bbox })); }
    catch (e) { failures.push({ county: c, error: e.message }); log(`${c}: FAILED — ${e.message} (keeping last-good)`); }
  }
  log(`done · ok=${results.length} failed=${failures.length}`);
  if (failures.length) process.exit(1); // workflow files a @claude issue; last-good Drive copies stay
}

main().catch((e) => { log("fatal", e); process.exit(1); });
