/* Shared hermetic Bartow GA parcel-service mock for the Select-parcels cost harnesses
 * (verify-select-parcels-on-cost.mjs). Lifted from verify-parcel-arrival-cost.mjs so the two
 * measure the SAME synthetic service.
 *
 * SYNTHETIC, said plainly: www.bartowgis.org is blocked by this sandbox's egress policy (CONNECT 403,
 * re-checked 2026-10-05), and the gis-proxy allow-list does not carry it, so no recorded Bartow /query
 * response can be obtained here. The grid is Bartow-density (~0.001° lots) with ~10-vertex rings so
 * vertex-proportional work is realistic, and it publishes Bartow's real lot-number field (PARCELID) so the
 * lot-number layer is live (B2092656 ×2: a mock with only OBJECTID left that whole path dead). */
export const BARTOW = { lat: 34.20, lng: -84.83 };
export const STEP = 0.001;
/** The PARCELID and the centre (lng/lat) of the synthetic lot in grid cell (i, j). */
export const lotAt = (i, j) => ({ id: `A${(i + 100000) * 100000 + (j + 100000)}`, lng: i * STEP + STEP * 0.2, lat: j * STEP + STEP * 0.22 });
export const cellOf = (lng, lat) => ({ i: Math.floor(lng / STEP), j: Math.floor(lat / STEP) });
export const META_OK = JSON.stringify({ name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", currentVersion: 11.1, capabilities: "Query", maxRecordCount: 100000, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }, { name: "PARCELID", type: "esriFieldTypeString", alias: "PARCELID" }], extent: { xmin: -85.1, ymin: 34.0, xmax: -84.5, ymax: 34.5, spatialReference: { wkid: 4326 } } });
const EMPTY = JSON.stringify({ type: "FeatureCollection", features: [] });
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function ringFor(x, y, h, seed) {
  const w = h * (0.85 + 0.15 * ((seed * 7) % 5) / 4), c = h * 0.18, j = (n) => ((seed * (n + 3)) % 7) * h * 0.004;
  return [[x + c, y], [x + w - c, y + j(1)], [x + w, y + c], [x + w + j(2), y + h / 2], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h + j(3)], [x, y + h - c], [x - j(4), y + h / 2], [x, y + c], [x + c, y]];
}
function parcelsIn(env) {
  const feats = [];
  const i0 = Math.floor(env.xmin / STEP), i1 = Math.ceil(env.xmax / STEP), j0 = Math.floor(env.ymin / STEP), j1 = Math.ceil(env.ymax / STEP);
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
    const id = (i + 100000) * 100000 + (j + 100000);
    feats.push({ id, PARCELID: `A${id}`, rings: [ringFor(i * STEP, j * STEP, STEP * 0.45, id)] });
    if (feats.length > 30000) return feats;
  }
  return feats;
}
function envelopeOf(u) {
  const g = new URL(u).searchParams.get("geometry");
  if (!g) return null;
  try {
    const o = JSON.parse(g);
    if (o.xmin != null) return o;
    if (o.x != null) return { xmin: o.x, ymin: o.y, xmax: o.x + 1e-9, ymax: o.y + 1e-9 }; // a click's point identify → the one lot cell under it
  } catch (_) {}
  const p = g.split(",").map(Number); return p.length === 4 ? { xmin: p[0], ymin: p[1], xmax: p[2], ymax: p[3] } : null;
}

/** Route every GIS host: Bartow /query → the synthetic grid after `delayMs`; other /query → empty; /export → 1 px PNG;
 *  anything else under /MapServer|/FeatureServer → layer metadata. Returns live counters. */
export async function routeBartowGis(page, { delayMs = 350, bartowOnly = false } = {}) {
  const counts = { query: 0, lots: 0 };
  /* bartowOnly: leave every OTHER host to the real network (a live Texas arm beside a synthetic Georgia one). */
  await page.route(bartowOnly ? (url) => url.hostname.includes("bartowgis.org") : /\/(MapServer|FeatureServer)\//i, async (route) => {
    const u = route.request().url();
    if (u.includes("bartowgis.org") && /\/query(\?|$)/i.test(u)) {
      await new Promise((r) => setTimeout(r, delayMs));
      counts.query++;
      const env = envelopeOf(u);
      const feats = env ? parcelsIn(env) : [];
      counts.lots += feats.length;
      if (new URL(u).searchParams.get("f") === "geojson") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ type: "FeatureCollection", features: feats.map((f) => ({ type: "Feature", id: f.id, properties: { OBJECTID: f.id, PARCELID: f.PARCELID }, geometry: { type: "Polygon", coordinates: f.rings } })) }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ objectIdFieldName: "OBJECTID", geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }, { name: "PARCELID", type: "esriFieldTypeString", alias: "PARCELID" }], features: feats.map((f) => ({ attributes: { OBJECTID: f.id, PARCELID: f.PARCELID }, geometry: { rings: f.rings } })) }) });
    }
    if (/\/query(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: EMPTY });
    if (/\/export(\?|$)/i.test(u)) return route.fulfill({ status: 200, contentType: "image/png", body: PNG1 });
    return route.fulfill({ status: 200, contentType: "application/json", body: META_OK });
  });
  return counts;
}

/** The longest main-thread tasks (ms, descending) from a Chrome trace — `ThreadControllerImpl::RunTask` on CrRendererMain. */
export function longestTasks(events, { detailOver = Infinity, log = console.log } = {}) {
  const names = new Map(); events.filter((e) => e.name === "thread_name").forEach((e) => names.set(`${e.pid}:${e.tid}`, e.args && e.args.name));
  const rend = events.filter((e) => e.ph === "X" && names.get(`${e.pid}:${e.tid}`) === "CrRendererMain");
  const tasks = rend.filter((e) => e.name === "ThreadControllerImpl::RunTask").sort((a, b) => b.dur - a.dur);
  tasks.slice(0, 4).filter((t) => t.dur > detailOver * 1000).forEach((t) => {
    const inside = rend.filter((e) => e !== t && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e.dur > 3000 && e.name !== "Receive mojo message").sort((a, b) => b.dur - a.dur).slice(0, 8);
    log(`        task ${(t.dur / 1000).toFixed(0)} ms ⊃ ${inside.map((e) => `${e.name}${e.args && e.args.data && e.args.data.functionName ? `(${e.args.data.functionName})` : ""} ${(e.dur / 1000).toFixed(0)}`).join(" · ")}`);
  });
  return tasks.map((e) => e.dur / 1000);
}
