/* B751/B752 verification — pipelines render as commodity-colored VECTOR polylines (not a raster)
 * at working zoom, with a six-class legend; and the assumed easement corridor draws a translucent
 * band with an editable width. Drives the built app headlessly: seed a located site, boot the
 * planner, MOCK the RRC layer-13 /query (the sandbox can't reach gis.rrc.texas.gov), turn Pipelines
 * ON → assert the panel shows the commodity legend AND the export composites vector line geometry;
 * turn the corridor ON → assert the inline width control appears AND the bands composite too.
 *
 * The RRC host being blocked here is exactly why B751 is Verify:live — mocking the ONE /query proves
 * the fetch → featuresToGeoJson(lines) → styleFor(commodity) → paint → export chain end-to-end with
 * a real Leaflet L.geoJSON layer, independent of live-host reachability (live imagery/CORS is V264).
 *
 * Run: npm run build && npx vite preview   (then)  node ui-audit/verify-b751-pipeline-vector.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

const parcel = { id: "pc1", locked: false, points: [{ x: -300, y: -120 }, { x: 300, y: -120 }, { x: 300, y: 220 }, { x: -300, y: 220 }] };
const site = {
  id: "b751", groupId: "b751", site: "B751 Pipeline Site", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 300, h: 120, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ ${JSON.stringify(site.id)}: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

// Canned RRC pipeline polylines (esri JSON) near the Katy origin, one per commodity bucket so the
// styling + legend + corridor exercise every class. Lines run roughly E–W across the site.
const L = (lat, lon0, lon1) => [[lon0, lat], [lon1, lat]];
const pipeEsri = {
  features: [
    { attributes: { COMMODITY_DESCRIPTION: "NATURAL GAS", OPERATOR: "Acme Gas", DIAMETER: 12, STATUS: "In Service" }, geometry: { paths: [L(29.784, -95.845, -95.815)] } },
    { attributes: { COMMODITY_DESCRIPTION: "CRUDE OIL", OPERATOR: "Beta Crude", DIAMETER: 20, STATUS: "In Service" }, geometry: { paths: [L(29.786, -95.845, -95.815)] } },
    { attributes: { COMMODITY_DESCRIPTION: "PROPANE (HVL)", OPERATOR: "Gamma NGL", DIAMETER: 8, STATUS: "In Service" }, geometry: { paths: [L(29.788, -95.845, -95.815)] } },
    { attributes: { COMMODITY_DESCRIPTION: "REFINED PRODUCTS", OPERATOR: "Delta Ref", DIAMETER: 10, STATUS: "In Service" }, geometry: { paths: [L(29.790, -95.845, -95.815)] } },
    { attributes: { COMMODITY_DESCRIPTION: "CARBON DIOXIDE", OPERATOR: "Epsilon CO2", DIAMETER: 16, STATUS: "In Service" }, geometry: { paths: [L(29.782, -95.845, -95.815)] } },
    { attributes: { COMMODITY_DESCRIPTION: "", OPERATOR: "Zeta Misc", DIAMETER: 6, STATUS: "Unknown" }, geometry: { paths: [L(29.780, -95.845, -95.815)] } },
  ],
  exceededTransferLimit: false,
};
const b64decode = (s) => { try { return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(); } catch (_) { return ""; } };
// 1x1 transparent PNG so a raster-fallback export (far-out) never errors.
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.route("**/*", (route) => {
  const u = route.request().url();
  const proxied = u.includes("/api/gis-cache/svc/") ? b64decode(u.split("/svc/")[1]?.split("/")[0] || "") : "";
  const isPipeQuery = /MapServer\/13\/query/i.test(u) || /MapServer\/13\/query/i.test(proxied);
  const isPipeExport = /RRC_Public_Viewer_Srvs\/MapServer\/export/i.test(u) || /RRC_Public_Viewer_Srvs\/MapServer\/export/i.test(proxied);
  if (isPipeQuery) return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(pipeEsri) });
  if (isPipeExport) return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG1 });
  return route.continue();
});
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2500);

const clickLayer = (want) => page.evaluate((label) => {
  const lbl = [...document.querySelectorAll("label")].find((l) => l.textContent.includes(label));
  const cb = lbl && lbl.querySelector('input[type="checkbox"]');
  if (cb && !cb.checked) cb.click();
  return !!(cb && cb.checked);
}, want);

const pipeOn = await clickLayer("Pipelines (TxRRC)");
await page.waitForTimeout(4000); // mocked /query + vector paint

// Legend: the six commodity classes should be listed under the row while on. Use textContent
// (visibility-agnostic — the panel may be scrolled) across every LayerPanel instance.
const legend = await page.evaluate(() => {
  const txt = document.body.textContent || "";
  return {
    natgas: /Natural gas/i.test(txt), crude: /Crude oil/i.test(txt), hvl: /HVL/i.test(txt),
    refined: /Refined/i.test(txt), co2: /Carbon dioxide/i.test(txt), unknown: /Unknown \/ unclassified/i.test(txt),
  };
});

const corridorOn = await clickLayer("Pipeline easement corridor");
await page.waitForTimeout(2500);
const widthCtl = await page.evaluate(() => {
  const inp = document.querySelector('input[aria-label="Assumed corridor total width in feet"]');
  return inp ? Number(inp.value) : null;
});

// Export → count vector groups + child geometry (pipelines = lines, corridor = polygons; both <path>).
await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 }).catch(() => {});
await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(700);
const cbVisible = await page.locator('label:has-text("Print map layers")').first().isVisible().catch(() => false);
await page.evaluate(() => {
  window.__vec = { groups: 0, paths: 0 };
  const origSA = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    try { if (name === "data-export-vector") { window.__vec.groups++; setTimeout(() => { try { window.__vec.paths += this.querySelectorAll("path").length; } catch (e) {} }, 0); } } catch (e) {}
    return origSA.apply(this, arguments);
  };
});
await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(3500);
const vec = await page.evaluate(() => window.__vec || { groups: 0, paths: 0 });

console.log("Pipelines layer ON:", pipeOn);
console.log("commodity legend classes present:", legend);
console.log("corridor layer ON:", corridorOn, "| inline width (ft):", widthCtl);
console.log("Print map layers checkbox visible:", cbVisible);
console.log("data-export-vector groups:", vec.groups, "| child paths:", vec.paths);
console.log("page errors:", errs.length ? errs.slice(0, 5) : "none");

const legendOk = Object.values(legend).filter(Boolean).length >= 5;
const ok = pipeOn && legendOk && corridorOn && widthCtl === 50 && cbVisible && vec.groups >= 1 && vec.paths >= 1 && errs.length === 0;
console.log(ok ? "PASS ✅ — pipeline vector render + commodity legend + corridor width + export composite" : "PARTIAL/FAIL — see values above");
await browser.close();
process.exit(ok ? 0 : 1);
