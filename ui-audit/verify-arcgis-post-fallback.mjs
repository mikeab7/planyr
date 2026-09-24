/* B1871968 (2026-09-24) — proves the GET→POST fallback fix through the SHIPPED code
 * (`analyzeSource` → `queryLayer`/`queryProximity` → `fetchArcgisJson`), against the REAL
 * production ArcGIS Online endpoints, not a curl reimplementation or a mocked fetch.
 *
 * THE BUG: Site Analysis read growthFaults / transmission / substations / epaCleanups /
 * aadt / rail / ccnWater as "unavailable" on a large multi-parcel site (Goose Creek: 4
 * parcels, 289 acres). All seven are hosted on services*.arcgis.com, which 404s a GET
 * /query once its URL passes its own web-server length cap — measured live from this
 * session at 200 OK/2105 chars, 404/2153 chars against the real growthFaults endpoint.
 * `GIS_MAX_GET_URL` (gisFetch.js) gated the existing GET→POST switch at 3500, comfortably
 * ABOVE that real failure point, so any query landing in the 2000–3500 gap — which a real
 * multi-parcel assemblage reaches easily even after `simplifyRing`'s 60-vertex decimation —
 * rode out as a 404ing GET. Fixed by lowering the threshold to 2000.
 *
 * Same shape as `verify-ga-county-batch-20260923.mjs`: this proves the MECHANISM (the real
 * shipped query path resolves cleanly against the real hosts for a large geometry), not
 * that the Site Analysis TAB itself renders the result on planyr.io — that needs a real
 * signed-in load of an actual large multi-parcel site, parked as `Verify: live` /
 * `Blocker: real-data`.
 *
 * Run:  node ui-audit/verify-arcgis-post-fallback.mjs
 */
import { ANALYSIS_SOURCES, analyzeSource, buildProximityParams, buildQueryUrl } from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { fetchArcgisJson, GIS_MAX_GET_URL } from "../src/workspaces/site-planner/lib/gisFetch.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";

const fails = [];
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails.push(msg); };

function makeStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k), get length() { return map.size; }, key: (i) => Array.from(map.keys())[i] ?? null };
}
const freshCache = () => createGisCache({ store: makeStore(), now: Date.now });

// A real-scale, dense multi-parcel assemblage: 4 rings near Baytown/Goose Creek, TX, each
// carrying real vertex density (post-`simplifyRing`-decimation shape, not a toy square).
function denseRing(nVerts, cx, cy, r) {
  const pts = [];
  for (let i = 0; i < nVerts; i++) {
    const a = (i / nVerts) * Math.PI * 2;
    const rr = r * (1 + 0.15 * Math.sin(i * 7));
    pts.push([+(cx + rr * Math.cos(a)).toFixed(6), +(cy + rr * Math.sin(a)).toFixed(6)]);
  }
  pts.push(pts[0]);
  return pts;
}
// Deliberately sized so the built GET /query URL lands in the 2000–3500 "danger gap": too
// long for real ArcGIS Online (measured 404 past ~2150 chars) but short enough that the OLD
// GIS_MAX_GET_URL=3500 let it ride out as a GET anyway. Verified below (see the mutation
// check note) that this geometry genuinely exercises that gap for every affected source.
const gooseCreekScaleRings = [
  denseRing(15, -95.0026, 29.8122, 0.006),
  denseRing(15, -94.998, 29.815, 0.004),
  denseRing(15, -95.006, 29.809, 0.0035),
  denseRing(15, -95.001, 29.806, 0.003),
];

const AFFECTED = ["growthFaults", "transmission", "substations", "epaCleanups", "aadt", "rail", "ccnWater"];

console.log("--- B1871968 · ArcGIS GET→POST fallback, live against real production endpoints ---\n");
console.log(`GIS_MAX_GET_URL = ${GIS_MAX_GET_URL} (was 3500)\n`);

for (const id of AFFECTED) {
  const source = ANALYSIS_SOURCES.find((s) => s.id === id);
  if (!source) { ok(false, `${id}: not found in ANALYSIS_SOURCES`); continue; }
  // Precondition (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 shape): prove the fixture is genuinely
  // in the danger gap before trusting the result — otherwise a passing run proves nothing.
  const fullGetLen = buildQueryUrl(source.url, source.layer, buildProximityParams(source, gooseCreekScaleRings, 1320)).length;
  ok(fullGetLen > 2000 && fullGetLen < 3500,
    `${id}: fixture GET url is ${fullGetLen} chars — must sit in the 2000–3500 gap (>2000 required to trigger the NEW threshold; <3500 required to have silently ridden as GET under the OLD one)`);
  const cache = freshCache();
  let finding;
  try {
    finding = await analyzeSource(source, gooseCreekScaleRings, { cache, fetchJson: fetchArcgisJson });
  } catch (e) {
    ok(false, `${id}: analyzeSource threw — ${e.message}`);
    continue;
  }
  ok(finding.status !== "unavailable",
    `${id} (${source.sourceName}): status="${finding.status}" (never "unavailable" for a large geometry) — ${finding.summary || "(no summary — absent/unknown, which is fine)"}`);
}

console.log("");
if (fails.length) {
  console.log(`✗ ${fails.length} failure(s):`);
  for (const f of fails) console.log("  - " + f);
  process.exitCode = 1;
} else {
  console.log(`✓ All ${AFFECTED.length} previously-affected sources now resolve (present/absent/unknown), none read "unavailable", against the real live endpoints.`);
}
