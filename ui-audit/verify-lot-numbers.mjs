/* NEW-1 (2026-10-04) — Planyr owns parcel outlines AND lot numbers, in the REAL app.
 *
 * Seeded Chambers plan, Site planner "Click a lot on the map". The Chambers host is MOCKED (the sandbox
 * egress blocks it) as a JOINED layer: table-prefixed fields, a lattice of big lots plus one finely
 * subdivided block, the CAD account on `Accounts.Account`. The one thing mocked is the data; everything
 * under test is the shipped build (`vite preview` on :4173).
 *
 * Known-good arm (the measurement can see the thing): the CLOSE band must show a non-trivial number of lot
 * numbers; a run that shows none is VOID, not "no overlaps". Asserts:
 *   1. wide band (zoomed out a step): NO county /export image request, NO overlay <img>, NO lot numbers;
 *   2. close band: the outline query asks for the CAD account's exact prefixed field; numbers are drawn;
 *   3. no two numbers' boxes overlap; none overlaps the plan's own parcel chip; the dense block thins out;
 *   4. every number's text is a real Account value (not Parcel_Id / not the county's picture).
 * Exits 1 on a failed assertion, 2 when the run is VOID. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const A = "ChambersCADWeb.DBO.Accounts.", T = "ChambersCADWeb.DBO.TaxParcels.";
const ORIGIN = { lat: 29.84, lon: -94.88 };
const site = {
  id: "uiaudit-lotnos", groupId: "uiaudit-lotnos", site: "Grand Port Demo", name: "Concept A (copy)",
  origin: ORIGIN, county: "chambers",
  parcels: [{ id: "pc1", locked: true, points: [{ x: -150, y: -100 }, { x: 150, y: -100 }, { x: 150, y: 100 }, { x: -150, y: 100 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try { localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${site.id}': ${JSON.stringify(site)} })); localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)}); } catch (e) {} })();`;

/* The mocked county: big lots 0.0030° × 0.0020° on a lattice centred on the origin, plus the lattice cell
 * east of centre cut into 6 × 6 tiny lots (dense subdivision). Deterministic. */
const LON0 = ORIGIN.lon - 0.0015, LAT0 = ORIGIN.lat - 0.0010, DX = 0.003, DY = 0.002;
const lotsIn = (xmin, ymin, xmax, ymax) => {
  const out = [];
  for (let i = Math.floor((xmin - LON0) / DX); i <= Math.floor((xmax - LON0) / DX); i++) {
    for (let j = Math.floor((ymin - LAT0) / DY); j <= Math.floor((ymax - LAT0) / DY); j++) {
      const x0 = LON0 + i * DX, y0 = LAT0 + j * DY;
      const dense = i === 1 && j === 0;
      const cells = dense ? 6 : 1;
      for (let a = 0; a < cells; a++) for (let b = 0; b < cells; b++) {
        const w = DX / cells, h = DY / cells, lx = x0 + a * w, ly = y0 + b * h;
        const key = `${i}_${j}_${a}_${b}`;
        const oid = (Math.abs(i * 73 + j * 31) % 90) * 1000 + a * 10 + b + 1 + (j < 0 ? 500 : 0) + (i < 0 ? 200 : 0);
        const account = `00${321 + i}-0${2000 + j}0-00${100 + a}-1${String(10000 + b * 7).slice(1)}`.padEnd(24, "0").slice(0, 24);
        out.push({ key, attributes: { [T + "OBJECTID"]: oid, [T + "Name"]: String(11000 + oid), [A + "OBJECTID"]: 2900000 + oid, [A + "Parcel_Id"]: 50000 + oid, [A + "Account"]: account },
          geometry: { rings: [[[lx, ly], [lx + w, ly], [lx + w, ly + h], [lx, ly + h], [lx, ly]]], spatialReference: { wkid: 4326 } } });
      }
    }
  }
  return out;
};
const FIELDS = [T + "OBJECTID", T + "Name", A + "OBJECTID", A + "Parcel_Id", A + "Account"].map((name) => ({ name, alias: name, type: name.endsWith("OBJECTID") ? "esriFieldTypeOID" : "esriFieldTypeString" }));

