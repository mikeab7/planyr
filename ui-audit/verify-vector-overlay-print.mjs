/* B745 verification — the PDF/PNG export must include the VECTOR/client-drawn GIS overlay layers
 * (county/city boundaries, transmission, contours, drainage arrows, OSM/Mapillary points). Drives
 * the built app headlessly: seed a located site, boot the planner, turn boundary + transmission
 * layers ON, enter print mode, confirm the "Print map layers" checkbox appears (now gated for
 * vectors too), Download PDF, and assert the export SVG got `g[data-export-vector]` groups with
 * child path/circle nodes.
 *
 * Unlike the raster verify, a vector <g> is created ONLY when the layer's geometry actually loaded
 * (there's nothing to synthesize before a fetch), so this genuinely exercises the whole
 * fetch → extract → reproject → emit chain. Boundaries (statewide, cached) are the reliable case.
 *
 * Run: npm run build && npx vite preview   (then)  node ui-audit/verify-vector-overlay-print.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const site = {
  id: "b745", groupId: "b745", site: "B745 Vector Site", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ ${JSON.stringify(site.id)}: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

// Canned Harris County polygon (esri JSON) so the `vector` boundary layer loads DETERMINISTICALLY —
// the sandbox can't reach the live TxGIO/agency GIS hosts through the cert-inspection proxy, so we
// mock the ONE county /query. This proves the real fetch→extract(toGeoJSON)→reproject→emit chain
// with an actual Leaflet L.geoJSON layer, independent of live-host reachability. (Live imagery-paint
// for every layer is the V### live check.) Ring drawn around the Katy origin so it's finite + on-frame.
const countyEsri = {
  features: [{
    attributes: { CNTY_NM: "Harris" },
    geometry: { rings: [[[-95.95, 29.70], [-95.70, 29.70], [-95.70, 29.90], [-95.95, 29.90], [-95.95, 29.70]]] },
  }],
  exceededTransferLimit: false,
};
const b64decode = (s) => { try { return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(); } catch (_) { return ""; } };

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
// Fulfill the county-boundary query (direct-to-agency OR via the /api/gis-cache proxy) with canned geometry.
await page.route("**/*", (route) => {
  const u = route.request().url();
  const proxied = u.includes("/api/gis-cache/svc/") ? b64decode(u.split("/svc/")[1]?.split("/")[0] || "") : "";
  if (/Texas_County_Boundaries/i.test(u) || /Texas_County_Boundaries/i.test(proxied)) {
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(countyEsri) });
  }
  return route.continue();
});
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2000);

// Enable a couple of vector layers via native DOM clicks (they sit in scrollable groups).
const turnedOn = await page.evaluate((labels) => {
  const lbls = [...document.querySelectorAll("label")];
  let n = 0;
  for (const want of labels) {
    const lbl = lbls.find((l) => l.textContent.includes(want));
    const cb = lbl && lbl.querySelector('input[type="checkbox"]');
    if (cb && !cb.checked) cb.click();
    if (cb && cb.checked) n++;
  }
  return n;
}, ["County boundaries"]);
console.log("vector layers turned on:", turnedOn);
// Give the (mocked) county fetch + vector paint time to land.
await page.waitForTimeout(4000);

// Enter print mode.
await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
const cbVisible = await page.locator('label:has-text("Print map layers")').first().isVisible().catch(() => false);

// Hook: record vector <g>s created during the (synchronous) buildExportSvg pass.
await page.evaluate(() => {
  window.__vec = { groups: 0, paths: 0, circles: 0 };
  const origSA = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    try {
      if (name === "data-export-vector") {
        window.__vec.groups++;
        // count children shortly after innerHTML is set
        setTimeout(() => { try { window.__vec.paths += this.querySelectorAll("path").length; window.__vec.circles += this.querySelectorAll("circle").length; } catch (e) {} }, 0);
      }
    } catch (e) {}
    return origSA.apply(this, arguments);
  };
});

await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 });
await page.waitForTimeout(3500);

const vec = await page.evaluate(() => window.__vec || { groups: 0, paths: 0, circles: 0 });
console.log("printMapLayers checkbox visible:", cbVisible);
console.log("data-export-vector groups composited:", vec.groups, "| child paths:", vec.paths, "| circles:", vec.circles);
console.log("page errors:", errs.length ? errs.slice(0, 5) : "none");

// PASS: the checkbox shows for vector layers AND at least one vector <g> with drawn geometry
// landed in the export (proves the fetch→extract→reproject→emit chain end-to-end).
const ok = cbVisible && vec.groups >= 1 && (vec.paths + vec.circles) >= 1;
console.log(ok ? "PASS ✅ — vector layers composited into the PDF export" : "PARTIAL/FAIL — see counts above");
await browser.close();
process.exit(ok ? 0 : 1);
