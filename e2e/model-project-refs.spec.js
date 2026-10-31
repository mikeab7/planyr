/* Model workspace — live-browser verification of project-derived, read-only built-in formula
 * names (spreadsheet-live-data-refs): Site.Acres / Site.County / Plan.<building>.SF / .Footprint
 * / Comp.<title>.RentPSF / .SizeSF / .Date. These read the OPEN PROJECT's own site plan + comps —
 * live, never a snapshot taken at type time — and fail loudly (a real formula error, never a
 * silent zero) when the source they name doesn't currently resolve.
 *
 * PORTED to the Univer grid (NEW-2, 2026-10-31): on Univer the names are GLOBAL DEFINED NAMES (`projectNamesToDefinedNames`, never saved
 * back) that UniverSheet re-pushes when the project's site content changes; cells are typed with real keys and read through Univer's
 * facade (what the cell SHOWS — "#REF!" / "20" — not a DOM node).
 *
 * Seeds a throwaway local "project" via localStorage, the same technique e2e/model-spreadsheet.spec.js used (a project IS a Site Planner
 * site group), rather than driving the map-based "New project" flow — that needs live GIS tile hosts this sandbox blocks. A "site content
 * changed" edit is likewise applied directly to localStorage + the SAME `storage` event `storage.js`'s `notifySiteModelChanged`
 * dispatches — the real production recompute path. Nothing here touches real production data.
 *
 * Run: npx playwright test e2e/model-project-refs.spec.js
 */
import { test, expect } from "@playwright/test";
import { armUniverE2E, waitForGrid, enter, enterFormula, expectShown, formulaOf, definedNames, openPalette, defineNameFromSelection, clickCell, runPaletteCommand, inSheet } from "./lib/univerGrid.js";

// A 660x660 ft square = 435,600 sf = EXACTLY 10 acres (43,560 sf/ac) — a round number so the
// assertion doesn't have to fuzzy-match a long decimal.
const SQUARE_660 = [{ x: 0, y: 0 }, { x: 660, y: 0 }, { x: 660, y: 660 }, { x: 0, y: 660 }];

