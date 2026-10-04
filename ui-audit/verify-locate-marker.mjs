/* Verify the shared my-location marker + button states (NEW-1/NEW-2). Logged-out, mocked geolocation.
 *  - blue core + white ring (computed style), above parcels (pane z-index, pointer-events none)
 *  - accuracy circle radius tracks accuracy in ground METRES across two zoom levels
 *  - NO cone without a heading; cone present + rotated after a stubbed deviceorientation event
 *    (both the iOS webkitCompassHeading shape and the absolute-alpha shape)
 *  - button: idle → following (solid blue) → panned-away (located) → tap re-centres → tap stops
 *  - KNOWN-GOOD ARM: the metres→pixels expectation is computed independently from Web Mercator
 *    and compared to the painted SVG radius; a run where that arm disagrees is VOID.
 * Run: BASE_URL=http://localhost:4173/ node ui-audit/verify-locate-marker.mjs [--shots dir] */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || undefined;
const shotsIdx = process.argv.indexOf("--shots");
const SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
const results = [];
const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const LAT = 29.786, LON = -95.83, ACC = 60;
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, geolocation: { latitude: LAT, longitude: LON, accuracy: ACC }, permissions: ["geolocation"] });
await ctx.addInitScript(() => {
  window.__PLANYR_E2E = true;
  // iOS-shaped gate: compass data needs requestPermission() from the tap; the harness grants it.
  if (typeof DeviceOrientationEvent !== "undefined") DeviceOrientationEvent.requestPermission = async () => window.__orientPerm || "granted";
});
const page = await ctx.newPage();
await assertMeasurable(page, "verify-locate-marker");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="locate-me-btn"]', { timeout: 20000 });
const btn = page.locator('[data-testid="locate-me-btn"]');
const st = () => btn.getAttribute("data-locate-state");

check("starts idle with outline arrow", (await st()) === "idle" && (await btn.evaluate((b) => getComputedStyle(b.querySelector("svg")).fill)) === "none");

await btn.click();
await page.waitForSelector('[data-testid="locate-dot"]', { timeout: 8000 });
check("tap → following", (await st()) === "following");
const fillFollow = await btn.evaluate((b) => getComputedStyle(b.querySelector("svg")).fill);
const blue = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="locate-dot"]')).backgroundColor);
check("button arrow is solid blue while following", fillFollow === blue, `${fillFollow} vs ${blue}`);
const dot = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('[data-testid="locate-dot"]')); return { bg: c.backgroundColor, bw: c.borderTopWidth, bc: c.borderTopColor }; });
check("dot is blue (26,115,232) with a white ring", dot.bg === "rgb(26, 115, 232)" && dot.bc === "rgb(255, 255, 255)" && parseFloat(dot.bw) >= 2, JSON.stringify(dot));
const paneInfo = await page.evaluate(() => { const p = document.querySelector(".leaflet-locate-pane"); const c = getComputedStyle(p); return { z: +c.zIndex, pe: c.pointerEvents, markerZ: +getComputedStyle(document.querySelector(".leaflet-marker-pane")).zIndex, overlayZ: +getComputedStyle(document.querySelector(".leaflet-overlay-pane")).zIndex }; });
check("marker pane sits above parcel overlays and site pins and is click-through", paneInfo.z > paneInfo.markerZ && paneInfo.z > paneInfo.overlayZ && paneInfo.pe === "none", JSON.stringify(paneInfo));
check("no cone without a heading (desktop)", await page.evaluate(() => { const c = document.querySelector(".locate-cone"); return !c || getComputedStyle(c).display === "none"; }));

