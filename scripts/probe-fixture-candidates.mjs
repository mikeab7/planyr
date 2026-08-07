#!/usr/bin/env node
/* B209505 — PROBE candidate fixture points against the live services and report what they actually
 * return, so the expanded fixture set is MEASURED rather than asserted.
 *
 * WHY THIS IS A SCRIPT AND NOT A HAND-EDIT. B209505 widens every registry row from one fixture point
 * to several separated ones. A fixture is a claim about what a live service holds at a real place;
 * writing dozens of them by hand means writing dozens of guesses, and a guessed `expectMinCount` is
 * worse than no fixture at all — it either fails forever (a red guard nobody reads) or passes
 * vacuously. So every candidate point is queried here first, exactly the way
 * `gis-verify/gis-source-coverage-verify.mjs` queries a fixture (a ~1 km envelope, returnCountOnly),
 * and only points that actually answered become fixtures.
 *
 * It is a DEVELOPMENT tool: nothing in the build, the test run or CI executes it, and its output is
 * pasted into `src/shared/gis/sourceFixtures.js` after review. Re-run it when adding a row or when
 * a fixture's expectation needs re-basing against the live service.
 *
 *   node scripts/probe-fixture-candidates.mjs                # every row
 *   node scripts/probe-fixture-candidates.mjs rail airports   # named rows only
 */
import { GIS_SOURCES, statesFor } from "../src/shared/gis/sources.js";

/* The candidate points, grouped by the region they exercise. The six Houston-area points are the
 * owner's own audit sites (B209505) and are deliberately first: they are the ones that produced this
 * work, so every row that covers Houston gets probed at them permanently. */
export const CANDIDATE_POINTS = {
  // ── The owner's six 2026-08-06 audit sites, one per Houston-metro county ──
  cedarPort:   { point: [-94.8520, 29.7930], label: "Cedar Port / Mont Belvieu (Chambers)", region: "houston" },
  nwHarris:    { point: [-95.5520, 29.8700], label: "NW Harris, Beltway 8 at US-290", region: "houston" },
  sugarLand:   { point: [-95.6000, 29.5800], label: "Sugar Land (Fort Bend)", region: "houston" },
  conroe:      { point: [-95.4500, 30.2800], label: "Conroe / I-45 North (Montgomery)", region: "houston" },
  pearland:    { point: [-95.2900, 29.5500], label: "Pearland / SH-288 (Brazoria)", region: "houston" },
  texasCity:   { point: [-94.9350, 29.4000], label: "Texas City (Galveston)", region: "houston" },
  // ── Texas, well away from Houston, so a Houston-clipped source cannot pass a statewide row ──
  dallas:      { point: [-96.7970, 32.7767], label: "Dallas", region: "tx" },
  sanAntonio:  { point: [-98.4936, 29.4241], label: "San Antonio", region: "tx" },
  midland:     { point: [-102.0779, 31.9686], label: "Midland (Permian Basin)", region: "tx" },
  elPasoTx:    { point: [-106.4850, 31.7619], label: "El Paso, TX", region: "tx" },
  amarillo:    { point: [-101.8313, 35.2220], label: "Amarillo (Panhandle)", region: "tx" },
  // ── Colorado ──
  denver:      { point: [-104.9903, 39.7392], label: "Denver", region: "co" },
  greeley:     { point: [-104.7091, 40.4233], label: "Greeley (Weld)", region: "co" },
  coSprings:   { point: [-104.8214, 38.8339], label: "Colorado Springs (El Paso, CO)", region: "co" },
  grandJunc:   { point: [-108.5506, 39.0639], label: "Grand Junction (Mesa)", region: "co" },
  // ── Out-of-region anchors for NATIONAL rows: a national layer must answer far from Texas ──
  chicago:     { point: [-87.6298, 41.8781], label: "Chicago, IL", region: "national" },
  atlanta:     { point: [-84.3880, 33.7490], label: "Atlanta, GA", region: "national" },
  phoenix:     { point: [-112.0740, 33.4484], label: "Phoenix, AZ", region: "national" },
  newark:      { point: [-74.1724, 40.7357], label: "Newark, NJ", region: "national" },
};

