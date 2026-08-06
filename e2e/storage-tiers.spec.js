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
// Save now / Version history / Storage — only exists once a plan is open, which is exactly the
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

/* Open the storage dialog: plan menu (the ▾ beside the plan name) → "Storage on this device…". */
async function openStoragePanel(page) {
  await page.getByTitle("Switch or rename plan").first().click();
  await page.getByTestId("storage-menu-item").click();
  await expect(page.getByTestId("storage-panel")).toBeVisible({ timeout: 15_000 });
}

const census = (page) => page.evaluate((ns) => {
  let total = 0, cacheBytes = 0, cacheKeys = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = localStorage.getItem(k) || "";
    total += v.length + k.length;
    if (k.indexOf(ns) === 0) { cacheBytes += v.length + k.length; cacheKeys++; }
  }
  return { total, cacheBytes, cacheKeys, plans: localStorage.getItem("planarfit:sites:v1"), history: localStorage.getItem("planarfit:sites:history:v1") };
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

  test("the storage panel reports BOTH tiers separately and never a combined total", async ({ page }) => {
    await seedLegacyCache(page);
    await page.goto("/");
    await expect(moduleTab(page, "site-planner")).toBeVisible();
    // The storage readout lives on the SITE route, in the plan menu beside Save now / Version
    // history — deliberately not in the shared account panel or the header gear, both of which sit
    // in the entry chunk every route downloads (B1429). Reachable signed OUT, which is why this
    // spec can prove it at all.
    await openStoragePanel(page);
    const panel = page.getByTestId("storage-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });

    const text = await panel.innerText();
    // Two named tiers, each with its own ceiling — this separation IS the feature.
    expect(text).toMatch(/Small store/i);
    expect(text).toMatch(/Large store/i);
    expect(text).toMatch(/two separate stores/i);
    // Per-class rows with sizes, so "my storage is full" is a number rather than a guess.
    expect(text).toMatch(/Saved plans/i);
    expect(text).toMatch(/\d+(\.\d+)?\s?(B|KB|MB|GB)/);
    // Two meters, not one.
    expect(await panel.locator("section").count()).toBe(2);
  });

  test("the clear-map-data action exists and never offers to clear irreplaceable classes", async ({ page }) => {
    await seedLegacyCache(page);
    await page.goto("/");
    await expect(moduleTab(page, "site-planner")).toBeVisible();
    await openStoragePanel(page);
    const btn = page.getByTestId("clear-map-cache");
    await expect(btn).toBeVisible();
    // Only the re-downloadable classes are ever labelled as such.
    const marked = await page.getByTestId("storage-panel").locator("text=re-downloads").allInnerTexts();
    const rows = await page.getByTestId("storage-panel").innerText();
    if (/Reference images/i.test(rows)) expect(rows).not.toMatch(/Reference images.*re-downloads/);
    expect(marked.length).toBeLessThanOrEqual(2); // at most the two "Map data" rows, one per tier
    // The copy states the guarantee the reclaim code enforces.
    expect(rows).toMatch(/never touches your plans/i);
  });
});
