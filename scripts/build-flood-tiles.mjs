#!/usr/bin/env node
/* Build ONE PMTiles archive per county from FEMA's NFHL flood-hazard polygons (NEW-1).
 *
 * WHY. The flood layer calls FEMA's NFHL `/export` live on every pan and zoom, and FEMA's
 * server is the bottleneck (its edge drops responses around 10 s; a busy export takes
 * 20–30 s). Baking the polygons into a per-county archive that rides the existing Cloudflare
 * Pages deploy removes the origin from the hot path entirely: the browser range-reads a
 * static file from the same CDN that already serves the app. No new service, no new account,
 * no cost. See src/shared/gis/floodTiles.js for the model and for the one line that must not
 * move — a tile is a PICTURE, never a NUMBER.
 *
 * ⛔ THE BINDING CONSTRAINT IS 25 MiB PER FILE. Cloudflare Pages (free) caps a single
 * deployment file at 25 MiB and a deployment at 20,000 files. Per-county archives keep every
 * file far under both, but the cap is why this script REPORTS ITS OUTPUT SIZE AGAINST THE CAP
 * on every run and exits non-zero if a county blows it. It never silently "fixes" an
 * oversize county by dropping detail — that is a product decision (split by watershed, or
 * drop a zoom level), and it is reported for a human to make.
 *
 * PREREQUISITE: `tippecanoe` on PATH (Ubuntu/Debian: `apt-get install -y tippecanoe`;
 * macOS: `brew install tippecanoe`). Version 2.x is required — PMTiles output landed in the
 * 2.x line. The script checks and says so rather than failing halfway through.
 *
 * USAGE
 *   node scripts/build-flood-tiles.mjs harris co_larimer   # named counties
 *   node scripts/build-flood-tiles.mjs --all               # every county in FLOOD_TILE_COUNTIES
 *   node scripts/build-flood-tiles.mjs --all --dry-run     # fetch + report counts, build nothing
 *
 * OUTPUT
 *   public/flood/flood-<state>-<county>.pmtiles   one archive per county
 *   public/flood/manifest.json                    vintage + provenance + measured bytes
 *
 * The manifest is MERGED, not overwritten: building one county leaves the other counties'
 * records intact, so a partial rebuild can never silently retire a shipped archive's vintage.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FLOOD_TILE_COUNTIES, FLOOD_TILE_FIELDS, FLOOD_TILE_LAYER_NAME,
  FLOOD_TILE_MIN_ZOOM, FLOOD_TILE_MAX_ZOOM, TILE_DROP_RULE,
  floodArchiveName, keepInTiles,
} from "../src/shared/gis/floodTiles.js";
import { resolveFloodZone } from "../src/workspaces/site-planner/lib/floodZone.js";
import { normCountyKey } from "../src/shared/gis/countyKeys.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "flood");
const MANIFEST = path.join(OUT_DIR, "manifest.json");

/* FEMA's NFHL. Layer 28 = Flood Hazard Zones (S_Fld_Haz_Ar), the canonical queryable SFHA
 * polygons; layer 3 = FIRM Panels, which is where the effective date lives. Both facts are
 * already registered in shared/gis/sources.js — repeated here rather than imported because
 * that module pulls the whole registry, and a build script should not need it. */
const NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
const ZONE_LAYER = 28;
const PANEL_LAYER = 3;
const PAGE = 2000;            // the service's own maxRecordCount; asking for more is silently capped
/* ⛔ FEMA 500s ON A BIG RESPONSE, NOT ON A BAD REQUEST — measured, not guessed (2026-08-09).
 * Harris rows 10,000–10,802 are large multi-ring polygons. Asking for all 802 in one page
 * returns `HTTP 500` after ~10 s, every time, with a 636-byte error body. The IDENTICAL query
 * with `resultRecordCount=400` returns 200 and 12.6 MB in 9.8 s; 200 rows → 2.1 MB; 100 rows →
 * 0.64 MB. So the constraint is response SIZE, and a fixed page size cannot work for a county
 * whose polygon complexity varies by two orders of magnitude. The fetch therefore HALVES its
 * window on failure and grows it back on success — an offset can never be skipped, because the
 * shrink retries the SAME offset. Retrying the same oversize page four times, which is what
 * this script did first, is the one strategy guaranteed to fail. */