/* Which candidate regions are worth probing for a row, from the scope it already declares. A
 * national row is probed everywhere; a Texas row only in Texas; a Colorado row only in Colorado.
 * Probing a Texas row in Chicago would just manufacture a guaranteed zero. */
function regionsFor(entry) {
  const st = statesFor(entry);
  if (st === null) return ["houston", "tx", "co", "national"];
  const out = [];
  if (st.includes("TX")) out.push("houston", "tx");
  if (st.includes("CO")) out.push("co");
  return out.length ? out : ["houston", "tx"];
}

function layerEndpoints(s) {
  const base = String(s.serviceUrl).replace(/\/+$/, "");
  if (Array.isArray(s.layerId)) return s.layerId.map((id) => ({ id, url: `${base}/${id}` }));
  if (s.layerId != null) return [{ id: s.layerId, url: `${base}/${s.layerId}` }];
  return [{ id: null, url: base }];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* THROTTLED AND RETRIED, because the first full run of this script proved why it has to be.
 * Firing every row × every candidate point flat out earned an HTTP 429 "Unable to perform query.
 * Too many requests." from the FAA airports service — which then read in the output as a layer
 * that answers nowhere. That is the same false negative this whole work item is about, produced
 * by our own request volume: a rate-limited probe looks exactly like a dead service. So pace the
 * requests and back off on a 429 rather than recording the refusal as an answer. */
async function countAt(url, [lng, lat], attempt = 0) {
  const d = 0.01; // the verifier's own ~1 km envelope — probe exactly what the guard will assert
  const params = new URLSearchParams({
    f: "json", where: "1=1",
    geometry: [lng - d, lat - d, lng + d, lat + d].join(","), geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects", inSR: "4326", returnCountOnly: "true",
  });
  const r = await fetch(`${url}/query?${params}`, { signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  if (j.error) {
    const rateLimited = /too many requests|429|quota/i.test(j.error.message || "");
    if (rateLimited && attempt < 4) { await sleep(2000 * 2 ** attempt); return countAt(url, [lng, lat], attempt + 1); }
    throw new Error(`${j.error.code} ${j.error.message}`);
  }
  await sleep(THROTTLE_MS);
  return j.count ?? (j.features ? j.features.length : null);
}

const THROTTLE_MS = Number(process.env.PROBE_THROTTLE_MS || 120);

/* A ring of points at `km` around an anchor. Narrow-coverage rows (one drainage district, one
 * city's ETJ) cannot be probed with the metro-scale candidate list — there is nowhere else in
 * their coverage to stand. So their extra fixture points are generated AROUND the row's existing
 * known-good fixture at exactly the separation its reach class demands, and only the ones that
 * actually answer are kept. */
export function ringAround([lng, lat], km, n = 8) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n;
    const dLat = (km / 111.32) * Math.sin(th);
    const dLng = (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(th);
    out.push([+(lng + dLng).toFixed(4), +(lat + dLat).toFixed(4)]);
  }
  return out;
}

/* Only probe when RUN, never when imported. `CANDIDATE_POINTS` is the useful export — the fixture
 * generator reads it — and a top-level probe would fire hundreds of live requests on import. */
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (!isMain) { /* imported for CANDIDATE_POINTS only */ } else await main();

async function main() {
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const rows = Object.entries(GIS_SOURCES).filter(([k, s]) => (!only.length || only.includes(k)) && s.kind !== "raster" && s.kind !== "raster-identify");

for (const [key, s] of rows) {
  const eps = layerEndpoints(s);
  const regions = new Set(regionsFor(s));
  const hits = [];
  for (const [name, c] of Object.entries(CANDIDATE_POINTS)) {
    if (!regions.has(c.region)) continue;
    let total = 0, failed = null;
    for (const ep of eps) {
      try { total += (await countAt(ep.url, c.point)) || 0; }
      catch (e) { failed = e.message; }
    }
    hits.push({ name, label: c.label, point: c.point, count: failed ? `ERR ${failed}` : total });
  }
  const live = hits.filter((h) => typeof h.count === "number" && h.count > 0);
  console.log(`\n### ${key}  (${live.length}/${hits.length} candidate points return features)`);
  for (const h of hits) console.log(`   ${String(h.count).padStart(6)}  ${h.name.padEnd(12)} ${h.label}`);
}
}
