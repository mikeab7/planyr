/* 2026-11-24 — a plotted deed (metes and bounds) (1) opens its Properties on a double-click EVEN WHEN LOCKED (Unlock lives there,
 * like a locked measurement) and (2) can be converted to an ordinary overlay (hide it in Overlays) and back. Real canvas, throwaway seeded plan. */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const CALLS = [{ label: "a", az: 90, distFt: 600 }, { label: "b", az: 180, distFt: 400 }, { label: "c", az: 270, distFt: 600 }, { label: "d", az: 0, distFt: 400 }];
const ring = [{ x: 0, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 500 }, { x: 0, y: 500 }];
const ID = "e2eDeedOverlay";
const REC = {
  id: ID, groupId: ID, site: "Deed overlay", name: "Concept A", origin: null, county: null, parcels: [], els: [], measures: [], callouts: [],
  markups: [{ id: "mkA", kind: "encumbrance", pts: ring, centerline: [...ring, ring[0]], closed: true, calls: CALLS, label: "Tract 1", deedGroup: "gA", except: false, stroke: "#7c3aed", fill: "#7c3aed", fillOpacity: 0.14, weight: 2, dash: "solid", locked: true }],
  sheetOverlays: [], settings: {}, updatedAt: Date.now(),
};
const rec = (page) => page.evaluate((sid) => JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}")[sid] || null, ID);

test("locked deed opens its panel on double-click; convert to overlay and back", async ({ page }) => {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(([sid, r]) => {
    if (localStorage.getItem("e2e:seeded:" + sid)) return;
    localStorage.setItem("e2e:seeded:" + sid, "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: r }));
    localStorage.setItem("planarfit:currentSite:v1", sid);
  }, [ID, REC]);
  await page.goto("/");
  await openModule(page, "site-planner");
  await expect.poll(() => page.locator('[data-feature="markup:mkA"]').count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.getByRole("button", { name: "×" }).first().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(500);

  const box = await page.locator('[data-feature="markup:mkA"] polygon[data-testid]').first().boundingBox();
  const x = box.x + box.width * 0.25, y = box.y + box.height * 0.75;
  await page.mouse.click(x, y); await page.waitForTimeout(250); await page.mouse.click(x, y, { clickCount: 2 });
  await expect(page.getByTestId("deed-inspector")).toBeVisible({ timeout: 20_000 });   // LOCKED, and it still opens

  // And a double-click a few pixels OUTSIDE the thin outline (the fat grab band every closed markup has) still finds the deed.
  await page.getByTestId("deed-inspector").getByRole("button", { name: "Unlock" }).click();
  await page.mouse.click(5, 5); await page.waitForTimeout(400);
  const left = await page.evaluate(() => { const p = document.querySelector('[data-feature="markup:mkA"] polygon[data-testid]'); const m = p.getScreenCTM(); const [[x0, y0], , , [x3, y3]] = p.getAttribute("points").split(" ").map((s) => s.split(",").map(Number)); return { x: m.a * x0 + m.e - 3, y: m.d * ((y0 + y3) / 2) + m.f }; });
  await page.mouse.click(left.x, left.y); await page.waitForTimeout(250); await page.mouse.click(left.x, left.y, { clickCount: 2 });
  await expect(page.getByTestId("deed-inspector")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("deed-to-overlay").click();
  await expect.poll(async () => ((await rec(page))?.sheetOverlays || []).length, { timeout: 20_000 }).toBe(1);
  await expect.poll(async () => ((await rec(page))?.markups || []).length).toBe(0);
  const o = (await rec(page)).sheetOverlays[0];
  expect(o.fromDeed.markups[0].label).toBe("Tract 1");
  expect(o.name).toBe("Tract 1 (deed)");
  expect(o.visible).not.toBe(false);
  expect(o.x).toBeLessThan(0); expect(o.y).toBeLessThan(100);                       // top-left sits just outside the deed's corner
  expect(Math.abs(o.imgW * o.ftPerPx - 600)).toBeLessThan(40);                       // the picture spans the deed (plus a margin)
  await expect(page.locator('[data-feature="markup:mkA"]')).toHaveCount(0);

  // Back: the overlay row's ⋯ menu.
  await page.locator('[data-testid^="reference-more-"]').first().click();
  await page.getByRole("menuitem", { name: "Convert back to deed" }).click();
  await expect.poll(async () => ((await rec(page))?.sheetOverlays || []).length, { timeout: 20_000 }).toBe(0);
  await expect.poll(async () => ((await rec(page))?.markups || []).filter((m) => m.kind === "encumbrance").length).toBe(1);
  const back = (await rec(page)).markups[0];
  expect(back.id).not.toBe("mkA");        // a NEW id (the old one was tombstoned)
  expect(back.calls).toHaveLength(4);     // courses came back
  expect(back.locked).toBeFalsy();
});
