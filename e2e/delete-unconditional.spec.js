/* NEW-1 — "Delete means delete": every entry point, through the REAL render path.
 *
 * The owner's report was that Delete does nothing on a building, and that it keeps happening. The
 * cause was a silent no-op inside `deleteSel` reachable from several ordinary selection states (see
 * src/workspaces/site-planner/lib/deletePlan.js). test/deletePlan.test.js proves the DECISION; this
 * spec proves the WIRING — that the button, the key and the menu each reach it, that what they
 * delete is really gone from the model, that a bonded assembly goes with its building, and that a
 * refusal is never silent.
 *
 * Runs LOGGED OUT against a seeded-blank site, so the whole thing is Claude-verifiable here (the
 * ATTEMPT-BEFORE-YOU-PARK rule). The signed-in half — that the removal reaches `site_elements` as a
 * `deleted_at` row and does not come back on a cloud reload — needs a real account and is the
 * live `V###` in VERIFICATION.md.
 *
 * The two regressions with dedicated cases here, because both were reproduced on the pre-fix build:
 *   • DEAD DELETE KEY. A marquee that catches ONE object left `multi` holding a single ref. The
 *     first Delete worked (via `sel`), cleared `sel` but not `multi` — and every Delete after that
 *     silently did nothing until an unrelated click reset it.
 *   • DELETE AFTER UNDO. `applySnapshot` cleared `sel` but not `multi`, leaving the same dead key.
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

/* The persisted (logged-out) site model — on-disk truth, so it doubles as the reload assertion. */
function readModel(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    const els = site.els || [];
    return {
      els: els.map((e) => ({ id: e.id, type: e.type, attachedTo: e.attachedTo || null })),
      buildings: els.filter((e) => e.type === "building" && !e.attachedTo).length,
      deletedIds: site.deletedIds || [],
    };
  });
}
const buildings = (page) => readModel(page).then((m) => m.buildings);
const canvas = (p) => p.getByTestId("planner-canvas");

async function boot(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByTestId("map-start-blank-menu-btn").first().click();
  await page.getByTestId("map-start-blank-menu-item").first().click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
}

/* Draw a building by dragging the Building tool. Returns its screen box + centre. */
async function drawBuilding(page, fx0, fy0, fx1, fy1) {
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const box = await canvas(page).boundingBox();
  const x0 = box.x + box.width * fx0, y0 = box.y + box.height * fy0;
  const x1 = box.x + box.width * fx1, y1 = box.y + box.height * fy1;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => buildings(page)).toBeGreaterThan(0);
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

const select = async (page, b) => { await page.mouse.click(b.cx, b.cy); await page.waitForTimeout(250); };

