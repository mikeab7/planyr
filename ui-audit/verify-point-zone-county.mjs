/* B2494336 (NEW-2 STATE-PLANE-STATUTE) — the REAL fetch path installs the point→county→zone locator.
 * test/statePlaneStatute.test.js proves the rule through the `setCountyPolygons` seam; this proves the shipped path: the app's own
 * `loadCountyPolygons()` fetches /geo/county-polygons.json, and only then does a bare point resolve by COUNTY.
 *   usage: node ui-audit/verify-point-zone-county.mjs [baseUrl]   (default http://localhost:5199 — `npx vite --port 5199`)
 * Known-good arms: before the load Conroe is the coarse Houston-box answer (tx_sc, coarse) — the instrument can see the old behaviour;
 * Houston/Katy stay tx_sc after (the control that must NOT move). */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "http://localhost:5199";
const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + "/", { waitUntil: "domcontentloaded" });
await assertMeasurable(page, "verify-point-zone-county");
const out = await page.evaluate(async () => {
  const poly = await import("/src/workspaces/site-planner/lib/countyPolygons.js");
  const core = await import("/src/shared/coordinates/statePlaneCore.js");
  const P = { conroe: [30.3119, -95.4561], liberty: [30.058, -94.7955], houston: [29.7604, -95.3698], katy: [29.7858, -95.8245], yonkers: [40.9312, -73.8988], memphis: [35.1495, -90.049] };
  const read = () => Object.fromEntries(Object.entries(P).map(([k, [a, b]]) => { const z = core.zoneForPoint(a, b); return [k, z ? `${z.id}${z.coarse ? "*" : ""}/${z.via}` : null]; }));
  const before = read();
  await poly.loadCountyPolygons();
  return { before, after: read(), locator: core.hasPointZoneLocator() };
});
await browser.close();
console.log(JSON.stringify(out, null, 1));
const want = { conroe: "tx_central/county-point", liberty: "tx_central/county-point", houston: "tx_sc/county-point", katy: "tx_sc/county-point", yonkers: "ny_east/county-point", memphis: "tn/county-point" };
let bad = 0;
if (out.before.conroe !== "tx_sc*/extent") { console.log("VOID: pre-load Conroe is not the coarse Houston-box answer:", out.before.conroe); bad++; }
for (const [k, v] of Object.entries(want)) if (out.after[k] !== v) { console.log(`FAIL ${k}: ${out.after[k]} !== ${v}`); bad++; }
if (!out.locator) { console.log("FAIL: locator not installed after loadCountyPolygons"); bad++; }
if (errors.length) { console.log("page errors:", errors); bad++; }
console.log(bad ? `\n${bad} problem(s)` : "\nPASS — real fetch path installs the county locator; Houston/Katy unchanged");
process.exit(bad ? 1 : 0);
