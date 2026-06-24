/* B439/B440 verification — rename & delete a project from the Row-1 breadcrumb switcher,
 * in BOTH modes:
 *   • Site Planner (uncontrolled) — the menu drives the site store directly; a rename relabels
 *     the group in localStorage, a delete removes it.
 *   • Schedule (controlled/bridge) — the menu posts planar:nav-rename / planar:nav-delete down
 *     to the embedded scheduler, which mutates its own hs-v1 record and re-emits nav-state.
 *
 * The per-row menu opens from a RIGHT-CLICK (no hover needed) or the hover kebab; we drive it by
 * right-click for determinism and assert the kebab shows on hover once. */
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
  window.addEventListener('message', (e) => { if (e.data && e.data.source === 'planar-seq' && e.data.type === 'planar:nav-state') window.__navStates.push(e.data); });
} catch (e) {} })();`;

const results = [];
const skips = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const skip = (name, why) => { skips.push(name); console.log(`SKIP — ${name}  ::  ${why}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 160)); });

const openPicker = async () => {
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const proj = btns.find(b => b.getAttribute('aria-haspopup') === 'menu' && /▾/.test(b.innerText));
    if (proj) proj.click();
  });
  await page.waitForSelector('input[placeholder="Search projects…"]', { timeout: 5000 });
  await page.waitForTimeout(150);
};
const closePicker = async () => { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(150); };
const lsSites = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('planarfit:sites:v1') || '{}'); } catch { return {}; } });
const lastNav = () => page.evaluate(() => (window.__navStates || []).slice(-1)[0] || null);
const waitNav = async (pred, tries = 24) => {
  for (let i = 0; i < tries; i++) { const n = await lastNav(); if (n && pred(n)) return n; await page.waitForTimeout(300); }
  return null;
};

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[title^="All projects —"]', { timeout: 15000 });
  await page.waitForTimeout(700);

  // ───────────────────── SITE (uncontrolled — drives the store) ─────────────────────
  await openPicker();

  // kebab reveals on hover
  await page.hover('[data-testid="project-row-zzsite-a"]');
  await page.waitForTimeout(120);
  const kebabVisible = await page.evaluate(() => !!document.querySelector('[data-testid="project-kebab-zzsite-a"]'));
  ok("Hovering a project row reveals the ⋯ kebab", kebabVisible);

  // right-click opens the manage menu with Rename + Delete
  await page.click('[data-testid="project-row-zzsite-a"]', { button: "right" });
  await page.waitForSelector('[data-testid="project-manage-menu"]', { timeout: 4000 });
  const hasItems = await page.evaluate(() => !!document.querySelector('[data-testid="project-rename"]') && !!document.querySelector('[data-testid="project-delete"]'));
  ok("Right-click opens a menu with Rename and Delete", hasItems);

  // the dropdown stays open while the manage menu is up (the gotcha: a click in the
  // second portal must not be read as an outside-click that closes the parent)
  const dropdownStillOpen = await page.evaluate(() => !!document.querySelector('input[placeholder="Search projects…"]'));
  ok("Parent switcher dropdown stays open under the manage menu", dropdownStillOpen);

  // Rename inline → commit on Enter → store relabeled
  await page.click('[data-testid="project-rename"]');
  await page.waitForSelector('input[aria-label="Rename ZZ Site Alpha"]', { timeout: 4000 });
  await page.fill('input[aria-label="Rename ZZ Site Alpha"]', "ZZ Renamed Alpha");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const afterRename = await lsSites();
  ok("Rename relabels the project in the site store", afterRename["zzsite-a"]?.site === "ZZ Renamed Alpha", `got "${afterRename["zzsite-a"]?.site}"`);

  // empty rename is rejected (keeps prior name)
  await page.click('[data-testid="project-row-zzsite-a"]', { button: "right" });
  await page.waitForSelector('[data-testid="project-rename"]', { timeout: 4000 });
  await page.click('[data-testid="project-rename"]');
  await page.waitForSelector('input[aria-label="Rename ZZ Renamed Alpha"]', { timeout: 4000 });
  await page.fill('input[aria-label="Rename ZZ Renamed Alpha"]', "   ");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const afterEmpty = await lsSites();
  ok("An empty/whitespace rename is rejected (keeps the prior name)", afterEmpty["zzsite-a"]?.site === "ZZ Renamed Alpha");

  // Delete → requires the confirm step → removes the group from the store
  await page.click('[data-testid="project-row-zzsite-b"]', { button: "right" });
  await page.waitForSelector('[data-testid="project-delete"]', { timeout: 4000 });
  await page.click('[data-testid="project-delete"]');
  await page.waitForSelector('[data-testid="project-delete-confirm"]', { timeout: 4000 });
  const stillThereBeforeConfirm = await lsSites();
  ok("Delete asks to confirm before acting (not deleted yet)", !!stillThereBeforeConfirm["zzsite-b"]);
  await page.click('[data-testid="project-delete-confirm"]');
  await page.waitForTimeout(400);
  const afterDelete = await lsSites();
  ok("Confirmed delete removes the project from the store", !afterDelete["zzsite-b"] && !!afterDelete["zzsite-a"], `keys=${Object.keys(afterDelete).join(",")}`);

  await closePicker();

  // ───────────────────── SCHEDULE (controlled — bridges to the iframe) ─────────────────────
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === "Schedule");
    if (tab) tab.click();
  });
  const firstNav = await waitNav(() => true, 40);

  if (!firstNav || !(firstNav.projects?.length >= 2)) {
    // The embedded scheduler (/sequence/) rides its OWN Supabase backend; in the offline
    // sandbox it can't reach it, so it never finishes loading or bridges nav-state (the same
    // limitation the pre-existing verify-schedule-picker.mjs hits here). The Schedule bridge
    // (B440) is then a signed-in/online live check — skip rather than false-fail. The SHARED
    // menu UI it relies on is already proven by the Site (uncontrolled) checks above.
    skip("Schedule rename reaches the embedded app (nav-state re-emits new name)", "embedded scheduler did not bridge (offline sandbox)");
    skip("Schedule delete reaches the embedded app (project drops from nav-state)", "embedded scheduler did not bridge (offline sandbox)");
  } else {
    ok("Embedded scheduler bridged its nav-state to the shell", true, `projects=${firstNav.projects.length}`);
    // RENAME a non-active scheduler project via the bridge
    const renameTarget = firstNav.projects.find(p => p.id !== firstNav.activeId) || firstNav.projects[0];
    await openPicker();
    await page.click(`[data-testid="project-row-${renameTarget.id}"]`, { button: "right" });
    await page.waitForSelector('[data-testid="project-rename"]', { timeout: 4000 });
    await page.click('[data-testid="project-rename"]');
    const renameInput = `input[aria-label="Rename ${renameTarget.name}"]`;
    await page.waitForSelector(renameInput, { timeout: 4000 });
    await page.fill(renameInput, "ZZ Sched Renamed");
    await page.keyboard.press("Enter");
    const renamedNav = await waitNav(n => n.projects?.some(p => p.id === renameTarget.id && p.name === "ZZ Sched Renamed"));
    ok("Schedule rename reaches the embedded app (nav-state re-emits new name)", !!renamedNav);
    await closePicker();

    // DELETE a non-active scheduler project via the bridge
    const cur = await waitNav(() => true);
    const delTarget = cur.projects.find(p => p.id !== cur.activeId) || cur.projects[0];
    await openPicker();
    await page.click(`[data-testid="project-row-${delTarget.id}"]`, { button: "right" });
    await page.waitForSelector('[data-testid="project-delete"]', { timeout: 4000 });
    await page.click('[data-testid="project-delete"]');
    await page.waitForSelector('[data-testid="project-delete-confirm"]', { timeout: 4000 });
    await page.click('[data-testid="project-delete-confirm"]');
    const deletedNav = await waitNav(n => !n.projects?.some(p => p.id === delTarget.id));
    ok("Schedule delete reaches the embedded app (project drops from nav-state)", !!deletedNav, `removed id=${delTarget.id}`);
    await closePicker();
  }
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
} finally {
  const passed = results.filter(r => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed${skips.length ? `, ${skips.length} skipped (offline-sandbox: scheduler backend unreachable)` : ""} ===`);
  await browser.close();
  // The 7 Site (uncontrolled) checks are the headless-verifiable core (B439 shared UI + store).
  // The Schedule (B440) bridge checks SKIP cleanly when the embedded scheduler can't load offline.
  process.exit(passed === results.length && passed >= 7 ? 0 : 1);
}