test.describe("delete is unconditional and never silent (logged out)", () => {
  test("keyboard Delete removes the selected building, tombstones it, and it stays gone after a reload", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await boot(page);
    const b = await drawBuilding(page, 0.3, 0.35, 0.55, 0.5);
    const before = await readModel(page);
    const id = before.els.find((e) => e.type === "building" && !e.attachedTo).id;

    await select(page, b);
    await page.keyboard.press("Delete");

    await expect.poll(() => buildings(page)).toBe(0);
    // TOMBSTONE-DELETES — the removal is recorded, not just filtered out of the array.
    await expect.poll(() => readModel(page).then((m) => m.deletedIds)).toContain(id);

    await page.reload();
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    expect(await buildings(page)).toBe(0);            // did not come back
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the panel 'Delete element' button removes it", async ({ page }) => {
    await boot(page);
    const b = await drawBuilding(page, 0.3, 0.35, 0.55, 0.5);
    await select(page, b);
    await page.getByRole("button", { name: /^Properties$/ }).first().click();
    await page.getByRole("button", { name: /Delete element/i }).click();
    await expect.poll(() => buildings(page)).toBe(0);
  });

  test("the right-click menu's Delete removes it", async ({ page }) => {
    await boot(page);
    const b = await drawBuilding(page, 0.3, 0.35, 0.55, 0.5);
    await select(page, b);
    await page.mouse.click(b.cx, b.cy, { button: "right" });
    await page.getByRole("button", { name: /^Delete$/ }).last().click();
    await expect.poll(() => buildings(page)).toBe(0);
  });

  test("a building takes its whole bonded assembly with it", async ({ page }) => {
    await boot(page);
    const b = await drawBuilding(page, 0.26, 0.3, 0.64, 0.54);
    await select(page, b);
    await page.getByRole("button", { name: /^Properties$/ }).first().click();
    // Give it bonded children (each feature row is "label · [－] count [＋]"; the ＋ is its last button).
    const plus = (label) => page.getByText(label, { exact: true }).first().locator("xpath=..").getByRole("button").last();
    for (const label of ["Dock zones", "Car parking"]) { await plus(label).click(); await page.waitForTimeout(400); }
    await expect.poll(() => readModel(page).then((m) => m.els.length)).toBeGreaterThan(2);
    const before = await readModel(page);

    await page.keyboard.press("Escape");   // close the inspector; the element stays selected
    await page.keyboard.press("Delete");

    await expect.poll(() => readModel(page).then((m) => m.els.length)).toBe(0);
    const after = await readModel(page);
    for (const e of before.els) expect(after.deletedIds, `tombstone for ${e.id}`).toContain(e.id);
  });

  test("REGRESSION: a marquee that catches ONE object deletes it, and the Delete key stays alive after", async ({ page }) => {
    await boot(page);
    const b1 = await drawBuilding(page, 0.22, 0.26, 0.40, 0.42);
    const b2 = await drawBuilding(page, 0.60, 0.58, 0.80, 0.76);
    expect(await buildings(page)).toBe(2);

    // Marquee tool, box around b1 only → a multi-selection of exactly one.
    await page.keyboard.press("m");
    await page.mouse.move(b1.x0 - 14, b1.y0 - 14);
    await page.mouse.down();
    await page.mouse.move(b1.x1 + 14, b1.y1 + 14, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.keyboard.press("Delete");
    await expect.poll(() => buildings(page)).toBe(1);

    // The old bug: `multi` still held the ref to the thing we just deleted, so from here the Delete
    // key was DEAD — it hit the silent return and produced nothing, not even a message. Proving the
    // key is alive is the assertion: a Delete with nothing selected now says so.
    await page.keyboard.press("Delete");
    await expect(page.getByText(/Nothing is selected/i).first()).toBeVisible({ timeout: 5_000 });

    await select(page, b2);
    await page.keyboard.press("Delete");
    await expect.poll(() => buildings(page)).toBe(0);
  });

  test("REGRESSION: Delete still works after an undo/redo", async ({ page }) => {
    await boot(page);
    const b = await drawBuilding(page, 0.3, 0.35, 0.55, 0.5);
    await select(page, b);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(400);
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(400);
    expect(await buildings(page)).toBe(1);

    // A snapshot deselects by design — so this Delete must SAY so, not sit there mute. (Pre-fix the
    // snapshot left `multi` behind, so this keypress reached the silent return and did nothing.)
    await page.keyboard.press("Delete");
    await expect(page.getByText(/Nothing is selected/i).first()).toBeVisible({ timeout: 5_000 });
    expect(await buildings(page)).toBe(1);

    await select(page, b);
    await page.keyboard.press("Delete");
    await expect.poll(() => buildings(page)).toBe(0);
  });

  test("Delete with nothing selected SAYS SO instead of doing nothing", async ({ page }) => {
    await boot(page);
    await drawBuilding(page, 0.3, 0.35, 0.55, 0.5);
    const box = await canvas(page).boundingBox();
    await page.mouse.click(box.x + box.width * 0.92, box.y + box.height * 0.92); // deselect
    await page.waitForTimeout(300);

    await page.keyboard.press("Delete");
    await expect(page.getByText(/Nothing is selected/i).first()).toBeVisible({ timeout: 5_000 });
    expect(await buildings(page)).toBe(1);  // …and nothing was deleted by accident
  });

  test("a PINNED building still deletes — pinning guards a drag, not a deliberate Delete", async ({ page }) => {
    await boot(page);
    const b = await drawBuilding(page, 0.3, 0.35, 0.55, 0.5);
    await select(page, b);
    await page.getByRole("button", { name: /^Properties$/ }).first().click();
    await page.getByRole("button", { name: /Pin/ }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /Delete element/i }).click();
    await expect.poll(() => buildings(page)).toBe(0);
  });

  test("Delete swallowed by a field you're typing in explains where the keystroke went", async ({ page }) => {
    await boot(page);
    const b = await drawBuilding(page, 0.3, 0.35, 0.55, 0.5);
    await select(page, b);
    await page.getByRole("button", { name: /^Properties$/ }).first().click();
    await page.waitForTimeout(300);
    const field = page.locator('input[type="number"], input[inputmode="decimal"]').first();
    await field.click();
    await page.keyboard.press("Delete");
    // The element is deliberately NOT deleted (you must be able to type) — but the silence is gone.
    await expect(page.getByText(/box you're typing in/i).first()).toBeVisible({ timeout: 5_000 });
    expect(await buildings(page)).toBe(1);
  });
});
