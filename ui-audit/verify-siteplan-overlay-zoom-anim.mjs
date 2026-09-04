/* Verify B849841/NEW-2 — "the site plan does not track the map during zoom." Owner repro: with a
 * site plan visible on the map, zooming in or out shows the imagery moving smoothly while the plan
 * stays fixed on screen and snaps to its new position at the end.
 *
 * MEASURED ROOT CAUSE (not the task's hypothesis restated — actually traced through the installed
 * leaflet-src.js): the overlay repositioned only on Leaflet's "move"/"zoom"/"viewreset" events. Per
 * Map.js `_animateZoom`, those fire with the FINAL post-zoom state already current — synchronously,
 * at the START of the ~250ms animated transition, not at the end. So the overlay's transform was
 * being set to the correct RESTING value the INSTANT the gesture began; with no CSS transition
 * opted into (no `leaflet-zoom-animated` class), that write painted as an immediate jump. The tiles
 * (and everything else Leaflet itself draws) then spent the next ~250ms visually easing to catch up
 * to a position the plan had already silently snapped to — which is exactly "the map moving while
 * the plan stays fixed... it snaps to its new position at the end", just with the snap's true
 * timing inverted from how it reads to the eye. Confirmed the SECOND candidate (per-zoom
 * re-rasterisation) is not in play: rotatedImageLayer.js never re-decodes the image on zoom, only
 * re-projects its corners — there is no raster path here to re-rasterize.
 *
 * FIX (rotatedImageLayer.js): add the `leaflet-zoom-animated` class (opts into Leaflet's own CSS
 * transition, scoped by the temporary `leaflet-zoom-anim` class Leaflet's Map.js adds to `_mapPane`
 * for the animation's duration) plus a `zoomanim` handler that writes the TARGET-view transform
 * directly (via Leaflet's own private `_latLngToNewLayerPoint`, the same helper ImageOverlay/Marker/
 * the vector renderer use for this) — the exact technique `L.ImageOverlay._animateZoom` uses.
 *
 * VERIFICATION BAR (per the task): sample the overlay's rendered screen position AND a ground-truth
 * position on every animation frame across a programmatic zoom, and report the WORST-frame error —
 * never eyeball a screenshot. Ground truth here is Leaflet's own canonical zoom-animated element (an
 * `L.marker` at the identical latLng as the overlay's own top-left corner) — Marker.js's own
 * `_animateZoom` is the reference implementation of "track a georeferenced point through an animated
 * zoom", so if the overlay stays coincident with it on every sampled frame, it is participating in
 * the same mechanism Leaflet's own tiles/markers use, not just correct once the dust settles.
 *
 * Driven against a bare Leaflet map (ui-audit/site-plan-zoom-anim-harness.html/.js) — no React app,
 * no Supabase, no auth — because the defect and the fix live entirely inside rotatedImageLayer.js's
 * relationship with Leaflet's own zoom events; no signed-in overlay or real project data is needed
 * to observe it. Run: npm run dev &  then  node ui-audit/verify-siteplan-overlay-zoom-anim.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const HARNESS_URL = `${BASE}/ui-audit/site-plan-zoom-anim-harness.html`;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

// Baseline slack for the comparison itself (Leaflet's own Marker rounds its layer point via
// `.round()`; our overlay's matrix uses raw floats — a sub-pixel disagreement even on a CORRECT
// build) plus real antialiasing/interpolation slop during a genuinely eased CSS transition.
// A real "does not track the zoom" defect does not produce a FEW extra pixels — it produces the
// overlay sitting at its PRE-zoom (or already-final) screen position while the reference marker
// (and the tiles) are mid-flight, which is tens to hundreds of pixels of error depending on the
// zoom delta and the corner's distance from the zoom's anchor point.
const TOLERANCE_PX = 4;

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
let pageErrors = 0;
page.on("pageerror", (e) => { pageErrors++; console.log("  [pageerror]", String(e).slice(0, 200)); });
page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 200)); });

await assertMeasurable(page, "verify-siteplan-overlay-zoom-anim");
await page.goto(HARNESS_URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__zoomAnimHarness && window.__zoomAnimHarness.ready, { timeout: 8000 });

async function measure(label, fromZoom, toZoom) {
  await page.evaluate((z) => window.__zoomAnimHarness.setZoom(z), fromZoom);
  await page.waitForTimeout(150); // let the resting frame settle before starting the timed gesture
  const { worst, count, startZoom } = await page.evaluate((z) => window.__zoomAnimHarness.runZoom(z), toZoom);
  ok(`${label} (zoom ${fromZoom} → ${toZoom}): worst-frame anchor error ≤ ${TOLERANCE_PX}px over ${count} sampled frames`,
    count > 3 && worst <= TOLERANCE_PX,
    `worst=${worst.toFixed(2)}px  frames=${count}  landedZoom=${startZoom}`);
  return worst;
}

const zoomInWorst = await measure("Zoom IN", 16, 18);
const zoomOutWorst = await measure("Zoom OUT", 18, 16);
const fractionalWorst = await measure("Fractional zoom step", 16, 16.75);

ok("no page errors during any zoom gesture", pageErrors === 0, `pageErrors=${pageErrors}`);

console.log(`\nWorst-frame anchor error — zoom in: ${zoomInWorst.toFixed(2)}px · zoom out: ${zoomOutWorst.toFixed(2)}px · fractional: ${fractionalWorst.toFixed(2)}px (tolerance ${TOLERANCE_PX}px)`);

await browser.close();
const fail = results.filter((r) => !r.pass).length;
console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILURE(S)`} (${results.length} checks)`);
process.exit(fail === 0 ? 0 : 1);
