#!/usr/bin/env node
/* verify-undo-tile-churn — AN UNDO MUST NOT REBUILD THE BASEMAP (B519907, the fix for B1121 ×4)
 *
 *   node ui-audit/verify-undo-tile-churn.mjs [--fixture richfield] [--assert]
 *
 * ⛔ WHAT THIS COUNTS AND WHY IT IS THE RIGHT QUANTITY. `pushHistory` snapshots the whole app state,
 * so an undo used to restore `origin` as a fresh object holding identical numbers; the Leaflet
 * map-CREATION effect keys on it and its cleanup is `map.remove()`, so React tore the map down and
 * rebuilt it on every Ctrl+Z. Measured on the owner's Richfield plan, per action:
 *
 *     click 0/0 · drag 0/0 · UNDO 272 added + 272 removed · pan 14/0 · Escape 0/0
 *
 * with the retained tile count never leaving 274. So the signal is not a tile COUNT — that is
 * identical either side of the defect, which is exactly why every existing instrument here was
 * blind to it — it is the CHURN: `<img class="leaflet-tile">` nodes destroyed and recreated, counted
 * with a `MutationObserver`.
 *
 * ⛔ AND IT MEASURES EACH ACTION SEPARATELY, WHICH IS THE HALF THAT TURNED A SYMPTOM INTO A FIX.
 * The first probe drove drag-then-undo as one "edit" and reported the cost per edit; splitting the
 * gesture showed the drag is free and the UNDO pays all of it, which named the restore path and
 * therefore the dependency. A harness that only reports a per-edit total cannot tell you where to
 * look — so the per-action table is the output, not a summary number.
 *
 * ⛔ THE TWO CONTROLS ARE NOT OPTIONAL. A build that simply never rebuilt the map would score a
 * perfect zero here while being badly broken, so the run also asserts the map is ALIVE and still
 * holding its tiles afterwards. `--assert` exits non-zero on any churn from an undo or a redo.
 */
import { chromium } from "playwright";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFixture, cachedRaster } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed, rasterIdbPlan, idbPutInPage } from "./lib/planFixture.mjs";
import { pngDataUrl } from "./lib/synthRaster.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
/* ⛔ B1439 — an undisposed ElementHandle is a strong GC root that retains the whole tree above the
 * element, which silently inflates every memory reading taken afterwards. In a harness whose entire
 * purpose is measuring retention that is not a style point, it is a contaminated instrument. */
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITE_ID = "smsdrvzr9gzx";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const FIXTURE = arg("fixture", "richfield");
const ASSERT = process.argv.includes("--assert");

const fixture = readFixture(FIXTURE);
const browser = await chromium.launch({ headless: false, executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID, pdfStorage: false }));
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
await ctx.route(/^https?:\/\//, (route) => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  const t = parseTileUrl(u);
  if (t) return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*" }, body: fakeTilePng(t.z, t.x, t.y) });
  return route.abort();
});

const page = await ctx.newPage();
await assertMeasurable(page, "verify-undo-tile-churn");
await page.goto(BASE, { waitUntil: "domcontentloaded" });
for (const { key, spec } of rasterIdbPlan(fixture, SITE_ID)) {
  const r = cachedRaster(spec, join(HERE, ".raster-cache"));
  await page.evaluate(idbPutInPage, { key, value: pngDataUrl(r.png) });
}
await page.reload({ waitUntil: "load" });
await waitForSelectorReleased(page, "svg[data-view-ppf]", { timeout: 30000 });
await page.evaluate(() => window.__plannerView?.centerOn(0, 0, 0.12));
await pacedWait(page, 2500);

await page.evaluate(() => {
  window.__c = { a: 0, r: 0 };
  new MutationObserver((ms) => {
    for (const m of ms) {
      for (const n of m.addedNodes) if (n.tagName === "IMG" && n.classList.contains("leaflet-tile")) window.__c.a++;
      for (const n of m.removedNodes) if (n.tagName === "IMG" && n.classList.contains("leaflet-tile")) window.__c.r++;
    }
  }).observe(document.body, { childList: true, subtree: true });
});

const tilesNow = () => page.evaluate(() => document.querySelectorAll("img.leaflet-tile").length);
const spot = await page.evaluate(() => {
  /* el-tier: picking ONE element to drag — a targeted pick, never a census. */
  const ns = [...document.querySelectorAll("[data-el-id]")];
  if (!ns.length) return null;
  const n = ns[Math.floor(ns.length / 2)];
  const r = n.getBoundingClientRect();
  return r.width > 4 && r.height > 4 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
});
if (!spot) { console.error(`no draggable element found on "${FIXTURE}" — the run cannot be established`); process.exit(2); }

const rows = [];
const step = async (label, fn) => {
  const c0 = await page.evaluate(() => ({ ...window.__c }));
  await fn();
  await pacedWait(page, 700);
  const c1 = await page.evaluate(() => ({ ...window.__c }));
  rows.push({ action: label, added: c1.a - c0.a, removed: c1.r - c0.r });
};

await step("click (select)", async () => { await page.mouse.click(spot.x, spot.y); });
await step("drag", async () => {
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(spot.x + k * 5, spot.y + k * 3);
  await page.mouse.up();
});
await step("undo", async () => { await page.keyboard.press("Control+z"); });
await step("redo", async () => { await page.keyboard.press("Control+Shift+z"); });

/* The controls: a build that never rebuilt the map would score a perfect zero above. */
const tilesAfter = await tilesNow();
const mapAlive = await page.evaluate(() => !!document.querySelector(".leaflet-container") && !!window.__geoMap);

const offenders = rows.filter((r) => (r.action === "undo" || r.action === "redo") && (r.added > 0 || r.removed > 0));
const controlsOk = mapAlive && tilesAfter > 0;
const ok = offenders.length === 0 && controlsOk;

console.log(JSON.stringify({ fixture: FIXTURE, rows, tilesAfter, mapAlive, controlsOk, ok }, null, 2));
for (const r of rows) process.stderr.write(`  ${r.action.padEnd(16)} added=${String(r.added).padStart(4)} removed=${String(r.removed).padStart(4)}\n`);
process.stderr.write(`  controls: map alive ${mapAlive} · tiles ${tilesAfter}\n`);
await browser.close();
if (ASSERT && !ok) {
  console.error(offenders.length ? `✗ an undo/redo rebuilt the basemap: ${offenders.map((o) => `${o.action} ${o.removed} tiles destroyed`).join(", ")}` : "✗ controls failed — the map is not alive, so a zero above proves nothing");
  process.exit(1);
}
