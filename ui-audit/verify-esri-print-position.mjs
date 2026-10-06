/* B2095745 — PRINT PLACEMENT + LEGIBILITY of an esriFeature GIS layer, on the REAL export sheet.
 * Seeds a Georgia plan (origin 34.37,-84.92, parcel ±535.5 ft), mocks the HPMS service with two GeoJSON lines whose
 * endpoints are the parcel's four ground corners, turns the layer on, runs File > Download PDF, and reads the sheet SVG
 * the PDF is rasterised from. KNOWN-GOOD ARM: the layer vertices must equal the parcel corners the plan itself drew
 * (data-view-offx/ppf on the nested canvas ± 535.5 ft × ppf). LEGIBILITY: the printed line weight must be >= 1 pt and
 * its opacity >= 0.85, with a casing underlay. Run: npm run build && npx vite preview --port 4173, then
 *   PW_CHROME=<chrome> node ui-audit/verify-esri-print-position.mjs [base] */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { feetToLatLng } from "../src/workspaces/site-planner/lib/arcgis.js";
const PROXY = process.env.HTTPS_PROXY;
const BASE = process.argv[2] || "http://localhost:4173/";
const O = { lat: 34.37, lon: -84.92 };
const H = 535.5;
const parcel = { id: "pc1", locked: true, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const site = { id: "GA1", groupId: "GA1", site: "T", name: "C", origin: O, county: "ga_bartow", parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now() };
// planner feet: +y is NORTH? use the app's own inverse to be safe
const ll = (x, y) => { const p = feetToLatLng({ x, y }, O.lat, O.lon); return Array.isArray(p) ? [p[1], p[0]] : [p.lng, p.lat]; };
const A = ll(-H, -H), B = ll(H, H), C = ll(-H, H), D = ll(H, -H);
const feats = [{ attributes: { AADT: 50000, OBJECTID: 1 }, geometry: { paths: [[A, B]] } }, { attributes: { AADT: 20000, OBJECTID: 2 }, geometry: { paths: [[C, D]] } }];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME, args: ["--no-sandbox", ...(PROXY ? ["--proxy-server=" + PROXY, "--proxy-bypass-list=localhost;127.0.0.1"] : [])] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(`(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify({GA1:${JSON.stringify(site)}}));localStorage.setItem('planarfit:currentSite:v1','GA1');}catch(e){}})()`);
await ctx.addInitScript(() => { window.__svgBlobs = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { try { if (b && b.type === "image/svg+xml") b.text().then((t) => window.__svgBlobs.push(t)); } catch (_) {} return o(b); }; });
const mock = { type: "FeatureCollection", features: feats.map((f, i) => ({ type: "Feature", id: 900000 + i, properties: { OBJECTID: 900000 + i, AADT: f.attributes.AADT }, geometry: { type: "LineString", coordinates: f.geometry.paths[0] } })) };
await ctx.route(/HPMS_FULL_US_2022.*\/query/, (r) => { return r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(mock) }); });
const ustMock = { type: "FeatureCollection", features: [{ type: "Feature", id: 7, properties: { OBJECTID: 7, LOCATION_NAME: "B2095745 TEST" }, geometry: { type: "Point", coordinates: A } }] };
await ctx.route(/UST_coordinates.*\/query/, (r) => r.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(ustMock) }));
const page = await ctx.newPage();
await assertMeasurable(page, "verify-esri-print-position");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2500);
try { await page.locator("button:visible", { hasText: /^Site$/ }).first().click({ timeout: 5000 }); } catch (_) {}
await page.waitForTimeout(3500);
await page.locator('button[aria-label^="Layers"]').click({ timeout: 5000 });
await page.waitForTimeout(1200);
const n = "Traffic volumes (HPMS 2022, highways)";
for (let k = 0; k < 3 && !(await page.getByText(n).count()); k++) { try { await page.getByText(/^Access/i).first().click({ timeout: 800 }); } catch (_) {} await page.waitForTimeout(500); }
await page.locator("label:visible", { hasText: n }).first().locator('input[type="checkbox"]').first().check();
const un = "Underground storage tanks (Georgia EPD)";
for (let k = 0; k < 3 && !(await page.getByText(un).count()); k++) { try { await page.getByText(/^Environmental|^Hazards/i).first().click({ timeout: 800 }); } catch (_) {} await page.waitForTimeout(500); }
try { await page.locator("label:visible", { hasText: un }).first().locator('input[type="checkbox"]').first().check({ timeout: 4000 }); } catch (_) { console.log("note: could not toggle the UST row"); }
await page.waitForTimeout(8000);
await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /^Continue ➜$/ }).first().click({ timeout: 8000 });
await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20000 });
await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 });
let sheet = "";
for (let i = 0; i < 160; i++) { await page.waitForTimeout(500); const b = await page.evaluate(() => window.__svgBlobs || []); sheet = b.find((t) => /data-export-vector/.test(t)) || ""; if (sheet) break; }
await browser.close();
const fails = [];
const grp = (sheet.match(/data-layer-id="hpms_aadt"[\s\S]*?<\/g>/) || [""])[0];
if (!grp) fails.push("no hpms_aadt group in the export sheet (layer absent from the print)");
const canvas = (sheet.match(/<svg[^>]*data-testid="planner-canvas"[^>]*>/) || [""])[0];
const num = (re, src) => { const m = src.match(re); return m ? Number(m[1]) : NaN; };
const offX = num(/data-view-offx="([-\d.]+)"/, canvas), offY = num(/data-view-offy="([-\d.]+)"/, canvas), ppf = num(/data-view-ppf="([-\d.]+)"/, canvas);
const vb = (canvas.match(/viewBox="([-\d. ]+)"/) || [, ""])[1].split(/\s+/).map(Number);
const wantX = [offX - H * ppf, offX + H * ppf], wantY = [offY - H * ppf, offY + H * ppf];
const lines = [...grp.matchAll(/<path d="M([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+)"[^>]*stroke-width="([\d.]+)"[^>]*stroke-opacity="([\d.]+)"/g)];
if (lines.length < 2) fails.push("expected 2 printed HPMS lines, found " + lines.length);
const near = (v, arr) => arr.some((a) => Math.abs(a - v) < 1.5);
for (const m of lines) {
  const [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
  if (![x1, x2].every((x) => near(x, wantX)) || ![y1, y2].every((y) => near(y, wantY))) fails.push(`line ${x1},${y1}→${x2},${y2} is not at the parcel corners x${wantX} y${wantY}`);
  // the default print frame may crop the parcel corners (no buildings drawn), so frame inclusion is asked of the crossing point
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  if (!(cx > vb[0] && cx < vb[0] + vb[2] && cy > vb[1] && cy < vb[1] + vb[3])) fails.push("the line's midpoint is outside the exhibit frame " + vb);
  // legibility: width in clone units → pt via the sheet scale (nested svg px per viewBox unit; the sheet is 1100×850 = 11×8.5 in)
  const wPx = Number(canvas.match(/ width="([\d.]+)"/)[1]);
  const pt = Number(m[5]) * (wPx / vb[2]) * 0.72;
  if (!(pt >= 0.95)) fails.push("printed line weight " + pt.toFixed(2) + " pt is below the 1 pt floor");
  if (!(Number(m[6]) >= 0.85)) fails.push("printed opacity " + m[6] + " is below 0.85");
}
const ust = (sheet.match(/data-layer-id="ga_ust"[\s\S]*?<\/g>/) || [""])[0];
const cm = ust.match(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/);
if (!cm) fails.push("no ga_ust point circle in the export sheet");
else {
  if (Math.abs(Number(cm[1]) - wantX[0]) > 1.5 || Math.abs(Number(cm[2]) - wantY[0]) > 1.5) fails.push("UST point is not at the parcel corner A (min x, min y)");
  const wPx2 = Number(canvas.match(/ width="([\d.]+)"/)[1]);
  const diaPt = Number(cm[3]) * (wPx2 / vb[2]) * 0.72;
  if (!(diaPt >= 2.3)) fails.push("printed point radius is only " + diaPt.toFixed(2) + " pt");
}
if (!/data-vcase="1"/.test(grp)) fails.push("no casing underlay on the printed layer");
console.log(fails.length ? "FAIL ❌\n - " + fails.join("\n - ") : "PASS ✅ — HPMS lines print at the parcel corners, inside the frame, at a legible weight with a casing");
process.exit(fails.length ? 1 : 0);
