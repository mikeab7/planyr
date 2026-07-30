#!/usr/bin/env node
/* NEW-1 — build the wide-zoom political-boundary asset from Natural Earth.
 *
 * WHY THIS IS A BUILD-TIME SCRIPT AND ITS OUTPUT IS COMMITTED. The boundary geometry is
 * PUBLIC-DOMAIN reference data that changes about once a decade, and the app must build
 * with no network at all. So this script is run BY HAND when the source data is refreshed,
 * and `public/geo/admin-boundaries.json` — its output — is what ships. Nothing in the
 * normal build, test or CI path runs this file or reaches the network.
 *
 * WHY IT WRITES INTO public/ RATHER THAN src/. The Site route's JS budget
 * (ui-audit/perf-budgets.json) is nearly exhausted — 1.1 KB of headroom on
 * siteRouteJsBytes and 5.8 KB on totalJsBytes when this landed. A JSON module under src/
 * would be bundled as JavaScript and charged against both. A public/ asset is not JS at
 * all: it costs ZERO against every bundle budget, and it is only ever requested when the
 * user actually zooms out past the gate (see lib/adminBoundaryGate.js). A Texas user
 * working at site scale downloads none of it.
 *
 * SOURCE — Natural Earth 1:110m, public domain, no attribution required:
 *   admin-0 countries          ne_110m_admin_0_countries.geojson        (177 features)
 *   admin-1 states / provinces ne_110m_admin_1_states_provinces.geojson  (51 features)
 *
 * ⚠ SCOPE FINDING, recorded because it is easy to assume otherwise: Natural Earth's
 * 1:110m admin-1 layer contains the 50 US states + DC and NOTHING ELSE — no Canadian
 * provinces, no Mexican states. Canada and Mexico therefore read at the COUNTRY level
 * here, which is what they are for: orientation at continental zoom. Provinces would
 * need the 1:50m layer (2.3 MB source, 13 Canadian features) and Mexican states only
 * exist at 1:10m (~25 MB source). Both were judged out of scope against a budget this
 * tight; revisit deliberately, never by accident.
 *
 * WHAT THE SIMPLIFICATION DOES, and why it is safe. These lines are only ever drawn at
 * zoom 7 and below, where one screen pixel spans roughly 1.2 km or more. So:
 *   - Douglas–Peucker at a tolerance of a couple of pixels at the tightest gate zoom,
 *   - rings whose bounding box could not span a pixel are dropped entirely (islets),
 *   - coordinates quantised to 1/1000° (~110 m — sub-pixel at zoom 7),
 *   - every attribute discarded except the level; these are outlines, not data.
 *
 * AND THEN THE BYTES ARE ENCODED, which is where most of the saving actually comes from.
 * Plain GeoJSON spends ~17 characters per point repeating "-95.123,29.456". This writes
 * each ring as a flat array of DELTA integers in thousandths of a degree — first point
 * absolute, every later one relative to its predecessor — so a typical vertex costs 3-6
 * characters instead of 17. That is a lossless re-encoding of the SAME simplified
 * geometry: it buys ~3x with no further shape loss, which is a better trade than
 * simplifying three times as hard. Decoding is ten lines, and it lives in the
 * lazily-loaded layer module, never on the boot path.
 *
 *   node scripts/build-admin-boundaries.mjs                 # rebuild from the vendored source
 *   node scripts/build-admin-boundaries.mjs --fetch         # re-download the source first
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC_DIR = join(ROOT, "scripts", "data");
const OUT = join(ROOT, "public", "geo", "admin-boundaries.json");

const NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const SOURCES = {
  country: { file: "ne_110m_admin_0_countries.geojson", url: `${NE_BASE}/ne_110m_admin_0_countries.geojson` },
  admin1: { file: "ne_110m_admin_1_states_provinces.geojson", url: `${NE_BASE}/ne_110m_admin_1_states_provinces.geojson` },
};

/* Tolerances in degrees. At zoom 7 a pixel is ~0.0086° of longitude at 40°N, so 0.025°
 * is about three pixels of allowed deviation at the very tightest zoom this layer ever
 * paints — invisible on a hairline drawn over aerial imagery. Rings smaller than
 * MIN_RING_DEG on both axes cannot resolve at all. SCALE is the quantisation: 1000
 * units per degree, i.e. 3 decimal places. */
