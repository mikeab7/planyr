/**
 * NEW-2 — switching modules inside a project must KEEP you in that project.
 *
 * Owner report (2026-07-31): *"if I'm in a project on the site planner module, and I jump to the
 * schedule module, it just takes me to the dashboard."* Grand Port DOES have a linked schedule, so
 * the "no schedule → fall back to the dashboard" theory is ruled out by the owner himself.
 *
 * What this proves, against the REAL built app:
 *   PART A — the transition TABLE. For every ordered pair of the five modules (Site · Schedule ·
 *            Review · Library · Notes), open module A on a project, click module B's real header
 *            tab, and assert the route still carries the project. This is the audit the brief asked
 *            for: the owner reported one pair, but the table covers all twenty.
 *   PART B — the Grand Port case, with the REAL production ids (site group smqfy2r7pdec ↔ schedule
 *            project 2, both read from planyr_production). The embedded Gantt talks to its own
 *            Supabase, unreachable from this sandbox, so — exactly as ui-audit/verify-cross-module-
 *            link.mjs does — the iframe is replaced by a STUB that speaks the same same-origin
 *            postMessage contract and RECORDS every command the shell posts down. That is what
 *            makes the real defect observable: the shell was posting nothing at all.
 *
 * The defect state reproduced in B2 is the one the owner's own cloud document is in: `aPid` already
 * names Grand Port's schedule while `section` is "reports" (the embed's own Dashboard), because
 * that is what the embed persists after a Dashboard press. The old carry-in compared only the
 * ACTIVE PROJECT, answered "nothing to do", and left the Dashboard on screen.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-module-context-carry.mjs
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

// Real production ids (planyr_production · sites.group_id ↔ planar_data hs-v1 projects).
const GID = "smqfy2r7pdec", SITE_NAME = "Grand Port", SCHED_ID = 2;
const PROJECTS = [
  { id: 1, name: "Goose Creek", linkedSiteId: "smqfy48tlk9j", linkedSiteName: "Goose Creek" },
  { id: SCHED_ID, name: SITE_NAME, linkedSiteId: GID, linkedSiteName: SITE_NAME },
  { id: 5, name: "Pursuits", linkedSiteId: null, linkedSiteName: null },
];

const MODULES = [
  { id: "site-planner", slug: "site", label: "Site" },
  { id: "scheduler", slug: "schedule", label: "Schedule" },
  { id: "doc-review", slug: "markup", label: "Review" },
  { id: "library", slug: "library", label: "Library" },
  { id: "notes", slug: "notes", label: "Notes" },
];

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

// A second, deliberately UNLINKED project — the "no schedule yet" case, which must land in the
// Schedule module on ITS create/link screen, never bounce to the dashboard.
const UNLINKED_GID = "grp-no-schedule", UNLINKED_NAME = "Katy Freeway Tract";

const site = (gid, name) => ({
  id: gid, groupId: gid, site: name, name: "Concept A", status: "active",
  origin: { lat: 29.77, lon: -95.38 }, county: "chambers",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(),
});
const seedScript = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({
    [GID]: site(GID, SITE_NAME), [UNLINKED_GID]: site(UNLINKED_GID, UNLINKED_NAME),
  })}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

// A stand-in for the embedded Gantt that speaks the same bridge and records what it is told.
const STUB = `<!doctype html><html><body style="margin:0;font:13px system-ui;padding:12px">
<div id="s">embedded-gantt-stub</div><script>
  window.__cmds = [];
  addEventListener("message", (e) => {
    const m = e.data;
    if (m && m.source === "planar-shell") { window.__cmds.push(m.type); document.getElementById("s").textContent = window.__cmds.join(" · "); }
  });
</script></body></html>`;

async function newCtx(browser, { stubSequence = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seedScript);
  await ctx.route(/supabase\.co/, (r) => r.abort());   // no cloud in the sandbox — fail fast, don't hang
  if (stubSequence) await ctx.route("**/sequence/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: STUB }));
  return ctx;
}

