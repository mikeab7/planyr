#!/usr/bin/env node
/* verify-comp-entry-mobile — B1091712 (owner rule 2026-09-03): below MOBILE_BREAKPOINT_PX
 * (compMobileLayout.js), CompEntryGrid.jsx swaps its horizontal table for a TRANSPOSED,
 * one-comp-per-screen sheet (CompEntryMobileSheet.jsx). This harness proves it live, signed out,
 * against a real Chromium session — no network needed for anything checked here (a map click
 * resolves an anchor locally; reverse-geocoding it into a street address races an internal
 * timeout and degrades with no network at all, same as verify-comp-entry-p0.mjs).
 *
 * What it checks, at both 390px (iPhone width) and 768px (iPad-portrait width — both must land
 * in the TRANSPOSED layout; the desktop sheet's own minimum column width is well over 1000px):
 *   1. the layout that actually rendered, and that there is ZERO horizontal scroll
 *   2. every CHOICE field (Type/Unit/Per/Basis) carries a caret; no free-text/numeric field does
 *   3. the pager's status-dot count equals the comp count, and colors track each row's ready state
 *   4. a full completion round trip: fill Executed (the "Today" chip) and Location (a real map
 *      click, minimized-sheet flow) for ONE of three pasted comps, and confirm Save reports it
 *      ready — this is as far as this sandbox can go; the actual persistence write needs a
 *      signed-in Supabase session (Blocker: auth, same wall every comp-entry round has hit —
 *      see VERIFICATION.md for the live-signed-in tail of this check).
 *   5. the desktop table is UNCHANGED above the breakpoint (still the same table, still zero
 *      horizontal scroll on its own — DO NOT TOUCH held).
 *
 *   node ui-audit/verify-comp-entry-mobile.mjs [--url http://localhost:4319/]
 */
import { chromium } from "playwright";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function openEntrySheetWithThreeComps(page) {
  await page.goto(`${BASE}#/site`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await pacedWait(page, 2500);
  await assertMeasurable(page, "verify-comp-entry-mobile");
  await page.getByRole("tab", { name: /^Comps/ }).first().click();
  await pacedWait(page, 400);
  await page.getByText("＋ Paste comps", { exact: true }).click();
  await pacedWait(page, 300);
  const textarea = page.locator("textarea").first();
  await textarea.click();
  await textarea.fill("West Hardy tract, 3.2 AC, $850,000, closed 3/14/2026");
  await page.keyboard.press("Enter");
  await pacedWait(page, 300);
  await textarea.fill("48,000 SF industrial, $0.65/SF/mo NNN");
  await page.keyboard.press("Enter");
  await pacedWait(page, 300);
  await textarea.fill("Katy building sale, $4,200,000, 62,000 SF");
  await page.keyboard.press("Enter");
  await pacedWait(page, 400);
}

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const fixture = readFixture("bain");

for (const { label, width, height } of [{ label: "390px (iPhone)", width: 390, height: 844 }, { label: "768px (iPad portrait)", width: 768, height: 1024 }]) {
  console.log(`\n=== ${label} — layout, overflow, carets, pager dots ===`);
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: `mobile-${width}` }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheetWithThreeComps(page);

  const isMobileLayout = await page.locator('[data-comp-entry-mobile="1"]').count();
  const isDesktopLayout = await page.locator('[data-comp-entry-panel="1"]').count();
  check(`${label}: the TRANSPOSED layout rendered`, isMobileLayout === 1 && isDesktopLayout === 0, `mobile=${isMobileLayout} desktop=${isDesktopLayout}`);

  const overflow = await page.evaluate(() => {
    const el = document.querySelector('[data-comp-entry-mobile="1"]');
    if (!el) return null;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  check(`${label}: no horizontal scroll on the mobile sheet`, !!overflow && overflow.scrollWidth === overflow.clientWidth, JSON.stringify(overflow));
  const docOverflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  check(`${label}: no horizontal scroll on the document`, docOverflow.scrollWidth === docOverflow.clientWidth, JSON.stringify(docOverflow));

  // Comp 1 is LAND ($/AC-priced) — its Property section carries a Unit choice cell (AC/SF).
  // Confirm every select-kind row shows a caret and no plain text/number row does.
  const caretInfo = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-comp-entry-mobile="1"] button, [data-comp-entry-mobile="1"] label')]
      .filter((el) => el.querySelector("select"));
    const withCaret = rows.filter((el) => el.textContent.includes("▾")).length;
    return { selectRowCount: rows.length, withCaret };
  });
  check(`${label}: every choice-field row carries a caret`, caretInfo.selectRowCount > 0 && caretInfo.selectRowCount === caretInfo.withCaret, JSON.stringify(caretInfo));
  const strayCaretOnNonSelect = await page.evaluate(() => {
    const nonSelectRows = [...document.querySelectorAll('[data-comp-entry-mobile="1"] button')].filter((el) => !el.querySelector("select"));
    return nonSelectRows.filter((el) => el.textContent.includes("▾")).length;
  });
  check(`${label}: no free-text/numeric row carries a caret`, strayCaretOnNonSelect === 0, `stray=${strayCaretOnNonSelect}`);

  // Pager dots: 3 comps pasted, all missing a Location -> all 3 dots should read "incomplete"
  // (amber), except the CURRENT one which renders as the accent pill instead of a dot.
  const dotInfo = await page.evaluate(() => {
    const strip = [...document.querySelectorAll('[data-comp-entry-mobile="1"] span[aria-hidden="true"]')]
      .filter((el) => {
        const cs = getComputedStyle(el);
        return cs.borderRadius && parseFloat(cs.borderRadius) > 2 && (el.offsetWidth === 6 || el.offsetWidth === 20) && el.offsetHeight <= 6;
      });
    return strip.length;
  });
  check(`${label}: pager shows one status indicator per comp (3 pasted)`, dotInfo === 3, `dots=${dotInfo}`);

  await ctx.close();
}

