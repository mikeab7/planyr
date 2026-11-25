/* verify-exhibit-road-names — the printed sheet carries the map's public street names exactly when the Site Plan map shows them
 * (owner, 2026-11-25: "they don't show up on the exhibit … let's not even make a toggle … have it match whatever is on the site plan").
 *
 * Logged-out, local plan moved to the Houston fixture area. The vector street source (tiles.openfreemap.org) is unreachable here, so
 * it is served by the SYNTHETIC OpenMapTiles fixture (lib/fakeVectorTiles.mjs: hand-placed roads such as "Clay Rd" and "Gessner Rd" —
 * it proves the sheet renders the same style at the right place, NOT what OpenStreetMap holds; the live pass is on planyr.io). Esri
 * aerial + raster road-name tiles are served as real decodable PNGs (lib/fakeTile.mjs).
 *
 * Checks, each with a KNOWN arm: (A) Road Names ON → the composed PDF sheet carries one street-name image, from the vector render,
 * with real drawn pixels, placed over the sheet's plan box; (B) turned OFF in Layers → Map Base → no image, and still none after a
 * reload; back ON → it returns; (C) aerial hidden → no street names (they ride the aerial on screen too); (D) the vector source down →
 * the raster road names print instead; (E) both down → the sheet prints without them and the app SAYS so.
 *
 * Run:  npm run build && npx vite preview --port 4173  (then)  node ui-audit/verify-exhibit-road-names.mjs
 */
import pw from "playwright";
const { chromium } = pw;
import { mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installFakeVectorSource, FIXTURE_ORIGIN, HOUSTON } from "./lib/fakeVectorTiles.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/exhibit-road-names/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const fails = [], notes = [];
const check = (ok, label, detail = "") => { (ok ? notes : fails).push(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); };

async function session({ vector = "fixture", rasterNames = "ok" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  const log = { rasterNameTiles: 0 };
  // Esri imagery + the raster road-names fallback: real PNG bytes so the stitcher decodes them.
  await ctx.route("https://server.arcgisonline.com/**", async (route) => {
    const url = route.request().url();
    const t = parseTileUrl(url);
    if (/World_Transportation/.test(url)) {
      log.rasterNameTiles++;
      if (rasterNames !== "ok" || !t) return route.fulfill({ status: 503, body: "" });
    }
    if (!t) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, headers: { "content-type": "image/png", "access-control-allow-origin": "*" }, body: fakeTilePng(t.z, t.x, t.y) });
  });
  if (vector === "fixture") Object.assign(log, { vector: await installFakeVectorSource(ctx) });
  else await ctx.route(`${FIXTURE_ORIGIN}/**`, (route) => route.abort("connectionrefused"));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await assertMeasurable(page, "verify-exhibit-road-names");
  return { ctx, page, errs, log };
}

const openPlanner = async (page) => {
  await page.goto(BASE, { waitUntil: "load" }); await page.waitForTimeout(1200);
  try { await page.getByTestId("map-toolbar-draw").click({ timeout: 8000 }); await page.getByTestId("map-toolbar-draw").click({ timeout: 8000 }); } catch (_) {}
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 }); await page.waitForTimeout(1200);
  const key = await page.evaluate(() => Object.keys(localStorage).find((k) => /^planarfit:sites:v1:p:/.test(k)));
  // Move the plan onto the fixture's streets (Clay Rd × Gessner Rd) and give it a building so the sheet has a frame.
  await page.evaluate(([k, o]) => {
    const s = JSON.parse(localStorage.getItem(k));
    s.origin = { lat: o.lat, lon: o.lng };
    s.els = [{ id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, z: 1 }];
    s.updatedAt = Date.now();
    localStorage.setItem(k, JSON.stringify(s));
  }, [key, HOUSTON]);
  await reloadPlanner(page);
  return key;
};
const reloadPlanner = async (page) => {
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
  await page.waitForFunction(() => !!window.__plannerView && !!window.__plannerExportComposed, null, { timeout: 20000 });
  await page.evaluate(() => window.__plannerView.centerOn(0, 0, 0.9)); await page.waitForTimeout(2500);
};

/* The composed PDF sheet (the real editable-PDF composition path) → what street-name image it carries, and how much of it is ink. */
const sheetRoadNames = async (page, tag) => page.evaluate(async (t) => {
  const c = await window.__plannerExportComposed({ paper: "letter", orient: "landscape", annotate: false }) // flattened: the drawn plan stays in the page picture, so the paint order (names under the plan) is visible;
  if (!c) return { built: false };
  const doc = new DOMParser().parseFromString(c.sheetSvg, "image/svg+xml");
  const ims = [...doc.querySelectorAll("image[data-export-roadnames]")];
  const aerial = doc.querySelectorAll("image[data-export-aerial]").length;
  const out = { built: true, count: ims.length, kinds: ims.map((i) => i.getAttribute("data-export-roadnames")), aerial, inkFrac: 0, w: 0, h: 0, src: null };
  if (ims[0]) {
    const src = ims[0].getAttribute("href");
    const img = new Image(); await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = src; });
    const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let ink = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) ink++;
    Object.assign(out, { inkFrac: ink / (d.length / 4), w: cv.width, h: cv.height, src: t ? src : null });
  }
  out.sheet = t ? c.sheetSvg : null;
  return out;
}, tag);
const savePng = (dataUrl, name) => { if (dataUrl) writeFileSync(OUT + name, Buffer.from(dataUrl.split(",")[1], "base64")); };
const renderSheet = async (page, svg, name) => {
  if (!svg) return;
  const p2 = await page.context().newPage();
  await p2.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
  await p2.waitForTimeout(800);
  await p2.screenshot({ path: OUT + name, fullPage: true });
  await p2.close();
};
const openMapBase = async (page) => {
  if (await page.getByTestId("layers-expand").count()) { await page.getByTestId("layers-expand").click(); await page.waitForTimeout(400); }
  if (await page.getByTestId("layer-group-base").count()) { await page.getByTestId("layer-group-base").click(); await page.waitForTimeout(300); }
};
const closeLayers = async (page) => { if (await page.getByTestId("layers-collapse").count()) { await page.getByTestId("layers-collapse").click(); await page.waitForTimeout(300); } };
const setRoadNamesInLayers = async (page, on) => {
  await openMapBase(page);
  const box = page.locator('[data-testid="layer-row-road_names"] input[type="checkbox"]').first();
  const was = await box.isChecked();
  if (was !== on) await box.click();
  await page.waitForTimeout(500);
  const now = await box.isChecked();
  await closeLayers(page);
  return { was, now };
};

