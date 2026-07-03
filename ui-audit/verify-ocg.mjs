/* Headless verification for B490 — the Document Review PDF "Layers" (optional-content / OCG) toggle,
 * driven in the REAL built viewer (vite preview on :4173), logged-out. Opens a hand-authored 2-layer
 * fixture (e2e/fixtures/sample-ocg.pdf: a RED square on an "Electrical" layer, a BLUE square on a
 * "Plumbing" layer, plus an always-on border), then asserts:
 *   1. the "Layers" button appears and the popover lists Electrical + Plumbing;
 *   2. both squares render (red + blue pixels present on the backdrop);
 *   3. unchecking Electrical actually RE-RASTERS the drawing — red drops to ~0, blue persists;
 *   4. re-checking Electrical brings the red back;
 *   5. no uncaught page errors.
 * Ground truth = the rendered canvas pixels. Run: npm run build && npm run preview &  then
 *   node ui-audit/make-sample-ocg-pdf.mjs && node ui-audit/verify-ocg.mjs
 */
import pw from "/home/user/planyr/node_modules/playwright-core/index.js";
import { mkdirSync } from "node:fs";
const { chromium } = pw;
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PDF = new URL("../e2e/fixtures/sample-ocg.pdf", import.meta.url).pathname;

const results = [];
const ok = (name, pass, detail) => { results.push({ pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };

// Count red / blue pixels on the whole-page BACKDROP canvas (canvas[0] under the markup-overlay's
// parent). The backdrop always holds the full page, so both squares are present regardless of zoom.
const countColors = (page) => page.evaluate(() => {
  const box = document.querySelector('[data-testid="markup-overlay"]')?.parentElement;
  const c = box && box.querySelectorAll("canvas")[0];
  if (!c || !c.width) return { red: -1, blue: -1 };
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let red = 0, blue = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 10) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 150 && g < 80 && b < 80) red++;
    else if (b > 150 && r < 80 && g < 80) blue++;
  }
  return { red, blue };
});
// Poll the backdrop until its red-pixel count crosses a threshold (a re-raster landed).
const waitRed = (page, want) => page.waitForFunction((want) => {
  const box = document.querySelector('[data-testid="markup-overlay"]')?.parentElement;
  const c = box && box.querySelectorAll("canvas")[0];
  if (!c || !c.width) return false;
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let red = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 10 && d[i] > 150 && d[i + 1] < 80 && d[i + 2] < 80) red++; }
  return want === "gone" ? red < 200 : red > 2000;
}, want, { timeout: 6000 });

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const pageErrors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) pageErrors.push(m.text()); });

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  // Switch to the Review (doc-review) workspace, then open the fixture via its file input.
  await page.getByTestId("module-tab-doc-review").click({ timeout: 10000 });
  await page.waitForTimeout(500);
  await page.setInputFiles('input[type="file"]', PDF, { timeout: 10000 });
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-testid="markup-overlay"]')?.parentElement;
    const cs = box ? box.querySelectorAll("canvas") : [];
    return cs.length >= 2 && cs[0].width > 0;
  }, { timeout: 15000 });
  await page.waitForTimeout(500);

  // ---- 1. the Layers button + popover ----
  const layersBtn = page.locator('button[title^="Layers"]');
  ok("1a Layers button appears for a doc with optional content", await layersBtn.count() > 0, `${await layersBtn.count()} button(s)`);
  await layersBtn.first().click({ timeout: 5000 });
  await page.waitForTimeout(200);
  const menuText = await page.locator('[data-testid="layers-menu"]').first().innerText().catch(() => "");
  ok("1b popover lists the two named layers", /Electrical/i.test(menuText) && /Plumbing/i.test(menuText), JSON.stringify(menuText));
  await page.screenshot({ path: OUT + "ocg-layers-open.png" }).catch(() => {});
  // The popover must be genuinely VISIBLE — not clipped by the toolbar row's overflow:hidden (the reason
  // it's portaled). elementFromPoint at its centre must land inside the menu, or a user can't see/click it.
  const onTop = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="layers-menu"]');
    if (!m) return false;
    const r = m.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) return false;
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(el && m.contains(el));
  });
  ok("1c the popover is actually visible (portaled — not clipped by the toolbar overflow)", onTop, `topmost-at-centre inside menu = ${onTop}`);

  // ---- 2. both squares render ----
  const c0 = await countColors(page);
  ok("2 both layers render (red + blue present on the backdrop)", c0.red > 2000 && c0.blue > 2000, `red=${c0.red} blue=${c0.blue}`);

  // ---- 3. uncheck Electrical → red disappears, blue stays ----
  await page.locator('label:has-text("Electrical") input[type="checkbox"]').first().uncheck({ timeout: 5000 });
  let hid = true; try { await waitRed(page, "gone"); } catch (_) { hid = false; }
  const c1 = await countColors(page);
  ok("3a unchecking Electrical re-rasters the drawing — the red layer is gone", hid && c1.red < 200, `red=${c1.red} (was ${c0.red})`);
  ok("3b the OTHER layer (Plumbing/blue) is unaffected", c1.blue > 2000, `blue=${c1.blue}`);

  // ---- 4. re-check Electrical → red returns ----
  await page.locator('label:has-text("Electrical") input[type="checkbox"]').first().check({ timeout: 5000 });
  let back = true; try { await waitRed(page, "back"); } catch (_) { back = false; }
  const c2 = await countColors(page);
  ok("4 re-checking Electrical brings the red layer back", back && c2.red > 2000, `red=${c2.red}`);

  ok("5 no uncaught page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "clean");
} catch (e) {
  ok("harness completed", false, String(e));
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
