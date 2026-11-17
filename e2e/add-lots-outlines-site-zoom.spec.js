/* NEW-1 (2026-11-16) — Add parcels › click lots draws the county's lot lines at a normal SITE-SCALE zoom, and a click shows its lot's outline
 * the same frame.
 *
 * Owner, Goose Creek / Concept B, Harris County (~29.8172, -95.0174): "I tried to click lots on the map … it would click them, but none showed
 * up as a default, or no outline showed up." Four lots of 10–68 ac filled about a third of the map width; the panel said "Zoom in to see the
 * county lot lines" and nothing was drawn.
 *
 * ⛔ WRONG-CASE. The fixture is the owner's: a Harris plan (HCAD is a queryable MapServer, vector lines from zoom 16) viewed BETWEEN zoom 15
 * and 16 with lots of ~25 ac. The first test REFUSES TO SCORE unless it has proved both halves of that situation — the view really is under 16,
 * and the mocked county saw only larger-lots-band requests (a size-filtered `where`), never the full-detail query the close stage sends. A
 * plan opened at street level (where lines always drew) would pass on a build that does nothing.
 *
 * Logged out; the county service is mocked at the network boundary (the sandbox egress blocks the agency hosts). The relay (/api/gis-cache) is
 * answered 404 so the larger-lots band falls back to the county directly, exactly as on a dev server.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const ORIGIN = { lat: 29.8172, lon: -95.0174 };
const SITE = {
  schemaVersion: 12, id: "e2e-addlots-zoom", groupId: "e2e-addlots-zoom", site: "Add Lots Zoom Guard", name: "Concept B",
  origin: ORIGIN, county: "harris", updatedAt: 1783000000000, status: "active", teamId: null, ownerId: null,
  // the plan's own lot sits WEST of the county lots, so a click on a county lot is on open ground (a click inside a lot the plan has is a toggle)
  parcels: [{ id: "p1", points: [{ x: -900, y: -300 }, { x: -300, y: -300 }, { x: -300, y: 300 }, { x: -900, y: 300 }], active: true, z: 0 }],
  els: [], markups: [], measures: [], callouts: [], sheetOverlays: [], underlay: null, parcelDrawings: [], settings: {},
};

// 2×2 lots of ~0.0035° (≈ 1,270 × 1,100 ft, ~32 ac) east of the origin; they never touch.
const D = 0.0035, GAP = 0.0012;
const LOTS = [0, 1].flatMap((r) => [0, 1].map((c) => {
  const w = ORIGIN.lon + 0.004 + c * (D + GAP), s = ORIGIN.lat - 0.004 + r * (D + GAP);
  return { oid: 1000 + r * 2 + c, ring: [[w, s], [w + D, s], [w + D, s + D], [w, s + D], [w, s]], w, s, e: w + D, n: s + D };
}));
const esriLot = (l) => ({ attributes: { OBJECTID: l.oid, HCAD_NUM: `0591470${l.oid}`, site_str_name: `BATTLEBELL RD ${l.oid}`, "Shape.STArea()": 1_300_000 }, geometry: { rings: [l.ring], spatialReference: { wkid: 4326 } } });

const FIELDS = [
  { name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "HCAD_NUM", type: "esriFieldTypeString" },
  { name: "site_str_name", type: "esriFieldTypeString" }, { name: "Shape.STArea()", type: "esriFieldTypeDouble" },
];

/** Mock Harris' parcel service; records what the page asked of it. The larger-lots band goes through Planyr's own relay (/api/gis-cache/svc/<base64 of the layer URL>) where one exists — a deployment has it, a local preview does not and falls back to the county — so BOTH doors are answered by the same handler and the spec reads the same on either. */
const HCAD_RELAY_B64 = Buffer.from("https://www.gis.hctx.net/arcgis/rest/services/HCAD/Parcels/MapServer/0").toString("base64url");
async function mockCounty(page, log, { pointDelayMs = 1500 } = {}) {
  await page.route("**/*.jpg", (route) => route.abort());
  const handle = (viaRelay) => async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const params = new URLSearchParams(u.search);
    const post = req.postData();
    if (post) new URLSearchParams(post).forEach((v, k) => params.set(k, v));
    const cors = { "access-control-allow-origin": "*" };
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" } });
    // only the HCAD parcel layer is the subject; the jurisdiction lookups ride the same host and are answered empty
    if (!viaRelay && !/HCAD\/Parcels\/MapServer\/0\/?/.test(u.pathname)) return json({ features: [] });
    if (!/\/query$/.test(u.pathname)) {
      return json({ id: 0, name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", objectIdField: "OBJECTID", maxRecordCount: 1000, fields: FIELDS, extent: { xmin: -96, ymin: 29, xmax: -94.5, ymax: 30.5, spatialReference: { wkid: 4326 } } });
    }
    const gt = params.get("geometryType") || "";
    const where = params.get("where") || "";
    if (/Point/.test(gt)) {
      let g = {}; try { g = JSON.parse(params.get("geometry")); } catch { const [x, y] = String(params.get("geometry")).split(",").map(Number); g = { x, y }; }
      log.points.push({ x: g.x, y: g.y, t: Date.now() });
      await new Promise((r) => setTimeout(r, pointDelayMs)); // the county is not instant — the click's own feedback must not wait for it
      const hit = LOTS.find((l) => g.x >= l.w && g.x <= l.e && g.y >= l.s && g.y <= l.n);
      log.pointAnswered += 1;
      return json({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, features: hit ? [esriLot(hit)] : [] });
    }
    // an envelope query: the larger-lots band's tile (size-filtered `where`) or the close stage's cell (no size filter)
    const sized = /Shape\.STArea\(\)\s*>=\s*[\d.]+/.test(where);
    (sized ? log.band : log.close).push(where);
    let env = null; const gm = params.get("geometry") || "";
    try { env = gm.trim().startsWith("{") ? (({ xmin, ymin, xmax, ymax }) => [xmin, ymin, xmax, ymax])(JSON.parse(gm)) : gm.split(",").map(Number); } catch { /* whole county */ }
    const inEnv = (l) => !env || env.length < 4 || !(l.e < env[0] || l.w > env[2] || l.n < env[1] || l.s > env[3]);
    if (/returnCountOnly/.test(u.search + (post || ""))) return json({ count: LOTS.filter(inEnv).length });
    if (/returnIdsOnly/.test(u.search + (post || ""))) return json({ objectIdFieldName: "OBJECTID", objectIds: LOTS.filter(inEnv).map((l) => l.oid) });
    return json({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, objectIdFieldName: "OBJECTID", fields: FIELDS, features: LOTS.filter(inEnv).map(esriLot) });
  };
  await page.context().route(/gis\.hctx\.net/, handle(false));
  await page.context().route((url) => url.pathname.startsWith(`/api/gis-cache/svc/${HCAD_RELAY_B64}`), handle(true));
}

async function load(page, log) {
  await armPlannerHooks(page);
  await mockCounty(page, log);
  await page.addInitScript((s) => {
    if (localStorage.getItem("planarfit:currentSite:v1") === s.id) return;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s }));
    localStorage.setItem("planarfit:currentSite:v1", s.id);
  }, SITE);
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Add Lots Zoom Guard", { exact: false }).first().click().catch(() => {});
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => !!window.__geoMap), { timeout: 20000 }).toBe(true);
  await page.waitForTimeout(1200);
}

