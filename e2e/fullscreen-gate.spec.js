/* NEW-1 — the header's full-screen button exists only where full screen can happen.
 * Playwright's WebKit/Chromium both report the API as supported, so the iPhone case is proven by
 * stubbing it OFF before the app boots (the stub is what stands in for iPhone Safari). */
import { test, expect } from "@playwright/test";

const BTN = '[data-testid="toggle-fullscreen"]';
const stubOff = () => {
  Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false, configurable: true });
  Object.defineProperty(Document.prototype, "webkitFullscreenEnabled", { get: () => undefined, configurable: true });
  Element.prototype.requestFullscreen = undefined;
  Element.prototype.webkitRequestFullscreen = undefined;
};
const stubStandalone = () => {
  const orig = window.matchMedia.bind(window);
  window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : orig(q));
};

test.describe("full-screen button gate", () => {
  test("iPhone-size, API absent: no button and the right zone has no gap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(stubOff);
    await page.goto("/");
    await expect(page.locator('[data-header-zone="right"]').first()).toBeVisible();
    await expect(page.locator(BTN)).toHaveCount(0);
  });
  test("iPad-size, API on: button stays", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto("/");
    await expect(page.locator(BTN).first()).toBeVisible();
  });
  test("installed app (display-mode: standalone): button gone", async ({ page }) => {
    await page.addInitScript(stubStandalone);
    await page.goto("/");
    await expect(page.locator('[data-header-zone="right"]').first()).toBeVisible();
    await expect(page.locator(BTN)).toHaveCount(0);
  });
  test("desktop: button present and toggles real full screen", async ({ page }) => {
    await page.goto("/");
    const b = page.locator(BTN).first();
    await expect(b).toBeVisible();
    await b.click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await expect(page.locator(BTN).first()).toBeVisible(); // the way out never vanishes
    await page.locator(BTN).first().click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  });
});
