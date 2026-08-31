/**
 * B735 (×2) — the project switcher's per-row "Delete" is silently swallowed if its menu (or the
 * switcher dropdown it lives inside) is left open across a kept-alive module switch.
 *
 * Owner report (2026-08-31), a chat block filed alongside the B933856 (×3) Dashboard-breadcrumb
 * item, with a note that it might share the same root cause: "this delete button doesn't seem to
 * do anything." Repro: open the project switcher from the breadcrumb, click the kebab on a
 * project row, choose Delete — nothing happens, no confirmation appears.
 *
 * AUDIT-FIRST: the owner's own schema read (no `projects` table, `sites.group_id` a plain jsonb
 * mirror) suggested "delete has nowhere to write." That is WRONG — `deleteSiteGroup` (storage.js)
 * is a real, working soft-delete (every plan in the group, `deleted_at` stamped, restorable for
 * 30 days) already wired end to end through `ProjectBreadcrumb.jsx`'s `doDelete`. CASE A below
 * proves the plain click-through-to-delete path works perfectly with nothing else going on — the
 * bug is not in the delete mechanism itself.
 *
 * ROOT CAUSE (found by direct reproduction, not guessed): this app's kept-alive workspaces (every
 * visited module stays mounted, hidden with `display:none`, per the 2026-07-05 "faster tab
 * switch" feature) never remount their popups when hidden. The kebab's OWN per-row menu is built
 * from `ContextMenu.jsx` (NOT `AnchoredMenu.jsx` — the project breadcrumb's OUTER switcher
 * dropdown uses AnchoredMenu, but the nested per-row Rename/Delete popup is a different, more
 * widely-reused primitive, `ContextMenu`, also used by map pins, canvas elements, parcels,
 * markups, the Library folder tree, and Doc Review markup objects). Neither primitive had any way
 * to notice "my host workspace just went away" — `ContextMenu` opens at a fixed cursor x/y with no
 * anchor element to watch at all, and even `AnchoredMenu`'s anchor-geometry fix (B1125) never
 * fires for a NESTED case like this one, because the outer switcher's own panel hides itself with
 * `visibility:hidden` (not `display:none`) — which keeps every descendant's layout box, the kebab
 * button included, at its ordinary non-zero size the entire time. So leaving the switcher+kebab
 * open, then switching module tabs, left the kebab's full-viewport click-away backdrop mounted,
 * invisible, over the newly-active workspace — confirmed via `elementFromPoint` at its center —
 * silently eating every click there, and switching back left the SAME trap over the original
 * workspace too, blocking even the switcher's own trigger button.
 *
 * THE FIX has two parts, both in the shared primitives (fixed once, not per-consumer):
 *   1. `AnchoredMenu.jsx` gained a `ResizeObserver` on the anchor (catches a `display:none`
 *      collapse `resize`/`scroll` can't) AND a `hashchange` listener that fully closes the menu
 *      (this app's entire route lives in the hash — route.js — so no consumer here ever needs a
 *      menu to survive a navigation).
 *   2. `ContextMenu.jsx` gained the same `hashchange` close (it has no anchor to watch at all).
 *   3. ⛔ THE SUBTLE PART, MEASURED not guessed: a bare `[onClose]` (or `[open, onClose]`) effect
 *      dependency is racy for this SPECIFIC event, because every consumer passes an inline arrow
 *      (`onClose={() => setMenuFor(null)}`) — a fresh identity every render — and the HOST
 *      re-renders as a direct side effect of the very `hashchange` this listener exists to catch
 *      (the route change that fires it is what switches workspaces). That tears the listener down
 *      and re-adds it on the SAME render, and browsers snapshot a native event's listener list at
 *      DISPATCH time, so a listener removed mid-dispatch is skipped for the event already in
 *      flight. Measured with a bare dependency: the handler fired 0 times per navigation, every
 *      time — deterministic, not a rare race. Both components now read `onClose` through a REF
 *      (updated every render, never a dependency), so the listener registers once per mount and
 *      is never torn down by the very re-render it needs to survive.
 *
 * CASE B reproduces the owner's exact repro end to end: open the switcher, open a row's kebab,
 * leave both open, navigate to a DIFFERENT module via a genuine hashchange, confirm the new
 * workspace is NOT covered by an invisible interceptor, then return and prove a FRESH delete on a
 * different project still reaches its confirmation view and actually deletes.
 *
 * MUTATION PROOF: run once as-is (green). Then, to reproduce the exact pre-fix shape, either
 * `git stash` both fixed files and rebuild (CASE B must go RED — `elementFromPoint` at the new
 * workspace's center returns the stale interceptor div, not real content, and re-opening the
 * switcher back on Site Planyr times out), or revert just the ref-stabilization (swap `onCloseRef`
 * back to a bare `onClose` dependency) to reproduce the subtler, fully-deterministic miss on its
 * own. `git stash pop` (or revert) and rebuild to restore.
 *
 * This harness never touches Supabase — logged-out, local-only projects (the bug and fix are pure
 * client-side UI, no cloud dependency at all).
 *
 * Run: npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-project-delete-menu.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
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

async function caseSimpleDelete(browser) {
  console.log("\nCASE A — plain switcher → kebab → Delete → confirm → delete, nothing else going on");
  const ctx = await newCtx(browser, { a1: site("a1", "Alpha Project") });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-project-delete-menu");
  await page.goto(`${BASE}#/`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  await page.locator('[data-testid="project-crumb"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="project-kebab-a1"]').first().click();
  await page.waitForTimeout(300);
  ok(await page.locator('[data-testid="project-delete"]').first().isVisible().catch(() => false),
    "kebab Delete row is visible");

  await page.locator('[data-testid="project-delete"]').first().click();
  await page.waitForTimeout(300);
  ok(await page.locator('[data-testid="project-delete-confirm"]').first().isVisible().catch(() => false),
    "confirm view appears on the first Delete click");

  await page.locator('[data-testid="project-delete-confirm"]').first().click();
  await page.waitForTimeout(500);
  ok(!(await page.locator('[data-testid="project-row-a1"]').first().isVisible().catch(() => false)),
    "the project is actually gone from the list after the final Delete");
  await ctx.close();
}

async function caseStaleMenuAcrossNav(browser) {
  console.log("\nCASE B — B735 (×2) repro: switcher + kebab left open, navigate away and back, then delete a DIFFERENT project fresh");
  const ctx = await newCtx(browser, { a1: site("a1", "Alpha Project"), b1: site("b1", "Beta Project") });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-project-delete-menu");
  await page.goto(`${BASE}#/`, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  console.log("  open switcher, open Alpha's kebab menu — leave BOTH open (the owner got distracted / moved on)");
  await page.locator('[data-testid="project-crumb"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="project-kebab-a1"]').first().click();
  await page.waitForTimeout(300);
  ok(await page.locator('[data-testid="project-delete"]').first().isVisible().catch(() => false),
    "kebab Delete row is visible before navigating away");

  console.log("  navigate to Notes via a real hashchange (what any header-tab click ultimately fires)");
  await page.evaluate(() => { window.location.hash = "#/notes"; });
  await page.waitForTimeout(1500);
  ok((await page.evaluate(() => window.location.hash)) === "#/notes", "really moved to Notes");

  const centerInfo = await page.evaluate(() => {
    const el = document.elementFromPoint(700, 450);
    return el ? { tag: el.tagName, style: el.getAttribute("style") || "" } : null;
  });
  console.log(`  element at the new workspace's center: ${JSON.stringify(centerInfo)}`);
  const isStaleInterceptor = !!(centerInfo && centerInfo.tag === "DIV" && /inset:\s*0/.test(centerInfo.style) && centerInfo.style.includes("z-index"));
  ok(!isStaleInterceptor, "the new workspace is NOT covered by an invisible full-viewport interceptor");

  const beforeHash = await page.evaluate(() => window.location.hash);
  await page.mouse.click(700, 450);
  await page.waitForTimeout(300);
  const afterClick = await page.evaluate(() => ({ hash: window.location.hash, active: document.activeElement && document.activeElement.tagName }));
  ok(afterClick.hash === beforeHash, "a plain click inside the new workspace doesn't accidentally navigate (sanity — it's real content, not a stray backdrop)");

  // A click blocked by a leftover interceptor (the pre-fix shape) must FAIL the assertion loudly,
  // never crash the whole run — a mutation proof needs a clean tally even when the fix is absent.
  const clickOrFail = async (selector, label) => {
    try { await page.locator(selector).first().click({ timeout: 8000 }); return true; }
    catch (_) { ok(false, `${label} (click was blocked — a leftover interceptor is still up)`); return false; }
  };

  console.log("  go back to Site Planyr, open the switcher fresh, delete a DIFFERENT project (Beta)");
  await page.evaluate(() => { window.location.hash = "#/"; });
  await page.waitForTimeout(1000);
  ok(await page.locator('[data-testid="project-crumb"]').first().isVisible().catch(() => false),
    "project-crumb is visible again after returning");

  if (await clickOrFail('[data-testid="project-crumb"]', "switcher reopens (no leftover backdrop blocking its own trigger)")) {
    await page.waitForTimeout(300);
    ok(true, "switcher reopens (no leftover backdrop blocking its own trigger)");

    if (await clickOrFail('[data-testid="project-kebab-b1"]', "Beta's kebab opens")) {
      await page.waitForTimeout(300);
      ok(await page.locator('[data-testid="project-delete"]').first().isVisible().catch(() => false),
        "Beta's kebab Delete row is visible");

      if (await clickOrFail('[data-testid="project-delete"]', "clicking Delete opens the confirm view")) {
        await page.waitForTimeout(300);
        ok(await page.locator('[data-testid="project-delete-confirm"]').first().isVisible().catch(() => false),
          "confirm view appears — THIS is the step the owner reported as doing nothing");

        if (await clickOrFail('[data-testid="project-delete-confirm"]', "the final Delete click lands")) {
          await page.waitForTimeout(600);
          ok(!(await page.locator('[data-testid="project-row-b1"]').first().isVisible().catch(() => false)),
            "Beta is actually deleted");
        }
      }
    }
  }
  await page.screenshot({ path: new URL("./screens/project-delete-menu-stale-nav.png", import.meta.url).pathname });
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
mkdirSync(new URL("./screens/", import.meta.url).pathname, { recursive: true });
await caseSimpleDelete(browser);
await caseStaleMenuAcrossNav(browser);
await browser.close();

console.log("\n" + (fails === 0
  ? "✅ PASS — Delete works with nothing else going on, and still works after a switcher/kebab menu is left open across a module switch"
  : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
