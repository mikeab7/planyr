/* B167/B168 verification — basemap tile sharpness (detectRetina).
 *
 * Drives the headless map finder twice — once at devicePixelRatio 1 (standard
 * display) and once at devicePixelRatio 2 (HiDPI/"retina") — and records the
 * zoom level of every Esri World_Imagery tile actually requested, plus the
 * map's own zoom. With detectRetina:true the HiDPI run must request tiles one
 * zoom level HIGHER than the map zoom (2x pixel density, downsampled = sharp);
 * the DPR-1 run requests tiles AT the map zoom. Also confirms tiles return 200.
 *
 * Run: preview server on :4173, then `node gis-verify/retina-basemap-verify.mjs`
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || undefined;

// Boot straight to the map finder centered on a known Katy/Houston parcel.
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({
    a1: { id:"a1", groupId:"a1", site:"Katy Logistics Park", name:"Plan 1",
          origin:{ lat:29.786, lon:-95.83 }, county:"harris", parcels:[], els:[],
          measures:[], callouts:[], markups:[], settings:{}, underlay:null,
          updatedAt: Date.now(), data:{ status:"active" } }
  }));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch(e){} })();`;

const TILE_RE = /World_Imagery\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/;

async function run(dpr) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const tiles = [];        // { z } of each imagery tile requested
  let ok = 0, bad = 0;
  page.on("response", (resp) => {
    const m = TILE_RE.exec(resp.url());
    if (!m) return;
    tiles.push(Number(m[1]));
    if (resp.status() === 200) ok++; else bad++;
  });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  // Fit to the saved site so the map zooms in over the parcel, then settle.
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (_) {}
  await page.waitForTimeout(2500);
  const mapZoom = await page.evaluate(() => {
    // Reach the Leaflet map instance via the rendered container.
    const el = document.querySelector(".leaflet-container");
    // Leaflet stores the map on a private field; fall back to scanning.
    for (const k in window) { try { const v = window[k]; if (v && v._leaflet_id && v.getZoom) return v.getZoom(); } catch(_){} }
    return el ? "(map found, zoom unknown)" : "(no map)";
  });
  await browser.close();
  const zs = [...new Set(tiles)].sort((a,b)=>a-b);
  const top = tiles.length ? Math.max(...tiles) : null;
  return { dpr, mapZoom, tileZoomsSeen: zs, topTileZoom: top, tileCount: tiles.length, ok, bad };
}

const r1 = await run(1);
const r2 = await run(2);
console.log("DPR 1 (standard):", JSON.stringify(r1));
console.log("DPR 2 (retina)  :", JSON.stringify(r2));
const bumped = r2.topTileZoom != null && r1.topTileZoom != null && r2.topTileZoom > r1.topTileZoom;
console.log(`\nRESULT: detectRetina ${bumped ? "ENGAGED ✓ (retina requests higher-zoom tiles → sharper)" : "NOT observed"}`);
console.log(`Imagery loaded: DPR1 ${r1.ok} ok / ${r1.bad} bad · DPR2 ${r2.ok} ok / ${r2.bad} bad`);
