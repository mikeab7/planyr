/* verify-florida-layers-live — the Florida due-diligence layers (B2452976), measured in a REAL browser against REAL services.
 *
 *   LIVE (signed in as the test account, on the deployed build):
 *     E2E_LOGIN_KEY=… node ui-audit/verify-florida-layers-live.mjs https://planyr.io [--expect-sha <sha>] [--shots <dir>]
 *   LOCAL (before the relay is deployed to the apex, or to check a branch): the app served by `npm run dev` / `vite preview`, signed OUT, with every /gis-proxy/* request
 *   answered from a Cloudflare preview of the same repo (the relay is a Pages Function, so a local server cannot run it):
 *     node ui-audit/verify-florida-layers-live.mjs http://localhost:5173 --relay https://<branch>.planyr.pages.dev
 *
 * For each Florida row it opens the Map at a point where the row's own source is KNOWN to hold features (measured 2026-10-29), turns the row ON through the Layers
 * panel exactly as a person does, waits for the layer's own requests to settle and asserts:
 *   · the layer's service was actually ASKED, answered 200 with no error body, and returned ≥ 1 feature at that point  (an endpoint that fails / returns empty = FAIL);
 *   · no main-thread stall past the budget (a layer that freezes a pan fails);
 *   · the row is OFFERED here and is NOT offered on a Houston view (scope), and issues ZERO requests to a Florida host there (nothing leaks).
 * KNOWN-GOOD ARM (FOREGROUND-OR-VOID / WRONG-CASE): the run is VOID, never green, when no Florida row returned a feature through the flow (the instrument itself would be broken)
 * or when no row was reached at all. */
import { mkdirSync, existsSync } from "node:fs";
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const RELAY = flag("--relay");
const SHOTS = flag("--shots");
const EXPECT_SHA = flag("--expect-sha");
const BUDGET = Number(flag("--budget-ms", "2500"));
const VP = (flag("--viewport", "1400x900")).split("x").map(Number);
const ONLY = (flag("--only", "") || "").split(",").filter(Boolean);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0, reached = 0, goodRows = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

