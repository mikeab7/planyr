/* Live verification — Fort Bend's parcel source is now FBCAD's Esri-hosted layer.
 *
 * Clicks a Fort Bend lot (Sugar Land) and confirms the click is answered DIRECTLY by
 * the hosted FBCAD service (services2.arcgis.com, org D4saGHECICkCeoJm) — a real parcel
 * selected, promptly, with NO "statewide backup" notice (the old self-hosted gis.fbcad.org
 * is retired). Logged-out, served from dist/ on :4173. This is the happy-path counterpart
 * to fbcad-outage-fallback-verify.mjs (which simulates that hosted service being down).
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = process.env.APP || "http://127.0.0.1:4173/";
const FB = [29.6197, -95.6349]; // Sugar Land — squarely in Fort Bend

const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });

// Record the parcel point queries that fire and who answered.
const q = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/query\b/.test(u)) return;
  const svc = /D4saGHECICkCeoJm/.test(u) ? "FBCAD-hosted" : /gis\.hctx\.net/.test(u) ? "HCAD" : /geographic\.texas\.gov/.test(u) ? "TxGIO" : null;
  if (!svc || !/esriGeometryPoint/.test(decodeURIComponent(u))) return;
  try { const j = await r.json(); const f = (j.features || [])[0]; q.push({ svc, count: (j.features || []).length, owner: f?.attributes?.OWNERNAME, qref: f?.attributes?.QUICKREFID }); }
  catch (e) { q.push({ svc, err: String(e).slice(0, 40) }); }
});

await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.locator('button:has-text("Select parcels")').first().click({ timeout: 10000 }).catch((e) => console.log("selbtn:", e.message.slice(0, 60)));
await page.waitForTimeout(1500);

// Grab the Leaflet map off the React fiber.
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
console.log("map:", found);
if (found !== "ok") { await browser.close(); process.exit(1); }

await page.evaluate(([la, ln]) => window.__MAP__.setView([la, ln], 18, { animate: false }), FB);
await page.waitForTimeout(4500);

const px = await page.evaluate(() => { const r = document.querySelector(".leaflet-container").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
q.length = 0;
const t0 = Date.now();
await page.mouse.click(px.x, px.y);
let elapsed = 0, bodyText = "";
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(400);
  bodyText = await page.locator("body").innerText().catch(() => "");
  if (/\bPARCEL\b/i.test(bodyText) || /[\d.]+\s*AC/i.test(bodyText)) { elapsed = Date.now() - t0; break; }
}
if (!elapsed) elapsed = Date.now() - t0;

const backupNotice = /statewide backup/i.test(bodyText);
const hl = await page.evaluate(() => [...document.querySelectorAll(".leaflet-overlay-pane path")].filter((p) => { const s = (p.getAttribute("stroke") || "").toLowerCase(); return /e85|ea58|c241|d97|f59/.test(s); }).length);
const acres = (bodyText.match(/[\d.]+\s*AC/gi) || []);
const fbcadAnswered = q.some((x) => x.svc === "FBCAD-hosted" && x.count > 0);

console.log("\n--- FBCAD HOSTED-PRIMARY VERIFY (clicked Fort Bend / Sugar Land) ---");
console.log("  point queries fired:", JSON.stringify(q));
console.log("  FBCAD-hosted answered the click:", fbcadAnswered);
console.log("  selected within:", elapsed, "ms");
console.log("  statewide-backup notice shown:", backupNotice, "(should be FALSE — primary answered)");
console.log("  highlight path(s) drawn:", hl, " selection acreage:", JSON.stringify(acres));
const pass = fbcadAnswered && hl > 0 && !backupNotice && elapsed < 15000;
console.log("  VERDICT:", pass ? "PASS — FB lot selected directly from FBCAD's hosted layer, no backup needed" : "REVIEW — see values above");
await page.screenshot({ path: "gis-verify/fbcad-hosted-primary-verified.png" });
await browser.close();
console.log("DONE");
process.exit(pass ? 0 : 1);
