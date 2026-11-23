/* Detached landscaping buffer (owner report 2026-11-23, Goose Creek › PII - TAS R2, Building 2).
 *
 * ROOT CAUSE: the Car Parking Properties "Stall depth / Stall width / Drive aisle" boxes
 * (`setParkCfg`) resized a wall-bonded parking field outward but, unlike the "+ / −" row ladder
 * (`growParking`), never repacked the flush layers beyond it (buffer / road / trailer row). A buffer
 * placed flush against the parking was therefore left floating when the field got deeper or shallower.
 * FIX: `setParkCfg` now runs the same relayoutWallKids + repackFlushBeyond step.
 *
 * Logged out, local storage only. Verify: sandbox.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, openModule } from "./helpers.js";

const SITE_ID = "e2e-side-park-cfg-buffer";
const HOST = "hostB", PAD = "padP", BUF = "bufB";
const B = { id: HOST, type: "building", cx: 5000, cy: 5000, w: 400, h: 200, rot: 0, dock: "both" };
const PAD_EL = { id: PAD, type: "parking", cx: B.cx - B.w / 2 - 30, cy: B.cy, w: 200, h: 60, rot: 90, attachedTo: HOST, sideParkSide: "left" };
const BUF_EL = { id: BUF, type: "landscape", buffer: true, cx: B.cx - B.w / 2 - 60 - 2.5, cy: B.cy, w: 5, h: 200, rot: 0, attachedTo: HOST };

const canvas = (p) => p.getByTestId("planner-canvas");
const readEl = (page, id) => page.evaluate(({ key, siteId, id }) => {
  const rec = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))(key) || "{}")[siteId];
  return (rec.els || []).find((e) => e.id === id);
}, { key: "planarfit:sites:v1", siteId: SITE_ID, id });

test("changing the parking's drive aisle / stall depth keeps the buffer beyond it flush", async ({ page }) => {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Test", name: "Parking cfg repack", origin: null, county: "harris",
    parcels: [], els: [B, PAD_EL, BUF_EL], measures: [], callouts: [], markups: [],
    settings: { stallDepth: 18, aisle: 24 }, underlay: null, parcelDrawings: [], updatedAt: 1785500000000,
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await openModule(page, "site-planner");
  await expect(canvas(page)).toBeVisible({ timeout: 45000 });
  await expect.poll(() => page.locator(`[data-el-id="${PAD}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window.__plannerView ? 1 : 0)), { timeout: 20_000 }).toBe(1);
  await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 0.8), [B.cx, B.cy]);
  await page.waitForTimeout(150);

  const gap = async () => {
    const p = await readEl(page, PAD), b = await readEl(page, BUF);
    // parking outer face (west) vs buffer inner face (east): both axis-aligned here.
    return (p.cx - p.h / 2) - (b.cx + b.w / 2);
  };
  expect(Math.abs(await gap())).toBeLessThan(0.5);   // control: flush to start

  const box = await page.locator(`[data-el-id="${PAD}"]`).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);

  const setRow = async (label, value) => {
    const groups = await page.evaluate(() => [...document.querySelectorAll('div[data-field-group="1"]')].map((d) => d.querySelector("span")?.textContent));
    const i = groups.indexOf(label);
    expect(i, JSON.stringify(groups)).not.toBe(-1);
    const input = page.locator('div[data-field-group="1"]').nth(i).locator("input").first();
    await input.fill(String(value)); await input.press("Enter");
    await page.waitForTimeout(250);
  };

  await setRow("Drive aisle", 36);           // field gets deeper: 60 → 72
  expect((await readEl(page, PAD)).h).toBe(72);
  expect(Math.abs(await gap())).toBeLessThan(0.5);
  await setRow("Stall depth", 16);           // and shallower: 2*16+36 = 68
  expect((await readEl(page, PAD)).h).toBe(68);
  expect(Math.abs(await gap())).toBeLessThan(0.5);
});