const hashOf = (page) => page.evaluate(() => window.location.hash);
const routeProject = (hash) => {
  const segs = String(hash).replace(/^#/, "").split("/").filter(Boolean);
  return segs[0] === "project" ? decodeURIComponent(segs[1] || "") : null;
};
const routeModuleSlug = (hash) => {
  const segs = String(hash).replace(/^#/, "").split("/").filter(Boolean);
  return segs[0] === "project" ? (segs[2] || null) : (segs[0] || null);
};
const postNav = (page, section, activeId) => page.evaluate(
  ([s, a, p]) => window.postMessage({ source: "planar-seq", type: "planar:nav-state", section: s, activeId: a, projects: p }, window.location.origin),
  [section, activeId, PROJECTS],
);
const stubCmds = async (page) => {
  for (const f of page.frames()) if (f.url().includes("/sequence")) return await f.evaluate(() => window.__cmds).catch(() => null);
  return null;
};

// ── PART A — every ordered module pair keeps the project ───────────────────────────────────
async function transitionTable(browser) {
  console.log("\nPART A — module transition table (does switching keep you in the project?)");
  const rows = [];
  const ctx = await newCtx(browser, { stubSequence: true });
  const page = await ctx.newPage();
  for (const from of MODULES) {
    for (const to of MODULES) {
      if (from.id === to.id) continue;
      await page.goto(`${BASE}#/project/${GID}/${from.slug}`, { waitUntil: "load" });
      await page.waitForTimeout(from.id === "site-planner" ? 2600 : 1500);
      const before = await hashOf(page);
      const tab = page.locator(`[data-testid=module-tab-${to.id}]:visible`).first();
      let clicked = true;
      await tab.click({ timeout: 6000 }).catch(() => { clicked = false; });
      await page.waitForTimeout(1400);
      const after = await hashOf(page);
      rows.push({
        from: from.label, to: to.label, clicked,
        kept: routeProject(after) === GID, slug: routeModuleSlug(after), after,
      });
    }
  }
  await ctx.close();

  const w = 9;
  console.log(`\n  ${"FROM".padEnd(w)}${"TO".padEnd(w)}  RESULT`);
  for (const r of rows) {
    const verdict = !r.clicked ? "tab not clickable"
      : r.kept && r.slug ? `keeps ${SITE_NAME}  (${r.after})`
      : `LOST CONTEXT → ${r.after}`;
    console.log(`  ${r.from.padEnd(w)}${r.to.padEnd(w)}  ${r.kept && r.clicked ? "✓" : "✗"} ${verdict}`);
  }
  ok(rows.every((r) => r.clicked), `every module tab is reachable from every other (${rows.filter((r) => !r.clicked).length} unreachable)`);
  ok(rows.every((r) => r.kept), `all ${rows.length} ordered module transitions preserve the routed project`);
  return rows;
}

// ── PART B — the reported case, on the real Grand Port ids ─────────────────────────────────
async function grandPortCase(browser) {
  console.log("\nPART B — Grand Port: Site Planner → Schedule, with the embed on its Dashboard");
  const ctx = await newCtx(browser, { stubSequence: true });
  const page = await ctx.newPage();

  // B1 — open Grand Port in the Site Planner from the dashboard, the way the owner does.
  await page.goto(`${BASE}#/`, { waitUntil: "load" });
  await page.waitForTimeout(3000);
  await page.locator(`text="${SITE_NAME}"`).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(2200);
  ok(routeProject(await hashOf(page)) === GID, `opening ${SITE_NAME} in the Site Planner puts it in the route (${await hashOf(page)})`);

  // B2 — switch to Schedule, then let the embed report the state the owner's own cloud document is
  // in: Grand Port's schedule is ALREADY the active one, but the embed is on its Dashboard.
  await page.locator("[data-testid=module-tab-scheduler]:visible").first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1200);
  ok(routeProject(await hashOf(page)) === GID, `the switch keeps ${SITE_NAME} in the route (${await hashOf(page)})`);

  await postNav(page, "reports", SCHED_ID);
  await page.waitForTimeout(2200);

  const cmds = (await stubCmds(page)) || [];
  ok(cmds.includes("planar:nav-select-by-site"),
     `the shell CARRIES the routed project into the schedule — it posts nav-select-by-site (saw: ${cmds.join(", ") || "nothing"})`);

  const crumb = await page.evaluate(() => document.body.innerText);
  ok(crumb.includes(SITE_NAME), `the breadcrumb names ${SITE_NAME} rather than going blank`);
  ok(!/Select a project/.test(crumb),
     `the breadcrumb never says "Select a project" while the URL names one (the app knowing and saying nothing)`);
  await page.screenshot({ path: new URL("./screens/module-context-grand-port.png", import.meta.url).pathname });

  // B3 — the second route to the same landing: carry in once, come back later with the embed on its
  // Dashboard again. The old "already carried this project" latch swallowed the re-drive.
  await postNav(page, "projects", SCHED_ID);           // adopted → latch closes
  await page.waitForTimeout(600);
  await page.locator("[data-testid=module-tab-site-planner]:visible").first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__cmdsBefore = true; });
  const before = ((await stubCmds(page)) || []).length;
  await postNav(page, "reports", SCHED_ID);            // the embed is back on its Dashboard
  await page.locator("[data-testid=module-tab-scheduler]:visible").first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(2200);
  const after = (await stubCmds(page)) || [];
  ok(after.length > before && after[after.length - 1] === "planar:nav-select-by-site",
     `returning to an already-carried project with the embed on its Dashboard RE-drives the carry-in (${before} → ${after.length} commands)`);

  // B4 — the deliberate pick must still stand: choosing the cross-cutting unlinked "Pursuits"
  // schedule inside the projects section is NOT yanked back to the routed project.
  await postNav(page, "projects", SCHED_ID);
  await page.waitForTimeout(500);
  const n0 = ((await stubCmds(page)) || []).length;
  await postNav(page, "projects", 5);                   // user picked Pursuits (unlinked)
  await page.waitForTimeout(1800);
  const n1 = ((await stubCmds(page)) || []).length;
  ok(n1 === n0, `a deliberate pick of an unlinked schedule inside the grid is left alone (${n0} → ${n1} commands)`);

  await ctx.close();
}

