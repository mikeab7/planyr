/**
 * B866112 — the shared header's Dashboard crumb was DEAD on Schedule.
 * B881664 — it was made to FIRE, but not to ARRIVE: it fired and then bounced back.
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
 * plan pointer.
 *
 * This harness never touches Supabase: the /sequence/ iframe is replaced with a same-origin
 * stub (same pattern as verify-schedule-switcher-pick.mjs) that speaks the real postMessage
 * contract, so the real shell code (Shell.jsx, route.js, lastRoute.js, bootResume.js,
 * Scheduler.jsx, SitePlannerApp.jsx, ProjectBreadcrumb.jsx) is exercised end to end in a real
 * browser with no cloud write of any kind.
 *
 * MUTATION PROOF: run once as-is (green), then `git stash` the fix, rebuild, re-run (CASE A
 * must go RED — the hash stays on /schedule instead of moving to "#/" — and CASE C must go RED
 * — the hash bounces to "#/project/<id>/site" a moment after landing on "#/"), then
 * `git stash pop` and rebuild again.
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

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
mkdirSync(new URL("./screens/", import.meta.url).pathname, { recursive: true });
await caseProjectScoped(browser);
await caseGlobal(browser);
await caseBootResumeBounce(browser);
await browser.close();

console.log("\n" + (fails === 0 ? "✅ PASS — the Dashboard crumb navigates home from Schedule, and stays there, in all three cases" : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
