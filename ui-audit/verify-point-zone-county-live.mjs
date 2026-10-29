/* B2494336 — LIVE, signed in, on the deployed build: the county locator is fetched and installed on a real Site-route load, and the
 * served locator answers by COUNTY. Reads /version.json (openSignedIn's `build`) in the same call as the assertions.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-point-zone-county-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Known-good arm: the served locator must answer Houston = tx_sc as well as Conroe = tx_central (a locator that answers one value
 * everywhere would pass the Conroe check alone). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const want = process.argv[3] || "";
const s = await openSignedIn({ base });
let bad = 0;
const fail = (m) => { console.log("FAIL", m); bad++; };
try {
  const { page } = s;
  await assertMeasurable(page, "verify-point-zone-county-live");
  const seen = [];
  page.on("request", (r) => { const u = r.url(); if (/pointZoneLocator|county-polygons/.test(u)) seen.push(u); });
  await page.goto(base + "/#/site", { waitUntil: "domcontentloaded" });
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !seen.some((u) => /pointZoneLocator/.test(u))) await page.waitForTimeout(500);
  const build = JSON.stringify(s.build);
  console.log("build:", build);
  if (want && !String(s.build && s.build.build || build).startsWith(want)) fail(`served build ${build} is not ${want}…`);
  const poly = seen.find((u) => /county-polygons/.test(u)), loc = seen.find((u) => /pointZoneLocator-[^/]+\.js/.test(u));
  console.log("requests:", seen.map((u) => u.replace(base, "")).join(" | "));
  if (!poly) fail("county-polygons.json was never requested");
  if (!loc) fail("pointZoneLocator chunk was never requested after the polygons loaded");
  if (loc) {
    const out = await page.evaluate(async (url) => {
      const m = await import(url);   // same URL as the app's own dynamic import → the same module instance
      const z = (la, lo) => { const r = m.pointZoneLocator.forPoint(la, lo); return r && r.zone ? r.zone.id : null; };
      return { conroe: z(30.3119, -95.4561), liberty: z(30.058, -94.7955), houston: z(29.7604, -95.3698), katy: z(29.7858, -95.8245) };
    }, loc);
    console.log("served locator:", JSON.stringify(out));
    if (out.houston !== "tx_sc" || out.katy !== "tx_sc") fail("known-good arm: Houston/Katy are not tx_sc — locator void or wrong");
    if (out.conroe !== "tx_central" || out.liberty !== "tx_central") fail("Conroe/Liberty are not tx_central");
  }
} catch (e) { fail(e.message); }
await s.close();
console.log(bad ? `\n${bad} problem(s)` : "\nPASS — deployed build fetches + installs the county locator; Conroe/Liberty tx_central, Houston/Katy tx_sc");
process.exit(bad ? 1 : 0);
