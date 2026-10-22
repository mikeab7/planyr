/* NEW-1 (2026-10-22, work-laptop report) — THE ROOT CAUSE of the half-drawn Epps Mill lot. Rutherford County TN's hosted FeatureServer
 * answers f=geojson with NO top-level `id` (the object id lives only in `properties`; recorded live 2026-10-22). esri-leaflet keys what
 * it holds by `feature.id`, so every lot collapsed onto ONE key and the Select-parcels layer held a single lot over a whole view
 * (`__mapParcelDisplay().held === 1`), a different one each time — the outline of one small lot and nothing else. Every hermetic mock in
 * the repo set `id`, which is how it stayed invisible. This mock answers exactly like the real server: no id. Red on ff7be38 (held 1). */
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1913, height: 641 }, deviceScaleFactor: 2.6775 });

const STEP = 0.0012;
const META = JSON.stringify({ name: "Parcels", type: "Feature Layer", geometryType: "esriGeometryPolygon", currentVersion: 11.1, capabilities: "Query", maxRecordCount: 2000, objectIdField: "OBJECTID", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" }, { name: "ParcelID", type: "esriFieldTypeString", alias: "ParcelID" }], extent: { xmin: -86.4, ymin: 35.6, xmax: -86.2, ymax: 35.8, spatialReference: { wkid: 4326 } } });

function lotsIn(env) {
  const out = [];
  for (let i = Math.floor(env.xmin / STEP); i < Math.ceil(env.xmax / STEP); i++) for (let j = Math.floor(env.ymin / STEP); j < Math.ceil(env.ymax / STEP); j++) {
    const oid = (i + 200000) * 100000 + (j + 200000);
    const x = i * STEP + STEP * 0.1, y = j * STEP + STEP * 0.1, w = STEP * 0.8;
    // NO `id` at the feature level — exactly the shape the real server returns
    out.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[x, y], [x + w, y], [x + w, y + w], [x, y + w], [x, y]]] }, properties: { OBJECTID: oid, ParcelID: `156-${i}.${j}` } });
  }
  return out;
}

test("every lot of a county answer that carries no feature id is held and drawn, not just one", async ({ page }) => {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  let served = 0, queries = 0;
  await page.route(/ParcelsCAMA1\/FeatureServer/i, async (route) => {
    const u = route.request().url();
    if (/\/query(\?|$)/i.test(u)) {
      const g = new URL(u).searchParams.get("geometry"); let env = null;
      try { const o = JSON.parse(g); if (o.xmin != null) env = o; } catch (_) { /* a point / other shape → nothing */ }
      const feats = env ? lotsIn(env) : []; queries++; served += feats.length;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ type: "FeatureCollection", features: feats }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: META });
  });
  await page.goto("/?planyrDiag=1#/site");
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 60000 });
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  await page.evaluate(() => window.__mapFinderMap.setView([35.7209, -86.3218], 18, { animate: false }));
  const read = () => page.evaluate(() => { const d = window.__mapParcelDisplay ? window.__mapParcelDisplay() : null; const l = d && d.layers && d.layers.find((x) => x.key === "tn_rutherford"); return l ? { held: l.held, drawn: l.drawn } : null; });
  await expect.poll(async () => (await read())?.drawn ?? 0, { timeout: 30000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  const r = await read();
  expect(served, "the mock served a real grid of lots").toBeGreaterThan(6);
  expect(r.held, `held ${r.held} lots of ${served} served over ${queries} queries`).toBeGreaterThan(6);
  expect(r.drawn).toBe(r.held);
});
