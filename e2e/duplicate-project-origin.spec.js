/* B1399568 — "Planning a site on ground that already has a project mints a second project."
 *
 * Production repro: a single account minted TWO projects 51 seconds apart at byte-identical
 * origin coordinates via the map's "Start blank" path. Two mechanisms fix it — see
 * projectModel.js's findProjectAtOrigin (FINDING A, ADOPT instead of mint) and MapFinder.jsx's
 * startBlankHereBusyRef/decideBusyRef (FINDING B, an in-flight guard). FINDING A is exhaustively
 * unit-tested in test/duplicateProjectOrigin.test.js against the exact production coordinates
 * (proven RED on unfixed code before GREEN on the fix) — an end-to-end proof of it here would
 * need two genuinely SEPARATE visits landing on the same ground, and this sandbox has no reliable
 * way to drive that: real parcel selection needs live GIS (every county host is egress-blocked
 * here), and the map's own re-landing between visits (landingView.js's single-site fit) does NOT
 * reproduce a byte-identical or even near-identical origin — measured directly, it can land the
 * map centre well outside findProjectAtOrigin's SAME_GROUND_FT tolerance. A SEPARATE, unrelated
 * bug was also found while probing this (see the NOTICED note below) that blocks a scripted
 * "return to map, same session" route too.
 *
 * What IS reliably provable live, headless, right here, is FINDING B: `startBlankHere` awaits a
 * county lookup (up to 3s) before it ever hands off to `newBlankSite`, which itself awaits a team
 * resolution before writing — a real, multi-second window during which the "Draw" button stays on
 * screen, live and clickable, with nothing yet indicating a plan is being created. Two presses
 * fired back-to-back while that button is still visible land INSIDE that window, before the first
 * press's own `saveSite` has run — the in-flight guard (`startBlankHereBusyRef`), not the
 * ground-adopt check, is what has to catch this one, and it's exactly the shape this spec drives.
 *
 * ⛔ NOTICED, NOT CHASED, NOT THIS ITEM'S — a genuine, separate navigation bug found while
 * building this spec: clicking the Site Planner header's "Map" breadcrumb (AppHeader's
 * `onDashboard` → SitePlannerApp's `goMap`) right after creating a brand-new project does NOT
 * leave the plan — the header still shows the just-created project's breadcrumb chips
 * afterward, and the map toolbar never becomes visible. This reads as the same class of bounce-
 * back SitePlannerApp.jsx's own B881664 comments describe (a route-effect re-asserting the
 * project before the mode switch has fully settled), on a path B881664's own fix apparently
 * doesn't cover. Not investigated further and not folded into this fix — unrelated to duplicate
 * project creation, and STANDING RULE #3 says one task per session. Worth its own item if picked
 * up: repro is "create a new project via 'Start blank', then click the header's Map crumb."
 */
import { test, expect } from "@playwright/test";

async function openMap(page) {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(() => {
    localStorage.removeItem("planarfit:currentSite:v1");
    localStorage.setItem("planarfit:sites:v1", "{}");
  });
  // NOT "/#/" — the bare route lands on the Dashboard workspace (measured in this sandbox; the
  // pre-existing e2e/parcel-outage-fallback.spec.js's identical `page.goto("/#/")` fails the same
  // way, unrelated to this item), so the map needs the Site Planner's own route directly.
  await page.goto("/#/site");
  await expect(page.getByTestId("map-toolbar-draw")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500); // let the Leaflet map and its layer probes settle
}

const sitesInStore = (page) => page.evaluate(() => JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))("planarfit:sites:v1") || "{}"));

test.describe("B1399568 · FINDING B — the decide bar / 'Draw' button guards against an in-flight double-press", () => {
  test("two RAPID 'Draw' presses, before the first has finished, still yield ONE project", async ({ page }) => {
    await openMap(page);
    expect(Object.keys(await sitesInStore(page))).toHaveLength(0);

    const draw = page.getByTestId("map-toolbar-draw");
    // Fired back-to-back with no wait for the first press's own async work (county lookup, then
    // newBlankSite's team resolution) to finish — the button is still visible/enabled through all
    // of it, which is exactly the reported hole. If the in-flight guard is missing, the second
    // click re-enters startBlankHere before the first one's saveSite has run.
    await draw.click();
    await draw.click();

    await expect(page.locator('[data-testid="planner-canvas"]')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => Object.keys(await sitesInStore(page)).length, { timeout: 20_000 }).toBe(1);
    // Hold a beat — a would-be second write landing late must not sneak in after the poll above.
    await page.waitForTimeout(1500);
    expect(Object.keys(await sitesInStore(page))).toHaveLength(1);
  });
});
