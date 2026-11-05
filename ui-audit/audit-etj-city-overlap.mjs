#!/usr/bin/env node
/* audit-etj-city-overlap — B2472944. How many cities' limits sit UNDER another city's published ETJ polygon?
 *
 * An ETJ is the ground OUTSIDE every city's limits (Local Gov't Code ch. 42), so any overlap between a city's full-purpose limits and a
 * DIFFERENT city's ETJ polygon is two published layers disagreeing. The app resolves it by rule (city limits outrank — see
 * `identifyJurisdiction`'s ETJ netting); this audit measures how widespread it is, live, so the list is evidence rather than a claim.
 * Same-city pairs (a city's limits under its own ETJ polygon) are excluded: the name dedupe already handles those.
 *
 *   node ui-audit/audit-etj-city-overlap.mjs [--bbox xmin,ymin,xmax,ymax]      (default: the Houston metro)
 *
 * Sources: H-GAC HGAC_City_ETJ_Boundaries (ETJ) × TxGIO Texas_City_Boundaries (limits), generalised to ~20 m. Exits 0 always (informational);
 * exits 2 if a source cannot be reached, so an unreachable host is never read as "no overlap". Pure Node — no browser. */
import { createRequire } from "node:module";
import { esriPolygons, normalizePolys, SQM_PER_ACRE } from "../src/workspaces/site-planner/lib/jurisdictionShare.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";

const ClipperLib = createRequire(import.meta.url)("clipper-lib");
const arg = process.argv.indexOf("--bbox");
const [x0, y0, x1, y1] = (arg > 0 ? process.argv[arg + 1] : "-96.3,29.0,-94.4,30.4").split(",").map(Number);
const env = JSON.stringify({ xmin: x0, ymin: y0, xmax: x1, ymax: y1, spatialReference: { wkid: 4326 } });
const ref = [(x0 + x1) / 2, (y0 + y1) / 2];

async function pull(url, fields, extra = "") {
  const body = new URLSearchParams({ geometry: env, geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: fields, returnGeometry: "true", outSR: "4326", maxAllowableOffset: "0.0002", f: "json" });
  if (extra) for (const [k, v] of new URLSearchParams(extra)) body.set(k, v);
  const r = await fetch(`${url}/query`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  if (j.exceededTransferLimit) console.log("⚠ transfer limit hit on", url, "— narrow --bbox");
  return j.features || [];
}
let etj, city;
try {
  etj = await pull(GIS_SOURCES.etj_hgac.serviceUrl, "CITY");
  city = await pull(GIS_SOURCES.city.serviceUrl, "city_name", "resultRecordCount=1000");
} catch (e) { console.error("source unreachable:", e.message); process.exit(2); }

const bb = (f) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const r of f.geometry.rings) for (const [x, y] of r) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; };
const hit = (p, q) => !(p[2] < q[0] || q[2] < p[0] || p[3] < q[1] || q[3] < p[1]);
const key = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
const agg = new Map();
for (const e of etj) {
  const eb = bb(e), en = normalizePolys(esriPolygons(e.geometry), ref);
  for (const c of city) {
    if (key(c.attributes.city_name) === key(e.attributes.CITY) || !hit(eb, bb(c))) continue;
    const cl = new ClipperLib.Clipper();
    cl.AddPaths(en, ClipperLib.PolyType.ptSubject, true);
    cl.AddPaths(normalizePolys(esriPolygons(c.geometry), ref), ClipperLib.PolyType.ptClip, true);
    const out = new ClipperLib.Paths();
    cl.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    let a = 0; for (const p of out) a += ClipperLib.Clipper.Area(p);
    a = Math.abs(a) / 1e6 / SQM_PER_ACRE;
    if (a > 5) { const k = `${c.attributes.city_name} limits ← ${e.attributes.CITY} ETJ`; agg.set(k, (agg.get(k) || 0) + Math.round(a)); }
  }
}
const rows = [...agg.entries()].sort((a, b) => b[1] - a[1]);
console.log(`Cross-city overlaps (a city's limits under a DIFFERENT city's published ETJ polygon), acres summed — ${etj.length} ETJ polygons × ${city.length} city polygons:`);
for (const [k, v] of rows) console.log(String(v).padStart(8), "ac ", k);
console.log(`distinct pairs: ${rows.length}`);
