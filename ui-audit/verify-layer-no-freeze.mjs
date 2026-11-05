/* verify-layer-no-freeze — NO LAYER MAY FREEZE THE TAB (B2507064 / NEW-9), measured LIVE on planyr.io signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-layer-no-freeze.mjs [https://planyr.io] --ids ms_desoto_discover,ms_desoto_zoning,… [--view 34.93,-90.00,10] [--budget-ms 2500]
 *       [--expect-sha <sha>] [--expect-absent] [--shots <dir>]
 *
 * The owner's repro (2026-10-29, 12:54 PM CT): zoomed OUT over DeSoto County (Walls … Olive Branch in view), Layers › Jurisdictions, tick "Discover DeSoto — I-269 Corridor…"
 * → Chrome "Page Unresponsive". Measured from the source: that layer is 12 polygons but 707,071 VERTICES (one polygon is 634,514 of them; the response is 28 MB),
 * and esri-leaflet's default is full precision + no simplification — so zoomed out the browser builds a 634 k-vertex SVG path per frame.
 *
 * For each id this turns the layer ON at the zoomed-out view and records the MAIN-THREAD STALL (the largest gap between two heartbeats of a MessageChannel loop,
 * which an rAF/timer clamp cannot fake — FOREGROUND-OR-VOID), plus long-task entries. A layer fails when its worst stall exceeds the budget or the tab stops answering
 * for 60 s (the hang itself — reported, not scored as an error in the harness).
 *   --expect-absent  the ids must NOT be offered at all (the removed layer): the row must not exist in any group.
 * KNOWN-GOOD ARM: a light row (Counties & Cities) must also be turned on and must come in under the budget, else the run is VOID. */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const IDS = (flag("--ids", "") || "").split(",").map((s) => s.trim()).filter(Boolean); // "id" (at --view) or "id@zoom" (at that zoom, same centre)
const [VLAT, VLNG, VZ] = (flag("--view", "34.96,-89.83,10")).split(",").map(Number);
const BUDGET = Number(flag("--budget-ms", "2500"));
const EXPECT_SHA = flag("--expect-sha"), SHOTS = flag("--shots"), ABSENT = args.includes("--expect-absent");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
await assertMeasurable(page, "verify-layer-no-freeze");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);

const sleep = (ms) => page.waitForTimeout(ms);
// every GIS request in flight: a layer is not "settled" until its download has ARRIVED (the 28 MB answer is what the browser then has to draw)
let inflight = 0, bytes = 0, lastNet = Date.now();
page.on("request", (r) => { if (/gis-proxy|arcgis|FeatureServer|MapServer/.test(r.url())) { inflight++; lastNet = Date.now(); } });
const done = async (r) => { if (/gis-proxy|arcgis|FeatureServer|MapServer/.test(r.url())) { inflight = Math.max(0, inflight - 1); lastNet = Date.now(); } };
page.on("requestfinished", async (r) => { try { const b = await r.sizes(); bytes += b.responseBodySize || 0; } catch (_) { /* size unknown */ } done(r); });
page.on("requestfailed", done);
async function freshMap(zoom = VZ) {
  await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="layer-panel"][data-surface="finder"]'), null, { timeout: 60000 });
  await sleep(1500);
  await page.evaluate(([a, b, z]) => window.__mapFinderMap.setView([a, b], z, { animate: false }), [VLAT, VLNG, zoom]);
  await sleep(1500);
  // heartbeat: the largest gap between two MessageChannel ticks = the longest the main thread was unavailable
  await page.evaluate(() => {
    window.__stall = { max: 0, last: performance.now(), long: [] };
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { const n = performance.now(); window.__stall.max = Math.max(window.__stall.max, n - window.__stall.last); window.__stall.last = n; setTimeout(() => ch.port2.postMessage(0), 16); };
    ch.port2.postMessage(0);
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__stall.long.push(Math.round(e.duration)))).observe({ entryTypes: ["longtask"] }); } catch (_) { /* no longtask support */ }
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
async function turnOn(id) {
  // click INSIDE the page (deferred a tick) so this call returns even when the click then blocks the thread
  return page.evaluate((rowId) => {
    const cb = document.querySelector(`[data-testid="layer-panel"][data-surface="finder"] [data-testid="layer-row-${rowId}"] input[type="checkbox"]`);
    if (!cb) return false;
    window.__stall.max = 0; window.__stall.long = []; window.__stall.last = performance.now(); window.__t0 = performance.now();
    setTimeout(() => cb.click(), 0);
    return true;
  }, id);
}
async function stallOf(maxWaitMs = 120000) {
  const t0 = Date.now(); let hung = false;
  // wait for the page to answer AND settle (no new long task for ~4 s)
  let quietSince = Date.now(), lastCount = -1;
  while (Date.now() - t0 < maxWaitMs) {
    const r = await Promise.race([page.evaluate(() => ({ max: window.__stall.max, long: window.__stall.long.slice() })), new Promise((res) => setTimeout(() => res(null), 8000))]);
    if (!r) { hung = true; continue; }
    if (r.long.length !== lastCount) { lastCount = r.long.length; quietSince = Date.now(); }
    if (Date.now() - quietSince > 4000 && inflight === 0 && Date.now() - lastNet > 4000) return { ...r, hung };
    await new Promise((res) => setTimeout(res, 500));
  }
  const r = await Promise.race([page.evaluate(() => ({ max: window.__stall.max, long: window.__stall.long.slice() })), new Promise((res) => setTimeout(() => res(null), 5000))]);
  return r ? { ...r, hung } : { max: Infinity, long: [], hung: true, unresponsive: true };
}

