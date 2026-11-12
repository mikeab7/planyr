/* verify-houston-metro-live — the Houston-metro sweep layers (NEW-1 MTFP · NEW-2 airport tiers · NEW-3 evacuation Zip-Zones, 2026-11-12), in a REAL browser against the REAL services.
 *
 *   LIVE (signed in as the test account, on the deployed build):
 *     E2E_LOGIN_KEY=… node ui-audit/verify-houston-metro-live.mjs https://planyr.io [--expect-sha <sha>] [--shots <dir>]
 *   LOCAL (a branch build served by `vite preview`, signed OUT — the three hosts are CORS-open so nothing needs the relay):
 *     node ui-audit/verify-houston-metro-live.mjs http://localhost:4173 --local
 *
 * For each row it opens the Map at a point where the row's own source is KNOWN to hold features (measured 2026-11-12, see shared/gis/sourceFixturesHoustonMetro.js), turns the row ON through
 * the Layers panel exactly as a person does, and asserts:
 *   · the layer's service was ASKED, answered 200 with no error body, and returned ≥ 1 feature there;
 *   · the layer DREW what arrived (nothing refused as "too detailed to draw"), with no page error and no main-thread stall past the budget;
 *   · a REAL click on the drawn feature opens ONE clean card carrying the expected words (Hardy Toll Rd · HCTRA; Bush Intercontinental · Tier 1; Zip-Zone A · Anahuac);
 *   · SCOPE: the row is offered at its known place and is NOT offered on a Dallas view (nothing is requested from its host there).
 * KNOWN-GOOD ARM (FOREGROUND-OR-VOID / WRONG-CASE): the run is VOID, never green, when no row returned a feature through the flow or when no row was reached. */
import { mkdirSync, existsSync } from "node:fs";
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const LOCAL = args.includes("--local");
const SHOTS = flag("--shots");
const EXPECT_SHA = flag("--expect-sha");
const BUDGET = Number(flag("--budget-ms", "2500"));
const VP = (flag("--viewport", "1400x900")).split("x").map(Number);
const ONLY = (flag("--only", "") || "").split(",").filter(Boolean);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0, reached = 0, goodRows = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

/* id → [lng, lat, zoom, url regex of THIS layer's own requests, regex the clicked card must match] — points measured 2026-11-12. */
const CASES = {
  harris_mtfp: [-95.36889590, 29.88597061, 15, /MTFP\/MapServer\/0/, /Hardy Toll Rd[\s\S]*Harris County Toll Road Authority/],
  "harris_mtfp#westheimer": [-95.38885436, 29.74451572, 15, /MTFP\/MapServer\/0/, /Westheimer Rd[\s\S]*(lanes|Class)/],
  "harris_mtfp#westheimer16": [-95.38885436, 29.74451572, 16, /MTFP\/MapServer\/0/, /Westheimer Rd/], // street names print from this zoom: the labelled view is measured too
  has_airport_tiers: [-95.34, 29.99, 11, /Houston_Airport_System\/MapServer\/7/, /Bush Intercontinental[\s\S]*Tier 1/],
  "has_airport_tiers#hobby": [-95.277, 29.645, 11, /Houston_Airport_System\/MapServer\/7/, /Hobby[\s\S]*Tier 1/],
  tx_evac_zones: [-94.41881675, 29.58574519, 11, /HurricaneEvac_Zones\/FeatureServer\/0/, /Zip-Zone[\s\S]*(Anahuac|Chambers)/i],
  "tx_evac_zones#galveston": [-94.8, 29.3, 10, /HurricaneEvac_Zones\/FeatureServer\/0/, /Zip-Zone/],
};
const HOSTS = /gis\.hctx\.net|geogimsms\.houstontx\.gov|su8ic9KbA7PYVxPS/;

let browser, page, close = async () => {};
if (LOCAL) {
  browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] } });
  page = await ctx.newPage();
  close = () => browser.close();
} else {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  page = s.page;
  console.log(`signed in as ${s.proof.email}`);
}
await page.addInitScript(() => {
  window.__PLANYR_E2E = true;
  const t = setInterval(() => {
    if (window.L && window.L.Evented && !window.__obWrapped) {
      window.__obWrapped = true; clearInterval(t);
      const f = window.L.Evented.prototype.fire;
      window.L.Evented.prototype.fire = function (type) { if (type === "overbudget") (window.__overbudget = window.__overbudget || []).push(1); return f.apply(this, arguments); };
    }
  }, 2);
});
await assertMeasurable(page, "verify-houston-metro-live");
await page.setViewportSize({ width: VP[0], height: VP[1] });
if (!LOCAL) {
  const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
  console.log(`served build ${served}`);
  if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
}

