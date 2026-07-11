/* Verification for B383 — "Add parcel" front-door in the Parcel panel + the map-style
 * "Click a lot on the map" tool (parcel lines light up, click to add one or many).
 *
 * The Parcel panel leads with a primary ＋ Add parcel control (accent chip) → an
 * AnchoredMenu with:
 *   • Click a lot on the map — arms identify mode; the county parcel OUTLINES light up
 *     on the aerial (esri-leaflet featureLayer, shared with the map's Select-parcels tool)
 *     and each CLICK adds that lot to the plan (one or many); a re-click toggles it off.
 *     Disabled with a "Add a parcel from the map first" note when origin is null.
 *   • Draw a new boundary — selectTool("parcel"); always available.
 *
 * Logged-out against the built app (vite preview on :4173). The live county GIS host is
 * CORS-blocked in the sandbox, so Scenario C MOCKS the HCAD parcel service (route fulfil
 * with CORS headers) to drive the real click→query→add pipeline end to end.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const parcel = { id: "pc1", locked: true, points: [{ x: -440, y: -200 }, { x: 440, y: -200 }, { x: 440, y: 320 }, { x: -440, y: 320 }] };
// NB: keep the site name free of the word "parcel" — Playwright text matching is
// case-insensitive substring, so a "…Parcel…" name collides with the button locator.
const geoSite = {
  id: "uiaudit-b383", groupId: "uiaudit-b383", site: "Katy Tract Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const noGeoSite = { ...geoSite, id: "uiaudit-b383b", groupId: "uiaudit-b383b", site: "Ungeoref Tract Demo", origin: null };
// Empty georeferenced site for the click-add scenario, so we can watch Parcels · N grow.
const emptyGeoSite = { ...geoSite, id: "uiaudit-b383c", groupId: "uiaudit-b383c", site: "Empty Katy Demo", parcels: [] };

const seedFor = (site) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${site.id}': ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log("  ✅", label); } else { fail++; console.log("  ❌", label); } };
// The sandbox egress proxy CORS-blocks the external GIS hosts the planner probes — that
// network noise is environmental, not an app bug. Count only genuine app errors.
const appErrors = (errs) => errs.filter((e) => !/CORS policy|Failed to load resource|net::ERR|ERR_FAILED|f=json|arcgis|hctx|houstontx|fema|usgs|esri/i.test(e));

// Mock the Harris CAD (HCAD) parcel service so the click→query→add pipeline runs in the
// sandbox. A POINT query (click-add) returns one lot whose OBJECTID is stable per rounded
// point (so a re-click on the same spot toggles, distinct spots add distinct lots); the
// featureLayer's bbox query returns empty; anything else returns minimal layer metadata.
const installHcadMock = async (ctx) => {
  await ctx.route(/gis\.hctx\.net/, async (route) => {
    const url = route.request().url();
    const cors = { "access-control-allow-origin": "*" };
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
    if (/\/MapServer\/0\/query/.test(url)) {
      if (!/esriGeometryPoint/.test(url)) return json({ features: [] }); // featureLayer bbox draw → nothing in sandbox
      let x = -95.83, y = 29.786;
      try { const g = JSON.parse(new URL(url).searchParams.get("geometry")); x = g.x; y = g.y; } catch {}
      const oid = Math.abs(Math.round(x * 100000)) * 100000 + Math.abs(Math.round(y * 100000)); // stable per point
      const d = 0.0008;
      const rings = [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]];
      return json({ geometryType: "esriGeometryPolygon", spatialReference: { wkid: 4326 }, features: [{ attributes: { OBJECTID: oid, SITUS_ADDR: `Lot ${oid}` }, geometry: { rings, spatialReference: { wkid: 4326 } } }] });
    }
    return json({ id: 0, name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }], extent: { xmin: -96, ymin: 29, xmax: -95, ymax: 30, spatialReference: { wkid: 4326 } }, drawingInfo: { renderer: {} } });
  });
};

async function openPanel(site, { mock = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedFor(site));
  if (mock) await installHcadMock(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1700);
  // Open the Parcel panel if it didn't auto-open (the rail tab TOGGLES, so guard on the button).
  const addBtn = page.locator('button[title^="Add land to this plan"]').first();
  if (!(await addBtn.isVisible().catch(() => false))) {
    try { await page.locator('button[title="Parcel"]').first().click({ timeout: 5000 }); } catch {}
    await page.waitForTimeout(500);
  }
  return { ctx, page, errors, addBtn };
}

const parcelCount = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((n) => /^Parcels · \d+$/.test((n.textContent || "").trim()) && n.children.length === 0);
  return el ? parseInt(el.textContent.replace(/\D/g, ""), 10) : null;
});

// ---------- Scenario A: georeferenced plan (Identify enabled) ----------
console.log("Scenario A — georeferenced plan (Identify enabled):");
{
  const { ctx, page, errors, addBtn } = await openPanel(geoSite);
  ok(await addBtn.count() > 0 && await addBtn.isVisible(), "＋ Add parcel button present in the Parcel panel");
  const bg = await addBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
  ok(["rgb(194, 65, 12)", "rgb(242, 107, 58)"].includes(bg), `＋ Add parcel reads as a primary action (accent bg: ${bg})`);

  await addBtn.click();
  await page.waitForTimeout(350);
  ok(await page.getByText(/Click a lot on the map/).count() > 0, "menu shows 'Click a lot on the map'");
  ok(await page.getByText(/Draw a new boundary/).count() > 0, "menu shows 'Draw a new boundary'");
  await page.screenshot({ path: OUT + "b383-add-parcel-menu.png" });

  await page.getByText(/Click a lot on the map/).first().click();
  await page.waitForTimeout(400);
  // Scope to the BUTTON (the panel status row) — the footer hint shares the same wording.
  const statusRow = page.locator("button").filter({ hasText: /Click lit-up lots to add/ });
  ok(await statusRow.count() > 0, "arming Identify shows the click-to-add status row");
  const cursor = await page.locator('svg[aria-label="Site plan canvas"]').first().evaluate((el) => getComputedStyle(el).cursor).catch(() => "");
  ok(/svg\+xml/.test(cursor), `the canvas shows the + add cursor while identify is armed (${cursor.slice(0, 24)}…)`);

  await statusRow.first().click(); // the status row is the off-switch
  await page.waitForTimeout(250);
  ok(await statusRow.count() === 0, "clicking the status row stops identify mode");

  await addBtn.click();
  await page.waitForTimeout(300);
  await page.getByText(/Draw a new boundary/).first().click();
  await page.waitForTimeout(350);
  ok(await page.getByText(/Click on the plan to drop boundary points/).count() > 0, "'Draw a new boundary' arms the parcel draw tool");
  ok(await page.getByText(/🔍 Identify parcel/).count() === 0, "the old standalone '🔍 Identify parcel' toggle is consolidated away");

  { const ae = appErrors(errors); ok(ae.length === 0, `no app console/page errors (saw ${ae.length}; ${errors.length - ae.length} env GIS-CORS lines ignored)`); if (ae.length) console.log("    app errors:", ae.slice(0, 5)); }
  await ctx.close();
}

// ---------- Scenario B: no georeferenced frame ----------
console.log("Scenario B — no georeferenced frame (origin null):");
{
  const { ctx, page, errors, addBtn } = await openPanel(noGeoSite);
  ok(await addBtn.count() > 0 && await addBtn.isVisible(), "＋ Add parcel present even without a GIS frame");
  await addBtn.click();
  await page.waitForTimeout(350);
  ok(await page.getByText(/Add a parcel from the map first/).count() > 0, "Identify shows the disabled 'Add a parcel from the map first' copy");
  ok(await page.getByText(/Draw a new boundary/).count() > 0, "Draw a new boundary still offered");
  await page.getByText(/Draw a new boundary/).first().click();
  await page.waitForTimeout(350);
  ok(await page.getByText(/Click on the plan to drop boundary points/).count() > 0, "Draw works without origin");
  { const ae = appErrors(errors); ok(ae.length === 0, `no app console/page errors (saw ${ae.length}; ${errors.length - ae.length} env GIS-CORS lines ignored)`); if (ae.length) console.log("    app errors:", ae.slice(0, 5)); }
  await ctx.close();
}

// ---------- Scenario C: click to add one or many (mocked HCAD) ----------
console.log("Scenario C — Identify→add: click lots to add one or many (mocked county GIS):");
{
  const { ctx, page, errors, addBtn } = await openPanel(emptyGeoSite, { mock: true });
  ok((await parcelCount(page)) === 0, "starts at Parcels · 0");
  await addBtn.click();
  await page.waitForTimeout(300);
  await page.getByText(/Click a lot on the map/).first().click();
  await page.waitForTimeout(500);

  const canvas = page.locator('svg[aria-label="Site plan canvas"]').first();
  const box = await canvas.boundingBox();
  const clickAt = async (dx, dy) => { await page.mouse.click(box.x + dx, box.y + dy); await page.waitForTimeout(700); };

  await clickAt(box.width / 2 - 180, box.height / 2 - 60); // lot A
  ok((await parcelCount(page)) === 1, "clicking a lot ADDS it → Parcels · 1");
  ok(await page.getByText(/Added/).count() > 0, "the card confirms '✓ Added'");

  await clickAt(box.width / 2 + 200, box.height / 2 + 80); // lot B (different spot → different lot)
  ok((await parcelCount(page)) === 2, "clicking a second lot adds it too → Parcels · 2 (add MANY)");
  await page.screenshot({ path: OUT + "b383-identify-add.png" });

  await clickAt(box.width / 2 + 200, box.height / 2 + 80); // re-click lot B → toggle off
  ok((await parcelCount(page)) === 1, "re-clicking a just-added lot toggles it back off → Parcels · 1");
  ok(await page.getByText(/Removed/).count() > 0, "the card confirms the lot was Removed");

  { const ae = appErrors(errors); ok(ae.length === 0, `no app console/page errors (saw ${ae.length}; ${errors.length - ae.length} env GIS-CORS lines ignored)`); if (ae.length) console.log("    app errors:", ae.slice(0, 5)); }
  await ctx.close();
}

await browser.close();
console.log(`\nB383 verification: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
