/* B2090352 amendment (NEW-1) — merge-pick mode must pick LOCKED parcels by a click on the canvas.
 * County lots arrive `locked:true`. The pick handler skipped locked parcels (`!pc.locked`) on the body press, and the
 * boundary press returned into the locked-parcel pan branch before reaching the merge-pick line — so in "Combine
 * parcels" mode every canvas click on a county lot left the banner at "0 picked" while the Land list row picked at once.
 * The earlier merge specs seeded `locked:true` but only ever picked through the LIST rows, which is why nothing saw it.
 * This one presses the canvas itself, on locked parcels, and then merges. */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const canvas = (page) => page.locator('[data-testid="planner-canvas"]');
const RECT_A = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
const RECT_B = [{ x: 200, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 }, { x: 200, y: 100 }];
const ID = "e2eMergePickLocked";
const rec = {
  id: ID, groupId: ID, site: "Merge Pick Locked", name: "Concept A", origin: null, county: null,
  parcels: [{ id: "pA", points: RECT_A, active: true, locked: true }, { id: "pB", points: RECT_B, active: true, locked: true }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, updatedAt: Date.now(),
};

test("canvas clicks pick locked parcels in merge-pick mode, and the merge completes", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(([sid, r]) => {
    if (localStorage.getItem("e2e:seeded:" + sid)) return;
    localStorage.setItem("e2e:seeded:" + sid, "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: r }));
    localStorage.setItem("planarfit:currentSite:v1", sid);
  }, [ID, rec]);
  await page.goto("/");
  await openModule(page, "site-planner");
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-rail-tab="parcel"]').click();
  await expect(page.getByTestId("parcel-row-pA")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("rail-parcel-tools").click();
  await page.getByRole("button", { name: /^Combine parcels/ }).click();
  await expect(page.getByText(/0 picked/)).toBeVisible();

  await page.getByLabel("Zoom to fit").click();
  await page.waitForTimeout(600); // let the fit settle before reading geometry
  // Centre of each parcel's own painted outline, in screen space — a real press on the canvas, not on a list row.
  const centre = async (id) => {
    const box = await page.locator(`[data-feature="parcel:${id}"]`).first().boundingBox();
    expect(box, `parcel ${id} is painted`).toBeTruthy();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const a = await centre("pA");
  await page.mouse.click(a.x, a.y);
  await expect(page.getByText(/Click parcels to merge — 1 picked/)).toBeVisible();
  await expect(page.getByTestId("parcel-row-pA")).toHaveAttribute("aria-pressed", "true");
  const b = await centre("pB");
  await page.mouse.click(b.x, b.y);
  await expect(page.getByText(/2 parcels picked/)).toBeVisible();

  await page.getByRole("button", { name: /Merge parcels ⏎/i }).click();
  await expect.poll(async () => (await page.evaluate((sid) => JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}")[sid]?.parcels?.length, ID))).toBe(1);
  expect(errors, errors.join("\n")).toEqual([]);
});
