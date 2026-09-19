#!/usr/bin/env node
/* NEW-2 (B1783329) — the RED-PROOF for the polygon crop (NEW-1/B1783328): drives the real crop
 * modules (pdfRaster.js, overlayCrop.js) against the four committed sample sheets
 * (test/fixtures/site-plan-crop/) in a real headless browser, no auth required — `site_plan_overlays`
 * itself has no logged-out path at all, so this covers what CAN be automated without a signed-in
 * account: the PDF rasterisation (incl. the /Rotate audit), the polygon geometry, and the REAL CSS
 * clip-path value applied to a REAL <img> and hit-tested by the browser's own compositor.
 *
 * What this does NOT and cannot cover: the actual site_plan_overlays upload → place → crop → map
 * flow (needs a signed-in account), locked-overlay refusal end to end, PDF/PNG/KMZ export (this
 * feature has no export path at all today — see the item this ships with), and move/resize/rotate
 * welding the crop to the image on a real placed overlay. Those are the item's own `Verify: live`
 * steps, `Blocker: auth`.
 *
 * Run:  node ui-audit/verify-site-plan-crop-fixtures.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok || r.status === 404) return true; } catch (_) { /* not up yet */ }
    await delay(500);
  }
  throw new Error("dev server did not come up");
}

async function run() {
  const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let viteOut = "";
  vite.stdout.on("data", (d) => { viteOut += d; });
  vite.stderr.on("data", (d) => { viteOut += d; });
  try {
    await waitForServer();
    const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
    try {
      const page = await browser.newPage({ viewport: { width: 1300, height: 1100 }, ignoreHTTPSErrors: true });
      const consoleErrors = [];
      page.on("pageerror", (e) => consoleErrors.push(String(e)));
      page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });

      await page.goto(`${BASE}/ui-audit/fixtures/site-plan-crop-harness.html`, { waitUntil: "load" });
      await assertMeasurable(page, "verify-site-plan-crop-fixtures");

      const report = await page.evaluate(() => window.runCropFixtureChecks());

      console.log("\n=== site-plan crop fixtures — RESULT ===");
      console.log(JSON.stringify(report, null, 2));

      log(report.errors.length === 0, `no errors thrown (${report.errors.join(" | ") || "none"})`);

      // broker-flyer.pdf — one page, rasterizes at a sane portrait aspect.
      log(report.pdf.brokerFlyerPages === 1, `broker-flyer.pdf reports 1 page (got ${report.pdf.brokerFlyerPages})`);
      log(!!report.pdf.brokerFlyer && report.pdf.brokerFlyer.w > 0 && report.pdf.brokerFlyer.h > report.pdf.brokerFlyer.w,
        `broker-flyer.pdf rasterizes portrait (${report.pdf.brokerFlyer && report.pdf.brokerFlyer.w}x${report.pdf.brokerFlyer && report.pdf.brokerFlyer.h})`);

      // e-size-title-block.pdf — rasterizes, aspect matches the 34:44 (w:h) page it was built at.
      const e = report.pdf.eSize;
      log(!!e && Math.abs(e.w / e.h - 34 / 44) < 0.02, `e-size-title-block.pdf rasterizes at the built 34:44 aspect (${e && e.w}x${e && e.h})`);

      // rotated-landscape.pdf — THE /Rotate PROOF. MediaBox is portrait (24x36in); the raster
      // must come out landscape, proving pdfRaster.js honours the page's own /Rotate by default.
      log(!!report.pdf.rotated && report.pdf.rotated.isLandscape,
        `rotated-landscape.pdf's /Rotate is honoured — raster is landscape (${report.pdf.rotated && report.pdf.rotated.w}x${report.pdf.rotated && report.pdf.rotated.h})`);

      // l-shaped-plan.png — genuinely non-rectangular: a corner of its own bounding box is
      // background, which is exactly what makes a single rectangle unable to trim it cleanly.
      const isBg = (rgb) => Array.isArray(rgb) && rgb[0] > 250 && rgb[1] > 250 && rgb[2] > 250;
      const isPlan = (rgb) => Array.isArray(rgb) && rgb[0] < 250;
      log(isBg(report.poly.topRightCorner), `l-shaped-plan.png: the sheet's own top-right corner is background`);
      log(isBg(report.poly.notchPixel), `l-shaped-plan.png: the notch inside the L's bounding box is background — a rect crop can't avoid it`);
      log(isPlan(report.poly.legAPixel), `l-shaped-plan.png: the horizontal leg is plan artwork`);
      log(isPlan(report.poly.legBPixel), `l-shaped-plan.png: the vertical leg is plan artwork`);

      // The real crop math: the L outline is usable and normalizes unchanged (already inside bounds).
      log(report.poly.usable === true, "the L outline passes isUsablePoly (>=3 vertices, clears the degenerate-sliver floor)");
      log(!!report.poly.clipPathValue && report.poly.clipPathValue.startsWith("polygon(evenodd,"), `clipPathValueForCrop produced an evenodd polygon() value: ${report.poly.clipPathValue}`);

      // THE core proof: applying that REAL clip-path value to a REAL <img> and hit-testing with
      // the browser's own compositor — this is the "the clipped result is what ACTUALLY DRAWS,
      // not merely what is stored" requirement, using the exact CSS property rotatedImageLayer.js
      // sets on a placed overlay's <img>.
      const ht = report.poly.hitTest || {};
      log(ht.legA === true, "clip-path KEEPS the horizontal leg (hit-tests to the image)");
      log(ht.legB === true, "clip-path KEEPS the vertical leg (hit-tests to the image)");
      log(ht.notch === false, "clip-path REMOVES the notch (does NOT hit-test to the image) — the whole point of the L fixture");

      // Reset to full page — clearing the clip-path must recover the original, unclipped image.
      log(report.poly.resetHitTest && report.poly.resetHitTest.notchAfterReset === true,
        "Reset to full page: clearing the clip-path recovers the notch (the whole original image)");

      // Rect <-> poly conversion is a bounding box, reversibly.
      const r = report.poly.bboxRect;
      log(!!r && r.x === 80 && r.y === 80 && r.w === 820 && r.h === 700, `polyPointsToRect gives the L's exact bounding box: ${JSON.stringify(r)}`);
      log(Array.isArray(report.poly.backToPoly) && report.poly.backToPoly.length === 4, "rectToPolyPoints converts the bbox back to a 4-vertex quad");

      log(consoleErrors.length === 0, `no console/page errors (${consoleErrors.join(" | ") || "none"})`);
    } finally {
      await browser.close();
    }
  } finally {
    vite.kill("SIGTERM");
    if (fail) console.error("\n--- vite output (tail) ---\n", viteOut.slice(-2000));
  }
}

await run();
console.log(`\n${fail === 0 ? "ALL CHECKS PASSED" : `${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
