#!/usr/bin/env node
/* verify-comp-entry-b844400 — B844400/B844401/B844402 (owner chat block, 2026-09-03): three
 * defects measured live on planyr.io build fa427d7 at viewport 1191x521, all in the "Paste comps"
 * grid chrome (`components/CompEntryGrid.jsx`):
 *   B844400 (NEW-2) — the grid pane forced itself to a ≈5.5-row floor regardless of actual row
 *     count, leaving a slab of dead white space below a 1-3 row sheet.
 *   B844401 (NEW-3) — a bare "N comps" white strip repeated the footer's own count as its own
 *     band, clipping to a featureless white sliver on a short window.
 *   B844402 (NEW-4) — a choice cell (Type/Unit/Per/Basis) swallowed typing entirely once opened
 *     (root-caused to `.showPicker()`'s native OS popup owning every subsequent keystroke — see
 *     the fix's own header in CompEntryGrid.jsx), and the Unit cell carried no caret when fixed.
 *
 * ⛔ B1119282 (×2, owner live-CLICK measurement, 2026-09-03) — the caret half of B844402/NEW-4
 * shipped WRONG and was caught only by driving a real browser against the deployed build: the
 * fix gave Unit the same caret as Type/Per/Basis while it was still gated non-editable outside
 * land, so the caret advertised a dropdown a real click could never reach
 * (`document.querySelectorAll('table select').length === 0`). Every check in THIS file that
 * "verified" the caret only tested for the GLYPH's presence in cell text — never whether a real
 * click resolves to a live `<select>` — which is exactly how a caret-with-nothing-behind-it read
 * as fixed. The real fix (compSheetColumns.js's `optionsFor`) makes Unit a genuinely editable
 * select on every row type; the blocks below now assert on `document.activeElement` after a real
 * Playwright `.click()`, not on cell text, so this class can't recur invisibly again.
 *
 * Run against a local dev server (signed out, fixture-seeded, no network egress — mirrors
 * verify-comp-entry-p0.mjs / verify-comp-entry-defects-0902.mjs's own shape):
 *   node ui-audit/verify-comp-entry-b844400.mjs [--url http://localhost:4319/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const SHOTS = process.argv.includes("--shots");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const SHOT_DIR = "ui-audit/.artifacts/comp-entry-b844400";
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function newCtx(browser, viewport, id) {
  const fixture = readFixture("bain");
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  return ctx;
}
async function openEntrySheet(page) {
  await page.goto(`${BASE}#/site`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await pacedWait(page, 2500);
  await assertMeasurable(page, "verify-comp-entry-b844400");
  await page.getByRole("tab", { name: /^Comps/ }).first().click();
  await pacedWait(page, 400);
  await page.getByText("＋ Paste comps", { exact: true }).click();
  await pacedWait(page, 300);
}
async function pasteViaTextarea(page, text) {
  const textarea = page.locator("textarea").first();
  await textarea.click();
  await textarea.fill(text);
  await page.keyboard.press("Enter");
  await pacedWait(page, 400);
}
function landPaste(i) { return `Tract ${i}, ${i}.0 AC, $${i}00,000, closed 1/${i}/2026`; }

const browser = await chromium.launch({ executablePath: EXEC, headless: true });

console.log("=== B844400/NEW-2 — the grid pane sizes to its content, no dead space at 1/3 rows, scrolls (not overflows) at 12 ===");
{
  const ctx = await newCtx(browser, { width: 1191, height: 521 }, "b844400-1row");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteViaTextarea(page, landPaste(1));
  const g1 = await page.evaluate(() => {
    const panel = document.querySelector("[data-comp-entry-panel]");
    const scroller = panel.querySelector('[role="grid"]');
    const table = scroller.querySelector("table");
    return { scrollerH: scroller.getBoundingClientRect().height, tableH: table.getBoundingClientRect().height, panelH: panel.getBoundingClientRect().height };
  });
  const blank1 = g1.scrollerH - g1.tableH;
  console.log(`  1 row: scrollerH=${g1.scrollerH} tableH=${g1.tableH} blankBelowTable=${blank1} panelH=${g1.panelH}`);
  check("1 row — no meaningful blank slab below the table (< 4px, hairline rounding only)", blank1 < 4, `blank=${blank1}`);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/1row-1191x521.png` });

  await pasteViaTextarea(page, landPaste(2));
  await pasteViaTextarea(page, landPaste(3));
  const g3 = await page.evaluate(() => {
    const panel = document.querySelector("[data-comp-entry-panel]");
    const scroller = panel.querySelector('[role="grid"]');
    const table = scroller.querySelector("table");
    return { scrollerH: scroller.getBoundingClientRect().height, tableH: table.getBoundingClientRect().height };
  });
  const blank3 = g3.scrollerH - g3.tableH;
  console.log(`  3 rows: scrollerH=${g3.scrollerH} tableH=${g3.tableH} blankBelowTable=${blank3}`);
  check("3 rows — no meaningful blank slab below the table", blank3 < 4, `blank=${blank3}`);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/3rows-1191x521.png` });
  await ctx.close();
}
{
  const ctx = await newCtx(browser, { width: 1191, height: 521 }, "b844400-12row");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  for (let i = 1; i <= 12; i++) await pasteViaTextarea(page, landPaste(i));
  const g12 = await page.evaluate(() => {
    const panel = document.querySelector("[data-comp-entry-panel]");
    const scroller = panel.querySelector('[role="grid"]');
    return {
      scrollerH: scroller.clientHeight, scrollH: scroller.scrollHeight,
      panelH: panel.getBoundingClientRect().height,
      panelBottom: panel.getBoundingClientRect().bottom, viewportH: window.innerHeight,
    };
  });
  console.log(`  12 rows: clientH=${g12.scrollerH} scrollH=${g12.scrollH} panelH=${g12.panelH} panelBottom=${g12.panelBottom} viewportH=${g12.viewportH}`);
  check("12 rows — the grid pane SCROLLS internally rather than growing past its content (scrollH > clientH)", g12.scrollH > g12.scrollerH, `clientH=${g12.scrollerH} scrollH=${g12.scrollH}`);
  check("12 rows — the modal never grows past the viewport", g12.panelBottom <= g12.viewportH + 1, `panelBottom=${g12.panelBottom} viewportH=${g12.viewportH}`);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/12rows-1191x521.png` });
  await ctx.close();
}

console.log("\n=== B844401/NEW-3 — no separate 'N comps' white strip; the count (and any averages) live in the ONE footer line ===");
{
  const ctx = await newCtx(browser, { width: 1191, height: 521 }, "b844401");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteViaTextarea(page, landPaste(1));
  await pasteViaTextarea(page, landPaste(2));
  await pasteViaTextarea(page, landPaste(3));
  const info = await page.evaluate(() => {
    const panel = document.querySelector("[data-comp-entry-panel]");
    const kids = [...panel.children];
    const strip = kids.find((c) => {
      const t = (c.textContent || "").trim();
      return /^\d+ comps?$/.test(t) || (getComputedStyle(c).backgroundColor === "rgb(255, 255, 255)" && /comps?/i.test(t) && !/ready|missing|need/i.test(t));
    });
    const footer = kids[kids.length - 1];
    return { stripFound: !!strip, stripText: strip ? strip.textContent : null, footerText: footer.textContent || "" };
  });
  console.log(`  panel children scan: stripFound=${info.stripFound} footerText="${info.footerText}"`);
  check("no standalone 'N comps' white-strip band survives between the grid and the footer", !info.stripFound, JSON.stringify(info));
  check("the footer's ONE status line carries the count", /^\d+ comps?/.test(info.footerText), info.footerText);
  check("the footer's ONE status line carries the ready/issue summary too (same line, not a second one)", /ready/.test(info.footerText), info.footerText);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/no-strip-1191x521.png` });
  await ctx.close();
}

console.log("\n=== B844402/NEW-4a — click a choice cell, then type: it jumps to the matching option (not swallowed) ===");
async function clickThenType(page, colIdx, key) {
  const cell = page.locator(`td[data-cell="0-${colIdx}"]`);
  await cell.click();
  await pacedWait(page, 200);
  await page.keyboard.press(key);
  await pacedWait(page, 250);
  return (await cell.innerText()).trim();
}
{
  // Column indices per SHEET_COLUMNS order in compSheetColumns.js: Type=0, Unit=4, Per=12, Basis=13.
  const ctx = await newCtx(browser, { width: 1600, height: 900 }, "b844402-land");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteViaTextarea(page, "West Hardy tract, 3.2 AC, $850,000, closed 3/14/2026");
  const typeAfter = await clickThenType(page, 0, "b"); // Land -> Bldg sale
  check("Type: click then type 'b' jumps to 'Bldg sale', not swallowed", /Bldg sale/.test(typeAfter), typeAfter);
  await ctx.close();
}
{
  const ctx = await newCtx(browser, { width: 1600, height: 900 }, "b844402-land2");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteViaTextarea(page, "West Hardy tract, 3.2 AC, $850,000, closed 3/14/2026");
  const unitAfter = await clickThenType(page, 4, "s"); // AC (default) -> SF, a real choice on a LAND row
  check("Unit (land row): click then type 's' jumps to 'SF', not swallowed", /SF/.test(unitAfter), unitAfter);
  await ctx.close();
}
{
  const ctx = await newCtx(browser, { width: 1600, height: 900 }, "b844402-lease");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteViaTextarea(page, "Sugarbun Way industrial, 25,000 SF lease, $6.50/SF/yr NNN, 5 yr term, executed 1/15/2026");
  const basisAfter = await clickThenType(page, 13, "g"); // NNN (default) -> GROSS
  check("Basis (lease row): click then type 'g' jumps to 'GROSS', not swallowed", /GROSS/.test(basisAfter), basisAfter);
  await ctx.close();
}

console.log("\n=== B1119282 (×2) — Unit is a REAL <select> on every row type, not just a caret over an unreachable choice ===");
// B1119282 (×2, owner live-click measurement, 2026-09-03) — the FIRST fix here (B844402/NEW-4)
// gave Unit the same CARET as Type/Per/Basis but left it `editableFor`-gated to land only, so on
// every other row type the caret advertised a dropdown that a real click could not reach at all
// (`document.querySelectorAll('table select').length === 0`). Caught by the owner clicking the
// real, deployed build — not by any check in THIS file, because every earlier check here (like
// the synthetic-click sweep this block replaces) tested for the caret's mere presence, never
// whether a real click actually resolves to a live SELECT. That is the gap this block closes:
// every assertion here drives a REAL Playwright `.click()` (routed through actual CDP input, not
// `element.dispatchEvent(...)`) and reads `document.activeElement`, never just cell text content.
async function sweepRestingRow(page) {
  return page.evaluate(() => {
    const t = [...document.querySelectorAll("table")].find((x) => x.offsetParent);
    const keys = [...[...t.querySelectorAll("thead tr")].pop().cells].map((h) => h.innerText.trim());
    const row = t.querySelector("tbody tr");
    return [...row.cells].map((c, i) => ({ col: keys[i], caret: /[▾▼⌄˅⋁]/.test(c.textContent || "") }));
  });
}
{
  const ctx = await newCtx(browser, { width: 1600, height: 900 }, "b1119282-real-select-lease");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteViaTextarea(page, "Sugarbun Way industrial, 25,000 SF lease, $6.50/SF/yr NNN, 5 yr term, executed 1/15/2026");
  const sweep = await sweepRestingRow(page);
  for (const name of ["Type", "Unit", "Per", "Basis"]) {
    const row = sweep.find((r) => r.col === name);
    check(`${name} shows the caret at rest (lease row)`, !!row?.caret, JSON.stringify(row));
  }
  // The real-click check the earlier round skipped: every one of the four caret-bearing cells
  // must resolve to an actual, focused <select> with the RIGHT option set for this row's type —
  // Unit's own set is SF-only here, the one value a lease's `lease_size_sf` column accepts.
  const EXPECTED = { Type: ["", "Land", "Bldg sale", "Lease"], Unit: ["", "SF"], Per: ["", "MO", "YR"], Basis: ["", "NNN", "GROSS"] };
  const COLIDX = { Type: 0, Unit: 4, Per: 12, Basis: 13 };
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const cell = page.locator(`td[data-cell="0-${COLIDX[name]}"]`);
    await cell.click();
    await pacedWait(page, 200);
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      return { tag: el?.tagName, options: el?.tagName === "SELECT" ? [...el.options].map((o) => o.textContent.trim()) : null };
    });
    check(`${name}: a REAL click focuses an actual SELECT (lease row)`, info.tag === "SELECT", JSON.stringify(info));
    check(`${name}: its options are exactly ${JSON.stringify(expected)} (lease row)`, JSON.stringify(info.options) === JSON.stringify(expected), JSON.stringify(info));
    await page.keyboard.press("Escape");
    await pacedWait(page, 150);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/carets-lease.png` });
  await ctx.close();
}
{
  // Type-ahead on the SF-only Unit select must still work (jumps to, and stays on, its one
  // option) — proves the select is genuinely live, not a static caret with a select painted over it.
  const ctx = await newCtx(browser, { width: 1600, height: 900 }, "b1119282-unit-typeahead-lease");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteViaTextarea(page, "Sugarbun Way industrial, 25,000 SF lease, $6.50/SF/yr NNN, 5 yr term, executed 1/15/2026");
  const cell = page.locator('td[data-cell="0-4"]');
  await cell.click();
  await pacedWait(page, 150);
  await page.keyboard.press("Escape");
  await pacedWait(page, 150);
  await page.keyboard.press("s");
  await pacedWait(page, 200);
  const r = await page.evaluate(() => ({ tag: document.activeElement?.tagName, value: document.activeElement?.value }));
  check("Unit (lease): select-then-type 's' opens a real SELECT already at value sf", r.tag === "SELECT" && r.value === "sf", JSON.stringify(r));
  await ctx.close();
}
{
  const ctx = await newCtx(browser, { width: 1600, height: 900 }, "b844402-caret-land");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteViaTextarea(page, "West Hardy tract, 3.2 AC, $850,000, closed 3/14/2026");
  const sweep = await sweepRestingRow(page);
  const unitRow = sweep.find((r) => r.col === "Unit");
  check("Unit shows the caret at rest on a LAND row too (a genuine choice there)", !!unitRow?.caret, JSON.stringify(unitRow));
  const cell = page.locator('td[data-cell="0-4"]');
  await cell.click();
  await pacedWait(page, 200);
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName, options: el?.tagName === "SELECT" ? [...el.options].map((o) => o.textContent.trim()) : null };
  });
  check("Unit (land): a REAL click focuses an actual SELECT", info.tag === "SELECT", JSON.stringify(info));
  check("Unit (land): its options are exactly ['', 'AC', 'SF']", JSON.stringify(info.options) === JSON.stringify(["", "AC", "SF"]), JSON.stringify(info));
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/carets-land.png` });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name).join("; ")); process.exit(1); }
