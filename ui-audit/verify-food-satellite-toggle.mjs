#!/usr/bin/env node
/* verify-food-satellite-toggle — B634981. The owner reported a live production crash: clicking
 * Satellite replaced the whole /food module with "Food hit an error and couldn't load" (a
 * TypeError inside Leaflet's `_getSubdomain`, caught by the workspace error boundary).
 *
 * This is a REAL headless-browser check, not a source scan — the defect only manifests once
 * Leaflet actually mounts a tile layer and calls `_getSubdomain` during `_update()`, which a
 * regex over the source can't observe. Drives a real `vite preview` build (localhost, no network
 * tile fetches needed — the crash happens before any image request goes out) with a page-error
 * listener, toggles Satellite -> Street -> Satellite, and asserts zero uncaught exceptions and a
 * live tile layer present after each toggle.
 *
 * Usage: node ui-audit/verify-food-satellite-toggle.mjs [previewUrl]
 * Requires: `npm run build && npx vite preview --port 4173` running first (or pass a URL).
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE_URL = process.argv[2] || "http://localhost:4173";

async function main() {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: ["--ignore-certificate-errors"],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" && /basemap tile layer failed to mount/.test(msg.text())) {
      pageErrors.push("FoodMap logged a caught basemap error: " + msg.text());
    }
  });

  await page.goto(`${BASE_URL}/#/food`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 15000 });
  // FOREGROUND-OR-VOID — a background tab suspends rAF and can silently confirm a stale state
  // for a toggle just like it can for a pan; this harness reads DOM/console state after every
  // click, so it must prove the tab is genuinely foreground and live before trusting any of it.
  await assertMeasurable(page, "verify-food-satellite-toggle");
  await page.waitForTimeout(500);

  const results = [];
  const checkNoCrash = async (label) => {
    // The crash replaces the whole module with the workspace error boundary's fallback text.
    const crashed = await page.locator("text=/hit an error and couldn.?t load/i").count();
    const hasMap = await page.locator('[data-testid="food-map"]').count();
    const hasErrorBanner = await page.locator('[data-testid="food-basemap-error"]').count();
    const tileImgCount = await page.locator(".leaflet-tile").count();
    results.push({ label, crashed, hasMap, hasErrorBanner, tileImgCount, pageErrorsSoFar: pageErrors.length });
  };

  // force:true — the crash this guards against fires SYNCHRONOUSLY inside the click's own
  // triggered re-render, which stalls Playwright's normal actionability wait (element attached /
  // stable / receiving events) indefinitely rather than failing cleanly. Forcing skips that wait
  // and dispatches the event directly, so a crash reads as a crash instead of a timeout.
  const toggle = () => page.click('[data-testid="food-basemap-toggle"]', { timeout: 10000, force: true });

  await checkNoCrash("initial load (street)");

  await toggle();
  await page.waitForTimeout(800);
  await checkNoCrash("after toggling to satellite");

  await toggle();
  await page.waitForTimeout(500);
  await checkNoCrash("after toggling back to street");

  await toggle();
  await page.waitForTimeout(500);
  await checkNoCrash("after toggling to satellite again");

  await browser.close();

  console.log("Results:");
  for (const r of results) console.log("  ", JSON.stringify(r));
  console.log("Page errors (uncaught exceptions):", JSON.stringify(pageErrors, null, 2));

  const anyCrashed = results.some((r) => r.crashed > 0 || r.hasMap === 0);
  const anyUncaught = pageErrors.length > 0;
  const finalHasTiles = results[results.length - 1].tileImgCount > 0;

  if (anyCrashed || anyUncaught || !finalHasTiles) {
    console.error("\nFAIL — satellite toggle crash reproduced or tiles missing.");
    process.exit(1);
  }
  console.log("\nPASS — no crash, no uncaught exceptions, tile layer present after every toggle.");
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