const mapZoom = (page) => page.evaluate(() => (window.__geoMap ? window.__geoMap.getZoom() : null));
/** Wheel the plan until the backdrop map reads a zoom in [lo, hi] — the planner's own view drives the map. */
async function zoomInto(page, lo, hi) {
  const box = await page.getByTestId("planner-canvas").boundingBox();
  const cx = box.x + box.width * 0.6, cy = box.y + box.height * 0.5;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 80; i++) {
    const z = await mapZoom(page);
    if (z != null && z >= lo && z <= hi) { await page.waitForTimeout(400); const z2 = await mapZoom(page); if (z2 >= lo && z2 <= hi) return z2; }
    await page.mouse.wheel(0, z != null && z > hi ? 100 : -100);
    await page.waitForTimeout(60);
  }
  return mapZoom(page);
}
const outlines = (page) => page.evaluate(() => (window.__plannerParcelOutlines ? window.__plannerParcelOutlines() : null));
const statusEl = (page) => page.getByTestId("parcel-outline-status");

async function armAddLots(page) {
  await page.getByTestId("rail-parcel-tools").click();
  await page.locator('[data-parcel-action="identify"]').click();
}
/** Painted pixels in the parcels-in-front pane's tile canvases — the lines themselves, not a node count (NO-ONE-OWNS-A-COMPOSITE: ink, never registrations). */
const paintedInk = (page) => page.evaluate(() => {
  let n = 0;
  for (const c of document.querySelectorAll('[class*="parcelPick"] canvas')) {
    if (!c.width || !c.height) continue;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  }
  return n;
});
const lotCentre = (page, lot) => page.evaluate(({ la, lo }) => {
  const m = window.__geoMap; const p = m.latLngToContainerPoint([la, lo]); const r = m.getContainer().getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
}, { la: (lot.s + lot.n) / 2, lo: (lot.w + lot.e) / 2 });

