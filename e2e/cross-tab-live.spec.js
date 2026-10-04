/* INSTANT CROSS-TAB SYNC (NEW-1) — two pages of ONE browser context share localStorage, so a change in
 * page A must show in page B within a couple of seconds WITHOUT B being focused, and B's in-progress
 * edit must never be clobbered. Logged out, throwaway seeded data only (never a real plan).
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/cross-tab-live.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { canvas, drawBuilding } from "./drawKinds.js";

const GID = "g-crosstab";
const PROJECT = "Crosstab Project";
const PLAN = "Concept A";
const LIVE = { timeout: 3_000 }; // "within a couple of seconds"

const seed = (context) => context.addInitScript(([gid, name, plan]) => {
  if (localStorage.getItem("__seeded")) return;
  localStorage.setItem("__seeded", "1");
  localStorage.setItem("planarfit:sites:v1", JSON.stringify({
    p1: { id: "p1", groupId: gid, site: name, name: plan, origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {} },
  }));
}, [GID, PROJECT, PLAN]);

async function openPlan(page) {
  await page.goto(`/#/project/${GID}/site`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
}
const featureCount = (page) => page.evaluate(() =>
  new Set([...document.querySelectorAll('[data-feature^="el:"]')].map((n) => n.getAttribute("data-feature"))).size);
const planCrumb = (page) => page.locator('[data-testid="plan-crumb"]:visible');
const projectCrumb = (page) => page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first();

async function renamePlan(page, next) {
  await planCrumb(page).click();
  const input = page.getByTestId("plan-name-input");
  await input.fill(next);
  await input.press("Enter");
  await page.keyboard.press("Escape");
}

test.describe("instant cross-tab sync (same browser)", () => {
  test("plan rename + a drawn building reach the other tab with no focus; B's in-progress edit survives", async ({ context }) => {
    await seed(context);
    const a = await context.newPage();
    const b = await context.newPage(); // opened last → B is the focused tab; A drives it via script
    await openPlan(a);
    await openPlan(b);
    await a.bringToFront(); // B is now a background tab — the case the owner described
    // known-good control: before A changes anything, B shows the ORIGINAL state (so a pass below is a real transition)
    await expect(planCrumb(b)).toContainText(PLAN);
    expect(await featureCount(b)).toBe(0);

    // 1 · rename in A → B's crumb updates with no focus
    await renamePlan(a, "Renamed In A");
    await expect(planCrumb(b)).toContainText("Renamed In A", LIVE);

    // 2 · a building drawn in A appears in B
    const box = await canvas(a).boundingBox();
    await drawBuilding(a, box, { plan: "Renamed In A", expect: 1 });
    await expect.poll(() => featureCount(b), LIVE).toBe(1);

    // 3 · B has an edit in flight (typing a plan name) → A changes something → B's draft is untouched
    await b.bringToFront();
    await planCrumb(b).click();
    const draft = b.getByTestId("plan-name-input");
    await draft.fill("Half typed in B");
    await a.bringToFront();
    await renamePlan(a, "Second Rename In A");
    await b.bringToFront();
    await expect(draft).toHaveValue("Half typed in B");
  });

  test("a plan-header SETTING changed in A is adopted by B's open plan (and not reverted by B's next save)", async ({ context }) => {
    await seed(context);
    const a = await context.newPage();
    const b = await context.newPage();
    await openPlan(a);
    await openPlan(b);
    await a.bringToFront();
    // a realistic plan has a saved header: let A save one (a building) so both tabs hold the full settings
    await drawBuilding(a, await canvas(a).boundingBox(), { expect: 1 });
    await expect.poll(() => featureCount(b), LIVE).toBe(1);
    const readSetback = (page) => page.evaluate(() => {
      const r = JSON.parse(localStorage.getItem("planarfit:sites:v1")).p1;
      return r.settings ? r.settings.setback : undefined;
    });
    // A writes through the SAME storage funnel its own saves use (the transport B listens on).
    await a.evaluate(() => {
      const m = JSON.parse(localStorage.getItem("planarfit:sites:v1"));
      m.p1 = { ...m.p1, settings: { ...(m.p1.settings || {}), setback: 37 }, updatedAt: Date.now() + 5 };
      localStorage.setItem("planarfit:sites:v1", JSON.stringify(m));
    });
    await expect(b.getByText(/Updated from another session: this plan's settings changed/)).toBeVisible(LIVE);
    // B's own next edit (a building) must not revert A's setting
    const box = await canvas(b).boundingBox();
    await b.bringToFront();
    await b.mouse.move(box.x + 5, box.y + 5); await b.keyboard.press("Escape");
    await drawBuilding(b, box, { expect: 2 });
    await expect.poll(() => readSetback(b), { timeout: 5_000 }).toBe(37);
  });
});
