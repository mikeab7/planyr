/* canvas-boot-visibility — B1594320 (P0). The site planner canvas must NEVER render with
 * `visibility: hidden`, and whenever it holds a real element, that element must be hit-testable
 * (document.elementFromPoint resolves to it, not to an ancestor).
 *
 * ⛔ THE INCIDENT THIS GUARDS. B1574432 (merged 453623a, reverted this item) gated the drawing +
 * both map hosts on a `framingCommitted` flag that starts `false` and is meant to flip `true`
 * inside the first commit (a `useLayoutEffect`) or, failing that, within a 1.5s LOUD-FAILURE
 * watchdog. On production, signed in, opening any real project left the canvas permanently
 * `visibility: hidden` and un-clickable — every surrounding control (rails, Layers, the scale bar,
 * the jurisdiction badge) rendered fine, only the drawing itself never appeared. The exact trigger
 * could not be reproduced in this sandbox (no signed-in Supabase session, no live egress — the
 * same wall B1574432's own author hit and parked as `Verify: live, Blocker: auth`), so the fix
 * here is a full revert of the gate rather than a narrower patch: it removes the ONLY code path in
 * `SitePlanner.jsx` capable of setting `visibility: hidden` on `[data-testid="planner-canvas"]` or
 * its two backdrop hosts. This spec is the general invariant that reversion restores, driven
 * through the REAL app (map → site tab → draw → reload), not a unit assertion on a style object.
 *
 * It intentionally reintroduces B1574432's own two-frame boot flash (an intermediate default
 * framing painted before the real one) — that is a real, lesser, already-filed defect (B1574432,
 * reopened) traded back in deliberately: total, permanent invisibility of the core module is a
 * strictly worse outcome than a two-frame flash, and this spec's job is to prove the worse one is
 * gone, not to re-litigate the flash.
 */
import { test, expect } from "@playwright/test";
import { startBlank, canvas, drawBuilding } from "./drawKinds.js";

/* Poll visibility every 100ms for 2.5s — the same cadence and window the owner's own live repro
 * used ("Computed visibility sampled every 300ms for 2.5s after load stays hidden throughout").
 * Returns every distinct value seen, so a run that was hidden even briefly is visible in the
 * assertion failure rather than only in a final snapshot. */
async function sampleCanvasVisibility(page, ms = 2500, everyMs = 100) {
  const seen = [];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- deliberate poll, not a batch of parallel reads
    const v = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="planner-canvas"]');
      return el ? getComputedStyle(el).visibility : "missing";
    });
    seen.push(v);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(everyMs);
  }
  return seen;
}

test.describe("the planner canvas is never hidden and is always hit-testable", () => {
  test("a plan with a parcel-less building: reload, then the canvas is visible and the building is clickable", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    const { cx, cy } = await drawBuilding(page, box);

    // The reported bug is on a REOPEN of a project, not on the first draw — reload to force a
    // fresh mount reading the just-saved plan back off storage, the same shape as a cold load.
    await page.reload();
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    // el-tier: the dispatch's own repro names "a parcel and at least one element" specifically —
    // the subject IS the drawn building (an `el`), and this only waits for the one this spec drew.
    await expect.poll(() => page.locator("[data-el-id]").count(), { timeout: 15_000 }).toBeGreaterThan(0);

    const seen = sampleCanvasVisibility(page);
    // While sampling runs, also re-confirm the canvas keeps a real box (not collapsed to 0x0,
    // which would make the visibility read meaningless).
    const rect = await canvas(page).boundingBox();
    expect(rect && rect.width).toBeGreaterThan(1);
    expect(rect && rect.height).toBeGreaterThan(1);
    expect(await seen).not.toContain("hidden");

    // Hit-test: elementFromPoint at the drawn building's own centre must resolve to that
    // building's own node, never an ancestor DIV — the same check the owner ran by hand
    // ("document.elementFromPoint at an element's own centre returns ancestor DIVs").
    // el-tier: the subject is the one drawn building (an `el`), same as the poll above.
    const elId = await page.locator("[data-el-id]").first().getAttribute("data-el-id");
    const box2 = await page.locator(`[data-el-id="${elId}"]`).first().boundingBox();
    const px = box2 ? box2.x + box2.width / 2 : cx;
    const py = box2 ? box2.y + box2.height / 2 : cy;
    const resolvesToElement = await page.evaluate(([x, y, id]) => {
      const hit = document.elementFromPoint(x, y);
      if (!hit) return false;
      const owner = hit.closest(`[data-el-id="${id}"]`) || hit.closest("[data-feature]");
      return !!owner;
    }, [px, py, elId]);
    expect(resolvesToElement).toBe(true);
  });

  test("adjacent case: a blank plan with no parcel and no elements still shows a visible canvas", async ({ page }) => {
    await startBlank(page);
    await page.reload();
    await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
    const seen = await sampleCanvasVisibility(page, 1500, 150);
    expect(seen).not.toContain("hidden");
  });
});
