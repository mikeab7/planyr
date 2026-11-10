/* NEW-1 — the Site Planner's LEFT module rail (Land · Analysis · Drainage · Yield · Properties · Overlays · Standards) never scrolls
 * sideways, and when it scrolls vertically its scrollbar sits OUTSIDE the labels. Owner screenshot (Windows Chrome, classic
 * scrollbars that take real width): a horizontal bar along the rail's bottom and a vertical thumb over the right edge of
 * "Analysis" / "Drainage" / "Properties". Its own file for the same reason as tool-rail-scrollbar: Playwright's headless Chromium
 * passes --hide-scrollbars, which would make every width read as an overlay scrollbar (the macOS case the bug never showed on).
 *
 * The claim, measured on the real rendered rail at several window heights / "zoom" levels (zoom = a smaller CSS viewport):
 *   · scrollWidth === clientWidth  (nothing to scroll sideways, ever);
 *   · every label's TEXT box sits fully inside the rail's visible area (left of the scrollbar), uncropped, centred under its icon;
 *   · a tall window shows no scrollbar at all; a short window scrolls vertically only;
 *   · the open panel's left edge sits flush against the rail (nothing between them, nothing overlapping).
 */
import { test, expect } from "@playwright/test";
import { startBlank } from "./drawKinds.js";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--no-sandbox", "--ignore-certificate-errors"], ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) } });

async function open(page, viewport, theme = "light") {
  await page.addInitScript((t) => { try { localStorage.setItem("planyr.theme", t); } catch { /* ignore */ } }, theme);
  await startBlank(page);
  await page.setViewportSize(viewport);
  await expect(page.locator("[data-rail-tab]").first()).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

/** Everything the claim needs, read off the real rail in one pass. */
const measure = (page) => page.evaluate(() => {
  const tabs = [...document.querySelectorAll("[data-rail-tab]")];
  const rail = tabs[0].parentElement;
  const rr = rail.getBoundingClientRect();
  const sbW = rail.offsetWidth - rail.clientWidth - (parseFloat(getComputedStyle(rail).borderRightWidth) || 0) - (parseFloat(getComputedStyle(rail).borderLeftWidth) || 0);
  const visibleRight = rr.left + (parseFloat(getComputedStyle(rail).borderLeftWidth) || 0) + rail.clientWidth; // the edge the scrollbar starts at
  const labels = tabs.map((t) => {
    const span = [...t.children].find((c) => c.tagName === "SPAN" && c.textContent.trim() && !c.querySelector("svg"));
    const range = document.createRange(); range.selectNodeContents(span);
    const tr = range.getBoundingClientRect(); // the TEXT's own box, not the span's
    const ic = t.querySelector("svg").getBoundingClientRect();
    return { id: t.getAttribute("data-rail-tab"), text: span.textContent, left: tr.left, right: tr.right, cx: (tr.left + tr.right) / 2, iconCx: (ic.left + ic.right) / 2, overflowsBox: span.scrollWidth > span.clientWidth + 0.5 };
  });
  const panel = document.querySelector('[data-testid="left-menu-panel"]');
  return {
    scrollW: rail.scrollWidth, clientW: rail.clientWidth, scrollH: rail.scrollHeight, clientH: rail.clientHeight,
    overflowX: getComputedStyle(rail).overflowX, sbW, railLeft: rr.left, railRight: rr.right, visibleRight, labels,
    panelLeft: panel ? panel.getBoundingClientRect().left : null,
  };
});

const SIZES = [
  { name: "tall window (no scrollbar expected)", viewport: { width: 1440, height: 1400 }, scrolls: false },
  { name: "short window (vertical scroll only)", viewport: { width: 1440, height: 420 }, scrolls: true },
  { name: "125% zoom, short", viewport: { width: 1152, height: 380 }, scrolls: true },
  { name: "80% zoom, short", viewport: { width: 1800, height: 430 }, scrolls: true },
];

test.describe("left module rail — no sideways scroll, scrollbar never covers a label", () => {
  for (const theme of ["light", "dark"]) {
    for (const s of SIZES) {
      test(`${s.name}, ${theme}`, async ({ page }) => {
        await open(page, s.viewport, theme);
        const m = await measure(page);
        // 1. never a horizontal scrollbar, and nothing to scroll sideways
        expect(m.overflowX, "overflow-x is hidden").toBe("hidden");
        expect(m.scrollW, `scrollWidth ${m.scrollW} === clientWidth ${m.clientW}`).toBe(m.clientW);
        // 2. vertical scroll only when the window is short
        expect(m.scrollH > m.clientH, `scrolls vertically: ${m.scrollH} vs ${m.clientH}`).toBe(s.scrolls);
        // 3. every label fully inside the visible rail (left of the scrollbar), uncropped, centred under its icon
        for (const l of m.labels) {
          expect(l.overflowsBox, `${l.text}: text fits its own box`).toBe(false);
          expect(l.left, `${l.text}: left edge inside the rail`).toBeGreaterThanOrEqual(m.railLeft - 0.01);
          expect(l.right, `${l.text}: right edge left of the scrollbar (${m.visibleRight})`).toBeLessThanOrEqual(m.visibleRight + 0.01);
          expect(Math.abs(l.cx - l.iconCx), `${l.text}: centred under its icon`).toBeLessThanOrEqual(1);
        }
        if (s.scrolls) await page.screenshot({ path: test.info().outputPath(`left-rail-${theme}-${s.viewport.height}.png`), clip: { x: 0, y: 0, width: 200, height: Math.min(s.viewport.height, 460) } });
      });
    }
  }

  test("the open Land panel sits flush against the rail", async ({ page }) => {
    await open(page, { width: 1440, height: 420 });
    await page.locator('[data-rail-tab="parcel"]').click();
    await expect(page.getByTestId("left-menu-panel")).toBeVisible();
    const m = await measure(page);
    expect(Math.abs(m.panelLeft - m.railRight), "panel starts at the rail's right edge").toBeLessThanOrEqual(1);
  });
});
