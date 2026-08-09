/* NEW-1 / NEW-2 — a copy survives a plan switch, and every drawn kind pastes into the sibling plan.
 *
 * THE REPORT. "I can't copy elements between pages of the same project… I go to the print concept
 * versus the same one just not the print concept, and I can't copy a polygon over."
 *
 * THE POINT OF THIS FILE. `test/planClipboard.test.js` already unit-tests the clipboard module and
 * passes — because the defect was never in the module. Each plan is its own record with its own id,
 * `SitePlannerApp` mounts `SitePlanner` with `key={activeSiteId:loadEpoch}`, and the payload lived
 * in a ref INSIDE that component: switching plans remounted it and destroyed the copy. **The mount
 * boundary is the thing under test, and no unit test on the module can see one.** That is the same
 * shape as the double-click contract audit — the logic was covered, the wiring was not.
 *
 * NEGATIVE CONTROL. Every case here was run against the pre-fix build and failed there: the paste
 * produced nothing at all, and the canvas menu showed Paste disabled with "Copy a shape or drawing
 * first". Do not weaken an assertion to a "did not crash" — the pre-fix build does not crash.
 *
 * COVERAGE. One of EACH kind in CLIP_KINDS — element · markup (the owner's polygon) · measure ·
 * callout · parcel — plus a MIXED multi-selection, because a one-kind test is exactly what would
 * let this class through again. Plus the other in-session remounts a user actually hits: a
 * workspace switch (Site → Sequence → Site) and a plan RENAME.
 *
 * Runs LOGGED OUT against a seeded-blank site, so it is Claude-verifiable here in full (the
 * ATTEMPT-BEFORE-YOU-PARK rule). The signed-in half — a cross-plan paste reaching `site_elements`
 * for the DESTINATION plan on a real cloud project — is the live V### in VERIFICATION.md.
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";
/* NEW-2 — the five draw flows and the on-disk plan reader now live in e2e/drawKinds.js, so
 * e2e/feature-census.spec.js can seed the identical canvas without a second copy of them. */
import {
  canvas, planCrumb, plans, planNamed, selectTool, startBlank,
  drawPolygonMarkup, drawBuilding, drawLengthMeasure, drawCallout, drawParcel,
} from "./drawKinds.js";

/* ── plan navigation ────────────────────────────────────────────────────────────────────── */

/* Create the sibling plan the copies will be pasted into, and come straight back. Done through the
 * real header dropdown — the same two clicks the owner makes — so the remount under test is the
 * genuine one, not a simulated re-render.
 *
 * The line drawn on the new plan is NOT decoration: a plan that is still blank AND has no map
 * location is deliberately DROPPED when you leave it (`persistOrDrop` in SitePlanner.jsx), so an
 * empty Concept B would delete itself the moment we switched back to Concept A and there would be
 * nothing left to paste into. One markup line makes it a real plan. It is also the baseline every
 * assertion below counts from, and it proves a paste ADDS to the destination rather than replacing
 * what was already there. */
async function addSiblingPlan(page) {
  await planCrumb(page).click();
  await page.getByRole("button", { name: /New plan/ }).click();
  await expect(planCrumb(page)).toContainText("Concept B", { timeout: 15_000 });
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  const box = await canvas(page).boundingBox();
  await page.keyboard.press("l");
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.86);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.30, box.y + box.height * 0.86, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => planNamed(page, "Concept B").then((p) => p && p.markups), { timeout: 15_000 }).toBe(1);
  await selectTool(page);
  await switchToPlan(page, "Concept A");
}

/* What Concept B holds before anything is pasted into it. */
const B_BASELINE = { els: 0, markups: 1, measures: 0, callouts: 0, parcels: 0 };

async function switchToPlan(page, name) {
  await planCrumb(page).click();
  await page.getByRole("button", { name: new RegExp(`^${name}$`) }).click();
  await expect(planCrumb(page)).toContainText(name, { timeout: 15_000 });
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300); // let the fresh mount settle before it takes a keystroke
}

