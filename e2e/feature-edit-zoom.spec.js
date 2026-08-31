/* B312544 · NEW-1 — the on-building +/− edit controls must not arm until the edit they make is
 * legible, and the threshold for that is derived from the CONTROL, not from a touch-target figure.
 *
 * OWNER REPORT (Bain / "Concept - Original", 109 acres, whole site in the viewport, scale bar
 * reading 0–1,000 FEET): the green + and red − rendered at FULL SIZE over Buildings 3 and 4, the
 * largest objects on a plan he was trying to read, while the bump-out one of them places was a few
 * pixels wide. "I shouldn't be zoomed out this far and they show up. I should have to zoom in more."
 *
 * OWNER AMENDMENTS, twice. First on the shipped #990 build: "you did go a little too far… now you
 * really have to zoom in, but way too much to where the building almost becomes most of the screen
 * by the time that you can increase or decrease it" (0.80 → 0.359 px/ft). Then on THAT build: "it
 * still shows up for the Zoom and the plus minus. Let's make it available a little bit sooner" —
 * so the floor is now an OWNER-SET 0.25 px/ft PLUS a viewport cap, and this spec asks the library
 * for the floor IN FORCE ON THIS CANVAS rather than for a constant. What it independently proves
 * is that the app asks the gate with the right zoom AND the right canvas width at runtime.
 *
 * ⛔ WHY THIS SPEC EXISTS BESIDE THE UNIT SUITE. `test/featureEditZoom.test.js` proves the RULE and
 * proves the wiring by reading the source. Neither can see whether the gate is asked with the right
 * number at runtime — the render body reasons at `rppf`, the anchored render view, and a build that
 * fed it `view.ppf` would pass every source assertion while fading against the wrong zoom
 * mid-gesture; and the viewport half of the floor is a function of the MEASURED canvas, which no
 * source reading can evaluate. So this drives a real browser: it reads the app's own published
 * `data-render-ppf`, measures the real canvas, and asserts the controls' presence against the SAME
 * floor the library computes for that width, at zooms either side of it.
 *
 * Logged out, on a blank seeded site, no GIS calls — ATTEMPT-BEFORE-YOU-PARK.
 */
import { test, expect } from "@playwright/test";
import { FEAT_EDIT_MIN_PPF, featureEditFloorPpf } from "../src/workspaces/site-planner/lib/featureEditZoom.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const editNodes = (p) => p.getByTestId("feature-edit-nodes");

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
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

/* ⛔ READ THE ZOOM ONLY ONCE THE GESTURE HAS SETTLED. The gate is asked with `rppf` — the anchored
 * RENDER view — and mid-gesture that deliberately LAGS the live view while one group transform
 * carries the picture (the view anchor, B1440/B1449). Reading `data-render-ppf` in the frame after
 * the last wheel notch therefore returns the zoom the gesture STARTED at, not the one it ended at.
 * That is correct product behaviour and a broken measurement, and it is the FOREGROUND-OR-VOID
 * family: a self-consistent number describing a view the app has already left. So poll until the
 * render view has caught up with `data-view-ppf` (the live zoom), then read. */
async function settledPpf(page) {
  await expect.poll(async () => page.evaluate(() => {
    const g = document.querySelector("[data-render-ppf]");
    if (!g) return false;
    const r = Number(g.getAttribute("data-render-ppf")), v = Number(g.getAttribute("data-view-ppf"));
    return Number.isFinite(r) && Number.isFinite(v) && Math.abs(r - v) <= v * 1e-6;
  }), { timeout: 10_000 }).toBe(true);
  return renderPpf(page);
}

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

test.describe("B312544/NEW-1 — the +/− edit controls wait for a zoom where the edit means something", () => {
  test("they are gone at the overview zoom, return on zoom-in, and track the floor in force", async ({ page }) => {
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

    /* THE FLOOR IN FORCE HERE, measured rather than assumed. The gate is the EARLIER of the
     * owner-set absolute floor and a cap expressed as a fraction of the CANVAS WIDTH, so the
     * threshold this run must clear depends on the window Playwright happens to open. Ask the
     * library with the real canvas width — the same question the app asks with `size.w`. */
    const canvasW = (await canvas(page).boundingBox()).width;
    const floor = featureEditFloorPpf(canvasW);
    expect(floor).toBeLessThanOrEqual(FEAT_EDIT_MIN_PPF);

    /* THE OWNER'S CASE. Zoom OUT to an overview: the building still spans plenty of screen, so
     * B225's footprint gate is comfortably satisfied and anything hidden here is hidden by the
     * ZOOM gate alone. Before this item the controls were here, at full strength. */
    await wheelZoom(page, 14, +1);
    const widePpf = await settledPpf(page);
    expect(widePpf, "the wheel-out should drop below the floor").toBeLessThan(floor);
    await expect.poll(() => editNodes(page).count()).toBe(0);

    // Zoom in past the threshold and they arrive.
    await wheelZoom(page, 14, -1);
    const closePpf = await settledPpf(page);
    expect(closePpf, "the wheel-in should cross the floor").toBeGreaterThanOrEqual(floor);
    await expect.poll(() => editNodes(page).count(), { timeout: 10_000 }).toBeGreaterThan(0);

    /* ⛔ FADE, NOT A HIT-TEST GATE — the owner's standing requirement, and the half a source
     * reading cannot check. Whenever they are on screen they are fully interactive: opacity is
     * presentation only, and a half-faded control that ignored a press would be its own bug. So
     * this asserts the real hit test, not just the computed style — `elementFromPoint` at a
     * control disc's own centre must land INSIDE the control group. */
    const opacities = await editNodes(page).evaluateAll((ns) => ns.map((n) => Number(n.getAttribute("opacity"))));
    expect(opacities.length).toBeGreaterThan(0);
    for (const o of opacities) expect(o).toBeGreaterThan(0);
    const pe = await editNodes(page).first().evaluate((n) => getComputedStyle(n).pointerEvents);
    expect(pe).not.toBe("none");
    const hit = await page.evaluate(() => {
      const group = document.querySelector('[data-testid="feature-edit-nodes"]');
      const discs = [...group.querySelectorAll("circle")];
      return discs.slice(0, 6).map((d) => {
        const r = d.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
        return { faded: Number(group.getAttribute("opacity")), inside: !!(el && group.contains(el)) };
      });
    });
    expect(hit.length).toBeGreaterThan(0);
    for (const h of hit) expect(h.inside, `a control at opacity ${h.faded} did not answer its own centre`).toBe(true);

    // …and back out to the overview: gone again, so the gate is a live function of the zoom rather
    // than a one-way reveal.
    await wheelZoom(page, 14, +1);
    expect(await settledPpf(page)).toBeLessThan(floor);
    await expect.poll(() => editNodes(page).count()).toBe(0);

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
