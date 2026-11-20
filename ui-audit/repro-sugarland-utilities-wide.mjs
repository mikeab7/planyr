/* Repro: Sugar Land Water / Sewer Lines at the WIDE zoom a developer actually works at (owner report 2026-11-06 16:10 CT, build ae04c79):
 * Map Base on, Zoning on, view ~8 km across (≈ zoom 15). Records every request to CDM Smith's service (count, status, features, time) and what the layers painted. */
import { chromium } from "@playwright/test";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.argv.find((a) => /^https?:/.test(a)) || "http://localhost:4173";
const CENTER = { lat: 29.595, lng: -95.62 };
const TAG = Math.random().toString(36).slice(2, 7);
const plan = { schemaVersion: 12, id: `zz-wide-${TAG}`, groupId: `zz-wide-${TAG}`, site: "ZZ wide repro", name: "Plan 1", origin: { lat: CENTER.lat, lon: CENTER.lng }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }], underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [], updatedAt: Date.now(), data: { status: "active" } };
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify({ [plan.id]: plan }));
const log = []; const t0 = Date.now();
page.on("request", (r) => { if (/VVapzOPgBae5joyC/.test(r.url())) r._t = Date.now(); });
page.on("response", async (res) => {
  const u = res.url(); if (!/VVapzOPgBae5joyC/.test(u)) return;
  let n = null, exceeded = null; try { const j = await res.json(); n = Array.isArray(j.features) ? j.features.length : j.count; exceeded = j.exceededTransferLimit; } catch (_) {}
  if (/FeatureServer\/(17|20)\//.test(u) && !globalThis.__dumped?.[u.match(/FeatureServer\/(\d+)/)[1]]) { (globalThis.__dumped ??= {})[u.match(/FeatureServer\/(\d+)/)[1]] = 1; console.log("DUMP", decodeURIComponent(u).slice(0, 700)); try { console.log("BODY", JSON.stringify(await res.json()).slice(0, 400)); } catch (e) { console.log("BODY (unreadable)", String(e).slice(0, 80)); } }
  log.push({ t: Date.now() - t0, layer: (u.match(/FeatureServer\/(\d+)\//) || [])[1], status: res.status(), n, exceeded, url: u });
});
const msgs = []; page.on("console", (m) => { if (/overbudget|too detailed|not responding|budget|slow/i.test(m.text())) msgs.push(m.text().slice(0, 160)); });
await assertMeasurable(page, "repro-sugarland-utilities-wide");
await page.goto(`${BASE}/?planyrDiag=1#/project/${plan.id}/site`, { waitUntil: "domcontentloaded" });
await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
await page.waitForTimeout(2500);
const chip = page.getByTestId("layers-expand").filter({ visible: true }); if (await chip.count()) await chip.first().click();
const panel = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first(); await panel.waitFor({ state: "visible" }); await page.waitForTimeout(1200);
const on = async (group, id) => { await panel.getByTestId(`layer-group-${group}`).click(); await page.waitForTimeout(250); const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first(); if (!(await cb.isChecked())) await cb.check(); };
await on("jur", "sl_zoning");
const ppf = () => page.evaluate(() => Number(document.querySelector("[data-view-ppf]").getAttribute("data-view-ppf")));
const box = await page.getByTestId("planner-canvas").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
const TARGET = Number(process.argv.find((a) => a.startsWith("--ppf="))?.slice(6) || 0.07);
for (let i = 0; i < 40 && (await ppf()) > TARGET; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(350); }
console.log("view ppf", await ppf(), "(zoom 15 ≈ 0.064 ppf)");
await on("util", "sl_water_lines"); await on("util", "sl_sewer_lines");
await page.evaluate(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ entryTypes: ["longtask"] }); } catch (_) {} });
{ /* time to paint: poll the painted counts */
  const t1 = Date.now(); let last = -1, stableSince = Date.now(), first = null;
  while (Date.now() - t1 < 60000) {
    const c = await page.evaluate(() => { const h = window.__plannerLayers && window.__plannerLayers(); return h ? (h.features.sl_water_lines || 0) + (h.features.sl_sewer_gravity || 0) : 0; });
    if (c > 50 && first == null) first = Date.now() - t1;
    if (c !== last) { last = c; stableSince = Date.now(); }
    if (c > 0 && Date.now() - stableSince > 4000) break;
    await page.waitForTimeout(500);
  }
  const lt = await page.evaluate(() => window.__lt);
  console.log(`first >50 painted after ${first}ms; settled at ${last} paths after ${Date.now() - t1 - 4000}ms; long tasks: n=${lt.length} total=${Math.round(lt.reduce((a, b) => a + b, 0))}ms max=${Math.round(Math.max(0, ...lt))}ms`);
}
for (const secs of [0]) {
  await page.waitForTimeout((secs - (secs === 8 ? 0 : secs === 20 ? 8 : 20)) * 1000);
  const L = await page.evaluate(() => (window.__plannerLayers ? window.__plannerLayers() : null)).then((h) => h && Object.fromEntries(Object.entries(h.features).filter(([k]) => /^sl_(water_lines|sewer_)/.test(k))));
  const mine = log.filter((e) => /^(17|18|19|20)$/.test(e.layer));
  const per = {}; for (const e of mine) { per[e.layer] ??= { reqs: 0, feats: 0, ok: 0, exceeded: 0 }; per[e.layer].reqs++; per[e.layer].feats += e.n || 0; if (e.status === 200) per[e.layer].ok++; if (e.exceeded) per[e.layer].exceeded++; }
  console.log(`t+${secs}s painted:`, JSON.stringify(L), " requests:", JSON.stringify(per), " total reqs:", log.length);
}
console.log("first requests:", log.slice(0, 4).map((e) => `${e.layer} ${e.status} n=${e.n} exc=${e.exceeded}`).join(" | "));
console.log("console notes:", msgs.slice(0, 5).join(" || ") || "(none)");
await page.screenshot({ path: process.argv.find((a) => a.startsWith("--shot="))?.slice(7) || "/tmp/wide.png" });
await browser.close();
