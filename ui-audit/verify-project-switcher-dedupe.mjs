/* B881666 — the current project was listed TWICE in the project switcher: pinned at the top
 * marked "current", and again immediately below as an ordinary recents row with a relative
 * timestamp. Owner report (2026-08-30), confirmed on both Site and Schedule for Goose Creek —
 * a display dedupe miss, not a real duplicate project (the Sites panel elsewhere shows exactly
 * one Goose Creek).
 *
 * TWO confirmed-by-reading root causes in ProjectBreadcrumb.jsx, both fixed here:
 *
 * (1) NAMESPACE MISMATCH (Scheduler tab). Scheduler.jsx's controlled `currentProject` is the
 * routed site's LINKED SCHEDULE object once one exists — `{id, name, linkedSiteId,
 * linkedSiteName}` — whose `.id` is the SCHEDULE's own id (a small integer-like string), not the
 * site-GROUP id `listProjects()` keys its registry by. `withCurrentProject`'s dedupe check
 * (`projects.some(p => p.id === currentProject.id)`) always missed against that id, so it
 * unconditionally PREPENDED a synthetic entry keyed by the schedule id and marked "current" —
 * sitting right beside the real, group-id-keyed registry entry for the SAME project, which the
 * row-render's own `cur` check does not mark current (its id doesn't match either), so it shows
 * an ordinary relative timestamp instead. Fix: `refresh()` now resolves through `linkedSiteId`
 * when present, reconciling against the SAME identity space the registry uses.
 *
 * (2) STALE CLOSURE (any workspace, kept-alive). The mount effect that registers the "storage"
 * event listener has deps `[controlled]` — a per-instance constant, since a kept-alive
 * workspace's ProjectBreadcrumb never remounts on a later project switch — so that listener's
 * `refresh()` call was permanently bound to whatever `currentProject` was at FIRST mount. A
 * synthetic `notifyProjectsChanged()` storage event fired from anywhere in the app after the
 * user switched projects re-derived `internalProjects` from the STALE project. Fix: `refresh`
 * now always reads `currentProject` through a ref kept current every render.
 *
 * This harness drives CASE A (Schedule, a routed project WITH a linked schedule — the exact
 * namespace-mismatch shape) through the real postMessage-speaking iframe stub, and CASE B (Site
 * Planner, a mid-session project switch followed by an external storage event — the stale-
 * closure shape) against the real app, logged out, no external GIS — Claude-verifiable here.
 *
 * MUTATION PROOF: run once as-is (green), then `git stash` the ProjectBreadcrumb.jsx fix,
 * rebuild, re-run (CASE A must go RED — two "Goose Creek" rows, one of them the synthesized
 * schedule-id entry), then `git stash pop` and rebuild again.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-project-switcher-dedupe.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

const GID = "smqfy48tlk9j"; // real production Goose Creek group id (read-only, same as the sibling harnesses)
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

const stubHtml = `<!doctype html><html><body style="margin:0;font:13px system-ui;padding:12px">
<div id="s">embedded-gantt-stub</div><script>
  window.__cmds = [];
  let aPid = "1", section = "projects";
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
    if (m.type === "planar:nav-select") { window.__lastSelectId = m.id; aPid = m.id; emit(); }
  });
  emit();
</script></body></html>`;

const rowsNamed = (page, name) => page.evaluate((n) => {
  const rows = [...document.querySelectorAll('[data-testid^="project-row-"]')];
  return rows.filter((r) => (r.textContent || "").includes(n)).length;
}, name);

async function caseSchedule(browser) {
  console.log("\nCASE A — Schedule tab, a routed project WITH a linked schedule (the namespace-mismatch shape)");
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seedScript);
  await ctx.route(/supabase\.co/, (r) => r.abort());
  await ctx.route("**/sequence/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: stubHtml }));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-project-switcher-dedupe");
  await page.goto(`${BASE}#/project/${GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(2600);

  const crumb = page.locator('[data-testid="project-crumb"]:visible').first();
  await crumb.waitFor({ state: "visible", timeout: 6000 });
  await crumb.click();
  await page.waitForTimeout(400);

  const gooseRows = await rowsNamed(page, "Goose Creek");
  ok(gooseRows === 1, `exactly one "Goose Creek" row in the switcher (got ${gooseRows})`);

  // Click the single Goose Creek row (the registry-preferred entry, keyed by the site GROUP id)
  // and confirm it still correctly drives the embedded Gantt app — Scheduler.jsx's
  // `selectSchedule` must resolve a group-id click back to the schedule's OWN id before posting.
  const row = page.locator('[data-testid^="project-row-"]', { hasText: "Goose Creek" }).first();
  await row.locator("button").first().click();
  await page.waitForTimeout(300);
  const selectedId = await page.evaluate(() => {
    const f = document.querySelector("iframe");
    return f && f.contentWindow ? f.contentWindow.__lastSelectId : undefined;
  });
  ok(selectedId === "1", `clicking the registry row still selects the SCHEDULE's own id ("1") in the iframe — got ${JSON.stringify(selectedId)}`);

  await page.screenshot({ path: new URL("./screens/project-switcher-dedupe-schedule.png", import.meta.url).pathname });
  await ctx.close();
}

async function caseMidSessionSwitch(browser) {
  console.log("\nCASE B — Site Planner, switch projects mid-session then fire an external storage event (the stale-closure shape)");
  const GID2 = "smsdrvzr9gzx"; // real production Richfield group id
  const sites = { [GID]: site(GID, "Goose Creek"), [GID2]: site(GID2, "Richfield") };
  const seed = `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
    localStorage.removeItem('planarfit:currentSite:v1');
  } catch (e) {} })();`;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seed);
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-project-switcher-dedupe");
  // Land on Richfield first (mounts this Site Planner instance's ProjectBreadcrumb with
  // currentProject = Richfield at mount time), then switch to Goose Creek WITHOUT ever opening
  // the dropdown in between, then fire the same synthetic storage event the app itself uses
  // after a rename/warm (notifyProjectsChanged) BEFORE opening the dropdown — reproducing the
  // stale mount-time closure if the fix isn't in place.
  await page.goto(`${BASE}#/project/${GID2}/site`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await page.evaluate((gid) => { window.location.hash = `#/project/${gid}/site`; }, GID);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    try { window.dispatchEvent(new StorageEvent("storage", { key: "planarfit:sites:v1" })); } catch (_) {}
  });
  await page.waitForTimeout(400);

  const crumb = page.locator('[data-testid="project-crumb"]:visible').first();
  await crumb.waitFor({ state: "visible", timeout: 6000 });
  await crumb.click();
  await page.waitForTimeout(400);

  const gooseRows = await rowsNamed(page, "Goose Creek");
  ok(gooseRows === 1, `exactly one "Goose Creek" row in the switcher after the mid-session switch (got ${gooseRows})`);
  await page.screenshot({ path: new URL("./screens/project-switcher-dedupe-midswitch.png", import.meta.url).pathname });
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
mkdirSync(new URL("./screens/", import.meta.url).pathname, { recursive: true });
await caseSchedule(browser);
await caseMidSessionSwitch(browser);
await browser.close();

console.log("\n" + (fails === 0 ? "✅ PASS — the project switcher never lists the current project twice" : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
