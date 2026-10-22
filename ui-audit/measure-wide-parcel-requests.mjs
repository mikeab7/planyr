#!/usr/bin/env node
/* NEW-1 (Select parcels, wide view) — REQUEST COUNT AND BYTES for one view, before vs after, against the LIVE county servers.
 *
 *   node ui-audit/measure-wide-parcel-requests.mjs                 # the four named counties, wide + mid view
 *   node ui-audit/measure-wide-parcel-requests.mjs davidson 15     # one source at one zoom
 *
 * No browser: it builds the requests with the SAME pure functions the app uses (parcelWideRequest.js) and sends them straight to the county
 * (the relay would forward exactly these bytes; from this sandbox the relay itself is not reachable). It measures three arms for a 1400×850 view
 * centred on the named lot:
 *   TODAY        what the shipped build does at that zoom — nothing is drawn below the cutoff, so 0 requests (reported, not measured)
 *   LOWERED      the cutoff simply lowered: esri-leaflet's own 512-px cell queries (where 1=1, its simplify factor, 6-digit precision), full detail.
 *                This is what "hide the house lots on the client" costs: every lot is downloaded, then thrown away.
 *   WIDE/MID     the new design: fixed tiles, the size filter in the where-clause, generalised geometry.
 * Bytes are measured twice per request: on the wire with `Accept-Encoding: gzip` (what a browser pays) and uncompressed (what is parsed).
 * LOUD: an arm whose answers carry exceededTransferLimit is TRUNCATED (the county silently dropped lots) and the table says so. */
import { execFileSync } from "node:child_process";
import { tilesForBounds, buildWideTileQuery, wideTileRequest, areaFieldForUrl, bucketForStage, wideStageForZoom } from "../src/workspaces/site-planner/lib/parcelWideRequest.js";
import { serializeEsriParams } from "../src/workspaces/site-planner/lib/parcelQueryWire.js";
import { areaFieldsReady } from "../src/workspaces/site-planner/lib/parcelAreaFieldsLazy.js";
await areaFieldsReady();

const SOURCES = {
  davidson: { label: "Davidson TN (Nashville) — 20 Culvert St", url: "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Parcels_view/FeatureServer/0", floor: 17, c: [36.13760, -86.75346], id: "OBJECTID", modern: true },
  rutherford: { label: "Rutherford TN", url: "https://services.arcgis.com/36I6IHIdr660pAyH/arcgis/rest/services/ParcelsCAMA1/FeatureServer/0", floor: 16, c: [35.7299, -86.3194], id: "OBJECTID_1", modern: true },
  harris: { label: "Harris TX (Katy)", url: "https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0", floor: 16, c: [29.8130, -95.8100], id: "OBJECTID", modern: false },
  dougherty: { label: "Dougherty GA (Albany)", url: "https://services6.arcgis.com/VKHi8CC6pMIyYUIs/arcgis/rest/services/Parcels_Public_View/FeatureServer/0", floor: 14, c: [31.5785, -84.1557], id: "OBJECTID", modern: true },
};
const W = 1400, H = 850;

function viewBounds(c, z) {
  const mpp = (156543.03392 * Math.cos((c[0] * Math.PI) / 180)) / 2 ** z;
  const dlat = (H * mpp) / 2 / 111320, dlng = (W * mpp) / 2 / (111320 * Math.cos((c[0] * Math.PI) / 180));
  return { west: c[1] - dlng, east: c[1] + dlng, south: c[0] - dlat, north: c[0] + dlat };
}
/* esri-leaflet's 512-px cell grid at integer zoom z (FeatureManager cellSize 512) */
function esriCells(b, z) {
  const n = 2 ** z * 256 / 512;
  const x = (lng) => ((lng + 180) / 360) * n;
  const y = (lat) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const ll = (X, Y) => [(X / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * Y) / n))) * 180) / Math.PI];
  const out = [];
  for (let cx = Math.floor(x(b.west)); cx <= Math.floor(x(b.east)); cx++) for (let cy = Math.floor(y(b.north)); cy <= Math.floor(y(b.south)); cy++) {
    const nw = ll(cx, cy), se = ll(cx + 1, cy + 1);
    out.push([nw[0], se[1], se[0], nw[1]]);
  }
  return out;
}

function get(url, body, gzip) {
  const full = `${url}?${body}`;
  const args = ["-sS", "-m", "90", "-o", "/tmp/.wide-measure-body", "-w", "%{http_code} %{size_download}", ...(gzip ? ["-H", "Accept-Encoding: gzip"] : []), full];
  const out = execFileSync("curl", args, { encoding: "utf8" }).trim().split(" ");
  return { status: Number(out[0]), bytes: Number(out[1]) };
}
function readBody() { return execFileSync("cat", ["/tmp/.wide-measure-body"], { encoding: "utf8", maxBuffer: 1 << 28 }); }