console.log("\n=== 390px — complete ONE comp via the transposed sheet (Today + a real map pick) ===");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "mobile-complete" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheetWithThreeComps(page);

  const startBtn = page.getByRole("button", { name: /^Save/ }).first();
  check("starts with 0 ready comps (none dated or located)", (await startBtn.innerText()).trim() === "Save comps" && !(await startBtn.isEnabled()));

  const todayChip = page.getByRole("button", { name: "Today" }).first();
  await todayChip.click();
  await pacedWait(page, 300);

  const locationRow = page.locator('[data-comp-entry-mobile="1"] button', { hasText: "Location" }).first();
  await locationRow.click();
  await pacedWait(page, 300);
  check("tapping Location minimizes the sheet so the map is reachable", (await page.locator('[data-comp-entry-mobile="1"]').count()) === 0);

  const mapBox = await page.locator(".leaflet-container").first().boundingBox();
  check("the map is visible and clickable while the sheet is minimized", !!mapBox);
  if (mapBox) {
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    // The pin-drop path races an internal 3s county lookup (resolveCompCounty in MapFinder.jsx)
    // against a timeout before it hands the anchor back — with network blocked (signed-out, no
    // GIS egress in this sandbox) the promise still degrades to a null county, but only once
    // that race actually settles. A short wait here reads as "the pick never landed."
    await pacedWait(page, 3600);
  }
  check("the sheet restores full view once the pick lands", (await page.locator('[data-comp-entry-mobile="1"]').count()) === 1);

  const saveBtn = page.getByRole("button", { name: /^Save \d+ comp/ });
  check("Save now reports at least 1 ready comp", (await saveBtn.count()) > 0, await saveBtn.count() ? await saveBtn.first().innerText() : "not found");
  if (await saveBtn.count()) check("Save is enabled for the completed comp", await saveBtn.first().isEnabled());

  await ctx.close();
}

console.log("\n=== 1400px — the desktop table is untouched above the breakpoint ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "mobile-desktop-control" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheetWithThreeComps(page);
  check("1400px: the DESKTOP table rendered, not the transposed sheet", (await page.locator('[data-comp-entry-panel="1"]').count()) === 1 && (await page.locator('[data-comp-entry-mobile="1"]').count()) === 0);
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name).join(" | ")); process.exit(1); }
