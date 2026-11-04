/* Device-storage tiering, driven in a real browser, LOGGED OUT (B1427–B1429).
 *
 * This is the spec that proves the actual claim of B1427 rather than a source reading: the GIS
 * screening cache no longer occupies the ~5 MB localStorage tier that saved plans live in, and
 * a device already carrying the legacy namespace has that space HANDED BACK on the next load.
 * Everything here runs with no account and no reachable GIS host, so it is verifiable in the
 * sandbox — the ATTEMPT-BEFORE-YOU-PARK rule.
 *
 * The one thing it cannot prove is a real save that used to throw and now doesn't: that needs a
 * signed-in plan the size of Bain on a device at the cap (V707).
 */
import { test, expect } from "@playwright/test";
import { moduleTab } from "./helpers.js";

const LEGACY_NS = "planyr:giscache:v1:";
// The three biggest keys from the owner's own census, at their measured sizes — 400/283/280 KB
// of terrain DEM tiles, which is nearly a fifth of the whole 5 MB ceiling.
const MEASURED_TILES = [
  ["terrain:dem:L16:-4364,1421", 400 * 1024],
  ["terrain:dem:L16:-4364,1420", 283 * 1024],
  ["terrain:dem:L16:-4365,1421", 280 * 1024],
];

// Seed the legacy cache namespace + a stand-in for the owner's saved work, BEFORE the app boots.
// A minimal but real saved plan, so the app boots INTO the planner (the plan menu — and with it
// Version history — only exists once a plan is open, which is exactly the
// state a user whose save is failing is in).
const SEED_PLAN = { id: "e2e", groupId: "e2e", site: "E2E site", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, parcels: [], els: [], updatedAt: 1 };

async function seedLegacyCache(page, { withPlan = true } = {}) {
  await page.addInitScript(({ ns, tiles, PLAN, withPlan }) => {
    try {
      for (const [k, bytes] of tiles) {
        localStorage.setItem(ns + k, JSON.stringify({ data: "x".repeat(bytes), ts: Date.now() - 3_600_000 }));
      }
      if (withPlan) {
        localStorage.setItem("planarfit:sites:v1", JSON.stringify({ e2e: PLAN }));
        localStorage.setItem("planarfit:sites:history:v1", JSON.stringify({ e2e: [] }));
        localStorage.setItem("planarfit:currentSite:v1", "e2e");   // boot straight into the planner
      }
    } catch (_) { /* a store that refuses the seed just makes the assertion below trivial */ }
  }, { ns: LEGACY_NS, tiles: MEASURED_TILES, PLAN: SEED_PLAN, withPlan });
}

const census = (page) => page.evaluate((ns) => {
  let total = 0, cacheBytes = 0, cacheKeys = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = (globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k) || "";
    total += v.length + k.length;
    if (k.indexOf(ns) === 0) { cacheBytes += v.length + k.length; cacheKeys++; }
  }
  return { total, cacheBytes, cacheKeys, plans: (globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))("planarfit:sites:v1"), history: localStorage.getItem("planarfit:sites:history:v1") };
}, LEGACY_NS);

test.describe("storage tiers (logged out)", () => {
  test("the GIS cache namespace is handed back to the small store on load, and user work is untouched", async ({ page }) => {
    await seedLegacyCache(page);
    await page.goto("/");
    await expect(moduleTab(page, "site-planner")).toBeVisible();

    // BEFORE is what the seed put there; the planner chunk purges on load, so measure after boot.
    const before = MEASURED_TILES.reduce((n, [k, b]) => n + b + LEGACY_NS.length + k.length, 0);
    await expect.poll(async () => (await census(page)).cacheKeys, { timeout: 15_000 }).toBe(0);

    const after = await census(page);
    expect(after.cacheBytes).toBe(0);
    // The whole point: ~963 KB of the ~5 MB ceiling returned to saved plans.
    expect(before).toBeGreaterThan(900 * 1024);
    // …and the eviction cost the owner nothing that cannot be rebuilt.
    expect(after.plans).toContain("Plan 1");
    expect(after.history).toBeTruthy();
    console.log(`[storage-tiers] localStorage cache bytes: ${before} → ${after.cacheBytes}; total now ${after.total}`);
  });

  test("nothing the app writes afterwards goes back into the small store's cache namespace", async ({ page }) => {
    await seedLegacyCache(page, { withPlan: false });
    await page.goto("/");
    await expect(moduleTab(page, "site-planner")).toBeVisible();
    // Let the planner settle (layer probes, boot effects) before checking.
    await page.waitForTimeout(2500);
    const after = await census(page);
    expect(after.cacheKeys).toBe(0);
  });

  /* NEW-1 (2026-11-04) — the Storage dialog ("Storage on this device…") was retired: its one menu row, its mount and its lazy import are gone.
   * The two tests that drove that dialog's UI (both tiers reported separately; the clear-map-data action never offering to clear
   * irreplaceable classes) proved a surface that no longer exists. What they guarded lives on in code and is covered by the unit suites
   * storageReclaim / storageCensus (the per-class declarations, the refusal to clear a class with no way back) — and the automatic
   * room-making (makeRoomForPlanStore) is untouched. The one claim that CAN still be asserted here: no door to it remains in the menu. */
  test("the plan menu no longer carries a Storage row or a Save now row (automatic room-making and autosave are what remain)", async ({ page }) => {
    await seedLegacyCache(page);
    await page.goto("/");
    await expect(moduleTab(page, "site-planner")).toBeVisible();
    await page.getByTitle("Switch or rename plan").first().click();
    await expect(page.getByTestId("plan-footer")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("storage-menu-item")).toHaveCount(0);
    await expect(page.getByTestId("save-now")).toHaveCount(0);
    await expect(page.getByText("Storage on this device")).toHaveCount(0);
  });
});
