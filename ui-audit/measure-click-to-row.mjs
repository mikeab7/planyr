/* NEW-1 — click-to-feedback timing for the planner's "Click a lot on the map" tool.
 *
 * Drives the real built app (vite preview) with the county point query MOCKED and delayed by a fixed
 * amount (sandbox egress blocks the real hosts), and reports, from pointerdown:
 *   ack   — first frame in which a cursor-anchored acknowledgement is visible   (null = never shown)
 *   req   — when the county request leaves the browser
 *   row   — when the "Added" lot card mounts
 * Run it against a build BEFORE the change and one AFTER (the before/after in the PR). The mocked delay
 * stands in for the real Chambers server's ~1.2 s; the numbers that matter are ack and req, which do
 * not depend on it. Usage: BASE_URL=http://localhost:4173 node ui-audit/measure-click-to-row.mjs */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const DELAY = Number(process.env.COUNTY_DELAY_MS || 1200);
const site = {
  id: "measure-click", groupId: "measure-click", site: "Katy Tract Demo", name: "Plan 1",
  origin: { lat: 29.76, lon: -95.37 }, county: "harris", parcels: [], els: [], measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
};
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await assertMeasurable(page, "measure-click-to-row");
let reqAt = null, pq = 0;
await ctx.route(/gis\.hctx\.net/, async (route) => {
  const url = route.request().url();
  const cors = { "access-control-allow-origin": "*" };
  const json = (b) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(b) });
  if (/\/MapServer\/0\/query/.test(url)) {
    if (!/esriGeometryPoint/.test(url)) return json({ features: [] });
    if (reqAt == null) reqAt = Date.now();
    pq += 1;
    await new Promise((r) => setTimeout(r, DELAY));
    let x = -95.37, y = 29.76;
    try { const g = JSON.parse(new URL(url).searchParams.get("geometry")); x = g.x; y = g.y; } catch {}
    const oid = Math.abs(Math.round(x * 1e5)) * 1e5 + Math.abs(Math.round(y * 1e5));
    const d = 0.0008;
    setTimeout(() => page.evaluate((o) => { window.__oid = String(o); window.__seen && window.__seen(); }, oid).catch(() => {}), 0); // AFTER fulfil: an evaluate queues behind the page's main thread
    return json({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, features: [{ attributes: { OBJECTID: oid, SITUS_ADDR: `Lot ${oid}` }, geometry: { rings: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]], spatialReference: { wkid: 4326 } } }] });
  }
  return json({ id: 0, name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }], extent: { xmin: -96, ymin: 29, xmax: -95, ymax: 30, spatialReference: { wkid: 4326 } }, drawingInfo: { renderer: {} } });
});
await ctx.route("**/*.jpg", (r) => r.abort());
await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s })); } catch (e) {} }, site);
await page.goto(BASE + "#/site-planner", { waitUntil: "load" });
await page.getByText("Katy Tract Demo").first().click();
await page.getByTestId("planner-canvas").waitFor({ timeout: 20000 });
await page.waitForTimeout(900);
await page.getByTestId("rail-parcel-tools").click();
await page.locator('[data-parcel-action="identify"]').click();
await page.waitForTimeout(500);
const box = await page.getByTestId("planner-canvas").boundingBox();
// Page-side probe: first rAF at which the ack / the row is visible, on the page's own performance clock.
await page.evaluate(() => {
  window.__t = { down: null, ack: null, row: null };
  addEventListener("pointerdown", () => {
    window.__t.down = performance.now();
    // Cheap probes only: an innerText read per frame forces layout and slows the very app being timed.
    const seen = () => {
      const t = window.__t, n = performance.now();
      if (t.ack == null && document.querySelector('[data-testid="click-ack"]')) t.ack = n;
      if (t.row == null && window.__oid && document.body.textContent.includes("Lot " + window.__oid)) t.row = n;
    };
    window.__seen = seen;
    const mo = new MutationObserver(() => { seen(); if (window.__t.row != null) mo.disconnect(); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    const tick = () => { seen(); if (window.__t.ack == null && performance.now() - window.__t.down < 2000) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }, true);
});
const rows = [];
for (const [dx, dy] of [[-180, -60], [200, 80], [-40, 150]]) {
  reqAt = null;
  await page.evaluate(() => { window.__t.down = window.__t.ack = window.__t.row = null; window.__oid = null; });
  const t0 = Date.now();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => window.__t.row != null, null, { timeout: 15000 });
  const t = await page.evaluate(() => window.__t);
  const r = (v) => (v == null ? null : Math.round(v - t.down));
  rows.push({ ack: r(t.ack), req: reqAt == null ? null : reqAt - t0, row: r(t.row), countyQueries: pq }); pq = 0;
  await page.waitForTimeout(400);
}
console.log(`county delay ${DELAY} ms (mocked). ms from pointerdown:`);
console.table(rows);
await browser.close();