const sleep = (ms) => page.waitForTimeout(ms);
let log = [];
let pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e && e.message || e).slice(0, 160)));
page.on("request", (r) => { if (HOSTS.test(r.url())) log.push({ url: r.url(), sent: true }); });
page.on("response", async (res) => {
  const u = res.url();
  if (!HOSTS.test(u) || !/\/query/.test(u)) return;
  const e = { url: u, status: res.status(), features: null, error: null, ids: [] };
  try {
    const j = await res.json();
    e.features = Array.isArray(j.features) ? j.features.length : null;
    if (j.error) e.error = String(j.error.message || j.error.code);
    if (Array.isArray(j.features)) e.ids = j.features.map((f) => { const a = f.attributes || f.properties || {}; return String(a.OBJECTID != null ? a.OBJECTID : a.FID != null ? a.FID : JSON.stringify(a)); });
  } catch (_) { /* a non-JSON answer stays features:null → fails the check below */ }
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
async function rowOffered(id) {
  const p = panel();
  for (const g of ["jur", "flood", "access", "util", "env", "topo", "base"]) {
    const btn = p.getByTestId(`layer-group-${g}`);
    if (await btn.count()) { await btn.click().catch(() => {}); await sleep(250); }
    else { const sel = p.getByTestId("layer-group-select"); if (await sel.count()) { await sel.selectOption(g).catch(() => {}); await sleep(250); } }
    if (await p.locator(`[data-testid="layer-row-${id}"]`).count()) return true;
  }
  return false;
}
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
/* a REAL click on the map (a feature's own screen position), then read the one card that opens */
async function clickCard(lng, lat, cardRe) {
  const pt = await page.evaluate(([a, b]) => { const m = window.__mapFinderMap; const p = m.latLngToContainerPoint([a, b]); const r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lat, lng]);
  let text = "";
  for (const [dx, dy] of [[0, 0], [3, 3], [-3, 3], [6, 0], [0, -6], [10, 10], [-10, -10]]) {
    await page.mouse.click(pt.x + dx, pt.y + dy);
    await sleep(2200);
    /* the Map view opens a Leaflet popup (featureHoverAttach), the plan canvas a gis-identify card — both are the one `cardNode` */
    text = await page.locator('.leaflet-popup-content, [data-testid="gis-identify"]').first().innerText().catch(() => "");
    if (cardRe.test(text)) break;
  }
  return text;
}

const ids = Object.keys(CASES).filter((k) => !ONLY.length || ONLY.includes(k) || ONLY.includes(k.split("#")[0]));
for (const key of ids) {
  const id = key.split("#")[0];
  const [lng, lat, z, re, cardRe] = CASES[key];
  log = []; pageErrors = [];
  await freshMap(lng, lat, z);
  const offered = await rowOffered(id);
  check(`${key} · offered on a Houston-area view`, offered);
  if (!offered) continue;
  reached++;
  if (!(await turnOn(id))) { check(`${key} · turned on`, false, "no checkbox"); continue; }
  await settle(re);
  const mine = log.filter((e) => !e.sent && re.test(e.url));
  const good = mine.filter((e) => e.status === 200 && !e.error && e.features > 0);
  const bad = mine.filter((e) => e.status !== 200 || e.error);
  if (good.length && !bad.length) goodRows++;
  check(`${key} · its service was asked and answered with features at the known point`, good.length > 0 && !bad.length, `asked ${mine.length}, ≥1 feature in ${good.length}${bad.length ? `, ${bad.length} FAILED ${bad[0].status} ${bad[0].error || ""}` : ""}`);
  const arrived = new Set(mine.flatMap((e) => e.ids || [])).size;
  const drawn = await page.evaluate((src) => {
    let n = 0; const rx = new RegExp(src);
    window.__mapFinderMap.eachLayer((l) => { if (l.options && l.options.url && rx.test(l.options.url) && l._layers) n += Object.keys(l._layers).length; });
    return n;
  }, re.source);
  const refused = await page.evaluate(() => (window.__overbudget || []).length);
  check(`${key} · the layer DREW what its service delivered (nothing refused as "too detailed to draw")`, drawn >= 1 && refused === 0, `drew ${drawn} of ${arrived} delivered; ${refused} draw-budget refusals`);
  check(`${key} · …and drew ALL of it (no feature dropped by an aborted batch)`, arrived > 0 && refused === 0 ? drawn >= Math.floor(arrived * 0.97) : true, `drew ${drawn} of ${arrived}`);
  check(`${key} · no page error while it loaded`, pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  const stall = await page.evaluate(() => Math.round(window.__stall.max));
  check(`${key} · no main-thread stall past ${BUDGET} ms`, stall <= BUDGET, `${stall} ms`);
  const card = await clickCard(lng, lat, cardRe);
  console.log("   card:\n" + card.split("\n").map((l) => "     " + l).join("\n"));
  check(`${key} · a real click opens the clean card with the expected words`, cardRe.test(card));
  check(`${key} · the card carries no raw field names and no empty rows`, !/OBJECTID|HIER_TABLE|ST_TYPE|ST_STATUS|Zip5digit|ZIP_Evac|\bnull\b|undefined/.test(card), "");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${key.replace(/#/g, "-")}.png` });
}

/* ── scope: a Dallas view is offered none of the three rows and sends nothing to their hosts ───────────────────────────────────────────────────── */
log = [];
await freshMap(-96.8, 32.78, 10);
const leaked = [];
for (const id of ["harris_mtfp", "has_airport_tiers", "tx_evac_zones"]) if (await rowOffered(id)) leaked.push(id);
check("scope · a Dallas view offers none of the Houston-metro rows", leaked.length === 0, leaked.join(", "));
check("scope · a Dallas view sent ZERO requests to their hosts", log.filter((e) => e.sent && HOSTS.test(e.url)).length === 0, `${log.filter((e) => e.sent && HOSTS.test(e.url)).length} sent`);
/* Katy: inside the metro circle and Harris County (MTFP, tiers yes) but outside the airport tiers' footprint — the tiers' service answers EMPTY there (known-good arm: it was asked and answered 0). */
await freshMap(-95.82, 29.79, 11);
check("scope · a Katy view IS offered the thoroughfare plan and the airport tiers (the metro rows)", (await rowOffered("harris_mtfp")) && (await rowOffered("has_airport_tiers")));

if (!goodRows) { console.log("VOID: no row returned a feature — the flow itself may be broken"); voided++; }
if (!reached) { console.log("VOID: no row was reached"); voided++; }
await close();
console.log(failed || voided ? `\n${failed} failed, ${voided} void` : `\nall ${ids.length} Houston-metro cases reached, answered, drew and opened their card`);
process.exit(failed || voided ? 1 : 0);