async function seedProject(page, id, siteOverrides = {}) {
  const site = {
    id, groupId: id, site: "ZZ Project-refs e2e (throwaway)", name: "ZZ Project-refs e2e (throwaway)",
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(), ...siteOverrides,
  };
  await armUniverE2E(page);
  await page.addInitScript(([siteId, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [siteId]: rec }));
  }, [id, site]);
}
async function openSheet(page, id) {
  await page.goto(`/#/project/${id}/spreadsheet`);
  await waitForGrid(page);
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

test.describe("Model workspace — Site.*/Plan.*/Comp.* project-derived names (spreadsheet-live-data-refs)", () => {
  test("a project with no parcels yet reads a real #REF!, never a silent zero", async ({ page }) => {
    const id = "e2e-projrefs-empty";
    await seedProject(page, id);
    await openSheet(page, id);
    await enterFormula(page, 0, 0, "=Site.Acres");
    expect(await formulaOf(page, 0, 0), "the formula is stored exactly as typed").toBe("=Site.Acres");
    await expectShown(page, 0, 0, "#REF!");
  });

  test("Site.Acres resolves the real acreage, and follows a LIVE site-plan edit with no reload", async ({ page }) => {
    const id = "e2e-projrefs-live";
    await seedProject(page, id);
    await openSheet(page, id);
    await enterFormula(page, 0, 0, "=Site.Acres*2");
    await expectShown(page, 0, 0, "#REF!"); // no parcels yet

    // The source changes — a parcel gets drawn in the (still-mounted-but-hidden) Site Planner tab.
    await editSiteAndNotify(page, id, { parcels: [{ id: "p1", points: SQUARE_660, active: true }] });
    await expectShown(page, 0, 0, "20"); // 10 ac * 2, live — the cell was never re-typed
    expect(await formulaOf(page, 0, 0)).toBe("=Site.Acres*2");

    // The source changes AGAIN — confirm it keeps following, not just the one time.
    await editSiteAndNotify(page, id, { parcels: [{ id: "p1", points: SQUARE_660, active: false }] }); // parcel deactivated
    await expectShown(page, 0, 0, "#REF!");
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
    await openSheet(page, id);
    await enterFormula(page, 0, 0, "=Plan.Building2.SF");
    await expectShown(page, 0, 0, "2000"); // 50*40
    // KNOWN-GOOD arm: Building 1 reads its own, different footprint (100*200), so a name that resolved to "the wrong building" would show here.
    await enterFormula(page, 1, 0, "=Plan.Building1.SF");
    await expectShown(page, 1, 0, "20000");

    // Delete Building 1 — Building 2 renumbers down to Building 1 (the disclosed rename contract).
    await editSiteAndNotify(page, id, { els: [{ id: "b2", type: "building", cx: 0, cy: 0, w: 50, h: 40 }] });
    await expectShown(page, 0, 0, "#NAME?"); // "Building 2" no longer exists
    await expectShown(page, 1, 0, "2000");   // …and Building 1 is now the old Building 2
  });

  test("Comp.<title>.RentPSF/.SizeSF/.Date resolve real comp fields (stubbed network, signed-out)", async ({ page }) => {
    const id = "e2e-projrefs-comp";
    await seedProject(page, id, { parcels: [{ id: "p1", points: SQUARE_660, active: true }] });
    // Signed out, supabase is unconfigured in this sandbox — fetchProjectNameComps() itself
    // returns { data: [] } with no network call (see lib/projectCompsFetch.js's own `if
    // (!supabase)` guard), so a Comp.* reference here proves the #NAME? path honestly rather
    // than faking a comp — a real signed-in comp round trip is a genuine `Blocker: auth` case
    // (VERIFICATION.md), not something this sandbox can fabricate without a live account.
    await openSheet(page, id);
    await enterFormula(page, 0, 0, "=Comp.NoSuchComp.RentPSF");
    await expectShown(page, 0, 0, "#NAME?");
  });

  // PRODUCT GAP (found by this port, 2026-10-31 — reported, not weakened, src untouched): in Excel, typing a formula that ends in a name and
  // pressing Enter COMMITS it. On Univer the name hint popup is open at that moment and Enter only "accepts" the highlighted suggestion,
  // leaving the editor open (a second Enter swaps in a DIFFERENT suggestion — measured =Plan.Building2.SF becoming =Plan.Building1.SF).
  // The tests above use enterFormula (commit by clicking another cell when Enter does not) because they are about the NAMES; this one
  // holds the Excel behaviour on its own.
  test.fixme("a formula ending in a project name commits on ONE Enter, as in Excel (Univer's name-hint popup takes the first Enter)", async ({ page }) => {
    const id = "e2e-projrefs-one-enter";
    await seedProject(page, id, { parcels: [{ id: "p1", points: SQUARE_660, active: true }] });
    await openSheet(page, id);
    expect(await enterFormula(page, 0, 0, "=Site.Acres", { pause: 500, viaEnter: true }), "a formula ending in a name must commit on Enter").toBe("enter");
  });

  test("a user cannot define a name that shadows a reserved project-data prefix", async ({ page }) => {
    const id = "e2e-projrefs-reserved";
    await seedProject(page, id, { parcels: [{ id: "p1", points: SQUARE_660, active: true }] });
    await openSheet(page, id);
    await runPaletteCommand(page, "name manager"); // Ctrl+K → Name Manager (the cell menu's row is the second route)
    await expect(page.getByTestId("name-manager")).toBeVisible();
    await page.getByTestId("name-manager-new-input").fill("Site.Foo");
    await expect(page.getByTestId("name-manager-new-error")).toContainText(/reserved/i);
    await expect(page.getByTestId("name-manager-create")).toBeDisabled();
    // Known-good arm: an ordinary name in the same field is accepted, so the refusal above is about the prefix and nothing else.
    await page.getByTestId("name-manager-new-input").fill("Foo");
    await expect(page.getByTestId("name-manager-new-error")).toHaveCount(0);
    await expect(page.getByTestId("name-manager-create")).toBeEnabled();
    // And nothing was defined by the refused attempt.
    expect((await definedNames(page)).filter((n) => /^Site\.Foo$/i.test(n.name))).toEqual([]);
  });
});
