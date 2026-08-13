/* NEW-2 — ONE OF EACH KIND COUNTS AS FIVE, off the real render.
 *
 * THE MISS THIS SPEC EXISTS TO CLOSE. Every census in this repo counted `[data-el-id]`, which is on
 * ELEMENTS ONLY, while a plan is made of five drawn kinds. Measured live on the owner's signed-in
 * Silvestri pair (V27088, 2026-08-09, build 7307342): a cross-plan paste landed three markup
 * objects and the element count read **120 before, 120 after** — a complete no-op — while the app
 * correctly reported the paste. A false "paste succeeds silently but writes nothing" was one
 * keystroke from being filed against a feature that is fine.
 *
 * `test/featureCensus.test.js` pins the counting RULE and sweeps the source. This pins the CONTRACT
 * WITH THE RENDER, which no unit test can see: that the app really does stamp `data-feature` on all
 * five kinds, that the census really does find them, and — the mutation control, in the same run —
 * that an element-only counter really does answer ONE on the very same canvas.
 *
 * Runs LOGGED OUT against a seeded-blank site, so it is Claude-verifiable in full here.
 */
import { test, expect } from "@playwright/test";
import { startBlank, canvas, drawOneOfEachKind, drawPolygonMarkup, plans } from "./drawKinds.js";
import { FEATURE_KINDS, censusFrom, censusDiff } from "../ui-audit/lib/featureCensus.mjs";

/** The census, read the way every harness now reads it: distinct `data-feature` keys. */
const census = async (page) => censusFrom(await page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  return svg ? [...svg.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature")) : [];
}));

/** el-tier: THE MUTATION CONTROL. This is the counter the spec exists to retire, kept deliberately
 *  so the blind answer and the honest one are read off the SAME canvas in the SAME run — without it
 *  "the census says five" is a number with nothing to be five against. The source sweep in
 *  test/featureCensus.test.js correctly flags this shape everywhere else. */
const elementOnlyCount = (page) => page.evaluate(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  return svg ? svg.querySelectorAll("[data-el-id]").length : 0;
});

test.describe("the plan census sees every drawn kind", () => {
  test("one of each kind counts as FIVE — while an element-only counter answers ONE", async ({ page }) => {
    test.slow(); // five real draw flows
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    const empty = await census(page);
    expect(empty.total, "a blank plan is zero features").toBe(0);

    await drawOneOfEachKind(page, box);

    // The persisted record says one of each — so what follows is about the RENDER, not the model.
    const rec = (await plans(page))["Concept A"];
    expect({ els: rec.els, markups: rec.markups, measures: rec.measures, callouts: rec.callouts, parcels: rec.parcels })
      .toEqual({ els: 1, markups: 1, measures: 1, callouts: 1, parcels: 1 });

    const c = await census(page);
    expect(c.total, `census keys: ${JSON.stringify(c.keys)}`).toBe(5);
    expect(c.byKind).toEqual({ el: 1, markup: 1, measure: 1, callout: 1, parcel: 1 });
    for (const kind of FEATURE_KINDS) {
      expect(c.keys.some((k) => k.startsWith(`${kind}:`)), `${kind} is missing its data-feature stamp`).toBe(true);
    }
    expect(c.unknown, "a drawn kind the census does not know must be NAMED, not swallowed").toEqual([]);

    /* ⛔ THE MUTATION CONTROL, in the same run and on the same canvas: the counter this spec
     * retires answers ONE here. That is the 120-vs-145 gap, reproduced small enough to assert. */
    expect(await elementOnlyCount(page), "an el-only counter sees one fifth of this plan").toBe(1);

    expect(errors).toEqual([]);
  });

  test("a change the element count cannot see is VISIBLE to the census", async ({ page }) => {
    /* The live failure, in miniature: add a markup, and confirm the element count does not move
     * while the census names exactly what arrived. This is the assertion that would have refused
     * the false "paste writes nothing" report. */
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    await drawPolygonMarkup(page, box);
    const before = await census(page);
    const elsBefore = await elementOnlyCount(page);

    await page.keyboard.press("l"); // a markup LINE — a second markup, still zero elements
    await page.mouse.move(box.x + box.width * 0.14, box.y + box.height * 0.84);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.34, box.y + box.height * 0.84, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => plans(page).then((p) => p["Concept A"].markups), { timeout: 15_000 }).toBe(2);

    const after = await census(page);
    const diff = censusDiff(before, after);

    expect(await elementOnlyCount(page), "the element count is blind to this — that is the bug").toBe(elsBefore);
    expect(after.total).toBe(before.total + 1);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]).toMatch(/^markup:/);
    expect(diff.removed).toEqual([]);

    expect(errors).toEqual([]);
  });
});
