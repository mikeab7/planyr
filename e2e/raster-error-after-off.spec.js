/* NEW-1 (2026-11-12) — "Cannot read properties of null (reading 'removeLayer')" after a map image layer's request fails
 * AFTER its row was turned off (cross-user `client_errors`, stack `_overlayOnError → fire → i.P`).
 *
 * esri-leaflet's RasterLayer._renderImage wires `onOverlayError = function () { this._map.removeLayer(image); … }` with no
 * `this._map` guard. A dynamic (/export) layer whose image request is IN FLIGHT when the person unticks its row loses its map
 * (Leaflet nulls `_map` on removal) and the late failure throws inside Leaflet's event loop. This drives the real thing:
 * FEMA Flood Zones on (the map finder), its /export held then answered 500, the row switched OFF while it is held — and
 * asserts the page raised no error. The second arm leaves the row ON for the same 500 — the failed image makes the layer swap
 * itself for a direct one, which drops the old layer's map under the pending image (the more common production path; red on
 * 2b1e4b7 too). BOTH arms must have seen the held request (otherwise the run is VOID: the effect could not have happened).
 * Red on 2b1e4b7 (before layers.js built its rasters behind guardRasterErrors). */
import { test, expect } from "@playwright/test";
import { setLayer } from "./lib/layersPanel.js";

const HOU = { lat: 29.76, lon: -95.37 };

async function boot(page, surface) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  const held = { n: 0 };
  // Any layer-image export (direct or via the same-origin cache relay): hold it ~1.8 s, then fail it.
  await page.route(/\/export\?/, async (r) => {
    held.n++;
    await new Promise((res) => setTimeout(res, 1800));
    await r.fulfill({ status: 500, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: "boom" }).catch(() => {});
  });
  await page.route(/hazards\.fema\.gov(?!.*\/export)/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ currentVersion: 11, name: "NFHL", layers: [{ id: 27 }, { id: 28 }] }) }));
  await page.addInitScript(() => { try { window.__PLANYR_E2E = true; } catch (_) {} });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
  await page.evaluate(([lat, lon]) => window.__mapFinderMap.setView([lat, lon], 15, { animate: false }), [HOU.lat, HOU.lon]);
  await page.waitForTimeout(1000);
  const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  await page.locator('[data-testid="layer-panel"][data-surface="finder"]').first().waitFor({ state: "visible", timeout: 20000 });
  return { errors, held };
}

const nullMap = (errors) => errors.filter((m) => /removeLayer|reading '_leaflet_pos'|of null/.test(m));

test("a raster image that fails after its row was turned OFF raises no page error", async ({ page }) => {
  const { errors, held } = await boot(page, "finder");
  await setLayer(page, "fema", true, { surface: "finder" });
  await expect.poll(() => held.n, { timeout: 15000, message: "the layer's /export is in flight (else the run is VOID)" }).toBeGreaterThan(0);
  await setLayer(page, "fema", false, { surface: "finder" });           // the row goes off while the image is still held
  await page.waitForTimeout(3500);                                     // …then the held request fails
  expect(nullMap(errors), `page errors: ${errors.join(" | ")}`).toEqual([]);
});

// The second door to the same throw — and the likelier one in the wild: a failing image on a layer routed through the
// same-origin cache relay swaps itself for a direct-to-agency layer (wireRasterStatus's proxy→direct fallback), which REMOVES the
// proxied layer while its image is still pending. The row never moved; the layer lost its map anyway.
test("the proxy→direct swap path (row left ON, image fails, layer replaced) is silent too, and was in flight", async ({ page }) => {
  const { errors, held } = await boot(page, "finder");
  await setLayer(page, "fema", true, { surface: "finder" });
  await expect.poll(() => held.n, { timeout: 15000 }).toBeGreaterThan(0);
  await page.waitForTimeout(3500);
  expect(nullMap(errors), `page errors: ${errors.join(" | ")}`).toEqual([]);
});
