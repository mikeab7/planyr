/* B1865936 — "clicking the Map crumb intermittently returns to the site."
 *
 * ROOT CAUSE, confirmed by code reading AND live instrumented tracing (SitePlannerApp.jsx):
 * `goMap` sets `mode="map"` and `userLeftProjectRef.current = true`, but deliberately leaves
 * `activeSiteId` set (the Leaflet keep-alive optimization) — the URL still names the just-left
 * project (`#/project/<id>/site`) until effect (2) (state → URL) writes the clear, and that
 * write only reaches THIS mount's `projectId` prop once the browser's real `hashchange` event
 * (fired by Shell's route hook) has round-tripped back down — an async macrotask, not a
 * same-tick update.
 *
 * TWO DIFFERENT interleavings let effect (1) (URL → state) act on that stale, pre-clear
 * `projectId` and re-open the project the user just left — closing only one left the bug live:
 *
 *   (a) Effect (1) runs in the SAME commit as effect (2), BEFORE effect (2) has spent
 *       `userLeftProjectRef` — the interleaving the original dispatch brief described.
 *   (b) Effect (1) re-runs LATER, on its own, because an UNRELATED dependency changed — the
 *       "refresh the map's site list 80ms after landing on it" effect a few lines below bumps
 *       `sites`, which effect (1) also depends on. By then effect (2) has ALREADY run once and
 *       cleared `userLeftProjectRef` (case (a)'s guard is spent), while the browser's real
 *       hashchange still hasn't delivered — measured live with an artificially delayed
 *       hashchange listener (see the second test below), which reproduces the bounce on the
 *       code that guards ONLY case (a) and is silent on the fixed code.
 *
 * The fix closes BOTH: `userLeftProjectRef` guards (a); `pendingRouteWriteRef` (what effect (2)
 * last asked the URL to become) guards (b) — effect (1) stands down whenever the incoming
 * `projectId` hasn't yet caught up to what THIS mount itself last wrote, and resumes the moment
 * it has (never blocking a genuinely new external navigation, which the deep-link and
 * browser-back tests below both exercise).
 *
 * This is the same symptom noticed and deliberately NOT chased while building
 * e2e/duplicate-project-origin.spec.js (see its own header, "NOTICED, NOT CHASED, NOT THIS
 * ITEM'S") — "clicking the Site Planner header's 'Map' breadcrumb right after creating a
 * brand-new project does NOT leave the plan." That specific freshly-created-project repro was
 * tried here too and reproduces the bounce on unfixed code, but its timing (a live async
 * `pullCloud`/creation sequence) is not reliably deterministic in this sandbox — the delayed-
 * hashchange test below is the reliable, deterministic stand-in for the SAME mechanism (b),
 * driven on an already-saved local plan instead.
 */
import { test, expect } from "@playwright/test";

const GID = "g-mapbouncetest";
const GID_DELAY = "g-mapbouncedelay";

function seed(page, gid, label) {
  return page.addInitScript(([g, l]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({
      p1: { id: "p1", groupId: g, site: l, name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} },
    }));
  }, [gid, label]);
}

async function openProject(page, gid) {
  await page.goto(`/#/project/${gid}/site`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-testid="planner-canvas"]')).toBeVisible({ timeout: 30_000 });
}

// Delays delivery of the REAL browser `hashchange` event (never a synthetic dispatch — this
// wraps the listener Shell's route hook registers, so the event itself is still native) past the
// 80ms "refresh sites on landing on the map" timer, matching the real production timing variance
// that makes this bug "intermittent" rather than "always".
function delayHashchangeDelivery(page, ms) {
  return page.addInitScript((delayMs) => {
    const origAdd = window.addEventListener.bind(window);
    window.addEventListener = function (type, listener, options) {
      if (type === "hashchange" && typeof listener === "function") {
        const wrapped = (e) => setTimeout(() => listener(e), delayMs);
        return origAdd(type, wrapped, options);
      }
      return origAdd(type, listener, options);
    };
  }, ms);
}

test.describe("B1865936 — the Site Planner's Map crumb lands on the map and stays there", () => {
  test("MUTATION PROOF — delayed hashchange delivery must not bounce back to the project", async ({ page }) => {
    await seed(page, GID_DELAY, "ZZ Map Bounce Delay Test");
    await delayHashchangeDelivery(page, 200); // beat the 80ms mode==="map" refreshSites() timer
    await openProject(page, GID_DELAY);

    const crumb = page.locator('[data-testid="dashboard-crumb"]:visible');
    await expect(crumb).toBeVisible({ timeout: 15_000 });
    await crumb.click();

    await page.waitForTimeout(1500); // past both the delayed hashchange and the 80ms refresh
    expect(await page.evaluate(() => window.location.hash)).toBe("#/site");
    await expect(page.locator('[data-testid="planner-canvas"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="map-toolbar-draw"]:visible')).toBeVisible({ timeout: 10_000 });
  });

  test("clicking Map from an open project settles on #/site, ten times running, never bouncing back", async ({ page }) => {
    await seed(page, GID, "ZZ Map Bounce Test");
    await openProject(page, GID);

    const crumb = page.locator('[data-testid="dashboard-crumb"]:visible');

    for (let i = 0; i < 10; i++) {
      await expect(crumb).toBeVisible({ timeout: 15_000 });
      await crumb.click();

      await expect.poll(() => page.evaluate(() => window.location.hash), {
        message: `pass ${i + 1}/10: clicking the Map crumb must land on "#/site", never stay on the project route`,
        timeout: 5_000,
      }).toBe("#/site");

      await page.waitForTimeout(500);
      expect(await page.evaluate(() => window.location.hash)).toBe("#/site");
      await expect(page.locator('[data-testid="map-toolbar-draw"]:visible')).toBeVisible({ timeout: 10_000 });

      if (i < 9) {
        await page.evaluate((gid) => { window.location.hash = `#/project/${gid}/site`; }, GID);
        await expect(page.locator('[data-testid="planner-canvas"]:visible')).toBeVisible({ timeout: 15_000 });
      }
    }
  });

  test("a fresh deep link into a project still opens it (the guard must not block a real open)", async ({ page }) => {
    await seed(page, GID, "ZZ Map Bounce Test");
    await openProject(page, GID);
    expect(await page.evaluate(() => window.location.hash)).toBe(`#/project/${GID}/site`);
    await expect(page.locator('[data-testid="planner-canvas"]')).toBeVisible();
  });

  test("browser back from the map to the project still works (the guard must not block history nav)", async ({ page }) => {
    await seed(page, GID, "ZZ Map Bounce Test");
    await openProject(page, GID);

    const crumb = page.locator('[data-testid="dashboard-crumb"]:visible');
    await crumb.click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/site");
    await expect(page.locator('[data-testid="map-toolbar-draw"]:visible')).toBeVisible({ timeout: 10_000 });

    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.location.hash), {
      message: "browser Back from the map must return to the project route",
      timeout: 5_000,
    }).toBe(`#/project/${GID}/site`);
    await expect(page.locator('[data-testid="planner-canvas"]:visible')).toBeVisible({ timeout: 15_000 });
  });
});