test("at a site-scale zoom under 16 the county's lot lines draw by default, no 'Zoom in' hint, and a click shows its outline the same frame", async ({ page }) => {
  const log = { points: [], band: [], close: [], pointAnswered: 0 };
  await load(page, log);
  const z = await zoomInto(page, 15.1, 15.9);
  // ── PRECONDITION (refuses to score otherwise): the owner's situation — under HCAD's own floor of 16, over open county ground ──
  expect(z, "VOID: the view is not between zoom 15 and 16, so this does not test the reported case").toBeGreaterThanOrEqual(15);
  expect(z, "VOID: the view is at/over the county's own close-in zoom, where lines always drew").toBeLessThan(16);

  await armAddLots(page);
  // the lines are on the map: the set says so, and the pane actually holds ink
  await expect.poll(async () => (await outlines(page))?.phase, { message: "the larger lots draw by default at this zoom", timeout: 15000 }).toBe("drawn");
  await expect.poll(() => paintedInk(page), { message: "lot lines are painted in the Parcels-in-front pane", timeout: 15000 }).toBeGreaterThan(200);
  await expect(statusEl(page), "no 'Zoom in' hint where lines draw").toHaveCount(0);
  // …and it was the larger-lots band that drew them (a size-filtered request), never the close-stage query the county's cap forbids this far out
  expect(log.band.length, "the county saw larger-lots-band requests").toBeGreaterThan(0);
  expect(log.close, "…and no full-detail close-stage query at this zoom").toHaveLength(0);
  expect((await outlines(page)).lots).toBeGreaterThanOrEqual(LOTS.length);

  // ── a click: the clicked lot's outline is on screen THIS frame, before the county answers ──
  // (let the lot set settle first: a click that lands in the instant a tile is being re-laid has nothing drawn under it to outline — the ring is its feedback then, not this)
  await expect.poll(async () => { const a = (await outlines(page)).lots; await page.waitForTimeout(700); return a === (await outlines(page)).lots; }, { timeout: 15000 }).toBe(true);
  const target = LOTS[1];
  const pt = await lotCentre(page, target);
  await page.evaluate(() => {
    window.__flash = { sawAtFrame: null, atPointer: null };
    window.addEventListener("pointerup", () => {
      window.__flash.atPointer = !!document.querySelector(".lot-click-flash");
      requestAnimationFrame(() => { window.__flash.sawAtFrame = !!document.querySelector(".lot-click-flash"); });
    }, { once: true });
  });
  const before = log.pointAnswered;
  await page.mouse.click(pt.x, pt.y);
  await expect.poll(() => page.evaluate(() => window.__flash.sawAtFrame), { timeout: 3000 }).not.toBeNull();
  expect(await page.evaluate(() => window.__flash.sawAtFrame), "the clicked lot is outlined the very next frame").toBe(true);
  expect(log.pointAnswered, "…while the county has NOT answered yet").toBe(before);
  const ink = await page.evaluate(() => { const p = document.querySelector(".lot-click-flash"); const b = p && p.getBoundingClientRect(); return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null; });
  expect(ink && ink.w > 40 && ink.h > 40, "the flash is the lot's whole outline, not a dot").toBe(true);

  // the county answers → the plan's own parcel takes over, the flash goes, and the lot is counted
  await expect.poll(() => log.pointAnswered, { timeout: 8000 }).toBeGreaterThan(before);
  await expect(page.locator(".lot-click-flash")).toHaveCount(0, { timeout: 8000 });
  await expect.poll(() => page.evaluate(() => new Set([...document.querySelectorAll('[data-feature^="parcel:"]')].map((n) => n.getAttribute("data-feature"))).size), { timeout: 8000 }).toBe(2);
  await expect(page.getByText(/Adding lots — 1 added/)).toBeVisible();

  // a click on ground with no lot: no outline is invented, and the honest answer comes back
  await page.mouse.click(pt.x - 1500, pt.y + 5);
  expect(await page.locator(".lot-click-flash").count(), "no lot drawn there → no flash").toBe(0);
});

test("a view that is genuinely too far out keeps the short 'Zoom in' hint, and the tool never moves the view by itself", async ({ page }) => {
  const log = { points: [], band: [], close: [], pointAnswered: 0 };
  await load(page, log);
  const z0 = await zoomInto(page, 15.1, 15.9);
  expect(z0).toBeGreaterThanOrEqual(15);
  await armAddLots(page);
  await expect.poll(async () => (await outlines(page))?.phase, { timeout: 15000 }).toBe("drawn");
  const zArmed = await mapZoom(page);
  expect(Math.abs(zArmed - z0), "arming the tool does not auto-zoom (owner direction 2026-10-19)").toBeLessThan(0.05);

  const z1 = await zoomInto(page, 11, 13.8); // under the larger-lots band's own floor (HCAD: 14) — the planner will not wheel out much further than this
  expect(z1, "VOID: could not reach a view under the band's floor").toBeLessThan(14);
  await expect.poll(async () => (await outlines(page))?.phase, { timeout: 15000 }).toBe("zoom");
  await expect(statusEl(page)).toHaveAttribute("data-phase", "zoom");
  await expect(statusEl(page)).toContainText("Zoom in to see the county lot lines");
});
