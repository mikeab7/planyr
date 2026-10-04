/* start-hint-placement — NEW-1/NEW-2 (2026-09-30, owner report on an iPhone): the empty-site
 * "Start your site" hint sat as a large box across the CENTRE of the map, exactly where he was
 * about to draw.
 *
 * The rules this pins, at phone (390x844) AND desktop:
 *   1. the hint's box never overlaps the central area of the map (middle half, both axes) and
 *      never sits over the canvas' own centre point;
 *   2. starting a site — Draw new parcel (from the rail menu AND from the hint's own option) —
 *      removes it;
 *   3. one tap on its dismiss control removes it and it stays gone across a reload;
 *   4. nothing invisible is left intercepting touches: the canvas centre still answers to the
 *      canvas itself.
 *
 * The card is located by its heading text (not by a test id) so the very same file can be run
 * against the pre-change build as the red proof: there the card is a centred 380px box.
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
  desktop: { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 },
};

async function startBlank(page) {
  await page.goto("/");
  const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await expect(async () => {
    await tab.click({ timeout: 3_000 });
    await expect(tab).toHaveAttribute("aria-current", "page", { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByTestId("map-toolbar-draw").first().click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
}

/* The card: the element carrying the heading text, or its data-testid ancestor. */
const heading = (page) => page.getByText("Start your site", { exact: true }).filter({ visible: true });

async function measure(page) {
  return page.evaluate(() => {
    const cv = document.querySelector('[data-testid="planner-canvas"]');
    const cb = cv.getBoundingClientRect();
    const h = [...document.querySelectorAll("*")].find((n) => n.children.length === 0 && n.textContent.trim() === "Start your site");
    if (!h) return { cb: cb.toJSON(), card: null };
    const card = h.closest('[data-testid="start-hint"]') || h.parentElement;
    const r = card.getBoundingClientRect();
    const cx = cb.x + cb.width / 2, cy = cb.y + cb.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      cb: cb.toJSON(), card: r.toJSON(),
      centreHitsCard: !!top && card.contains(top),
      centreHitIsCanvas: !!top && (top === cv || cv.contains(top) || !!top.closest('[data-testid="planner-canvas"]')),
    };
  });
}

/* Overlap with the central area = the middle half of the canvas on both axes. */
function overlapsCentre({ cb, card }) {
  const cx0 = cb.x + cb.width * 0.25, cx1 = cb.x + cb.width * 0.75;
  const cy0 = cb.y + cb.height * 0.25, cy1 = cb.y + cb.height * 0.75;
  return card.x < cx1 && card.x + card.width > cx0 && card.y < cy1 && card.y + card.height > cy0;
}

for (const [name, dev] of Object.entries(VIEWPORTS)) {
  test.describe(`start hint — ${name}`, () => {
    test.use(dev);

    test("does not cover the middle of the map, and does not eat touches", async ({ page }) => {
      await startBlank(page);
      await expect(heading(page)).toBeVisible({ timeout: 15_000 });
      const m = await measure(page);
      expect(m.card, "hint card found").not.toBeNull();
      expect(overlapsCentre(m), `card ${JSON.stringify(m.card)} overlaps the middle of canvas ${JSON.stringify(m.cb)}`).toBe(false);
      expect(m.centreHitsCard).toBe(false);
      expect(m.centreHitIsCanvas, "canvas centre answers to the canvas").toBe(true);
      await page.screenshot({ path: test.info().outputPath(`start-hint-${name}.png`) });
      await test.info().attach(`start-hint-${name}`, { path: test.info().outputPath(`start-hint-${name}.png`), contentType: "image/png" });
    });

    test("Draw new parcel from the rail menu removes it", async ({ page }) => {
      await startBlank(page);
      await expect(heading(page)).toBeVisible({ timeout: 15_000 });
      if (name === "phone") await page.getByTestId("mobile-tools-tab").click();
      await page.getByRole("button", { name: /Parcel tools/ }).first().click();
      await page.locator('[data-parcel-action="draw"]').click();
      await expect(heading(page)).toHaveCount(0);
    });

    test("the hint's own Trace option starts drawing and removes it", async ({ page }) => {
      await startBlank(page);
      await expect(heading(page)).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("start-hint-draw").click();
      await expect(heading(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Parcel tools/ }).first()).toBeAttached();
    });

    test("dismiss is one tap and survives a reload", async ({ page }) => {
      await startBlank(page);
      await expect(heading(page)).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("start-hint-dismiss").click();
      await expect(heading(page)).toHaveCount(0);
      await page.reload();
      const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
      await tab.waitFor({ state: "visible", timeout: 20_000 });
      await expect(async () => {
        await tab.click({ timeout: 3_000 });
        await expect(tab).toHaveAttribute("aria-current", "page", { timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
      // a reload may reopen the plan straight onto the canvas; only walk the map flow if it did not
      if (!(await canvas(page).isVisible().catch(() => false))) {
        await page.getByTestId("map-toolbar-draw").first().click();
      }
      await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1500);
      await expect(heading(page)).toHaveCount(0);
    });
  });
}
