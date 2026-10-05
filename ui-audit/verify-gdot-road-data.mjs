/* B2081249 — DISCOVERY + CORS PROBE for Georgia DOT road data (traffic counts + designated truck-route network).
 *
 * WHY THIS EXISTS INSTEAD OF A REGISTRY ROW: rnhp.dot.ga.gov answers the build sandbox's egress proxy with CONNECT 403,
 * so the layer INDEX and FIELD NAMES inside EOC/GeoTrafficCountsDisplay/MapServer (and wherever the truck-route
 * network lives) could not be read, and an endpoint that is guessed is how a row ships dead or — worse — draws the
 * wrong layer. Run this from any machine that can reach GDOT; it walks the folders, lists every layer with its
 * geometry type and fields, tests CORS for https://planyr.io, and PRINTS the registry rows to paste.
 *
 *   node ui-audit/verify-gdot-road-data.mjs
 *
 * Exit 0 = both a traffic-count and a truck-route layer were found and answer a /query with CORS open for planyr.io.
 * Exit 2 = the host is unreachable from here (NOT a pass — nothing was checked; same convention as
 * verify-dfw-etj-browser-hosts). Exit 1 = reachable but a layer is missing / not CORS-open / returned no features.
 * The brief's note: gis.dot.ga.gov failed from the browser too — do not use that host. */
const ROOT = "https://rnhp.dot.ga.gov/hosting/rest/services";
const ORIGIN = "https://planyr.io";
const FOLDERS = ["EOC", "Planning", "TripRoutes", "Hosted"];
const COUNT_RE = /traffic.?count|aadt/i;
const TRUCK_RE = /truck|staa|freight|oversize|designated/i;

async function j(url) {
  const r = await fetch(url, { headers: { Origin: ORIGIN } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return { json: await r.json(), cors: r.headers.get("access-control-allow-origin") };
}

let unreachable = false;
const found = { count: [], truck: [] };
const services = [];
try {
  const top = (await j(`${ROOT}?f=json`)).json;
  for (const s of top.services || []) services.push(`${s.name}/${s.type}`);
  for (const f of [...new Set([...(top.folders || []), ...FOLDERS])]) {
    try { for (const s of (await j(`${ROOT}/${f}?f=json`)).json.services || []) services.push(`${s.name}/${s.type}`); } catch (_) {}
  }
} catch (e) {
  console.error(`UNREACHABLE: ${e.message}\nNothing was checked — run this from a machine that can reach rnhp.dot.ga.gov.`);
  process.exit(2);
}

for (const svc of services.filter((s) => /\/(MapServer|FeatureServer)$/.test(s))) {
  const url = `${ROOT}/${svc}`;
  let meta;
  try { meta = await j(`${url}?f=json`); } catch (_) { continue; }
  for (const l of meta.json.layers || []) {
    const hay = `${svc} ${l.name}`;
    const kind = COUNT_RE.test(hay) ? "count" : TRUCK_RE.test(hay) ? "truck" : null;
    if (!kind) continue;
    try {
      const d = await j(`${url}/${l.id}?f=json`);
      const q = await j(`${url}/${l.id}/query?where=1%3D1&returnCountOnly=true&f=json`);
      found[kind].push({ url: `${url}/${l.id}`, name: l.name, geometryType: d.json.geometryType, fields: (d.json.fields || []).map((x) => x.name), count: q.json.count, cors: d.cors });
    } catch (e) { found[kind].push({ url: `${url}/${l.id}`, name: l.name, error: e.message }); }
  }
}

for (const kind of ["count", "truck"]) {
  console.log(`\n== ${kind === "count" ? "TRAFFIC COUNT" : "TRUCK ROUTE"} candidates ==`);
  for (const c of found[kind]) console.log(JSON.stringify(c, null, 1));
}
const okCors = (c) => c.cors === "*" || c.cors === ORIGIN;
const good = (kind) => found[kind].filter((c) => !c.error && c.count > 0 && okCors(c));
console.log(`\ncount layers OK: ${good("count").length} · truck layers OK: ${good("truck").length}`);
if (good("count").length && good("truck").length) {
  console.log("\nPaste into sources.js (aadtGa / truckRoutesGa, states:[\"GA\"], tier \"production\") + fixtures (Atlanta / Savannah / a rural route),");
  console.log("then layers.js (ga_aadt / ga_truck_routes, group \"access\", mirroring co_aadt). Until then the Analysis card reads \"Not screened in Georgia\".");
  process.exit(0);
}
process.exit(1);