const PAGE_MIN = 100;         // below this a 500 is a real outage, not an oversize response
const GEOM_PRECISION = 6;     // ~0.1 m at this latitude — far finer than a z13 tile can express
const MAX_BYTES = 25 * 1024 * 1024; // Cloudflare Pages free: 25 MiB per single file

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const wanted = args.includes("--all")
  ? Object.keys(FLOOD_TILE_COUNTIES)
  : args.filter((a) => !a.startsWith("--")).map(normCountyKey).filter(Boolean);

const mib = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;
const log = (...m) => console.log(...m);

/* ------------------------------------------------------------------ fetching */

/* One GET with retries. FEMA is the slow origin this whole exercise exists to route around,
 * so a build run has to tolerate it rather than fail on the first timeout — but it must never
 * tolerate it SILENTLY (LOUD-FAILURE): every retry is printed, and exhausting them throws. */
async function getJson(url, { tries = 4, timeoutMs = 120000, what = "request" } = {}) {
  let lastErr = null;
  for (let i = 1; i <= tries; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      // An ArcGIS error is a 200 with an `error` object — the classic silent-failure shape.
      if (body && body.error) throw new Error(`ArcGIS error ${body.error.code}: ${body.error.message}`);
      return body;
    } catch (err) {
      lastErr = err;
      const wait = 2000 * 2 ** (i - 1);
      if (i < tries) {
        log(`    ! ${what} attempt ${i}/${tries} failed (${err.message}); retrying in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${what} failed after ${tries} attempts: ${lastErr && lastErr.message}`);
}

const q = (layer, params) =>
  `${NFHL}/${layer}/query?${new URLSearchParams(params).toString()}`;

/* The NFHL vintage for a county: the LATEST effective date across its FIRM panels, plus the
 * DFIRM study ids that answered. A county mid-revision legitimately carries panels with
 * different effective dates; the newest is the one a reader would call "the current map", and
 * the spread is recorded so a future session can see it was not a single-date study. */
async function fetchVintage(fips) {
  const where = `DFIRM_ID LIKE '${fips}%'`;
  const newest = await getJson(q(PANEL_LAYER, {
    where, outFields: "EFF_DATE,DFIRM_ID", returnGeometry: "false",
    orderByFields: "EFF_DATE DESC", resultRecordCount: "1", f: "json",
  }), { what: `panel vintage ${fips}` });
  const oldest = await getJson(q(PANEL_LAYER, {
    where, outFields: "EFF_DATE", returnGeometry: "false",
    orderByFields: "EFF_DATE ASC", resultRecordCount: "1", f: "json",
  }), { what: `panel vintage ${fips} (oldest)` });
  const ids = await getJson(q(PANEL_LAYER, {
    where, outFields: "DFIRM_ID", returnGeometry: "false", returnDistinctValues: "true", f: "json",
  }), { what: `study ids ${fips}` });

  const isoOf = (fc) => {
    const ms = fc && fc.features && fc.features[0] && fc.features[0].attributes.EFF_DATE;
    return typeof ms === "number" ? new Date(ms).toISOString().slice(0, 10) : null;
  };
  return {
    nfhlEffectiveDate: isoOf(newest),
    nfhlEffectiveDateOldestPanel: isoOf(oldest),
    dfirmIds: [...new Set(((ids && ids.features) || []).map((f) => f.attributes.DFIRM_ID))].sort(),
  };
}

/* Page the whole county out of layer 28 as GeoJSON.
 *
 * ⛔ `orderByFields=OBJECTID` IS LOAD-BEARING, NOT TIDINESS. `resultOffset` paging over an
 * UNORDERED result set is undefined: the service may return a row twice and skip another, and
 * the totals still look plausible. The count check below is the guard that would catch it. */
async function fetchZones(fips) {
  const where = `DFIRM_ID LIKE '${fips}%'`;
  const countBody = await getJson(q(ZONE_LAYER, { where, returnCountOnly: "true", f: "json" }),
    { what: `zone count ${fips}` });
  const expected = countBody.count;
  log(`    ${expected.toLocaleString()} flood-hazard polygons published for ${fips}`);

  const pageUrl = (offset, count) => q(ZONE_LAYER, {
    where,
    outFields: ["OBJECTID", ...FLOOD_TILE_FIELDS].join(","),
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: String(GEOM_PRECISION),
    orderByFields: "OBJECTID",
    resultOffset: String(offset),
    resultRecordCount: String(count),
    f: "geojson",
  });

  const features = [];
  const seen = new Set();
  let window = PAGE;
  let offset = 0;
  while (offset < expected) {
    let page = null;
    // Shrink-on-failure. Each attempt retries the SAME offset with a smaller window, so no row
    // can be skipped; only once the window is at the floor does a failure become fatal.
    for (let w = window; ; w = Math.max(PAGE_MIN, Math.floor(w / 2))) {
      const atFloor = w <= PAGE_MIN;
      try {
        page = await getJson(pageUrl(offset, w), {
          what: `zones ${fips} @${offset} ×${w}`,
          tries: atFloor ? 4 : 1,
        });
        window = w;
        break;
      } catch (err) {
        if (atFloor) throw err;
        log(`    ~ ${w} rows @${offset} failed (${err.message}); halving the page`);
      }
    }
    const got = (page && page.features) || [];
    for (const f of got) {
      const id = f.properties && f.properties.OBJECTID;
      if (id != null && seen.has(id)) continue; // paging overlap — see the note above
      if (id != null) seen.add(id);
      features.push(f);
    }
    process.stdout.write(`    fetched ${features.length}/${expected}\r`);
    if (!got.length) break;
    offset += got.length;
    // Grow back toward the full page once the dense stretch is behind us, so one hard county
    // does not force every later page to crawl.
    if (got.length === window) window = Math.min(PAGE, window * 2);
  }
  process.stdout.write("\n");
  if (features.length !== expected) {
    // Not fatal on its own (FEMA can publish a row between the count and the last page), but
    // it must never pass unremarked — a short archive is exactly the silent hole this whole
    // design is trying not to introduce.
    log(`    ! paging returned ${features.length} of ${expected} — investigate before shipping`);
  }
  return { features, expected };
}

/* ------------------------------------------------------------------ shaping */

/* NFHL → the four attributes the identify card reads, with unshaded Zone X dropped.
 * The keep/drop decision runs through `resolveFloodZone` — the SAME classifier the app uses
 * at runtime — so the archive's contents and the app's understanding of them cannot drift. */
function shape(features) {
  const kept = [];
  const droppedBy = {};
  for (const f of features) {
    const p = (f && f.properties) || {};
    const resolved = resolveFloodZone(p);
    if (!resolved || !keepInTiles(resolved)) {
      const k = (resolved && resolved.variant) || "unclassified";
      droppedBy[k] = (droppedBy[k] || 0) + 1;
      continue;
    }
    const props = {
      FLD_ZONE: p.FLD_ZONE == null ? null : String(p.FLD_ZONE),
      ZONE_SUBTY: p.ZONE_SUBTY == null || p.ZONE_SUBTY === "" ? null : String(p.ZONE_SUBTY),
      SFHA_TF: p.SFHA_TF == null ? null : String(p.SFHA_TF),
      // NFHL uses -9999 as "not applicable". Carrying that sentinel into a tile invites a
      // readout to print it as an elevation, so it becomes an honest absent value here.
      STATIC_BFE: typeof p.STATIC_BFE === "number" && p.STATIC_BFE > -9998 ? p.STATIC_BFE : null,
    };
    for (const k of Object.keys(props)) if (props[k] == null) delete props[k];
    kept.push({ type: "Feature", properties: props, geometry: f.geometry });
  }
  return { kept, droppedBy };
}

/* ------------------------------------------------------------------ tiling */

function requireTippecanoe() {
  const r = spawnSync("tippecanoe", ["--version"], { encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.error || !/tippecanoe/i.test(out)) {
    console.error(
      "tippecanoe is not on PATH.\n" +
      "  Debian/Ubuntu: apt-get install -y tippecanoe\n" +
      "  macOS:         brew install tippecanoe\n" +
      "Version 2.x or newer is required (PMTiles output)."
    );
    process.exit(2);
  }
  const major = Number((/v?(\d+)\./.exec(out) || [])[1] || 0);
  if (major < 2) {
    console.error(`tippecanoe ${out} is too old — 2.x is required for PMTiles output.`);
    process.exit(2);
  }
  return out;
}

function tile(ndjsonPath, outPath) {
  /* ⛔ `--no-feature-limit` / `--no-tile-size-limit` ARE DELIBERATE AND MUST STAY.
   * Tippecanoe's defaults DROP features out of dense tiles to stay under 500 KB. For a
   * point-cloud that is a reasonable trade; for a regulatory flood map it means a floodplain
   * silently disappears at one zoom in one place, which is the single worst thing this layer
   * could do. So nothing is ever dropped, and the resulting size is MEASURED and reported
   * against the Pages cap instead. Simplification (the default Douglas-Peucker at zooms below
   * the max) stays on — that is generalisation of a shape, not removal of a feature, and it is
   * exactly what makes a tile a picture rather than a number.
   * `--detect-shared-borders` keeps adjacent polygons simplifying identically, so a
   * generalised county map does not develop hairline gaps between neighbouring zones. */
  const argv = [
    "-o", outPath, "-f", "-q",
    "-l", FLOOD_TILE_LAYER_NAME,
    "-Z", String(FLOOD_TILE_MIN_ZOOM),
    "-z", String(FLOOD_TILE_MAX_ZOOM),
    "--no-feature-limit",
    "--no-tile-size-limit",
    "--detect-shared-borders",
    ndjsonPath,
  ];
  const r = spawnSync("tippecanoe", argv, { encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`tippecanoe exited ${r.status}`);
}

/* ------------------------------------------------------------------ main */

async function buildCounty(key, tippecanoeVersion) {
  const cfg = FLOOD_TILE_COUNTIES[key];
  if (!cfg) throw new Error(`${key} is not in FLOOD_TILE_COUNTIES — add it there first`);
  const archive = floodArchiveName(key);
  log(`\n▶ ${cfg.label}  (${key} · FIPS ${cfg.fips}) → ${archive}`);

  const vintage = await fetchVintage(cfg.fips);
  log(`    NFHL effective ${vintage.nfhlEffectiveDate || "unknown"}` +
      `${vintage.nfhlEffectiveDateOldestPanel && vintage.nfhlEffectiveDateOldestPanel !== vintage.nfhlEffectiveDate
        ? ` (oldest panel ${vintage.nfhlEffectiveDateOldestPanel})` : ""}` +
      `  ·  study ${vintage.dfirmIds.join(", ") || "unknown"}`);

  const { features, expected } = await fetchZones(cfg.fips);
  const { kept, droppedBy } = shape(features);
  const droppedTotal = features.length - kept.length;
  log(`    kept ${kept.length.toLocaleString()} · dropped ${droppedTotal.toLocaleString()} ` +
      `(${Object.entries(droppedBy).map(([k, n]) => `${k}:${n}`).join(", ") || "none"})`);

  if (DRY) return { key, cfg, vintage, expected, fetched: features.length, kept: kept.length, droppedBy, bytes: null };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flood-tiles-"));
  const ndjson = path.join(tmp, `${key}.geojsonl`);
  fs.writeFileSync(ndjson, kept.map((f) => JSON.stringify(f)).join("\n") + "\n");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, archive);
  tile(ndjson, outPath);
  fs.rmSync(tmp, { recursive: true, force: true });

  const bytes = fs.statSync(outPath).size;
  const pct = ((bytes / MAX_BYTES) * 100).toFixed(1);
  log(`    ✔ ${archive} — ${mib(bytes)} (${bytes.toLocaleString()} bytes) = ${pct}% of the 25 MiB Pages cap`);

  return {
    key, cfg, vintage, expected, fetched: features.length, kept: kept.length, droppedBy, bytes,
    tippecanoeVersion,
  };
}

function writeManifest(results) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let prev = { counties: {} };
  try { prev = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch (_) { /* first run */ }
  const counties = { ...(prev.counties || {}) };
  const builtAt = new Date().toISOString();
  for (const r of results) {
    if (r.bytes == null) continue; // --dry-run records nothing
    counties[r.key] = {
      label: r.cfg.label,
      state: r.cfg.state,
      fips: r.cfg.fips,
      archive: floodArchiveName(r.key),
      bytes: r.bytes,
      nfhlEffectiveDate: r.vintage.nfhlEffectiveDate,
      nfhlEffectiveDateOldestPanel: r.vintage.nfhlEffectiveDateOldestPanel,
      dfirmIds: r.vintage.dfirmIds,
      featuresPublished: r.expected,
      featuresFetched: r.fetched,
      featuresKept: r.kept,
      droppedByVariant: r.droppedBy,
      minZoom: FLOOD_TILE_MIN_ZOOM,
      maxZoom: FLOOD_TILE_MAX_ZOOM,
      builtAt,
    };
  }
  const manifest = {
    generatedAt: builtAt,
    source: {
      service: NFHL,
      layerId: ZONE_LAYER,
      layerName: "Flood Hazard Zones (S_Fld_Haz_Ar)",
      panelLayerId: PANEL_LAYER,
      provider: "FEMA (National Flood Hazard Layer)",
    },
    fields: FLOOD_TILE_FIELDS,
    dropRule: TILE_DROP_RULE,
    tilePyramid: { minZoom: FLOOD_TILE_MIN_ZOOM, maxZoom: FLOOD_TILE_MAX_ZOOM, overzoomBeyondMax: true },
    builtWith: results.find((r) => r.tippecanoeVersion)?.tippecanoeVersion || prev.builtWith || null,
    counties,
  };
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`\n  manifest → public/flood/manifest.json (${Object.keys(counties).length} counties)`);
}

async function main() {
  if (!wanted.length) {
    console.error("Usage: node scripts/build-flood-tiles.mjs <county-key…> | --all [--dry-run]");
    console.error(`Known counties: ${Object.keys(FLOOD_TILE_COUNTIES).join(", ")}`);
    process.exit(1);
  }
  const version = DRY ? null : requireTippecanoe();
  if (version) log(`Using ${version}`);

  const results = [];
  for (const key of wanted) results.push(await buildCounty(key, version));
  if (!DRY) writeManifest(results);

  log("\n── SIZE AGAINST THE 25 MiB CLOUDFLARE PAGES CAP ──");
  let over = 0;
  for (const r of results) {
    if (r.bytes == null) { log(`  ${r.key.padEnd(12)} (dry run — not built)`); continue; }
    const ok = r.bytes <= MAX_BYTES;
    if (!ok) over++;
    log(`  ${ok ? "✔" : "✘"} ${r.key.padEnd(12)} ${mib(r.bytes).padStart(10)}  ` +
        `${((r.bytes / MAX_BYTES) * 100).toFixed(1)}% of cap  ·  ${r.kept.toLocaleString()} polygons`);
  }
  if (over) {
    console.error(
      `\n${over} county archive(s) EXCEED the 25 MiB per-file cap. Do NOT work around this silently.\n` +
      "The two fallbacks are a product decision:\n" +
      "  (a) split the county by watershed into several archives, or\n" +
      "  (b) drop the max zoom to 12 and lean harder on client overzoom.\n" +
      "Report the number and let the owner choose."
    );
    process.exit(3);
  }
}

main().catch((err) => { console.error(`\nBuild failed: ${err.stack || err.message}`); process.exit(1); });
