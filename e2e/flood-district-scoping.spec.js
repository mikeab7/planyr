/* The Flood & drainage group must never name the WRONG governing district (B1091(×2)).
 *
 * The report, minutes after B1091 merged: at the Tsakiris tract (Waller County, inside the
 * Brookshire–Katy Drainage District) every BKDD row carried the note "Brookshire–Katy
 * Drainage District doesn't govern drainage at this site — Harris County Flood Control
 * District does", while the HCFCD row carried none. That is the exact reverse of the truth,
 * and re-checked live 2026-07-29 against the agencies' own services: BKDD's boundary layer
 * returns n=1 "BROOKSHIRE-KATY DRAINAGE DISTRICT" at this point; HCFCD returns n=0, its
 * jurisdiction ending at the Harris County line. The panel used to say nothing here; B1091
 * made it assert the opposite, which is worse.
 *
 * This spec drives the REAL planner LOGGED OUT with the site's ACTUAL remembered drainage
 * check — copied from the production row (sites.id smrjdgmlinea, read 2026-07-29), including
 * the fact that it is a LEGACY snapshot with no `drainageDistrict` key and a
 * "bkdd-district-present" flag. No external GIS host is needed: the restored snapshot is the
 * whole input, which is what makes this checkable here rather than only on the live site.
 */
import { test, expect } from "@playwright/test";

const LAT = 29.77938, LON = -95.89503;

/* Verbatim shape of the remembered check stored on the real site: the boundary query
 * answered YES (the flag + the drainage-district overlay), but the snapshot predates the
 * field that records WHICH district — so hydration has to read the flag or the fact is lost
 * and a county guess fills the vacuum. */
