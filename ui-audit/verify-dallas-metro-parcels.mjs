/* B853712 — THE STATEWIDE-DERIVED TIER, PROVEN AGAINST THE LIVE TxGIO ENDPOINT, THROUGH THE
 * SHIPPED CODE — not a curl reimplementation.
 *
 * `counties.js` now derives a real parcel source (the universal TxGIO statewide layer) for any of
 * the 254 Texas counties that has no dialed-in appraisal-district row of its own, from the SAME
 * `public/geo/county-polygons.json` asset the geometry resolver already fetches. Unit tests
 * (`test/countyStatewideDerivation.test.js`) prove the pure logic; this proves the live half: that
 * a real point inside each sampled county actually gets a real parcel back from the real production
 * endpoint, through the exact functions the app calls (`countyIdentity`, `COUNTIES_MAP[key]`,
 * `identifyAtPoint`) — no reimplementation of the request shape that could quietly drift from what
 * ships.
 *
 * THIS IS A SAMPLE, STATED HONESTLY, NOT A CLAIM OF 254 VERIFIED ROWS (owner instruction,
 * 2026-08-29): TxGIO is ONE service, and its COVERAGE is what's under test, not 254 independent
 * endpoints. Probed here: the nineteen counties within 50 miles of downtown Dallas (edge distance,
 * per-county polygon) PLUS a spread sample well outside that radius — a Panhandle, a border, a
 * Piney Woods and a Gulf-coast county — so a pass here is evidence about the MECHANISM, not proof
 * that every one of the other ~231 unprobed counties has a parcel drawn at every point in it.
 *
 * Node-only — `counties.js` and `arcgis.js` are plain ES modules with no DOM dependency, so this
 * runs the real shipped code directly (no build, no browser) against the live production endpoint.
 *
 * Run:  node ui-audit/verify-dallas-metro-parcels.mjs
 */
import { countyIdentity, COUNTIES_MAP, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { identifyAtPoint } from "../src/workspaces/site-planner/lib/arcgis.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSET_PATH = path.join(__dirname, "..", "public", "geo", "county-polygons.json");

const DFW_19 = [
  ["Dallas", 32.693167, -96.766833], ["Collin", 33.249556, -96.505278], ["Denton", 33.301778, -97.046722],
  ["Kaufman", 32.469639, -96.4469], ["Rockwall", 32.9235, -96.371], ["Tarrant", 32.840875, -97.272312],
  ["Ellis", 32.423037, -96.486407], ["Johnson", 32.199984, -97.512859], ["Hunt", 32.917808, -95.967205],
  ["Henderson", 32.218865, -95.985276], ["Wise", 33.257083, -97.56575], ["Hill", 31.973128, -97.355061],
  ["Navarro", 32.196171, -96.212512], ["Van Zandt", 32.68039, -95.710936], ["Grayson", 33.818807, -96.674836],
  ["Parker", 32.828, -97.801429], ["Cooke", 33.6357, -97.1336], ["Fannin", 33.805524, -96.096716],
  ["Rains", 32.788747, -95.819877],
];
const SPREAD_SAMPLE = [
  ["Hartley", 35.85, -102.55], ["Webb", 27.55, -99.49], ["Nacogdoches", 31.60, -94.66], ["Calhoun", 28.45, -96.60],
];

const fails = [];
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails.push(msg); };

console.log("--- B853712 · statewide-derived tier, live against TxGIO ---\n");

const payload = JSON.parse(readFileSync(ASSET_PATH, "utf8"));
await setCountyPolygons(payload);
console.log(`Loaded ${payload.counties.length} counties from the committed asset.\n`);

async function probeCounty(name, lat, lng) {
  const id = countyIdentity(lat, lng);
  if (id.status !== "ok") {
    ok(false, `${name}: countyIdentity did not resolve (status=${id.status})`);
    return;
  }
  const note = noParcelSourceNote(id);
  ok(note === null, `${name}: no "no parcel data" gap message (countyIdentity → ok, key=${id.key})`);

  const cfg = COUNTIES_MAP[id.key];
  ok(!!cfg && !!cfg.layerUrl, `${name}: COUNTIES_MAP["${id.key}"] has a layerUrl`);
  if (!cfg || !cfg.layerUrl) return;

  const t0 = Date.now();
  let feat = null, err = null;
  try {
    feat = await identifyAtPoint(cfg.layerUrl, lng, lat);
  } catch (e) {
    err = e;
  }
  const ms = Date.now() - t0;
  if (err) { ok(false, `${name}: identifyAtPoint threw — ${err.message}`); return; }
  ok(!!feat, `${name}: TxGIO /identify returned a parcel (${ms} ms)`);
  if (!feat) return;

  const a = feat.attributes || {};
  const county = a.COUNTY || a.county;
  const matches = typeof county === "string" && county.toUpperCase() === name.toUpperCase();
  ok(matches, `${name}: returned parcel's COUNTY="${county}" matches (prop_id=${a.PROP_ID || a.prop_id}, owner="${a.OWNER_NAME || a.owner_name}")`);
}

console.log("1) the nineteen counties within 50 miles of downtown Dallas");
for (const [name, lat, lng] of DFW_19) await probeCounty(name, lat, lng);

console.log("\n2) a spread sample well outside that radius (mechanism, not just proximity)");
for (const [name, lat, lng] of SPREAD_SAMPLE) await probeCounty(name, lat, lng);

console.log("\n3) the dialed-in tier is unaffected — its own live CAD still answers, not TxGIO");
{
  const id = countyIdentity(29.76, -95.37); // inside Harris
  ok(id.key === "harris", `Harris still resolves to its own dialed-in key (got "${id.key}")`);
  ok(COUNTIES_MAP.harris.layerUrl.includes("gis.hctx.net"), "Harris's layerUrl is still HCAD's own service, not TxGIO");
}

console.log(`\n${fails.length ? `✗ ${fails.length} FAILED` : "✓ all checks passed"}`);
console.log(`\nSAMPLE SIZE: ${DFW_19.length + SPREAD_SAMPLE.length} of 254 Texas counties probed live. This is evidence`);
console.log("about the derivation MECHANISM (one TxGIO service, scoped correctly per county), not a claim");
console.log("that every one of the remaining unprobed counties has been individually confirmed.");
process.exit(fails.length ? 1 : 0);
