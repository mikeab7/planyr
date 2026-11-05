/* NEW-1 (select-parcel first paint) — activating "Pick lots on the map" must itself light the county lot outlines, with NO tap /
 * drag / zoom, and the Parcels panel must always say what the outlines are doing ("Loading parcels…" / "No parcels here" / the
 * zoom hint when the view is below the layers' draw floor — which is what a PHONE shows for a big site).
 * Cases: desktop + iPhone-class touch · cold + warm (Done, then re-arm) · slow server · pan with the tool on, no tap · empty county
 * answer · far-out view · and tap-to-select still adds a lot. Hosts are MOCKED (sandbox egress). Logged-out against `vite preview` :4173.
 * Reads the outline set's own status through the E2E-armed diag hook (window.__plannerParcelOutlines, ?planyrDiag=1) and the panel DOM —
 * never pixels. Known-good arm: the small-site cold case must reach "drawn" (a run where it does not is VOID, not scored). */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const T = "ChambersCADWeb.DBO.TaxParcels.";
const cors = { "access-control-allow-origin": "*" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(c ? "  ✅" : "  ❌", l); };

async function run({ label, mobile, size = 300, delay = 0, empty = false, far = false }) {
  console.log(`\n— ${label}`);
  const site = {
    id: "fp", groupId: "fp", site: "Grand Port Demo", name: "Concept A", origin: { lat: 29.84, lon: -94.88 }, county: "chambers",
    parcels: [{ id: "pc1", locked: true, points: [{ x: -size, y: -size * 0.66 }, { x: size, y: -size * 0.66 }, { x: size, y: size * 0.66 }, { x: -size, y: size * 0.66 }] }],
    els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
  };
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true }
    : { viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(`(() => { try { localStorage.setItem('planarfit:sites:v1', JSON.stringify({ fp: ${JSON.stringify(site)} })); localStorage.setItem('planarfit:currentSite:v1', 'fp'); } catch (_) {} })();`);
  const lotQueries = [];
  await ctx.route(/./, async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost") return route.continue();
    if (/gisdata\.pandai\.com/.test(u.href)) {
      const j = (o) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(o) });
      if (/\/query/.test(u.pathname)) {
        let g = {}; try { g = JSON.parse(u.searchParams.get("geometry")); } catch {}
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (g.x != null) { // the click's point query — a lot around the point
          const d = 0.0006;
          return j({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, features: [{ attributes: { [T + "OBJECTID"]: 777, [T + "Name"]: "777" }, geometry: { rings: [[[g.x - d, g.y - d], [g.x + d, g.y - d], [g.x + d, g.y + d], [g.x - d, g.y + d], [g.x - d, g.y - d]]], spatialReference: { wkid: 4326 } } }] });
        }
        if (g.xmin == null || empty) return j({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, features: [] });
        lotQueries.push(`${g.xmin.toFixed(4)},${g.ymin.toFixed(4)}`);
        const n = 3, dx = (g.xmax - g.xmin) / n, dy = (g.ymax - g.ymin) / n, feats = [];
        for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) { const x0 = g.xmin + i * dx + dx * 0.05, y0 = g.ymin + k * dy + dy * 0.05, x1 = x0 + dx * 0.9, y1 = y0 + dy * 0.9; const id = Math.round(Math.abs(x0 * 1e5) % 1e5) * 10 + i * 3 + k; feats.push({ attributes: { [T + "OBJECTID"]: id, [T + "Name"]: String(id) }, geometry: { rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]], spatialReference: { wkid: 4326 } } }); }
        return j({ objectIdFieldName: T + "OBJECTID", geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, fields: [{ name: T + "OBJECTID", type: "esriFieldTypeOID" }], features: feats });
      }
      if (/\/export/.test(u.pathname)) return route.fulfill({ status: 200, headers: cors, contentType: "image/png", body: PNG });
      return j({ id: 0, name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", currentVersion: 10.8, maxRecordCount: 1000, fields: [{ name: T + "OBJECTID", type: "esriFieldTypeOID" }], objectIdField: T + "OBJECTID", extent: { xmin: -95.2, ymin: 29.4, xmax: -94.4, ymax: 30.2, spatialReference: { wkid: 4326 } }, drawingInfo: { renderer: {} } });
    }
    if (/geographic\.texas|arcgis|gis/i.test(u.hostname)) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ features: [] }) });
    return route.fulfill({ status: 200, headers: cors, contentType: "image/png", body: PNG });
  });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-select-parcel-first-paint");
  const TAP = mobile ? "tap" : "click";
  await page.goto(BASE + "?planyrDiag=1", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  try { await page.getByRole("button", { name: /^Site$/ }).first()[TAP]({ timeout: 3000 }); } catch {}
  await page.waitForTimeout(2500);
  if (mobile) { await page.getByText(/^Panels$/).first().tap(); await page.waitForTimeout(500); }
  try { await page.locator('[data-rail-tab="parcel"], [data-rail-tab="land"]').first()[TAP]({ timeout: 3000 }); } catch { await page.getByText(/^Land$/).first()[TAP](); }
  await page.waitForTimeout(500);
  const state = () => page.evaluate(() => (window.__plannerParcelOutlines && window.__plannerParcelOutlines()) || null);
  const statusText = async () => { for (let i = 0; i < 8; i++) { const t = await page.locator('[data-testid="parcel-outline-status"]').first().textContent({ timeout: 200 }).catch(() => null); if (t) return t; await page.waitForTimeout(150); } return null; };
  const settle = async (want, ms = 12000) => { const t0 = Date.now(); let st = null; while (Date.now() - t0 < ms) { st = await state(); if (st && want.includes(st.phase)) return st; await page.waitForTimeout(150); } return st; };
  const arm = async () => {
    await page.locator('[data-testid="land-add-btn"]').first()[TAP]({ timeout: 8000 }); await page.waitForTimeout(250);
    await page.getByText(/Pick lots on the map|Click a lot on the map/).first()[TAP]();
  };

  await arm(); // ← the ONLY action: no click / tap / drag / zoom on the map after this
  const first = await state();
  ok(first && typeof first.phase === "string", "the tool reports its outline phase from the first moment (status hook present)");
  if (delay) ok(first && first.phase === "loading" && /Loading parcels/.test((await statusText()) || ""), `while the server is slow the panel says "Loading parcels…" (phase ${first && first.phase})`);
  if (far) {
    const st = await settle(["zoom"]);
    ok(st && st.phase === "zoom" && st.lots === 0, `far-out view: the layers are below their draw floor and the state says so (phase ${st && st.phase})`);
    ok(/Zoom in/.test((await statusText()) || ""), "far-out view: the panel names the reason instead of staying silent");
  } else if (empty) {
    const st = await settle(["empty"]);
    ok(st && st.phase === "empty", `an empty county answer settles to "empty" (phase ${st && st.phase})`);
    ok(/No parcels here/.test((await statusText()) || ""), 'the panel says "No parcels here"');
  } else {
    const st = await settle(["drawn"]);
    ok(st && st.phase === "drawn" && st.lots > 0, `cold: outlines drawn with no tap — ${st && st.lots} lots (phase ${st && st.phase})`);
    if (!st || st.phase !== "drawn") { console.log("   VOID — the known-good arm did not reach 'drawn'; later checks not scored"); await browser.close(); return; }
    await page.waitForTimeout(400);
    ok(!(await page.locator('[data-testid="parcel-outline-status"]').count()), "once drawn, the status line is gone (nothing to say)");
    if (!mobile) {
      // pan with the tool on, no tap: drag the canvas, outlines for the new view arrive
      const before = lotQueries.length;
      const box = await page.locator('svg[aria-label="Site plan canvas"]').first().boundingBox();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5); await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5, { steps: 12 }); await page.mouse.up();
      await page.waitForTimeout(2500 + delay);
      const st2 = await settle(["drawn"]);
      ok(lotQueries.length > before, `pan refreshes outlines for the new view without a tap (${lotQueries.length - before} new lot queries)`);
      ok(st2 && st2.phase === "drawn" && st2.lots > 0, `after the pan the new view still shows lots (${st2 && st2.lots})`);
    }
    // warm: Done, then re-arm — cached metadata, still no tap
    await page.getByText(/Click lit-up lots to add/).first()[TAP](); await page.waitForTimeout(500);
    ok((await state()) === null, "Done tears the outline set down");
    await arm();
    const st3 = await settle(["drawn"]);
    ok(st3 && st3.phase === "drawn" && st3.lots > 0, `warm re-arm: drawn again with no tap (${st3 && st3.lots} lots)`);
    // tap-to-select still works
    if (mobile) { await page.locator('button[aria-label="Close"], [aria-label="Close panel"]').first().tap({ timeout: 1500 }).catch(() => {}); await page.getByText(/^Panels$/).first().isVisible().catch(() => false); await page.waitForTimeout(500); }
    const box2 = await page.locator('svg[aria-label="Site plan canvas"]').first().boundingBox();
    if (mobile) await page.touchscreen.tap(box2.x + box2.width * 0.5, box2.y + box2.height * 0.6);
    else await page.mouse.click(box2.x + box2.width * 0.35, box2.y + box2.height * 0.5);
    await page.waitForTimeout(2500);
    ok(await page.getByText(/Parcel 2\b/).first().waitFor({ state: "visible", timeout: 8000 + delay }).then(() => true, () => false), "a tap on the map still selects/adds a lot (Parcel 2 joins the plan)");
  }
  await browser.close();
}

await run({ label: "desktop · cold · warm · pan · tap", mobile: false });
await run({ label: "phone (touch) · cold", mobile: true });
await run({ label: "desktop · slow server (2.5 s)", mobile: false, delay: 2500 });
await run({ label: "phone · slow server (1.5 s)", mobile: true, delay: 1500 });
await run({ label: "desktop · county returns no lots", mobile: false, empty: true });
await run({ label: "phone · large site, far-out view", mobile: true, size: 3000, far: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
