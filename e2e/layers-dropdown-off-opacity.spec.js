/* B2448032 (Imagery & Layers NEW-2, owner-approved mockup round 4): a row's ▾ holds the SAME parts whether the layer is on or off, and
 * changing how an OFF layer looks turns it on.
 *
 *   · FEMA Flood Zones is OFF: its ▾ shows Opacity (slider + typed %), the ⓘ and — on the planner — Draw above plan; no "About this layer" text.
 *   · Set 60% (typed AND dragged): the checkbox ticks, the layer is drawn, and the MAP'S OWN layer is at 0.6 (read off the live layer).
 *   · Draw above plan on an off layer turns it on. Contour Interval on an off Contour Lines row leaves it OFF.
 *   · A layer turned on by its opacity stays on after a reload (the per-site on/off memory, planner).
 * Both surfaces: planner (located throwaway plan) + map finder. Red on 3a335714 (an off row's ▾ held only the Interval + ⓘ). */
import { test, expect } from "@playwright/test";
import { panelSel, openPlannerLayers, layerRow, openRowMenu } from "./lib/layersPanel.js";

const HOU = { lat: 29.76, lon: -95.37 };
const site = {
  schemaVersion: 12, id: "ldo1", groupId: "ldo1", site: "Layers Dropdown Opacity", name: "Layers Dropdown Opacity",
  updatedAt: 1783000000000, teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: HOU.lat, lon: HOU.lon }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};

async function boot(page, surface) {
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  // FEMA's host is unreachable from the sandbox and its probe retries with backoff, which made "when does the layer attach" a coin flip.
  // A fast, healthy stub keeps this about the PANEL → LAYER wiring (the opacity read off the live layer), not the network.
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  await page.route(/hazards\.fema\.gov/, (r) => (/\/export/.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG })
    : r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ currentVersion: 11, name: "NFHL", layers: [{ id: 27 }, { id: 28 }] }) })));
  await page.addInitScript((j) => { try { if (!localStorage.getItem("planarfit:sites:v1")) localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify({ [site.id]: site }));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(surface === "planner" ? `/#/project/${site.id}/site` : "/#/site-planner", { waitUntil: "load" });
  if (surface === "planner") {
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25000 });
    await page.waitForTimeout(1200);
    await openPlannerLayers(page);
  } else {
    await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
    await page.evaluate(([lat, lon]) => window.__mapFinderMap.setView([lat, lon], 15, { animate: false }), [HOU.lat, HOU.lon]);
    await page.waitForTimeout(1200);
    const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
    if (await chip.count()) await chip.first().click();
  }
  await page.locator(panelSel(surface)).first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(600);
}

const hook = (surface) => (surface === "planner" ? "__plannerLayers" : "__finderLayers");
const liveOpacities = (page, surface, id) => page.evaluate(([h, k]) => { const f = window[h]; return f ? (f().opacities || {})[k] || [] : null; }, [hook(surface), id]);
// planner: the saved on-state; finder: a LIVE layer is attached to the map for that row (it keeps no separate hook for the saved state).
const isOn = (page, surface, id) => page.evaluate(([h, k, s]) => { const f = window[h]; if (!f) return null; const l = f(); return s === "planner" ? (l.on || []).includes(k) : ((l.opacities || {})[k] || []).length > 0; }, [hook(surface), id, surface]);

for (const surface of ["planner", "finder"]) {
  test(`${surface}: an OFF layer's ▾ shows Opacity, and moving it turns the layer on at that opacity`, async ({ page }) => {
    await boot(page, surface);
    const opts = { surface };
    const row = await layerRow(page, "fema", opts);
    const cb = row.locator('input[type="checkbox"]').first();
    await expect(cb, "FEMA starts OFF").not.toBeChecked();

    const menu = await openRowMenu(page, "fema", opts);
    await expect(menu.locator('[data-part="opacity"]'), "Opacity is there on an OFF layer").toBeVisible();
    await expect(menu.locator('[data-part="info"] button'), "the small ⓘ").toBeVisible();
    await expect(menu.locator('[data-part="info"]')).not.toContainText("About this layer");
    if (surface === "planner") await expect(menu.locator('[data-part="above"]'), "Draw above plan on an off area layer").toBeVisible();
    await expect(menu.locator('[data-part="zoom"]'), "no 'Too far out' line on an off layer").toHaveCount(0);
    await expect(menu.locator('[data-part="status"]')).toHaveCount(0);
    expect(await isOn(page, surface, "fema"), "still off").toBe(false);

    // typed 60 → ON at 0.6, the checkbox ticked, the status dot present
    const box = menu.locator('input[type="text"]').first();
    await box.fill("60");
    await expect(cb).toBeChecked();
    await expect.poll(() => isOn(page, surface, "fema"), { timeout: 8000 }).toBe(true);
    await expect.poll(async () => JSON.stringify(await liveOpacities(page, surface, "fema")), { timeout: 10000, message: "the map's own layer is at 60%" }).toMatch(/^\[(0\.6,?)+\]$/);
    await expect(row.locator("[data-layer-dot]")).toHaveCount(1);
    await expect(menu.locator('input[type="range"]')).toHaveValue("0.6");

    // turn it off, then DRAG the slider on the off layer: it comes on live at the dragged value
    await cb.uncheck({ force: true });
    await expect.poll(() => isOn(page, surface, "fema"), { timeout: 8000 }).toBe(false);
    await menu.locator('input[type="range"]').evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, "0.35"); el.dispatchEvent(new Event("input", { bubbles: true })); });
    await expect(cb).toBeChecked();
    await expect.poll(async () => JSON.stringify(await liveOpacities(page, surface, "fema")), { timeout: 10000, message: "the map's own layer follows the drag" }).toMatch(/^\[(0\.35,?)+\]$/);
  });

  test(`${surface}: Contour Interval on an off Contour Lines row stays a preference and does NOT turn it on`, async ({ page }) => {
    await boot(page, surface);
    const row = await layerRow(page, "contours", { surface });
    const menu = await openRowMenu(page, "contours", { surface });
    await expect(menu.locator('[data-part="opacity"]')).toBeVisible();
    await expect(menu.locator('[data-part="interval"]')).toBeVisible();
    await menu.locator('[data-testid="contour-interval"]').selectOption("5");
    await expect(row.locator('input[type="checkbox"]').first(), "still off").not.toBeChecked();
    expect(await isOn(page, surface, "contours")).toBe(false);
    await page.evaluate(() => localStorage.removeItem("planyr:contourInterval"));
  });
}

test("planner: Draw above plan on an OFF layer turns it on; a layer turned on by Opacity is still on after a reload", async ({ page }) => {
  await boot(page, "planner");
  const row = await layerRow(page, "fema");
  const menu = await openRowMenu(page, "fema");
  await menu.locator('[data-part="above"] input[type="checkbox"]').check({ force: true });
  await expect(row.locator('input[type="checkbox"]').first()).toBeChecked();
  expect(await isOn(page, "planner", "fema")).toBe(true);
  await row.locator('input[type="checkbox"]').first().uncheck({ force: true });
  await menu.locator('input[type="text"]').first().fill("60");
  await expect(row.locator('input[type="checkbox"]').first()).toBeChecked();
  await page.waitForTimeout(1500); // let the autosave settle
  await page.reload({ waitUntil: "load" });
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(1200);
  await openPlannerLayers(page);
  await expect.poll(() => isOn(page, "planner", "fema"), { timeout: 10000 }).toBe(true);
});
