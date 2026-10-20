/* NEW-1 — PARCELS IN FRONT while the Parcels tool is up (lib/mapStack.js `parcelsOnTop`).
 *
 * Owner, 2026-10-20: "When I click the parcels tool, the parcels should show above anything that I've got on the
 * screen. Like if I click add county lots, that should show above anything else."
 *
 * ⛔ THE FIXTURE IS THE WHOLE LESSON (WRONG-CASE). A plan with nothing drawn over a lot reports PASS on a build that
 * does nothing, so this one is hostile on purpose: a promoted (draw-above-the-plan) reference, a building and a filled
 * markup are each seeded so their CENTRE sits exactly ON the parcel's line. The first test refuses to score unless it
 * has PROVED, with the Land panel closed, that each of those three really is what the browser answers with at that
 * point — i.e. that the parcel really is buried. Only then does it open the tool and ask again.
 *
 * Red on the pre-change build: nothing re-orders, so the same three points keep answering with the building / markup /
 * reference, and (second test) a press on the building selects the building instead of picking the lot under it.
 *
 * Logged out; the county service is mocked at the network boundary (the sandbox's egress blocks the agency hosts).
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

// 1×1 PNG: an OPAQUE-enough reference whose size comes from imgW/imgH/ftPerPx.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const SITE = {
  schemaVersion: 12, id: "e2e-parcels-front", groupId: "e2e-parcels-front", site: "Parcels Front Guard", name: "Plan 1",
  origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  updatedAt: 1783000000000, status: "active", teamId: null, ownerId: null,
  // The lot: 1000 × 800 ft. Its east edge is x = 1000, its south edge y = 800, its north edge y = 0.
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }], active: true, z: 0 }],
  // centred ON the east edge
  els: [{ id: "b1", type: "building", cx: 1000, cy: 300, w: 300, h: 200, rot: 0, z: 1 }],
  // centred ON the south edge, filled so it takes the press (an unfilled markup grabs by its stroke only)
  markups: [{ id: "mk1", kind: "rect", cx: 400, cy: 800, w: 300, h: 140, rot: 0, stroke: "#e11d48", weight: 2, fill: "#e11d48", fillOpacity: 0.4, z: 2 }],
  // centred ON the north edge (the west edge hides under the docked Land column), in the "draw above the plan" band — over the parcel, the elements and the markups
  sheetOverlays: [{ id: "ov1", name: "Exhibit.png", src: PNG, x: 400, y: -100, imgW: 200, imgH: 200, ftPerPx: 1, rotation: 0, opacity: 0.9, locked: false, visible: true, aboveParcel: true }],
  measures: [], callouts: [], underlay: null, parcelDrawings: [], settings: {},
};

const EDGES = {
  east: { label: "building", sel: '[data-el-id="b1"]', expect: "el:b1" },
  south: { label: "markup", sel: '[data-feature="markup:mk1"]', expect: "markup:mk1" },
  north: { label: "promoted reference", sel: '[data-overlay-id="ov1"]', expect: null },
};

/* The PICK fixture: the same three kinds of cover, but over OPEN GROUND well east of the plan's own lot and ≥ 500 ft apart —
 * a press inside a lot already on the plan is a different path (it toggles that lot), and two mock county lots (±145 ft)
 * must not overlap each other. Every press here has to be answered by the county lookup, so it has to start on ground the
 * plan has not claimed. */
const PICK_SITE = {
  ...SITE,
  els: [{ id: "b1", type: "building", cx: 2300, cy: 0, w: 300, h: 200, rot: 0, z: 1 }],
  markups: [{ id: "mk1", kind: "rect", cx: 2300, cy: 600, w: 300, h: 160, rot: 0, stroke: "#e11d48", weight: 2, fill: "#e11d48", fillOpacity: 0.4, z: 2 }],
  sheetOverlays: [{ id: "ov1", name: "Exhibit.png", src: PNG, x: 2200, y: 1200, imgW: 200, imgH: 200, ftPerPx: 1, rotation: 0, opacity: 0.9, locked: false, visible: true, aboveParcel: true }],
};

async function load(page, extraRoutes, site = SITE) {
  await armPlannerHooks(page);
  if (extraRoutes) await extraRoutes(page);
  await page.route("**/*.jpg", (route) => route.abort());
  await page.addInitScript((s) => {
    if (localStorage.getItem("planarfit:currentSite:v1") === s.id) return;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s }));
    localStorage.setItem("planarfit:currentSite:v1", s.id);
  }, site);
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Parcels Front Guard", { exact: false }).first().click().catch(() => {});
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await expect.poll(() => page.locator('[data-el-id="b1"]').count(), { timeout: 20000 }).toBe(1);
  await page.waitForTimeout(1200); // fit-on-load + first commit settle
}

/** Client coordinates of a node's centre — each seeded object is centred ON a parcel edge. */
const centreOf = (page, sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel);

