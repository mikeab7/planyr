/**
 * B866112 — the shared header's Dashboard crumb was DEAD on Schedule.
 * B881664 — it was made to FIRE, but not to ARRIVE: it fired and then bounced back.
 * B881664 (×2) — RECURRENCE. Owner live-verified the first fix on planyr.io and found the
 * bounce WIDER than before: not just Schedule, but every tab (Library, Review, Notes), still
 * landing on a project — and NOT necessarily the one the owner had been routed away from (a
 * Library-originated click bounced to "Richfield" while the owner was actually in "Goose
 * Creek" — the most recently TOUCHED plan, not the current one).
 *
 * Owner report (2026-08-30), live on planyr.io: "From SCHEDULE, both the global TASK REPORT
 * route and after navigating in from another module: NOTHING. No navigation, no menu, no
 * console error." Confirmed from every other workspace (Site/Library/Review/Notes), the SAME
 * button navigates to the Site Planner map home ("#/"). He clicked it four times across two
 * page states with no effect.
 *
 * Root cause of B866112 (confirmed by code reading, not guessed): every workspace's shared
 * header wires the Shell's `onGoDashboard` (leaves the workspace, `navigate({module:
 * "site-planner", projectId:null})` -> hash "#/") straight into `<AppHeader onDashboard=...>`
 * — except Scheduler.jsx, which never destructured `onGoDashboard` at all and wired its OWN
 * local `goDashboard` instead: a function that only clears the ROUTED PROJECT within Schedule
 * and tells the embedded Gantt iframe to show its internal reports view (B1050) — it never
 * left the module. On the global `/schedule` route (already showing that internal view with
 * no project routed) that made the button a genuine no-op.
 *
 * Fix for B866112: Scheduler.jsx now destructures `onGoDashboard` and composes it with the
 * existing B1050 behavior (kept intact — still needed so a no-project Schedule state shows
 * the iframe's reports view rather than a stale project if the user ends up back here).
 *
 * B881664 — the SAME owner report (verbatim: "the hash becomes #/ for a moment and then the
 * app navigates to #/project/<id>/site. The dashboard never renders"), reproduced AFTER the
 * B866112 fix had already merged: CASE A/B below only ever waited 800ms and asserted the hash
 * had MOVED — never that it STAYED. Root cause (confirmed empirically, not guessed — see
 * ui-audit/diagnose-crumb-bounce-scratch.mjs in that session's history): a tab that boots on a
 * BARE hash gets "open where I left off" resumed onto a project's Schedule tab via
 * `planyr:lastRoute:v1` (lastRoute.js). The Site Planner (SitePlannerApp.jsx) has never
 * mounted yet in that boot (Schedule mounted first) — it mounts for the FIRST TIME later, the
 * moment the user clicks Dashboard, with `projectId == null`. Its `bootActiveId()` treats a
 * null `projectId` + `resumeAllowed` (route.js's `INITIAL_HASH_EMPTY`, a WHOLE-SESSION
 * constant) as "an empty-hash boot, safe to resume the last-open plan" — reviving the stale
 * `planarfit:currentSite:v1` pointer left over from an EARLIER visit and writing it straight
 * back into the route the user just explicitly left, ~700ms after the click (the postMessage
 * round-trip to the embedded Gantt app + a render settle).
 *
 * Fix for B881664: `resumeAllowed` is no longer a bare whole-session flag. Shell.jsx captures
 * `INITIAL_ROUTE` (the route the boot ACTUALLY resolved to, after "open where I left off"
 * seeding) once, and `bootResume.mayResumeLastSite({initialHashEmpty, projectId,
 * initialProjectId})` compares a later mount's own `projectId` prop against
 * `INITIAL_ROUTE.projectId` — a mismatch alone proves this mount is not the boot render, so a
 * later, deliberate navigation to a project-less route (Dashboard) can never revive a stale
 * plan pointer. This closed `bootActiveId()`'s SYNCHRONOUS decision — CASES A/B/C below still
 * cover exactly that mechanism, signed OUT (this sandbox cannot reach a real Supabase session:
 * `Blocker: auth`), which is the whole reachable surface of the original fix.
 *
 * B881664 (×2), ROOT CAUSE OF THE RECURRENCE: a SECOND, independent resume call site,
 * `SitePlannerApp.jsx`'s `applyUser` (the post-sign-in cloud-pull resume), was never gated by
 * `resumeAllowed` at all. It fires from a `useEffect(..., [])` — once per MOUNT — and
 * supabase-js delivers `INITIAL_SESSION` the instant it subscribes, i.e. on that SAME first
 * mount, signed in or not. When signed in, it awaits `pullCloud` (the owner's stopwatch: 2.1–
 * 2.4s) and then unconditionally fell back to `getCurrentSiteId()`'s last-touched-plan pointer
 * whenever the route named no project — regardless of whether this mount had any boot
 * privilege to do so. This explains every observed detail: it fires once per FIRST mount
 * (matching "only the first Dashboard visit in a tab bounces" — a later logo/crumb click on an
 * ALREADY-mounted SitePlannerApp never re-triggers it, which is why "the logo doesn't bounce"
 * read as a control-identity difference when it was actually a mount-freshness one — the logo
 * and the "Dashboard" crumb call the IDENTICAL `onDashboard` handler, verified by direct code
 * reading of AppHeader.jsx / ProjectBreadcrumb.jsx); it fires from EVERY tab (any workspace's
 * first visit to Site Planner triggers the same one-shot mount); and it resumes the
 * LAST-TOUCHED plan (`getCurrentSiteId()`), not the one the route had just been cleared from —
 * matching the Library→Richfield report exactly.
 *
 * Fix: `lib/bootResume.js`'s new `resumeTargetAfterSignIn` applies the SAME `resumeAllowed`
 * gate `bootActiveId` already honors to this second call site. This is a SIGNED-IN, ASYNC
 * mechanism (`applyUser`'s `if (uid) {...}` branch) that this sandbox structurally cannot
 * drive — not merely network-blocked but genuinely unreachable, since this sandbox's local
 * build has no `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` baked in at all, so
 * `supabaseConfigured()` is false and the entire auth-change subscription never even attaches.
 * The fix is proven at the pure-function level instead (`test/bootResume.test.js`'s
 * `resumeTargetAfterSignIn` suite, mutation-proven against the un-gated `pickResumeTarget` the
 * bug's exact call site used) and remains `Verify: live` for the async leg — see V496864.
 *
 * CASES D–G below extend the ORIGINAL (signed-out, synchronous) coverage to every tab that
 * carries the Dashboard crumb, not just Schedule — Library, Review (doc-review/markup), Notes,
 * and Food — plus CASE H, the explicit logo-vs-crumb discriminator: both controls call the
 * literal same `onDashboard` handler (proven by driving the LOGO instead of the crumb through
 * the exact CASE-C boot-resume shape and getting an identical result), closing out that
 * investigation even though the real recurrence lived one layer deeper, in code this sandbox
 * cannot sign in to reach.
 *
 * ⛔ B881664 (×3) — THIRD ROUND, and a genuinely DIFFERENT mechanism from the two already
 * closed above. Both prior fixes only ever govern SitePlannerApp's FIRST MOUNT (`bootActiveId`'s
 * lazy init, and `applyUser`'s once-per-mount auth subscription) — every case above (A/C/D-H)
 * deliberately boots STRAIGHT onto another module's route, so SitePlannerApp never mounts until
 * the Dashboard click itself. The owner's live report measured a bounce that reproduces even
 * SIGNED OUT, lands back on the SAME project just left (never a different, most-recently-
 * touched one), and fires within about a second — none of which fits the mount-time mechanism,
 * which needs a stale `currentSite` pointer and, for the async leg, a 2+ second cloud pull.
 *
 * ROOT CAUSE (confirmed by reading SitePlannerApp.jsx's two URL↔state-sync effects, not
 * guessed): the keep-alive feature (2026-07-05) means SitePlannerApp does NOT remount when you
 * switch away from it — it stays mounted, hidden, with whatever `mode`/`activeSiteId` it held
 * when you left. Clicking "Dashboard" from a kept-alive OTHER tab does two things in the SAME
 * `navigate()` call: clears the route's `projectId` AND reactivates SitePlannerApp
 * (`isActive` false → true). The state→URL sync effect has `isActive` in its deps specifically
 * so reactivating a hidden tab reconciles the URL right away — but on the very render that
 * supplies the new `projectId` prop, `mode`/`activeSiteId` still hold their OLD, pre-click
 * values (the URL→state effect only *schedules* `setMode("map")`; it hasn't taken effect yet).
 * So the state→URL effect fires — triggered by `isActive` alone — reads a STALE, still-truthy
 * `effGroup` from those old values, and `mayWriteRouteProject` waves it through (a truthy
 * `nextGroup` is always considered honest), writing the very project just left straight back
 * into the URL. No network wait needed, which is exactly why this lands in under a second
 * rather than 2+.
 *
 * CASES I–N below reproduce it directly: open the project on its SITE tab first (mounting
 * SitePlannerApp for real, the ordinary way anyone reaches another tab of a project), switch
 * to the target module via an in-app hash change (never a reload — a reload would tear down
 * the mount this bug depends on and silently fall back to testing the ALREADY-CLOSED mount-time
 * mechanism instead), then click Dashboard and record the hash every second for the whole
 * window rather than a single before/after snapshot.
 *
 * This harness never touches Supabase: the /sequence/ iframe is replaced with a same-origin
 * stub (same pattern as verify-schedule-switcher-pick.mjs) that speaks the real postMessage
 * contract, so the real shell code (Shell.jsx, route.js, lastRoute.js, bootResume.js,
 * Scheduler.jsx, SitePlannerApp.jsx, ProjectBreadcrumb.jsx) is exercised end to end in a real
 * browser with no cloud write of any kind. Library/Review/Notes/Food need no such stub — they
 * wire `onDashboard` straight from the Shell with no embedded cross-origin app in between.
 *
 * MUTATION PROOF: run once as-is (green), then `git stash` the fix, rebuild, re-run (CASE A
 * must go RED — the hash stays on /schedule instead of moving to "#/" — and CASE C must go RED
 * — the hash bounces to "#/project/<id>/site" a moment after landing on "#/"), then
 * `git stash pop` and rebuild again. (CASES D–H exercise the same SYNCHRONOUS mechanism CASE C
 * does, so they move together with it under the same stash/rebuild cycle. CASES I–N exercise
 * the B881664 mechanism and must ALSO go red under the same stash — the bounce lands back on
 * "#/project/<id>/site"/"#/project/<id>/markup" etc. rather than staying on "#/".)
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-schedule-dashboard-crumb.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

const GID = "smqfy48tlk9j"; // real production Goose Creek group id (read-only, same as the switcher-pick harness)
// The stub's initial active schedule must be UNLINKED (id "2", no linkedSiteId) — otherwise
// Scheduler's own carry-IN effect (a real, correct feature: "adopt the iframe's active
// schedule's linked site into an empty route") auto-populates the outer route on load, which
// would silently turn Case B's "#/schedule, no project" starting state into a routed one before
// the assertion even runs. Case A still exercises the LINKED path — it routes to Goose Creek
// via the URL directly, independent of the iframe's own activeId.
const PROJECTS = [
  { id: "1", name: "Goose Creek", linkedSiteId: GID, linkedSiteName: "Goose Creek" },
  { id: "2", name: "Operations", linkedSiteId: null, linkedSiteName: null },
];

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

// B881664 CASE C — a stale currentSite pointer PLUS a "resume onto Schedule" boot pointer,
// on a bare hash: this is what actually revives the bounce. A currentSite pointer with no
// boot-resume (Case A/B above) never exercises SitePlannerApp's `bootActiveId()` fallback at
// all, which is why the pre-fix build passed Case A/B's 800ms check even though the owner's
// real repro (a resumed tab) failed every time.
const bootResumeSeedScript = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [GID]: site(GID, "Goose Creek") })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(GID)});
  localStorage.setItem('planyr:lastRoute:v1', JSON.stringify({ module: "scheduler", projectId: ${JSON.stringify(GID)}, cross: false }));
} catch (e) {} })();`;

const stubHtml = (initialActiveId) => `<!doctype html><html><body style="margin:0;font:13px system-ui;padding:12px">
<div id="s">embedded-gantt-stub</div><script>
  window.__cmds = [];
  let aPid = ${JSON.stringify(initialActiveId)}, section = "projects";
  const projects = ${JSON.stringify(PROJECTS)};
  const emit = () => {
    parent.postMessage({ source: "planar-seq", type: "planar:nav-state", section, activeId: aPid, projects }, window.location.origin);
    parent.postMessage({ source: "planar-seq", type: "planar:toolbar-state", ready: true, section, view: "gantt", zoomable: true, zoomPct: 100, activePanel: null, reviewOpen: false, reviewCount: 0, saveStatus: "saved" }, window.location.origin);
  };
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.source !== "planar-shell") return;
    window.__cmds.push(m.type);
    document.getElementById("s").textContent = window.__cmds.join(" | ");
    if (m.type === "planar:nav-request") { emit(); return; }
    if (m.type === "planar:nav-dashboard") { section = "reports"; emit(); }
  });
  emit();
</script></body></html>`;

async function newCtx(browser, { initialActiveId = "1", seed = seedScript } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seed);
  await ctx.route(/supabase\.co/, (r) => r.abort());
  await ctx.route("**/sequence/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: stubHtml(initialActiveId) }));
  return ctx;
}
const hashOf = (page) => page.evaluate(() => window.location.hash);

