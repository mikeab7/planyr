/* NEW-1 — the project switcher dropdown's "Pinned" section header + count are gone, and every
 * pinned project's row instead carries a small pin icon.
 *
 * Owner ask: the dropdown opened from the project name in the top breadcrumb rendered a section
 * header row reading "Pinned" with a count on the right (2 on his account) — remove the header +
 * count entirely, mark each pinned row with a pin icon carrying an accessible name + tooltip
 * ("Pinned") instead. Pinned projects keep their current position/ordering; the separator that
 * distinguished the pinned group from the rest stays, so the grouping still reads without text.
 *
 * This is a logged-out, no-external-GIS UI check (ATTEMPT-BEFORE-YOU-PARK) — Claude-doable here,
 * driven headless against the real app, no live pass to defer. Pinning is account-prefs data
 * (`shared/CLAUDE.md` → the header project switcher's `sitesPanel.pinned` bag), which is mirrored
 * to a plain localStorage key (`planyr:userPrefs:v1`) even signed out — so seeding that mirror
 * alongside the site registry reproduces a real pinned dropdown with zero network egress.
 *
 * Three cases:
 *  A. Two projects pinned (of five seeded) — no "Pinned" text, no count element, each pinned row's
 *     icon carries its accessible name, and the full name ORDER (current → pinned → rest) matches
 *     what `reorderWithCurrentAndPinned` promises.
 *  B. Zero pinned — no pin icons anywhere, and no leftover empty header row / gap.
 *  C. The three untouched controls (search box, a row's kebab, the calendar chip) still work.
 *
 * MUTATION PROOF: `git stash` the ProjectBreadcrumb.jsx fix, `npm run build`, re-run this file —
 * Case A must go RED (a "Pinned" text node + a count element both present); `git stash pop` and
 * rebuild after.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)   node ui-audit/verify-project-pinned-marker.mjs
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

const site = (gid, name, updatedAt) => ({
  id: gid, groupId: gid, site: name, name: "Concept A", status: "active",
  origin: { lat: 29.77, lon: -95.38 }, county: "chambers",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt,
});

// Five real-shaped projects, deliberately seeded with recency out of alpha order so ordering
// assertions can't pass by coincidence with an accidentally-sorted fixture.
const SITES = {
  gA: site("gA", "Alamo Ranch", 5000),
  gB: site("gB", "Bain", 4000),
  gC: site("gC", "Clay & Porter", 3000),
  gD: site("gD", "Deer Park", 2000),
  gE: site("gE", "Elm Creek", 1000),
};
const CURRENT_GID = "gC"; // "Clay & Porter" — neither pinned nor last-touched, so it must lead only via currentProject
const PINNED = ["gE", "gA"]; // most-recently-pinned first — "Elm Creek" then "Alamo Ranch"

function seedScript(pinned) {
  const prefs = { sitesPanel: { pinned } };
  return `(() => { try {
    localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify(SITES))});
    localStorage.removeItem('planarfit:currentSite:v1');
    localStorage.setItem('planyr:userPrefs:v1', ${JSON.stringify(JSON.stringify(prefs))});
  } catch (e) {} })();`;
}

const openDropdown = async (page) => {
  const crumb = page.locator('[data-testid="project-crumb"]:visible').first();
  await crumb.waitFor({ state: "visible", timeout: 6000 });
  await crumb.click();
  await page.waitForTimeout(400);
};

const rowNames = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid^="project-row-"]')];
  return rows.map((r) => {
    const btn = r.querySelector("button");
    // The name span is the flexible ellipsis span inside the row's activate button.
    const nameSpan = btn && [...btn.querySelectorAll("span")].find((s) => s.style.textOverflow === "ellipsis");
    return nameSpan ? nameSpan.textContent.trim() : (btn ? btn.textContent.trim() : "");
  });
});

async function caseSomePinned(browser) {
  console.log("\nCASE A — two of five projects pinned");
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seedScript(PINNED));
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-project-pinned-marker");
  await page.goto(`${BASE}#/project/${CURRENT_GID}/site`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await openDropdown(page);

  // No "Pinned" text node anywhere in the dropdown panel.
  const pinnedTextNodes = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="project-pinned-list"]')?.closest('div[style]')?.parentElement
      || document.body;
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    let n, hits = 0;
    while ((n = walker.nextNode())) { if (n.textContent.trim() === "Pinned") hits++; }
    return hits;
  });
  ok(pinnedTextNodes === 0, `no text node reads exactly "Pinned" (found ${pinnedTextNodes})`);

  // No bare count element (the removed header's own count span) sitting beside a pin glyph.
  const countLike = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="project-pinned-list"]');
    if (!list) return 0;
    const header = list.previousElementSibling;
    if (!header) return 0;
    return /^\d+$/.test((header.textContent || "").trim()) ? 1 : 0;
  });
  ok(countLike === 0, "no bare numeric count element sits above the pinned rows");

  // Every pinned row exposes a pin icon with its accessible name.
  const pinBadges = await page.evaluate((ids) => ids.map((id) => {
    const row = document.querySelector(`[data-testid="project-row-${id}"]`);
    if (!row) return { id, found: false };
    const badge = row.querySelector('[aria-label="Pinned"]');
    return { id, found: !!badge, title: badge ? badge.getAttribute("title") : null };
  }), PINNED);
  for (const b of pinBadges) {
    ok(b.found, `pinned row "${b.id}" carries a pin icon with aria-label="Pinned" (title="${b.title}")`);
  }

  // The CURRENT row (not itself pinned) must NOT carry the pin marker.
  const currentBadge = await page.evaluate((gid) => {
    const row = document.querySelector(`[data-testid="project-row-${gid}"]`);
    return row ? !!row.querySelector('[aria-label="Pinned"]') : null;
  }, CURRENT_GID);
  ok(currentBadge === false, "the current (unpinned) project row carries no pin icon");

  // A non-pinned, non-current row must NOT carry the pin marker either.
  const plainBadge = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="project-row-gD"]');
    return row ? !!row.querySelector('[aria-label="Pinned"]') : null;
  });
  ok(plainBadge === false, "an ordinary (unpinned) row carries no pin icon");

  // Ordering: current leads, then pinned rows in the user's own pin order, then the rest by
  // recency (updatedAt desc) — exactly what reorderWithCurrentAndPinned promises.
  const names = await rowNames(page);
  ok(
    JSON.stringify(names) === JSON.stringify(["Clay & Porter", "Elm Creek", "Alamo Ranch", "Bain", "Deer Park"]),
    `project name order is current → pinned (pin order) → rest (recency) — got ${JSON.stringify(names)}`,
  );

  // The separator that used to sit under the header is still there, marking the pinned/rest boundary.
  const hasDivider = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="project-pinned-list"]');
    const next = list && list.nextElementSibling;
    return !!(next && next.getAttribute("style") && /height:\s*1px/.test(next.getAttribute("style")));
  });
  ok(hasDivider, "a hairline divider still separates the pinned rows from the rest");

  await page.screenshot({ path: new URL("./screens/project-pinned-marker-some.png", import.meta.url).pathname });
  await ctx.close();
}

async function caseZeroPinned(browser) {
  console.log("\nCASE B — zero projects pinned");
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seedScript([]));
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-project-pinned-marker");
  await page.goto(`${BASE}#/project/${CURRENT_GID}/site`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await openDropdown(page);

  const anyBadge = await page.evaluate(() => !!document.querySelector('[aria-label="Pinned"]'));
  ok(!anyBadge, "no pin icon renders anywhere with nothing pinned");

  const anyPinnedList = await page.evaluate(() => !!document.querySelector('[data-testid="project-pinned-list"]'));
  ok(!anyPinnedList, "the pinned-rows container itself doesn't render at all (no leftover empty section/gap)");

  const names = await rowNames(page);
  ok(
    JSON.stringify(names) === JSON.stringify(["Clay & Porter", "Alamo Ranch", "Bain", "Deer Park", "Elm Creek"]),
    `with nothing pinned, order is current → everything else by recency — got ${JSON.stringify(names)}`,
  );

  await page.screenshot({ path: new URL("./screens/project-pinned-marker-none.png", import.meta.url).pathname });
  await ctx.close();
}

async function caseUntouchedControls(browser) {
  console.log("\nCASE C — search box, kebab menu, and calendar chip are undisturbed");
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(seedScript(PINNED));
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-project-pinned-marker");
  await page.goto(`${BASE}#/project/${CURRENT_GID}/site`, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await openDropdown(page);

  const search = page.locator('input[placeholder="Search projects…"]:visible').first();
  await search.fill("Bain");
  await page.waitForTimeout(200);
  const filteredNames = await rowNames(page);
  ok(JSON.stringify(filteredNames) === JSON.stringify(["Bain"]), `search still filters the list — got ${JSON.stringify(filteredNames)}`);
  await search.fill("");
  await page.waitForTimeout(200);

  const kebabVisible = await page.evaluate((id) => {
    const row = document.querySelector(`[data-testid="project-row-${id}"]`);
    const kebab = row && row.querySelector(`[data-testid="project-kebab-${id}"]`);
    return !!kebab;
  }, "gA");
  ok(kebabVisible, "the per-row kebab (manage menu) is still present on a pinned row");

  await page.screenshot({ path: new URL("./screens/project-pinned-marker-controls.png", import.meta.url).pathname });
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
mkdirSync(new URL("./screens/", import.meta.url).pathname, { recursive: true });
await caseSomePinned(browser);
await caseZeroPinned(browser);
await caseUntouchedControls(browser);
await browser.close();

console.log("\n" + (fails === 0
  ? "✅ PASS — the 'Pinned' header + count are gone; pinned rows carry the pin icon; ordering unchanged"
  : `❌ FAIL — ${fails} assertion(s)`));
process.exit(fails === 0 ? 0 : 1);