/** What the browser itself says is on top at the point, as the owner-facing feature it belongs to. */
const topAt = (page, pt) => page.evaluate(({ x, y }) => {
  const stack = document.elementsFromPoint(x, y);
  for (const n of stack) {
    if (n.closest && n.closest("[data-export='skip']") && !n.closest("[data-feature]")) continue;
    const f = n.closest && n.closest("[data-feature]");
    if (f) return f.getAttribute("data-feature");
  }
  return null;
}, pt);

const landOpen = async (page) => (await page.getByTestId("parcels-panel").count()) + (await page.getByTestId("parcel-page").count());
async function openLand(page) { if (!(await landOpen(page))) await page.locator('[data-rail-tab="parcel"]').click(); await expect.poll(() => landOpen(page)).toBeGreaterThan(0); }
async function closeLand(page) { if (await landOpen(page)) await page.locator('[data-rail-tab="parcel"]').click(); await expect.poll(() => landOpen(page)).toBe(0); }

/* The GIS line band's host box (the sibling div that holds the gisLine pane), found STRUCTURALLY — the same way
 * map-layer-stacking.spec does — so this reads the same on a build that predates the Parcels-in-front markup. */
const lineHostZ = (page) => page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const h = [...svg.parentElement.children].find((el) => el.tagName === "DIV" && el.querySelector(".leaflet-gisLine-pane"));
  return h ? parseInt(getComputedStyle(h).zIndex, 10) : null;
});
const planZ = (page) => page.evaluate(() => parseInt(getComputedStyle(document.querySelector('[data-testid="planner-canvas"]')).zIndex, 10));

test("the plan's own parcel answers above a building, a markup and a promoted reference while the Land panel is open", async ({ page }) => {
  await load(page);
  const pts = {};
  for (const [k, e] of Object.entries(EDGES)) pts[k] = await centreOf(page, e.sel);
  for (const k of Object.keys(pts)) expect(pts[k], `${k}: the seeded ${EDGES[k].label} must be on the canvas`).not.toBeNull();

  // ── PRECONDITION (refuses to score otherwise): with the tool CLOSED the parcel is genuinely buried. ──
  await closeLand(page);
  expect(await topAt(page, pts.east), "building on the east edge").toBe("el:b1");
  expect(await topAt(page, pts.south), "markup on the south edge").toBe("markup:mk1");
  expect(await topAt(page, pts.north), "promoted reference on the north edge").toBe("reference:ov1");
  expect(await page.locator("[data-parcel-tier]").count(), "the parcel group is in its normal place").toBe(0);
  expect(await lineHostZ(page), "the GIS line band is over the plan, as always").toBeGreaterThan(await planZ(page));

  // ── the tool is up: the parcel is the top of the drawing, at all three points ──
  await openLand(page);
  await page.waitForTimeout(500); // the docked column re-flows the canvas box; aim at where each object IS now
  for (const k of Object.keys(pts)) pts[k] = await centreOf(page, EDGES[k].sel);
  for (const k of Object.keys(pts)) expect(await topAt(page, pts[k]), `${k} edge (${EDGES[k].label} over it)`).toBe("parcel:p1");
  // paint order IS document order in SVG — the moved group follows every annotation + the building
  const order = await page.evaluate(() => {
    const tier = document.querySelector('[data-parcel-tier="top"]');
    const after = (sel) => { const n = document.querySelector(sel); return !!n && !!(n.compareDocumentPosition(tier) & Node.DOCUMENT_POSITION_FOLLOWING); };
    return { tier: !!tier, bldg: after('[data-el-id="b1"]'), markup: after('[data-feature="markup:mk1"]'), reference: after('[data-overlay-id="ov1"]') };
  });
  expect(order).toEqual({ tier: true, bldg: true, markup: true, reference: true });
  // …and no GIS stroke can draw over it: the line band sank under the plan SVG
  expect(await lineHostZ(page), "the line band sinks beneath the plan while the tool is up").toBeLessThan(await planZ(page));
  // the plan did not change: same objects, same count (render order only, nothing stored)
  // COUNT-EVERY-KIND: distinct feature KEYS, never nodes (the lot's chip carries its owner's key too)
  expect(await page.evaluate(() => new Set([...document.querySelectorAll('[data-feature^="parcel:"]')].map((n) => n.getAttribute("data-feature"))).size)).toBe(1);

  // ── closing the tool puts everything back ──
  await closeLand(page);
  expect(await topAt(page, pts.east)).toBe("el:b1");
  expect(await topAt(page, pts.south)).toBe("markup:mk1");
  expect(await topAt(page, pts.north)).toBe("reference:ov1");
  expect(await page.locator("[data-parcel-tier]").count()).toBe(0);
  expect(await lineHostZ(page)).toBeGreaterThan(await planZ(page));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"));
  const rec = saved["e2e-parcels-front"] || Object.values(saved)[0];
  expect(JSON.stringify(rec.els.map((e) => e.id)), "no element was reordered or rewritten").toBe(JSON.stringify(["b1"]));
});

