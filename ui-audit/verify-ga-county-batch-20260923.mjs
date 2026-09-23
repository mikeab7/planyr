/* NEW-1 (2026-09-23) — the 11 newly-wired Georgia counties, proven live through the SHIPPED code
 * (`countyIdentity`, `COUNTIES_MAP`, `queryAtPoint`) against the real production endpoints, not
 * a curl reimplementation. Same shape as `verify-dallas-metro-parcels.mjs` (B853712).
 *
 * Node-only — `counties.js` and `arcgis.js` are plain ES modules with no DOM dependency, so this
 * runs the real shipped code directly against the live GIS hosts. It is NOT a substitute for a
 * real-browser click-through on planyr.io (which this item parks as `Verify: live` / `Blocker:
 * live-GIS` for, per this repo's own convention — see B1455634's identical split) — it proves the
 * MECHANISM (a query resolves a real parcel through the exact function the app calls), not that
 * the Map Finder UI itself renders/selects one.
 *
 * Run:  node ui-audit/verify-ga-county-batch-20260923.mjs
 */
import { countyIdentity, COUNTIES_MAP, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { queryAtPoint } from "../src/workspaces/site-planner/lib/arcgis.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSET_PATH = path.join(__dirname, "..", "public", "geo", "county-polygons.json");

// Points are each a real parcel's own centroid/interior point (ray-cast-verified against that
// parcel's actual ring, not just a plausible-looking county-seat coordinate) — four of the eleven
// original county-seat guesses landed on a road/right-of-way with no parcel underneath, which
// queryAtPoint correctly reported as "no feature" rather than a false pass.
const GA_NEW = [
  ["ga_dekalb", "Decatur (parcel interior)", 33.76995543769708, -84.30133161596498],
  ["ga_clarke", "Athens", 33.9519, -83.3576],
  ["ga_columbia", "Evans", 33.5440, -82.2247],
  ["ga_lowndes", "Valdosta", 30.8327, -83.2785],
  ["ga_jackson", "Jefferson, GA", 34.1187, -83.5719],
  ["ga_bibb", "Macon (parcel interior)", 32.83056268887474, -83.6382089126084],
  ["ga_dougherty", "Albany (parcel interior)", 31.59007300999357, -84.14975425463572],
  ["ga_rockdale", "Conyers (parcel interior)", 33.6659953116, -84.0261955724],
  ["ga_paulding", "Dallas, GA", 33.9282, -84.8752],
  ["ga_bulloch", "Statesboro", 32.4488, -81.7832],
  ["ga_camden", "Kingsland", 30.8027, -81.6104],
];

const fails = [];
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails.push(msg); };

console.log("--- NEW-1 (2026-09-23) · 11 newly-wired Georgia counties, live against their real endpoints ---\n");

const payload = JSON.parse(readFileSync(ASSET_PATH, "utf8"));
await setCountyPolygons(payload);
console.log(`Loaded ${payload.counties.length} counties from the committed asset.\n`);

async function probeCounty(key, place, lat, lng) {
  const id = countyIdentity(lat, lng);
  ok(id.status === "ok" && id.key === key, `${place}: countyIdentity resolves to "${key}" (got status=${id.status}, key=${id.key})`);

  const note = noParcelSourceNote(id);
  ok(note === null, `${place}: no "no parcel data" gap message`);

  const cfg = COUNTIES_MAP[key];
  ok(!!cfg && !!cfg.layerUrl, `${place}: COUNTIES_MAP["${key}"] has a layerUrl`);
  if (!cfg || !cfg.layerUrl) return;

  const t0 = Date.now();
  let feat = null, err = null;
  try {
    feat = await queryAtPoint(cfg.layerUrl, lng, lat);
  } catch (e) {
    err = e;
  }
  const ms = Date.now() - t0;
  if (err) { ok(false, `${place}: queryAtPoint threw — ${err.message}`); return; }
  ok(!!feat, `${place}: /query returned a real parcel (${ms} ms)`);
  if (feat) {
    const a = feat.attributes || {};
    const idVal = a[cfg.idField] ?? Object.values(a).find((v) => v != null);
    console.log(`      attributes sample: ${cfg.idField || "(auto)"}=${idVal}`);
  }
}

for (const [key, place, lat, lng] of GA_NEW) await probeCounty(key, place, lat, lng);

console.log(`\n${fails.length ? `✗ ${fails.length} FAILED` : "✓ all checks passed"}`);
console.log(`\n${GA_NEW.length} of the 11 newly-wired Georgia counties probed live, through the shipped`);
console.log("countyIdentity/COUNTIES_MAP/queryAtPoint functions — one point per county, not exhaustive coverage.");
process.exit(fails.length ? 1 : 0);
