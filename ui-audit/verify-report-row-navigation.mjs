/**
 * NEW-1 (B1614528 follow-up, 2026-09-16) — live/headless proof that a Task Report row link for a
 * LINKED project no longer bounces the embedded schedule through `planar:nav-dashboard` before
 * landing, and that the UNLINKED (cross-cutting) case still works exactly as B1614528 shipped it.
 *
 * Owner-measured repro (as arrived, captured on production build d61e57c): clicking "Open row in
 * Master Schedule" for a task in a project WITH a linked site correctly moves the route and expands
 * the task's ancestors, but the task itself is never selected/scrolled/ringed — because the shell
 * sends ONE extra `planar:nav-dashboard` into the one-tick gap between the embed's own
 * "reports"→"projects" transition (goToTask) and the outer route catching up to it (the postMessage
 * log: nav-state "projects" → shell posts nav-dashboard → nav-state "reports" → shell posts
 * nav-select-by-site → nav-state "projects" again). See navState.js's `isPickShowing` header and
 * Scheduler.jsx's `pendingRouteProjectIdRef` for the fix (bridge the route-write race so the pick
 * reads as showing on the SAME render it is recorded on, instead of waiting for the hashchange that
 * `onProjectChange` fires asynchronously).
 *
 * WHAT THIS PROVES AND WHAT IT DOESN'T. The real embedded app (`public/sequence/index.html`) can't
 * boot in this sandbox at all — its in-browser Babel loads from a CDN this sandbox's egress blocks
 * (the same wall V1149424/V484/V491 already name) — so this harness substitutes a same-origin stub
 * for `/sequence/` that speaks the real postMessage contract (identical technique to
 * ui-audit/verify-schedule-switcher-pick.mjs), exercising the real shell code
 * (Scheduler.jsx + navState.js) end to end in a real browser. It proves: no `planar:nav-dashboard`
 * is sent on a genuine linked row click, no redundant `planar:nav-select-by-site` re-drive follows
 * it, the grid is never hidden behind the `gridMismatched` "switching…" loader for even one frame,
 * and the route lands on the clicked task's project. It CANNOT prove the real embedded app's own
 * GridView selectedId/scroll/cell-ring survive (that state lives entirely inside the real
 * `/sequence/` app this stub replaces) — that is exactly the live signed-in pass V<PENDING> asks for.
 *
 * MUTATION PROOF (recorded in the session, not automated here): run against the pre-fix
 * Scheduler.jsx/navState.js (`git stash` the fix, rebuild, run, `git stash pop`, rebuild again) —
 * the pre-fix build reports `nav-dashboard` sent on the linked-row case; the fixed build reports
 * zero.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)  node ui-audit/verify-report-row-navigation.mjs
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

const GOOSE_CREEK_GID = "smqfy48tlk9j"; // real production id (Goose Creek) — read-only, matches B1614528's own repro
const LINKED = { id: "1", name: "Master Schedule", linkedSiteId: GOOSE_CREEK_GID, linkedSiteName: "Goose Creek" };
const UNLINKED = { id: "5", name: "Pursuits", linkedSiteId: null, linkedSiteName: null };
const PROJECTS = [LINKED, UNLINKED];

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

const site = (gid, name) => ({
  id: gid, groupId: gid, site: name, name: "Concept A", status: "active",
  origin: { lat: 29.77, lon: -95.38 }, county: "chambers",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(),
});
const seedScript = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [GOOSE_CREEK_GID]: site(GOOSE_CREEK_GID, "Goose Creek") })}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

// A stand-in for the embedded Gantt (public/sequence/index.html) that speaks the same bridge and
// exposes __simulateReportRowClick, mirroring the real app's goToTask: it flips the iframe's OWN
// section/activeId directly (never asks the shell first), exactly like a genuine Task Report row
// click — the shell's REACTION to that transition is the one thing under test.
const stubHtml = () => `<!doctype html><html><body style="margin:0;font:13px system-ui;padding:12px">
<div id="s">embedded-gantt-stub</div><script>
  window.__cmds = [];
  let aPid = null, section = "reports";
  const projects = ${JSON.stringify(PROJECTS)};
  const emit = () => {
    const list = projects.map(p => ({ id: p.id, name: p.name, linkedSiteId: p.linkedSiteId, linkedSiteName: p.linkedSiteName }));
    parent.postMessage({ source: "planar-seq", type: "planar:nav-state", section, activeId: aPid, projects: list }, window.location.origin);
  };
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || m.source !== "planar-shell") return;
    window.__cmds.push(m.type + (m.id != null ? (":" + m.id) : "") + (m.siteId != null ? (":site:" + m.siteId) : ""));
    document.getElementById("s").textContent = window.__cmds.join(" | ");
    if (m.type === "planar:nav-request") { emit(); return; }
    if (m.type === "planar:nav-select" && m.id != null) {
      if (projects.some(p => p.id === m.id)) { aPid = m.id; section = "projects"; emit(); }
    } else if (m.type === "planar:nav-select-by-site" && m.siteId != null) {
      const match = projects.find(p => p.linkedSiteId === m.siteId);
      if (match && !(aPid === match.id && section === "projects")) { aPid = match.id; section = "projects"; emit(); }
    } else if (m.type === "planar:nav-dashboard") {
      section = "reports"; emit();
    }
  });
  window.__simulateReportRowClick = (targetPid) => { aPid = targetPid; section = "projects"; emit(); };
  emit();
</script></body></html>`;

async function newCtx(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seedScript);
  await ctx.route(/supabase\.co/, (r) => r.abort()); // no cloud in the sandbox — fail fast, don't hang
  await ctx.route("**/sequence/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: stubHtml() }));
  return ctx;
}

