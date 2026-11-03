/**
 * B1442592 ("An empty new project is never written to the server") — the UI-honesty half of this
 * item, driven live in a headless browser (ATTEMPT-BEFORE-YOU-PARK: logged-out, no external GIS,
 * Claude-doable here — never filed as "needs a live pass").
 *
 * THE FINDING THIS PROVES. A project born through the "+ New project" button
 * (SitePlannerApp.jsx's `newBlankSite`, called with no origin) writes NOTHING anywhere — no
 * `public.sites` row, no local plan record — until its first real edit (this IS the deliberate
 * "Project creation is deliberately LAZY" owner constraint in the root CLAUDE.md, confirmed live
 * against the real RLS/soft-delete path in `db/test/sites_soft_delete_rls.test.sql`). Before this
 * fix, the dropdown's delete confirmation promised "It moves to Recently deleted — you can restore
 * it for 30 days" for EVERY project, including one with nothing anywhere to move — a project the
 * UI was presenting as saved when it never had been.
 *
 * CASE A drives the exact repro: click "+ New project" (no address/parcel picked — the plain
 * lazy-blank path), open its OWN manage menu, and confirm the confirmation now tells the honest
 * story ("hasn't been saved yet … there's nothing … to delete") with a "Close" action, never the
 * "moves to Recently deleted" promise.
 *
 * CASE B is the control: a project seeded with a real local plan record (the ordinary, already-
 * covered case in e2e/project-delete-bin.spec.js and friends) must be COMPLETELY UNCHANGED — same
 * "moves to Recently deleted" copy, same "Delete" button — proving this fix is additive, not a
 * regression of the normal path.
 *
 * Run: npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-unsaved-project-delete-copy.mjs
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1228/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

let fails = 0;
const ok = (cond, msg) => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); };

const site = (id, name) => ({
  id, groupId: id, site: name, name: "Concept A", status: "active",
  origin: { lat: 29.77, lon: -95.38 }, county: "harris",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(),
});
const seedScript = (sites) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

async function newCtx(browser, sites) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seedScript(sites));
  await ctx.route(/supabase\.co/, (r) => r.abort());
  return ctx;
}

async function caseUnsavedProject(browser) {
  console.log("\nCASE A — a lazily-created ('+ New project') project's OWN delete confirmation");
  const ctx = await newCtx(browser, { a1: site("a1", "Alpha Project") }); // one real sibling, for contrast
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-unsaved-project-delete-copy");
  await page.goto(`${BASE}#/site`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  await page.locator('[data-testid="project-crumb"]:visible').first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /new project/i }).click();
  await page.waitForTimeout(800);

  const hash = await page.evaluate(() => window.location.hash);
  const m = /#\/project\/([^/]+)\//.exec(hash);
  ok(!!m, `New project navigated to a project route (hash=${hash})`);
  const newId = m && m[1];

  // Confirm the lazy-write contract itself: nothing was written to the local sites store for it.
  const storedIds = await page.evaluate(() => Object.keys(JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))("planarfit:sites:v1") || "{}")));
  ok(newId && !storedIds.includes(newId), `the new project wrote NO local plan record (storedIds=${storedIds.join(",")}, newId=${newId})`);

  await page.locator('[data-testid="project-crumb"]:visible').first().click();
  await page.waitForTimeout(300);
  ok(await page.locator(`[data-testid="project-row-${newId}"]`).first().isVisible().catch(() => false),
    "the unsaved project still appears in the switcher (the withCurrentProject placeholder)");

  await page.locator(`[data-testid="project-kebab-${newId}"]`).first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="project-delete"]').first().click();
  await page.waitForTimeout(300);

  const menuText = (await page.locator('[data-testid="project-manage-menu"]').first().innerText().catch(() => "")) || "";
  ok(/hasn.t been saved yet/i.test(menuText), `confirmation says the project hasn't been saved yet (text: ${JSON.stringify(menuText.slice(0, 160))})`);
  ok(!/moves to recently deleted/i.test(menuText), "confirmation does NOT promise a Recently-deleted trip that can't happen");
  const confirmBtnText = ((await page.locator('[data-testid="project-delete-confirm"]').first().innerText().catch(() => "")) || "").trim();
  ok(/close/i.test(confirmBtnText), `the action button reads "Close", not "Delete" (was: "${confirmBtnText}")`);

  await page.locator('[data-testid="project-delete-confirm"]').first().click();
  await page.waitForTimeout(500);
  ok(!(await page.locator(`[data-testid="project-row-${newId}"]`).first().isVisible().catch(() => false)),
    "closing it removes it from the switcher");
  await ctx.close();
}

async function caseSavedProjectUnchanged(browser) {
  console.log("\nCASE B — CONTROL: a project WITH a real local plan record is completely unaffected");
  const ctx = await newCtx(browser, { b1: site("b1", "Beta Project") });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-unsaved-project-delete-copy");
  await page.goto(`${BASE}#/site`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  await page.locator('[data-testid="project-crumb"]:visible').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="project-kebab-b1"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="project-delete"]').first().click();
  await page.waitForTimeout(300);

  const menuText = (await page.locator('[data-testid="project-manage-menu"]').first().innerText().catch(() => "")) || "";
  ok(/moves to recently deleted/i.test(menuText), `a genuinely saved project still promises Recently deleted (text: ${JSON.stringify(menuText.slice(0, 160))})`);
  ok(!/hasn.t been saved yet/i.test(menuText), "the honest-unsaved copy does NOT leak onto a real saved project");
  const confirmBtnText = ((await page.locator('[data-testid="project-delete-confirm"]').first().innerText().catch(() => "")) || "").trim();
  ok(/^delete$/i.test(confirmBtnText), `the action button still reads "Delete" for a real project (was: "${confirmBtnText}")`);

  await page.locator('[data-testid="project-delete-confirm"]').first().click();
  await page.waitForTimeout(500);
  ok(!(await page.locator('[data-testid="project-row-b1"]').first().isVisible().catch(() => false)),
    "the real project is actually deleted");
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  try {
    await caseUnsavedProject(browser);
    await caseSavedProjectUnchanged(browser);
  } finally {
    await browser.close();
  }
  console.log(fails ? `\n${fails} FAILED` : "\nAll checks passed");
  process.exit(fails ? 1 : 0);
})();