/* id → [lng, lat, zoom, url regex that identifies THIS layer's own requests] — points measured 2026-10-29 (see sourceFixturesFlorida.js). */
const SITE = [-80.2554, 26.1666];
const CASES = {
  fl_county: [SITE[0], SITE[1], 9, /Counties_Hosted\/FeatureServer\/5/],
  fl_city: [SITE[0], SITE[1], 11, /par_citylm_2021/],
  fl_wmd: [SITE[0], SITE[1], 8, /BDWMD_Boundary_Area/],
  fl_evac_zones: [-80.13, 25.79, 13, /KYZ_ZL_Vector/],
  "fl_evac_zones#stpete": [-82.64, 27.77, 12, /KYZ_ZL_Vector/], // the densest coastline in the state (Pinellas): the draw budget must not refuse it
  "fl_evac_zones#stpete13": [-82.64, 27.77, 13, /KYZ_ZL_Vector/],
  "fl_evac_zones#stpete11": [-82.64, 27.77, 11, /KYZ_ZL_Vector/],
  "fl_evac_zones#naples": [-81.8, 26.14, 11, /KYZ_ZL_Vector/],
  "fl_sinkhole_areas#tampa12": [-82.46, 28.0, 12, /FGS_PUBLIC\/MapServer\/5/],
  "fl_sinkhole_areas#tampa": [-82.46, 28.0, 14, /FGS_PUBLIC\/MapServer\/5/],
  fl_drainage_districts_broward: [-80.25, 26.27, 12, /DrainageDistricts/],
  fl_sfwmd_canals: [SITE[0], SITE[1], 14, /Canals\/FeatureServer\/5/],
  fl_sfwmd_row_permits: [SITE[0], SITE[1], 14, /Rights_of_Way_Permits/],
  fl_wellfield_broward: [SITE[0], SITE[1], 14, /WellfieldProtectionZones/],
  fl_wellfield_miamidade: [-80.45, 25.9, 12, /WellFieldProtectionArea_gdb/],
  fl_erp_sfwmd: [SITE[0], SITE[1], 14, /Approved_Environmental_Resource_Permits/],
  fl_conservation_lands: [-80.9, 25.4, 10, /FL_Conservation_Lands_web/],
  fl_wetlands_broward: [-80.3, 25.99, 14, /AWR_Wetlands_noDER/],
  fl_natural_lands_broward: [-80.2, 26.27, 13, /Protected_Natural_Lands/],
  fl_sfwmd_conservation_easements: [-80.3, 26.1, 12, /Reg_Conservation_Easement/],
  fl_contamination_sites: [SITE[0], SITE[1], 14, /CLEANUP_SP\/MapServer\/0/],
  fl_brownfield_areas: [-80.2, 25.917, 12, /BROWNFIELD_AREAS/],
  fl_institutional_controls: [SITE[0], SITE[1], 14, /DWM_WASTE_ICR_BACKG\/MapServer\/12/],
  fl_sinkhole_reports: [-82.4977, 28.1147, 12, /FGS_SUBSIDENCE/],
  fl_sinkhole_areas: [-82.46, 28.15, 11, /FGS_PUBLIC\/MapServer\/5/],
  fl_outstanding_florida_waters: [-80.14, 25.92, 12, /OFW\/MapServer\/0/],
  fl_panther_consultation: [-81.42, 26.42, 10, /PANTHER_CONSULT_AREA/],
  fl_eagle_nesting: [-81.4, 28.55, 12, /Eagle_Nesting_Locations/],
  fl_fll_noise: [-80.15, 26.07, 12, /FLLNoise2020Contours/],
  fl_udb_miamidade: [-80.4, 25.9, 11, /UrbanDevelopmentBoundary/],
  fl_sis_highways: [-80.2, 25.79, 12, /SISHighway_SIO/],
};
/* Counties & Cities is ONE merged row (county + city together); its Florida members are checked through it. */
const ROW_OF = { fl_county: "counties_cities", fl_city: "counties_cities" };
const FL_HOSTS = /ca\.dep\.state\.fl\.us|geoweb\.sfwmd\.gov|gis\.myfwc\.com|bcgishub\.broward\.org|sDAPyc2rGRn7vf9B|JMAJrTsHNLrSsWf5|8Pc9XBTAsYuxx9Ny|3wFbqsFPLeKqOlIK|z6TmTIyYXEYhuNM0|9Jk4Zl9KofTtvg3x|O1JpcwDW8sjYuddV/;

let browser, page, close = async () => {};
if (RELAY) {
  browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] } });
  page = await ctx.newPage();
  // the Pages Function relay lives on the preview, not on a local server: answer /gis-proxy/* from it
  await page.route(/\/gis-proxy\//, async (route) => {
    const u = new URL(route.request().url());
    try {
      const r = await fetch(RELAY + u.pathname + u.search, { headers: { "user-agent": "Mozilla/5.0 Chrome/120" } });
      route.fulfill({ status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" }, body: Buffer.from(await r.arrayBuffer()) });
    } catch (e) { route.abort(); }
  });
  close = () => browser.close();
} else {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  page = s.page;
  console.log(`signed in as ${s.proof.email}`);
}
await page.addInitScript(() => {
  window.__PLANYR_E2E = true;
  /* count every draw-budget refusal ("too detailed to draw"): the layer's status dot is overwritten by the next 'load' (so it can read "loaded" after a refusal) — the EVENT is the truth */
  const t = setInterval(() => {
    if (window.L && window.L.Evented && !window.__obWrapped) {
      window.__obWrapped = true; clearInterval(t);
      const f = window.L.Evented.prototype.fire;
      window.L.Evented.prototype.fire = function (type) { if (type === "overbudget") (window.__overbudget = window.__overbudget || []).push(1); return f.apply(this, arguments); };
    }
  }, 2);
});
await assertMeasurable(page, "verify-florida-layers-live");
await page.setViewportSize({ width: VP[0], height: VP[1] });
if (!RELAY) {
  const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
  console.log(`served build ${served}`);
  if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
}

