/* Live click-through: prove a Chambers County lot now SELECTS + its outlines RENDER,
 * after TxGIO disabled the parcels /query op (fix: /export image display + /identify
 * click fallback). Drives the real app in headless Chromium through the agent proxy. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = process.env.APP || "http://localhost:4173/";
const PROXY = process.env.HTTPS_PROXY || "http://127.0.0.1:43417";
// A Mont Belvieu (Chambers Co.) parcel confirmed live via the shipped code.
const PT = [29.846, -94.886];

const browser = await chromium.launch({ executablePath: EXEC, headless: true, proxy: { server: PROXY }, args: ["--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });

const net = { identify: [], query: [], exportImg: 0 };
page.on("response", async (r) => {
  const u = r.url();
  if (!/geographic\.texas\.gov/.test(u)) return;
  if (/\/export\?/.test(u)) { net.exportImg++; return; }
  const isPt = /esriGeometryPoint/.test(decodeURIComponent(u));
  if (/\/identify\?/.test(u)) {
    try { const j = await r.json(); const f = (j.results || [])[0]; net.identify.push({ n: (j.results || []).length, prop: f?.attributes?.PROP_ID ?? f?.attributes?.prop_id, rings: f?.geometry?.rings?.length }); }
    catch (e) { net.identify.push({ err: String(e).slice(0, 40) }); }
  } else if (/\/query\?/.test(u) && isPt) {
    try { const j = await r.json(); net.query.push(j.error ? { err: j.error.message?.slice(0, 40) } : { n: (j.features || []).length }); }
    catch (e) { net.query.push({ err: String(e).slice(0, 40) }); }
  }
});

await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.locator('button:has-text("Select parcels")').first().click({ timeout: 10000 }).catch((e) => console.log("selbtn:", e.message.slice(0, 60)));
await page.waitForTimeout(1500);

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

await page.evaluate(([la, ln]) => window.__MAP__.setView([la, ln], 17, { animate: false }), PT);
await page.waitForTimeout(5000); // let the /export parcel outlines + basemap tiles paint

const px = await page.evaluate(([la, ln]) => { const p = window.__MAP__.latLngToContainerPoint([la, ln]); const r = document.querySelector(".leaflet-container").getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, PT);
await page.mouse.click(px.x, px.y);
await page.waitForTimeout(4000);

const hlPaths = await page.evaluate(() => [...document.querySelectorAll(".leaflet-overlay-pane path")].filter((p) => { const d = p.getAttribute("d") || ""; return d.length > 20; }).length);
const card = await page.locator("body").innerText().catch(() => "");
const acres = (card.match(/[\d.]+\s*AC\b/gi) || []);
const parcelWord = (card.match(/\d+\s*PARCEL/gi) || []);
const unavailable = /unavailable|couldn.t reach|no parcel right there/i.test(card);

console.log("\n--- CHAMBERS CLICK VERIFY @ -94.886,29.846 (Mont Belvieu) ---");
console.log("  parcel /export image requests:", net.exportImg, net.exportImg > 0 ? "✅ outlines rendered via export" : "⚠️ no export image");
console.log("  /query point responses:", JSON.stringify(net.query));
console.log("  /identify responses:", JSON.stringify(net.identify));
console.log("  overlay highlight paths after click:", hlPaths);
console.log("  selection card acreage:", JSON.stringify(acres), " parcelWord:", JSON.stringify(parcelWord));
console.log("  card shows 'unavailable'?", unavailable);
await page.screenshot({ path: "gis-verify/chambers-parcel-click-verified.png" });

const identifyHit = net.identify.some((x) => x.prop != null && x.rings > 0);
const selected = hlPaths > 0 && (acres.length > 0 || parcelWord.length > 0) && !unavailable;
console.log("\nRESULT:", identifyHit && selected ? "✅ PASS — Chambers lot selected via /identify, outlines rendered, card populated"
  : `⚠️ CHECK (identifyHit=${identifyHit} selected=${selected})`);
await browser.close();
