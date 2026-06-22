/* B389 — verify the Light/Dark/System picker moved into account → Settings, driven headless
 * against ui-audit/theme-in-profile-harness.html:
 *   1. signed OUT: AppHeader still shows the row-1 theme gear (B342 — reachable signed out);
 *   2. signed IN:  AppHeader shows NO theme gear (it lives in account → Settings now);
 *   3. the AuthPanel Settings tab renders the ThemePicker with Light/Dark/System options;
 *   4. clicking an option actually changes the app theme (data-theme on <html>) — proving the
 *      picker works from its new home, not just renders.
 * Run: npm run dev &  then  node ui-audit/verify-b389-theme-in-profile.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:5173";
const HARNESS_URL = `${BASE}/ui-audit/theme-in-profile-harness.html`;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
let pageErrors = 0;
page.on("pageerror", (e) => { pageErrors++; console.log("  [pageerror]", String(e).slice(0, 160)); });

try {
  await page.goto(HARNESS_URL, { waitUntil: "load" });
  await page.waitForSelector('[data-theme-picker]', { timeout: 15000 }); // AuthPanel Settings tab (modal) rendered
  await page.waitForTimeout(400);

  // 1/2) Gear present signed-out, absent signed-in.
  const gear = await page.evaluate(() => {
    const inScope = (scope) => {
      const root = document.querySelector(`[data-scope="${scope}"]`);
      return !!(root && root.querySelector('button[aria-label="Settings"]'));
    };
    return { signedOut: inScope("signedout"), signedIn: inScope("signedin") };
  });
  ok("signed OUT: row-1 theme gear still present (B342 preserved)", gear.signedOut);
  ok("signed IN: row-1 theme gear is GONE (moved to account → Settings)", !gear.signedIn);

  // 3) AuthPanel Settings tab renders the ThemePicker with the three options.
  const picker = await page.evaluate(() => {
    const ap = document.querySelector('[data-scope="authpanel"]');
    const tp = ap && ap.querySelector('[data-theme-picker]');
    const opt = (id) => !!(ap && ap.querySelector(`[data-theme-opt="${id}"]`));
    return { present: !!tp, light: opt("light"), dark: opt("dark"), system: opt("system") };
  });
  ok("account → Settings shows the ThemePicker", picker.present);
  ok("ThemePicker offers Light / Dark / System", picker.light && picker.dark && picker.system);

  // 4) Clicking an option changes the app theme (data-theme on <html>) — functional, not a no-op.
  const clickOpt = (id) => page.evaluate((i) => {
    const ap = document.querySelector('[data-scope="authpanel"]');
    ap.querySelector(`[data-theme-opt="${i}"]`)?.click();
  }, id);
  const theme = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

  await clickOpt("dark"); await page.waitForTimeout(200);
  const afterDark = await theme();
  ok("clicking Dark switches the app to dark", afterDark === "dark", `data-theme=${afterDark}`);

  await clickOpt("light"); await page.waitForTimeout(200);
  const afterLight = await theme();
  ok("clicking Light switches the app to light", afterLight === "light", `data-theme=${afterLight}`);

  ok("no uncaught page errors", pageErrors === 0, `pageErrors=${pageErrors}`);
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await browser.close();
  process.exit(passed === results.length && results.length >= 7 ? 0 : 1);
}
