/* Road names over the aerial on the planner canvas (NEW-1, 2026-10-11).
 *
 * Owner: road names show on the map finder but never once a site is open. The planner now mounts the
 * SAME vector label helper (`addVectorLabels`, pane `planyrVectorLabels`) on its slaved Leaflet basemap,
 * gated by the SAME `siteStack`. RED on main before this change: the pane never exists on the canvas.
 *
 * What this proves, headlessly (no real tiles needed — the pane is created before any network):
 *   1. at street zoom over the aerial the pane exists and holds the label canvas
 *   2. Road names OFF removes it; ON restores it; aerial OFF removes it
 *   3. REGISTRATION: after a pan and a wheel-zoom the label map and the aerial agree on centre and keep
 *      one constant zoom offset (a drifting/lagging label layer breaks one of the two)
 *   4. the layer sits under the plan SVG and never takes a press (pointer-events none)
 *   5. the on/off + opacity survive a reload (device-level pref, lib/roadNamesPref.js)
 * FOREGROUND-OR-VOID: a hidden tab suspends rAF, so the geometry reads are refused unless visible. */
import { test, expect } from "@playwright/test";
import { panelSel, openPlannerLayers, layerRow, setLayer, openRowMenu } from "./lib/layersPanel.js";
import { installFakeVectorSource, HOUSTON } from "../ui-audit/lib/fakeVectorTiles.mjs"; // synthetic OpenMapTiles source: the sandbox cannot reach openfreemap, and a failed source would swap in the raster fallback and remove the GL layer

