/* NEW-1 — end-to-end drive of the Properties panel's "Building number" field: draw two
 * buildings, retarget their numbers through the plain / swap / shift / cancel paths, and confirm
 * the persisted model never carries a duplicate. Logged out, no external GIS — Claude-verifiable
 * per ATTEMPT-BEFORE-YOU-PARK (root CLAUDE.md).
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/building-number-panel.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { canvas, startBlank, drawBuilding } from "./drawKinds.js";

const buildingsOf = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const rec = Object.values(map).find((r) => r && r.name === "Concept A");
  return ((rec && rec.els) || []).filter((e) => e.type === "building" && !e.dogEar);
});
const numberOf = (bs, id) => bs.find((b) => b.id === id).buildingNumber;

/* Properties opens on a double-click (B750/B935) — a single click only selects. */
async function openProps(page, id) {
  const box = await page.evaluate((elId) => {
    const g = document.querySelector(`[data-el-id="${elId}"]`);
    const body = g && g.querySelector("rect, path");
    if (!body) return null;
    const r = body.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  expect(box).not.toBeNull();
  await page.mouse.dblclick(box.x, box.y);
  await page.waitForTimeout(300);
}

test.describe("NEW-1 — Properties panel Building number field", () => {
  test("a free number commits with no confirmation; a taken number offers Swap/Shift/Cancel and never duplicates", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawBuilding(page, box, { expect: 1 });
    // A second building, well clear of the first (drawKinds' own default sits at 0.58–0.76 x / 0.28–0.44 y).
    await page.getByRole("button", { name: /^Building$/ }).first().click();
    const x0 = box.x + box.width * 0.30, y0 = box.y + box.height * 0.62;
    const x1 = box.x + box.width * 0.48, y1 = box.y + box.height * 0.78;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => buildingsOf(page).then((b) => b.length), { timeout: 15_000 }).toBe(2);

    // Neither building has been touched yet, so `buildingNumber` is unset on both — the display
    // number is purely DERIVED (placement order) until the panel stamps one.
    const [b1, b2] = await buildingsOf(page);
    expect(b1.buildingNumber).toBeUndefined();
    expect(b2.buildingNumber).toBeUndefined();

    await openProps(page, b1.id);
    const field = page.getByRole("textbox", { name: "Building number" });
    await expect(field).toHaveValue("1");

    // A free, well-clear number commits on Enter with no confirmation.
    await field.fill("5");
    await field.press("Enter");
    await expect.poll(() => buildingsOf(page).then((bs) => numberOf(bs, b1.id))).toBe(5);
    await expect(page.getByText(/That number belongs to/)).toHaveCount(0);

    // Building 2 was never touched — it must KEEP reading its pre-edit display number (2), even
    // though building 1 vacated the "1" slot. (NEW-1, amends B1768384: the naive implicit-fill
    // used to silently pull an untouched building down to fill the vacated slot — a plain,
    // no-conflict save on the LOWEST-numbered building must never cascade-renumber the rest.)
    await openProps(page, b2.id);
    const field2 = page.getByRole("textbox", { name: "Building number" });
    await expect(field2).toHaveValue("2");

    // Typing the number building 1 now holds blocks the plain commit and offers a choice — the
    // field keeps showing what was TYPED while the choice is pending.
    await field2.fill("5");
    await field2.press("Enter");
    await expect(page.getByText(/That number belongs to Building 5/)).toBeVisible();
    await expect(field2).toHaveValue("5");

    // Swap: the two buildings trade numbers. Building 1 (still selected in this same panel
    // instance would be wrong to assume — re-read the model instead of trusting field state).
    await page.getByRole("button", { name: /^Swap with Building 5$/ }).click();
    let bs = await buildingsOf(page);
    expect(numberOf(bs, b2.id)).toBe(5);
    expect(numberOf(bs, b1.id)).toBe(2); // took building 2's PRE-swap number (2), not its old "5"
    expect(new Set(bs.map((b) => b.buildingNumber)).size).toBe(2); // no duplicate, even mid-resolution

    // Shift: reselect building 1 (now "2") and ask for 5 (building 2's number) via Shift —
    // building 1 takes 5; everything numbered ≥ 5 (just building 2) moves up by one.
    await openProps(page, b1.id);
    const field1b = page.getByRole("textbox", { name: "Building number" });
    await expect(field1b).toHaveValue("2");
    await field1b.fill("5");
    await field1b.press("Enter");
    await expect(page.getByText(/That number belongs to Building 5/)).toBeVisible();
    await page.getByRole("button", { name: /^Shift 5 and up by one$/ }).click();
    bs = await buildingsOf(page);
    expect(numberOf(bs, b1.id)).toBe(5);
    expect(numberOf(bs, b2.id)).toBe(6);
    expect(new Set(bs.map((b) => b.buildingNumber)).size).toBe(2);

    // Cancel: re-attempt a taken number and back out — nothing in the model moves.
    await field1b.fill("6");
    await field1b.press("Enter");
    await expect(page.getByText(/That number belongs to Building 6/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(field1b).toHaveValue("5"); // reverted to the real number, not the rejected one
    bs = await buildingsOf(page);
    expect(numberOf(bs, b1.id)).toBe(5);
    expect(numberOf(bs, b2.id)).toBe(6);

    // Guard: 0 is rejected outright — the field reverts, nothing in the model changes.
    await field1b.fill("0");
    await field1b.press("Enter");
    await expect(field1b).toHaveValue("5");
    bs = await buildingsOf(page);
    expect(numberOf(bs, b1.id)).toBe(5);

    // Guard: a non-digit keystroke is filtered at the input, never reaches the model.
    await field1b.fill("");
    await page.keyboard.type("-3abc");
    await expect(field1b).toHaveValue("3");
    // Escape reverts the in-progress edit — and, like every other field in this panel (B1125),
    // also closes the inspector outright rather than swallowing the key: this field must not
    // stopPropagation() on Escape, or the panel's "guaranteed escape hatch" would stop working
    // the moment this field has focus. Either way, the filtered "3" never reaches the model.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "Building number" })).toHaveCount(0);
    bs = await buildingsOf(page);
    expect(numberOf(bs, b1.id)).toBe(5);
  });

  /* NEW-1 (amends B1768384) — renumbering the LOWEST-numbered building on a plan with no gaps
   * must touch only that building. Reproduced live on planyr.io: with buildings 1/2/3 all
   * unstamped (pure placement-order display numbers), retargeting building 1 to a free number
   * silently cascaded 2→1 and 3→2 — a plain, no-conflict save with no dialog and no action on
   * the other two buildings. */
  test("renumbering the lowest-numbered building never cascade-renumbers the rest", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawBuilding(page, box, { expect: 1 });
    await page.getByRole("button", { name: /^Building$/ }).first().click();
    let x0 = box.x + box.width * 0.30, y0 = box.y + box.height * 0.62;
    let x1 = box.x + box.width * 0.48, y1 = box.y + box.height * 0.78;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 6 });
    await page.mouse.up();
    await page.getByRole("button", { name: /^Building$/ }).first().click();
    x0 = box.x + box.width * 0.02; y0 = box.y + box.height * 0.85;
    x1 = box.x + box.width * 0.14; y1 = box.y + box.height * 0.97;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => buildingsOf(page).then((b) => b.length), { timeout: 15_000 }).toBe(3);
    const [b1, b2, b3] = await buildingsOf(page);

    await openProps(page, b1.id);
    const field = page.getByRole("textbox", { name: "Building number" });
    await expect(field).toHaveValue("1");
    await field.fill("9");
    await field.press("Enter");
    await expect.poll(() => buildingsOf(page).then((bs) => numberOf(bs, b1.id))).toBe(9);
    await expect(page.getByText(/That number belongs to/)).toHaveCount(0); // free number, no dialog

    const bs = await buildingsOf(page);
    expect(numberOf(bs, b2.id)).toBe(2); // untouched — must NOT silently become 1
    expect(numberOf(bs, b3.id)).toBe(3); // untouched — must NOT silently become 2
  });

  /* NEW-2 (amends B1768384) — Escape on the Swap/Shift/Cancel conflict prompt reverts the typed
   * number (proven above) but must ALSO drop the pending conflict, exactly like Cancel does.
   * Before this fix, `bldgNumConflict` only cleared when the selection moved to a DIFFERENT
   * building; reselecting the SAME building (a single click that never deselects it, or a direct
   * double-click) left the parent's conflict state stale, so reopening Properties on that same
   * building could resurface the stale prompt even though the field's own number had reverted. */
  test("Escape on the conflict dialog drops the pending conflict — it cannot resurface on reselect", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawBuilding(page, box, { expect: 1 });
    await page.getByRole("button", { name: /^Building$/ }).first().click();
    const x0 = box.x + box.width * 0.30, y0 = box.y + box.height * 0.62;
    const x1 = box.x + box.width * 0.48, y1 = box.y + box.height * 0.78;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => buildingsOf(page).then((b) => b.length), { timeout: 15_000 }).toBe(2);
    const [b1, b2] = await buildingsOf(page);

    const elBox = async (id) => page.evaluate((elId) => {
      const g = document.querySelector(`[data-el-id="${elId}"]`);
      const body = g && g.querySelector("rect, path");
      const r = body.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, id);

    await openProps(page, b1.id);
    const field = page.getByRole("textbox", { name: "Building number" });
    await expect(field).toHaveValue("1");
    await field.fill("2");
    await field.press("Enter");
    await expect(page.getByText(/That number belongs to Building 2/)).toBeVisible();

    await page.keyboard.press("Escape"); // instead of Cancel
    await expect(page.getByRole("textbox", { name: "Building number" })).toHaveCount(0); // panel closed (B1125)

    // Reselect the SAME building via a direct double-click (no intervening selection of anything
    // else) — the exact case that left the old conflict state stale.
    const b1Box = await elBox(b1.id);
    await page.mouse.dblclick(b1Box.x, b1Box.y);
    await page.waitForTimeout(300);
    await expect(page.getByText(/That number belongs to/)).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Building number" })).toHaveValue("1");

    const bs = await buildingsOf(page);
    expect(numberOf(bs, b1.id)).toBeUndefined(); // never committed
    expect(numberOf(bs, b2.id)).toBeUndefined();
  });
});