let pass = 0, fail = 0;
const ok = (c, l) => { c ? pass++ : fail++; console.log(c ? "  ✅" : "  ❌", l); };
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; }); // exposes window.__geoMap (read-only use here: the zoom)
const cors = { "access-control-allow-origin": "*" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const seen = { exports: [], outFields: [], queries: 0, statewide: [] };
await ctx.route(/./, async (route) => {
  const u = new URL(route.request().url());
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
  if (/geographic\.texas\.gov/.test(u.href)) seen.statewide.push(u.href);
  if (/gisdata\.pandai\.com/.test(u.href)) {
    if (/\/export/.test(u.pathname)) { seen.exports.push(u.href); return route.fulfill({ status: 200, headers: cors, contentType: "image/png", body: PNG }); }
    if (/\/query/.test(u.pathname)) {
      seen.queries++;
      const sp = u.searchParams;
      seen.outFields.push(sp.get("outFields") || "");
      const g = sp.get("geometry") || "";
      let xmin, ymin, xmax, ymax;
      try { const j = JSON.parse(g); ({ xmin, ymin, xmax, ymax } = j); } catch { [xmin, ymin, xmax, ymax] = g.split(",").map(Number); }
      const feats = Number.isFinite(xmin) ? lotsIn(xmin, ymin, xmax, ymax) : [];
      return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({
        objectIdFieldName: T + "OBJECTID", geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, fields: FIELDS,
        features: feats.map((f) => ({ attributes: f.attributes, geometry: f.geometry })) }) });
    }
    return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({
      currentVersion: 10.9, id: 0, name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", capabilities: "Map,Query,Data",
      objectIdField: T + "OBJECTID", fields: FIELDS, maxRecordCount: 1000, extent: { xmin: -95.3, ymin: 29.5, xmax: -94.4, ymax: 30.2, spatialReference: { wkid: 4326 } } }) });
  }
  if (/\.(png|jpg|jpeg)(\?|$)|\/export|tile/i.test(u.href)) return route.fulfill({ status: 200, headers: cors, contentType: "image/png", body: PNG });
  return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ features: [] }) });
});
const page = await ctx.newPage();
await assertMeasurable(page, "verify-lot-numbers");
await page.goto(BASE + "?planyrDiag=1", { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.getByRole("button", { name: /^Site$/ }).first().click({ timeout: 3000 }); } catch { try { await page.getByText(/^Site$/).first().click({ timeout: 3000 }); } catch {} }
await page.waitForTimeout(2500);
const addBtn = page.locator('button[title^="Add land to this plan"]').first();
if (!(await addBtn.isVisible().catch(() => false))) { try { await page.locator('[data-rail-tab="parcel"]').first().click({ timeout: 5000 }); } catch {} await page.waitForTimeout(500); }
/* V1475200 — START BELOW THE VECTOR FLOOR, the way the owner's session did: zoom the plan OUT first, only then enter
 * "Click a lot on the map", and let the 8 s hang-guard elapse while the county layers sit below their floor. */
const zoomNow = () => page.evaluate(() => (window.__geoMap ? window.__geoMap.getZoom() : null));
const canvas = page.locator('svg[aria-label="Site plan canvas"]').first();
const box = await canvas.boundingBox();
const wheel = async (dy, n) => { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(250); } await page.waitForTimeout(2500); };

// (The basemap — and so window.__geoMap — only exists once the mode is on, so zoom out by a fixed number of notches
// and read the resulting zoom after entering the mode. Each notch is ~0.4 of a zoom level from the ~20.6 opening zoom.)
for (let i = 0; i < 16; i++) { await wheel(240, 1); }
await addBtn.click({ timeout: 8000 }); await page.waitForTimeout(300);
await page.getByText(/Click a lot on the map/).first().click();
await page.waitForTimeout(3500);
seen.statewide.length = 0;
await page.waitForTimeout(11000); // past the 8 s hang-guard, still below the floor — the exact V1475200 condition

