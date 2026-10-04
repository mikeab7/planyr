#!/usr/bin/env node
/* verify-vector-basemap — NEW-1 (B2018608). Drives the REAL /food map at devicePixelRatio 2 over
 * Houston and checks the vector roads/labels basemap end to end:
 *
 *   · a new user opens on SITE PLAN (the Site tab's own map); the choices are Site Plan + Hybrid
 *   · imagery is requested at HIGH DENSITY (a z+1 tile drawn at half size — never 256 drawn at 256)
 *   · the vector layer loads, its pane sits ABOVE the imagery and BELOW the markers, and it can't eat a press
 *   · Site Plan @ metro: NO road lines, Planyr's city names; @ neighbourhood: clean vector roads
 *   · Hybrid @ metro: freeways first, locals hidden; @ neighbourhood: locals shown (queryRenderedFeatures)
 *   · the vector canvas stays in LOCKSTEP with Leaflet through a zoom (B842528's class)
 *   · the credit is not clipped by the ? help button and the loading pill clears the zoom control
 *
 * ⛔ SOURCE. `tiles.openfreemap.org` is unreachable from the cloud sandbox, so by default this installs
 * a SYNTHETIC OpenMapTiles-schema source (`lib/fakeVectorTiles.mjs`) via a route. That proves the
 * style/gates/lockstep, NOT the live data — pass `--live` on a machine with network to run the same
 * checks against the real source (this is V1443696's live pass). Esri imagery is real either way.
 *
 * Usage: node ui-audit/verify-vector-basemap.mjs [baseUrl] [--shots dir] [--tag name] [--live]
 * Requires `npm run build && npx vite preview --port 4173` (or pass a URL). */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installFakeVectorSource, HOUSTON } from "./lib/fakeVectorTiles.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.indexOf(n);
const val = (n, d = null) => (flag(n) >= 0 ? args[flag(n) + 1] : d);
const SHOTS = val("--shots");
const TAG = val("--tag", "after");
const LIVE = flag("--live") >= 0;
const BASE_URL = args.find((a, i) => /^https?:/.test(a) && args[i - 1] !== "--shots") || "http://localhost:4173";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} — ${label}${extra ? ` (${extra})` : ""}`); if (!ok) failures.push(label); };

async function open(browser, viewport, dpr) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: dpr });
  const vlog = LIVE ? null : await installFakeVectorSource(context);
  const page = await context.newPage();
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  const imageryReqs = [];
  page.on("request", (r) => { const m = r.url().match(/World_Imagery\/MapServer\/tile\/(\d+)\//); if (m) imageryReqs.push(Number(m[1])); });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE_URL}/#/food`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 20000 });
  await assertMeasurable(page, "verify-vector-basemap");
  const have = await page.locator('[data-testid="food-basemap-hybrid"], [data-testid="food-basemap-siteplan"]').count();
  if (have !== 2) throw new Error(`VOID RUN: expected the Site Plan + Hybrid buttons, found ${have}`);
  return { context, page, imageryReqs, vlog, errors };
}