// accuracy circle radius in metres across two zoom levels
const expectPx = (lat, z, m) => m / ((40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z));
async function circleRadiusPx() { return page.evaluate(() => { const p = document.querySelector("path.locate-accuracy"); if (!p) return null; const b = p.getBoundingClientRect(); return b.width / 2; }); }
const radii = [];
for (const z of [16, 18]) {
  await page.evaluate((zz) => window.__mapFinderMap.setZoom(zz, { animate: false }), z);
  await page.waitForTimeout(500);
  const r = await circleRadiusPx();
  const exp = expectPx(LAT, z, ACC);
  radii.push(r);
  check(`accuracy circle radius matches ${ACC} m at zoom ${z}`, r != null && Math.abs(r - exp) / exp < 0.04, `painted ${r && r.toFixed(1)}px expected ${exp.toFixed(1)}px`);
}
check("circle grows with zoom (4× across 2 zoom levels)", radii[0] && radii[1] && Math.abs(radii[1] / radii[0] - 4) < 0.2, `${radii[1] / radii[0]}`);
await page.evaluate(() => window.__mapFinderMap.setZoom(8, { animate: false })); await page.waitForTimeout(400);
check("circle hidden when it would hug the dot (zoomed far out)", (await circleRadiusPx()) === null);
await page.evaluate(() => window.__mapFinderMap.setZoom(17, { animate: false })); await page.waitForTimeout(400);

// heading: absolute alpha (Android shape)
await page.evaluate(() => { const e = new Event("deviceorientationabsolute"); e.alpha = 90; e.absolute = true; window.dispatchEvent(e); });
await page.waitForTimeout(150);
let cone = await page.evaluate(() => { const c = document.querySelector(".locate-cone"); return { d: getComputedStyle(c).display, h: c.getAttribute("data-heading"), t: c.style.transform }; });
check("cone appears rotated for an absolute alpha event (alpha 90 → heading 270)", cone.d === "block" && cone.h === "270", JSON.stringify(cone));
// iOS shape
await page.waitForTimeout(150);
await page.evaluate(() => { const e = new Event("deviceorientation"); e.webkitCompassHeading = 90; e.alpha = 5; window.dispatchEvent(e); });
await page.waitForTimeout(150);
cone = await page.evaluate(() => { const c = document.querySelector(".locate-cone"); return { h: +c.getAttribute("data-heading") }; });
check("cone follows an iOS webkitCompassHeading event (moves toward 90)", cone.h > 0 && cone.h < 270 && cone.h !== 270, JSON.stringify(cone));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/locate-vector-or-default.png` });

// panned away → located; tap re-centres; second tap stops
await page.mouse.move(450, 350); await page.mouse.down(); await page.mouse.move(250, 250, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(300);
check("panning away → located (outline blue)", (await st()) === "located" && (await btn.evaluate((b) => getComputedStyle(b.querySelector("svg")).fill)) === "none" && (await btn.evaluate((b) => getComputedStyle(b).color)) === "rgb(26, 115, 232)");
await btn.click(); await page.waitForTimeout(300);
check("tap re-centres → following", (await st()) === "following");
await btn.click(); await page.waitForTimeout(200);
check("tap while following → tracking off, marker removed, idle", (await st()) === "idle" && (await page.locator('[data-testid="locate-dot"]').count()) === 0);

// live position update moves the marker without re-creating it
await btn.click(); await page.waitForSelector('[data-testid="locate-dot"]');
await page.evaluate(() => { window.__dotRef = document.querySelector('[data-testid="locate-dot"]'); });
await ctx.setGeolocation({ latitude: LAT + 0.0004, longitude: LON + 0.0004, accuracy: ACC });
await page.waitForTimeout(1500);
check("position update keeps the same marker element (no flicker re-creation)", await page.evaluate(() => window.__dotRef === document.querySelector('[data-testid="locate-dot"]') && document.contains(window.__dotRef)));

// denied permission → no stuck spinner
const ctx2 = await browser.newContext({ viewport: { width: 900, height: 700 } });
const p2 = await ctx2.newPage(); await p2.goto(BASE, { waitUntil: "load" });
await p2.waitForSelector('[data-testid="locate-me-btn"]');
const b2 = p2.locator('[data-testid="locate-me-btn"]');
await b2.click({ force: true }); await p2.waitForTimeout(1200);
const s2 = await b2.getAttribute("data-locate-state");
check("denied/unavailable → button back to idle/blocked, no spinner", (s2 === "idle" || s2 === "blocked") && !(await b2.evaluate((b) => b.style.animation)), s2);

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS"); process.exit(failed ? 1 : 0);