async function clickDashboard(page) {
  const btn = page.locator('button:has-text("Dashboard")').first();
  await btn.waitFor({ state: "visible", timeout: 6000 });
  await btn.click({ timeout: 6000 });
}

async function caseProjectScoped(browser) {
  console.log("\nCASE A — project-scoped /project/<id>/schedule, click Dashboard");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-dashboard-crumb");
  await page.goto(`${BASE}#/project/${GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  const before = await hashOf(page);
  ok(before.includes("/schedule") && before.includes(GID), `starting hash is the routed Schedule project (${before})`);

  await clickDashboard(page);
  await page.waitForTimeout(800);
  const after = await hashOf(page);
  ok(after === "#/", `Dashboard navigates to the Site Planner map home ("#/"), matching Site/Library/Review/Notes — got "${after}"`);
  // B881664 — arriving is not enough; it must STAY. Wait well past the ~700ms this class of
  // bounce measured at before asserting the hash never moved again.
  await page.waitForTimeout(4000);
  const stillAfter = await hashOf(page);
  ok(stillAfter === "#/", `Dashboard STAYS on the map home 4.8s later, no bounce back — got "${stillAfter}"`);
  await page.screenshot({ path: new URL("./screens/schedule-dashboard-crumb-project-scoped.png", import.meta.url).pathname });
  await ctx.close();
}

async function caseGlobal(browser) {
  console.log("\nCASE B — global /schedule (no project routed), click Dashboard");
  const ctx = await newCtx(browser, { initialActiveId: "2" }); // "2" = Operations, unlinked
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-dashboard-crumb");
  await page.goto(`${BASE}#/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  const before = await hashOf(page);
  ok(before === "#/schedule", `starting hash is the global Schedule route (got "${before}")`);

  await clickDashboard(page);
  await page.waitForTimeout(800);
  const after = await hashOf(page);
  ok(after === "#/", `Dashboard navigates to the Site Planner map home ("#/") even with no project routed — got "${after}" (this is the owner's exact reported no-op case)`);
  await page.screenshot({ path: new URL("./screens/schedule-dashboard-crumb-global.png", import.meta.url).pathname });
  await ctx.close();
}

async function caseBootResumeBounce(browser) {
  console.log("\nCASE C — bare-hash boot resumes onto a project's Schedule tab, click Dashboard (B881664 repro)");
  const ctx = await newCtx(browser, { initialActiveId: "1", seed: bootResumeSeedScript });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-dashboard-crumb");
  // Bare domain, no hash — "open where I left off" (lastRoute.js) must resume onto the
  // project's Schedule tab before the first render, same as a reopened tab in production.
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  const booted = await hashOf(page);
  ok(booted.includes("/schedule") && booted.includes(GID), `boot resumed onto the routed Schedule project (${booted})`);

  await clickDashboard(page);
  await page.waitForTimeout(800);
  const after = await hashOf(page);
  ok(after === "#/", `Dashboard navigates to the Site Planner map home ("#/") — got "${after}"`);
  // This is the assertion that actually catches B881664: SitePlannerApp's first-ever mount
  // (triggered by this exact click) is where the stale currentSite pointer got revived,
  // ~700ms later once the embedded Gantt app's postMessage round-trip settles.
  await page.waitForTimeout(4000);
  const stillAfter = await hashOf(page);
  ok(stillAfter === "#/", `Dashboard STAYS on the map home 4.8s later — no bounce to a project route — got "${stillAfter}"`);
  await page.screenshot({ path: new URL("./screens/schedule-dashboard-crumb-boot-resume-bounce.png", import.meta.url).pathname });
  await ctx.close();
}

/* CASE H — the logo-vs-crumb discriminator, driven through the EXACT boot-resume shape CASE C
 * uses, clicking the LOGO instead of the "Dashboard" crumb text. Both must behave identically
 * (proving they share one handler, per AppHeader.jsx / ProjectBreadcrumb.jsx) — this closes the
 * "does the control matter" question directly rather than by code-reading alone. */
async function clickLogo(page) {
  const btn = page.locator('button[title="Dashboard: all projects"]').first();
  await btn.waitFor({ state: "visible", timeout: 6000 });
  await btn.click({ timeout: 6000 });
}

async function caseLogoControl(browser) {
  console.log("\nCASE H — logo-vs-crumb discriminator: same boot-resume repro, click the LOGO instead of the crumb");
  const ctx = await newCtx(browser, { initialActiveId: "1", seed: bootResumeSeedScript });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-dashboard-crumb");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  const booted = await hashOf(page);
  ok(booted.includes("/schedule") && booted.includes(GID), `boot resumed onto the routed Schedule project (${booted})`);

  await clickLogo(page);
  await page.waitForTimeout(800);
  const after = await hashOf(page);
  ok(after === "#/", `LOGO navigates to the Site Planner map home ("#/") — same handler as the crumb — got "${after}"`);
  await page.waitForTimeout(4000);
  const stillAfter = await hashOf(page);
  ok(stillAfter === "#/", `LOGO click STAYS on the map home 4.8s later, matching the crumb's own CASE C result — got "${stillAfter}"`);
  await page.screenshot({ path: new URL("./screens/schedule-dashboard-crumb-logo-control.png", import.meta.url).pathname });
  await ctx.close();
}

/* CASES D–G — the ORIGINAL B881664 fix (bootActiveId + resumeAllowed) generalized to every
 * OTHER tab that carries the Dashboard crumb. None of these need the postMessage iframe stub —
 * Library/Notes/Review/Food wire `onDashboard` straight from the Shell (verified by direct code
 * reading: `onDashboard={onGoDashboard}` in each). Same boot-resume shape as CASE C: a bare-hash
 * boot resumes "open where I left off" onto that tab with a routed project, a stale currentSite
 * pointer is primed, then Dashboard is clicked and must both ARRIVE and STAY. */
function moduleBootResumeSeedScript(moduleSlug) {
  return `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [GID]: site(GID, "Goose Creek") })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(GID)});
    localStorage.setItem('planyr:lastRoute:v1', JSON.stringify({ module: ${JSON.stringify(moduleSlug)}, projectId: ${JSON.stringify(GID)}, cross: false }));
  } catch (e) {} })();`;
}

async function newPlainCtx(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seed);
  await ctx.route(/supabase\.co/, (r) => r.abort());
  return ctx;
}

