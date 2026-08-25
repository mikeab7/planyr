/**
 * B748064 — live/headless proof for the fix in Scheduler.jsx/navState.js (isPickShowing).
 *
 * Owner report (2026-08-25), verbatim: "i click on operations here and nothing happens, fix."
 * Reproduced state, read off his screenshot: routed at Woods Road (site group_id smsrpaiqu5sv),
 * which has NO linked schedule — the Schedule tab shows its "No schedule for 'Woods Road'" empty
 * state — and the switcher dropdown lists his six real schedule projects: Goose Creek, Grand Port,
 * 8 South, Pursuits, Pappadoupolos, Operations.
 *
 * The six projects' link status below is READ, not guessed — pulled read-only from
 * planyr_production.planar_data (key 'hs-v1') and planyr_production.sites the same session this
 * harness was written in. Four carry a linkedSiteId (Goose Creek, Grand Port, 8 South,
 * Pappadoupolos); Operations and Pursuits do not — confirming the owner's own screenshot list order
 * and ruling in the "cross-cutting unlinked schedule" hypothesis over "the whole switcher is dead."
 *
 * Root cause (confirmed by code reading, not guessed): Scheduler.jsx's `currentProject` /
 * `showEmptyState` are derived PURELY from the routed site's own link. selectSchedule() DOES post
 * planar:nav-select to the iframe and the embedded app DOES switch its internal active project —
 * the pick genuinely lands — but for an UNLINKED target picking it never calls onProjectChange(),
 * so the route never moves, so the empty state (derived from the STALE route) keeps covering the
 * iframe that just switched underneath it. A LINKED target works today only because its pick also
 * moves the route.
 *
 * This harness never touches Supabase: the /sequence/ iframe is replaced with a same-origin stub
 * (same pattern as ui-audit/verify-module-context-carry.mjs) that speaks the real postMessage
 * contract and reports the real six-project list read above, so the real shell code
 * (Scheduler.jsx + ProjectBreadcrumb.jsx + navState.js) is exercised end to end in a real browser
 * with no cloud write of any kind.
 *
 * PART A — from Woods Road (no schedule), click each of the six in turn.
 * PART B — from Goose Creek (a linked schedule), click Operations — does the SAME switcher work
 *          differently once the routed project already has a schedule showing?
 *
 * MUTATION PROOF (not automated in this file — see the session record): this exact PART A case,
 * run against the build BEFORE isPickShowing()/pickShowing existed, reports Operations and
 * Pursuits stuck on the empty state (stillEmpty=true, showsTarget=false) — i.e. this harness goes
 * RED on the reported defect, not just green-by-construction. Re-run any time by stashing the fix
 * (`git stash`), rebuilding, running this file, then restoring (`git stash pop`) and rebuilding
 * again — the two runs' Operations/Pursuits rows must disagree.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-schedule-switcher-pick.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

// Real production ids, read read-only from planyr_production (Supabase MCP, SELECT only) the same
// session this harness was written — never written to, never touched destructively.
const WOODS_ROAD_GID = "smsrpaiqu5sv"; // Woods Road — confirmed to have NO linked schedule below
const PROJECTS = [
  { id: "1", name: "Goose Creek", linkedSiteId: "smqfy48tlk9j", linkedSiteName: "Goose Creek" },
  { id: "2", name: "Grand Port", linkedSiteId: "smqfy2r7pdec", linkedSiteName: "Grand Port" },
  { id: "3", name: "8 South", linkedSiteId: "smqiljx5fngg", linkedSiteName: "8 South" },
  { id: "5", name: "Pursuits", linkedSiteId: null, linkedSiteName: null },
  { id: "6", name: "Pappadoupolos", linkedSiteId: "smqgpt12zh5o", linkedSiteName: "Pappadoupolos" },
  { id: "7", name: "Operations", linkedSiteId: null, linkedSiteName: null },
];
const GOOSE_CREEK_GID = "smqfy48tlk9j";

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

const site = (gid, name) => ({
  id: gid, groupId: gid, site: name, name: "Concept A", status: "active",
  origin: { lat: 29.77, lon: -95.38 }, county: "chambers",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(),
});
const seedScript = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({
    [WOODS_ROAD_GID]: site(WOODS_ROAD_GID, "Woods Road"),
    [GOOSE_CREEK_GID]: site(GOOSE_CREEK_GID, "Goose Creek"),
  })}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

// A stand-in for the embedded Gantt (public/sequence/index.html) that speaks the same bridge:
// reports the REAL six-project list, and obeys planar:nav-select / nav-select-by-site exactly the
// way the shipped embed's message handler does (see index.html lines ~7274-7289), so a route-select
// genuinely flips its own aPid/section, matching the real app end to end.
const stubHtml = (initialActiveId) => `<!doctype html><html><body style="margin:0;font:13px system-ui;padding:12px">
<div id="s">embedded-gantt-stub</div><script>
  window.__cmds = [];
  let aPid = ${JSON.stringify(initialActiveId)}, section = "projects";
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
  emit();
</script></body></html>`;

async function newCtx(browser, { initialActiveId = "1" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seedScript);
  await ctx.route(/supabase\.co/, (r) => r.abort()); // no cloud in the sandbox — fail fast, don't hang
  await ctx.route("**/sequence/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: stubHtml(initialActiveId) }));
  return ctx;
}

