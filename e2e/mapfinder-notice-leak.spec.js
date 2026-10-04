/* NEW-1 (B1462256, owner screenshot, 2026-09-10) — MapFinder's floating notices must never paint
 * over the Site Planner.
 *
 * Owner report: inside a project's planner (a building already drawn), the bottom-center banner
 * still showed the MAP's "+ Select parcels" guidance ("Click a lot on the map to add it (+)...").
 * Root cause: `MapFinder` stays MOUNTED when a project's planner is open (only its `visible` prop
 * goes false — `SitePlannerApp.jsx` hides its wrapper with `display:none`), and its notices render
 * through `FloatingNotice`, which portals to a host appended to `document.body` OUTSIDE that
 * wrapper — so `display:none` on the wrapper does nothing to hide a portaled notice. `selectMode`
 * was reset only on RETURNING to the map, never on LEAVING it, so a select-parcels session left
 * running kept rendering its tip straight through the flip into the planner.
 *
 * This drives the REAL render path, logged out, no external GIS (the toolbar's Select-parcels
 * toggle and opening an already-seeded local site are both purely client-side — ATTEMPT-BEFORE-
 * YOU-PARK: this check needs neither an account nor a live GIS host, so it is not deferred to a
 * live pass).
 *
 * ⛔ A REAL, UNRELATED CONFOUND MEASURED WHILE BUILDING THIS CHECK, worth recording so a future
 * session doesn't rediscover it the hard way: on THIS bug's pre-fix code, the tip ALSO disappears
 * on its own after ~7-8s, independent of anything this item touches — the map's blocked-GIS-probe
 * `err` state shares the exact same render slot as the tip (`!err && selectMode`, an existing,
 * documented, out-of-scope design also called out in e2e/notification-position.spec.js), and this
 * sandbox's egress-blocked GIS hosts eventually flip `err` true on their own client-side timeout.
 * A naive `expect(tip).toHaveCount(0)` with this repo's default 10s retry window happily waits out
 * that unrelated timeout and reports a false PASS on unfixed code — measured directly (raw
 * Playwright script against the pre-fix build: tip count stayed 1 through +7s, dropped to 0 at
 * +8s, with NO navigation involved at all). The fix here is a SHORT explicit timeout on the
 * post-navigation assertion, well inside that window, so this check can only pass by observing
 * the real fix (an immediate, synchronous clear on the mode flip) — never by outwaiting `err`.
 */
import { test, expect } from "@playwright/test";

const W = 12000, H = 9000;
const site = {
  schemaVersion: 12, id: "nl1", groupId: "nl1", site: "Notice Leak", name: "Concept A",
  updatedAt: 1786000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: 29.9038, lon: -95.9769 }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], active: true, z: 0 }],
  els: [], measures: [], callouts: [], markups: [], sheetOverlays: [], parcelDrawings: [],
  underlay: null, settings: {},
};

async function openMapWithSeededSite(page) {
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript((s) => {
    try {
      localStorage.removeItem("planarfit:currentSite:v1");
      localStorage.setItem("planarfit:sites:v1", s);
    } catch (_) {}
  }, JSON.stringify({ [site.id]: site }));
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await expect(page.getByTestId("map-toolbar-draw")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500); // let the Leaflet map + layer probes settle
}

test.describe("NEW-1 (B1462256) — a map-mode notice must not survive the flip into a project's planner", () => {
  test("the select-parcels tip disappears the moment a project's planner opens, well before the unrelated err-state timeout could explain it", async ({ page }) => {
    await openMapWithSeededSite(page);

    // Arm select-parcels mode on the map — no parcel click needed, this is a pure UI toggle.
    await page.getByTestId("map-toolbar-select-parcels").click();
    const tip = page.getByTestId("select-parcels-tip");
    await expect(tip, "the select-parcels tip must show while actively selecting on the map").toBeVisible();

    // Open the seeded project's planner WITHOUT ever turning select-parcels mode off by hand —
    // this is exactly the owner's sequence (armed the map, then just opened a project). This
    // happens within ~1-2s of arming select mode, well inside the ~7-8s unrelated `err` window
    // measured above.
    await page.getByText("Notice Leak", { exact: false }).first().click();
    await expect(page.getByTestId("planner-canvas"), "the project's planner must open").toBeVisible({ timeout: 25_000 });

    // The bug: MapFinder stays mounted (display:none) but its FloatingNotice portals outside that
    // hidden subtree, so the tip kept rendering over the planner. It must be gone from the DOM
    // entirely, not just visually hidden by an ancestor — and gone FAST (a capped 2s retry, far
    // short of the unrelated ~7-8s `err` timeout measured above), so this can only pass by
    // observing the real, immediate fix.
    await expect(tip, "the select-parcels tip must not survive into the planner — it painted over " +
      "a drawn building in the owner's report").toHaveCount(0, { timeout: 2_000 });
  });
});

/* NEW-1 (B2041360, owner iPhone screenshot, 2026-10-03) — the SAME portal leak, one flip over.
 * Leaving the Site WORKSPACE (Dashboard, Schedule, Review, Library, Notes, Spreadsheet) keeps
 * MapFinder mounted with `visible` still true, so a select-parcels session armed on the map kept
 * painting its "Click any lot on the map…" tip over the other module. The state is deliberately
 * kept (peeking at another tab must not wipe a parcel selection) — only the RENDER is gated on
 * `isActive`. Short explicit timeout for the same reason as above (the unrelated `err` timeout).
 */
test.describe("NEW-1 (B2041360) — a Site-map hint must not survive leaving the Site workspace", () => {
  for (const [label, hash] of [["Dashboard", "#/"], ["Schedule", "#/schedule"], ["Review", "#/markup"],
    ["Library", "#/library"], ["Notes", "#/notes"], ["Spreadsheet", "#/spreadsheet"]]) {
    test(`select-parcels tip is gone on ${label}`, async ({ page }) => {
      await openMapWithSeededSite(page);
      await page.getByTestId("map-toolbar-select-parcels").click();
      const tip = page.getByTestId("select-parcels-tip");
      await expect(tip).toBeVisible();

      await page.evaluate((h) => { window.location.hash = h; }, hash);
      await expect(page.getByTestId("map-toolbar-draw"), "the Site map must no longer be on screen").toBeHidden({ timeout: 15_000 });
      await expect(tip, `the Site-map tip must not paint over ${label}`).toHaveCount(0, { timeout: 2_000 });
      await expect(page.locator('[data-floating-notice="1"]').filter({ hasText: /Click (any|a) lot on the map/ })).toHaveCount(0);
    });
  }
});