const hashOf = (page) => page.evaluate(() => window.location.hash);
const stubCmds = async (page) => {
  for (const f of page.frames()) {
    if (f.url().includes("/sequence")) return await f.evaluate(() => window.__cmds || []).catch(() => null);
  }
  return null;
};
const simulateClick = (page, targetPid) => {
  for (const f of page.frames()) {
    if (f.url().includes("/sequence")) return f.evaluate((pid) => window.__simulateReportRowClick(pid), targetPid);
  }
  throw new Error("sequence stub frame not found");
};
// Sample the iframe wrapper's visibility for a window after the click, so a transient
// gridMismatched flash (hidden for even one frame) is caught, not just the settled state.
const sampleHiddenFrames = async (page, ms) => {
  const t0 = Date.now();
  let sawHidden = false;
  while (Date.now() - t0 < ms) {
    const hidden = await page.evaluate(() => {
      const f = document.querySelector("iframe");
      const wrap = f && f.parentElement;
      return !!(wrap && getComputedStyle(wrap).visibility === "hidden");
    }).catch(() => false);
    if (hidden) sawHidden = true;
    await page.waitForTimeout(20);
  }
  return sawHidden;
};

async function linkedCase(browser) {
  console.log("\nLINKED case — Task Report row for a project WITH a linked site");
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-report-row-navigation");
  await page.goto(`${BASE}#/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(2600);

  const before = await stubCmds(page);
  ok(Array.isArray(before), "the sequence stub is booted and reachable");

  const sawHiddenPromise = sampleHiddenFrames(page, 1500);
  await simulateClick(page, LINKED.id);
  const sawHidden = await sawHiddenPromise;

  const hash = await hashOf(page);
  const cmds = (await stubCmds(page)) || [];
  const dashboardCount = cmds.filter((c) => c === "planar:nav-dashboard").length;
  const carryInCount = cmds.filter((c) => c.startsWith("planar:nav-select-by-site")).length;

  console.log(`  cmds after click: [${cmds.join(", ")}]`);
  ok(hash.includes(GOOSE_CREEK_GID) && hash.includes("/schedule"), "the route adopts the linked site into #/project/<id>/schedule");
  ok(dashboardCount === 0, `no planar:nav-dashboard bounce is ever sent (saw ${dashboardCount})`);
  ok(carryInCount === 0, `no redundant planar:nav-select-by-site re-drive follows the click (saw ${carryInCount})`);
  ok(!sawHidden, "the grid is never hidden behind the gridMismatched loader during the transition");
  await ctx.close();
}

async function unlinkedCase(browser) {
  console.log("\nUNLINKED case — Task Report row for a project with NO linked site (regression check)");
  const ctx = await newCtx(browser);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-report-row-navigation");
  await page.goto(`${BASE}#/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(2600);

  await simulateClick(page, UNLINKED.id);
  await page.waitForTimeout(1200);

  const hash = await hashOf(page);
  const cmds = (await stubCmds(page)) || [];
  const dashboardCount = cmds.filter((c) => c === "planar:nav-dashboard").length;

  console.log(`  cmds after click: [${cmds.join(", ")}]`);
  ok(!hash.includes("/project/"), "an unlinked target correctly leaves the route project-less (no site to adopt)");
  ok(dashboardCount === 0, `the unlinked/cross-cutting pick is also never dragged back to reports (saw ${dashboardCount} nav-dashboard)`);
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
await linkedCase(browser);
await unlinkedCase(browser);
await browser.close();

console.log("\n" + (fails === 0
  ? "✅ PASS — a Task Report row link never bounces through planar:nav-dashboard, linked or unlinked"
  : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
