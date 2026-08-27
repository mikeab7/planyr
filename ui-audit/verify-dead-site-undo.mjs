/**
 * NEW-1 (B809904, 2026-08-27) — marking a site Dead must not make it disappear, and the
 * change must be reversible with an obvious "Undo" affordance (the planner's Ctrl+Z stack
 * can't reach a site-status write — it's a site-header write from a different component,
 * not an element edit, and can fire from the Map with no plan even open).
 *
 * Seeds ONE located "pursuit" site (logged-out path). Confirms, end to end through the
 * real UI (never a synthetic status write):
 *   1. Before: the site's map pin renders and its "Your sites" row is present.
 *   2. Setting its status to Dead via the real status menu — the pin STILL renders
 *      afterward (same marker count) and the row is still present, now reading "Dead".
 *   3. An "Undo" toast appears (role="status", so it's announced) naming the site + status.
 *   4. Clicking Undo reverts the status to Pursuit — pin still present, row reads
 *      "Pursuit" again, toast dismisses itself.
 *
 * Run:  npm run build && npx vite preview --port 4173 &   then   node ui-audit/verify-dead-site-undo.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/dead-site-undo/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const SITE_ID = "s_pursuit1";
const sites = {
  [SITE_ID]: {
    id: SITE_ID, groupId: SITE_ID, site: "Test Pursuit Deal", name: "Plan 1", status: "pursuit",
    origin: { lat: 29.76, lon: -95.4 }, county: "harris", parcels: [], els: [], measures: [],
    callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(),
  },
};

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const results = [];
const ok = (label, cond, extra = "") => { results.push({ cond }); console.log(`  ${cond ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`); };

const markerCount = (page) => page.locator(".leaflet-marker-icon").count();

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-dead-site-undo");
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(3000); // aerial tiles + marker layer + sites panel

  for (const sel of ['[title="Zoom to fit"]', '[title="Fit all"]', '[aria-label="Zoom to fit"]']) {
    try { await page.locator(sel).first().click({ timeout: 1500 }); await page.waitForTimeout(1000); break; } catch { /* keep trying */ }
  }

  // 1 — before: pin renders, row present, reads "Pursuit".
  const beforeCount = await markerCount(page);
  await page.screenshot({ path: OUT + "1-before.png" });
  ok("Pin renders before any status change", beforeCount === 1, `${beforeCount} markers`);
  const rowText0 = await page.locator("text=Test Pursuit Deal").first().locator("xpath=..").innerText().catch(() => "");
  ok("Row shows Pursuit before the change", /Pursuit/.test(rowText0), rowText0);

  // 2 — open the row's status menu (aria-label="Set status") and pick Dead.
  await page.locator('button[aria-label="Set status"]').first().click({ timeout: 3000 });
  await page.waitForTimeout(250);
  await page.locator('[aria-label="Project actions"] button', { hasText: "Dead" }).first().click({ timeout: 3000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + "2-marked-dead.png" });

  // 3 — the site must NOT disappear: same marker count on the map. The list's "Dead" section
  // is COLLAPSED by default (matching "Complete" — unchanged, reasonable, one click away), so
  // expand it before checking the row is genuinely still there, just recategorized.
  const afterDeadCount = await markerCount(page);
  ok("Pin STILL renders after marking Dead (NEW-1 — no disappearance)", afterDeadCount === beforeCount, `${afterDeadCount} markers (was ${beforeCount})`);
  try { await page.locator('button[title="Expand"]', { hasText: "Dead" }).first().click({ timeout: 1500 }); await page.waitForTimeout(200); } catch { /* already expanded */ }
  const rowText1 = await page.locator("text=Test Pursuit Deal").first().locator("xpath=..").innerText().catch(() => "");
  ok("Row is still present (in the Dead section) and reads Dead", /Dead/.test(rowText1), rowText1);

  // 4 — an Undo toast appeared, announced via role="status", naming the site + new status.
  const toast = page.locator('[data-testid="sync-toast"]').filter({ hasText: "Dead" }).first();
  const toastVisible = await toast.isVisible().catch(() => false);
  ok("An Undo toast appears after marking Dead", toastVisible);
  const toastText = toastVisible ? await toast.innerText().catch(() => "") : "";
  ok("Toast names the site and the new status", /Test Pursuit Deal/.test(toastText) && /Dead/.test(toastText), toastText);
  const undoBtn = toast.locator("button", { hasText: "Undo" });
  ok("Toast carries an Undo action", await undoBtn.count().then((n) => n > 0).catch(() => false));

  // 5 — click Undo: status reverts, pin still present, toast dismisses.
  await undoBtn.first().click({ timeout: 3000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + "3-after-undo.png" });
  const afterUndoCount = await markerCount(page);
  ok("Pin still renders after Undo", afterUndoCount === beforeCount, `${afterUndoCount} markers (was ${beforeCount})`);
  const rowText2 = await page.locator("text=Test Pursuit Deal").first().locator("xpath=..").innerText().catch(() => "");
  ok("Undo reverted the row back to Pursuit", /Pursuit/.test(rowText2), rowText2);
  const toastGone = await page.locator('[data-testid="sync-toast"]').filter({ hasText: "Dead" }).count();
  ok("The Undo toast dismisses itself after use", toastGone === 0, `${toastGone} matching toasts left`);

  ok("No page errors", pageErrors.length === 0, pageErrors.join(" | "));

  await ctx.close();
  await browser.close();

  const failed = results.filter((r) => !r.cond);
  console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
