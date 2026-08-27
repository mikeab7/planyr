/* NEW-1/NEW-2/NEW-3 (B806080/B806081/B806082) — callout leader interaction, driven on the owner's
 * real Goose Creek geometry (same fixture as markup-behind-building.spec.js) so every check reflects
 * a real element + a real markup covering it, never an empty-canvas fixture that can't see the
 * band/chrome defects these items report.
 *
 * NEW-1 — bring-to-front on a callout was inert once an element/dimension LABEL covered it: no z
 *   value crosses a fixed render-pass boundary. Fixed by moving element labels into the element's
 *   own paint rung (see test/calloutBringToFront.test.js for the source proof); this spec proves the
 *   real picture agrees.
 * NEW-2 — placing/dragging a leader endpoint onto a building or a markup silently missed, because
 *   the element/markup's own pointerdown handler stopped propagation before the canvas's Add Leader
 *   branch ever ran. Fixed with a capture-phase interceptor (test/calloutAddLeaderCapture.test.js).
 * NEW-3 — right-clicking a leader to delete it fell through to the empty-canvas map menu whenever the
 *   press landed on the leader's own re-aim grip (the tip/elbow chrome), which had no context menu of
 *   its own. Fixed by forwarding the grips' right-click to the same handler the leader body already
 *   uses (test/calloutHandleContextMenu.test.js).
 *
 * Run: npx playwright test e2e/callout-leader-interaction.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-callout-leader-interaction";
const BLDG = "e1454729ykduhm"; // the same real 870 × 480 building markup-behind-building.spec.js uses
const MK = "mkOverBuilding";

function seedMarkup() {
  const b = FIXTURE.els.find((e) => e.id === BLDG);
  return {
    id: MK, kind: "rect", cx: b.cx, cy: b.cy, w: b.w + 160, h: b.h + 160, rot: b.rot,
    stroke: "#e11d48", weight: 2, fill: "#e11d48", fillOpacity: 0.35, z: 1000,
  };
}

async function loadPlan(page, { withMarkup = false, callouts = [] } = {}) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Goose Creek", name: "ZZ callout leader interaction",
    origin: null, county: "harris",
    parcels: FIXTURE.parcels, els: FIXTURE.els, measures: [],
    callouts, markups: withMarkup ? [seedMarkup()] : [],
    settings: FIXTURE.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    if (localStorage.getItem("planarfit:currentSite:v1") === id) return;
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  /* el-tier: the readiness gate here really is about the ELEMENT tier — every callout/leader/label
     assertion below is scoped to its own [data-feature]/[data-handle], this is only waiting for the
     building band to be on the canvas at all (same reasoning as markup-behind-building.spec.js). */
  await expect.poll(async () => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThan(10);
  await page.waitForTimeout(1200); // let the fit / label / declutter passes settle
}

const site = (page) => page.evaluate((id) => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return map[id] || {};
}, SITE_ID);

/* The browser's own hit-test at a point, skipping handle-layer/chrome — the same reading
 * markup-behind-building.spec.js uses to answer "which one is on top". */
async function topFeatureAt(page, pt) {
  return page.evaluate(({ x, y }) => {
    for (const n of document.elementsFromPoint(x, y)) {
      const f = n.closest("[data-feature]");
      if (f) return f.getAttribute("data-feature");
    }
    return null;
  }, pt);
}