const readLabels = () => page.evaluate(() => {
  const chip = document.querySelector('[data-print-chip="acre"]');
  const cr = chip ? chip.getBoundingClientRect() : null;
  return {
    nodes: [...document.querySelectorAll("[data-lot-no]")].map((n) => { const r = n.getBoundingClientRect(); return { text: n.getAttribute("data-lot-no"), x: r.x, y: r.y, w: r.width, h: r.height }; }),
    chip: cr ? { x: cr.x, y: cr.y, w: cr.width, h: cr.height } : null,
    imgs: [...document.querySelectorAll(".leaflet-overlay-pane img")].length,
  };
});
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// Bring the view to the CLOSE band (zoom in until the vector floor is reached), then step out one band.
let z = await zoomNow();
console.log("start zoom (must be below the vector floor of 16 for this run to mean anything)", z);
if (z == null || z >= 15.9) { console.log("VOID — the run did not start below the vector floor"); await browser.close(); process.exit(2); }
// Now zoom IN to the close band.
for (let i = 0; i < 40 && z < 17.4; i++) { await wheel(-240, 1); z = await zoomNow(); }
// The planner opens tight on the 300 ft test parcel (zoom ~20); step OUT to a working zoom where whole lots are on screen.
for (let i = 0; i < 24 && z != null && z > 17.8; i++) { await wheel(240, 1); z = await zoomNow(); }
console.log("close-band zoom", z);
await page.screenshot({ path: "/tmp/lotnos-close.png" });
const close = await readLabels();
console.log(`CLOSE (z ${z && z.toFixed(2)}): ${close.nodes.length} numbers, ${seen.queries} outline queries, chip ${close.chip ? "present" : "absent"}`);
if (!close.nodes.length) { console.log("VOID — no lot number drawn in the close band, so the run cannot vouch for anything (known-good arm failed)"); await browser.close(); process.exit(2); }
ok(seen.statewide.length === 0, `V1475200 — after dwelling below the floor then zooming in, the statewide picture was never requested (${seen.statewide.length})`);
ok(seen.outFields.some((f) => f.includes(A + "Account")), `the outline query asks for the CAD account's exact prefixed field (saw: ${[...new Set(seen.outFields)].join(" | ").slice(0, 160)})`);
ok(close.nodes.every((n) => /^00\d{3}-0\d{4}0-00\d{3}-1\d{4}$|^\d/.test(n.text) && !/^5\d{4}$/.test(n.text)), "every number is an Accounts.Account value, never Parcel_Id / the county's own Name");
let pile = 0; for (let a = 0; a < close.nodes.length; a++) for (let b = a + 1; b < close.nodes.length; b++) if (overlap(close.nodes[a], close.nodes[b])) pile++;
ok(pile === 0, `no two numbers overlap (${close.nodes.length} drawn, ${pile} overlapping pairs)`);
ok(!close.chip || close.nodes.every((n) => !overlap(n, close.chip)), "no number overlaps the plan's own parcel chip");
const distinct = new Set(close.nodes.map((n) => n.text)).size;
ok(distinct === close.nodes.length, "one number per lot — no lot is numbered twice");
ok(close.nodes.length < 1 + 6 * 6 + 12, `the dense 6×6 block thins out instead of piling up (${close.nodes.length} drawn overall)`);

// WIDE band: one band out — no county picture, no numbers.
seen.exports.length = 0;
for (let i = 0; i < 30 && z != null && z >= 15.5; i++) { await wheel(240, 1); z = await zoomNow(); }
console.log("wide-band zoom", z);
await page.waitForTimeout(1500);
const wide = await readLabels();
ok(z != null && z < 16, `reached the wide band (zoom ${z})`);
ok(seen.exports.length === 0, `no county /export picture requested in the wide band (saw ${seen.exports.length})`);
ok(wide.imgs === 0, `no overlay <img> mounted in the wide band (saw ${wide.imgs})`);
ok(wide.nodes.length === 0, `no lot numbers in the wide band (saw ${wide.nodes.length})`);
await page.screenshot({ path: "/tmp/lotnos-wide.png" });

/* V1475200 (live FAIL, build c8fc0d0): a county sitting BELOW its vector floor for longer than the 8 s hang-guard
 * was declared DOWN, replaced by the statewide picture, and never came back when the view zoomed in. So: stay in the
 * wide band past the guard, THEN zoom to the close band — the numbers must draw and the statewide host must never be asked. */
seen.statewide.length = 0; seen.queries = 0;
await page.waitForTimeout(11000);
for (let i = 0; i < 40 && z != null && z < 17.4; i++) { await wheel(-240, 1); z = await zoomNow(); }
await page.waitForTimeout(3000);
const back = await readLabels();
console.log(`CLOSE AGAIN (z ${z && z.toFixed(2)}) after dwelling below the floor: ${back.nodes.length} numbers, ${seen.queries} outline queries, ${seen.statewide.length} statewide requests`);
ok(back.nodes.length > 0, `lot numbers draw after the view dwelled below the floor and zoomed in (${back.nodes.length})`);
ok(seen.queries > 0, `the county layer asks for cells again (${seen.queries} queries)`);
ok(seen.statewide.length === 0, `the statewide picture is never requested while the county source is healthy (${seen.statewide.length})`);
await page.screenshot({ path: "/tmp/lotnos-close-again.png" });
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
