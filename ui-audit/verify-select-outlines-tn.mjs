/* NEW-1 (B2416496) — Select parcels must draw EVERY lot outline in view, not just the clicked lot, in Tennessee as in Texas and Georgia.
 * Root cause: Rutherford County's hosted FeatureServer answers the outline /query as `f=geojson` with features carrying NO top-level `id`;
 * the outline layer keys held lots by `feature.id`, so the whole view collapsed onto one key and held ONE lot (parcelQueryWire.ensureFeatureIds).
 * Opens the Map at each point, turns Select parcels on and counts the lots the outline layer holds. KNOWN-GOOD ARM: Harris (TX) must hold
 * many lots, else the run is VOID. The TN arm must hold more than a handful (the pre-fix build held 1 at this view).
 * Local:  vite --port 4188 --strictPort, then node ui-audit/verify-select-outlines-tn.mjs
 * Live:   node ui-audit/verify-select-outlines-tn.mjs --live https://planyr.io   (signs in as the test account; reads /version.json in the same run) */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const LIVE = process.argv.includes("--live") ? process.argv[process.argv.indexOf("--live") + 1] : null;
const BASE = LIVE || process.env.BASE_URL || "http://localhost:4188/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CASES = [["TN Rutherford (Epps Mill Rd / I-24)", 35.7299, -86.3194, 17, 20], ["TX Harris, Katy (known-good)", 29.813, -95.81, 17, 100], ["GA Dougherty, Albany", 31.5785, -84.1557, 17, 20]];
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };
let browser = null, closeSigned = null, newPage;
if (LIVE) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base: LIVE.replace(/\/$/, ""), initScripts: ["window.__PLANYR_E2E = true;"] });
  closeSigned = s.close; console.log("signed in:", s.proof, "build:", s.build);
  const ver = await s.page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
  console.log("version.json:", JSON.stringify(ver));
  newPage = async () => s.page;
} else {
  browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  newPage = async () => { const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage(); await p.addInitScript(() => { window.__PLANYR_E2E = true; }); return p; };
}
for (const [name, lat, lng, z, minLots] of CASES) {
  const page = await newPage();
  await assertMeasurable(page, "verify-select-outlines-tn");
  await page.goto(BASE.replace(/\/$/, "") + "/#/map", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 45000 });
  await page.evaluate(([la, ln, zz]) => window.__mapFinderMap.setView([la, ln], zz, { animate: false }), [lat, lng, z]);
  await page.waitForTimeout(800);
  const sel = page.locator('[data-testid="map-toolbar-select-parcels"]').first();
  await sel.click();
  let held = 0; const t0 = Date.now();
  while (Date.now() - t0 < 25000) { held = await page.evaluate(() => { const s = window.__mapParcelDisplay && window.__mapParcelDisplay(); return s ? s.held : 0; }); if (held >= minLots) break; await page.waitForTimeout(500); }
  expect(`${name}: outline layer holds lots for the whole view`, held >= minLots, `held ${held}, need >= ${minLots}`);
  await sel.click().catch(() => {}); // select mode off again
}
if (closeSigned) await closeSigned(); else await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
