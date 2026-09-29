#!/usr/bin/env node
/* NEW-2 (2026-09-29) — build the map finder's city/town NAME asset: public/geo/place-names.json.
 *
 * WHY OUR OWN DATASET RATHER THAN ESRI Reference/World_Boundaries_and_Places TILES (decision
 * recorded here so it is not re-litigated): that service is a raster that ALSO draws its own
 * dashed state/country boundary lines and its own admin-area names, so it would double up with
 * the state outlines of NEW-1 (adminBoundaryLayer) and we could neither thin its density nor
 * restyle it. A point list rendered by our own canvas layer (lib/placeNamesLayer.js) gives
 * control over density, halo weight and the zoom at which labels step back from site work.
 *
 * SOURCES (both public):
 *   1. Natural Earth 1:10m populated places (simple), public domain — worldwide, ~7,300
 *      places, each carrying NE's own cartographic `min_zoom` (the web-map zoom at which the
 *      place earns a label). Houston 3, Baytown 7, Conroe 6.7, … This is the backbone.
 *   2. kelvins/US-Cities-Database us_cities.csv — ~29,800 US places with NO population.
 *      NE lacks Katy, Sugar Land, Pearland, Brookshire, so these fill in the small-town tier.
 *      A US place is added only if NE has no same-named place within ~0.25°. With no
 *      population to rank by, the tier is a heuristic: a name listed under TWO OR MORE
 *      counties (larger places straddle county lines — Katy does) appears from zoom 9,
 *      everything else from zoom 10. Label collision at draw time (placeNamesLayer) does
 *      the rest, so a dense metro shows the earlier-tier names first.
 * Output: {format, scale:1000, places:[[name, lat*1000, lng*1000, minZoom*10], …]}, sorted
 * by minZoom then name so the draw-time priority is stable.
 *
 *   node scripts/build-place-names.mjs [--fetch]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "scripts", "data");
const OUT = join(ROOT, "public", "geo", "place-names.json");
const OUT_TOWNS = join(ROOT, "public", "geo", "place-names-towns.json");
const SOURCES = {
  "ne_10m_populated_places_simple.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson",
  "us_cities.csv": "https://raw.githubusercontent.com/kelvins/US-Cities-Database/main/csv/us_cities.csv",
};
async function load(f) {
  const p = join(SRC, f);
  if (!existsSync(p) || process.argv.includes("--fetch")) {
    mkdirSync(SRC, { recursive: true });
    const r = await fetch(SOURCES[f]);
    if (!r.ok) throw new Error(`${f} → HTTP ${r.status}`);
    writeFileSync(p, await r.text());
  }
  return readFileSync(p, "utf8");
}
/* Minimal RFC-4180 line parser (the CSV quotes county names containing commas). */
function csvRow(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out;
}

const ne = JSON.parse(await load("ne_10m_populated_places_simple.geojson"));
const places = [];
const neUs = [];
for (const f of ne.features) {
  const p = f.properties; const name = p.name;
  if (!name || typeof p.latitude !== "number") continue;
  const mz = Math.max(2, Math.min(12, typeof p.min_zoom === "number" ? p.min_zoom : 8));
  places.push([name, p.latitude, p.longitude, mz]);
  if (p.adm0_a3 === "USA") neUs.push([name.toLowerCase(), p.latitude, p.longitude]);
}
const rows = (await load("us_cities.csv")).split(/\r?\n/).slice(1).filter(Boolean).map(csvRow);
const byKey = new Map(); // name|state → [{lat,lng,county}]
for (const [, st, , city, county, lat, lng] of rows) {
  const k = `${city}|${st}`;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push({ lat: +lat, lng: +lng, county });
}
let added = 0;
const towns = [];
for (const [k, list] of byKey) {
  const name = k.split("|")[0];
  const lower = name.toLowerCase();
  const first = list[0];
  if (neUs.some(([n, la, lo]) => n === lower && Math.abs(la - first.lat) < 0.25 && Math.abs(lo - first.lng) < 0.25)) continue;
  const counties = new Set(list.map((x) => x.county)).size;
  towns.push([name, first.lat, first.lng, counties >= 2 ? 9 : 10]);
  added++;
}
const enc = (arr) => arr.sort((a, b) => a[3] - b[3] || a[0].localeCompare(b[0]))
  .map(([n, la, lo, mz]) => [n, Math.round(la * 1000), Math.round(lo * 1000), Math.round(mz * 10)]);
const meta = (what) => ({
  format: "planyr-place-names-v1",
  source: `${what}; Natural Earth 1:10m populated places (public domain) + kelvins/US-Cities-Database us_cities.csv (MIT); fetched 2026-09-29`,
  scale: 1000,
});
/* Two files so the ~1 MB small-town tier is fetched only once the map is at a zoom where it can
 * show (>= 9); the ~300 KB backbone loads first, and only when the layer is on and in band. */
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ ...meta("backbone: NE places, worldwide"), places: enc(places) }));
writeFileSync(OUT_TOWNS, JSON.stringify({ ...meta("US small towns not in NE"), places: enc(towns) }));
const kb = (f) => (readFileSync(f).length / 1024).toFixed(0);
console.log(`${places.length} NE places (${kb(OUT)} KB) + ${towns.length} US small towns (${kb(OUT_TOWNS)} KB)`);
