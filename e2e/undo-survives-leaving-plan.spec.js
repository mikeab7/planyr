/* NEW-1 (2026-11-13) — UNDO HISTORY SURVIVES LEAVING A PLAN.
 *
 * Owner: "Do I lose the ability to do the control Z whenever I get out of the page? I'd like to have some
 * amount of undo abilities, even if I go to an old page or a page I wasn't on in a minute."
 *
 * THE MOUNT BOUNDARY IS THE SUBJECT. `SitePlannerApp` mounts the planner with `key={siteId:loadEpoch}`, so a
 * plan switch (and a reload, and a cloud-pull remount) builds a NEW planner whose history stack starts empty;
 * `lib/history.js` and `lib/historyCarry.js` are fine in isolation (unit tests pass on both) and cannot see
 * that. This file drives the real app across each remount and presses a real Ctrl+Z.
 *
 * RED PROOFS (run against a build of main before the change — see the item): (a) (b-control) (c) (e-control)
 * fail there because the history is simply gone after the remount; (d) and (e) each carry a POSITIVE CONTROL
 * arm (the same sequence with nothing in the way DOES undo) so they cannot pass vacuously on a build with no
 * carried history at all.
 *
 * Counts are DISTINCT `data-feature` keys of the markup kind (COUNT-EVERY-KIND), read off the rendered canvas.
 * Logged out, local storage, no GIS — Claude-verifiable in full. The signed-in half is a live check
 * (ui-audit verify-undo-carry-live).
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";
import { canvas, planCrumb, startBlank, selectTool } from "./drawKinds.js";

const markupCount = (page) => page.evaluate(() => new Set(Array.from(document.querySelectorAll('[data-feature^="markup:"]')).map((n) => n.getAttribute("data-feature"))).size);
const waitMarkups = (page, n) => expect.poll(() => markupCount(page), { timeout: 15_000 }).toBe(n);

/* One markup LINE at a given height — a real, individually undoable edit. */
async function drawLine(page, yFrac) {
  const box = await canvas(page).boundingBox();
  await page.keyboard.press("l");
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * yFrac);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * yFrac, { steps: 6 });
  await page.mouse.up();
  await selectTool(page);
}

async function switchToPlan(page, name) {
  await planCrumb(page).click();
  await page.getByRole("button", { name: new RegExp(`^${name}$`) }).click();
  await expect(planCrumb(page)).toContainText(name, { timeout: 15_000 });
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500); // the fresh mount settles (and, with the fix, adopts its carried steps)
}

/* A second plan with one line on it (a blank plan with no location deletes itself when left), then back to A. */
async function addPlanB(page) {
  await planCrumb(page).click();
  await page.getByRole("button", { name: /New plan/ }).click();
  await expect(planCrumb(page)).toContainText("Concept B", { timeout: 15_000 });
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await drawLine(page, 0.86);
  await waitMarkups(page, 1);
}

async function plantA(page, lines = 2) {
  await startBlank(page);
  for (let i = 0; i < lines; i++) { await drawLine(page, 0.30 + i * 0.12); await waitMarkups(page, i + 1); }
}

const undo = async (page) => { await selectTool(page); await page.keyboard.press("Control+z"); await page.waitForTimeout(250); };

test.describe("NEW-1 — undo survives leaving the plan", () => {
  test("(a) edit → switch plan → switch back → Ctrl+Z reverts the edit", async ({ page }) => {
    await plantA(page, 2);
    await addPlanB(page);
    await switchToPlan(page, "Concept A");
    await waitMarkups(page, 2);
    await undo(page);
    await waitMarkups(page, 1);          // the second line is gone: the history crossed the plan switch
    await undo(page);
    await waitMarkups(page, 0);          // …and so is the first, one step at a time
  });

  test("(b) edit → leave to another module → return → Ctrl+Z reverts", async ({ page }) => {
    await plantA(page, 2);
    await openModule(page, "scheduler");
    await page.waitForTimeout(600);
    await openModule(page, "site-planner");
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    await waitMarkups(page, 2);
    await undo(page);
    await waitMarkups(page, 1);
  });

  test("(c) edit → reload → Ctrl+Z reverts the most recent step", async ({ page }) => {
    await plantA(page, 2);
    await page.waitForTimeout(2500);     // the plan's own autosave lands, and the history tail is written once edits settle
    await page.reload();
    await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
    await waitMarkups(page, 2);
    await page.waitForTimeout(800);      // the carried tail is read off disk and adopted
    await undo(page);
    await waitMarkups(page, 1);
  });

  test("(d) plan changed elsewhere after the history was saved → Ctrl+Z does nothing to the newer work", async ({ page, context }) => {
    // CONTROL ARM first, in this same test: with nothing in the way the history IS carried and DOES undo.
    await plantA(page, 2);
    await addPlanB(page);
    const planAUrl = null; void planAUrl;
    await switchToPlan(page, "Concept A");
    await waitMarkups(page, 2);
    await undo(page);
    await waitMarkups(page, 1);          // control: carried history works when the plan is untouched
    await page.keyboard.press("Control+Shift+z");
    await waitMarkups(page, 2);

    // TEST ARM: leave A, change A from another tab of the same browser, come back.
    await switchToPlan(page, "Concept B");
    await page.waitForTimeout(400);
    const other = await context.newPage();
    await other.setViewportSize({ width: 1440, height: 900 });
    await other.goto(page.url());
    await expect(canvas(other)).toBeVisible({ timeout: 20_000 });
    await switchToPlan(other, "Concept A");
    await waitMarkups(other, 2);
    await drawLine(other, 0.75);         // newer work on A, made elsewhere
    await waitMarkups(other, 3);
    await other.waitForTimeout(1500);    // autosave
    await other.close();

    await switchToPlan(page, "Concept A");
    await waitMarkups(page, 3);          // A now holds the newer line
    await undo(page);
    await undo(page);
    await waitMarkups(page, 3);          // …and no Ctrl+Z replays the old steps over it
  });

  test("(e) plan A's history never applies to plan B (and B keeps its own)", async ({ page }) => {
    await plantA(page, 2);
    await addPlanB(page);
    await switchToPlan(page, "Concept A");
    await waitMarkups(page, 2);
    await undo(page); await undo(page); await undo(page);
    await waitMarkups(page, 0);          // A's three presses emptied A (two steps), the third found nothing
    await switchToPlan(page, "Concept B");
    await waitMarkups(page, 1);          // B's line is untouched by anything pressed on A
    await undo(page);
    await waitMarkups(page, 0);          // CONTROL: B's own carried history is B's, and it works
  });
});