function runArm(name, reqs) {
  let n = 0, wire = 0, raw = 0, lots = 0, truncated = 0, failed = 0, tierUps = 0;
  const queue = [...reqs];
  while (queue.length) {
    const r = queue.shift();
    const g = get(r.url, r.body, true);
    const p = get(r.url, r.body, false);
    let j = null;
    try { j = JSON.parse(readBody()); } catch (_) { /* counted as failed below */ }
    n++; wire += g.bytes; raw += p.bytes;
    if (g.status !== 200 || !j || j.error) { failed++; continue; }
    const exceeded = !!(j.exceededTransferLimit || (j.properties && j.properties.exceededTransferLimit));
    if (exceeded && r.again) { tierUps++; queue.push(r.again()); lots -= 0; } // the tile hit the county's record cap: the app asks again with the size cutoff x4 (the 2000 are still drawn meanwhile)
    else if (exceeded) truncated++;
    lots += (j.features || []).length;
  }
  return { name, requests: n, wireKB: +(wire / 1024).toFixed(1), rawKB: +(raw / 1024).toFixed(1), lots, truncated, failed, tierUps };
}

function arms(key, z) {
  const s = SOURCES[key];
  const b = viewBounds(s.c, z);
  const area = areaFieldForUrl(s.url);
  if (!area) throw new Error(`${key}: no verified size column`);
  const stage = wideStageForZoom(z, s.floor, true);
  // LOWERED: esri-leaflet cell queries, as the layer sends them today at/above its cutoff
  const mapWidthDeg = Math.abs(b.east - b.west);
  const lowered = esriCells(b, Math.floor(z)).map((env) => {
    const p = { f: s.modern ? "geojson" : "json", geometry: JSON.stringify({ xmin: env[0], ymin: env[1], xmax: env[2], ymax: env[3], spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryEnvelope", inSR: 4326, spatialRel: "esriSpatialRelIntersects", where: "1=1", outFields: s.id, returnGeometry: true, geometryPrecision: 6, outSR: 4326, resultType: "tile", maxAllowableOffset: (mapWidthDeg / H) * 0.5 };
    return { url: `${s.url}/query`, body: serializeEsriParams(p) };
  });
  // NEW: the tile requests the app would send (direct to the county here; the relay forwards the same query)
  const bucket = bucketForStage(stage, s.floor);
  const tiles = tilesForBounds(b, bucket);
  const wideReq = (t, tier) => {
    const { params } = buildWideTileQuery({ tile: t, stage, area, fields: [s.id], tier });
    const r = wideTileRequest(s.url, params, { relay: false });
    return { url: r.url, body: r.body, again: tier < 2 ? () => wideReq(t, tier + 1) : null };
  };
  const wide = tiles.map((t) => wideReq(t, 0));
  return { stage, lowered: runArm("LOWERED cutoff / hide-on-client (every lot)", lowered), wide: runArm(stage.toUpperCase() + " (tiles + size filter + generalised)", wide) };
}

const only = process.argv.slice(2);
const keys = only[0] && SOURCES[only[0]] ? [only[0]] : Object.keys(SOURCES);
const zooms = (k) => (only[1] ? [Number(only[1])] : [SOURCES[k].floor - 2, SOURCES[k].floor - 1]);
const rows = [];
for (const k of keys) for (const z of zooms(k)) {
  const r = arms(k, z);
  rows.push({ source: SOURCES[k].label, zoom: z, stage: r.stage, today: "0 requests, 0 KB (draws nothing)", ...r });
}
for (const r of rows) {
  console.log(`\n${r.source} · zoom ${r.zoom} (${r.stage}) · ${W}×${H} view`);
  console.log(`  TODAY   ${r.today}`);
  for (const a of [r.lowered, r.wide]) console.log(`  ${a.name.padEnd(46)} ${String(a.requests).padStart(3)} requests · ${String(a.wireKB).padStart(8)} KB on the wire · ${String(a.rawKB).padStart(8)} KB parsed · ${String(a.lots).padStart(6)} lots${a.tierUps ? ` · ${a.tierUps} tile(s) re-asked with a tighter cutoff (counted above)` : ""}${a.truncated ? ` · ⚠ ${a.truncated} answer(s) TRUNCATED by the county's record cap` : ""}${a.failed ? ` · ✗ ${a.failed} failed` : ""}`);
}
