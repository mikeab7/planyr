/* B745 / V259 verification — the PDF/PNG export must include the VECTOR/client-drawn GIS overlay
 * layers (county/city boundaries, transmission, contours, drainage arrows, OSM/Mapillary points).
 * Drives the built app headlessly: seed a located site, boot the planner, turn the County-boundary
 * layer ON, enter print mode, confirm the "Print map layers" checkbox appears (gated for vectors
 * too), Download PDF, and assert the COMPOSED export SVG carries a `data-export-vector` group with
 * a real child <path>.
 *
 * Unlike the raster verify, a vector <g> is emitted ONLY when the layer's geometry actually loaded,
 * so this genuinely exercises the whole fetch → extract(toGeoJSON) → reproject(lngLatRingToFeet→f2p)
 * → emit chain with a real Leaflet L.geoJSON layer. Boundaries (statewide, cached) are the reliable
 * case; the ONE county /query is mocked because the sandbox egress proxy can't reach the live agency
 * host (the live imagery paint for every layer is the V259 live-app check).
 *
 * Ground-truth signal: we intercept the image/svg+xml blob buildPrintSheetSvg hands to
 * URL.createObjectURL (the exact sheet that gets rasterized into the PDF) and grep it for
 * data-export-vector. NOTE the export first AWAITS the aerial capture; in the sandbox the Esri host
 * is TLS-reset, so that capture takes the full ~22s AERIAL_INLINE_TIMEOUT before it drops the aerial
 * and builds the sheet — hence the long poll below (this is a sandbox-only wait, not a code slowness).
 *
 * Run: npm run build && npx vite preview   (then)  node ui-audit/verify-vector-overlay-print.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const site = {
  id: "b745", groupId: "b745", site: "B745 Vector Site", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ ${JSON.stringify(site.id)}: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

// Canned Harris County polygon (esri JSON) so the `vector` boundary layer loads DETERMINISTICALLY.
const countyEsri = {
  features: [{
    attributes: { CNTY_NM: "Harris" },
    geometry: { rings: [[[-95.95, 29.70], [-95.70, 29.70], [-95.70, 29.90], [-95.95, 29.90], [-95.95, 29.70]]] },
  }],
  exceededTransferLimit: false,
};
const b64decode = (s) => { try { return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(); } catch (_) { return ""; } };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(seed);
// Capture the composed sheet SVG (image/svg+xml blob) the export rasterizes.
await ctx.addInitScript(() => {
  window.__svgBlobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (o) => { try { if (o && o.type === "image/svg+xml") o.text().then((t) => window.__svgBlobs.push(t)).catch(() => {}); } catch (_) {} return orig(o); };
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
// Fulfill the county-boundary query (direct-to-agency OR via the /api/gis-cache proxy) with canned geometry.
await page.route("**/*", (route) => {
  const u = route.request().url();
  const proxied = u.includes("/api/gis-cache/svc/") ? b64decode(u.split("/svc/")[1]?.split("/")[0] || "") : "";
  if (/Texas_County_Boundaries/i.test(u) || /Texas_County_Boundaries/i.test(proxied)) {
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(countyEsri) });
  }
  return route.continue();
});
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2000);

// Enable the County-boundary vector layer.
const turnedOn = await page.evaluate((labels) => {
  const lbls = [...document.querySelectorAll("label")];
  let n = 0;
  for (const want of labels) { const lbl = lbls.find((l) => l.textContent.includes(want)); const cb = lbl && lbl.querySelector('input[type="checkbox"]'); if (cb && !cb.checked) cb.click(); if (cb && cb.checked) n++; }
  return n;
}, ["County boundaries"]);
console.log("vector layers turned on:", turnedOn);
// Wait for the (mocked) county geometry to paint as a Leaflet path.
let painted = 0;
for (let i = 0; i < 24; i++) { await page.waitForTimeout(500); painted = await page.evaluate(() => document.querySelectorAll('.leaflet-overlay-pane path, .leaflet-pane path').length); if (painted >= 1) break; }
console.log("county boundary painted (leaflet paths):", painted);

// Enter print mode + Download PDF.
await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
const cbVisible = await page.locator('label:has-text("Print map layers")').first().isVisible().catch(() => false);
await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 });

// Poll for the composed sheet SVG (blocks on the ~22s sandbox aerial timeout first).
let sheet = "";
for (let i = 0; i < 150; i++) { await page.waitForTimeout(500); const blobs = await page.evaluate(() => window.__svgBlobs || []); sheet = blobs.find((t) => /data-export-vector/.test(t)) || ""; if (sheet) break; if (blobs.some((t) => /Site area/.test(t))) { sheet = ""; break; } }

const groups = (sheet.match(/data-export-vector/g) || []).length;
const firstGroup = (sheet.match(/data-export-vector[\s\S]*?<\/g>/) || [""])[0];
const pathsInGroup = (firstGroup.match(/<path/g) || []).length;
const hasCounty = /jur_county/.test(sheet);
console.log("printMapLayers checkbox visible:", cbVisible);
console.log("export SVG data-export-vector groups:", groups, "| child <path> in first group:", pathsInGroup, "| jur_county tag:", hasCounty);
console.log("page errors:", errs.length ? errs.slice(0, 5) : "none");

const ok = cbVisible && painted >= 1 && groups >= 1 && pathsInGroup >= 1 && hasCounty;
console.log(ok ? "PASS ✅ — vector GIS layer composited into the PDF export SVG (fetch→reproject→emit end-to-end)" : "FAIL ❌ — see counts above");
await browser.close();
process.exit(ok ? 0 : 1);
