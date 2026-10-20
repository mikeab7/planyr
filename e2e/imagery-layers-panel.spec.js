/* NEW-1 (Imagery & Layers redesign) — the three behaviours a unit test cannot see, on the REAL app.
 *
 *   1. HIDE LAYERS is temporary and non-destructive: it clears what the map is told to draw (`drawn`, the live Leaflet
 *      layers) and leaves every checkbox, the saved overrides and the stored plan BYTE-IDENTICAL; Show restores the same set.
 *   2. The CONTOUR INTERVAL is a real floor under the automatic spacing: a coarser choice draws strictly fewer lines.
 *   3. The EASEMENT CORRIDOR now lives in Pipelines' dropdown (the old row is gone), its width changes the drawn band, and
 *      a plan saved with the corridor ON still draws it.
 *
 * Hermetic where it can be: the pipeline /query is stubbed (as verify-b751-pipeline-vector does); 3DEP is relayed through Node
 * because Chromium here cannot reach it (as contour-hover-elevation does) — the app's own fetch, worker trace and paint run for real.
 */
import { test, expect } from "@playwright/test";
import { panelSel, openPlannerLayers, setLayer, openRowMenu, layerRow } from "./lib/layersPanel.js";

async function relay3dep(page) {
  await page.route("**elevation.nationalmap.gov/**", async (route) => {
    try {
      const r = await fetch(route.request().url());
      const buf = Buffer.from(await r.arrayBuffer());
      await route.fulfill({ status: r.status, contentType: r.headers.get("content-type") || "application/octet-stream", body: buf });
    } catch (_) { await route.abort(); }
  });
}

const LAT = 29.77938, LON = -95.89503; // the Tsakiris tract (Waller County) — real LiDAR, a real slope
const site = (over = {}) => ({
  schemaVersion: 12, id: "il1", groupId: "il1", site: "Imagery Layers Guard", name: "Imagery Layers Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT, lon: LON }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], ...over,
});

async function open(page, s, { terrain = false } = {}) {
  if (terrain) await relay3dep(page);
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); localStorage.setItem("planarfit:relevance:v1", JSON.stringify({ mode: "all", radius: 2.5 })); } catch (_) {} }, JSON.stringify({ [s.id]: s }));
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText(s.site, { exact: false }).first().click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(1500);
  await openPlannerLayers(page);
}

const layers = (page) => page.evaluate(() => window.__plannerLayers && window.__plannerLayers());
const storedPlan = (page) => page.evaluate(() => localStorage.getItem("planarfit:sites:v1"));

test("Hide Layers clears the drawing and nothing else; Show brings back the identical set", async ({ page }) => {
  await open(page, site());
  await setLayer(page, "fema", true);
  await setLayer(page, "contours", true);
  await expect.poll(async () => (await layers(page)).on.length, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(800); // let the autosave settle so the stored bytes are the baseline
  const before = await layers(page);
  const stored0 = await storedPlan(page);

  const panel = page.locator(panelSel("planner")).first();
  const toggle = panel.getByTestId("layers-hide-toggle");
  await expect(toggle).toHaveText(/Hide Layers/);
  await toggle.click();
  await expect(toggle).toHaveText(/Show Layers/);

  const hidden = await layers(page);
  expect(hidden.on, "the saved choice (the checkboxes) is untouched while hidden").toEqual(before.on);
  expect(hidden.drawn, "nothing is drawn while hidden").toEqual([]);
  await expect.poll(async () => (await layers(page)).live, { timeout: 8000 }).toEqual([]);
  // The checked rows are still checked — and say so with the hollow "hidden" dot.
  const fema = await layerRow(page, "fema");
  await expect(fema.locator('input[type="checkbox"]').first()).toBeChecked();
  await expect(fema.locator("[data-layer-dot]")).toHaveAttribute("data-layer-dot", "hidden");
  expect(await storedPlan(page), "hiding writes nothing to the plan").toBe(stored0);

  await toggle.click();
  await expect(toggle).toHaveText(/Hide Layers/);
  const shown = await layers(page);
  expect(shown.on).toEqual(before.on);
  expect(shown.drawn.sort(), "Show restores the identical drawn set").toEqual(before.drawn.sort());
  expect(await storedPlan(page), "…and the stored plan is byte-identical after the round trip").toBe(stored0);

  // Turning a layer on while hidden ends the hide (it never leaves the person staring at a checked box that draws nothing).
  await toggle.click();
  await expect(toggle).toHaveText(/Show Layers/);
  await setLayer(page, "bts_rail", true);
  await expect(toggle).toHaveText(/Hide Layers/);
});

test("the Contour Interval choice is a floor under the automatic spacing — coarser draws strictly fewer lines", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, site(), { terrain: true });
  await setLayer(page, "contours", true);
  const stats = () => page.evaluate(() => window.__terrainStats || null);
  await expect.poll(async () => (await stats())?.lines || 0, { timeout: 90_000, message: "the contour trace never painted (3DEP relay)" }).toBeGreaterThan(0);

  const counts = {};
  for (const ft of [1, 5, 10]) {
    const menu = await openRowMenu(page, "contours");
    await menu.getByTestId("contour-interval").selectOption(String(ft));
    await expect.poll(async () => (await stats())?.interval, { timeout: 60_000 }).toBe(ft);
    await page.waitForTimeout(1500);
    counts[ft] = (await stats()).lines;
  }
  expect(counts[1], JSON.stringify(counts)).toBeGreaterThanOrEqual(counts[5]);
  expect(counts[10], `10 ft must draw strictly fewer lines than 1 ft: ${JSON.stringify(counts)}`).toBeLessThan(counts[1]);
  await expect(await layerRow(page, "contours")).toContainText("10′");
});

