/* B2024624/B2024625/B2024626 — Site planner "Click a lot on the map" (NEW-1/2/3), on a seeded Chambers County plan.
 *   NEW-1  entering the mode mounts only the outline sources under the view (not 36+ nationwide),
 *          and no statewide image is ever mounted while the Chambers source is healthy.
 *   NEW-2  long tasks after a click-to-add (PerformanceObserver 'longtask'), reported per click.
 *   NEW-3  the added lot carries the Chambers owner, and the row id is not shown as the account.
 * Logged-out against `vite preview` (:4173). The county + statewide hosts are MOCKED (the sandbox
 * egress blocks them): Chambers answers point queries with a joined-layer, table-prefixed record that
 * has NO situs. Prints a table; exits 1 on a failed assertion. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const A = "ChambersCADWeb.DBO.Accounts.", T = "ChambersCADWeb.DBO.TaxParcels.";
const site = {
  id: "uiaudit-outlines", groupId: "uiaudit-outlines", site: "Grand Port Demo", name: "Concept A (copy)",
  origin: { lat: 29.84, lon: -94.88 }, county: "chambers",
  parcels: [{ id: "pc1", locked: true, points: [{ x: -300, y: -200 }, { x: 300, y: -200 }, { x: 300, y: 200 }, { x: -300, y: 200 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
if (process.env.FIXTURE === "turner") { // real 14-parcel / 58-element plan (redacted) — a realistic render load
  const f = JSON.parse(readFileSync(new URL("./fixtures/turner-jv-concept-a.json", import.meta.url), "utf8"));
  Object.assign(site, { parcels: f.parcels, els: f.els, settings: f.settings, county: "chambers" });
}
const seed = `(() => { try { localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${site.id}': ${JSON.stringify(site)} })); localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)}); } catch (e) {} })();`;

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(c ? "  ✅" : "  ❌", l); };
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const hosts = new Map();
const cors = { "access-control-allow-origin": "*" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
await ctx.route(/./, async (route) => {
  const u = new URL(route.request().url());
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
  if (/arcgis|pandai|geographic\.texas|gis|hctx|mapserver|featureserver/i.test(u.href)) { if (/parcel|cad|tax|land|lot/i.test(u.pathname)) hosts.set(u.hostname, (hosts.get(u.hostname) || 0) + 1); if (process.env.SHOW_URLS) console.log('   url', u.href.slice(0, 140)); }
  if (/gisdata\.pandai\.com/.test(u.href)) {
    const url = u.href;
    if (/\/query/.test(url) && /esriGeometryPoint/.test(decodeURIComponent(url))) {
      let x = -94.88, y = 29.84; try { const g = JSON.parse(u.searchParams.get("geometry")); x = g.x; y = g.y; } catch {}
      const oid = Math.abs(Math.round(x * 1e5)) % 100000 * 100 + Math.abs(Math.round(y * 1e5)) % 100;
      const d = 0.0008;
      return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({
        geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 },
        features: [{ attributes: { [T + "OBJECTID"]: oid, [T + "Name"]: String(oid), [A + "OBJECTID"]: 2933785, [A + "Account"]: "00321-02000-00100-100001", [A + "Owner_Name"]: "BARBERS HILL EDUCATION FOUNDATION", [A + "Legal1"]: "321 TR 20-1 C C SCHOOL", [A + "Acres"]: 10.69 },
          geometry: { rings: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]], spatialReference: { wkid: 4326 } } }] }) });
    }
    if (/\/export/.test(url)) return route.fulfill({ status: 200, headers: cors, contentType: "image/png", body: PNG });
    return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ id: 0, name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", fields: [{ name: T + "OBJECTID", type: "esriFieldTypeOID" }], extent: { xmin: -95.2, ymin: 29.4, xmax: -94.4, ymax: 30.2, spatialReference: { wkid: 4326 } }, drawingInfo: { renderer: {} }, features: [] }) });
  }
  if (/\.(png|jpg|jpeg)(\?|$)|\/export|tile/i.test(u.href)) return route.fulfill({ status: 200, headers: cors, contentType: "image/png", body: PNG });
  return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ features: [] }) });
});
const page = await ctx.newPage();
await assertMeasurable(page, "verify-click-a-lot-outlines");
await page.addInitScript(() => {
  window.__lt = [];
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push({ s: e.startTime, d: e.duration }))).observe({ entryTypes: ["longtask"] }); } catch (_) {}
});
const cdp = await ctx.newCDPSession(page);
const THROTTLE = Number(process.env.THROTTLE || 1);
if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
await page.goto(BASE + "?planyrDiag=1", { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.getByRole("button", { name: /^Site$/ }).first().click({ timeout: 3000 }); } catch { try { await page.getByText(/^Site$/).first().click({ timeout: 3000 }); } catch {} }
await page.waitForTimeout(2500);
const addBtn = page.locator('button[title^="Add land to this plan"]').first();
if (!(await addBtn.isVisible().catch(() => false))) { try { await page.locator('[data-rail-tab="parcel"]').first().click({ timeout: 5000 }); } catch {} await page.waitForTimeout(500); }
await page.screenshot({ path: "/tmp/s1.png" }); const readView = () => page.evaluate(() => { const c = document.querySelector('svg[aria-label="Site plan canvas"]'); const m = window.__geoMap; return { ppf: c && (c.getAttribute("data-view-ppf") || (c.parentElement && c.parentElement.getAttribute("data-view-ppf"))), z: m ? m.getZoom() : null, c: m ? [m.getCenter().lat.toFixed(5), m.getCenter().lng.toFixed(5)].join() : null }; });
const view0 = await readView();
await addBtn.click({ timeout: 8000 }); await page.waitForTimeout(300);
await page.getByText(/Click a lot on the map/).first().click();
await page.waitForTimeout(3500);

const view1 = await readView();
console.log('VIEW · before', JSON.stringify(view0), 'after', JSON.stringify(view1));
ok(JSON.stringify(view0) === JSON.stringify(view1), 'entering the mode does not move the view');
const imgs = await page.evaluate(() => [...document.querySelectorAll(".leaflet-overlay-pane img")].map((i) => (i.src || "").replace(/\?.*/, "").slice(0, 90)));
const mounted = await page.evaluate(() => (window.__plannerParcelOutlines ? window.__plannerParcelOutlines() : "no-hook"));
console.log("NEW-1 · overlay <img> mounted:", imgs.length, "· hosts asked:", [...hosts.keys()].join(", "));
console.log("       outline set:", JSON.stringify(mounted));
ok(imgs.length <= 3, `at most the in-view sources are mounted as images (saw ${imgs.length}; main = 36+)`);
ok([...hosts.keys()].every((h) => /pandai|geographic\.texas|stratmap|tnris/i.test(h)), `parcel requests go only to Chambers + (at most) the statewide host (saw ${[...hosts.keys()].join(", ")})`);
ok(!imgs.some((s) => /geographic\.texas\.gov/.test(s)), "no statewide image mounted while Chambers is healthy");

