/* NEW-1 (integration) — prove the CloudSyncBadge is actually wired into the LIVE shared
 * header (not just the isolated harness), reflects real per-module state, and survives a
 * module switch without going stale. Logged out (sandbox can't sign in):
 *   • Site Planner with a project open → badge present, showing the on-device state
 *     (NOT a false "synced" green — it honestly reflects "no cloud / signed out");
 *   • switch to Markup with nothing loaded → badge correctly hides (idle = nothing to sync);
 *   • switch back to Site → badge returns (live state, never a stale cache).
 * Run: npm run dev &  then  node ui-audit/verify-new1-header-integration.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// Seed a project so the Site Planner boots straight into the planner view (initial mode =
// "plan" when a current site exists). It needs an `origin` — a blank, un-located site is
// auto-dropped as clutter, which would bounce us back to the map. status at top level per
// CLAUDE.md. Seed after first load, then reload so it's present at boot.
await page.goto(BASE, { waitUntil: "load" });
await page.evaluate(() => {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({
    'new1-test': { id:'new1-test', site:'NEW-1 Test Project', name:'NEW-1 Test Project', status:'active', groupId:'new1-test', origin:{lat:29.76,lon:-95.37}, updatedAt: Date.now() }
  }));
  localStorage.setItem('planarfit:currentSite:v1', 'new1-test');
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2200);

const checks = [];
const ok = (name, cond) => { checks.push({ name, pass: !!cond }); console.log(`  ${cond ? "✓" : "✗"} ${name}`); };

const badge = () => page.locator('header [aria-label^="Cloud sync"]');

// 1) The badge is mounted in the real Row-1 header once a project is open.
await badge().first().waitFor({ timeout: 8000 }).catch(() => {});
const siteCount = await badge().count();
ok("badge present in the live header (project open)", siteCount === 1);
const siteAria = siteCount ? await badge().first().getAttribute("aria-label") : "";
ok("logged-out state is honest on-device (not a fake green 'synced')", /on this device/i.test(siteAria));

// 2) Switch to the Markup module — header survives, and with nothing loaded the badge
//    correctly hides (idle = nothing to sync), proving it tracks real state per module.
await page.evaluate(() => {
  const tab = [...document.querySelectorAll("header button")].find((b) => (b.textContent || "").trim() === "Markup");
  tab && tab.click();
});
await page.waitForTimeout(1600);
const headerStillThere = await page.locator("header").count();
ok("header still renders after switching to Markup (no crash)", headerStillThere >= 1);
ok("badge hides in Markup with nothing loaded (idle → nothing)", (await badge().count()) === 0);

// 3) Switch back to Site — the badge returns with live state (not a stale cache).
await page.evaluate(() => {
  const tab = [...document.querySelectorAll("header button")].find((b) => (b.textContent || "").trim() === "Site");
  tab && tab.click();
});
await page.waitForTimeout(1600);
ok("badge returns after switching back to Site (survives module switch)", (await badge().count()) === 1);

await page.screenshot({ path: new URL("./screens/new1-header-integration.png", import.meta.url).pathname });
await ctx.close();
await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(failed.length ? `\n✗ ${failed.length} check(s) failed.` : "\n✓ Badge is wired into the live header, reflects real per-module state, and survives module switches.");
process.exit(failed.length ? 1 : 0);