await freshMap();
console.log(`view ${VLAT},${VLNG} z${VZ}; budget ${BUDGET} ms`);

// KNOWN-GOOD arm: Counties & Cities is a light layer — it must come in far under the budget, or the instrument is not measuring what it says
if (await findRow("counties_cities")) {
  await turnOn("counties_cities");
  const k = await stallOf(30000);
  console.log(`known-good (counties_cities): worst stall ${Math.round(k.max)} ms, long tasks ${JSON.stringify(k.long)}`);
  if (k.hung || k.max > BUDGET) { console.log("VOID: the known-good light layer itself exceeded the budget — the instrument or the page is unhealthy"); voided++; }
  else check("KNOWN-GOOD arm: a light layer turns on with no stall over the budget", true, `${Math.round(k.max)} ms`);
} else { console.log("VOID: the known-good row (counties_cities) is not offered at this view"); voided++; }

for (const spec of IDS) {
  const [id, zs] = spec.split("@");
  const zoom = zs ? Number(zs) : VZ;
  await freshMap(zoom);
  const offered = await findRow(id);
  if (ABSENT) { check(`"${id}" is NOT offered anywhere in the Layers panel (removed)`, !offered); continue; }
  if (!offered) { check(`"${id}" is offered at this view`, false, "row not found in any group"); continue; }
  const t0 = Date.now();
  await turnOn(id);
  bytes = 0;
  const r = await stallOf(150000);
  const settled = Date.now() - t0;
  console.log(`${id}@z${zoom}: worst stall ${r.max === Infinity ? "∞ (tab unresponsive)" : Math.round(r.max) + " ms"}; long tasks ${JSON.stringify(r.long)}; downloaded ${(bytes / 1e6).toFixed(1)} MB; ${r.hung ? "page stopped answering at least once; " : ""}settled after ${settled} ms`);
  check(`"${id}" at zoom ${zoom} turns on without freezing the tab (worst stall within ${BUDGET} ms)`, !r.hung && r.max <= BUDGET, r.max === Infinity ? "tab unresponsive" : `${Math.round(r.max)} ms`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${id}-z${zoom}.png` }).catch(() => {});
}
await s.browser.close().catch(() => {});
console.log(voided ? `VOID (${voided})` : failed ? `FAIL (${failed})` : "PASS");
process.exit(voided ? 2 : failed ? 1 : 0);
