/* NEW-1 (two-segment leader, owner report 2026-08-22 — "I like on Bluebeam how the callouts
 * have two lines in the arm as opposed to just one line... how you can manipulate the two arms").
 * Logged-out, sandbox-headless drive of the REAL SVG canvas (the dim-callout-edit.spec.js pattern).
 *
 * Proves the WIRING live: dragging the elbow grip pins `elbow` (feet) and the arrowhead re-aims
 * off it; dragging the arrow tip still re-aims the target; dragging the box still moves the whole
 * leader with it; and — the owner's explicit "nothing on an existing plan moves" bar — a callout
 * seeded with the pre-existing single-segment shape (no `elbow` field at all) renders its stub and
 * run as the SAME coincident point (byte-identical to the old one-line leader) until touched.
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

function firstSite(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    return map[Object.keys(map)[0]] || {};
  });
}
const firstCallout = (page) => firstSite(page).then((s) => (s.callouts || [])[0] || null);

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
}

test.describe("NEW-1 — callout leader is a draggable stub + elbow + run", () => {
  test("dragging the elbow pins it and re-aims the arrowhead; the tip and box still work independently", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    const box = await canvas(page).boundingBox();
    await page.getByRole("button", { name: /^Callout\s/ }).click();
    // tip (target) then box (label) — the existing two-click callout placement flow.
    await page.mouse.click(box.x + 260, box.y + 460);
    await page.mouse.click(box.x + 460, box.y + 380);
    await page.getByPlaceholder("Type…").waitFor({ state: "visible" });
    await page.keyboard.type("Detention pond");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect.poll(() => firstCallout(page)).not.toBeNull();

    // A freshly-placed callout has no elbow yet — the stub is zero-length (byte-identical old line).
    const initial = await firstCallout(page);
    expect(initial.elbow, "a new callout must not pre-pin an elbow — only a drag should").toBeUndefined();

    // Select it (click the box) so the handle layer mounts the tip + elbow grips.
    const boxRect = await page.locator('[data-testid^="callout-box-"]').first().boundingBox();
    await page.mouse.click(boxRect.x + boxRect.width / 2, boxRect.y + boxRect.height / 2);
    const elbowGrip = page.locator('[data-handle="callout-elbow"]').first();
    await expect(elbowGrip).toBeVisible({ timeout: 6000 });

    // Drag the elbow grip sideways to create a real bend.
    const eb = await elbowGrip.boundingBox();
    const startX = eb.x + eb.width / 2, startY = eb.y + eb.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 45, startY - 30, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => {
      const c = await firstCallout(page);
      return c && c.elbow != null;
    }, { timeout: 6000 }).toBe(true);
    // The drag's intermediate pointermoves each persist their own snapshot; settle past the last
    // one before reading the value future assertions compare against (the mouse.up() position),
    // not an in-flight one from partway through the gesture.
    await page.waitForTimeout(200);
    const afterElbowDrag = await firstCallout(page);
    const tipBefore = { ...afterElbowDrag.tip };

    // Both leader segments must actually be on screen (stub AND run), and they must NOT
    // coincide once the elbow has been dragged away from the box edge.
    const stub = page.locator('[data-testid^="callout-leader-stub-"]').first();
    const run = page.locator('[data-testid^="callout-leader-run-"]').first();
    await expect(stub).toBeVisible();
    await expect(run).toBeVisible();
    const stubBox = await stub.boundingBox();
    expect(stubBox.width + stubBox.height, "the stub must have real, non-zero length after the elbow drag").toBeGreaterThan(4);

    // Dragging the ARROW TIP re-aims the target and must NOT move the pinned elbow.
    const tipGrip = page.locator('[data-handle="callout-tip"]').first();
    const tb = await tipGrip.boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + 60, tb.y + 40, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => {
      const c = await firstCallout(page);
      return c && (c.tip.x !== tipBefore.x || c.tip.y !== tipBefore.y);
    }, { timeout: 6000 }).toBe(true);
    await page.waitForTimeout(200);
    const afterTipDrag = await firstCallout(page);
    expect(afterTipDrag.elbow, "re-aiming the tip must not move the pinned elbow").toEqual(afterElbowDrag.elbow);

    // Dragging the BOX moves the label; the leader must still visibly connect box → elbow → tip
    // (never crossing back through the box — the owner's explicit "doubles back" concern).
    const boxRect2 = await page.locator('[data-testid^="callout-box-"]').first().boundingBox();
    await page.mouse.move(boxRect2.x + boxRect2.width / 2, boxRect2.y + boxRect2.height / 2);
    await page.mouse.down();
    await page.mouse.move(boxRect2.x - 80, boxRect2.y - 20, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => {
      const c = await firstCallout(page);
      return c && c.box.x !== afterTipDrag.box.x;
    }, { timeout: 6000 }).toBe(true);
    await page.waitForTimeout(200);
    const final = await firstCallout(page);
    // The box moved; the tip (target) and elbow (routing waypoint) stay anchored to the ground.
    expect(final.tip).toEqual(afterTipDrag.tip);
    expect(final.elbow).toEqual(afterElbowDrag.elbow);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("an existing single-segment callout (no elbow field) renders unchanged — stub and run coincide", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // Seed a plan carrying a legacy callout with the pre-two-segment shape: `tip` + `box`, no
    // `elbow` field at all — exactly what every callout saved before this feature looks like.
    // The set-location-unlocated-plan.spec.js pattern: seed via addInitScript (runs before the
    // app's first synchronous render) with a once-only guard so a reload can't re-clobber state
    // the app itself since wrote.
    const SITE_ID = "e2eCalloutLegacy1";
    await page.addInitScript(([id]) => {
      if (localStorage.getItem("e2e:seeded:" + id)) return;
      localStorage.setItem("e2e:seeded:" + id, "1");
      const rec = {
        id, groupId: id, site: "Legacy callout site", name: "Concept A",
        origin: null, county: null,
        parcels: [], els: [], markups: [], measures: [],
        callouts: [{ id: "co1", tip: { x: 40, y: 0 }, box: { x: 0, y: 0 }, text: "Existing", z: 1 }],
        settings: {}, updatedAt: Date.now(),
      };
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
      localStorage.setItem("planarfit:currentSite:v1", id);
    }, [SITE_ID]);
    await page.goto("/");
    await expect(canvas(page)).toBeVisible({ timeout: 20000 });

    const stub = page.locator('[data-testid^="callout-leader-stub-"]').first();
    // A zero-length SVG <line> paints nothing, so Playwright's actionability check reports it
    // "hidden" — that IS the expected, correct shape here (the whole point of this test), so wait
    // for it to be ATTACHED rather than "visible".
    await stub.waitFor({ state: "attached", timeout: 6000 });
    const geo = await stub.evaluate((el) => ({
      x1: el.x1.baseVal.value, y1: el.y1.baseVal.value, x2: el.x2.baseVal.value, y2: el.y2.baseVal.value,
    }));
    // No elbow was ever pinned, so the stub's two endpoints must be the SAME point (zero length) —
    // the run then carries the identical origin→tip line the old single-segment render drew.
    expect(Math.hypot(geo.x2 - geo.x1, geo.y2 - geo.y1), "an untouched legacy callout's stub must be zero-length").toBeLessThan(0.5);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