const hashOf = (page) => page.evaluate(() => window.location.hash);
const stubState = async (page) => {
  for (const f of page.frames()) {
    if (f.url().includes("/sequence")) {
      return await f.evaluate(() => ({ cmds: window.__cmds || [] })).catch(() => null);
    }
  }
  return null;
};

// Open the switcher and click the row named `label`. Returns whether the row was found/clicked.
async function pickFromSwitcher(page, label) {
  await page.locator('[data-testid="project-crumb"]').first().click({ timeout: 6000 });
  await page.waitForTimeout(250);
  const row = page.locator(`button[title="${label}"]`).first();
  const found = await row.count().then((n) => n > 0).catch(() => false);
  if (!found) { await page.keyboard.press("Escape").catch(() => {}); return false; }
  await row.click({ timeout: 6000 });
  return true;
}

async function partA(browser) {
  console.log("\nPART A — from Woods Road (no schedule), click each of the six switcher rows");
  const results = [];
  for (const target of PROJECTS) {
    const ctx = await newCtx(browser, { initialActiveId: "1" });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-schedule-switcher-pick");
    await page.goto(`${BASE}#/project/${WOODS_ROAD_GID}/schedule`, { waitUntil: "load" });
    await page.waitForTimeout(2600);

    const bodyBefore = await page.evaluate(() => document.body.innerText);
    ok(bodyBefore.includes("No schedule"), `${target.name}: starting state shows the empty state (No schedule for Woods Road)`);

    const clicked = await pickFromSwitcher(page, target.name);
    ok(clicked, `${target.name}: row is present and clickable in the switcher`);
    await page.waitForTimeout(1200);

    const hash = await hashOf(page);
    const body = await page.evaluate(() => document.body.innerText);
    const st = (await stubState(page)) || { cmds: [] };
    const stillEmpty = body.includes("No schedule");
    const showsTarget = body.includes(target.name) && !stillEmpty;
    const postedSelect = st.cmds.some((c) => c === `planar:nav-select:${target.id}`);

    results.push({ name: target.name, linked: target.linkedSiteId != null, hash, stillEmpty, showsTarget, postedSelect, cmds: st.cmds });
    console.log(`  ${target.name.padEnd(14)} linked=${String(target.linkedSiteId != null).padEnd(5)} posted-select=${postedSelect} stillEmpty=${stillEmpty} showsTarget=${showsTarget}  cmds=[${st.cmds.join(", ")}]`);
    await ctx.close();
  }

  ok(results.every((r) => r.postedSelect), "every pick posts planar:nav-select to the embed (the message always goes out)");
  ok(results.every((r) => r.showsTarget && !r.stillEmpty),
     `every pick RESULTS in that schedule visibly showing (${results.filter((r) => r.stillEmpty).map((r) => r.name).join(", ") || "none stuck"} stuck on the empty state)`);
  const linkedRows = results.filter((r) => r.linked);
  ok(linkedRows.every((r) => r.hash.includes("/schedule")), "linked targets route to their own project (Site/Review/Library/Notes follow too)");
  return results;
}

async function partB(browser) {
  console.log("\nPART B — from Goose Creek (already has a linked schedule), click Operations");
  const ctx = await newCtx(browser, { initialActiveId: "1" });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-schedule-switcher-pick");
  await page.goto(`${BASE}#/project/${GOOSE_CREEK_GID}/schedule`, { waitUntil: "load" });
  await page.waitForTimeout(2600);

  const before = await page.evaluate(() => document.body.innerText);
  ok(before.includes("Goose Creek") && !before.includes("No schedule"), "starting state: Goose Creek's own schedule is showing, no empty state");

  const clicked = await pickFromSwitcher(page, "Operations");
  ok(clicked, "Operations row is present and clickable from a linked-project start too");
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => document.body.innerText);
  const hash = await hashOf(page);
  ok(after.includes("Operations") && !after.includes("No schedule"), "picking Operations from a linked project ALSO shows it (same mechanism, same fix)");
  ok(hash.includes(GOOSE_CREEK_GID), "the outer route stays on Goose Creek — Site/Review/Library/Notes are undisturbed by a cross-cutting pick");
  await page.screenshot({ path: new URL("./screens/schedule-switcher-pick-goosecreek-operations.png", import.meta.url).pathname });
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
mkdirSync(new URL("./screens/", import.meta.url).pathname, { recursive: true });
const resultsA = await partA(browser);
await partB(browser);
await browser.close();

console.log("\n" + (fails === 0 ? "✅ PASS — every switcher pick, linked or cross-cutting, now takes effect" : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
