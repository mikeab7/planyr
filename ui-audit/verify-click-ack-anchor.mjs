/* B2335056 — the pulsing tap ring in the select-parcel tool must ride the GROUND, not the glass.
 * Slow mocked county server keeps the ring alive; then pan (mouse drag on desktop, CDP one-finger touch drag on a phone) and wheel-zoom.
 * INDEPENDENT reference (clause 6 of DRIVER-SCROLL-IS-NOT-APP-SCROLL): the plan's own parcel polygon is drawn by the canvas transform,
 * so the tapped point's offset inside that polygon's box, scaled by the box's own size ratio, is the ring's expected position —
 * never the code under test. Known-good arm: the ring is present and the polygon box moved/scaled (a run where neither
 * is true is VOID). Reads DOM geometry only. Logged-out against `vite preview` :4173, hosts MOCKED. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const T = "ChambersCADWeb.DBO.TaxParcels.";
const cors = { "access-control-allow-origin": "*" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(c ? "  ✅" : "  ❌", l); };
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

async function run({ label, mobile }) {
  console.log(`\n— ${label}`);
  const size = 300;
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
  await ctx.route(/./, async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost") return route.continue();
    if (/gisdata\.pandai\.com/.test(u.href)) {
      const j = (o) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(o) });
      if (/\/query/.test(u.pathname)) {
        let g = {}; try { g = JSON.parse(u.searchParams.get("geometry")); } catch {}
        if (g.x != null) await new Promise((r) => setTimeout(r, 9000)); // the CLICK's lot query stays pending → the ring stays up
        return j({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, features: [] });
      }
      if (/\/export/.test(u.pathname)) return route.fulfill({ status: 200, headers: cors, contentType: "image/png", body: PNG });
      return j({ id: 0, name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", currentVersion: 10.8, maxRecordCount: 1000, fields: [{ name: T + "OBJECTID", type: "esriFieldTypeOID" }], objectIdField: T + "OBJECTID", extent: { xmin: -95.2, ymin: 29.4, xmax: -94.4, ymax: 30.2, spatialReference: { wkid: 4326 } }, drawingInfo: { renderer: {} } });
    }
    if (/geographic\.texas|arcgis|gis/i.test(u.hostname)) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ features: [] }) });
    return route.fulfill({ status: 200, headers: cors, contentType: "image/png", body: PNG });
  });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-click-ack-anchor");
  const TAP = mobile ? "tap" : "click";
  await page.goto(BASE + "?planyrDiag=1", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  try { await page.getByRole("button", { name: /^Site$/ }).first()[TAP]({ timeout: 3000 }); } catch {}
  await page.waitForTimeout(2500);
  if (mobile) { await page.getByText(/^Panels$/).first().tap(); await page.waitForTimeout(500); }
  try { await page.locator('[data-rail-tab="parcel"], [data-rail-tab="land"]').first()[TAP]({ timeout: 3000 }); } catch { await page.getByText(/^Land$/).first()[TAP](); }
  await page.waitForTimeout(500);
  await page.locator('[data-testid="land-add-btn"]').first()[TAP]({ timeout: 8000 }); await page.waitForTimeout(250);
  await page.getByText(/Pick lots on the map|Click a lot on the map/).first()[TAP]();
  await page.waitForTimeout(1500);
  if (mobile) { await page.locator('button[aria-label="Close"], [aria-label="Close panel"]').first().tap({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(500); }

  const canvas = page.locator('svg[aria-label="Site plan canvas"]').first();
  const box = await canvas.boundingBox();
  const polyBox = () => page.evaluate(() => { const n = document.querySelector('[data-feature="parcel:pc1"]'); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const ringPos = () => page.evaluate(() => { const els = [...document.querySelectorAll('[data-testid="click-ack"][data-state="pending"]')]; const e = els[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, n: els.length }; });

  // one-finger drag for touch (Playwright has no touch-drag primitive); mouse drag for desktop
  const drag = async (x0, y0, x1, y1) => {
    if (!mobile) { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 14 }); await page.mouse.up(); return; }
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 14; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 14, y: y0 + ((y1 - y0) * i) / 14 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };

  const tx = box.x + box.width * 0.5, ty = box.y + box.height * 0.5;
  const b0 = await polyBox();
  if (mobile) await page.touchscreen.tap(tx, ty); else await page.mouse.click(tx, ty);
  await page.waitForTimeout(600);
  const r0 = await ringPos();
  ok(!!b0 && !!r0 && r0.n === 1, `known-good: the plan's parcel is on screen and exactly one pending ring is up after the tap (rings ${r0 && r0.n})`);
  if (!b0 || !r0) { console.log("   VOID — precondition missing; later checks not scored"); await browser.close(); return; }
  ok(near(r0.x, tx, 3) && near(r0.y, ty, 3), `the ring starts at the tapped point (${r0.x.toFixed(1)},${r0.y.toFixed(1)} vs ${tx.toFixed(1)},${ty.toFixed(1)})`);
  const ox = tx - b0.x, oy = ty - b0.y; // the tap's offset inside the parcel polygon's own box

  // ---- PAN ----
  await drag(box.x + box.width * 0.75, box.y + box.height * 0.2, box.x + box.width * 0.35, box.y + box.height * 0.3);
  await page.waitForTimeout(700);
  const b1 = await polyBox(), r1 = await ringPos();
  ok(b1 && Math.abs(b1.x - b0.x) > 60, `known-good: the pan really moved the land (${(b1.x - b0.x).toFixed(0)} px across)`);
  ok(!!r1, "the ring is still up after the pan (answer still pending)");
  if (r1) ok(near(r1.x, b1.x + ox, 3) && near(r1.y, b1.y + oy, 3), `PAN: the ring travelled with the land (${r1.x.toFixed(1)},${r1.y.toFixed(1)} expected ${(b1.x + ox).toFixed(1)},${(b1.y + oy).toFixed(1)})`);

  // ---- ZOOM (wheel; desktop + touch both reach the same wheel handler) ----
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(120); }
  await page.waitForTimeout(900);
  const b2 = await polyBox(), r2 = await ringPos();
  const k = b2 && b1 ? b2.w / b1.w : 1;
  ok(k > 1.2, `known-good: the zoom really scaled the land (×${k.toFixed(2)})`);
  if (r2) ok(near(r2.x, b2.x + ox * k, 4) && near(r2.y, b2.y + oy * k, 4), `ZOOM: the ring stayed on the same ground (${r2.x.toFixed(1)},${r2.y.toFixed(1)} expected ${(b2.x + ox * k).toFixed(1)},${(b2.y + oy * k).toFixed(1)})`);
  else ok(false, "the ring is still up after the zoom");
  await browser.close();
}

await run({ label: "desktop · mouse pan + wheel zoom", mobile: false });
await run({ label: "phone (touch) · one-finger pan + zoom", mobile: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