// ── PART C — a project with NO linked schedule: an empty state, never a bounce ──────────────
// The owner ruled this cause out for Grand Port, but it is the recurring disease in this codebase
// (the app knowing something and saying nothing), so it is asserted as its own case: switching into
// Schedule from an unlinked project must land you IN Schedule, on that project's create-or-link
// screen, naming it — not silently on the dashboard, which reads as a bug.
async function unlinkedProjectCase(browser) {
  console.log("\nPART C — a project with NO linked schedule");
  const ctx = await newCtx(browser, { stubSequence: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}#/project/${UNLINKED_GID}/site`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await page.locator("[data-testid=module-tab-scheduler]:visible").first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1200);
  // The embed reports its projects — none of them linked to this site.
  await postNav(page, "projects", SCHED_ID);
  await page.waitForTimeout(2000);

  ok(routeProject(await hashOf(page)) === UNLINKED_GID,
     `the switch keeps ${UNLINKED_NAME} in the route (${await hashOf(page)})`);
  ok(routeModuleSlug(await hashOf(page)) === "schedule", `you are IN the Schedule module, not bounced elsewhere`);
  const text = await page.evaluate(() => document.body.innerText);
  ok(text.includes(UNLINKED_NAME), `the screen names ${UNLINKED_NAME} — the project you came from`);
  ok(/link|create/i.test(text), `it offers the obvious next action (create or link a schedule)`);
  ok(!text.includes(UNLINKED_GID), `it never shows the raw project id as a name (B560)`);
  await page.screenshot({ path: new URL("./screens/module-context-unlinked.png", import.meta.url).pathname });
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
await transitionTable(browser);
await grandPortCase(browser);
await unlinkedProjectCase(browser);
await browser.close();

console.log("\n" + (fails === 0 ? "✅ PASS — module switching preserves project context" : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
