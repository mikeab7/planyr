/* Self-verification for B885136 (NEW-1 — sites panel row Option E) and B885137 (NEW-2 — shrink
 * the two Map-view header bars). Owner chat block 2026-08-30/31, approved mockups ("E - Quiet" +
 * "Headers - before/after"). Logged-out / this-device mode per ATTEMPT-BEFORE-YOU-PARK — every
 * check here is Claude-doable without a signed-in session.
 *
 * Site names below are the owner's own portfolio, taken verbatim from the approved mockup's row
 * data (Richfield / Bain / Richey / Woods Road / Schiel / Silvestri / Clay & Porter / Tsakiris /
 * Pappadoupolos / Will Clayton) — this is the WRONG-CASE-safe fixture the brief itself points at,
 * not an invented one.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5173/";
const OUT = new URL("./screens/b885136-b885137/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const parcelAt = (w = 200, h = 200) => [{ id: "pp1", active: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }];
const now = Date.now();
const mk = (id, name, status, ageMs, lat, lon, opts = {}) => ({
  id, groupId: id, site: name, name: "Plan 1", status, origin: { lat, lon }, county: "harris",
  parcels: opts.parcels || parcelAt(), els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: now - ageMs, teamId: opts.teamId || null,
});
// All ten under ONE status (pursuit) — matches the approved "E - Quiet" mockup exactly (one
// "Pursuit · 14" group holding this whole example list), and sidesteps the unrelated
// Complete/Dead default-collapse behavior (B859504) that has nothing to do with this item.
const sites = {
  s1: mk("s1", "Richfield", "pursuit", 1 * 86400_000, 29.78, -95.39, { teamId: "team-hip" }),
  s2: mk("s2", "Bain", "pursuit", 2 * 86400_000, 29.77, -95.37),
  s3: mk("s3", "Richey", "pursuit", 2 * 86400_000, 29.76, -95.38),
  s4: mk("s4", "Woods Road", "pursuit", 3 * 86400_000, 29.75, -95.40),
  s5: mk("s5", "Schiel", "pursuit", 3 * 86400_000, 29.74, -95.41),
  s6: mk("s6", "Silvestri", "pursuit", 4 * 86400_000, 29.79, -95.42),
  s7: mk("s7", "Clay & Porter", "pursuit", 5 * 86400_000, 29.80, -95.43),
  s8: mk("s8", "Tsakiris", "pursuit", 22 * 86400_000, 29.81, -95.44),
  s9: mk("s9", "Pappadoupolos", "pursuit", 33 * 86400_000, 29.82, -95.45),
  s10: mk("s10", "Will Clayton", "pursuit", 48 * 86400_000, 29.83, -95.46),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
  localStorage.removeItem('planarfit:sitesGroups:v1');
  localStorage.removeItem('planarfit:sitesPanelClosed:v1');
} catch (e) {} })();`;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`  ${cond ? "PASS" : "FAIL"} — ${name}${extra ? " · " + extra : ""}`); };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

  // ===== Desktop pass: sites panel (NEW-1) =====
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-b885136-sites-panel-header");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  const rowLoc = (name) => page.locator('div[title*="Open site"]').filter({ hasText: name }).first();

  // ---- (a) no site name truncates that did not have to, at the panel's default width ----
  for (const name of ["Richfield", "Bain", "Richey", "Woods Road", "Schiel", "Silvestri", "Clay & Porter", "Tsakiris", "Pappadoupolos", "Will Clayton"]) {
    const nameSpan = rowLoc(name).locator("span").first();
    const full = await nameSpan.evaluate((el) => el.scrollWidth <= el.clientWidth + 1).catch(() => null);
    ok(`"${name}" is not truncated at default panel width`, full === true, `scrollWidth<=clientWidth: ${full}`);
  }

  // ---- no per-row status dot INSIDE a status group (the group header carries it) ----
  const groupedDotCount = await page.locator('div[title*="Open site"] button[title^="Status:"]').count();
  ok("no per-row status dot renders inside a status group", groupedDotCount === 0, `${groupedDotCount} found`);

  // ---- Pinned section (the flat/mixed-status view) still gets a per-row dot ----
  await rowLoc("Bain").click({ button: "right" });
  await page.waitForTimeout(300);
  const pinItem = page.locator('button[title*="Pin this project"]').first();
  const hasPinItem = await pinItem.count() > 0;
  if (hasPinItem) {
    await pinItem.click();
    await page.waitForTimeout(300);
    const pinnedHeader = await page.locator("span").filter({ hasText: "Pinned" }).count();
    ok("a 'Pinned' section header appears after pinning", pinnedHeader >= 1, `${pinnedHeader} found`);
    const pinnedDot = await page.locator('div[title*="Open site"] button[title^="Status:"]').count();
    ok("Pinned (flat/mixed-status) rows DO still carry a per-row status dot", pinnedDot >= 1, `${pinnedDot} found`);
  } else {
    await page.keyboard.press("Escape").catch(() => {});
    ok("Pinned (flat/mixed-status) rows DO still carry a per-row status dot", false, "could not find the 'Pin this project…' context menu item — SKIPPED, not a pass");
  }

  // ---- (b) no string in a row is duplicated from its group header ----
  const groupHeaderText = await page.locator('button[title="Collapse"], button[title="Expand"]').filter({ hasText: "Pursuit" }).first().innerText().catch(() => "");
  const richfieldRowText = await rowLoc("Richfield").innerText().catch(() => "");
  ok("group header reads 'Pursuit' with a count", /Pursuit/i.test(groupHeaderText) && /\d/.test(groupHeaderText), JSON.stringify(groupHeaderText));
  ok("row text does not repeat the group's status word", !/pursuit/i.test(richfieldRowText), JSON.stringify(richfieldRowText));

  // ---- org chip hidden at rest, reveals on hover ----
  // Signed out (this sandbox), `myTeams` is always [] — sharedWithDisplay resolves an
  // unrecognized teamId to "unknown" (falls back to the plain share glyph, title="Shared"),
  // never "team" (the resolved-name chip, title="Shared with X" — that needs a real signed-in
  // roster, covered separately by V466400/Blocker:auth). Either way the SAME reveal mechanism
  // is under test here, so accept both titles.
  const richfieldRow = rowLoc("Richfield");
  const chipAtRest = richfieldRow.locator('span[title="Shared"], span[title^="Shared with"]').first();
  ok("org chip element exists in the DOM at rest (not conditionally unmounted)", await chipAtRest.count() > 0);
  const restOpacity = await chipAtRest.evaluate((el) => getComputedStyle(el).opacity).catch(() => null);
  ok("org chip is present but invisible (opacity 0) at rest", restOpacity === "0", `opacity=${restOpacity}`);

  // ---- (c) hovering a row does not move the name or the date by a single pixel ----
  const nameBefore = await richfieldRow.locator("span").first().boundingBox();
  const dateBefore = await richfieldRow.locator('span[title^="Last edited"]').first().boundingBox();
  await richfieldRow.hover();
  await page.waitForTimeout(250);
  const hoverOpacity = await chipAtRest.evaluate((el) => getComputedStyle(el).opacity).catch(() => null);
  ok("org chip reveals on hover (opacity 1)", hoverOpacity === "1", `opacity=${hoverOpacity}`);
  const nameAfter = await richfieldRow.locator("span").first().boundingBox();
  const dateAfter = await richfieldRow.locator('span[title^="Last edited"]').first().boundingBox();
  ok("hovering does not move the name box (x)", nameBefore && nameAfter && Math.abs(nameBefore.x - nameAfter.x) < 0.5, `${nameBefore?.x} -> ${nameAfter?.x}`);
  ok("hovering does not move the name box (width)", nameBefore && nameAfter && Math.abs(nameBefore.width - nameAfter.width) < 0.5, `${nameBefore?.width} -> ${nameAfter?.width}`);
  ok("hovering does not move the date column (x)", dateBefore && dateAfter && Math.abs(dateBefore.x - dateAfter.x) < 0.5, `${dateBefore?.x} -> ${dateAfter?.x}`);
  await page.mouse.move(700, 700);
  await page.waitForTimeout(250);

  // ---- keyboard focus also reveals the org chip + locate target ----
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  const chipHandle = await chipAtRest.elementHandle();
  if (chipHandle) { await page.evaluate((el) => el.focus(), chipHandle); }
  await page.waitForTimeout(200);
  const focusOpacity = await chipAtRest.evaluate((el) => getComputedStyle(el).opacity).catch(() => null);
  ok("org chip reveals on keyboard focus (opacity 1), not just mouse hover", focusOpacity === "1", `opacity=${focusOpacity}`);
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });

  await page.screenshot({ path: OUT + "sites-panel-default.png" });

  // ---- row height: 28px in grouped rows at desktop width ----
  const rowH = await richfieldRow.evaluate((el) => el.getBoundingClientRect().height);
  ok("desktop row height is 28px", Math.abs(rowH - 28) < 0.5, `${rowH}px`);

  ok("no uncaught page errors (desktop sites panel)", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();

  // ===== Narrow/touch pass: bigger row height, panel still renders =====
  const narrowCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await narrowCtx.addInitScript(seed);
  const narrowPage = await narrowCtx.newPage();
  const narrowErrors = [];
  narrowPage.on("pageerror", (e) => narrowErrors.push(String(e)));
  await narrowPage.goto(BASE, { waitUntil: "load" });
  await narrowPage.waitForTimeout(2500);
  await narrowPage.locator('button[title="Expand the sites panel"]').first().click().catch(() => {});
  await narrowPage.waitForTimeout(400);
  const narrowRow = narrowPage.locator('div[title*="Open site"]').filter({ hasText: "Richfield" }).first();
  const narrowRowH = await narrowRow.evaluate((el) => el.getBoundingClientRect().height).catch(() => null);
  ok("narrow/touch row height is 44px (WCAG 2.5.5 touch target), not 28px", narrowRowH !== null && Math.abs(narrowRowH - 44) < 0.5, `${narrowRowH}px`);
  await narrowPage.screenshot({ path: OUT + "sites-panel-narrow.png" });
  ok("narrow layout: no uncaught page errors", narrowErrors.length === 0, narrowErrors.slice(0, 3).join(" | "));
  await narrowCtx.close();

  // ===== Header pass (NEW-2) =====
  const hctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await hctx.addInitScript(seed);
  const hpage = await hctx.newPage();
  const hErrors = [];
  hpage.on("pageerror", (e) => hErrors.push(String(e)));
  await hpage.goto(BASE, { waitUntil: "load" });
  await hpage.waitForTimeout(2500);

  const headerData = await hpage.evaluate(() => {
    const header = document.querySelector("header");
    const rect = header.getBoundingClientRect();
    const rows = Array.from(header.children).filter((el) => el.tagName === "DIV");
    // Only elements that actually carry visible TEXT — a decorative empty <span> (e.g. the
    // wordmark/breadcrumb divider) inherits the browser's 16px default with nothing rendered at
    // that size, which isn't a typography violation and shouldn't false-positive this check.
    const textEls = Array.from(header.querySelectorAll("span, button")).filter((el) => el.textContent.trim().length > 0);
    const maxFont = Math.max(...textEls.map((el) => parseFloat(getComputedStyle(el).fontSize) || 0));
    const tabs = Array.from(header.querySelectorAll('[data-testid^="module-tab-"]'));
    return {
      totalHeight: rect.height,
      rowHeights: rows.map((r) => r.getBoundingClientRect().height),
      maxFontSize: maxFont,
      tabCount: tabs.length,
      tabRects: tabs.map((t) => t.getBoundingClientRect()),
    };
  });
  console.log("Header measurement (1440px viewport):", JSON.stringify(headerData, null, 2));
  ok("header stack total height is ~57-59px (down from a measured live baseline of 80px)", headerData.totalHeight >= 55 && headerData.totalHeight <= 60, `${headerData.totalHeight}px`);
  ok("no font in the header exceeds --font-display (14px)", headerData.maxFontSize <= 14.5, `max=${headerData.maxFontSize}px`);
  // Tab count is READ, never hardcoded to the brief's literal "five" — B884688/B891184 (the
  // Model spreadsheet workspace) merged a sixth module tab into this same row concurrently with
  // this item, on `origin/main`. The property under test is "do the tabs fit," not "are there
  // exactly five" — a hardcoded 5 would have gone stale (and falsely red) the moment that PR
  // landed, for a reason that has nothing to do with this item's own change.
  const expectTabs = headerData.tabCount;
  ok(`all ${expectTabs} module tabs render at 1440px (count read from the live DOM, not assumed)`, expectTabs >= 5, `${expectTabs} tabs`);
  await hpage.screenshot({ path: OUT + "header-1440.png" });

  // ---- (e) the tabs still fit at the narrowest supported (non-"narrow") width ----
  for (const w of [1024, 900, 768]) {
    await hpage.setViewportSize({ width: w, height: 900 });
    await hpage.waitForTimeout(200);
    const tabFit = await hpage.evaluate((expectTabs) => {
      const header = document.querySelector("header");
      const tabs = Array.from(header.querySelectorAll('[data-testid^="module-tab-"]'));
      if (tabs.length !== expectTabs) return { count: tabs.length, overlap: null, offRight: null };
      const rects = tabs.map((t) => t.getBoundingClientRect());
      let overlap = false;
      for (let i = 1; i < rects.length; i++) if (rects[i].left < rects[i - 1].right - 0.5) overlap = true;
      const headerRight = header.getBoundingClientRect().right;
      const offRight = rects.some((r) => r.right > headerRight + 0.5);
      return { count: tabs.length, overlap, offRight, lastRight: rects[rects.length - 1].right, headerRight };
    }, expectTabs);
    ok(`at ${w}px: all ${expectTabs} tabs present and not overlapping`, tabFit.count === expectTabs && tabFit.overlap === false, JSON.stringify(tabFit));
  }
  await hpage.screenshot({ path: OUT + "header-768.png" });

  ok("no uncaught page errors (header pass)", hErrors.length === 0, hErrors.slice(0, 3).join(" | "));
  await hctx.close();

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(2); });
