/**
 * Headless verification for the team project-sharing UI (left-rail share menu + shared badge).
 * Runs LOGGED OUT (the sandbox can't sign in), so it verifies the two things observable without auth:
 *   1) A project whose model carries teamId renders the "Shared with team" badge in the rail.
 *   2) The right-click project menu opens and does NOT offer "Share with team" when there are no
 *      teams loaded (logged-out → myTeams empty) — i.e. the control is correctly auth/owner-gated,
 *      and the new MapFinder code doesn't crash the page.
 * Auth-only paths (actually sharing to a team, team home) need a signed-in check the sandbox can't run.
 *
 * Run:  node ui-audit/verify-team-share.mjs   (preview server must be running on :4173)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const sites = {
  s_shared:  { id: "s_shared",  groupId: "s_shared",  site: "Katy Shared Site",   name: "Plan 1", status: "active",  teamId: "team-abc", origin: { lat: 29.77, lon: -95.38 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
  s_private: { id: "s_private", groupId: "s_private", site: "Cypress Private Site", name: "Plan 1", status: "pursuit", origin: { lat: 29.75, lon: -95.36 }, county: "harris", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures++; };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  // 1) Both project rows render.
  const sharedRow = page.locator("text=Katy Shared Site").first();
  const privateRow = page.locator("text=Cypress Private Site").first();
  check(await sharedRow.count() > 0, "shared project row renders");
  check(await privateRow.count() > 0, "private project row renders");

  // 2) Shared badge present on the shared project, absent on the private one.
  const badges = page.locator('[aria-label="Shared with team"]');
  check(await badges.count() === 1, `exactly one shared badge renders (got ${await badges.count()})`);

  // 3) Right-click the private project → menu opens with status options but NO "Share with team"
  //    (logged out → no teams), and the page didn't crash.
  await privateRow.click({ button: "right" }).catch(() => {});
  await page.waitForTimeout(400);
  const menuHasStatus = await page.locator("text=On hold").count() > 0 || await page.locator("text=Pursuit").count() > 0;
  check(menuHasStatus, "right-click project menu opens (status options visible)");
  const shareHeader = await page.locator("text=Share with team").count();
  check(shareHeader === 0, "share-with-team control is hidden when logged out (no teams)");

  check(errors.length === 0, `no uncaught page errors (got ${errors.length}${errors.length ? ": " + errors[0] : ""})`);

  await browser.close();
  console.log(failures === 0 ? "\nVERIFY-TEAM-SHARE: all checks passed" : `\nVERIFY-TEAM-SHARE: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
