#!/usr/bin/env node
/* verify-food-satellite-toggle — B634981, extended by NEW-1 (Food map basemaps). Kept under its
 * original filename (test/foodModule.test.js pins it) but it now guards the whole basemap control:
 *
 *   B634981 — switching basemap must never crash the module (a TypeError inside Leaflet's
 *   `_getSubdomain` once blanked all of /food). A REAL browser check, not a source scan.
 *   NEW-1   — a new user opens on the SITE PLAN map (imagery + road names), Hybrid adds a place-names
 *   layer, the choice survives a reload, the painted tiles are really opaque (the B651872 "blank until
 *   you zoom" symptom), and the pins stay on top. `--shots <dir>` writes a Houston neighbourhood-zoom
 *   screenshot per basemap (desktop + phone).
 *
 * Usage: node ui-audit/verify-food-satellite-toggle.mjs [previewUrl] [--shots dir]
 * Requires: `npm run build && npx vite preview --port 4173` running first (or pass a URL).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const shotsIdx = args.indexOf("--shots");
const SHOTS = shotsIdx >= 0 ? args[shotsIdx + 1] : null;
const BASE_URL = args.find((a, i) => !a.startsWith("--") && i !== shotsIdx + 1) || "http://localhost:4173";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} — ${label}${extra ? ` (${extra})` : ""}`); if (!ok) failures.push(label); };

async function layerUrls(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-testid="food-map"] .leaflet-tile-pane .leaflet-layer')].map((l) => {
    const img = l.querySelector("img.leaflet-tile");
    return { src: img ? img.src : null, opacity: Number(getComputedStyle(l).opacity) };
  }));
}

// Known-good arm (DRIVER-SCROLL §6): the control's two buttons must exist; otherwise the run is void.
async function open(browser, viewport, label, seed) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && /basemap tile layer failed to mount/.test(m.text())) pageErrors.push(m.text()); });
  if (seed) await page.addInitScript(seed);
  await page.goto(`${BASE_URL}/#/food`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 15000 });
  await assertMeasurable(page, "verify-food-satellite-toggle");
  const have = await page.locator('[data-testid="food-basemap-siteplan"], [data-testid="food-basemap-hybrid"]').count();
  if (have !== 2) throw new Error(`VOID RUN (${label}): expected the two basemap buttons, found ${have}`);
  return { context, page, pageErrors };
}

async function zoomToNeighbourhood(page) {
  for (let i = 0; i < 5; i++) { await page.click(".leaflet-control-zoom-in", { force: true }); await page.waitForTimeout(250); }
  await page.waitForTimeout(2500); // tiles settle
}

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--ignore-certificate-errors"] });

  for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 780 }]]) {
    const { context, page, pageErrors } = await open(browser, viewport, label);
    const pressed = async (k) => (await page.getAttribute(`[data-testid="food-basemap-${k}"]`, "aria-pressed")) === "true";

    check(`${label}: a NEW user opens on the Site Plan map`, await pressed("siteplan") && !(await pressed("hybrid")));
    await zoomToNeighbourhood(page);
    let layers = await layerUrls(page);
    check(`${label}: Site Plan = imagery + road names (2 tile layers)`, layers.length === 2 && /World_Imagery/.test(layers[0].src || "") && /World_Transportation/.test(layers[1].src || ""), JSON.stringify(layers.map((l) => l.opacity)));
    check(`${label}: imagery tiles really painted and opaque (no blank map)`, layers[0].opacity === 1 && layers[0].src && await page.evaluate(() => [...document.querySelectorAll('[data-testid="food-map"] .leaflet-tile-pane img.leaflet-tile')].some((i) => i.naturalWidth > 0)));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/food-siteplan-${label}.png` });

    await page.click('[data-testid="food-basemap-hybrid"]', { force: true });
    await page.waitForTimeout(3500);
    layers = await layerUrls(page);
    check(`${label}: Hybrid = imagery + road names + place names (3 layers, labels full strength)`, layers.length === 3 && /World_Boundaries_and_Places/.test(layers[2].src || "") && layers[1].opacity === 1 && layers[2].opacity === 1);
    check(`${label}: no crash on switch`, (await page.locator("text=/hit an error and couldn.?t load/i").count()) === 0 && (await page.locator('[data-testid="food-basemap-error"]').count()) === 0 && pageErrors.length === 0, pageErrors.join("|"));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/food-hybrid-${label}.png` });

    // Pan + zoom on Hybrid: tiles must stay painted (B651872 symptom), nothing throws.
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.down(); await page.mouse.move(viewport.width / 2 + 160, viewport.height / 2 + 90, { steps: 8 }); await page.mouse.up();
    await page.click(".leaflet-control-zoom-out", { force: true });
    await page.waitForTimeout(2500);
    check(`${label}: Hybrid still painted after pan + zoom`, await page.evaluate(() => [...document.querySelectorAll('[data-testid="food-map"] .leaflet-tile-pane img.leaflet-tile')].filter((i) => i.naturalWidth > 0).length > 3));

    // Persistence: reload → Hybrid remembered.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="food-basemap-hybrid"]', { timeout: 15000 });
    check(`${label}: the choice persists across a reload`, await pressed("hybrid"));
    // Toggle back and forth (B634981's crash path).
    for (const k of ["siteplan", "hybrid", "siteplan"]) { await page.click(`[data-testid="food-basemap-${k}"]`, { force: true }); await page.waitForTimeout(400); }
    check(`${label}: repeated switching never crashes`, (await page.locator('[data-testid="food-map"]').count()) === 1 && pageErrors.length === 0);
    await context.close();
  }

  // Corrupt / hostile stored value falls back to the default instead of crashing.
  const bad = await open(browser, { width: 1280, height: 800 }, "bad-storage", () => { try { localStorage.setItem("planyr:food:basemap", "street-from-the-old-build"); } catch (_) {} });
  check("an unrecognised stored choice falls back to the Site Plan map", (await bad.page.getAttribute('[data-testid="food-basemap-siteplan"]', "aria-pressed")) === "true");
  await bad.context.close();

  await browser.close();
  if (failures.length) { console.error(`\nFAIL — ${failures.length} check(s): ${failures.join("; ")}`); process.exit(1); }
  console.log("\nPASS — all basemap checks green.");
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
