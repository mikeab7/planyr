/* V161 — B520: a fixed top notification banner caps at min(<px>, calc(100vw - 16px)) so its
 * action button stays on-screen at phone width. Still-owed per VERIFICATION.md: "runtime over a
 * phone viewport, not drivable here" (2026-06-27) — wrong; this environment can drive a real
 * phone-width Chromium tab (docs/PHONE-TESTING.md). Logged-out, no external GIS/auth needed.
 *
 * Triggers the real `local-save-failed` banner (SitePlanner.jsx, `data-testid="local-save-failed"`,
 * the B473 "could not be saved on this device" banner with a real "Save now" action button) by
 * blocking `Storage.prototype.setItem` for the site's storage key BEFORE making an edit, then
 * pasting a duplicate element (Ctrl+C/Ctrl+V on the seeded building) so the live model holds more
 * drawn items than what's actually on disk. `saveNow()`'s own read-back-to-verify check
 * (`want > got`) then genuinely fails, exactly as a real full-quota device would.
 *
 * Two viewports are driven — desktop (positive control: the banner/button render at a normal
 * width, proving the trigger technique itself works) and 390px phone width (the actual B520
 * case) — so a failure at phone width can't be blamed on a broken trigger.
 *
 * Run: npm run build && npx vite preview --port 4173
 *      node ui-audit/verify-v161-b520-banner-phone.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITES_KEY = "planarfit:sites:v1";

const sites = { s1: { id: "s1", groupId: "s1", site: "Verify V161", name: "Plan 1", status: "active",
  origin: { lat: 29.78, lon: -95.79 }, county: "harris",
  parcels: [{ id: "p1", points: [{ x: -700, y: -500 }, { x: 700, y: -500 }, { x: 700, y: 500 }, { x: -700, y: 500 }] }],
  els: [{ id: "r1", type: "building", cx: 0, cy: 0, w: 400, h: 200, rot: 0 }], markups: [], updatedAt: Date.now() } };
const seed = `(()=>{try{localStorage.setItem(${JSON.stringify(SITES_KEY)},${JSON.stringify(JSON.stringify(sites))});localStorage.setItem("planarfit:currentSite:v1","s1");}catch(e){}})();`;

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function triggerSaveFailedBanner(viewport, label) {
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-v161-b520-banner-phone");
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  // The app now opens on the Dashboard workspace by default — switch to Site Planner explicitly.
  const tab = page.locator('[data-testid="module-tab-site-planner"]:visible');
  if (await tab.count()) await tab.first().click();
  await page.waitForTimeout(2000);

  // Block the on-device write for THIS site's key before making any edit, so the very first
  // persist attempt (and every one after) fails — the same shape as a full/blocked storage quota.
  await page.evaluate((key) => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === key || (typeof k === "string" && k.startsWith(key + ":p:"))) throw new DOMException("Quota exceeded (test)", "QuotaExceededError");   // B2200384: the plan lives in a per-plan entry now
      return orig.call(this, k, v);
    };
  }, SITES_KEY);

  const canvas = page.getByTestId("planner-canvas");
  const canvasCount = await canvas.count().catch(() => 0);
  if (!canvasCount) { await ctx.close(); return { ok: false, errs, noPlanner: true }; }
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(500);

  await page.locator('[data-testid="plan-crumb"]:visible').first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="save-now"]:visible').first().click();
  await page.waitForTimeout(1500);

  const banner = page.locator('[data-testid="local-save-failed"]');
  const bannerCount = await banner.count();
  const bannerBox = bannerCount ? await banner.boundingBox() : null;
  const btn = banner.locator("button");
  const btnBox = bannerCount ? await btn.boundingBox() : null;
  await page.screenshot({ path: OUT + `v161-b520-${label}.png` }).catch(() => {});
  await ctx.close();
  return { bannerCount, bannerBox, btnBox, errs, viewportWidth: viewport.width };
}

const onScreen = (box, w) => !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= w;

const desktop = await triggerSaveFailedBanner({ width: 1280, height: 850 }, "desktop");
check("positive control — the local-save-failed banner + action button render at desktop width (proves the trigger technique itself works)",
  desktop.bannerCount === 1 && onScreen(desktop.btnBox, 1280), JSON.stringify(desktop));

const phone = await triggerSaveFailedBanner({ width: 390, height: 844 }, "phone390");
check("at 390px phone width, the local-save-failed banner appears", phone.bannerCount === 1, JSON.stringify(phone.bannerBox));
check("the banner itself stays within the 390px viewport (no horizontal clip)", onScreen(phone.bannerBox, 390), JSON.stringify(phone.bannerBox));
check("B520 — the banner's action button ('Save now') is FULLY on-screen at phone width", onScreen(phone.btnBox, 390), JSON.stringify(phone.btnBox));

const allErrs = [...desktop.errs, ...phone.errs];
check("no uncaught page errors", allErrs.length === 0, allErrs.join(" | ").slice(0, 200));

await browser.close();
const failed = results.filter((r) => !r.p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