const canvas = page.locator('svg[aria-label="Site plan canvas"]').first();
const box = await canvas.boundingBox();
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => { window.__lt.length = 0; window.__rn = []; });
  if (process.env.PROFILE && i === 0) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
  const t0 = await page.evaluate(() => performance.now());
  await page.mouse.click(box.x + box.width * (0.35 + i * 0.25), box.y + box.height * 0.5);
  await page.waitForTimeout(5000);
  if (process.env.PROFILE && i === 0) {
    const { profile } = await cdp.send("Profiler.stop");
    const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, k) => { const n = byId.get(id); const key = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`; self.set(key, (self.get(key) || 0) + (dt[k] || 0)); });
    console.log("  top self-time (ms):"); [...self.entries()].filter(([k]) => !/\(idle\)|\(program\)|\(garbage/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log("   ", Math.round(v / 1000), k));
  }
  if (process.env.RN) console.log('  setEls callers:', JSON.stringify(await page.evaluate(() => window.__elsw || []))); if (process.env.RN) console.log('  roadNet dep changes:', JSON.stringify(await page.evaluate(() => { const r = window.__rn || []; window.__rn = []; return r; })));
  const lts = await page.evaluate(() => window.__lt.slice());
  const total = lts.reduce((s, e) => s + e.d, 0), worst = Math.max(0, ...lts.map((e) => e.d));
  console.log(`NEW-2 · click ${i + 1}: ${lts.length} long tasks, total ${Math.round(total)} ms, worst ${Math.round(worst)} ms`);
  if (process.env.STRICT_LONGTASK) ok(worst <= 100, `click ${i + 1}: no long task over 100 ms (worst ${Math.round(worst)})`);
}
await page.waitForTimeout(500);
const panel = await page.evaluate(() => document.body.innerText);
const named = await page.evaluate(() => /BARBERS HILL EDUCATION FOUNDATION/.test(document.body.innerText));
ok(named, "NEW-3 · the added lot shows the Chambers owner (BARBERS HILL EDUCATION FOUNDATION)");
ok(!/\b2933785\b/.test(panel), "NEW-3 · the Accounts.OBJECTID (2933785) is not shown as the account");
await page.screenshot({ path: new URL("./screens/click-a-lot-outlines.png", import.meta.url).pathname });
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
