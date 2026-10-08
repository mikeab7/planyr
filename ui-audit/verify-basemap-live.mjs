#!/usr/bin/env node
/* verify-basemap-live — V1443696 / B2018608. The LIVE half of the vector-basemap work, run SIGNED IN as the
 * throwaway test account against a real deploy (shared helper lib/signedInSession.mjs; /version.json is read in
 * the SAME call as every assertion). NO synthetic vector source here — whatever the real network answers is the
 * result. It reports THREE things separately and never blends them:
 *   1. OpenFreeMap reachability from THIS network (a request log of tiles.openfreemap.org),
 *   2. the SITE PLAN stack parity between the Site tab's Map and /food's default (imagery / city names / roads),
 *   3. what the surface does when the vector source is / is not reachable (LOUD-FAILURE fallback + notice).
 * Usage: node ui-audit/verify-basemap-live.mjs [https://planyr.io] [--shots dir] */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const a = process.argv.slice(2);
const BASE = a.find((x) => /^https?:/.test(x)) || "https://planyr.io";
const DIR = a.includes("--shots") ? a[a.indexOf("--shots") + 1] : null;
if (DIR) mkdirSync(DIR, { recursive: true });
const HOUSTON = { lat: 29.8195, lng: -95.54 };
const failures = [];
const check = (label, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} — ${label}${extra ? ` (${extra})` : ""}`); if (!ok) failures.push(label); };
const info = (label, extra) => console.log(`INFO — ${label}: ${extra}`);

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); // the diagnostic map handles are read at MOUNT, so the flag must precede first load
const page = s.page;
await assertMeasurable(page, "verify-basemap-live");
const served = async () => page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
const hashes = () => page.evaluate(() => [...document.querySelectorAll("script[src]")].map((e) => e.src.split("/").pop()).filter((n) => /^index-/.test(n)));
const ofm = { ok: 0, failed: 0, urls: new Set() };
page.on("requestfinished", (r) => { if (/openfreemap\.org/.test(r.url())) { ofm.ok++; ofm.urls.add(new URL(r.url()).pathname.slice(0, 40)); } });
page.on("requestfailed", (r) => { if (/openfreemap\.org/.test(r.url())) ofm.failed++; });

const v0 = await served();
console.log(`signed in as ${s.proof.email} · served build ${JSON.stringify(v0)} · entry chunk ${(await hashes()).join(",")}`);

const fp = (mapVar) => page.evaluate((mapVar) => {
  const map = window[mapVar], root = map.getContainer(); // SCOPED to this map: the Site Map stays mounted (hidden) behind /food, and a document-wide query reads ITS panes
  const city = root.querySelector(".leaflet-placenames-pane"), g = map.__vectorLabelsGL;
  const tiles = [...root.querySelectorAll(".leaflet-tile-pane img.leaflet-tile")].map((i) => i.src);
  return {
    z: map.getZoom(),
    imagery: tiles.some((t) => /World_Imagery/.test(t)),
    cityNames: !!city && Number(city.dataset.count || 0) > 0,
    vectorRoads: !!g && g.isStyleLoaded() && g.queryRenderedFeatures({ layers: ["road-freeway", "road-major", "road-arterial", "road-collector", "road-local"] }).length > 0,
    rasterRoadsFallback: tiles.some((t) => /World_Transportation/.test(t)),
    graded: !!root.querySelector(".planyr-imagery-graded"),
    fallbackNotice: !!document.querySelector('[data-testid="food-labels-fallback"]'),
  };
}, mapVar);
const setView = (mapVar, z) => page.evaluate(({ mapVar, lat, lng, z }) => { window[mapVar].setView([z <= 13 ? 29.76 : lat, lng], z, { animate: false }); }, { mapVar, ...HOUSTON, z });
const settle = async (ms = 9000) => page.waitForTimeout(ms);

// ── /food default (Site Plan) ──
await page.evaluate(() => { window.__PLANYR_E2E = true; location.hash = "#/food"; });
await page.waitForFunction(() => window.__foodMap, null, { timeout: 30000 });
const hasToggle = await page.waitForSelector('[data-testid="food-basemap-toggle"]', { timeout: 25000 }).then(() => true, () => false);
if (!hasToggle) { console.log("DIAG — no basemap toggle on /food; page text:", (await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\n/g, " | ")); if (DIR) await page.screenshot({ path: `${DIR}/diag-food.jpg`, type: "jpeg", quality: 70 }); await s.close(); process.exit(2); }
const pressed = async (k) => (await page.getAttribute(`[data-testid="food-basemap-${k}"]`, "aria-pressed")) === "true";
check("signed in: /food opens on Satellite (the current default, B2078128) with Hybrid as the other choice", await pressed("satellite") && !(await pressed("hybrid")));
await setView("__foodMap", 11); await settle();
const f11 = await fp("__foodMap");
check("food default (Satellite) @ metro: photo only — no road layer, no Planyr city names", f11.imagery && !f11.vectorRoads && !f11.rasterRoadsFallback && !f11.cityNames, JSON.stringify(f11));
await setView("__foodMap", 16); await settle(9000);
const f16 = await fp("__foodMap");
check("food default (Satellite) @ neighbourhood: still photo only", f16.imagery && !f16.vectorRoads && !f16.rasterRoadsFallback && !f16.cityNames, JSON.stringify(f16));
if (DIR) await page.screenshot({ path: `${DIR}/live-food-satellite-hood.jpg`, type: "jpeg", quality: 80 });

// ── Hybrid ──
await page.click('[data-testid="food-basemap-hybrid"]', { force: true });
await setView("__foodMap", 11); await settle(14000);
const h11 = await fp("__foodMap");
info("hybrid @ metro", JSON.stringify(h11));
check("hybrid @ metro: toned imagery, no Planyr city layer", h11.imagery && h11.graded && !h11.cityNames, JSON.stringify(h11));
check("hybrid @ metro: REAL vector roads drawn (needs tiles.openfreemap.org reachable from this network) — a LOUD fallback + notice is the only other honest answer", h11.vectorRoads || h11.fallbackNotice, JSON.stringify({ vectorRoads: h11.vectorRoads, notice: h11.fallbackNotice, rasterFallback: h11.rasterRoadsFallback }));
const chrome = await page.evaluate(() => {
  const r = (e) => e && e.getBoundingClientRect();
  const credit = document.querySelector('[data-testid="food-attribution-text"]'), cr = r(credit);
  const help = [...document.querySelectorAll("button")].find((b) => /help|report/i.test(b.getAttribute("aria-label") || b.title || "")), hr = r(help);
  const zoom = r(document.querySelector('[data-testid="food-map"] .leaflet-control-zoom')), pill = r(document.querySelector('[data-testid="food-tiles-loading"]'));
  return { text: credit ? credit.textContent : "", overlapHelp: cr && hr ? !(cr.right <= hr.left || cr.left >= hr.right || cr.bottom <= hr.top || cr.top >= hr.bottom) : null, pillOverZoom: pill && zoom ? !(pill.right <= zoom.left || pill.left >= zoom.right || pill.bottom <= zoom.top || pill.top >= zoom.bottom) : false };
});
check("credit is fully visible, not under the ? button, names OpenFreeMap/OpenStreetMap; loading pill never over the zoom control", /OpenFreeMap|OpenStreetMap/.test(chrome.text) && chrome.overlapHelp !== true && !chrome.pillOverZoom, JSON.stringify(chrome));
if (DIR) await page.screenshot({ path: `${DIR}/live-food-hybrid-metro.jpg`, type: "jpeg", quality: 80 });

// ── Site tab Map: the Site Plan stack (unchanged look) ──
await page.evaluate(() => { location.hash = "#/site"; });
let siteMap = await page.waitForFunction(() => window.__mapFinderMap, null, { timeout: 15000 }).then(() => true, () => false);
if (!siteMap) { // a signed-in account can land inside a plan: go back to the Map (home crumb)
  await page.locator('header button:has-text("Map"), nav button:has-text("Map")').first().click({ timeout: 8000 }).catch(() => {});
  siteMap = await page.waitForFunction(() => window.__mapFinderMap, null, { timeout: 20000 }).then(() => true, () => false);
}
if (!siteMap) { console.log("DIAG — Site Map handle not found; page:", (await page.evaluate(() => location.hash + " " + document.body.innerText.slice(0, 200))).replace(/\n/g, " | ")); if (DIR) await page.screenshot({ path: `${DIR}/diag-site.jpg`, type: "jpeg", quality: 70 }); failures.push("Site Map not reachable for the check"); await s.close(); process.exit(1); }
for (const z of [11, 16]) {
  await setView("__mapFinderMap", z); await settle(z === 16 ? 14000 : 9000);
  const m = await fp("__mapFinderMap");
  info(`Site Map @ z${z}`, JSON.stringify(m));
  check(`Site Map @ z${z}: imagery drawn and UNTONED`, m.imagery && !m.graded);
  if (z === 11) check("Site Map @ metro: Planyr city names, no road layer (the look the owner likes)", m.cityNames && !m.vectorRoads && !m.rasterRoadsFallback);
  if (z === 16) check("Site Map @ neighbourhood: city names gone; roads from the vector source or the loud raster fallback (never none)", !m.cityNames && (m.vectorRoads || m.rasterRoadsFallback), JSON.stringify(m));
  if (DIR) await page.screenshot({ path: `${DIR}/live-site-map-z${z}.jpg`, type: "jpeg", quality: 80 });
}

info("OpenFreeMap requests seen by this browser", `finished=${ofm.ok} failed=${ofm.failed} ${[...ofm.urls].join(" ")}`);
const v1 = await served();
check("served build unchanged through the run (same chunk set)", JSON.stringify(v0) === JSON.stringify(v1), JSON.stringify(v1));
check("no page errors", s.errors.length === 0, s.errors.slice(0, 2).join("|"));
await s.close();
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
