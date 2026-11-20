/* NEW-1 (2026-11-03) — a plan duplicate the DEVICE refuses must be refused out loud, with no half-state.
 *
 * The owner's report: a teammate duplicated a plan on a near-full browser, the app said "saved on this device but couldn't sync", navigated into the
 * copy, and a reload said "This project doesn't exist". Cause: the copy was never written (localStorage full); `duplicatePlan` ignored the refusal.
 *
 * Real browser, signed out, the REAL plan menu: fill localStorage to its cap with a filler key, Duplicate → the banner has the honest words, the URL
 * does not move to a new id, a reload lands on the ORIGINAL plan, and no "doesn't exist" notice renders. Then free the filler and Duplicate again → the
 * normal path still works and a reload lands on the copy. Red on main: the banner says "saved on this device", the route moves to an id with no record.
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/duplicate-refused-loud.spec.js --project=chromium */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const SITE_KEY = "planarfit:sites:v1";
const SITE_ID = "e2e-dup-refused";
const canvas = (p) => p.getByTestId("planner-canvas");

async function open(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Goose Creek", name: "Concept A", origin: null, county: "harris",
    parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: 1786500000000,
  };
  await page.addInitScript(([key, id, rec]) => {
    if (sessionStorage.getItem("e2e-seeded")) return;           // seed once; a reload must show what the app itself kept
    sessionStorage.setItem("e2e-seeded", "1");
    localStorage.setItem(key, JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_KEY, SITE_ID, site]);
  await page.goto(`/?app#/project/${SITE_ID}/site`);
  await expect(canvas(page)).toBeVisible();
}

/* Fill this origin's localStorage until it refuses a write (coarse → single characters), leaving at most a handful of characters. */
const fillStorage = (page) => page.evaluate(() => {
  let i = 0;
  for (let step = 262144; step >= 1; step = Math.floor(step / 2)) {
    for (;;) { try { localStorage.setItem("zz-filler-" + i, "x".repeat(step)); i++; } catch (_) { break; } }
  }
  return i;
});
const clearFiller = (page) => page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("zz-filler-")) localStorage.removeItem(k); });

async function duplicate(page) {
  await page.getByTestId("plan-crumb").click();
  await page.getByRole("button", { name: /Duplicate/ }).click();
}

test("a refused duplicate says so, stays on the original, and a reload still opens it", async ({ page }) => {
  await open(page);
  const urlBefore = page.url();
  expect(await fillStorage(page)).toBeGreaterThan(0);
  await duplicate(page);

  const banner = page.getByTestId("cloud-write-failure-banner");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText("Couldn't make the copy");
  await expect(banner).toContainText("nothing was saved");
  await expect(banner).not.toContainText(/saved on this device/i);
  await expect(banner).not.toContainText(/sync/i);

  expect(page.url()).toBe(urlBefore);                              // never navigated into an id with no record
  await expect(page.getByTestId("plan-crumb")).not.toContainText("(copy)");

  await page.reload();
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });    // lands on the ORIGINAL plan
  await expect(page.getByText(/This project doesn't exist/i)).toHaveCount(0);
  await expect(page.getByTestId("plan-crumb")).toContainText("Concept A");
});

test("after space is freed, Duplicate works and a reload lands on the copy", async ({ page }) => {
  await open(page);
  await fillStorage(page);
  await duplicate(page);
  await expect(page.getByTestId("cloud-write-failure-banner")).toBeVisible({ timeout: 15_000 });
  await clearFiller(page);
  await page.getByTestId("cloud-write-failure-retry").click();    // Retry = make room, then redo the whole duplicate (a fresh id is fine)
  await expect(page.getByTestId("plan-crumb")).toContainText("(copy)", { timeout: 15_000 });
  await expect(page.getByTestId("cloud-write-failure-banner")).toHaveCount(0);

  await page.reload();
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/This project doesn't exist/i)).toHaveCount(0);
  await expect(page.getByTestId("plan-crumb")).toContainText("(copy)");
});
