/* B881667 — an unknown project sub-route showed the false "your tab is out of date" banner and
 * silently stayed put.
 *
 * Owner report (2026-08-30), live on planyr.io: hard-reload, navigate to
 * `#/project/<id>/review` (the real Review route is `/markup` — `/review` has never existed in
 * ANY build). The "That part of Planyr is newer than the copy this tab has open — reload to get
 * it" banner appeared even though the tab had JUST been hard-reloaded onto the current bundle,
 * the Site tab rendered underneath, and the URL kept reading `/review` forever. Instrumented:
 * zero new resource requests, zero errors — nothing failed to load, because the route never
 * existed to load in the first place; reloading can never fix a route that no build recognizes.
 *
 * Root cause (confirmed by code reading): `shouldOfferReload` treated a route miss as
 * unconditionally sufficient to show the reload banner, with no check against the ACTUAL served
 * build — conflating "a slug shipped in a build newer than this tab's" (a reload fixes it) with
 * "a slug that never existed in any build" (a stale bookmark / old link / typo — no reload can
 * ever fix it). Separately, the URL was never corrected once the fallback module rendered, so a
 * bad link stayed in the address bar indefinitely.
 *
 * Fix: `shouldOfferReload` (buildSkew.js) now requires CONFIRMED build skew before a route miss
 * shows the banner at all; Shell.jsx fires an immediate `/version.json` check the moment a miss
 * is seen (rather than waiting up to 20s), and once that check PROVES this tab is already
 * current, corrects the visible URL to the resolved fallback route via `history.replaceState`
 * (never while skew is still possible, so a genuine "newer build" deep link is never thrown
 * away before the user gets a chance to reload into it).
 *
 * This harness drives the REAL built bundle (its own real, served `/version.json` — no faking —
 * proves the "already current" path) plus a route-intercepted SKEW case (a different served
 * build id, proving the banner still fires and the URL is deliberately NOT corrected). It sweeps
 * several plausible bad aliases, not just "/review" (the class, not the one string), per the
 * task. Logged out, no external GIS — Claude-verifiable here.
 *
 * MUTATION PROOF: run once as-is (green), then `git stash` the buildSkew.js + Shell.jsx fix,
 * rebuild, re-run (the CURRENT-BUILD cases must go RED — the false banner reappears), then
 * `git stash pop` and rebuild again.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-unknown-subroute.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

const GID = "smqfy48tlk9j"; // real production Goose Creek group id (read-only, same as sibling harnesses)
const BAD_ALIASES = ["review", "docs", "files", "plan"]; // NOT "markup" — sweep the CLASS, not one string

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

const site = (gid, name) => ({
  id: gid, groupId: gid, site: name, name: "Concept A", status: "active",
  origin: { lat: 29.77, lon: -95.38 }, county: "chambers",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(),
});
const seedScript = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [GID]: site(GID, "Goose Creek") })}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

async function newCtx(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seedScript);
  await ctx.route(/supabase\.co/, (r) => r.abort());
  return ctx;
}
const hashOf = (page) => page.evaluate(() => window.location.hash);
const bannerVisible = (page) => page.locator('[data-testid="app-update-banner"]').isVisible().catch(() => false);
const bannerReason = (page) => page.locator('[data-testid="app-update-banner"]').getAttribute("data-reason").catch(() => null);

async function caseCurrentBuildAlias(browser, alias) {
  console.log(`\nCASE — unrecognized alias "/${alias}" on the CURRENT (already-served) build`);
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-unknown-subroute");
  // A hard, fresh load — no earlier tab state — landing directly on the bad alias, exactly the
  // owner's repro (a stale bookmark / old shared link opened cold).
  await page.goto(`${BASE}#/project/${GID}/${alias}`, { waitUntil: "load" });
  await page.waitForTimeout(3200); // past the immediate version.json check this fix adds

  const visible = await bannerVisible(page);
  ok(!visible, `no false "tab is out of date" banner for "/${alias}" on a build that already IS current (visible=${visible})`);

  const hash = await hashOf(page);
  ok(hash === `#/project/${GID}/site`, `the URL self-corrects to the project's default tab — got "${hash}"`);

  // The fallback module (Site) actually rendered underneath, matching the report ("the Site tab
  // stays rendered underneath") — now it's rendered under the CORRECT, matching URL.
  const crumbText = await page.locator('[data-testid="project-crumb"]:visible').first().textContent().catch(() => "");
  ok((crumbText || "").includes("Goose Creek"), `the Site Planner rendered the routed project — crumb reads "${crumbText}"`);

  await page.screenshot({ path: new URL(`./screens/unknown-subroute-${alias}.png`, import.meta.url).pathname });
  await ctx.close();
}

async function caseGenuineSkewNeverRewritesUrl(browser) {
  console.log("\nCASE — a GENUINE newer-build route miss still shows the banner AND does NOT rewrite the URL");
  const ctx = await newCtx(browser);
  // Serve a DIFFERENT build id than this bundle's own __BUILD_ID__, simulating a real deploy
  // that shipped a module this tab's code has never heard of.
  await ctx.route("**/version.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ build: "future999" }) }));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-unknown-subroute");
  await page.goto(`${BASE}#/project/${GID}/review`, { waitUntil: "load" });
  await page.waitForTimeout(3200);

  const visible = await bannerVisible(page);
  ok(visible, `the reload banner DOES show once a genuinely different served build is confirmed (visible=${visible})`);
  const reason = await bannerReason(page);
  ok(reason === "route-miss", `the banner names the route-miss reason — got "${reason}"`);

  const hash = await hashOf(page);
  ok(hash === `#/project/${GID}/review`, `the URL is left UNTOUCHED while genuine skew is possible — a reload must still land on the real deep link — got "${hash}"`);

  await page.screenshot({ path: new URL("./screens/unknown-subroute-genuine-skew.png", import.meta.url).pathname });
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
mkdirSync(new URL("./screens/", import.meta.url).pathname, { recursive: true });
for (const alias of BAD_ALIASES) await caseCurrentBuildAlias(browser, alias);
await caseGenuineSkewNeverRewritesUrl(browser);
await browser.close();

console.log("\n" + (fails === 0 ? "✅ PASS — a route miss on a current build never shows the false banner and self-corrects; genuine skew still warns and preserves the link" : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
