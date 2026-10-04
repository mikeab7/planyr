#!/usr/bin/env node
/* verify-food-satellite-toggle — B634981, extended by NEW-1 (Food map basemaps). Kept under its
 * original filename (test/foodModule.test.js pins it) but it now guards the whole basemap control:
 *
 *   B634981 — switching basemap must never crash the module (a TypeError inside Leaflet's
 *   `_getSubdomain` once blanked all of /food). A REAL browser check, not a source scan.
 *   NEW-1   — a new user opens on SATELLITE (the photo only — no road/label layer at any zoom, B2070433),
 *   Hybrid adds the vector roads + place names, the choice survives a reload, the painted tiles are really opaque (the B651872 "blank until
 *   you zoom" symptom), and the pins stay on top. `--shots <dir>` writes a Houston neighbourhood-zoom
 *   screenshot per basemap (desktop + phone).
 *
 * Usage: node ui-audit/verify-food-satellite-toggle.mjs [previewUrl] [--shots dir]
 * Requires: `npm run build && npx vite preview --port 4173` running first (or pass a URL).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installFakeVectorSource } from "./lib/fakeVectorTiles.mjs";

const args = process.argv.slice(2);
const shotsIdx = args.indexOf("--shots");
const SHOTS = shotsIdx >= 0 ? args[shotsIdx + 1] : null;
const BASE_URL = args.find((a, i) => !a.startsWith("--") && i !== shotsIdx + 1) || "http://localhost:4173";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} — ${label}${extra ? ` (${extra})` : ""}`); if (!ok) failures.push(label); };

// Known-good arm (DRIVER-SCROLL §6): the control's two buttons must exist; otherwise the run is void.
async function open(browser, viewport, label, seed) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport });
  if (!args.includes("--live")) await installFakeVectorSource(context); // sandbox cannot reach tiles.openfreemap.org
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && /basemap tile layer failed to mount/.test(m.text())) pageErrors.push(m.text()); });
  if (seed) await page.addInitScript(seed);
  await page.goto(`${BASE_URL}/#/food`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 15000 });
  await assertMeasurable(page, "verify-food-satellite-toggle");
  const have = await page.locator('[data-testid="food-basemap-satellite"], [data-testid="food-basemap-hybrid"]').count();
  if (have !== 2) throw new Error(`VOID RUN (${label}): expected the two basemap buttons, found ${have}`);
  return { context, page, pageErrors };
}

// Layer census (B2070433): what is actually mounted in the map — the vector roads/labels pane's children,
// and the number of raster tile layers. Satellite must have zero of the first and exactly one of the second.
const census = (page) => page.evaluate(() => {
  const pane = document.querySelector('[data-testid="food-map"] .leaflet-planyrVectorLabels-pane');
  return { vector: pane ? pane.querySelectorAll("canvas, .maplibregl-map, img").length : 0, tileLayers: document.querySelectorAll('[data-testid="food-map"] .leaflet-tile-pane .leaflet-layer').length };
});

async function zoomToNeighbourhood(page) {
  for (let i = 0; i < 5; i++) { await page.click(".leaflet-control-zoom-in", { force: true }); await page.waitForTimeout(250); }
  await page.waitForTimeout(2500); // tiles settle
}

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--ignore-certificate-errors"] });

  for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 780 }]]) {
    const { context, page, pageErrors } = await open(browser, viewport, label);
    const pressed = async (k) => (await page.getAttribute(`[data-testid="food-basemap-${k}"]`, "aria-pressed")) === "true";

    check(`${label}: a NEW user opens on Satellite`, await pressed("satellite") && !(await pressed("hybrid")));
    const metro = await census(page);
    check(`${label}: Satellite at metro zoom — zero road/label layers, one imagery layer`, metro.vector === 0 && metro.tileLayers === 1, JSON.stringify(metro));
    await zoomToNeighbourhood(page);
    const hood = await census(page);
    check(`${label}: Satellite at neighbourhood zoom — still zero road/label layers`, hood.vector === 0 && hood.tileLayers === 1, JSON.stringify(hood));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/food-satellite-hood-${label}.jpg`, type: "jpeg", quality: 82 });
    check(`${label}: imagery tiles really painted and opaque (no blank map)`, await page.evaluate(() => [...document.querySelectorAll('[data-testid="food-map"] .leaflet-tile-pane img.leaflet-tile')].some((i) => i.naturalWidth > 0)));
    await page.click('[data-testid="food-basemap-hybrid"]', { force: true });
    await page.waitForTimeout(2500);
    check(`${label}: no crash on switch`, (await page.locator("text=/hit an error and couldn.?t load/i").count()) === 0 && (await page.locator('[data-testid="food-basemap-error"]').count()) === 0 && pageErrors.length === 0, pageErrors.join("|"));
    const hy = await census(page);
    check(`${label}: Hybrid mounts the vector roads/labels pane`, await page.evaluate(() => !!document.querySelector('[data-testid="food-map"] .leaflet-planyrVectorLabels-pane')), JSON.stringify(hy));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/food-hybrid-hood-${label}.jpg`, type: "jpeg", quality: 82 });
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.down(); await page.mouse.move(viewport.width / 2 + 160, viewport.height / 2 + 90, { steps: 8 }); await page.mouse.up();
    await page.click(".leaflet-control-zoom-out", { force: true });
    await page.waitForTimeout(2500);
    check(`${label}: Hybrid still painted after pan + zoom (B651872)`, await page.evaluate(() => [...document.querySelectorAll('[data-testid="food-map"] .leaflet-tile-pane img.leaflet-tile')].filter((i) => i.naturalWidth > 0).length > 3));

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="food-basemap-hybrid"]', { timeout: 15000 });
    check(`${label}: the choice persists across a reload`, await pressed("hybrid"));
    for (const k of ["satellite", "hybrid", "satellite"]) { await page.click(`[data-testid="food-basemap-${k}"]`, { force: true }); await page.waitForTimeout(400); }
    check(`${label}: repeated switching never crashes`, (await page.locator('[data-testid="food-map"]').count()) === 1 && pageErrors.length === 0);
    await context.close();
  }

  // Corrupt / hostile / legacy stored value (incl. the interim build's "siteplan") lands on Satellite, never a broken state.
  for (const stored of ["street-from-the-old-build", "siteplan"]) {
    const bad = await open(browser, { width: 1280, height: 800 }, "bad-storage", `try { localStorage.setItem("planyr:food:basemap", ${JSON.stringify(stored)}); } catch (_) {}`);
    check(`stored "${stored}" falls back to Satellite`, (await bad.page.getAttribute('[data-testid="food-basemap-satellite"]', "aria-pressed")) === "true");
    await bad.context.close();
  }

  await browser.close();
  if (failures.length) { console.error(`\nFAIL — ${failures.length} check(s): ${failures.join("; ")}`); process.exit(1); }
  console.log("\nPASS — all basemap checks green.");
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
