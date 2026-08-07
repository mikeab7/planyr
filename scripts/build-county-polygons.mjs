#!/usr/bin/env node
/* B209502 — build the county-boundary asset that lets the app route a point to its county by
 * GEOMETRY instead of by bounding box.
 *
 * WHY THIS EXISTS. `candidateCountiesForPoint` / `countyForView` decided which county a click
 * or a view was in by testing the point against each county's padded BOUNDING BOX. A bounding
 * box is a rectangle and a county is not, so Harris County's rectangle swallows Pearland
 * (Brazoria) whole — reported not as a near-miss but as a definite, unambiguous match. Measured
 * on the owner's six new Houston-area sites, four of six resolved to the wrong county, and a
 * wrong county selects the drainage authority, the detention criteria, the setbacks and the
 * review path. The bboxes stay as a cheap PRE-FILTER; they may never again decide the answer.
 *
 * WHY A BUILD-TIME SCRIPT WITH A COMMITTED OUTPUT — the same contract as
 * `build-admin-boundaries.mjs`, for the same reasons. County lines change essentially never,
 * the app must build with no network at all, and nothing in the normal build / test / CI path
 * runs this file or reaches the network. Run it by hand when the source data is refreshed.
 *
 * WHY public/ RATHER THAN src/. A JSON module under src/ is bundled as JavaScript and charged
 * against the Site route's JS budget, which has kilobytes of headroom, not tens. A public/
 * asset is not JS at all: it costs ZERO against every bundle budget and is fetched only when
 * a county actually has to be resolved.
 *
 * WHY EVERY COUNTY IN BOTH STATES, not just the configured ones. The second half of the fix is
 * that a county with no configured parcel source must be NAMED correctly and reported as having
 * no parcel data — never silently swapped for a neighbour. That is only possible if the resolver
 * knows the name of every county it might land in, including the ones Planyr has no CAD for.
 *
 * PRECISION — MEASURED, not chosen by feel. A county line is mostly long straight survey calls
 * plus river meanders, and the meanders are what cost bytes. Four settings were built and each
 * was scored against the LIVE authoritative layer rather than eyeballed:
 *
 *   tolerance   quantisation   size      agreement with the live county layer
 *   0.0002°     1/5000°        612 KB    —
 *   0.0005°     1/4000°        374 KB    —
 *   0.001°      1/2000° (~55m) 238 KB    114/114 random Houston-metro points · 107/108 points
 *                                        deliberately sampled 300–800 m off a county line
 *
 * The shipped setting is the last one. Its single boundary-adjacent miss (30.1521, -95.5153 —
 * Montgomery, resolved Harris) SELF-REPORTED `nearEdge: true`, which is exactly the contract:
 * inside roughly 150 m of a line the resolver says so and the caller defers to the live identify.
 * All six of the owner's test sites resolve correctly and none is near an edge.
 *
 * The authoritative network identify (`jurisdiction.countyAtPoint`) is still what a real site
 * uses — this is the network-free floor beneath it, and the floor has to hold when every GIS
 * endpoint is down, which is exactly when a site falls through to a default.
 *
 * ENCODING is `build-admin-boundaries.mjs`'s, unchanged: each ring is a flat array of DELTA
 * integers in quantised units, first point absolute and every later one relative to its
 * predecessor, so a vertex costs a few characters instead of seventeen. Lossless re-encoding of
 * the same simplified geometry. The decoder is ten lines and lives in `countyPolygons.js`.
 *
 *   node scripts/build-county-polygons.mjs           # rebuild from the vendored source
 *   node scripts/build-county-polygons.mjs --fetch   # re-download the source geometry first
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC_DIR = join(ROOT, "scripts", "data");
const OUT = join(ROOT, "public", "geo", "county-polygons.json");

/* The two authoritative boundary services — the SAME rows the GIS registry already ships as
 * `county` / `countyCo`, which the owner's audit confirmed answered correctly at all six test
 * points. Using the registry's own sources is the point: the resolver and the live identify
 * must not be able to disagree about where a county line is. */
const SOURCES = {
  TX: {
    file: "tx-counties.geojson",
    url: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/Texas_County_Boundaries/FeatureServer/0",
    nameField: "CNTY_NM",
    fipsField: "FIPS_ST_CNTY_CD",
  },
  CO: {
    file: "co-counties.geojson",
    url: "https://services2.arcgis.com/fnCPHPvll1r80nFV/arcgis/rest/services/Colorado_Counties/FeatureServer/127",
    nameField: "NAME20",
    fipsField: "GEOID20",
  },
};

const SCALE = 2000;        // quantisation
const TOLERANCE_DEG = 0.001; // Douglas–Peucker
const MIN_RING_DEG = 0.002; // drop rings whose bbox is smaller than ~200 m (offshore islets)

