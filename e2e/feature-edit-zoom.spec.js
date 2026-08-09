/* NEW-2 — the on-building +/− edit controls must not arm until the edit they make is legible.
 *
 * OWNER REPORT (Bain / "Concept - Original", 109 acres, whole site in the viewport, scale bar
 * reading 0–1,000 FEET): the green + and red − rendered at FULL SIZE over Buildings 3 and 4, the
 * largest objects on a plan he was trying to read, while the bump-out one of them places was a few
 * pixels wide. "I shouldn't be zoomed out this far and they show up. I should have to zoom in more."
 *
 * ⛔ WHY THIS SPEC EXISTS BESIDE THE UNIT SUITE. `test/featureEditZoom.test.js` proves the RULE and
 * proves the wiring by reading the source. Neither can see whether the gate is asked with the right
 * number at runtime — the render body reasons at `rppf`, the anchored render view, and a build that
 * fed it `view.ppf` would pass every source assertion while fading against the wrong zoom
 * mid-gesture. So this drives a real browser: it reads the app's own published `data-render-ppf`
 * and asserts the controls' presence against the SAME threshold the library exports, at zooms
 * either side of it.
 *
 * Logged out, on a blank seeded site, no GIS calls — ATTEMPT-BEFORE-YOU-PARK.
 */
import { test, expect } from "@playwright/test";
import { FEAT_EDIT_MIN_PPF } from "../src/workspaces/site-planner/lib/featureEditZoom.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const editNodes = (p) => p.getByTestId("feature-edit-nodes");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// One 1.12× wheel step per event (the handler ignores magnitude).
async function wheelZoom(page, steps, dir /* -1 in, +1 out */) {
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dir * 120); await page.waitForTimeout(16); }
}

const renderPpf = (page) => page.evaluate(() => {
  const g = document.querySelector("[data-render-ppf]");
  return g ? Number(g.getAttribute("data-render-ppf")) : null;
});

/* A LARGE building, deliberately: this is the whole point of the item. A small building was
 * already gated by B225's footprint rule, so it could never have shown the defect — only a
 * building big enough to clear that rule at a wide zoom can. */
async function drawBuilding(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = box.x + 200, y1 = box.y + 160, x2 = box.x + 700, y2 = box.y + 460;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 80, y1 + 50, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape"); // back to Select
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

test.describe("NEW-2 — the +/− edit controls wait for a zoom where the edit means something", () => {
  test("they are gone at whole-site zoom, return on zoom-in, and track the published threshold", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await startBlank(page);
    const c = await drawBuilding(page);

    // Select the building — the controls render for exactly one building (B225/B226), the selected
    // one or the one under the cursor. The selection survives every zoom below, so from here on
    // the ONLY variable is the zoom.
    await page.mouse.click(c.cx, c.cy);
    // el-tier: the subject of this item IS a building element, and the only thing being waited on
    // here is that the one building drawn above has rendered. This is not a census — no count is
    // taken, and the other four drawn kinds cannot exist on this blank plan (COUNT-EVERY-KIND).
    await expect(page.locator("[data-el-id]").first()).toBeVisible();

    // THE OWNER'S CASE. A blank plan opens at a whole-site zoom, and the building just drawn spans
    // most of the viewport — so B225's footprint gate is comfortably satisfied and anything hidden
    // here is hidden by the NEW-2 zoom gate alone. Before this item the controls were here.
    const widePpf = await renderPpf(page);
    expect(widePpf, "the default blank-plan view is a whole-site zoom").toBeLessThan(FEAT_EDIT_MIN_PPF);
    await expect.poll(() => editNodes(page).count()).toBe(0);

    // Zoom in past the threshold and they arrive.
    await wheelZoom(page, 12, -1);
    const closePpf = await renderPpf(page);
    expect(closePpf, "the wheel-in should cross the threshold").toBeGreaterThanOrEqual(FEAT_EDIT_MIN_PPF);
    await expect.poll(() => editNodes(page).count(), { timeout: 10_000 }).toBeGreaterThan(0);

    // FADE, NOT A HIT-TEST GATE: whenever they are on screen they are fully interactive. A
    // half-faded control that ignored a press would be its own bug.
    const opacities = await editNodes(page).evaluateAll((ns) => ns.map((n) => Number(n.getAttribute("opacity"))));
    expect(opacities.length).toBeGreaterThan(0);
    for (const o of opacities) expect(o).toBeGreaterThan(0);
    const pe = await editNodes(page).first().evaluate((n) => getComputedStyle(n).pointerEvents);
    expect(pe).not.toBe("none");

    // …and back out to the overview: gone again, so the gate is a live function of the zoom rather
    // than a one-way reveal.
    await wheelZoom(page, 12, +1);
    expect(await renderPpf(page)).toBeLessThan(FEAT_EDIT_MIN_PPF);
    await expect.poll(() => editNodes(page).count()).toBe(0);

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
