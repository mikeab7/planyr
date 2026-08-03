/* NEW-4 — THE PARCEL ACREAGE CHIP MUST BE MOVABLE AND REMOVABLE.
 *
 * Two owner reports, one surface: "make it so we can delete the parcel acreage chips" and
 * "be able to move the parcel acreage chips".
 *
 * The MOVE half was already implemented in code — `startAcChip`, the `acChip` drag branch, and
 * `pc.labelOffset` persisted in feet — so the report read as impossible until it was reproduced.
 * This spec is that reproduction, and it is written against the REAL render rather than the
 * source because the defect is invisible to a source reading: the chip carries
 * `pointerEvents: auto` only while its OWN lot is selected (B1327's fix for
 * CHROME-NEVER-EATS-A-PRESS), and on a developed plan `polylabel` parks the chip in the middle
 * of the lot — on top of a building. So pressing the chip selects the BUILDING underneath, the
 * lot never becomes selected, the chip never becomes grabbable, and the drag can never start.
 * A gate that can only be opened from behind itself.
 *
 * Both halves are asserted through what a user can actually do:
 *   1. MOVE — press the chip and drag; its rendered box must end up somewhere else, and the
 *      offset must survive a reload.
 *   2. DELETE — hide the chip from its own right-click menu; the chip must disappear while the
 *      parcel stays in the plan (and in the yield math), and the hide must survive a reload.
 *   3. The B1327 guarantee must still hold: a press on the chip may never be swallowed.
 *
 * Run: npx playwright test e2e/parcel-chip-move-delete.spec.js
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const chips = (p) => p.locator('[data-print-chip="acre"]');

const SITE_ID = "e2e-parcel-chip";

/* A deliberately simple plan: ONE square parcel with ONE building parked over its middle — the
 * exact geometry that makes the chip unreachable, at the smallest size that reproduces it. */
function seedPlan() {
  const P = 900; // parcel half-size, feet
  return {
    id: SITE_ID, groupId: SITE_ID, site: "Chip Test", name: "chip",
    origin: null, county: "harris",
    parcels: [{
      id: "pc-1", active: true,
      points: [{ x: -P, y: -P }, { x: P, y: -P }, { x: P, y: P }, { x: -P, y: P }],
    }],
    // A building centred on the parcel's pole of inaccessibility (its centre) — so the acreage
    // chip lands on top of it, which is the whole point of the repro.
    els: [{ id: "e-bldg", type: "building", cx: 0, cy: 0, w: 700, h: 500, rot: 0, z: 10 }],
    measures: [], callouts: [], markups: [], settings: {}, underlay: null,
    parcelDrawings: [], updatedAt: Date.now(),
  };
}

async function loadPlan(page) {
  await armPlannerHooks(page);
  const site = seedPlan();
  /* Seed ONCE. `addInitScript` re-runs on every navigation, so an unconditional write would put
     the pristine plan back on `page.reload()` — and the reload assertions below (does the edit
     actually persist?) would then be testing the seed rather than the app. */
  await page.addInitScript(([id, rec]) => {
    if (!localStorage.getItem("planarfit:sites:v1"))
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect(chips(page).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(900); // let the fit / label passes settle
}

const chipBox = async (page) => {
  const b = await chips(page).first().boundingBox();
  return b ? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } : null;
};

/* What the browser's own hit test says answers a press at the chip's centre. */
const answerAtChip = async (page) => {
  const c = await chipBox(page);
  return page.evaluate(({ x, y }) => {
    const n = document.elementFromPoint(x, y);
    return {
      chip: !!(n && n.closest && n.closest('[data-print-chip="acre"]')),
      elId: n && n.closest ? (n.closest("[data-el-id]") || {}).getAttribute?.("data-el-id") ?? null : null,
      tag: n ? n.tagName : null,
    };
  }, c);
};

const savedParcel = (page) => page.evaluate((id) => {
  const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return ((all[id] || {}).parcels || [])[0] || null;
}, SITE_ID);

test.describe("NEW-4 — the parcel acreage chip can be moved and hidden", () => {
  test("MOVE: dragging the chip relocates it, with nothing pre-selected", async ({ page }) => {
    await loadPlan(page);
    const before = await chipBox(page);
    expect(before, "the acreage chip should render").toBeTruthy();

    // The chip becomes a hit target on HOVER (see the render site), so the pointer must be over it
    // before the button goes down — exactly what a real hand does.
    await page.mouse.move(before.x, before.y);
    await page.waitForTimeout(200);
    const armed = await page.evaluate(() => {
      const g = document.querySelector('[data-print-chip="acre"]');
      return g ? getComputedStyle(g).pointerEvents : "missing";
    });
    expect(armed, "the chip did not arm on hover").toBe("auto");
    await page.mouse.down();
    await page.mouse.move(before.x + 90, before.y - 70, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await chipBox(page);
    expect(after, "the chip should still render after the drag").toBeTruthy();
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    expect(moved, "the chip did not move — the drag never started").toBeGreaterThan(40);

    // It is stored on the PARCEL (feet), so it belongs to the plan and survives a reload.
    const pc = await savedParcel(page);
    expect(pc && pc.labelOffset, "labelOffset was not persisted onto the parcel").toBeTruthy();
    await page.reload();
    await expect(chips(page).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(900);
    const reloaded = await chipBox(page);
    expect(Math.hypot(reloaded.x - after.x, reloaded.y - after.y)).toBeLessThan(25);
  });

  test("DELETE: the chip's own right-click menu hides it, and the parcel stays", async ({ page }) => {
    await loadPlan(page);
    const at = await chipBox(page);
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(200);
    await page.mouse.click(at.x, at.y, { button: "right" });
    const hide = page.getByRole("button", { name: /hide acreage label|hide label/i }).first();
    await expect(hide).toBeVisible({ timeout: 5_000 });
    await hide.click();
    await page.waitForTimeout(300);

    await expect(chips(page)).toHaveCount(0);
    // The PARCEL is untouched — this hides a label, it does not deactivate a lot.
    const pc = await savedParcel(page);
    expect(pc.active, "hiding the label must not deactivate the parcel").not.toBe(false);
    expect(pc.chipHidden).toBe(true);

    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(chips(page)).toHaveCount(0);
  });

  test("UNDO: hiding the chip is one undo frame", async ({ page }) => {
    await loadPlan(page);
    const at = await chipBox(page);
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(200);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByRole("button", { name: /hide acreage label|hide label/i }).first().click();
    await expect(chips(page)).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(chips(page)).toHaveCount(1);
  });

  test("CHROME-NEVER-EATS-A-PRESS still holds: the chip never swallows a press", async ({ page }) => {
    await loadPlan(page);
    const at = await chipBox(page);
    // Nothing selected. A left press at the chip must produce a visible outcome — either the
    // chip's own drag arms, or the press reaches the building underneath. Never nothing.
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(250);
    const selected = await page.evaluate(() =>
      !!document.querySelector("[data-handle-layer] [data-vtx], [data-handle-layer] circle, [data-sel-kind]"));
    const answer = await answerAtChip(page);
    expect(answer.chip || !!answer.elId, "the press landed on nothing at all").toBe(true);
    expect(selected || answer.chip, "the press produced no visible outcome").toBe(true);
  });
});