// ---------------------------------------------------------------------------
// Source fetch — paged, because these layers exceed maxRecordCount.
// ---------------------------------------------------------------------------
async function fetchLayer(url) {
  const meta = await (await fetch(url + "?f=json")).json();
  const page = Math.min(meta.maxRecordCount || 1000, 1000);
  const feats = [];
  for (let offset = 0; ; offset += page) {
    const p = new URLSearchParams({
      f: "geojson", where: "1=1", outFields: "*", returnGeometry: "true",
      outSR: "4326", resultOffset: String(offset), resultRecordCount: String(page),
    });
    const j = await (await fetch(url + "/query?" + p)).json();
    if (j.error) throw new Error(j.error.message);
    const got = j.features || [];
    feats.push(...got);
    process.stdout.write(`\r    fetched ${feats.length}…`);
    if (got.length < page || !j.properties?.exceededTransferLimit) {
      if (got.length < page) break;
    }
    if (got.length === 0) break;
  }
  process.stdout.write("\n");
  return { type: "FeatureCollection", features: feats };
}

// ---------------------------------------------------------------------------
// Geometry helpers (identical in spirit to build-admin-boundaries.mjs)
// ---------------------------------------------------------------------------
function simplify(ring, tol) {
  if (ring.length <= 3) return ring;
  const sqTol = tol * tol;
  const sqSegDist = ([px, py], [x1, y1], [x2, y2]) => {
    let x = x1, y = y1, dx = x2 - x, dy = y2 - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = x2; y = y2; } else if (t > 0) { x += dx * t; y += dy * t; }
    }
    return (px - x) ** 2 + (py - y) ** 2;
  };
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxSq = sqTol, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const sq = sqSegDist(ring[i], ring[first], ring[last]);
      if (sq > maxSq) { maxSq = sq; idx = i; }
    }
    if (idx > 0) { keep[idx] = 1; stack.push([first, idx], [idx, last]); }
  }
  return ring.filter((_, i) => keep[i]);
}

const ringBBox = (ring) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of ring) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  return [a, b, c, d];
};

const quantise = (ring) => ring.map(([x, y]) => [Math.round(x * SCALE), Math.round(y * SCALE)]);

/* Drop consecutive duplicates the rounding left behind — they cost bytes and change nothing. */
const dedupe = (ring) => ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);

/* [[x,y],…] → [x0, y0, dx1, dy1, …] in quantised units. Decoder: lib/countyPolygons.js. */
function encodeRing(ring) {
  const out = [ring[0][0], ring[0][1]];
  for (let i = 1; i < ring.length; i++) {
    out.push(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  }
  return out;
}

/* Every OUTER ring of a (Multi)Polygon. Holes are deliberately discarded: no Texas or Colorado
 * county is a donut around another county, so a hole here would only ever be a data artefact,
 * and keeping them would make the point-in-polygon test answer "no county" inside one. */
function outerRings(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return geom.coordinates.slice(0, 1);
  if (geom.type === "MultiPolygon") return geom.coordinates.map((poly) => poly[0]);
  return [];
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
const wantFetch = process.argv.includes("--fetch");
if (!existsSync(SRC_DIR)) mkdirSync(SRC_DIR, { recursive: true });

const counties = [];
let rawPoints = 0, keptPoints = 0;

for (const [state, cfg] of Object.entries(SOURCES)) {
  const path = join(SRC_DIR, cfg.file);
  if (wantFetch || !existsSync(path)) {
    console.log(`  ${state}: fetching ${cfg.url}`);
    writeFileSync(path, JSON.stringify(await fetchLayer(cfg.url)));
  }
  const fc = JSON.parse(readFileSync(path, "utf8"));
  console.log(`  ${state}: ${fc.features.length} features`);

  for (const f of fc.features) {
    const props = f.properties || {};
    const name = String(props[cfg.nameField] || "").trim();
    if (!name) continue;
    const fips = String(props[cfg.fipsField] || "").trim();
    const rings = [];
    for (const ring of outerRings(f.geometry)) {
      rawPoints += ring.length;
      const [x0, y0, x1, y1] = ringBBox(ring);
      if (x1 - x0 < MIN_RING_DEG && y1 - y0 < MIN_RING_DEG) continue;
      const out = dedupe(quantise(simplify(ring, TOLERANCE_DEG)));
      if (out.length < 4) continue;
      keptPoints += out.length;
      rings.push(encodeRing(out));
    }
    if (!rings.length) continue;
    // The whole-county bbox in quantised units — the resolver's own cheap pre-filter, so a
    // point only pays for a ring walk in the handful of counties whose box could contain it.
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const ring of outerRings(f.geometry)) for (const [x, y] of ring) {
      if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y;
    }
    counties.push({
      state, name, fips,
      bbox: [a, b, c, d].map((n) => Math.round(n * SCALE)),
      rings,
    });
  }
}

counties.sort((p, q) => (p.state === q.state ? p.name.localeCompare(q.name) : p.state.localeCompare(q.state)));

const payload = {
  format: "county-polygons/1",
  scale: SCALE,
  note: "Outer rings only, delta-encoded in 1/scale degrees. Built by scripts/build-county-polygons.mjs.",
  sources: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.url])),
  builtFrom: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, v.file])),
  counties,
};

if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
const text = JSON.stringify(payload);
writeFileSync(OUT, text);
console.log(`\n  ${counties.length} counties · ${rawPoints} source points → ${keptPoints} kept`);
console.log(`  → public/geo/county-polygons.json  ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB (uncompressed; the edge serves it gzipped)`);
