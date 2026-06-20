/* B194/B195 verification — the Schedule module's Row-1 project picker must list the
 * EMBEDDED SCHEDULER's own projects (bridged from the iframe), not the Site Planner's
 * sites, and the home crumb must be module-contextual ("Map" in Site, "Dashboard" in
 * Schedule). We seed two distinctive Site projects so we can prove they do NOT leak
 * into the Schedule picker. The embedded scheduler falls back to its baked seed
 * (Goose Creek / Kilgore - Grand Port Logistics / Bee Sand Development) when its cloud
 * is unreachable — which is fine: the point is the picker reflects the iframe, not Site. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const SITE_A = "ZZ Site Alpha", SITE_B = "ZZ Site Beta";
const sites = {
  "zzsite-a": { id: "zzsite-a", groupId: "zzsite-a", site: SITE_A, name: "Plan 1", origin: null, county: null, parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() },
  "zzsite-b": { id: "zzsite-b", groupId: "zzsite-b", site: SITE_B, name: "Plan 1", origin: null, county: null, parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() - 1000 },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify(sites))});
  window.__navStates = [];
  window.addEventListener('message', (e) => { if (e.data && e.data.source === 'planar-seq') window.__navStates.push(e.data); });
} catch (e) {} })();`;

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 160)); });

const homeCrumbText = () => page.evaluate(() => {
  const b = document.querySelector('button[title^="All projects —"]');
  return b ? b.innerText.trim() : null;
});
const openPickerAndReadPanel = async () => {
  // The project crumb is the button right after the home crumb; open the dropdown.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const proj = btns.find(b => /Select a project/.test(b.innerText) || b.getAttribute('aria-haspopup') === 'menu');
    if (proj) proj.click();
  });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const input = document.querySelector('input[placeholder="Search projects…"]');
    return input ? (input.parentElement?.innerText || "") : "(picker did not open)";
  });
};
const closePicker = () => page.keyboard.press("Escape").catch(() => {});

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[title^="All projects —"]', { timeout: 15000 });
  await page.waitForTimeout(800);

  // ── SITE module ──
  const siteHome = await homeCrumbText();
  ok('Site module home crumb says "Map"', siteHome === "Map", `got "${siteHome}"`);
  const sitePanel = await openPickerAndReadPanel();
  ok("Site picker lists the seeded Site projects", sitePanel.includes(SITE_A) && sitePanel.includes(SITE_B), `panel="${sitePanel.replace(/\s+/g, " ").slice(0, 120)}"`);
  await closePicker();
  await page.waitForTimeout(200);

  // ── Switch to SCHEDULE ──
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === "Schedule");
    if (tab) tab.click();
  });
  // Wait for the iframe to mount + the bridge to emit nav-state.
  let navCount = 0;
  for (let i = 0; i < 40; i++) {
    navCount = await page.evaluate(() => (window.__navStates || []).length);
    if (navCount > 0) break;
    await page.waitForTimeout(500);
  }
  ok("Embedded scheduler emitted nav-state to the shell (bridge live)", navCount > 0, `nav-state messages=${navCount}`);

  const lastNav = await page.evaluate(() => (window.__navStates || []).slice(-1)[0] || null);
  if (lastNav) console.log("  last nav-state:", JSON.stringify({ section: lastNav.section, activeId: lastNav.activeId, projects: lastNav.projects }).slice(0, 240));

  const schedHome = await homeCrumbText();
  ok('Schedule module home crumb says "Dashboard"', schedHome === "Dashboard", `got "${schedHome}"`);

  const schedPanel = await openPickerAndReadPanel();
  const hasScheduler = lastNav && lastNav.projects && lastNav.projects.some(p => schedPanel.includes(p.name));
  ok("Schedule picker lists the SCHEDULER's own projects", !!hasScheduler, `panel="${schedPanel.replace(/\s+/g, " ").slice(0, 160)}"`);
  ok("Schedule picker does NOT show Site Planner projects", !schedPanel.includes(SITE_A) && !schedPanel.includes(SITE_B));

  // ── Command path: clicking a project switches it inside the iframe (echoed back) ──
  const target = lastNav.projects.find(p => p.id !== lastNav.activeId) || lastNav.projects[0];
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('button')].filter(b => b.innerText.includes(name));
    const row = rows[rows.length - 1]; // the dropdown row (last match)
    if (row) row.click();
  }, target.name);
  let switched = false;
  for (let i = 0; i < 20; i++) {
    const n = await page.evaluate(() => (window.__navStates || []).slice(-1)[0] || null);
    if (n && n.activeId === target.id && n.section === "projects") { switched = true; break; }
    await page.waitForTimeout(300);
  }
  ok(`Selecting "${target.name}" switches the active project in the scheduler`, switched, `target id=${target.id}`);

  // ── Command path: Dashboard crumb → the scheduler's reports/Dashboard view ──
  await page.evaluate(() => { const b = document.querySelector('button[title^="All projects —"]'); if (b) b.click(); });
  let onDash = false;
  for (let i = 0; i < 20; i++) {
    const n = await page.evaluate(() => (window.__navStates || []).slice(-1)[0] || null);
    if (n && n.section === "reports") { onDash = true; break; }
    await page.waitForTimeout(300);
  }
  ok('"Dashboard" crumb opens the scheduler Dashboard (reports) view', onDash);
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
} finally {
  const passed = results.filter(r => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await browser.close();
  process.exit(passed === results.length && results.length >= 8 ? 0 : 1);
}
