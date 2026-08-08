#!/usr/bin/env node
/* record-jurisdiction-shapes — capture the LIVE agency answers behind the four shape fixtures.
 *
 * NEW-3 asked for one regression fixture per jurisdiction SHAPE, built from the owner's real sites
 * and their real coordinates. `test/jurisdictionShapes.test.js` has to run in CI with no network,
 * so the agency responses are RECORDED here once and replayed there. This script is how they were
 * captured and how they are re-captured if a boundary genuinely changes — the fixture is never
 * hand-edited to make a test pass.
 *
 * Usage: node ui-audit/record-jurisdiction-shapes.mjs > test/fixtures/jurisdictionShapes.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { feetToLatLngPair } = await import(path.join(ROOT, "src/workspaces/site-planner/lib/mapLock.js"));
const { representativeRing, ringCentroid } = await import(path.join(ROOT, "src/workspaces/site-planner/lib/siteAnalysis.js"));
const { parcelProbePoints, simplifyRing, round6, JURISDICTION_SOURCES, ETJ_SOURCES } =
  await import(path.join(ROOT, "src/workspaces/site-planner/lib/jurisdiction.js"));

const SRC = {
  county: [JURISDICTION_SOURCES.county.url, "CNTY_NM"],
  city: [JURISDICTION_SOURCES.city.url, "city_name"],
  etj: [ETJ_SOURCES.find((s) => s.id === "etj_hgac").url, "CITY"],
};

/* The four shapes NEW-3 names, and why each one is here. Coordinates come from the owner's own
 * production rows (see ui-audit/fixtures/jurisdiction-portfolio.json). */
const SHAPES = {
  "Gessner": "in-city — squarely inside Houston's limits",
  "Will Clayton": "in-city PLUS an ETJ — inside Humble's limits and inside Houston's ETJ",
  "Bain": "unincorporated INSIDE an ETJ — no city holds it, the Houston ETJ reaches it, Katy clips the edge",
  "Goose Creek": "unincorporated with a city within 1 km — and the sweep found Baytown actually holds 6 of the 16 drawn parcels",
  /* A FIFTH shape the brief did not name, added because the portfolio sweep found a defect only it
   * can see: unincorporated land inside a city's ETJ where THAT SAME CITY also clips the parcel
   * edge. The ETJ was being deduped against every city the boundary touched, so the sliver
   * suppressed its own ETJ and the pill read "City of Houston · edge only" instead of naming the
   * Ch. 19 authority. Four of the owner's sites are this shape (Kennedy Greens, JFK, Katz,
   * Pinnacle) and none of the other four fixtures can go red on it. */
  "Kennedy Greens": "unincorporated in the Houston ETJ where a Houston sliver ALSO clips the edge",
};

async function q(url, field, geom) {
  const u = new URL(url + "/query");
  u.searchParams.set("f", "json"); u.searchParams.set("outFields", field);
  u.searchParams.set("inSR", "4326"); u.searchParams.set("outSR", "4326");
  u.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  u.searchParams.set("returnGeometry", "false");
  u.searchParams.set("geometryType", geom.type); u.searchParams.set("geometry", JSON.stringify(geom.g));
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      if (!j.error) return [...new Set((j.features || []).map((f) => f.attributes[field]).filter(Boolean).map(String))];
    } catch (_) { /* retry */ }
    await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
  }
  throw new Error("could not record " + url);
}

const portfolio = JSON.parse(fs.readFileSync(path.join(ROOT, "ui-audit/fixtures/jurisdiction-portfolio.json"), "utf8"));
const out = { _note: "RECORDED live agency answers for the four NEW-3 shape fixtures. Regenerate with ui-audit/record-jurisdiction-shapes.mjs — never hand-edit to make a test pass.", _recordedAt: "2026-08-08", shapes: [] };

for (const [name, why] of Object.entries(SHAPES)) {
  const s = portfolio.sites.find((x) => x.site === name);
  const rings = s.rings.map((r) => r.map(([x, y]) => { const [lat, lng] = feetToLatLngPair({ x, y }, s.lat, s.lon); return [lng, lat]; }));
  const rep = representativeRing(rings);
  const c = ringCentroid(rep);
  const probe = parcelProbePoints(rings);
  const rec = { site: name, why, lat: s.lat, lon: s.lon, truth: s.truth, centroid: c, probe: probe.points, answers: {} };
  for (const [role, [url, f]] of Object.entries(SRC)) {
    rec.answers[role] = {
      ring: await q(url, f, { type: "esriGeometryPolygon", g: { rings: [[...round6(simplifyRing(rep, 80)), round6(simplifyRing(rep, 80))[0]]], spatialReference: { wkid: 4326 } } }),
      points: [],
    };
    for (const [px, py] of probe.points) {
      rec.answers[role].points.push(await q(url, f, { type: "esriGeometryPoint", g: { x: px, y: py, spatialReference: { wkid: 4326 } } }));
      await new Promise((res) => setTimeout(res, 250));
    }
  }
  out.shapes.push(rec);
  process.stderr.write(`recorded ${name}: city ring=${JSON.stringify(rec.answers.city.ring)} pts=${JSON.stringify(rec.answers.city.points)} etj=${JSON.stringify(rec.answers.etj.ring)}\n`);
}
console.log(JSON.stringify(out, null, 1));