async function caseOtherModuleBootResume(browser, { label, moduleSlug, hashModuleFragment }) {
  console.log(`\n${label} — bare-hash boot resumes onto a project's ${moduleSlug} tab, click Dashboard`);
  const ctx = await newPlainCtx(browser, moduleBootResumeSeedScript(moduleSlug));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-dashboard-crumb");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const booted = await hashOf(page);
  ok(booted.includes(hashModuleFragment) && booted.includes(GID), `boot resumed onto the routed ${moduleSlug} project (${booted})`);

  await clickDashboard(page);
  await page.waitForTimeout(800);
  const after = await hashOf(page);
  ok(after === "#/", `Dashboard navigates to the Site Planner map home ("#/") from ${moduleSlug} — got "${after}"`);
  await page.waitForTimeout(4000);
  const stillAfter = await hashOf(page);
  ok(stillAfter === "#/", `Dashboard STAYS on the map home 4.8s later from ${moduleSlug} — no bounce — got "${stillAfter}"`);
  await page.screenshot({ path: new URL(`./screens/schedule-dashboard-crumb-${moduleSlug}.png`, import.meta.url).pathname });
  await ctx.close();
}

/* Food has no project model at all (route.js/lastRoute.js's PROJECTLESS_MODULES) and can never
 * be a boot-resume target — reached directly instead, mirroring CASE B's global-route shape.
 * Food's own AppHeader passes no `onSelectProject` (see food/CLAUDE.md — "no projects, no
 * cross-workspace navigation"), so `ProjectBreadcrumb` (and its "Dashboard" text crumb) never
 * mounts there at all — the LOGO (`onDashboard={onGoDashboard}`, wired independently of the
 * breadcrumb in AppHeader.jsx) is the ONLY way back to the dashboard from Food, which makes this
 * case double as a second, independent logo-path proof alongside CASE H. */