const sleep = (ms) => page.waitForTimeout(ms);
let log = [];
page.on("request", (r) => { if (FL_HOSTS.test(r.url()) || /gis-proxy/.test(r.url())) log.push({ url: r.url(), sent: true }); });
page.on("response", async (res) => {
  const u = res.url();
  if (!(FL_HOSTS.test(u) || /gis-proxy/.test(u)) || !/\/query/.test(u)) return;
  const e = { url: u, status: res.status(), features: null, error: null, ids: [] };
  try { const j = await res.json(); e.features = Array.isArray(j.features) ? j.features.length : null; if (Array.isArray(j.features)) e.ids = j.features.map((f) => { const a = f.attributes || f.properties || {}; return String(a.OBJECTID ?? a.FID ?? a.objectid ?? Object.values(a)[0]); }); if (j.error) e.error = JSON.stringify(j.error).slice(0, 120); } catch (_) { /* not json */ }
  log.push(e);
});

async function freshMap(lng, lat, z) {
  await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="layer-panel"][data-surface="finder"]'), null, { timeout: 60000 });
  await sleep(1200);
  await page.evaluate(([a, b, zz]) => window.__mapFinderMap.setView([a, b], zz, { animate: false }), [lat, lng, z]);
  await sleep(1200);
  await page.evaluate(() => {
    window.__stall = { max: 0, last: performance.now() };
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { const n = performance.now(); window.__stall.max = Math.max(window.__stall.max, n - window.__stall.last); window.__stall.last = n; setTimeout(() => ch.port2.postMessage(0), 16); };
    ch.port2.postMessage(0);
  });
}
const panel = () => page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
async function findRow(id) {
  const p = panel();
  for (const g of ["jur", "util", "env", "flood", "access", "topo", "base"]) {
    const btn = p.getByTestId(`layer-group-${g}`);
    if (await btn.count()) { await btn.click().catch(() => {}); await sleep(250); }
    else { const sel = p.getByTestId("layer-group-select"); if (await sel.count()) { await sel.selectOption(g).catch(() => {}); await sleep(250); } }
    if (await p.locator(`[data-testid="layer-row-${id}"]`).count()) return true;
  }
  return false;
}
async function rowOffered(id) { return findRow(id); }
async function turnOn(id) {
  return page.evaluate((rowId) => {
    const cb = document.querySelector(`[data-testid="layer-panel"][data-surface="finder"] [data-testid="layer-row-${rowId}"] input[type="checkbox"]`);
    if (!cb) return false;
    window.__stall.max = 0; window.__stall.last = performance.now();
    if (!cb.checked) setTimeout(() => cb.click(), 0);
    return true;
  }, id);
}
async function settle(re, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(800);
    if (log.some((e) => !e.sent && re.test(e.url))) { await sleep(2500); return; }
  }
}