/* Select one drawn object by clicking it where it actually IS, read off the render. Every
 * feature's outermost group stamps `data-feature="<kind>:<id>"` (B50008), so this never depends on
 * remembering where it was drawn — a fresh mount re-fits the view, so a remembered screen point
 * from before a plan switch is not the same point after one.
 *
 * `edge: true` aims at the top of the shape rather than its middle, for the unfilled shapes — a
 * markup polygon and a parcel ring are selected by their OUTLINE, and a click in the middle of one
 * passes straight through. */
async function selectFeature(page, target, { edge = false } = {}) {
  await selectTool(page);
  const node = typeof target === "string" ? page.locator(`[data-feature^="${target}:"]`).first() : target;
  await expect(node).toBeVisible({ timeout: 10_000 });
  const bb = await node.boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, edge ? bb.y + 1 : bb.y + bb.height / 2);
  await page.waitForTimeout(250);
}
const selectPolygon = (page) => selectFeature(page, "markup", { edge: true });


/* Copy the current selection, then cross the plan boundary and paste. This IS the repro. */
async function copySwitchPaste(page, { from = "Concept A", to = "Concept B" } = {}) {
  await page.keyboard.press("Control+c");
  await page.waitForTimeout(150);
  await switchToPlan(page, to);
  await canvas(page).click({ position: { x: 700, y: 420 } }); // focus the canvas, deselect nothing
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(400);
  return { from, to };
}

/* ── the cases ─────────────────────────────────────────────────────────────────────────────── */