// ── A + B + C: the normal case ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs, log } = await session();
  await openPlanner(page);
  await page.screenshot({ path: OUT + "01-screen-road-names-on.png" });
  let r = await sheetRoadNames(page, true);
  check(r.built, "A: the PDF sheet composes");
  check(r.aerial >= 1, "A: the sheet carries the aerial (precondition: street names ride the aerial)", `aerial images=${r.aerial}`);
  check(r.count === 1 && r.kinds[0] === "vector", "A: Road Names on → exactly one street-name layer on the sheet, from the same vector map the screen draws", JSON.stringify(r.kinds));
  check(r.inkFrac > 0.002 && r.inkFrac < 0.6, "A: the street-name layer has real drawn roads/names on a transparent background", `ink ${(r.inkFrac * 100).toFixed(2)}% of ${r.w}×${r.h}`);
  check(r.w >= 1800, "A: print-crisp (rendered at more than twice its on-paper screen size)", `${r.w}×${r.h}`);
  check((log.vector?.tiles || []).length > 0, "A: the vector source was actually asked for tiles (not a cached picture)", `${(log.vector?.tiles || []).length} tile requests`);
  savePng(r.src, "02-sheet-road-names-layer.png");
  await renderSheet(page, r.sheet, "03-sheet-on.png");

  const t = await setRoadNamesInLayers(page, false);
  check(t.was === true && t.now === false, "B: Layers → Map Base → Road Names was on and is now off", JSON.stringify(t));
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + "04-screen-road-names-off.png" });
  r = await sheetRoadNames(page, true);
  check(r.built && r.count === 0, "B: Road Names off → the sheet carries no street names", JSON.stringify(r.kinds));
  check(r.aerial >= 1, "B: …and still carries the aerial (only the names went)");
  await renderSheet(page, r.sheet, "05-sheet-off.png");
  await reloadPlanner(page);
  r = await sheetRoadNames(page, false);
  check(r.built && r.count === 0, "B: after a reload Road Names is still off and the sheet still has none", JSON.stringify(r.kinds));
  const t2 = await setRoadNamesInLayers(page, true);
  check(t2.now === true, "B: turned back on");
  r = await sheetRoadNames(page, false);
  check(r.count === 1, "B: back on → the street names are on the sheet again", JSON.stringify(r.kinds));

  // C — aerial hidden (Layers → Satellite Imagery Source → Off): the street names leave with it, on screen and on paper.
  await openMapBase(page);
  const src = page.getByTestId("basemap-source");
  const hasOff = await src.locator('option[value="off"]').count();
  if (hasOff) {
    await src.selectOption("off"); await page.waitForTimeout(800);
    r = await sheetRoadNames(page, false);
    check(r.count === 0 && r.aerial === 0, "C: aerial off → neither the aerial nor its street names print", `names=${r.count} aerial=${r.aerial}`);
    await src.selectOption("esri"); await page.waitForTimeout(800);
  } else check(false, "C: the imagery picker offers Off (precondition)");
  check(errs.length === 0, "A–C: no page errors", errs.join(" | "));
  await ctx.close();
}

// ── D: vector source down → the raster road names print ─────────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs, log } = await session({ vector: "down" });
  await openPlanner(page);
  const r = await sheetRoadNames(page, false);
  check(r.count === 1 && r.kinds[0] === "raster", "D: vector source down → the sheet falls back to the raster road names (as the screen does)", JSON.stringify(r.kinds));
  check(log.rasterNameTiles > 0, "D: the raster road-name tiles were requested", String(log.rasterNameTiles));
  check(errs.length === 0, "D: no page errors", errs.join(" | "));
  await ctx.close();
}

// ── E: both down → printed without them, and the app says so ────────────────────────────────────────────────────────────────
{
  const { ctx, page, errs } = await session({ vector: "down", rasterNames: "down" });
  await openPlanner(page);
  const r = await sheetRoadNames(page, false);
  await page.waitForTimeout(300);
  const said = await page.evaluate(() => /Couldn.t load the street names from the map/.test(document.body.innerText));
  check(r.built && r.count === 0, "E: both sources down → the sheet still builds, without street names", JSON.stringify(r));
  check(said, "E: …and the app says so (never a silent omission)");
  await page.screenshot({ path: OUT + "06-both-down-warning.png" });
  check(errs.length === 0, "E: no page errors", errs.join(" | "));
  await ctx.close();
}

console.log("\n" + notes.join("\n"));
if (fails.length) console.log("\n" + fails.join("\n"));
console.log(`\n${fails.length ? "FAIL" : "PASS"} — ${notes.length} passed, ${fails.length} failed. Screens → ${OUT}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