async function elCenter(page, id) {
  return page.evaluate((elId) => {
    const g = document.querySelector(`[data-el-id="${elId}"]`);
    const r = g.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, id);
}

test.describe("NEW-1 (B806080) — a callout can clear an element's label, not just its geometry", () => {
  test("a callout paints AFTER (over) the element label, not before it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await loadPlan(page);

    const label = page.locator(`[data-label-for="${BLDG}"]`).first();
    await expect(label).toBeVisible({ timeout: 6000 });
    const lb = await label.boundingBox();
    const lp = { x: Math.round(lb.x + lb.width / 2), y: Math.round(lb.y + lb.height / 2) };

    await page.getByRole("button", { name: /^Callout\s/ }).click();
    await page.mouse.click(lp.x, lp.y);         // leader tip, right on the label
    await page.mouse.click(lp.x + 40, lp.y - 40); // box
    await page.getByPlaceholder("Type…").waitFor({ state: "visible" });
    await page.keyboard.type("Front setback note");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    const co = page.locator('[data-testid^="callout-"][data-feature^="callout:"]').first();
    await expect(co).toHaveCount(1);

    // ⛔ The label group is `pointerEvents:none` (only a pond label is hit-testable), so
    // `elementsFromPoint` skips right over it whether or not it visually covers anything — a
    // hit-test check here would silently test the BUILDING's geometry (rung 5/6, never broken)
    // instead of its LABEL (the actual defect). PAINT ORDER is document order in SVG (same
    // reasoning as markup-behind-building.spec.js's `markupCoversBuilding`), so this reads it
    // directly: DOCUMENT_POSITION_FOLLOWING on the label from the callout means the callout is
    // LATER in the DOM, i.e. painted on top of it.
    const calloutOverLabel = await page.evaluate(([labelSel]) => {
      const l = document.querySelector(labelSel);
      const c = document.querySelector('[data-testid^="callout-"][data-feature^="callout:"]');
      if (!l || !c) return null;
      return !!(l.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, [`[data-label-for="${BLDG}"]`]);
    expect(calloutOverLabel, "the callout must paint after (over) the element label").toBe(true);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("NEW-2 (B806081) — Add Leader places the tip wherever the pointer is", () => {
  test("clicking on top of a building AND markup drops the leader there, not a move/select", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const CO = "coAddLeaderTest";
    await loadPlan(page, {
      withMarkup: true,
      callouts: [{ id: CO, tip: { x: FIXTURE.els.find((e) => e.id === BLDG).cx - 200, y: FIXTURE.els.find((e) => e.id === BLDG).cy }, box: { x: FIXTURE.els.find((e) => e.id === BLDG).cx - 400, y: FIXTURE.els.find((e) => e.id === BLDG).cy - 100 }, text: "Existing", z: 1 }],
    });

    const pt = await elCenter(page, BLDG);
    // Precondition — the point really is on both the building and the markup covering it.
    expect(await topFeatureAt(page, pt)).toBe(`markup:${MK}`);

    // Select the callout, then arm Add Leader from its right-click menu.
    const boxRect = await page.locator('[data-testid^="callout-box-"]').first().boundingBox();
    await page.mouse.click(boxRect.x + boxRect.width / 2, boxRect.y + boxRect.height / 2);
    await page.mouse.click(boxRect.x + boxRect.width / 2, boxRect.y + boxRect.height / 2, { button: "right" });
    await page.getByRole("button", { name: "Add Leader" }).click();

    const beforeLeaders = (await site(page)).callouts[0].tips?.length ?? 1;
    const beforeElSel = await page.evaluate((id) => document.querySelector(`[data-el-id="${id}"]`)?.getAttribute("data-selected") ?? null, BLDG);

    await page.mouse.click(pt.x, pt.y);

    await expect.poll(async () => {
      const c = (await site(page)).callouts[0];
      return c.tips ? c.tips.length : (c.tip ? 1 : 0);
    }, { timeout: 6000 }).toBeGreaterThan(beforeLeaders);

    const c = (await site(page)).callouts[0];
    const newTip = c.tips[c.tips.length - 1];
    // The new leader's tip landed at the CLICKED ground point (not merely "somewhere") — round-trip
    // through the app's own projection isn't available here, so this asserts the qualitative fix:
    // the building was neither moved nor selected by that click (the old defect's actual symptom).
    expect(newTip, "the leader must have a real tip, not a degenerate/undefined one").toBeTruthy();
    const afterElSel = await page.evaluate((id) => document.querySelector(`[data-el-id="${id}"]`)?.getAttribute("data-selected") ?? null, BLDG);
    expect(afterElSel, "the building must not have been selected by the placement click").toBe(beforeElSel);
    const bldgAfter = FIXTURE.els.find((e) => e.id === BLDG);
    const liveBldg = (await site(page)).els.find((e) => e.id === BLDG);
    expect(liveBldg.cx, "the building must not have moved").toBe(bldgAfter.cx);
    expect(liveBldg.cy, "the building must not have moved").toBe(bldgAfter.cy);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("NEW-3 (B806082) — right-click a leader's grip to delete it", () => {
  test("right-clicking the tip grip opens Delete Leader, not the empty-canvas map menu", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const b = FIXTURE.els.find((e) => e.id === BLDG);
    const CO = "coTwoLeaders";
    await loadPlan(page, {
      callouts: [{
        id: CO,
        tips: [{ x: b.cx - 150, y: b.cy }, { x: b.cx + 150, y: b.cy }],
        box: { x: b.cx, y: b.cy - 250 },
        text: "Two leaders", z: 1,
      }],
    });

    const boxRect = await page.locator('[data-testid^="callout-box-"]').first().boundingBox();
    await page.mouse.click(boxRect.x + boxRect.width / 2, boxRect.y + boxRect.height / 2);
    const tipGrip = page.locator('[data-handle="callout-tip"]').first();
    await expect(tipGrip).toBeVisible({ timeout: 6000 });
    const tb = await tipGrip.boundingBox();
    const gp = { x: Math.round(tb.x + tb.width / 2), y: Math.round(tb.y + tb.height / 2) };

    // Precondition — the grip really is what a right-click at that exact point resolves to first.
    const topEl = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-handle"), gp);
    expect(topEl).toBe("callout-tip");

    await page.mouse.click(gp.x, gp.y, { button: "right" });
    const menu = page.locator('[role="menu"]');
    const deleteLeader = menu.getByRole("button", { name: "Delete Leader" });
    await expect(deleteLeader).toBeVisible({ timeout: 4000 });
    // The generic empty-canvas menu must NOT be what opened.
    await expect(menu.getByRole("button", { name: /Zoom to fit/i })).not.toBeVisible();

    // A callout's leaders collapse from a `tips[]` array to a singular `tip` field at N=1 (B919's
    // model), so the count has to read either shape rather than assume `tips` survives the delete.
    const leaderCount = (c) => (c.tips ? c.tips.length : (c.tip ? 1 : 0));
    const before = leaderCount((await site(page)).callouts[0]);
    await deleteLeader.click();
    await expect.poll(async () => leaderCount((await site(page)).callouts[0])).toBe(before - 1);

    // Undo restores the deleted leader.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => leaderCount((await site(page)).callouts[0])).toBe(before);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("right-clicking empty canvas away from any callout still opens the ordinary map menu", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await loadPlan(page);
    const box = await canvas(page).boundingBox();
    await page.mouse.click(box.x + 20, box.y + 20, { button: "right" });
    const menu = page.locator('[role="menu"]');
    await expect(menu.getByRole("button", { name: /Zoom to fit/i })).toBeVisible({ timeout: 4000 });
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