const TOLERANCE_DEG = 0.025;
const MIN_RING_DEG = 0.09;
const SCALE = 1000;

/* ---- geometry helpers (pure) ------------------------------------------------------- */

/* Perpendicular distance from p to the segment ab, in degrees. Planar on lat/lng, which
 * is the right call here: the output is consumed by a Web-Mercator renderer and the
 * tolerance is generous enough that the latitude distortion cannot matter. */
function perpDist(p, a, b) {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/* Iterative Douglas–Peucker. Iterative rather than recursive so a pathological ring
 * (Antarctica's coastline is 4000+ points) cannot blow the stack. */
function simplify(points, tol) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let far = -1, best = tol;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(points[i], points[lo], points[hi]);
      if (d > best) { best = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([lo, far], [far, hi]); }
  }
  return points.filter((_, i) => keep[i]);
}

const spans = (ring) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return Math.max(maxX - minX, maxY - minY);
};

/* Quantise to integer thousandths of a degree, then drop consecutive duplicates left
 * behind by the rounding — they cost bytes and draw nothing. */
const quantise = (ring) => ring.map(([x, y]) => [Math.round(x * SCALE), Math.round(y * SCALE)]);
const dedupe = (ring) => ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);

/* [[x,y],…] → [x0, y0, dx1, dy1, dx2, dy2, …] in quantised units. The decoder in
 * lib/adminBoundaryLayer.js is the exact inverse; change one and you change both. */
function encodeRing(ring) {
  const out = [ring[0][0], ring[0][1]];
  for (let i = 1; i < ring.length; i++) { out.push(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]); }
  return out;
}

/* A polygon's OUTER ring only. Holes are enclaves (Lesotho, the Vatican) — at this scale
 * they are a few pixels and their absence reads as nothing, while keeping them roughly
 * doubles the ring count for the two dozen countries that have them. */
function outerRings(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return geom.coordinates.slice(0, 1);
  if (geom.type === "MultiPolygon") return geom.coordinates.map((poly) => poly[0]);
  return [];
}

/* ---- build -------------------------------------------------------------------------- */

async function ensureSource(spec) {
  const path = join(SRC_DIR, spec.file);
  if (existsSync(path) && !process.argv.includes("--fetch")) return path;
  mkdirSync(SRC_DIR, { recursive: true });
  process.stdout.write(`  fetching ${spec.file} … `);
  const res = await fetch(spec.url);
  if (!res.ok) throw new Error(`${spec.url} → HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(path, text);
  console.log(`${(text.length / 1024).toFixed(0)} KB`);
  return path;
}

function buildLevel(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const lines = [];
  let inPts = 0, outPts = 0, dropped = 0;
  for (const f of raw.features) {
    for (const ring of outerRings(f.geometry)) {
      inPts += ring.length;
      if (spans(ring) < MIN_RING_DEG) { dropped++; continue; }
      const out = dedupe(quantise(simplify(ring, TOLERANCE_DEG)));
      if (out.length < 3) { dropped++; continue; }
      outPts += out.length;
      lines.push(encodeRing(out));
    }
  }
  return { lines, inPts, outPts, dropped };
}

console.log("Building the wide-zoom admin-boundary asset (NEW-1)\n");
const out = { format: "planyr-admin-boundaries-v1", source: "Natural Earth 1:110m (public domain)", scale: SCALE, levels: {} };
for (const [level, spec] of Object.entries(SOURCES)) {
  const path = await ensureSource(spec);
  const { lines, inPts, outPts, dropped } = buildLevel(path);
  out.levels[level] = lines;
  console.log(`  ${level.padEnd(8)} ${String(lines.length).padStart(4)} rings · ${inPts} → ${outPts} points · ${dropped} ring(s) too small to resolve`);
}

mkdirSync(dirname(OUT), { recursive: true });
/* Emitted WITHOUT pretty-printing: whitespace here is pure download weight. */
writeFileSync(OUT, JSON.stringify(out));
const bytes = readFileSync(OUT).length;
console.log(`\n  → public/geo/admin-boundaries.json  ${(bytes / 1024).toFixed(1)} KB (uncompressed; the edge serves it gzipped)`);
console.log("  This asset is NOT JavaScript — it is charged against no bundle budget, and is fetched\n  only when the map crosses below the zoom gate.");
