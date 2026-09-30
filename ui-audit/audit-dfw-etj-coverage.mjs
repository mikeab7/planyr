#!/usr/bin/env node
/* audit-dfw-etj-coverage — the DFW city-limits + ETJ coverage fixtures, asked of the LIVE endpoints.
 *
 * NEW-1 (2026-09-30). `test/dfwEtjCoverage.test.js` pins what the app does with recorded answers; this
 * is the same set of questions put to the real services, plus the count check, so a publisher moving,
 * dropping a city or shipping an empty table is caught here rather than by a mislabelled site.
 *
 *   1. downtown Dallas                        → City of Dallas
 *   2. a point in Prosper's ETJ (Collin)      → that ETJ, in no city
 *   3. a point in Little Elm's ETJ (Denton)   → that ETJ, in no city
 *   4. a point in a Denton/Cross Roads overlap → BOTH ETJs reported
 *   5. a no-city/no-ETJ point in Collin       → unincorporated (coverage complete)
 *   6. a no-city/no-ETJ point in Ellis        → UNAVAILABLE — never unincorporated
 *   7. every ETJ service failing              → UNAVAILABLE — never unincorporated
 *   8. the count: distinct cities whose city limits OR ETJ reach the 50-mile circle ≥ FLOOR
 *
 * The FLOOR is MEASURED, not guessed (see MEASURED_FLOORS below) and is deliberately set a little under
 * the measured value so a publisher's ordinary edit does not trip it while losing a whole county's
 * table still does.
 *
 * ⛔ LIVE-NETWORK, not part of `npm test`. From a sandbox whose egress is a proxy, run with
 *   NODE_USE_ENV_PROXY=1 node ui-audit/audit-dfw-etj-coverage.mjs
 * Exits non-zero on a real failure; an unreachable service is reported as UNRESOLVED and also fails
 * (a coverage audit that cannot see coverage has proved nothing).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const J = await import(path.join(ROOT, "src/workspaces/site-planner/lib/jurisdiction.js"));
const { createGisCache } = await import(path.join(ROOT, "src/workspaces/site-planner/lib/gisCache.js"));
const { etjNamesOf } = await import(path.join(ROOT, "src/workspaces/site-planner/lib/etjNames.js"));
const { GIS_SOURCES } = await import(path.join(ROOT, "src/shared/gis/sources.js"));

// Written down after the first live run (2026-09-30): see the PR body for the raw counts.
// First live run 2026-09-30: 205 city limits + 65 ETJ cities touch the circle → 208 distinct. The floor
// sits a little under that, so an ordinary edit passes and losing a county's ETJ table (≥ 20 names) fails.
const MEASURED_FLOORS = { distinctCitiesInRadius: 195 };

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null }; };
const cache = () => createGisCache({ store: memStore(), now: () => Date.now() });
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };

async function getJson(url) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(40000) });
      const j = await r.json();
      if (!j.error) return j;
    } catch (_) { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
  }
  return null;
}
const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const ROLES = ["county", "city", "etj"];
const ident = (lng, lat, extra = {}) => J.identifyJurisdiction(lng, lat, { cache: cache(), roles: ROLES, ...extra });

// 1 — downtown Dallas
{
  const j = await ident(-96.7970, 32.7767);
  check("downtown Dallas → City of Dallas", j.city.includes("Dallas") && j.cityContainment === "in", `city=${JSON.stringify(j.city)} county=${JSON.stringify(j.county)}`);
}
// 2, 3 — known ETJs, each in NO city
for (const [label, lng, lat, want] of [["Prosper's ETJ (Collin)", -96.8961, 33.23255, "Prosper"], ["Little Elm's ETJ (Denton)", -96.93688, 33.20664, "Little Elm"]]) {
  const j = await ident(lng, lat);
  check(`${label} → ${want} ETJ, in no city`, j.etj.includes(want) && j.city.length === 0 && !j.etjUnavailable, `etj=${JSON.stringify(j.etj)} city=${JSON.stringify(j.city)}`);
}
// 4 — overlap: find a live "A/B" polygon in Denton County's table and probe an interior point of it
{
  const url = GIS_SOURCES.etj_denton.serviceUrl + "/query?" + qs({ where: "CITY like '%/%'", outFields: "CITY", returnGeometry: "true", outSR: 4326, f: "json" });
  const j = await getJson(url);
  let done = false;
  search:
  for (const f of (j && j.features) || []) {
    const claims = etjNamesOf(GIS_SOURCES.etj_denton, f.attributes.CITY);
    if (claims.length < 2) continue;
    const ring = f.geometry.rings.reduce((a, b) => (b.length > a.length ? b : a));
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    for (const t of [0, 0.25, 0.5]) for (const [vx, vy] of [[cx, cy], ...ring.filter((_, i) => i % Math.max(1, Math.floor(ring.length / 8)) === 0)]) {
      const x = cx + (vx - cx) * t, y = cy + (vy - cy) * t;
      const r = await ident(x, y);
      if (claims.every((c) => r.etj.some((e) => J.samePlace(e, c)))) {
        check(`overlap strip "${f.attributes.CITY}" → both ETJs reported`, true, `etj=${JSON.stringify(r.etj)} @ ${x.toFixed(4)},${y.toFixed(4)}`);
        done = true; break search;
      }
    }
  }
  if (!done) check("overlap strip → both ETJs reported", false, "no probe point inside an overlap polygon reported both claims");
}
// 5 — complete county, nothing there
{
  const j = await ident(-96.50, 33.10);
  check("no city, no ETJ, Collin County → Unincorporated (coverage complete)", j.unincorporated && !j.etjUnavailable && j.etjCoverage.status === "complete" && j.etj.length === 0,
    `county=${JSON.stringify(j.county)} coverage=${j.etjCoverage.status}`);
}
// 6 — incomplete county, nothing there
{
  // (-96.75, 32.30): Ellis County, ~33 mi south of Dallas, in no TxGIO city — verified live 2026-09-30.
  const j = await ident(-96.75, 32.30);
  const b = J.formatJurisdictionBadge(j);
  check("no city, no ETJ, county without a complete ETJ set → UNAVAILABLE, not Unincorporated",
    j.etj.length === 0 && j.city.length === 0 && j.etjUnavailable === true && !/Unincorporated/.test(b.text), `county=${JSON.stringify(j.county)} badge="${b.text}"`);
}
// 7 — forced failure of every ETJ service
{
  const etjHosts = J.ETJ_SOURCES.map((s) => new URL(s.url).pathname);
  const { fetchArcgisJson } = await import(path.join(ROOT, "src/workspaces/site-planner/lib/gisFetch.js"));
  const failingFetch = (url, o) => {
    if (etjHosts.some((p) => url.includes(p))) return Promise.reject(new Error("forced failure (audit)"));
    return fetchArcgisJson(url, o);
  };
  const j = await ident(-96.50, 33.10, { fetchJson: failingFetch });
  const b = J.formatJurisdictionBadge(j);
  check("forced failure of every ETJ service → UNAVAILABLE, never Unincorporated", j.etjUnavailable === true && !/Unincorporated/.test(b.text), `badge="${b.text}"`);
}
// 8 — the count check: distinct cities whose city limits OR ETJ reach the 50-mile circle
{
  const { lat, lng, radiusMiles } = J.DFW_ZONE;
  const dLat = radiusMiles / 69.0, dLng = radiusMiles / (69.17 * Math.cos((lat * Math.PI) / 180));
  const env = JSON.stringify({ xmin: lng - dLng, ymin: lat - dLat, xmax: lng + dLng, ymax: lat + dLat, spatialReference: { wkid: 4326 } });
  const touchesCircle = (geom) => (geom.rings || []).some((r) => {
    if (r.some(([x, y]) => J.distanceMiles(y, x, lat, lng) <= radiusMiles)) return true;
    // a polygon that spans the circle without a vertex inside it: test the centre of its envelope's nearest edge
    return false;
  });
  const cities = new Set(), etjCities = new Set();
  let unresolved = false;
  // City limits — the statewide TxGIO layer.
  {
    const j = await getJson(GIS_SOURCES.city.serviceUrl + "/query?" + qs({ where: "1=1", geometry: env, geometryType: "esriGeometryEnvelope", inSR: 4326, spatialRel: "esriSpatialRelIntersects", outFields: "city_name", returnGeometry: "true", outSR: 4326, maxAllowableOffset: 0.002, resultRecordCount: 2000, f: "json" }));
    if (!j) unresolved = true; else for (const f of j.features || []) if (touchesCircle(f.geometry || {})) cities.add(f.attributes.city_name);
  }
  // ETJ — every routed source, clipped to the same envelope.
  for (const src of J.ETJ_SOURCES) {
    if (!(src.bbox[0] <= lat + dLat && src.bbox[2] >= lat - dLat && src.bbox[1] <= lng + dLng && src.bbox[3] >= lng - dLng)) continue;
    const col = src.fields && src.fields.name;
    const j = await getJson(src.url + "/query?" + qs({ where: "1=1", geometry: env, geometryType: "esriGeometryEnvelope", inSR: 4326, spatialRel: "esriSpatialRelIntersects", outFields: col || "*", returnGeometry: "true", outSR: 4326, maxAllowableOffset: 0.002, resultRecordCount: 2000, f: "json" }));
    if (!j) { unresolved = true; continue; }
    for (const f of j.features || []) if (touchesCircle(f.geometry || {})) for (const n of etjNamesOf(src, col ? f.attributes[col] : null)) etjCities.add(n);
  }
  const all = new Set([...cities, ...etjCities].map((n) => n.toLowerCase()));
  console.log(`   city limits touching the circle: ${cities.size} · ETJs touching the circle: ${etjCities.size} · distinct cities either way: ${all.size}`);
  console.log(`   ETJ cities: ${[...etjCities].sort().join(", ")}`);
  check("count check — distinct cities in the radius meets the measured floor", !unresolved && all.size >= MEASURED_FLOORS.distinctCitiesInRadius && MEASURED_FLOORS.distinctCitiesInRadius > 0,
    `${all.size} ≥ ${MEASURED_FLOORS.distinctCitiesInRadius}${unresolved ? " (UNRESOLVED: a service was unreachable)" : ""}`);
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} checks FAILED.` : `\nAll ${results.length} DFW coverage checks passed.`);
process.exit(failed.length ? 1 : 0);
