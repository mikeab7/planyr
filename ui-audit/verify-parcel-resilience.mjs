/* Verify the parcel-select resilience fix (FBCAD-down recurrence, 2026-06-22):
 *  - The map + "Select parcels" mode load with NO uncaught error even while FBCAD is
 *    dead (the new addDisplay hang-guard must not crash; the statewide layer stays).
 *  - A click runs the eager identify and the busy spinner CLEARS within a bounded time
 *    (it must not freeze the tab ~8s+ waiting on the hung county server).
 * This runs against the LIVE CAD hosts, which tonight are exactly the failing state we
 * fixed for: FBCAD unreachable, HCAD/TxGIO reachable (TxGIO slow).
 * Run: node ui-audit/verify-parcel-resilience.mjs  (vite preview on :4173) */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// One Harris site WITH an origin → the app lands on the MapFinder (not the planner).
const sites = {
  s1: { id: "s1", groupId: "s1", site: "Katy Ind", name: "Plan 1", status: "active",
        origin: { lat: 29.76, lon: -95.37 }, county: "harris",
        parcels: [{ id: "p1", points: [{ x: -400, y: -300 }, { x: 400, y: -300 }, { x: 400, y: 300 }, { x: -400, y: 300 }] }],
        els: [], updatedAt: Date.now() },
};
const seed = `(() => { try {
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify(sites))});
  localStorage.removeItem("planarfit:currentSite:v1");
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (e) => { pageErrors.push(String(e)); console.log("  [pageerror]", String(e)); });
page.on("console", (m) => { if (m.type() === "error") { consoleErrors.push(m.text()); console.log("  [console.error]", m.text()); } });

// Watch which CAD hosts the app actually reaches (proves the flow ran end-to-end).
// FBCAD is now the Esri-hosted layer (org D4saGHECICkCeoJm on services2.arcgis.com),
// not the retired self-hosted gis.fbcad.org.
const hostHits = { fbcad: 0, hctx: 0, txgio: 0 };
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("D4saGHECICkCeoJm") || u.includes("gis.fbcad.org")) hostHits.fbcad++;
  else if (u.includes("gis.hctx.net")) hostHits.hctx++;
  else if (u.includes("feature.geographic.texas.gov")) hostHits.txgio++;
});

await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const mapVisible = await page.locator(".leaflet-container").count();
console.log(`Map container present: ${mapVisible > 0 ? "yes (PASS)" : "NO (FAIL)"}`);

// Enter "Select parcels" mode → triggers addDisplay for every resolved county (the new
// hang-guard path runs here, with FBCAD dead).
const selBtn = page.locator("text=/Select parcels/i").first();
const haveBtn = await selBtn.count();
console.log(`"Select parcels" button present: ${haveBtn > 0 ? "yes" : "NO (FAIL)"}`);
if (haveBtn) await selBtn.click();
await page.waitForTimeout(2000);
const inSelectMode = await page.locator("text=/Selecting…|Looking up lot/i").count();
console.log(`Entered select mode (sidebar shows Selecting…): ${inSelectMode > 0 ? "yes (PASS)" : "no"}`);
await page.screenshot({ path: OUT + "parcel-1-select-mode.png" });

// Wait through FBCAD's full hang window (~12s) — the map must NOT crash and the page
// must stay responsive (the whole point of the display hang-guard).
await page.waitForTimeout(13000);
const aliveAfterHang = await page.evaluate(() => { try { return !!document.querySelector(".leaflet-container"); } catch (_) { return false; } });
console.log(`Map alive after FBCAD hang window: ${aliveAfterHang ? "yes (PASS)" : "NO (FAIL)"}`);

// Click the map centre → handleClick → identifyParcelEager. Time how long until the
// busy state clears: it must resolve in a bounded time (not an open-ended freeze).
const box = await page.locator(".leaflet-container").boundingBox();
const t0 = Date.now();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
// "Looking up lot…" shows while busy; wait for it to clear (bounded).
let clearedMs = null;
for (let i = 0; i < 40; i++) { // up to 20s
  await page.waitForTimeout(500);
  const busyNow = await page.locator("text=/Looking up lot/i").count();
  if (busyNow === 0) { clearedMs = Date.now() - t0; break; }
}
console.log(`Click resolved (busy cleared) in: ${clearedMs == null ? ">20s (FAIL — still hung)" : clearedMs + "ms (PASS)"}`);
await page.screenshot({ path: OUT + "parcel-2-after-click.png" });

console.log(`CAD host requests seen — FBCAD:${hostHits.fbcad} HCAD:${hostHits.hctx} TxGIO:${hostHits.txgio}`);
console.log(`Uncaught page errors: ${pageErrors.length} (expect 0)`);

const pass = mapVisible > 0 && haveBtn > 0 && aliveAfterHang && clearedMs != null && pageErrors.length === 0;
console.log(`\n${pass ? "✅ PASS" : "❌ FAIL"} — parcel-select resilience under FBCAD-down`);
await browser.close();
process.exit(pass ? 0 : 1);
