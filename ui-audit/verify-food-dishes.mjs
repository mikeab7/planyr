#!/usr/bin/env node
/* verify-food-dishes — B1873008 (Dishes and per-dish ratings inside the existing Food module).
 *
 * ⛔ WHAT THIS SCRIPT CAN AND CANNOT PROVE, stated up front so a PASS here is never overread.
 * Adding/editing/deleting a dish requires a signed-in account (RLS on food_dishes is owner-only,
 * exactly like food_visits/food_wishlist), and this sandbox's egress proxy CORS-blocks the
 * Supabase auth handshake (VERIFICATION.md's own standing note — the same wall behind every
 * `Blocker: auth` item in this module, e.g. V306784 for the original visit-logging feature). So
 * this script can drive the app LOGGED OUT only. It proves:
 *   1. The /food route still loads with no crash and no new nav/tab surface (the module is still
 *      an unlisted, URL-only Easter egg — this item added no discoverability surface).
 *   2. Dropping a pin and opening its (never-visited, signed-out) panel renders cleanly with the
 *      new Dishes/ScoreMeter code in the bundle — DishesSection correctly renders NOTHING in this
 *      state (zero visits AND signed out), which is itself a real regression check: a crash here
 *      would mean the new code broke the panel for every existing signed-out visitor.
 * It does NOT and CANNOT prove: adding a dish persists, a saved dish appears in "the order", or a
 * saved dish marks a matching food_dish_wishlist entry done — those need a real signed-in round
 * trip against Supabase. That check is filed as V1337904 (`Blocker: auth`) in VERIFICATION.md,
 * the same pattern this module has used for every auth-gated feature since B568400.
 *
 * Usage: node ui-audit/verify-food-dishes.mjs [previewUrl]
 * Requires: `npm run build && npx vite preview --port 4173` running first (or pass a URL).
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE_URL = process.argv[2] || "http://localhost:4173";

async function main() {
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: ["--ignore-certificate-errors"],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(`${BASE_URL}/#/food`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 15000 });
  await assertMeasurable(page, "verify-food-dishes");
  await page.waitForTimeout(500);

  const results = {};

  // 1. Still no nav/tab entrance — this item added no discoverability surface. AppHeader stamps
  // every module tab as `module-tab-<id>` (AppHeader.jsx); /food renders with showModuleTabs=false,
  // so NONE of that prefix should exist at all on this route.
  results.moduleTabsAbsent = (await page.locator('[data-testid^="module-tab-"]').count()) === 0;
  results.noCrash = (await page.locator("text=/hit an error and couldn.?t load/i").count()) === 0;

  // 2. Drop a pin (signed out — no name typed yet is fine, we're only checking the panel mounts)
  // and confirm the panel renders with no Dishes section and no crash: zero visits + signed out
  // means DishesSection's own `{everVisited && onSaveDish && (...)}` gate must be false on both
  // counts, which this checks directly rather than assuming from source. The toggle carries no
  // testid — it's a plain toolbar button identified by its title, exactly as the app renders it.
  const pinToggle = page.locator('button[title="Drop a pin for a place not on the map"]');
  await pinToggle.click({ timeout: 5000 }).catch(() => {});
  const pinModeOn = (await pinToggle.getAttribute("aria-pressed")) === "true";
  if (pinModeOn) {
    await page.click('[data-testid="food-map"]', { position: { x: 200, y: 200 } });
    await page.waitForTimeout(400);
    results.panelOpened = (await page.locator('[data-testid="food-panel-close"]').count()) > 0;
    results.dishesSectionAbsentSignedOut = (await page.locator('[data-testid="food-dishes-section"]').count()) === 0;
    results.scoreMeterAbsentSignedOut = (await page.locator('[data-testid="dish-score-meter"]').count()) === 0;
  } else {
    results.panelOpened = false;
    results.dishesSectionAbsentSignedOut = "pin-mode toggle not reachable — INCONCLUSIVE, not a pass";
    results.scoreMeterAbsentSignedOut = "pin-mode toggle not reachable — INCONCLUSIVE, not a pass";
  }

  await browser.close();

  console.log("Results:", JSON.stringify(results, null, 2));
  console.log("Page errors (uncaught exceptions):", JSON.stringify(pageErrors, null, 2));
  console.log(
    "\n⛔ NOT COVERED HERE (needs a signed-in account — sandbox cannot sign in): adding a dish " +
    "persists across reload, a saved dish appears in \"the order\", saving a dish marks a matching " +
    "food_dish_wishlist entry done. See VERIFICATION.md V1337904 (Blocker: auth)."
  );

  const failed = results.moduleTabsAbsent !== true || results.noCrash !== true
    || results.dishesSectionAbsentSignedOut !== true || results.scoreMeterAbsentSignedOut !== true
    || pageErrors.length > 0;

  if (failed) {
    console.error("\nFAIL — see results above.");
    process.exit(1);
  }
  console.log("\nPASS (logged-out coverage only — see the NOT COVERED note above).");
}

main().catch((e) => { console.error(e); process.exit(1); });
