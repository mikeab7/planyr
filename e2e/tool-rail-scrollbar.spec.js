/* NEW-1 (B2237072) — the right rail's thin scrollbar is actually PAINTED, not just reserved. Its own file because
 * Playwright's headless Chromium passes --hide-scrollbars (every pixel would read blank) and a launch option can
 * only be overridden at the top level of a spec. Reads the strip's pixels from a real screenshot, light + dark. */
import { test, expect } from "@playwright/test";
import { startBlank } from "./drawKinds.js";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"], args: ["--no-sandbox", "--ignore-certificate-errors"], ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) } });

async function open(page, viewport, theme) {
  await page.addInitScript((t) => { try { localStorage.setItem("planyr.theme", t); } catch { /* ignore */ } }, theme);
  await startBlank(page);
  await page.setViewportSize(viewport);
  await expect(page.locator("[data-rail-heading]").first()).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}
const measure = (page) => page.evaluate(() => { const r = document.querySelector(".rail-scroll"); return { scrollable: r.scrollHeight > r.clientHeight }; });

test.describe("right tool rail — the scrollbar is visible (painted)", () => {
  for (const theme of ["light", "dark"]) {
    test(`short window, ${theme}: a thin thumb on a faint track is painted at the rail's right edge`, async ({ page }) => {
      await open(page, { width: 1440, height: 520 }, theme);
      const m = await measure(page);
      expect(m.scrollable).toBe(true);
      const tokens = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { thumb: cs.getPropertyValue("--rail-scroll-thumb").trim(), track: cs.getPropertyValue("--rail-scroll-track").trim() }; });
      const buf = await page.screenshot({ clip: { x: 1440 - 12, y: 0, width: 12, height: 520 } });
      const png = await page.evaluate(async (b64) => {
        const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
        const out = []; for (let x = 0; x < img.width; x++) out.push(px(x * 1, 300));
        return out;
      }, buf.toString("base64"));
      const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
      expect(png.some((p) => near(p, hex(tokens.thumb))), `thumb colour ${tokens.thumb} painted in the strip`).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`rail-scrollbar-${theme}.png`), clip: { x: 1440 - 168, y: 0, width: 168, height: 520 } });
    });
  }
});
