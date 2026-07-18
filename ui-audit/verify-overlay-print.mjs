/* B739 / V257 verification — the PDF/PNG export must composite the live GIS RASTER overlay layers
 * (FEMA floodplain, TxRRC pipelines, wetlands, utilities, ground relief). Drives the built app
 * headlessly: seed a located site, boot the planner, turn FEMA + pipelines ON, enter print mode,
 * confirm the "Print map layers" checkbox appears, Download PDF, and assert the COMPOSED export SVG
 * carries `image[data-export-overlay]` nodes for those layers.
 *
 * The overlay <image> is emitted in buildExportSvg, but exportOverlaysForFrame HONESTLY skips a
 * layer whose host is confirmed-dead (`layerStatus==="failed"`) — the LOUD-FAILURE design. In the
 * sandbox the live FEMA/RRC hosts are TLS-reset, so we MOCK them healthy (a valid service descriptor
 * for the ?f=json probe + a 1×1 PNG for the export image) so the layers stay "loaded" and the
 * compositing path runs exactly as it does against a live agency. (The live imagery paint is the
 * V257 live-app check.) Ground-truth signal: intercept the image/svg+xml sheet blob and grep it.
 *
 * NOTE: the export first AWAITS the aerial capture; the sandbox Esri host is TLS-reset, so that
 * takes the full ~22s AERIAL_INLINE_TIMEOUT before the sheet builds — hence the long poll (a
 * sandbox-only wait, not code slowness).
 *
 * Run: npm run build && npx vite preview   (then)  node ui-audit/verify-overlay-print.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const site = {
  id: "b739", groupId: "b739", site: "B739 Bayou Site", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ ${JSON.stringify(site.id)}: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

// 1×1 transparent PNG — stands in for any agency export image so the raster layers fire 'load'.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const DESC = JSON.stringify({ currentVersion: 10.91, mapName: "Layers", singleFusedMapCache: false, capabilities: "Map,Query,Data", supportedImageFormatTypes: "PNG32,PNG24,PNG,JPG", fullExtent: { xmin: -1e7, ymin: 3e6, xmax: -1e7, ymax: 4e6, spatialReference: { wkid: 102100 } }, spatialReference: { wkid: 102100 }, layers: [{ id: 0, name: "L0" }] });
const CORS = { "access-control-allow-origin": "*" };
const isAgency = (u) => /hazards\.fema\.gov|gis\.rrc\.texas\.gov|fwsprimary\.wim\.usgs\.gov|\/api\/gis-cache\//i.test(u);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(seed);
await ctx.addInitScript(() => {
  window.__svgBlobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (o) => { try { if (o && o.type === "image/svg+xml") o.text().then((t) => window.__svgBlobs.push(t)).catch(() => {}); } catch (_) {} return orig(o); };
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
// Mock the agency raster hosts healthy: ?f=json → service descriptor; anything else → a PNG.
await page.route("**/*", (route) => {
  const u = route.request().url();
  if (isAgency(u)) {
    if (/f=json|[?&]f=json/i.test(u) || (/\?/.test(u) && /f=json/i.test(u))) return route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: DESC });
    return route.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG });
  }
  return route.continue();
});
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2000);

// Enable the FEMA + pipelines raster layers.
const turnedOn = await page.evaluate((labels) => {
  const lbls = [...document.querySelectorAll("label")];
  let n = 0;
  for (const want of labels) { const lbl = lbls.find((l) => l.textContent.includes(want)); const cb = lbl && lbl.querySelector('input[type="checkbox"]'); if (cb && !cb.checked) cb.click(); if (cb && cb.checked) n++; }
  return n;
}, ["FEMA flood zones", "Pipelines"]);
console.log("raster layers turned on:", turnedOn);
await page.waitForTimeout(3500);

// Enter print mode + Download PDF.
await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
const cbVisible = await page.locator('label:has-text("Print map layers")').first().isVisible().catch(() => false);
await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 });

// Poll for the composed sheet SVG (blocks on the ~22s sandbox aerial timeout first).
let sheet = "";
for (let i = 0; i < 150; i++) { await page.waitForTimeout(500); const blobs = await page.evaluate(() => window.__svgBlobs || []); sheet = blobs.find((t) => /data-export-overlay/.test(t)) || ""; if (sheet) break; if (blobs.some((t) => /Site area/.test(t))) { sheet = blobs.find((t) => /Site area/.test(t)) || ""; break; } }

const overlayImgs = (sheet.match(/data-export-overlay/g) || []).length;
console.log("printMapLayers checkbox visible:", cbVisible);
console.log("export SVG image[data-export-overlay] nodes:", overlayImgs);
console.log("page errors:", errs.length ? errs.slice(0, 5) : "none");

const ok = cbVisible && turnedOn >= 1 && overlayImgs >= 1;
console.log(ok ? "PASS ✅ — raster GIS layers composited into the PDF export SVG (data-export-overlay wiring end-to-end)" : "FAIL ❌ — see counts above");
await browser.close();
process.exit(ok ? 0 : 1);
