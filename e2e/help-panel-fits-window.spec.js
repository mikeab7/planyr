/* NEW-2 (2026-10-22, work-laptop report: "the question mark help button isn't even working").
 * The ? popover swaps a short menu for a TALLER Help / Report view in the same portal. The placement was measured once, for the
 * short menu, so on a short window the taller view hung off the bottom with its Back button gone (measured at 1913×641 @2.68:
 * panel bottom 753 in a 641 window). Every view of the popover must stay on screen, with Back reachable, in the windows
 * that matter: the owner's work laptop, a short desktop, a phone upright and a phone on its side.
 * Red-proven on ff7be38 (laptop: Help panel bottom 753 > 641). Works signed out — the control is mounted on every route. */
import { test, expect } from "@playwright/test";

const SIZES = [
  { name: "work laptop 1913x641 @2.68", viewport: { width: 1913, height: 641 }, dsf: 2.68 },
  { name: "short desktop 1600x521 @2.15", viewport: { width: 1600, height: 521 }, dsf: 2.15 },
  { name: "phone upright 390x844", viewport: { width: 390, height: 844 }, dsf: 3 },
  { name: "phone sideways 844x390", viewport: { width: 844, height: 390 }, dsf: 3 },
  { name: "very short 640x300", viewport: { width: 640, height: 300 }, dsf: 1 },
];

const panelBox = (page) => page.evaluate(() => {
  const m = document.querySelector("[data-menu-layer]");
  if (!m) return null;
  const r = m.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight, scrollable: m.scrollHeight > m.clientHeight + 1 };
});
const expectOnScreen = (b, what) => {
  expect(b, `${what}: panel exists`).not.toBeNull();
  expect(b.top, `${what}: top edge on screen`).toBeGreaterThanOrEqual(-0.5);
  expect(b.bottom, `${what}: bottom edge on screen (${Math.round(b.bottom)} vs window ${b.vh})`).toBeLessThanOrEqual(b.vh + 0.5);
  expect(b.left, `${what}: left edge on screen`).toBeGreaterThanOrEqual(-0.5);
  expect(b.right, `${what}: right edge on screen`).toBeLessThanOrEqual(b.vw + 0.5);
};
/* the Back button must be on screen AND the topmost thing at its own centre (a clipped box can still report a rect) */
const backReachable = (page) => page.evaluate(() => {
  // found by its text inside the popover (not by test id) so this same spec runs unmodified against the pre-fix build
  const el = [...document.querySelectorAll("[data-menu-layer] button")].find((b) => b.textContent.trim() === "Back");
  if (!el) return { ok: false, why: "no such button" };
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { ok: false, why: `centre (${Math.round(x)},${Math.round(y)}) is outside the ${innerWidth}x${innerHeight} window` };
  const top = document.elementFromPoint(x, y);
  return { ok: !!top && (top === el || el.contains(top)), why: top ? `topmost at its centre is <${top.tagName.toLowerCase()}>` : "nothing there" };
});

for (const sz of SIZES) {
  test.describe(sz.name, () => {
    test.use({ viewport: sz.viewport, deviceScaleFactor: sz.dsf });

    test("menu, Help and Report views all stay on screen and Back is reachable", async ({ page }) => {
      await page.goto("/?planyrDiag=1#/site");
      const fab = page.locator('[data-testid="help-report-fab"]');
      await expect(fab).toBeVisible({ timeout: 30000 });
      await fab.click();
      await expect(page.locator("[data-menu-layer]")).toBeVisible();
      await page.waitForTimeout(250);
      expectOnScreen(await panelBox(page), "menu");

      await page.getByRole("button", { name: "Help", exact: true }).click();
      await expect(page.locator("[data-menu-layer]").getByRole("button", { name: "Back", exact: true })).toBeAttached();
      await page.waitForTimeout(250);
      expectOnScreen(await panelBox(page), "Help view");
      const hb = await backReachable(page);
      expect(hb.ok, `Help → Back reachable: ${hb.why}`).toBe(true);
      await page.locator("[data-menu-layer]").getByRole("button", { name: "Back", exact: true }).dispatchEvent("click");

      await page.getByRole("button", { name: "Report a problem", exact: true }).click();
      await expect(page.locator("[data-menu-layer]").getByRole("button", { name: "Back", exact: true })).toBeAttached();
      await page.waitForTimeout(250);
      expectOnScreen(await panelBox(page), "Report view");
      const rb = await backReachable(page);
      expect(rb.ok, `Report → Back reachable: ${rb.why}`).toBe(true);
      await page.locator("[data-menu-layer]").getByRole("button", { name: "Back", exact: true }).dispatchEvent("click");
      // and back on the menu the panel is still on screen
      await page.waitForTimeout(250);
      expectOnScreen(await panelBox(page), "menu again");
    });
  });
}
