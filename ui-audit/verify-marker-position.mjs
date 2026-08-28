#!/usr/bin/env node
/* verify-marker-position — B842528. Permanent regression guard for the reverted continuous
 * marker-scaling mechanism (B707841/NEW-2). That mechanism called `CircleMarker.setRadius()`
 * every animation frame to counteract the ambient CSS zoom transform; `setRadius()` turned out to
 * ALSO reproject the marker's position (Canvas._updatePath -> layer._project()), which then got
 * the SAME ambient transform applied on top a second time — a genuine double transform that drew
 * markers up to 100-300px off their true screen position during an active zoom (measured live,
 * see BACKLOG.md B842528 and FoodMap.jsx's own header comment on the revert).
 *
 * TWO CHECKS, deliberately structural + ground-truth rather than fuzzy pixel-timing assertions:
 *
 * 1. STRUCTURAL: zero `CircleMarker.setRadius` calls during an animated zoom gesture. This is the
 *    property that actually distinguishes "the buggy mechanism is gone" from "this run happened
 *    not to show much visible drift" — a call-count proof, same shape as this repo's own
 *    VIEW-INDEPENDENT-ONCE counter-based gates, rather than trying to define a bright line between
 *    "expected mid-animation interpolation motion" and "a bug's displacement," which is inherently
 *    fuzzy and was NOT how this defect was actually caught.
 * 2. GROUND TRUTH: after a real animated zoom gesture settles, tracked markers' ACTUAL drawn
 *    canvas pixel position matches Leaflet's own `map.latLngToContainerPoint()` for the same
 *    lat/lon, within a tight tolerance — the resting-state property the owner ultimately cares
 *    about, measured the same way the original defect was found (pixel-scan the real canvas for
 *    an unmistakable, unique marker colour; compare to the expected projection).
 *
 * Usage: node ui-audit/verify-marker-position.mjs [devServerUrl]
 * Requires a Vite dev server running (npm run dev), serving this harness at
 * /ui-audit/marker-position-harness.html.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE_URL = process.argv[2] || "http://localhost:5183";
const URL = `${BASE_URL}/ui-audit/marker-position-harness.html`;
const EXE = "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

const TRACKED = [
  { key: "austin", name: "Potbelly (Austin, avgRating=1)", lat: 30.2940, lon: -97.7497, color: [255, 242, 204] },
  { key: "dallas", name: "Dallas test point (avgRating=10)", lat: 32.7767, lon: -96.7970, color: [110, 24, 16] },
  { key: "sanantonio", name: "San Antonio test point (avgRating=5)", lat: 29.4241, lon: -98.4936, color: [245, 140, 52] },
];
const POSITION_TOLERANCE_PX = 2;

async function main() {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__harnessReady === true);
  await page.waitForSelector('[data-testid="food-map"]');
  await page.waitForTimeout(500);
  // FOREGROUND-OR-VOID — a background tab suspends rAF, so a zoom "animation" driven against one
  // never actually runs, and any position read afterward is a stale, internally-consistent lie.
  await assertMeasurable(page, "verify-marker-position");

  // ---- Check 1: structural — zero setRadius calls during an animated zoom -------------------
  await page.evaluate(() => {
    window.__setRadiusCalls = 0;
    const proto = window.L.CircleMarker.prototype;
    const orig = proto.setRadius;
    proto.setRadius = function (...args) {
      window.__setRadiusCalls += 1;
      return orig.apply(this, args);
    };
  });
  await page.click(".leaflet-control-zoom-out");
  await page.waitForTimeout(300); // spans the whole ~250ms animation window
  const midAnimSetRadiusCalls = await page.evaluate(() => window.__setRadiusCalls);
  await page.waitForTimeout(300); // fully settle before the next check

  // ---- Check 2: ground truth — resting position matches latLngToContainerPoint --------------
  await page.evaluate((tracked) => {
    window.__TRACKED = tracked;
    window.__measure = function () {
      const testMap = window.__testMap;
      const canvas = testMap.getContainer().querySelector(".leaflet-overlay-pane canvas");
      if (!canvas) return { error: "no canvas found" };
      const ctx = canvas.getContext("2d");
      const w = canvas.width, h = canvas.height;
      const imgData = ctx.getImageData(0, 0, w, h).data;
      const rect = canvas.getBoundingClientRect();
      const mapRect = testMap.getContainer().getBoundingClientRect();
      const scaleX = rect.width / w, scaleY = rect.height / h;
      const results = {};
      for (const t of window.__TRACKED) {
        let sumX = 0, sumY = 0, count = 0;
        const [tr, tg, tb] = t.color;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (imgData[i + 3] < 200) continue;
            if (Math.abs(imgData[i] - tr) <= 6 && Math.abs(imgData[i + 1] - tg) <= 6 && Math.abs(imgData[i + 2] - tb) <= 6) {
              sumX += x; sumY += y; count++;
            }
          }
        }
        if (count === 0) { results[t.key] = { found: false }; continue; }
        const actualPageX = rect.left + (sumX / count) * scaleX;
        const actualPageY = rect.top + (sumY / count) * scaleY;
        const expected = testMap.latLngToContainerPoint([t.lat, t.lon]);
        const expectedPageX = mapRect.left + expected.x;
        const expectedPageY = mapRect.top + expected.y;
        const delta = Math.hypot(actualPageX - expectedPageX, actualPageY - expectedPageY);
        results[t.key] = { found: true, count, delta: Math.round(delta * 10) / 10 };
      }
      return results;
    };
  }, TRACKED);

  // Zoom out further so the Dallas/San Antonio test points are on-canvas, then settle.
  for (let i = 0; i < 6; i++) {
    await page.click(".leaflet-control-zoom-out");
    await page.waitForTimeout(300);
  }
  const settled = await page.evaluate(() => window.__measure());

  await browser.close();

  console.log("=== Check 1: setRadius calls during ONE animated zoom-out gesture ===");
  console.log(`  ${midAnimSetRadiusCalls} (expect 0 — the compensation loop that called this every frame is removed)`);

  console.log("\n=== Check 2: resting position vs map.latLngToContainerPoint, after settle ===");
  for (const t of TRACKED) {
    const r = settled[t.key];
    console.log(`  ${t.name}: ${r?.found ? `delta ${r.delta}px (count=${r.count})` : "not found on canvas (off current view — not a failure by itself)"}`);
  }

  console.log("\nPage errors:", pageErrors.length, pageErrors);

  const failures = [];
  if (midAnimSetRadiusCalls !== 0) failures.push(`setRadius was called ${midAnimSetRadiusCalls} times during the animation — the removed compensation loop appears to be back`);
  for (const t of TRACKED) {
    const r = settled[t.key];
    if (r?.found && r.delta > POSITION_TOLERANCE_PX) {
      failures.push(`${t.name}: resting delta ${r.delta}px exceeds the ${POSITION_TOLERANCE_PX}px tolerance`);
    }
  }
  if (pageErrors.length) failures.push(`${pageErrors.length} page error(s): ${pageErrors.join("; ")}`);

  if (failures.length) {
    console.log("\n❌ FAIL\n" + failures.map((f) => "  • " + f).join("\n"));
    process.exit(1);
  }
  console.log("\n✅ PASS — no per-frame position mutation during the animation, and resting positions match Leaflet's own projection.");
}

main().catch((err) => { console.error(err); process.exit(1); });