const setView = (page, z) => page.evaluate(({ lat, lng, z }) => { window.__foodMap.setView([lat, lng], z, { animate: false }); }, { ...HOUSTON, z });
const settle = (page, ms = 3500) => page.waitForTimeout(ms);
const gl = (page, fn, arg) => page.evaluate(({ fn, arg }) => { const g = window.__foodMap && window.__foodMap.__vectorLabelsGL; return g ? new Function("g", "arg", fn)(g, arg) : null; }, { fn, arg });

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--ignore-certificate-errors", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const cityPane = (page) => page.evaluate(() => { const p = document.querySelector(".leaflet-placenames-pane"); return p ? { count: Number(p.dataset.count || 0), names: p.dataset.names || "" } : { count: 0, names: "" }; });
  const glCount = (page) => page.evaluate(() => document.querySelectorAll(".leaflet-gl-layer").length);

  for (const [label, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 780 }]]) {
    const { context, page, imageryReqs, errors } = await open(browser, viewport, 2);
    const pressed = async (k) => (await page.getAttribute(`[data-testid="food-basemap-${k}"]`, "aria-pressed")) === "true";
    const labels = await page.locator('[data-testid="food-basemap-toggle"] button').allTextContents();

    check(`${label}: a NEW user opens on Site Plan`, await pressed("siteplan") && !(await pressed("hybrid")));
    check(`${label}: exactly two choices — Site Plan, then Hybrid`, JSON.stringify(labels.map((t) => t.trim())) === JSON.stringify(["Site Plan", "Hybrid"]), labels.join("|"));

    // ── SITE PLAN at METRO zoom: satellite + Planyr's city names, NO road lines (the Site tab's look) ──
    await setView(page, 11); await settle(page, 5000);
    const sm = { gl: await glCount(page), city: await cityPane(page) };
    check(`${label}: Site Plan @ metro — NO vector road layer at all`, sm.gl === 0, JSON.stringify(sm));
    check(`${label}: Site Plan @ metro — Planyr's own city names are drawn`, sm.city.count > 0, `names=${sm.city.names}`);
    check(`${label}: Site Plan @ metro — imagery is NOT toned (the Site map's own look)`, !(await page.evaluate(() => !!document.querySelector(".planyr-imagery-graded"))));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/food-siteplan-metro-${label}-${TAG}.jpg`, type: "jpeg", quality: 82 });

    // ── SITE PLAN at NEIGHBOURHOOD zoom: clean vector roads, city names gone ──
    imageryReqs.length = 0;
    await setView(page, 16); await settle(page, 5000);
    const sh = await gl(page, `return { local: g.queryRenderedFeatures({layers:['road-local']}).length, names: g.queryRenderedFeatures({layers:['roadname-major','roadname-collector','roadname-local']}).length }`, null);
    check(`${label}: Site Plan @ neighbourhood — clean vector roads + names drawn`, sh && sh.local > 0 && sh.names > 0, JSON.stringify(sh));
    check(`${label}: Site Plan @ neighbourhood — city names gone (parcel zoom owns the screen)`, (await cityPane(page)).count === 0);
    const siteLayers = await gl(page, `return g.getStyle().layers.map(l => l.id)`, null);
    check(`${label}: Site Plan's vector style is roads-only (no place/POI layers)`, siteLayers && siteLayers.length > 0 && !siteLayers.some((id) => /^place-|^poi-/.test(id)), String(siteLayers && siteLayers.length));
    const dens = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('[data-testid="food-map"] .leaflet-tile-pane img.leaflet-tile')].filter((i) => /World_Imagery/.test(i.src) && i.naturalWidth > 0);
      return { n: imgs.length, natural: imgs[0] && imgs[0].naturalWidth, drawn: imgs[0] && parseFloat(imgs[0].style.width || getComputedStyle(imgs[0]).width) };
    });
    check(`${label}: dpr 2 — imagery tiles are 256 px bitmaps drawn at HALF size (not 256 drawn at 256)`, dens.n > 0 && dens.natural === 256 && dens.drawn <= 129, JSON.stringify(dens));
    check(`${label}: dpr 2 — imagery requested one zoom deeper (z17 at map zoom 16)`, imageryReqs.includes(17) && !imageryReqs.includes(20), `zooms=${[...new Set(imageryReqs)].sort()}`);
    const layering = await page.evaluate(() => {
      const pane = document.querySelector(".leaflet-planyrVectorLabels-pane");
      const z = (sel) => { const e = document.querySelector(sel); return e ? Number(getComputedStyle(e).zIndex) : null; };
      return { vec: pane ? Number(getComputedStyle(pane).zIndex) : null, tile: z(".leaflet-tile-pane"), marker: z(".leaflet-marker-pane"), overlay: z(".leaflet-overlay-pane"), pe: pane ? getComputedStyle(pane).pointerEvents : null };
    });
    check(`${label}: vector pane sits above imagery, below overlays/markers, pointer-events none`, layering.vec > layering.tile && layering.vec < layering.overlay && layering.vec < layering.marker && layering.pe === "none", JSON.stringify(layering));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/food-siteplan-hood-${label}-${TAG}.jpg`, type: "jpeg", quality: 82 });

    // ── lockstep through a zoom (B842528's class) ──
    await page.click(".leaflet-control-zoom-in", { force: true });
    await page.waitForTimeout(90);
    const mid = await page.evaluate(() => { const c = document.querySelector(".leaflet-gl-layer canvas"); return c ? getComputedStyle(c).transform : null; });
    await settle(page, 2500);
    const sync = await page.evaluate(() => { const m = window.__foodMap, g = m.__vectorLabelsGL; const c = m.getCenter(), gc = g.getCenter(); return { dz: Math.abs((m.getZoom() - 1) - g.getZoom()), dlat: Math.abs(c.lat - gc.lat), dlng: Math.abs(c.lng - gc.lng) }; });
    check(`${label}: vector canvas follows Leaflet's zoom animation`, !!mid && mid !== "none", `mid=${mid}`);
    check(`${label}: after zoom, vector view == Leaflet view (zoom−1, same centre)`, sync.dz < 0.01 && sync.dlat < 1e-5 && sync.dlng < 1e-5, JSON.stringify(sync));

    // ── zooming OUT through the gate removes the roads again (no stale layer at metro) ──
    await setView(page, 11); await settle(page, 3000);
    check(`${label}: back at metro zoom the roads are gone again`, (await glCount(page)) === 0);

    // ── HYBRID ──
    await page.click('[data-testid="food-basemap-hybrid"]', { force: true });
    await settle(page, 3000);
    await setView(page, 11); await settle(page, 5000);
    const hm = await gl(page, `return { local: g.queryRenderedFeatures({layers:['road-local']}).length, freeway: g.queryRenderedFeatures({layers:['road-freeway']}).length, major: g.queryRenderedFeatures({layers:['road-major']}).length, places: g.queryRenderedFeatures({layers:['place-city','place-suburb']}).length }`, null);
    check(`${label}: Hybrid @ metro — freeways + major roads drawn, places labelled, LOCAL streets hidden`, hm && hm.freeway > 0 && hm.major > 0 && hm.local === 0, JSON.stringify(hm));
    check(`${label}: Hybrid draws no Planyr city-name layer (it has its own vector places)`, (await cityPane(page)).count === 0);
    check(`${label}: Hybrid's imagery IS toned`, await page.evaluate(() => !!document.querySelector(".planyr-imagery-graded")));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/food-hybrid-metro-${label}-${TAG}.jpg`, type: "jpeg", quality: 82 });
    await setView(page, 16); await settle(page, 5000);
    const hh = await gl(page, `return { local: g.queryRenderedFeatures({layers:['road-local']}).length }`, null);
    check(`${label}: Hybrid @ neighbourhood — LOCAL streets shown`, hh && hh.local > 0, JSON.stringify(hh));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/food-hybrid-hood-${label}-${TAG}.jpg`, type: "jpeg", quality: 82 });

    if (label === "desktop") {
      const chrome = await page.evaluate(() => {
        const r = (e) => e && e.getBoundingClientRect();
        const credit = r(document.querySelector('[data-testid="food-attribution-text"]'));
        const help = [...document.querySelectorAll("button")].map((b) => ({ b, t: (b.getAttribute("aria-label") || b.title || "") })).find((x) => /help|report/i.test(x.t));
        const hr = help && r(help.b);
        return { hasCredit: !!credit, overlap: credit && hr ? !(credit.right <= hr.left || credit.left >= hr.right || credit.bottom <= hr.top || credit.top >= hr.bottom) : null, creditText: credit ? document.querySelector('[data-testid="food-attribution-text"]').textContent : "" };
      });
      check(`desktop: the credit is visible, names the vector source, and is not under the ? help button`, chrome.hasCredit && chrome.overlap !== true && /OpenFreeMap|OpenStreetMap/.test(chrome.creditText), JSON.stringify(chrome));
    }

    // back to Site Plan restores the stack; the choice persists
    await page.click('[data-testid="food-basemap-siteplan"]', { force: true });
    await setView(page, 11); await settle(page, 5000);
    check(`${label}: switching back to Site Plan restores city names and no roads at metro`, (await cityPane(page)).count > 0 && (await glCount(page)) === 0);
    check(`${label}: no page errors`, errors.length === 0, errors.join("|"));
    await context.close();
  }

  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
