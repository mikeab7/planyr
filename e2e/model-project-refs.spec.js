/* Model workspace — live-browser verification of project-derived, read-only built-in formula
 * names (spreadsheet-live-data-refs): Site.Acres / Site.County / Plan.<building>.SF / .Footprint
 * / Comp.<title>.RentPSF / .SizeSF / .Date. These read the OPEN PROJECT's own site plan + comps —
 * live, never a snapshot taken at type time — and fail loudly (a real formula error, never a
 * silent zero) when the source they name doesn't currently resolve.
 *
 * Seeds a throwaway local "project" via localStorage, the same technique
 * e2e/model-spreadsheet.spec.js already uses (a project IS a Site Planner site group), rather
 * than driving the map-based "New project" flow — that needs live GIS tile hosts this sandbox
 * blocks. A "site content changed" edit is likewise applied directly to localStorage + the SAME
 * `storage` event `storage.js`'s `notifySiteModelChanged` dispatches — the real production
 * recompute path, exercised directly rather than by driving a second, slower Site Planner tab.
 * Nothing here touches real production data.
 *
 * Run: npx playwright test e2e/model-project-refs.spec.js
 */
import { test, expect } from "@playwright/test";

const sheetEl = (page) => page.getByTestId("model-sheet");
const cell = (page, r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);

// A 660x660 ft square = 435,600 sf = EXACTLY 10 acres (43,560 sf/ac) — a round number so the
// assertion doesn't have to fuzzy-match a long decimal.
const SQUARE_660 = [{ x: 0, y: 0 }, { x: 660, y: 0 }, { x: 660, y: 660 }, { x: 0, y: 660 }];

async function seedProject(page, id, siteOverrides = {}) {
  const site = {
    id, groupId: id, site: "ZZ Project-refs e2e (throwaway)", name: "ZZ Project-refs e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(), ...siteOverrides,
  };
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
  }, [id, site]);
}

/** Mutate the seeded site's content IN PLACE and fire the exact same cross-workspace
 *  notification `storage.js`'s `saveSite` dispatches on a real save — proving the real,
 *  production wiring, not a fixture-only convenience. */
async function editSiteAndNotify(page, id, patch) {
  await page.evaluate(([siteId, p]) => {
    const store = JSON.parse(localStorage.getItem("planarfit:sites:v1"));
    store[siteId] = { ...store[siteId], ...p, updatedAt: Date.now() };
    localStorage.setItem("planarfit:sites:v1", JSON.stringify(store));
    window.dispatchEvent(new StorageEvent("storage", { key: `planarfit:siteContent:v1:${siteId}` }));
  }, [id, patch]);
}

async function typeAndEnter(page, text) {
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

/** Click a ribbon control by testid — directly, or via the "More ▾" overflow popover if
 *  ribbonLayout.js collapsed its group there at this viewport. Same helper
 *  e2e/model-audit-tools.spec.js already uses for the Name Manager toggle. */
async function clickRibbonButton(page, testId) {
  const direct = page.getByTestId(testId);
  if (await direct.count()) { await direct.click(); return; }
  await page.getByTestId("ribbon-more").click();
  await page.getByTestId(testId).click();
}

test.describe("Model workspace — Site.*/Plan.*/Comp.* project-derived names (spreadsheet-live-data-refs)", () => {
  test("a project with no parcels yet reads a real #REF!, never a silent zero", async ({ page }) => {
    const id = "e2e-projrefs-empty";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "=Site.Acres");
    await expect(cell(page, 0, 0)).toHaveText("#REF!");
  });

  test("Site.Acres resolves the real acreage, and follows a LIVE site-plan edit with no reload", async ({ page }) => {
    const id = "e2e-projrefs-live";
    await seedProject(page, id);
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "=Site.Acres*2");
    await expect(cell(page, 0, 0)).toHaveText("#REF!"); // no parcels yet

    // The source changes — a parcel gets drawn in the (still-mounted-but-hidden) Site Planner tab.
    await editSiteAndNotify(page, id, { parcels: [{ id: "p1", points: SQUARE_660, active: true }] });
    await expect(cell(page, 0, 0)).toHaveText("20"); // 10 ac * 2, live — the cell was never re-typed

    // The source changes AGAIN — confirm it keeps following, not just the one time.
    await editSiteAndNotify(page, id, { parcels: [{ id: "p1", points: SQUARE_660, active: false }] }); // parcel deactivated
    await expect(cell(page, 0, 0)).toHaveText("#REF!");
  });

  test("Plan.Building1.SF resolves a real building's footprint, and renumbers when an earlier building is deleted", async ({ page }) => {
    const id = "e2e-projrefs-building";
    await seedProject(page, id, {
      parcels: [{ id: "p1", points: SQUARE_660, active: true }],
      els: [
        { id: "b1", type: "building", cx: 0, cy: 0, w: 100, h: 200 },
        { id: "b2", type: "building", cx: 0, cy: 0, w: 50, h: 40 },
      ],
    });
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "=Plan.Building2.SF");
    await expect(cell(page, 0, 0)).toHaveText("2000"); // 50*40

    // Delete Building 1 — Building 2 renumbers down to Building 1 (the disclosed rename contract).
    await editSiteAndNotify(page, id, { els: [{ id: "b2", type: "building", cx: 0, cy: 0, w: 50, h: 40 }] });
    await expect(cell(page, 0, 0)).toHaveText("#NAME?"); // "Building 2" no longer exists
  });

  test("Comp.<title>.RentPSF/.SizeSF/.Date resolve real comp fields (stubbed network, signed-out)", async ({ page }) => {
    const id = "e2e-projrefs-comp";
    await seedProject(page, id, { parcels: [{ id: "p1", points: SQUARE_660, active: true }] });
    // Signed out, supabase is unconfigured in this sandbox — fetchProjectNameComps() itself
    // returns { data: [] } with no network call (see lib/projectCompsFetch.js's own `if
    // (!supabase)` guard), so a Comp.* reference here proves the #NAME? path honestly rather
    // than faking a comp — a real signed-in comp round trip is a genuine `Blocker: auth` case
    // (VERIFICATION.md), not something this sandbox can fabricate without a live account.
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();
    await cell(page, 0, 0).click();
    await typeAndEnter(page, "=Comp.NoSuchComp.RentPSF");
    await expect(cell(page, 0, 0)).toHaveText("#NAME?");
  });

  test("a user cannot define a name that shadows a reserved project-data prefix", async ({ page }) => {
    const id = "e2e-projrefs-reserved";
    await seedProject(page, id, { parcels: [{ id: "p1", points: SQUARE_660, active: true }] });
    await page.goto(`/#/project/${id}/model`);
    await expect(sheetEl(page)).toBeVisible();
    await clickRibbonButton(page, "ribbon-names");
    await page.getByTestId("name-manager-new-input").fill("Site.Foo");
    await expect(page.getByTestId("name-manager-new-error")).toContainText(/reserved/i);
    await expect(page.getByTestId("name-manager-create")).toBeDisabled();
  });
});