async function caseFoodToDashboard(browser) {
  console.log("\nCASE G — Food (project-less workspace, logo-only — no Dashboard text crumb renders here)");
  const ctx = await newPlainCtx(browser, seedScript);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-dashboard-crumb");
  await page.goto(`${BASE}#/food`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const before = await hashOf(page);
  ok(before === "#/food", `starting hash is the Food route (got "${before}")`);

  await clickLogo(page);
  await page.waitForTimeout(800);
  const after = await hashOf(page);
  ok(after === "#/", `Dashboard navigates to the Site Planner map home ("#/") from Food — got "${after}"`);
  await page.waitForTimeout(4000);
  const stillAfter = await hashOf(page);
  ok(stillAfter === "#/", `Dashboard STAYS on the map home 4.8s later from Food — got "${stillAfter}"`);
  await page.screenshot({ path: new URL("./screens/schedule-dashboard-crumb-food.png", import.meta.url).pathname });
  await ctx.close();
}

/* CASES I–M — B881664 (×3): SitePlannerApp already mounted+kept-alive on the SAME project as
 * the tab you click Dashboard from. Unlike every case above, this needs no boot-resume seed and
 * no stale currentSite pointer at all — the whole mechanism lives in SitePlannerApp's own two
 * URL↔state-sync effects, so a plain project with nothing special primed is enough.
 *
 * Step 1 opens the project on its SITE tab — the ordinary way anyone reaches any other tab of a
 * project — so SitePlannerApp genuinely mounts (mode="plan", activeSiteId=<the plan>). Step 2 is
 * an in-app hash change (never `page.reload()` — a reload tears down the mount this bug needs
 * and would silently fall back to exercising the already-closed mount-time mechanism instead) to
 * the target module, same project, which keep-alive leaves SitePlannerApp mounted and hidden
 * behind. The click then reproduces the owner's Repro B exactly: the reported bounce lands back
 * on "#/project/<id>/site" specifically (mode="plan" survives, so `groupForPlan` still resolves
 * the group) — not some other module's slug — which is why every one of these cases asserts the
 * SAME bounce destination regardless of which OTHER tab the click came from.
 *
 * Non-negotiable per the owner's own reporting protocol: install the recorder before the click,
 * click ONCE, and report the whole per-second trail — never a single before/after snapshot. */
async function caseAlreadyMountedBounce(browser, { label, moduleSlug, hashModuleFragment }) {
  console.log(`\n${label} — Site Planner already mounted+kept-alive on Goose Creek, click Dashboard from ${moduleSlug} (B881664 ×3 repro)`);
  const ctx = await newPlainCtx(browser, seedScript);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-dashboard-crumb");

  await page.goto(`${BASE}#/project/${GID}/site`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  const onSite = await hashOf(page);
  ok(onSite === `#/project/${GID}/site`, `starting hash is the routed Site project, mounting SitePlannerApp for real (${onSite})`);

  await page.evaluate(({ gid, frag }) => { window.location.hash = `#/project/${gid}/${frag}`; }, { gid: GID, frag: hashModuleFragment });
  await page.waitForTimeout(2600);
  const onModule = await hashOf(page);
  ok(onModule.includes(hashModuleFragment) && onModule.includes(GID), `moved to ${moduleSlug} with Site Planner kept alive, hidden (${onModule})`);

  await clickDashboard(page);
  const trail = [];
  for (let i = 0; i <= 9; i++) {
    trail.push({ t: i, hash: await hashOf(page) });
    if (i < 9) await page.waitForTimeout(1000);
  }
  console.log(`  trail: ${trail.map((r) => `t+${r.t}s=${r.hash}`).join("  ")}`);
  const reachedIdx = trail.findIndex((r) => r.hash === "#/");
  ok(reachedIdx !== -1, `Dashboard reaches the map home ("#/") within the 9s recorded window from ${moduleSlug}`);
  const stays = reachedIdx !== -1 && trail.slice(reachedIdx).every((r) => r.hash === "#/");
  ok(stays, `once reached, "#/" holds for the rest of the window from ${moduleSlug} — no bounce back to a project route`);
  await page.screenshot({ path: new URL(`./screens/schedule-dashboard-crumb-kept-alive-${moduleSlug}.png`, import.meta.url).pathname });
  await ctx.close();
}

/* CASE N (companion to I–M) — the same tabs, but with NO project ever routed, so there is
 * nothing for a stale `effGroup` to bounce back to. Not expected to fail even on the pre-fix
 * build; included so the "with vs without a project" pair the owner asked for is actually on
 * record for every tab, not inferred. */
async function caseNoProjectToDashboard(browser, { label, moduleSlug, hashSlug }) {
  console.log(`\n${label} — no project routed, click Dashboard from ${moduleSlug}`);
  const ctx = await newPlainCtx(browser, seedScript);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-dashboard-crumb");
  await page.goto(`${BASE}#/${hashSlug}`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const before = await hashOf(page);
  ok(before === `#/${hashSlug}`, `starting hash is the global ${moduleSlug} route with no project (got "${before}")`);

  await clickDashboard(page);
  const trail = [];
  for (let i = 0; i <= 9; i++) {
    trail.push({ t: i, hash: await hashOf(page) });
    if (i < 9) await page.waitForTimeout(1000);
  }
  console.log(`  trail: ${trail.map((r) => `t+${r.t}s=${r.hash}`).join("  ")}`);
  const reachedIdx = trail.findIndex((r) => r.hash === "#/");
  ok(reachedIdx !== -1, `Dashboard reaches the map home ("#/") within the recorded window from ${moduleSlug}`);
  const stays = reachedIdx !== -1 && trail.slice(reachedIdx).every((r) => r.hash === "#/");
  ok(stays, `once reached, "#/" holds for the rest of the window from ${moduleSlug} with no project routed`);
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
mkdirSync(new URL("./screens/", import.meta.url).pathname, { recursive: true });
await caseProjectScoped(browser);
await caseGlobal(browser);
await caseBootResumeBounce(browser);
await caseLogoControl(browser);
await caseOtherModuleBootResume(browser, { label: "CASE D", moduleSlug: "library", hashModuleFragment: "/library" });
await caseOtherModuleBootResume(browser, { label: "CASE E", moduleSlug: "doc-review", hashModuleFragment: "/markup" });
await caseOtherModuleBootResume(browser, { label: "CASE F", moduleSlug: "notes", hashModuleFragment: "/notes" });
await caseFoodToDashboard(browser);
// B881664 (×3) — Site Planner already mounted+kept-alive on the SAME project, ten cases:
// five tabs (Schedule/Library/Review/Notes/Model), each with a project routed (the actual
// bounce mechanism) and without one (the control — nothing to bounce back to).
await caseAlreadyMountedBounce(browser, { label: "CASE I", moduleSlug: "schedule", hashModuleFragment: "schedule" });
await caseAlreadyMountedBounce(browser, { label: "CASE J", moduleSlug: "library", hashModuleFragment: "library" });
await caseAlreadyMountedBounce(browser, { label: "CASE K", moduleSlug: "doc-review", hashModuleFragment: "markup" });
await caseAlreadyMountedBounce(browser, { label: "CASE L", moduleSlug: "notes", hashModuleFragment: "notes" });
await caseAlreadyMountedBounce(browser, { label: "CASE M", moduleSlug: "model", hashModuleFragment: "model" });
await caseNoProjectToDashboard(browser, { label: "CASE N", moduleSlug: "library", hashSlug: "library" });
await caseNoProjectToDashboard(browser, { label: "CASE O", moduleSlug: "doc-review", hashSlug: "markup" });
await caseNoProjectToDashboard(browser, { label: "CASE P", moduleSlug: "notes", hashSlug: "notes" });
await caseNoProjectToDashboard(browser, { label: "CASE Q", moduleSlug: "model", hashSlug: "model" });
await browser.close();

console.log("\n" + (fails === 0
  ? "✅ PASS — the Dashboard crumb (and the logo, its identical twin) navigate home and STAY there, from every tab (Schedule/Library/Review/Notes/Model/Food), with and without a project routed, and whether or not Site Planner was already mounted+kept-alive on that project"
  : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
