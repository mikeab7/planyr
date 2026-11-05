#!/usr/bin/env node
/* NEW-1 (Select parcels, wide view) — find, for every parcel source, a GEOMETRIC area column the SERVER can filter on, and prove
 * its unit against the lot's own outline before the app ever trusts it.
 *
 *   node scripts/probe-parcel-area-fields.mjs            # probe every source, rewrite parcelAreaFields.js
 *   node scripts/probe-parcel-area-fields.mjs tn_davidson ga_dougherty   # probe only these keys (merged into the file)
 *
 * WHY THIS IS A SCRIPT AND NOT A RUNTIME GUESS. The wide view asks the county for "lots of at least half an acre" in the WHERE
 * clause, so the county never sends the house lots. That is only safe when the column really is an area in a known unit:
 *   · a hosted layer's `Shape__Area` is in the layer's own spatial-reference units — square feet for a State Plane layer, square
 *     metres for a metric one, and Web-Mercator square metres (inflated by 1/cos²(latitude)) for a 3857 layer;
 *   · an APPRAISAL "acres" column is NOT a substitute — measured on Harris County (HCAD): `acreage_1` / `land_sqft` are 0 on a real
 *     6.46-acre reserve lot, so a size filter on them would silently hide big lots. Only a column computed from the geometry is used.
 * So each source is sampled (≈60 lots near its centre), the column's value is compared with the lot's geodesic area from the outline
 * returned in lon/lat, and the source is accepted only when the median ratio lands on a known unit (±8%). Anything else — no
 * geometric column, no sample, the server refusing the filter, an unknown unit — is listed under `unverified` WITH the reason and
 * keeps today's close-in cutoff. Never a guess. Re-run when a source is added or a service is re-published.
 *
 * Writes docs/parcel-area-fields-report.json ({ sources: { "<layer url>": { field, unit, ratio, n, keys[] } }, unverified: { "<layer url>": { reason, keys[] } } })
 * and the slim runtime table src/workspaces/site-planner/lib/parcelAreaFields.js. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTIES_MAP, trimLayerUrl } from "../src/workspaces/site-planner/lib/counties.js";
import { AREA_UNITS, okAreaField, geodesicAreaM2 } from "../src/workspaces/site-planner/lib/parcelWideRequest.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "../src/workspaces/site-planner/lib/parcelAreaFields.js"); // what the app loads (slim: url -> "column|unit"), lazily, only when Select parcels is turned on
const REPORT = path.join(HERE, "../docs/parcel-area-fields-report.json"); // the full per-source result, with the reason every unverified source was refused (never bundled)
const TIMEOUT = 25000;
const GEOMETRIC = [/^shape__?area$/i, /^shape\.starea\(\)$/i, /^shape\.area$/i, /^st_area\(shape\)$/i, /^shape_area$/i];

/* A same-origin `/gis-proxy/<host>/<path>` source is probed at its real https host. */
const realUrl = (u) => (u.startsWith("/gis-proxy/") ? `https://${u.slice("/gis-proxy/".length)}` : u);

