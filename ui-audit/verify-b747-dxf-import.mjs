/* Headless smoke for the DXF overlay import (B747) — logged-out, on the BUILT app.
 * Drops a real .dxf through the actual dropzone file input so the full browser pipeline runs:
 * the DXF Web Worker (dxf-parser + entity→SVG render) + SVG→PNG rasterization + placement.
 *
 * Checks:
 *  1. A units-known DXF (200×100 ft rectangle, $INSUNITS=2) renders a raster (<image>) and
 *     auto-places at TRUE size — the panel Width reads ~200 ft, with no "units assumed" flag.
 *  2. A unitless DXF ($INSUNITS=0) renders AND shows the "Units assumed: feet — verify" flag.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";

const H = 535.5;
const parcel = { id: "pc1", locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const site = { id: "S", groupId: "S", site: "DXFyard", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now() };
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ S: site })}));localStorage.setItem('planarfit:currentSite:v1','S');}catch(e){}})();`;

// A 200×100 (units) drawing: closed rectangle + a diagonal + a circle + a label + a SPLINE (unsupported).
const L = (...a) => a.join("\n");
const dxf = (insunits) => L(
  "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", String(insunits), "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  "0", "LWPOLYLINE", "8", "P", "90", "4", "70", "1",
  "10", "0.0", "20", "0.0", "10", "200.0", "20", "0.0", "10", "200.0", "20", "100.0", "10", "0.0", "20", "100.0",
  "0", "LINE", "8", "P", "10", "0.0", "20", "0.0", "11", "200.0", "21", "100.0",
  "0", "CIRCLE", "8", "P", "10", "100.0", "20", "50.0", "40", "20.0",
  "0", "TEXT", "8", "P", "10", "20.0", "20", "80.0", "40", "8.0", "1", "SITE",
  "0", "SPLINE", "8", "P", "70", "8",
  "0", "ENDSEC", "0", "EOF");

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const fails = [];
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails.push(name); };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);

// Open the References/Overlay panel so the dropzone file input mounts.
for (const sel of ['[title="Overlay"]', '[title="References"]', 'button:has-text("References")']) {
  try { await page.locator(sel).first().click({ timeout: 2500 }); break; } catch (_) {}
}
await page.waitForTimeout(600);

async function dropDxf(insunits, tag) {
  const input = page.locator('input[type="file"][accept*="dxf"]').first();
  await input.setInputFiles({ name: `plan-${tag}.dxf`, mimeType: "application/dxf", buffer: Buffer.from(dxf(insunits)) });
  // wait for the raster <image> to appear (worker parse + rasterize completed)
  await page.waitForFunction(() => !!document.querySelector('image[data-overlay-image]'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
}

// ---- 1) units-known DXF ----
await dropDxf(2, "feet");
await page.screenshot({ path: OUT + "dxf-feet.png" });
const feet = await page.evaluate(() => {
  const img = document.querySelector('image[data-overlay-image]');
  const href = img && (img.getAttribute("href") || img.getAttribute("xlink:href") || "");
  // find the Width numeric input (DXF has no `sheet`, so the Width row renders)
  const width = Array.from(document.querySelectorAll("input")).map((i) => i.value).find((v) => v && Math.abs(Number(v) - 200) <= 3);
  const assumed = (document.body.innerText || "").includes("Units assumed");
  return { hasImg: !!img, isPng: /^data:image\/png/.test(href || ""), width, assumed };
});
check("B747 — DXF renders a PNG raster on the map", feet.hasImg && feet.isPng, JSON.stringify({ hasImg: feet.hasImg, isPng: feet.isPng }));
check("B747 — true-units auto-scale places the 200 ft rectangle at ~200 ft wide", !!feet.width, `width=${feet.width}`);
check("B747 — a units-KNOWN DXF shows NO 'units assumed' flag", !feet.assumed);

// ---- 2) unitless DXF → assumed-feet flag ----
// remove the first overlay, then drop the unitless one
await page.evaluate(() => { const b = document.querySelector('[title="Remove"]'); if (b) b.click(); });
await page.waitForTimeout(500);
await dropDxf(0, "unitless");
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "dxf-unitless.png" });
const unitless = await page.evaluate(() => {
  const img = document.querySelector('image[data-overlay-image]');
  const assumed = (document.body.innerText || "").includes("Units assumed");
  return { hasImg: !!img, assumed };
});
check("B747 — a unitless DXF still renders", unitless.hasImg);
check("B747 — a unitless DXF FLAGS 'Units assumed: feet — verify' (never a silent guess)", unitless.assumed);

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.length}\n` : "\nALL PASSED\n");
process.exit(fails.length ? 1 : 0);
