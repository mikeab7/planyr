/* B1189 — a fast Escape after the Properties rail click must not take the planner down.
 *
 * The repro is a RACE, so the assertion has to be driven fast enough to actually enter it: the
 * crash needs the Escape inside roughly the first fifth of a second after the rail click, while
 * the panel-close reflow is still in flight. Anything slower is clean (measured: 400 ms and
 * 600 ms both pass on the UNFIXED build), so a spec that politely waits between the two steps
 * asserts nothing at all. Two things keep this honest:
 *
 *   • The Escape is dispatched in the SAME evaluated tick as the rail click — `el.click()` then
 *     a synchronous `keydown`, with no round trip to the driver in between. That is strictly
 *     faster than two separate Playwright actions and cannot drift with machine speed.
 *   • It runs several times. The window is real but not certain on every attempt; one pass is
 *     enough to make the assertion meaningful, and repeating it is what makes it reliable.
 *
 * PROVEN RED before it was accepted: on the pre-fix build this fails on the first iteration with
 * the canvas gone and `Minified React error #185` ("Maximum update depth exceeded") on the page —
 * the whole planner replaced by the error boundary.
 *
 * The two layers of B1189 are asserted separately and BOTH matter:
 *   1. the loop is gone            → no update-depth error is ever raised, and the canvas lives;
 *   2. it could not nuke the app   → even if one were raised, the boundary self-heals rather than
 *                                    parking on a terminal card (asserted directly in
 *                                    test/errorBoundaryRecovery.test.js, which does not need the
 *                                    race to fire).
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

function buildingCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).filter((e) => e.type === "building").length;
  });
}

async function startBlank(page) {
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
}

async function drawBuilding(page, ox = 320, oy = 250) {
  const b = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = b.x + ox, y1 = b.y + oy, x2 = x1 + 240, y2 = y1 + 160;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 70, y1 + 50, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => buildingCount(page)).toBeGreaterThanOrEqual(1);
}

/* Click the Properties rail tab and press Escape with NO driver round trip in between — the
 * whole point is that the two land inside one measurement/reflow window. */
async function propertiesThenImmediateEscape(page) {
  return page.evaluate(() => {
    const tab = document.querySelector('[data-rail-tab="properties"]') || document.querySelector('button[title="Properties"]');
    // Report rather than throw: when the planner has already been replaced by the boundary the
    // rail is gone with it, and an opaque "selector not found" would hide WHY.
    if (!tab) return { ok: false, why: document.querySelector('[data-testid="boundary-error"]') ? "planner replaced by the error boundary" : "rail missing" };
    tab.click();
    const ev = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent("keydown", ev));
    document.dispatchEvent(new KeyboardEvent("keydown", ev));
    return { ok: true };
  });
}

test.describe("B1189 — a measurement loop can never take the planner down", () => {
  test("Properties then an immediate Escape leaves the planner alive", async ({ page }) => {
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(String(e.message || e)));
    page.on("console", (m) => { if (m.type() === "error" && /update depth|React error #185/i.test(m.text())) crashes.push(m.text()); });

    await startBlank(page);
    await drawBuilding(page);

    for (let i = 0; i < 6; i++) {
      const fired = await propertiesThenImmediateEscape(page);
      expect(fired.ok, `iteration ${i + 1}: could not run the sequence — ${fired.why}`).toBe(true);
      await page.waitForTimeout(250);

      // The planner itself must still be on the page. This is the assertion that goes red on the
      // pre-fix build: the boundary had swapped the whole subtree for its error card.
      await expect(page.getByTestId("boundary-error"), `planner blanked to the error boundary on iteration ${i + 1}`).toHaveCount(0);
      await expect(canvas(page), `planner canvas gone on iteration ${i + 1}`).toBeVisible();

      // Re-open for the next pass (the rail tab toggles).
      if (i < 5) await page.locator('[data-rail-tab="properties"]').first().click().catch(() => {});
      await page.waitForTimeout(120);
    }

    // And the loop must not have fired at all — the boundary's self-heal is a safety net for
    // the unknown, not a licence for this known cycle to keep running.
    expect(crashes.filter((c) => /update depth|React error #185/i.test(c)), crashes.join("\n")).toEqual([]);

    // Still a working planner: the drawing survived and the rail still responds.
    expect(await buildingCount(page)).toBeGreaterThanOrEqual(1);
  });
});