/* RRC pipeline stub — the same canned centrelines the B751 harness serves, here on one E–W line through the tract. */
async function stubPipelines(page) {
  const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
  const b64 = (s) => { try { return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(); } catch (_) { return ""; } };
  const esri = { features: [{ attributes: { COMMODITY_DESCRIPTION: "NATURAL GAS", OPERATOR: "Acme Gas", DIAMETER: 12, STATUS: "In Service" }, geometry: { paths: [[[LON - 0.02, LAT], [LON + 0.02, LAT]]] } }], exceededTransferLimit: false };
  await page.route("**/*", (route) => {
    const u = route.request().url();
    const proxied = u.includes("/api/gis-cache/svc/") ? b64(u.split("/svc/")[1]?.split("/")[0] || "") : "";
    const q = /MapServer\/13\/query/i.test(u) || /MapServer\/13\/query/i.test(proxied);
    const x = /RRC_Public_Viewer_Srvs\/MapServer\/export/i.test(u) || /RRC_Public_Viewer_Srvs\/MapServer\/export/i.test(proxied);
    if (q) return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(esri) });
    if (x) return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG1 });
    return route.continue();
  });
}
// The tallest drawn corridor band (px) — Leaflet paints it as <path>s inside its own pane.
const bandHeight = (page) => page.evaluate(() => {
  const pane = document.querySelector(".leaflet-pipecorridorpane-pane, .leaflet-pane.leaflet-pipecorridorpane-pane");
  if (!pane) return -1;
  let h = 0;
  for (const p of pane.querySelectorAll("path")) { const r = p.getBoundingClientRect(); if (r.width > 4) h = Math.max(h, r.height); }
  return h;
});

test("the Easement Corridor lives in Pipelines' dropdown, its width changes the drawn band, and the old row is gone", async ({ page }) => {
  await stubPipelines(page);
  await open(page, site());
  const panel = page.locator(panelSel("planner")).first();
  await setLayer(page, "pipelines", true);
  await page.waitForTimeout(3000);
  // The standalone corridor row no longer exists in any group.
  await expect(panel.getByTestId("layer-row-txrrc_pipe_easement")).toHaveCount(0);

  const menu = await openRowMenu(page, "pipelines");
  await menu.getByTestId("pipeline-corridor").check({ force: true });
  await page.waitForTimeout(2500);
  await menu.getByTestId("pipeline-corridor-width").selectOption("50");
  await expect.poll(() => bandHeight(page), { timeout: 15000, message: "no corridor band drew" }).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  const h50 = await bandHeight(page);
  await menu.getByTestId("pipeline-corridor-width").selectOption("100");
  await page.waitForTimeout(1500);
  const h100 = await bandHeight(page);
  expect(h100, `a 100 ft corridor must draw a taller band than 50 ft (${h50} → ${h100})`).toBeGreaterThan(h50 * 1.5);
});

test("a plan saved with the corridor ON (the old row's key) still draws it", async ({ page }) => {
  await stubPipelines(page);
  await open(page, site({ layerOverrides: { txrrc_pipe: true, txrrc_pipe_easement: true } }));
  await expect.poll(() => bandHeight(page), { timeout: 20000, message: "the saved corridor-on plan drew no band" }).toBeGreaterThan(0);
  const menu = await openRowMenu(page, "pipelines");
  await expect(menu.getByTestId("pipeline-corridor")).toBeChecked();
});