const SITE = {
  schemaVersion: 12, id: "rn-planner", groupId: "rn-planner",
  site: "Road Names Guard", name: "Road Names Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: HOUSTON.lat, lon: HOUSTON.lng }, county: "Harris", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 600 }, { x: 0, y: 600 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};
const PANE = "planyrVectorLabels";
const paneState = (page) => page.evaluate((name) => {
  const m = window.__geoMap; const p = m && m.getPane(name);
  return { exists: !!p, canvas: !!(p && p.querySelector("canvas")), pe: p ? getComputedStyle(p).pointerEvents : null, op: p ? p.style.opacity : null, z: m ? m.getZoom() : null };
}, PANE);

async function open(page, extra) {
  await installFakeVectorSource(page.context());
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript((s) => { try { if (!localStorage.getItem("planarfit:sites:v1")) localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
  if (extra) await page.addInitScript(extra);
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Road Names Guard", { exact: false }).first().click();
  await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForFunction(() => !!window.__geoMap, null, { timeout: 20000 });
  expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
}

test.describe("planner road names (NEW-1)", () => {
  test("pane exists at street zoom, follows the toggle and the aerial, stays registered", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await open(page);
    await page.waitForFunction((n) => { const m = window.__geoMap; return m && m.getZoom() >= 14 && !!(m.getPane(n) && m.getPane(n).querySelector("canvas")); }, PANE, { timeout: 25000 });
    let st = await paneState(page);
    expect(st.exists && st.canvas, "label pane + canvas present at street zoom").toBe(true);
    expect(st.pe).toBe("none");

    // under the plan SVG: the pane lives inside the Leaflet map pane, which is a sibling BELOW the plan svg
    const order = await page.evaluate((n) => {
      const pane = window.__geoMap.getPane(n); const svg = document.querySelector('[data-testid="planner-canvas"]');
      const a = pane.getBoundingClientRect(); return { paneInMap: window.__geoMap.getContainer().contains(pane), svgInMap: window.__geoMap.getContainer().contains(svg), a: a.width };
    }, PANE);
    expect(order.paneInMap).toBe(true); expect(order.svgInMap).toBe(false);

    // registration across pan + wheel-zoom
    const readReg = () => page.evaluate(() => {
      const m = window.__geoMap, g = m.__vectorLabelsGL; if (!g) return null;
      const c = m.getCenter(), gc = g.getCenter();
      const a = m.project(c, m.getZoom()), b = m.project(gc, m.getZoom()); // pixel disagreement at the aerial's own zoom
      return { px: Math.hypot(a.x - b.x, a.y - b.y), zOff: m.getZoom() - g.getZoom() };
    });
    await page.waitForFunction(() => !!(window.__geoMap && window.__geoMap.__vectorLabelsGL), null, { timeout: 25000 });
    // The first reading waits for the label map to have taken its initial position (a creation-time wait, not a lag allowance:
    // every reading AFTER a gesture below is strict).
    await page.waitForFunction(() => { const m = window.__geoMap, g = m.__vectorLabelsGL; const a = m.project(m.getCenter(), m.getZoom()), b = m.project(g.getCenter(), m.getZoom()); return Math.hypot(a.x - b.x, a.y - b.y) < 0.75; }, null, { timeout: 15000 });
    const base = await readReg();
    const box = await page.locator('[data-testid="planner-canvas"]').first().boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -400); await page.waitForTimeout(900);
    const afterZoom = await readReg();
    await page.keyboard.down("Space"); await page.mouse.down(); await page.mouse.move(cx + 140, cy + 60, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("Space");
    await page.mouse.wheel(0, 300); await page.waitForTimeout(900);
    const afterPan = await readReg();
    for (const r of [base, afterZoom, afterPan]) {
      expect(r).not.toBeNull();
      console.log('reg', JSON.stringify(r));
      expect(r.px, 'labels vs aerial centre disagreement (px)').toBeLessThan(0.75);
      expect(Math.abs(r.zOff - base.zOff), "constant zoom offset between aerial and labels").toBeLessThan(1e-3);
    }

    // toggle OFF → pane gone; ON → back
    await openPlannerLayers(page);
    const row = (await layerRow(page, "road_names")).getByRole("checkbox", { name: "Road Names" }); // NEW-1: Map Base › Labels › Road Names
    await row.waitFor({ state: "visible", timeout: 10000 });
    await row.uncheck();
    await page.waitForFunction((n) => { const m = window.__geoMap; return !(m.getPane(n) && m.getPane(n).querySelector("canvas")); }, PANE);
    await row.check();
    await page.waitForFunction((n) => { const p = window.__geoMap.getPane(n); return !!(p && p.querySelector("canvas")); }, PANE, { timeout: 15000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("aerial Off removes the labels; opacity and on/off survive a reload", async ({ page }) => {
    await open(page);
    const has = () => page.evaluate((n) => { const p = window.__geoMap.getPane(n); return !!(p && p.querySelector("canvas")); }, PANE);
    await page.waitForFunction((n) => { const p = window.__geoMap.getPane(n); return !!(p && p.querySelector("canvas")); }, PANE, { timeout: 25000 });
    await openPlannerLayers(page);
    const slider = (await openRowMenu(page, "road_names")).getByLabel("Road Names opacity"); // NEW-1: Opacity lives in the row's ▾ dropdown
    await slider.waitFor({ state: "visible", timeout: 10000 });
    await slider.fill("0.4");
    await expect.poll(async () => (await paneState(page)).op).toBe("0.4");

    // aerial Off → no labels (the row and slider leave with it)
    const source = page.locator(panelSel("planner")).getByTestId("basemap-source"); // NEW-1: a standard dropdown (Off / Esri / USGS)
    await source.selectOption("off");
    await expect.poll(has).toBe(false);
    await source.selectOption("esri");
    await expect.poll(has, { timeout: 20000 }).toBe(true);
    expect((await paneState(page)).op).toBe("0.4");

    // reload: the opacity held
    await page.reload({ waitUntil: "load" });
    await page.getByText("Road Names Guard", { exact: false }).first().click().catch(() => {});
    await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForFunction((n) => { const p = window.__geoMap && window.__geoMap.getPane(n); return !!(p && p.querySelector("canvas")); }, PANE, { timeout: 25000 });
    expect((await paneState(page)).op).toBe("0.4");

    // off, reload → stays off
    await openPlannerLayers(page);
    await setLayer(page, "road_names", false);
    await expect.poll(has).toBe(false);
    await page.reload({ waitUntil: "load" });
    await page.getByText("Road Names Guard", { exact: false }).first().click().catch(() => {});
    await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(3000);
    expect(await has()).toBe(false);
  });
});
