/* B2448033 (owner 2026-10-29: "each plan should remember each layer's opacity. Or like each project, or each project more so. It should be
 * default within the site."): a layer's OPACITY belongs to the PROJECT. Set FEMA to 60% on plan A → reload → still 60%; open plan B of the SAME
 * project → 60%; a plan in ANOTHER project → the layer's default. On/off stays per plan (B is not switched on by A).
 *
 * Signed out here, so this exercises the device copy (the same store the signed-in path uses, minus the server row — the cloud half is driven
 * live by ui-audit verify-layer-opacity-per-project-live). Red on 793f75e0, where opacity was session-only and every plan opened at the default. */
import { test, expect } from "@playwright/test";
import { panelSel, openPlannerLayers, openRowMenu } from "./lib/layersPanel.js";

const HOU = { lat: 29.76, lon: -95.37 };
const mk = (id, group, name) => ({
  schemaVersion: 12, id, groupId: group, site: group === "gpA" ? "Opacity Project One" : "Opacity Project Two", name,
  updatedAt: 1783000000000, teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: HOU.lat, lon: HOU.lon }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
});
const SITES = { opA: mk("opA", "gpA", "Concept A"), opB: mk("opB", "gpA", "Concept B"), opC: mk("opC", "gpC", "Elsewhere") };

/* The route's id is the PROJECT (group); which plan of it opens is the remembered current plan, so a spec picks the plan by setting that. */
async function open(page, id, { seed = false } = {}) {
  const group = SITES[id].groupId;
  if (seed) {
    await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
    await page.route(/hazards\.fema\.gov/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ currentVersion: 11, name: "NFHL", layers: [{ id: 27 }, { id: 28 }] }) }));
    await page.addInitScript((j) => { try { if (!localStorage.getItem("planarfit:sites:v1")) localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify(SITES));
    await page.setViewportSize({ width: 1280, height: 860 });
  }
  await page.goto(`/#/project/${group}/site`, { waitUntil: "load" });
  await page.evaluate((i) => localStorage.setItem("planarfit:currentSite:v1", i), id);
  await page.reload({ waitUntil: "load" });
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(1200);
  await openPlannerLayers(page);
  await page.locator(panelSel("planner")).first().waitFor({ state: "visible", timeout: 20000 });
}
const femaBox = async (page) => (await openRowMenu(page, "fema", { surface: "planner" })).locator('input[type="text"]').first();
const femaPct = async (page) => (await femaBox(page)).inputValue();
const femaOn = (page) => page.evaluate(() => (window.__plannerLayers?.().on || []).includes("fema"));

test("a layer's opacity is the PROJECT's: survives a reload, shows on a sibling plan, leaves another project alone", async ({ page }) => {
  await open(page, "opA", { seed: true });
  const defaultPct = await femaPct(page);
  expect(defaultPct, "FEMA starts at its own default, not 60").not.toBe("60");

  await (await femaBox(page)).fill("60");
  await expect.poll(() => femaPct(page)).toBe("60");
  await page.waitForTimeout(1200); // past the trailing write

  // reload plan A → still 60%
  await open(page, "opA");
  await expect.poll(() => femaPct(page), { message: "plan A after a reload" }).toBe("60");

  // sibling plan B of the SAME project → 60% (its own on/off is untouched)
  await open(page, "opB");
  await expect.poll(() => femaPct(page), { message: "sibling plan B of the same project" }).toBe("60");
  expect(await femaOn(page), "opacity is shared; on/off stays per plan").toBe(false);

  // a plan in a DIFFERENT project → the default
  await open(page, "opC");
  await expect.poll(() => femaPct(page), { message: "a plan in another project" }).toBe(defaultPct);
});

test("changing it on the SIBLING changes it for the first plan too (one value per project, last change wins)", async ({ page }) => {
  await open(page, "opA", { seed: true });
  await (await femaBox(page)).fill("60");
  await page.waitForTimeout(1200);
  await open(page, "opB");
  await (await femaBox(page)).fill("35");
  await expect.poll(() => femaPct(page)).toBe("35");
  await page.waitForTimeout(1200);
  await open(page, "opA");
  await expect.poll(() => femaPct(page), { message: "plan A sees B's change" }).toBe("35");
});