const ids = Object.keys(CASES).filter((id) => !ONLY.length || ONLY.includes(id));
for (const key of ids) {
  const id = key.split("#")[0];
  const [lng, lat, z, re] = CASES[key];
  log = [];
  await freshMap(lng, lat, z);
  const row = ROW_OF[id] || id;
  const offered = await rowOffered(row);
  check(`${key} · offered on a Florida view`, offered);
  if (!offered) continue;
  reached++;
  const ok = await turnOn(row);
  if (!ok) { check(`${key} · turned on`, false, "no checkbox"); continue; }
  await settle(re);
  const mine = log.filter((e) => !e.sent && re.test(e.url));
  const good = mine.filter((e) => e.status === 200 && !e.error && e.features > 0);
  const bad = mine.filter((e) => e.status !== 200 || e.error);
  if (good.length && !bad.length) goodRows++;
  check(`${key} · its service was asked and answered with features at the known point`, good.length > 0 && !bad.length, `asked ${mine.length}, ≥1 feature in ${good.length}${bad.length ? `, ${bad.length} FAILED ${bad[0].status} ${bad[0].error || ""}` : ""}`);
  /* WHAT WAS DRAWN vs WHAT ARRIVED: the layer's own drawn-feature count (esri-leaflet keeps one entry per drawn feature) against the distinct features its service delivered. A draw-budget
   * refusal ("too detailed to draw"), a dropped page or a failed paint all show up as drawn < arrived — a service that answers 200 can still leave an empty map. */
  const arrived = new Set(mine.flatMap((e) => e.ids || [])).size;
  const vector = key.startsWith("fl_county") || key.startsWith("fl_city");
  const drawn = vector ? null : await page.evaluate((src) => {
    let n = 0; const re = new RegExp(src);
    window.__mapFinderMap.eachLayer((l) => { if (l.options && l.options.url && re.test(l.options.url) && l._layers) n += Object.keys(l._layers).length; });
    return n;
  }, re.source);
  const refused = await page.evaluate(() => (window.__overbudget || []).length);
  if (!vector) check(`${key} · the layer DREW what its service delivered (nothing refused as "too detailed to draw")`, drawn >= 1 && refused === 0, `drew ${drawn} of ${arrived} features delivered (more arrive than are in view); ${refused} draw-budget refusals`);
  const stall = await page.evaluate(() => Math.round(window.__stall.max));
  check(`${key} · no main-thread stall past ${BUDGET} ms`, stall <= BUDGET, `${stall} ms`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${id}.png` });
}

/* ── scope: a Houston view offers none of the Florida rows and sends nothing to a Florida host ─────────────────────────────────────────────────── */
log = [];
await freshMap(-95.37, 29.76, 10);
let leaked = [];
for (const id of Object.keys(CASES)) if (await rowOffered(id)) leaked.push(id);
check("scope · a Houston view offers none of the Florida rows", leaked.length === 0, leaked.join(", "));
check("scope · a Houston view sent ZERO requests to a Florida host", log.filter((e) => e.sent && FL_HOSTS.test(e.url)).length === 0, `${log.filter((e) => e.sent && FL_HOSTS.test(e.url)).length} sent`);

/* ── region scope INSIDE Florida: a Tampa view (SWFWMD, Hillsborough) is offered the statewide rows and none of the county / district rows ────────────── */
const REGIONAL = ["fl_drainage_districts_broward", "fl_wellfield_broward", "fl_wellfield_miamidade", "fl_wetlands_broward", "fl_natural_lands_broward", "fl_erp_sfwmd", "fl_sfwmd_canals", "fl_sfwmd_row_permits",
  "fl_sfwmd_conservation_easements", "fl_fll_noise", "fl_udb_miamidade", "fl_panther_consultation"];
await freshMap(-82.46, 27.95, 10);
const tampaLeaks = [];
for (const id of REGIONAL) if (await rowOffered(id)) tampaLeaks.push(id);
check("scope · a Tampa view is offered none of the Broward / Miami-Dade / SFWMD / panther-area rows", tampaLeaks.length === 0, tampaLeaks.join(", "));
const tampaHas = [];
for (const id of ["fl_evac_zones", "fl_conservation_lands", "fl_sinkhole_areas", "fl_contamination_sites"]) if (await rowOffered(id)) tampaHas.push(id);
check("scope · …but IS offered the statewide rows (known-good arm for the scope check)", tampaHas.length === 4, tampaHas.join(", "));

/* ── known-good: at least one Florida row really answered with features through this very flow (else the flow itself is broken → VOID, never green) ───── */
if (!goodRows) { console.log("VOID: no Florida row returned a feature — the flow itself may be broken"); voided++; }

if (!reached) { console.log("VOID: no Florida row was reached"); voided++; }
await close();
console.log(failed || voided ? `\n${failed} failed, ${voided} void` : `\nall ${ids.length} Florida rows reached, answered and held the budget`);
process.exit(failed || voided ? 1 : 0);