const LAST_CHECK = {
  sig: "b1091x2-tsakiris",
  checkedAt: 1785000000000,
  authority: {
    primaryReviewerId: "waller",
    channelAuthority: null,
    flags: ["mud-district-present", "bkdd-district-present"],
    overlays: [
      { kind: "mud", name: "Brookshire Katy Drainage District", type: "Drainage District" },
      { kind: "drainage-district", id: "bkdd", name: "Brookshire–Katy Drainage District" },
    ],
    ambiguous: [],
    mudState: "loaded",
    jurisdiction: { city: ["Katy"], county: ["Waller"], etj: [], cityCentroid: [] },
  },
  flood: { zones: [{ zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD", staticBfeFt: null, vdatum: null }], state: "loaded", ageMs: 0 },
  channel: { near: null, state: "not-applicable" },
  watershed: null,
  groundElevFt: null,
  groundDatum: "NAVD88",
};

const SITE = {
  schemaVersion: 12, id: "b1091x2-scoping", groupId: "b1091x2-scoping",
  site: "B1091x2 District Scoping", name: "B1091x2 District Scoping",
  updatedAt: 1785000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT, lon: LON }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], els: [],
  settings: { drainage: { lastCheck: LAST_CHECK } },
};

test.describe("flood & drainage district scoping (B1091(×2))", () => {
  test("at a site inside BKDD, BKDD is listed and HCFCD is the one demoted", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route("**/*.jpg", (route) => route.abort()); // no aerial tiles in the sandbox

    await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
    await page.goto("/#/site-planner", { waitUntil: "load" });
    await page.getByText("B1091x2 District Scoping", { exact: false }).first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(900);

    await page.getByRole("button", { name: /Layers/ }).first().click();
    const groupHead = page.getByRole("button", { name: /(Show|Hide) Flood & drainage layers/ });
    await expect(groupHead).toBeVisible({ timeout: 10000 });
    if (await groupHead.getAttribute("aria-expanded") === "false") await groupHead.click();
    const panel = page.locator("body");

    // 1. THE INVERSION, pinned. This sentence must not exist anywhere on the panel.
    await expect(page.getByText(/Brookshire.{0,3}Katy Drainage District doesn.{0,3}t govern/i)).toHaveCount(0);

    // 2. All three district rows are listed in the open panel — not demoted behind the fold.
    for (const label of ["District streams, watersheds & BFE", "District drainage easements", "Master Plan floodplains & improvements"]) {
      await expect(page.getByRole("checkbox", { name: label, exact: true })).toBeVisible({ timeout: 10000 });
    }

    // 3. HCFCD and the City of Houston storm sewer are the ones that can't reach Waller —
    //    demoted behind the one collapsed line, each naming its own reason.
    const collapsed = page.getByRole("button", { name: /sources? that don't cover this site/i });
    await expect(collapsed).toBeVisible({ timeout: 10000 });
    await collapsed.click();
    await expect(panel.getByText(/Harris County Flood Control District doesn.{0,3}t cover Waller County/i).first()).toBeVisible();
    await expect(panel.getByText(/City of Houston.{0,3}s system doesn.{0,3}t reach Waller County/i).first()).toBeVisible();

    expect(errors, errors.join(" | ")).toHaveLength(0);
  });

  /* The same site with a STALE saved county — "harris", which is what the parcel-lookup
   * selector defaults to for every site until the county heal lands. Before B1091(×2) the flood
   * scoping reasoned over that selector, so "Harris → HCFCD" became a governing verdict and
   * suppressed all three BKDD rows with the inverted sentence. The identify county on the
   * remembered check still says Waller, and the district boundary still answered YES — the
   * panel must read the FACTS, not the selector. */
  test("a stale saved county can't flip the governing district", async ({ page }) => {
    const stale = { ...SITE, id: "b1091x2-stale", groupId: "b1091x2-stale", site: "B1091x2 Stale County", name: "B1091x2 Stale County", county: "harris" };
    await page.route("**/*.jpg", (route) => route.abort());
    await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [stale.id]: stale }));
    await page.goto("/#/site-planner", { waitUntil: "load" });
    await page.getByText("B1091x2 Stale County", { exact: false }).first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(900);

    await page.getByRole("button", { name: /Layers/ }).first().click();
    const groupHead = page.getByRole("button", { name: /(Show|Hide) Flood & drainage layers/ });
    await expect(groupHead).toBeVisible({ timeout: 10000 });
    if (await groupHead.getAttribute("aria-expanded") === "false") await groupHead.click();

    await expect(page.getByText(/Brookshire.{0,3}Katy Drainage District doesn.{0,3}t govern/i)).toHaveCount(0);
    for (const label of ["District streams, watersheds & BFE", "District drainage easements", "Master Plan floodplains & improvements"]) {
      await expect(page.getByRole("checkbox", { name: label, exact: true })).toBeVisible({ timeout: 10000 });
    }
  });

  /* (NEW-1/NEW-2) THE VISIBLE PANEL IS THE ONE UNDER TEST — and it must never be blank.
   *
   * A live pass reported the whole Flood & drainage group gone silent after B1091(×2): no
   * governing/not-governing note anywhere, and the Zone A sentence missing. Driving the real
   * planner with the tract's ACTUAL production snapshot (sites.id smrjdgmlinea, flood zones
   * X + A) shows the VISIBLE panel rendering all of it correctly — while the map finder,
   * which stays mounted (display:none) behind the planner so its map isn't rebuilt, holds a
   * second copy of the same group with no flood context, no site county, and therefore
   * nothing to say. That silent copy is FIRST in the document, so any page-level text scan
   * reads it instead. This test pins both halves: the live panel says everything, and the
   * hidden copy is out of the a11y tree and marked as the inactive mode. */
  test("the VISIBLE panel carries the zone verdict and the scoping reasons; the hidden copy is inert", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const real = {
      ...SITE, id: "new1-visible-panel", groupId: "new1-visible-panel",
      site: "NEW-1 Visible Panel", name: "NEW-1 Visible Panel",
      settings: { drainage: { lastCheck: { ...LAST_CHECK, sig: "new1-visible", flood: { state: "loaded", ageMs: 2470644, zones: [
        { zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD", staticBfeFt: null, vdatum: null },
        { zone: "A", subtype: null, staticBfeFt: null, vdatum: null },
      ] } } } },
    };
    await page.route("**/*.jpg", (route) => route.abort());
    await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [real.id]: real }));
    await page.goto("/#/site-planner", { waitUntil: "load" });
    await page.getByText("NEW-1 Visible Panel", { exact: false }).first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(900);

    await page.getByRole("button", { name: /Layers/ }).first().click();
    const live = page.locator('[data-testid="layer-panel"][data-surface="planner"]');
    await expect(live).toBeVisible({ timeout: 10000 });
    const groupHead = live.getByRole("button", { name: /(Show|Hide) Flood & drainage layers/ });
    if (await groupHead.getAttribute("aria-expanded") === "false") await groupHead.click();

    /* 1. The single most useful line in the panel — the zone-specific SFHA sentence.
     *
     * ⛔ COPY UPDATED 2026-08-08 (B276449). This asserted, verbatim:
     *     "FEMA effective FIRM: Zone A — a special flood hazard area IS mapped here."
     * B1236 (commit e82f0ce0, merged 0c141cb5, PR #884, 2026-07-30) deliberately re-shaped every
     * FEMA verdict so THE ANSWER LEADS and FEMA's code follows as provenance — the owner report
     * behind it was a Johnstown, CO site where the layer read "Type: X" and drew nothing, which is
     * a correct answer nobody could use. `femaZoneVerdict` moved to lib/floodZoneCopy.js in the
     * same change and now composes `${headline} — ${short}.`, so the zone letter is still named and
     * the SFHA fact is still stated — in the opposite order, with the regulatory meaning spelled
     * out. NOT a regression: the zone verdict was never lost, only rewritten. This spec was the
     * only caller still pinned to the pre-B1236 wording, which is why it went red in both lanes.
     *
     * The seeded snapshot is zones X + A, so Zone A (the SFHA) must win the headline — that is the
     * load-bearing half and it is asserted as text, not as a substring match. */
    await expect(live.getByTestId("flood-fema-verdict")).toHaveText(
      "100-year floodplain · FEMA Zone A — a mapped Special Flood Hazard Area — the regulatory 1%-annual-chance floodplain.",
      { timeout: 10000 });
    // …and the facts ARE in hand, so the not-checked state stays quiet.
    await expect(live.getByTestId("flood-facts-note")).toHaveCount(0);

    // 2. The scoping reasons are there, on the rows they explain.
    const collapsed = live.getByRole("button", { name: /sources? that don't cover this site/i });
    await expect(collapsed).toBeVisible({ timeout: 10000 });
    await collapsed.click();
    await expect(live.getByText(/Harris County Flood Control District doesn.{0,3}t cover Waller County/i)).toBeVisible();

    // 3. The keep-alive copy: same component, no facts — so it says the honest thing rather
    //    than nothing, and it is out of the accessibility tree entirely.
    const finder = page.locator('[data-testid="layer-panel"][data-surface="finder"]');
    await expect(finder).toHaveCount(1);
    await expect(finder).toBeHidden();
    await expect(page.locator('[data-mode="map"][data-mode-active="false"][aria-hidden="true"]')).toHaveCount(1);
    await expect(page.locator('[data-mode="plan"][data-mode-active="true"]')).toHaveCount(1);
    expect(await finder.getByTestId("flood-facts-note").first().textContent()).toMatch(/not checked here yet/i);

    expect(errors, errors.join(" | ")).toHaveLength(0);
  });
});