test("Pick county lots: a press on a lot covered by a building / markup / reference picks the LOT", async ({ page }) => {
  let pointQueries = 0;
  await load(page, async (pg) => {
    await pg.context().route(/gis\.hctx\.net/, async (route) => {
      const url = route.request().url();
      const cors = { "access-control-allow-origin": "*" };
      const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
      if (/\/MapServer\/0\/query/.test(url)) {
        if (!/esriGeometryPoint/.test(url)) return json({ features: [] });
        pointQueries += 1;
        let x = -95.37, y = 29.76;
        try { const g = JSON.parse(new URL(url).searchParams.get("geometry")); x = g.x; y = g.y; } catch { /* default */ }
        const oid = Math.abs(Math.round(x * 100000)) * 100000 + Math.abs(Math.round(y * 100000));
        const d = 0.0004;
        return json({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, features: [{ attributes: { OBJECTID: oid, SITUS_ADDR: `Lot ${oid}` }, geometry: { rings: [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]], spatialReference: { wkid: 4326 } } }] });
      }
      return json({ id: 0, name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }], extent: { xmin: -96, ymin: 29, xmax: -95, ymax: 30, spatialReference: { wkid: 4326 } }, drawingInfo: { renderer: {} } });
    });
  }, PICK_SITE);
  await page.getByTestId("rail-parcel-tools").click();
  await page.locator('[data-parcel-action="identify"]').click();
  await page.waitForTimeout(600);

  // each seeded object is centred on the lot's line; press the middle of each, one at a time
  for (const [k, e] of Object.entries(EDGES)) {
    const keys = () => page.evaluate(() => new Set([...document.querySelectorAll('[data-feature^="parcel:"]')].map((n) => n.getAttribute("data-feature"))).size);
    const before = await keys();
    const pt = await centreOf(page, e.sel);
    expect(pt, `${k}: ${e.label} on the canvas`).not.toBeNull();
    const base = pointQueries;
    await page.mouse.click(pt.x, pt.y);
    await expect.poll(() => pointQueries, { message: `a press on the ${e.label} reached the county lookup`, timeout: 8000 }).toBeGreaterThan(base);
    await expect.poll(keys, { message: `the lot under the ${e.label} was added`, timeout: 8000 }).toBeGreaterThan(before);
  }
  // the building was never grabbed by those presses: it is exactly where the plan put it
  const rec = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return m["e2e-parcels-front"] || Object.values(m)[0]; });
  const b1 = rec.els.find((e) => e.id === "b1");
  expect([b1.cx, b1.cy]).toEqual([2300, 0]);
});

test("the county lots on offer mount in a host INSIDE the plan SVG, under the plan's parcels (not in the backdrop map)", async ({ page }) => {
  await load(page);
  const hosted = await page.evaluate(() => {
    const band = document.querySelector("[data-parcel-pick-band]");
    const pane = band && band.querySelector('[class*="parcelPick"]');
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    return { band: !!band, pane: !!pane, insideSvg: !!(band && svg && svg.contains(band)) };
  });
  expect(hosted).toEqual({ band: true, pane: true, insideSvg: true });
});

test("PDF-PARITY: the sheet shows the NORMAL order even with the Parcels tool open (the clone puts the group back in its slot)", async ({ page }) => {
  await load(page);
  const sheetOrder = () => page.evaluate(async () => {
    const html = await window.__plannerExportSvg();
    const doc = new DOMParser().parseFromString(html, "image/svg+xml");
    const idx = (sel) => { const n = doc.querySelector(sel); if (!n) return -1; return [...doc.querySelectorAll("*")].indexOf(n); };
    return {
      outline: idx('[data-testid="parcel-outline"]'), building: idx('[data-el-id="b1"]'), markup: idx('[data-feature="markup:mk1"]'),
      tierAttr: doc.querySelectorAll("[data-parcel-tier]").length, slot: doc.querySelectorAll("[data-parcel-tier-slot]").length,
    };
  });
  await closeLand(page);
  const normal = await sheetOrder();
  expect(normal.outline, "the sheet carries the parcel").toBeGreaterThan(-1);
  expect(normal.outline, "normal order: the lot is UNDER the building").toBeLessThan(normal.building);
  await openLand(page);
  const withTool = await sheetOrder();
  expect(withTool.outline, "tool open: the sheet still has the lot UNDER the building").toBeLessThan(withTool.building);
  expect(withTool.outline).toBeLessThan(withTool.markup);
  expect(withTool.tierAttr + withTool.slot, "no screen-only marker leaks into the sheet").toBe(0);
});

/* Found while moving the parcel tree (hiddenContentReads' sweep forced its declaration): hiding the Parcels group removed the
 * lot's outline but left its SETBACK RING painted — a composite that read the raw `parcels` and never asked the hide
 * (B3296's shape). Red on the pre-change build, where the ring is still on the drawing. */
test("hiding the Parcels group hides the setback rings too (the ring is part of the group)", async ({ page }) => {
  const site = { ...SITE, parcels: [{ ...SITE.parcels[0], setbacks: [40, 40, 40, 40] }], settings: { showSetback: true, hidden: { parcels: true } } };
  await load(page, null, site);
  expect(await page.locator('[data-testid="parcel-outline"]').count(), "the hide took: no outline").toBe(0);
  expect(await page.locator('[data-testid="setback-ring"]').count(), "…and no setback ring either").toBe(0);
});