async function getJson(url, params, timeout = TIMEOUT) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${url}?${new URLSearchParams(params)}`, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; PlanyrProbe/1.0)" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function probeOne(url, keys) {
  const base = realUrl(url);
  let meta;
  try { meta = await getJson(base, { f: "json" }); } catch (e) { return { reason: `metadata unreadable (${e.message})` }; }
  if (!meta || meta.error) return { reason: `metadata error (${meta && meta.error && meta.error.message})` };
  if (meta.geometryType && meta.geometryType !== "esriGeometryPolygon") return { reason: `not a polygon layer (${meta.geometryType})` };
  const names = (meta.fields || []).map((f) => f.name);
  let field = null;
  for (const re of GEOMETRIC) { field = names.find((n) => re.test(n)); if (field) break; }
  if (!field) return { reason: "no geometric area column (appraisal acreage columns are unreliable — 0 on real big lots)" };
  if (!okAreaField(field)) return { reason: `area column name not a plain identifier (${field})` };
  // a few lots near the source's centre
  const c = keys.map((k) => COUNTIES_MAP[k] && COUNTIES_MAP[k].center).find(Boolean);
  if (!c) return { reason: "no centre point to sample at" };
  let feats = [];
  for (const r of [0.04, 0.2, 0.6]) {
    const env = [c[1] - r, c[0] - r, c[1] + r, c[0] + r].join(",");
    try {
      const d = await getJson(`${base}/query`, { where: "1=1", geometry: env, geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: field, returnGeometry: "true", outSR: "4326", resultRecordCount: "60", f: "json" }, 45000);
      if (d && d.error) return { reason: `sample query refused (${d.error.message || d.error.code})` };
      feats = (d && d.features) || [];
    } catch (e) { return { reason: `sample query failed (${e.message})` }; }
    if (feats.length >= 8) break;
  }
  if (feats.length < 8) return { reason: `too few lots near the source's centre to calibrate (${feats.length})` };
  const lat = c[0];
  const m2s = [], vals = [];
  for (const f of feats) {
    const v = Number(f.attributes && f.attributes[field]);
    const ring = f.geometry && f.geometry.rings && f.geometry.rings[0];
    if (!(v > 0) || !ring) continue;
    const a = geodesicAreaM2(f.geometry.rings);
    if (a < 50) continue;
    vals.push(v); m2s.push(a);
  }
  if (vals.length < 6) return { reason: `no usable lots in the sample (${vals.length} with a positive area and an outline)` };
  const ratio = median(vals.map((v, i) => v / m2s[i]));
  let unit = null;
  for (const [u, def] of Object.entries(AREA_UNITS)) {
    const want = def.perM2(lat);
    if (Math.abs(Math.log(ratio / want)) < 0.08) { unit = u; break; }
  }
  if (!unit) return { reason: `unit not recognised (median ratio field/m² = ${ratio.toPrecision(4)} at lat ${lat})` };
  // the server must accept a filter on the column
  try {
    const env = [c[1] - 0.04, c[0] - 0.04, c[1] + 0.04, c[0] + 0.04].join(",");
    const d = await getJson(`${base}/query`, { where: `${field} >= 21780`, geometry: env, geometryType: "esriGeometryEnvelope", inSR: "4326", returnCountOnly: "true", f: "json" }, 60000);
    if (!d || d.error || typeof d.count !== "number") return { reason: `server refused a filter on ${field} (${d && d.error && d.error.message})` };
  } catch (e) { return { reason: `filter test failed (${e.message})` }; }
  return { ok: { field, unit, ratio: Number(ratio.toPrecision(4)), n: vals.length } };
}

async function main() {
  const only = process.argv.slice(2);
  const byUrl = new Map();
  for (const [k, c] of Object.entries(COUNTIES_MAP)) {
    if (only.length && !only.includes(k)) continue;
    const u = trimLayerUrl(c.layerUrl || "");
    if (!u || /txgio|stratmap/i.test(u) && c.statewide) continue;
    if (!byUrl.has(u)) byUrl.set(u, []);
    byUrl.get(u).push(k);
  }
  const prev = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, "utf8")) : { sources: {}, unverified: {} };
  const sources = only.length ? { ...prev.sources } : {}, unverified = only.length ? { ...prev.unverified } : {};
  const queue = [...byUrl.entries()];
  let done = 0;
  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [url, keys] = next;
      let r;
      try { r = await probeOne(url, keys); } catch (e) { r = { reason: `probe crashed (${e.message})` }; }
      delete sources[url]; delete unverified[url];
      if (r.ok) sources[url] = { ...r.ok, keys: keys.sort() }; else unverified[url] = { reason: r.reason, keys: keys.sort() };
      if (++done % 25 === 0) console.error(`… ${done}/${byUrl.size}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const out = { generatedBy: "scripts/probe-parcel-area-fields.mjs", sources: sort(sources), unverified: sort(unverified) };
  fs.writeFileSync(REPORT, JSON.stringify(out, null, 1) + "\n");
  const slim = Object.fromEntries(Object.entries(out.sources).map(([u, e]) => [u, `${e.field}|${e.unit}`]));
  fs.writeFileSync(OUT, "/* GENERATED by scripts/probe-parcel-area-fields.mjs — do not hand-edit. url -> \"geometric area column|unit\" for every source whose column was\n * proven against the lot's own outline. Loaded lazily (parcelAreaFieldsLazy.js); the full report incl. every refusal is docs/parcel-area-fields-report.json. */\nexport default " + JSON.stringify(slim, null, 1) + ";\n");
  console.log(`verified ${Object.keys(out.sources).length} · unverified ${Object.keys(out.unverified).length} (kept at today's close-in cutoff)`);
}
main();
