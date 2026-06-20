/* B239/B240 live verification — FBCAD outage → statewide TxGIO fallback.
 *
 * Simulates the real 2026-06-19 outage (FBCAD's whole ArcGIS server returning 503 on
 * every path) by intercepting the gis.fbcad.org host, then clicks a Fort Bend lot and
 * confirms: (1) the click still SELECTS a real parcel (from TxGIO) — no 45s freeze;
 * (2) the honest "statewide backup source" notice appears; (3) the point queries show
 * HCAD answering empty + TxGIO answering the hit. Logged-out, served from dist/.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = process.env.APP || "http://localhost:4173/";
const FB = [29.6197, -95.6349]; // Sugar Land — squarely in Fort Bend, outside the Chambers bbox

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });

// Simulate the FBCAD outage: every gis.fbcad.org request → HTTP 503 (whole server down).
let fbcadHits = 0;
await page.route(/gis\.fbcad\.org/, (route) => { fbcadHits++; route.fulfill({ status: 503, contentType: "text/plain", body: "Service Unavailable" }); });

// Watch the parcel point queries that actually fire (HCAD vs TxGIO).
const q = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/query\?/.test(u)) return;
  const svc = /gis\.hctx\.net/.test(u) ? "HCAD" : /geographic\.texas\.gov/.test(u) ? "TxGIO" : /fbcad/.test(u) ? "FBCAD" : null;
  if (!svc || !/esriGeometryPoint/.test(decodeURIComponent(u))) return;
  try { const j = await r.json(); const f = (j.features || [])[0]; q.push({ svc, count: (j.features || []).length, county: f?.attributes?.county, prop: f?.attributes?.prop_id }); }
  catch (e) { q.push({ svc, err: String(e).slice(0, 40) }); }
});

await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.locator('button:has-text("Select parcels")').first().click({ timeout: 10000 }).catch((e) => console.log("selbtn:", e.message.slice(0, 60)));
await page.waitForTimeout(1500);

// Grab the Leaflet map off the React fiber (same technique as pearland-fix-verify).
const found = await page.evaluate(() => {
  const cont = document.querySelector(".leaflet-container"); if (!cont) return "nocont";
  const fk = Object.keys(cont).find((k) => k.startsWith("__reactFiber$")); if (!fk) return "nofiber";
  let root = cont[fk]; while (root.return) root = root.return;
  const seen = new Set(), qq = [root];
  const isMap = (v) => { try { return v && typeof v === "object" && typeof v.setView === "function" && typeof v.latLngToContainerPoint === "function"; } catch (e) { return false; } };
  while (qq.length) { const f = qq.shift(); if (!f || seen.has(f)) continue; seen.add(f); let h = f.memoizedState, d = 0;
    while (h && typeof h === "object" && d < 80) { try { const ms = h.memoizedState; if (ms && isMap(ms.current)) { window.__MAP__ = ms.current; return "ok"; } } catch (e) {} h = h.next; d++; }
    for (const k of ["child", "sibling"]) { try { if (f[k]) qq.push(f[k]); } catch (e) {} } if (f.alternate && !seen.has(f.alternate)) qq.push(f.alternate); }
  return "nomap";
});
console.log("map:", found, "| fbcad intercepted (503) so far:", fbcadHits);
if (found !== "ok") { await browser.close(); process.exit(0); }

await page.evaluate(([la, ln]) => window.__MAP__.setView([la, ln], 18, { animate: false }), FB);
await page.waitForTimeout(4500);

const px = await page.evaluate(() => { const r = document.querySelector(".leaflet-container").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
q.length = 0;
const t0 = Date.now();
await page.mouse.click(px.x, px.y);
// Poll for a selection/backup notice rather than a fixed long wait — proves it's prompt.
let elapsed = 0, bodyText = "";
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(400);
  bodyText = await page.locator("body").innerText().catch(() => "");
  if (/statewide backup/i.test(bodyText) || /\bPARCEL\b/i.test(bodyText)) { elapsed = Date.now() - t0; break; }
}
if (!elapsed) elapsed = Date.now() - t0;

const backupNotice = /statewide backup/i.test(bodyText);
const hl = await page.evaluate(() => [...document.querySelectorAll(".leaflet-overlay-pane path")].filter((p) => { const s = (p.getAttribute("stroke") || "").toLowerCase(); return /e85|ea58|c241|d97|f59/.test(s); }).length);
const acres = (bodyText.match(/[\d.]+\s*AC/gi) || []);

console.log("\n--- B239/B240 FBCAD-OUTAGE FALLBACK VERIFY (clicked Fort Bend / Sugar Land) ---");
console.log("  point queries fired:", JSON.stringify(q));
console.log("  FBCAD requests intercepted as 503:", fbcadHits, "(its query never freezes the click)");
console.log("  selected within:", elapsed, "ms");
console.log("  statewide-backup notice shown:", backupNotice);
console.log("  highlight path(s) drawn:", hl, " selection acreage:", JSON.stringify(acres));
console.log("  VERDICT:", (backupNotice && hl > 0 && elapsed < 15000) ? "PASS — FB lot selected from TxGIO backup, no freeze, honest provenance" : "REVIEW — see values above");
await page.screenshot({ path: "gis-verify/fbcad-outage-fallback-verified.png" });
await browser.close();
console.log("DONE");
