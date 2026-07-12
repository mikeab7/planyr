/* Live click-through: prove a Chambers County lot SELECTS + its outlines RENDER from
 * CCAD's own live public service (ChambersCADPublic, Pandai-hosted) after the B787
 * repoint off the lagged statewide TxGIO harvest. Unlike TxGIO (whose /query is disabled
 * → /export image display + /identify clicks), CCAD has /query ENABLED, so outlines draw
 * as a queryable vector layer and a click selects via /query directly. Drives the real
 * app in headless Chromium through the agent proxy.
 *
 * NOTE: the CCAD host (gisdata.pandai.com) may be egress-blocked from the build sandbox
 * (policy 403) — this harness is for a browser-equipped run on/against planyr.io. If CCAD
 * is unreachable, the app degrades to the statewide TxGIO outlines + /identify (the old
 * path), which this harness also reports so the fallback is visible. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = process.env.APP || "http://localhost:4173/";
const PROXY = process.env.HTTPS_PROXY || "http://127.0.0.1:43417";
// A Mont Belvieu (Chambers Co.) parcel. Grand Port (CCAD-verified parcel 53773) is an
// alternative if this point moves.
const PT = [29.846, -94.886];
const CCAD_RE = /gisdata\.pandai\.com/;                 // CCAD's own live service (the B787 primary)
const TXGIO_RE = /geographic\.texas\.gov/;              // statewide fallback (outlines/identify)

const browser = await chromium.launch({ executablePath: EXEC, headless: true, proxy: { server: PROXY }, args: ["--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });

const net = { ccadQuery: [], ccadTiles: 0, txgioIdentify: [], txgioExport: 0 };
page.on("response", async (r) => {
  const u = r.url();
  const isPt = /esriGeometryPoint/.test(decodeURIComponent(u));
  if (CCAD_RE.test(u)) {
    if (/\/query\b/.test(u)) {
      try { const j = await r.json(); net.ccadQuery.push(j.error ? { err: j.error.message?.slice(0, 40) } : { n: (j.features || []).length, pt: isPt }); }
      catch (e) { net.ccadQuery.push({ err: String(e).slice(0, 40) }); }
    }
    return;
  }
  if (TXGIO_RE.test(u)) {
    if (/\/export\?/.test(u)) { net.txgioExport++; return; }
    if (/\/identify\?/.test(u)) {
      try { const j = await r.json(); const f = (j.results || [])[0]; net.txgioIdentify.push({ n: (j.results || []).length, prop: f?.attributes?.prop_id }); }
      catch (e) { net.txgioIdentify.push({ err: String(e).slice(0, 40) }); }
    }
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
await page.waitForTimeout(5000); // let the parcel outlines + basemap tiles paint

const px = await page.evaluate(([la, ln]) => { const p = window.__MAP__.latLngToContainerPoint([la, ln]); const r = document.querySelector(".leaflet-container").getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, PT);
await page.mouse.click(px.x, px.y);
await page.waitForTimeout(4000);

const hlPaths = await page.evaluate(() => [...document.querySelectorAll(".leaflet-overlay-pane path")].filter((p) => { const d = p.getAttribute("d") || ""; return d.length > 20; }).length);
const card = await page.locator("body").innerText().catch(() => "");
const acres = (card.match(/[\d.]+\s*AC\b/gi) || []);
const parcelWord = (card.match(/\d+\s*PARCEL/gi) || []);
const unavailable = /unavailable|couldn.t reach|no parcel right there/i.test(card);

console.log("\n--- CHAMBERS CLICK VERIFY @ -94.886,29.846 (Mont Belvieu) — B787 CCAD repoint ---");
console.log("  CCAD /query responses:", JSON.stringify(net.ccadQuery), net.ccadQuery.some((x) => x.n > 0) ? "✅ CCAD answered" : "⚠️ no CCAD /query hit");
console.log("  TxGIO fallback — /export images:", net.txgioExport, " /identify:", JSON.stringify(net.txgioIdentify));
console.log("  overlay highlight paths after click:", hlPaths);
console.log("  selection card acreage:", JSON.stringify(acres), " parcelWord:", JSON.stringify(parcelWord));
console.log("  card shows 'unavailable'?", unavailable);
await page.screenshot({ path: "gis-verify/chambers-parcel-click-verified.png" });

const ccadHit = net.ccadQuery.some((x) => x.n > 0);
const txgioFallback = net.txgioIdentify.some((x) => x.prop != null) || net.txgioExport > 0;
const selected = hlPaths > 0 && (acres.length > 0 || parcelWord.length > 0) && !unavailable;
console.log("\nRESULT:",
  ccadHit && selected ? "✅ PASS — Chambers lot selected from CCAD's own /query, outlines rendered, card populated (B787 goal met)"
  : selected && txgioFallback ? "⚠️ FALLBACK — CCAD unreachable; served by the statewide TxGIO fallback (no regression, but the B787 goal — matching the CCAD website — is unmet until CCAD is reachable)"
  : `❌ CHECK (ccadHit=${ccadHit} selected=${selected} txgioFallback=${txgioFallback})`);
await browser.close();