test.describe("the canvas clipboard survives a plan switch (logged out)", () => {
  test("THE REPORT: a polygon copied on one plan pastes into the sibling plan", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPolygonMarkup(page, box);
    await addSiblingPlan(page);

    // Select the polygon on Concept A, copy it, switch plans, paste.
    await selectPolygon(page);
    await copySwitchPaste(page);

    // PRE-FIX: it stayed at the baseline — the ref died with the unmounted component and Ctrl+V
    // was a no-op, with the menu showing Paste disabled.
    await expect.poll(() => planNamed(page, "Concept B").then((p) => p && p.markups), { timeout: 15_000 })
      .toBe(B_BASELINE.markups + 1);
    // The polygon arrived, and Concept B's own line is still there — a paste ADDS, it never replaces.
    expect((await planNamed(page, "Concept B")).markupKinds).toEqual(["line", "polygon"]);
    // …and the original is still on the plan it was copied from. A copy is not a move.
    expect((await planNamed(page, "Concept A")).markups).toBe(1);

    /* WHERE it landed, which is the other half of the fix. A cross-plan paste is placed by the
     * FRAME relation between the two plans, not by the cursor — these two plans share an origin,
     * so the copy arrives on exactly the ground it occupied on Concept A. That also settles the
     * question the per-mount pointer ref raised: a fresh mount has no pointer history, and it does
     * not matter, because a cross-plan paste never consults the cursor. */
    const geom = await page.evaluate(() => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const recs = Object.values(map);
      const pts = (name, kind) => {
        const r = recs.find((x) => x && x.name === name) || {};
        const m = (r.markups || []).find((q) => q.kind === kind);
        return m ? (m.pts || []).map((q) => [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100]) : null;
      };
      return { a: pts("Concept A", "polygon"), b: pts("Concept B", "polygon") };
    });
    expect(geom.a).not.toBeNull();
    expect(geom.b).toEqual(geom.a);
    expect(errors).toEqual([]);
  });

  test("every kind in the clipboard crosses: element, markup, measure, callout, parcel — plus a mixed selection", async ({ page }) => {
    test.slow(); // five draw flows and four plan switches in one run
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    // Concept A gets one of everything. The sibling is created FIRST (right after the markup) so
    // it inherits nothing — `New plan (same parcel)` copies the parcels across, which would
    // otherwise hand Concept B a lot it never had pasted into it.
    await drawPolygonMarkup(page, box);
    await addSiblingPlan(page);
    await drawBuilding(page, box);
    await drawLengthMeasure(page, box);
    await drawCallout(page, box);
    await drawParcel(page, box);

    // (1) MIXED multi-selection — the marquee picks up elements, markups and measurements
    // together, and the whole set must arrive as one paste with its relative geometry intact.
    await page.keyboard.press("m");
    await page.mouse.move(box.x + box.width * 0.27, box.y + box.height * 0.24);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.80, box.y + box.height * 0.68, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await copySwitchPaste(page);
    await expect.poll(() => planNamed(page, "Concept B").then((p) => p && p.markups), { timeout: 15_000 })
      .toBe(B_BASELINE.markups + 1);
    const afterMixed = await planNamed(page, "Concept B");
    expect(afterMixed.markupKinds, "the polygon crossed").toEqual(["line", "polygon"]);
    expect(afterMixed.els, "the building crossed").toBe(B_BASELINE.els + 1);
    expect(afterMixed.measures, "the measurement crossed").toBe(B_BASELINE.measures + 1);

    // (2) CALLOUT — its own single-selection copy (the marquee deliberately does not pick these up).
    await switchToPlan(page, "Concept A");
    // The callout GROUP spans its leader too, so its bounding box is mostly empty space — aim at
    // the text box itself.
    await selectFeature(page, page.locator('[data-testid^="callout-box-"]').first());
    await copySwitchPaste(page);
    await expect.poll(() => planNamed(page, "Concept B").then((p) => p && p.callouts), { timeout: 15_000 })
      .toBe(B_BASELINE.callouts + 1);

    // (3) PARCEL — selected by clicking its boundary, as a user does.
    await switchToPlan(page, "Concept A");
    await selectFeature(page, page.getByTestId("parcel-outline").first(), { edge: true });
    await copySwitchPaste(page);
    await expect.poll(() => planNamed(page, "Concept B").then((p) => p && p.parcels), { timeout: 15_000 })
      .toBe(B_BASELINE.parcels + 1);

    // Everything Concept A started with is still on Concept A.
    const a = await planNamed(page, "Concept A");
    expect({ els: a.els, markups: a.markups, measures: a.measures, callouts: a.callouts, parcels: a.parcels })
      .toEqual({ els: 1, markups: 1, measures: 1, callouts: 1, parcels: 1 });
    expect(errors).toEqual([]);
  });

  test("the copy also survives a workspace switch on the way (Site → Sequence → Site)", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPolygonMarkup(page, box);
    await addSiblingPlan(page);

    await selectPolygon(page);
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(150);

    // Leave the workspace entirely and come back, then cross the plan boundary.
    await openModule(page, "scheduler");
    await page.waitForTimeout(600);
    await openModule(page, "site-planner");
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });

    await switchToPlan(page, "Concept B");
    await canvas(page).click({ position: { x: 700, y: 420 } });
    await page.keyboard.press("Control+v");
    await expect.poll(() => planNamed(page, "Concept B").then((p) => p && p.markups), { timeout: 15_000 })
      .toBe(B_BASELINE.markups + 1);
    expect(errors).toEqual([]);
  });

  test("the copy also survives renaming the plan it was copied from", async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPolygonMarkup(page, box);
    await addSiblingPlan(page);

    await selectPolygon(page);
    await page.keyboard.press("Control+c");
    await page.waitForTimeout(150);

    // Rename this plan from the same dropdown the switch lives in, then switch and paste.
    await planCrumb(page).click();
    const nameField = page.getByTestId("plan-name-input");
    await nameField.fill("Print concept");
    await nameField.press("Enter");
    await expect(planCrumb(page)).toContainText("Print concept", { timeout: 15_000 });
    await page.locator('body > div[data-menu-owner="app-header"]').first().click(); // click away to close

    await switchToPlan(page, "Concept B");
    await canvas(page).click({ position: { x: 700, y: 420 } });
    await page.keyboard.press("Control+v");
    await expect.poll(() => planNamed(page, "Concept B").then((p) => p && p.markups), { timeout: 15_000 })
      .toBe(B_BASELINE.markups + 1);
    expect(errors).toEqual([]);
  });
});
