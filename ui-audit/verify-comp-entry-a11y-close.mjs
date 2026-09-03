#!/usr/bin/env node
/* verify-comp-entry-a11y-close — NEW-6/NEW-7/NEW-8 (adversarial review round 2, 2026-09-03), the
 * second half of the comps-module review, measured live on planyr.io build fa427d7 in the Paste
 * comps modal with 123 pasted rows. Three defects, all fixed here, re-proven against a real
 * Chromium session so a future regression on any of them goes red here instead of waiting for the
 * next live pass.
 *
 * NEW-6 — the sheet's roving tabindex was broken: 2582 cells at tabindex="-1", 247 with NO
 * tabindex attribute at all (the per-row Location "Set" button and the delete ✕, unconditionally
 * in the native tab order), and ZERO cells at tabindex="0" — no keyboard entry point into the
 * sheet at all, Tab from the paste textarea skipped the grid body entirely. Root cause: the grid's
 * own `<div role="grid">` wrapper carried `tabIndex={0}`, a SECOND tab stop sitting in front of
 * the active cell's own roving tabIndex, landing Tab on a bare non-cell wrapper before ever
 * reaching a data cell — and once selection DID land on the Location column (an "action" cell),
 * its <td> carries no tabIndex of its own (only its inner <button> does), so the td-level census
 * read zero. Fixed: the wrapper is `tabIndex={-1}` now (still `.focus()`-able programmatically,
 * still receives every bubbled keydown — nothing else changes), every non-active cell (including
 * the action/remove <td>s) carries an explicit `tabIndex={-1}` rather than no attribute, the
 * delete ✕ button itself is `tabIndex={-1}` (reachable instead via Shift+Delete on the selected
 * row), and Tab/Shift+Tab now escape the grid at its own edges (forward from the last row's last
 * column, backward from the first row's first column) instead of wrapping forever. The ARIA
 * contract is finished too: `scope="col"`/`scope="colgroup"` on the header cells, an accessible
 * name + aria-rowcount/aria-colcount on the grid, aria-selected on the active cell.
 *
 * NEW-7 — the Save button's label was `Save ${n || ""} comp...`.trim() — a template that produces
 * a literal DOUBLE SPACE ("Save  comps") whenever `n` is 0, because `.trim()` only strips
 * leading/trailing whitespace, never a gap in the middle. A freshly pasted row is never "ready"
 * until its Location is picked, so `n` reads 0 far more often than not — reproduced at both 3 and
 * 123 rows. Fixed via `compSheetColumns.js`'s new `saveButtonLabel(readyCount)`, shared by the
 * desktop sheet and the mobile one: "Save comps" (no count) at 0, "Save N comp(s)" otherwise.
 *
 * NEW-8 — Close (the header ✕ and the footer button, both routed through one `onCancel`) silently
 * discarded every unsaved row with no prompt — measured live, 123 pasted rows, none saved, one
 * click, all 123 gone. Fixed: both paths now route through `requestClose`, which arms an inline
 * "Discard N unsaved comps?" confirmation (Discard / Keep editing — no window.confirm, this app
 * bans dialog boxes app-wide) whenever the sheet holds rows, and stays instant/silent when it's
 * empty. Same fix on the mobile sheet's own header ✕/footer Close.
 *
 *   node ui-audit/verify-comp-entry-a11y-close.mjs [--url http://localhost:4319/]
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

async function openEntrySheet(page) {
  await page.goto(`${BASE}#/site`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await pacedWait(page, 2500);
  await assertMeasurable(page, "verify-comp-entry-a11y-close");
  await page.getByRole("tab", { name: /^Comps/ }).first().click();
  await pacedWait(page, 400);
  await page.getByText("＋ Paste comps", { exact: true }).click();
  await pacedWait(page, 300);
}
async function pasteBlock(page, text) {
  await page.locator("textarea").first().click();
  await page.evaluate((t) => {
    const ta = document.querySelector("textarea");
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  await pacedWait(page, 500);
}
async function pasteOneLine(page, text) {
  const textarea = page.locator("textarea").first();
  await textarea.click();
  await textarea.fill(text);
  await page.keyboard.press("Enter");
  await pacedWait(page, 400);
}
async function rowCount(page) {
  return page.evaluate(() => new Set([...document.querySelectorAll("td[data-cell]")].map((c) => c.dataset.cell.split("-")[0])).size);
}

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const fixture = readFixture("bain");

console.log("=== NEW-6 — roving tabindex: exactly one cell at 0, everything else -1, Tab reaches a cell ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "a11y6a" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteBlock(page, [
    "West Hardy tract\tLand\t3.2\tAC\t3/14/2026\t\t\t850000",
    "Second tract\tLand\t5.0\tAC\t3/15/2026\t\t\t900000",
    "Third tract\tLand\t2.0\tAC\t3/16/2026\t\t\t400000",
  ].join("\n"));
  check("3 rows on the sheet", (await rowCount(page)) === 3);

  const census = await page.evaluate(() => {
    const tds = [...document.querySelectorAll("tbody td")];
    let zero = 0, negOne = 0, none = 0;
    tds.forEach((td) => {
      const t = td.getAttribute("tabindex");
      if (t === "0") zero++; else if (t === "-1") negOne++; else none++;
    });
    return { total: tds.length, zero, negOne, none };
  });
  check("exactly ONE cell carries tabindex=0", census.zero === 1, JSON.stringify(census));
  check("every OTHER cell carries an explicit -1 (never no attribute)", census.none === 0 && census.negOne === census.total - 1, JSON.stringify(census));

  // Tab from the paste textarea must reach INSIDE the grid (a data cell), not stall on a bare,
  // non-cell wrapper — search a few stops since legitimate paste-summary links (Undo/Show pasted
  // text) come first.
  await page.locator("textarea").first().focus();
  let reachedCell = false;
  for (let i = 0; i < 6 && !reachedCell; i++) {
    await page.keyboard.press("Tab");
    await pacedWait(page, 80);
    reachedCell = await page.evaluate(() => !!document.activeElement.dataset?.cell || document.activeElement.closest("td[data-cell]") != null);
  }
  check("Tab from the paste textarea reaches a real data cell", reachedCell);

  // The roving tabindex=0 target: a plain cell's own <td>, or — for an action cell like
  // Location, whose <td> is unconditionally -1 by design (NEW-6) — its inner <button>. Either
  // way there must be exactly ONE such target in the whole grid at any moment.
  const rovingTarget = () => page.evaluate(() => {
    const tds = [...document.querySelectorAll("tbody td[data-cell]")];
    const zeroTds = tds.filter((td) => td.getAttribute("tabindex") === "0");
    const zeroButtons = tds.filter((td) => td.getAttribute("tabindex") === "-1" && td.querySelector('button[tabindex="0"]'));
    return { count: zeroTds.length + zeroButtons.length, cell: (zeroTds[0] || zeroButtons[0])?.dataset?.cell };
  });
  const before = await rovingTarget();
  await page.keyboard.press("ArrowRight");
  await pacedWait(page, 150);
  const after = await rovingTarget();
  check("tabindex=0 still exactly ONE roving target after ArrowRight, and it MOVED", after.count === 1 && after.cell !== before.cell, JSON.stringify({ before, after }));
  await ctx.close();
}

console.log("\n=== NEW-6 — the ARIA grid contract is finished ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "a11y6b" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteBlock(page, ["West Hardy tract\tLand\t3.2\tAC\t3/14/2026\t\t\t850000", "Second tract\tLand\t5.0\tAC\t3/15/2026\t\t\t900000"].join("\n"));

  const info = await page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]');
    const ths = [...document.querySelectorAll("thead tr")];
    return {
      ariaLabel: grid.getAttribute("aria-label"),
      ariaRowcount: grid.getAttribute("aria-rowcount"),
      ariaColcount: grid.getAttribute("aria-colcount"),
      groupScopes: [...ths[0].querySelectorAll("th")].map((th) => th.getAttribute("scope")),
      colScopes: [...ths[1].querySelectorAll("th")].map((th) => th.getAttribute("scope")),
      selectedAriaSelected: document.querySelector('td[data-cell="0-0"]')?.getAttribute("aria-selected"),
      otherAriaSelected: document.querySelector('td[data-cell="0-2"]')?.getAttribute("aria-selected"),
    };
  });
  check("grid has an accessible name", !!info.ariaLabel, info.ariaLabel);
  check("aria-rowcount / aria-colcount present", info.ariaRowcount != null && info.ariaColcount != null, `${info.ariaRowcount}/${info.ariaColcount}`);
  check("every header th declares a scope (col or colgroup)", info.groupScopes.every((s) => s === "colgroup" || s === "col") && info.colScopes.every((s) => s === "col"), JSON.stringify({ group: info.groupScopes, col: info.colScopes }));
  check("the active cell carries aria-selected=true, others false", info.selectedAriaSelected === "true" && info.otherAriaSelected === "false", JSON.stringify(info));
  await ctx.close();
}

console.log("\n=== NEW-6 — Tab escapes the grid at its own edge instead of wrapping forever ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "a11y6c" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteBlock(page, ["West Hardy tract\tLand\t3.2\tAC\t3/14/2026\t\t\t850000", "Second tract\tLand\t5.0\tAC\t3/15/2026\t\t\t900000"].join("\n"));

  // Click the LAST cell of the LAST row (this auto-opens editing, per HARDENING-10) and Tab.
  const lastCell = page.locator('td[data-cell^="1-"]').last();
  await lastCell.click();
  await pacedWait(page, 200);
  await page.keyboard.press("Tab");
  await pacedWait(page, 200);
  const afterForward = await page.evaluate(() => ({ tag: document.activeElement.tagName, dataCell: document.activeElement.closest("td")?.dataset?.cell }));
  check("Tab on the LAST cell of the LAST row does not reopen an editor on a wrapped cell", afterForward.tag === "TD", JSON.stringify(afterForward));

  // Backward: dispatch a real, bubbling Shift+Tab directly on the active <select> (avoids
  // headless Chromium's native OS-picker popup swallowing the synthetic keypress, per
  // showPicker()'s own note in beginEdit's layout effect).
  const firstCell = page.locator('td[data-cell="0-0"]').first();
  await firstCell.click();
  await pacedWait(page, 200);
  const backward = await page.evaluate(() => {
    const el = document.activeElement;
    if (el.tagName !== "SELECT") return { dispatched: false, tag: el.tagName };
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    return { dispatched: true };
  });
  await pacedWait(page, 300);
  const afterBackward = await page.evaluate(() => ({ tag: document.activeElement.tagName, dataCell: document.activeElement.closest("td")?.dataset?.cell }));
  check("Shift+Tab on the FIRST cell of the FIRST row does not reopen an editor on a wrapped cell", backward.dispatched && afterBackward.tag === "TD", JSON.stringify({ backward, afterBackward }));
  await ctx.close();
}

console.log("\n=== NEW-6 — the delete ✕ is out of the tab order; Shift+Delete removes the selected row (undo-covered) ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "a11y6d" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteBlock(page, ["West Hardy tract\tLand\t3.2\tAC\t3/14/2026\t\t\t850000", "Second tract\tLand\t5.0\tAC\t3/15/2026\t\t\t900000"].join("\n"));

  const removeTabIndex = await page.evaluate(() => document.querySelector('button[aria-label="Remove comp"]')?.getAttribute("tabindex"));
  check("the remove ✕ button carries tabindex=-1 (never a native tab stop)", removeTabIndex === "-1", removeTabIndex);

  // Selects the Title cell (0-2, a plain text input) rather than Type (0-0, a select) — a
  // native OS picker popup opened via `.showPicker()` on an open <select> swallows the
  // subsequent Escape/keyboard input in headless Chromium (a test-methodology quirk, not an app
  // defect — verified by dispatching the same key directly on the element in the boundary-Tab
  // check above), so a plain text cell keeps this check clean of that artifact.
  await page.locator('td[data-cell="0-2"]').first().click();
  await pacedWait(page, 200);
  await page.keyboard.press("Escape"); // close the auto-opened text editor without committing anything
  await pacedWait(page, 150);
  const before = await rowCount(page);
  await page.keyboard.press("Shift+Delete");
  await pacedWait(page, 300);
  const afterDelete = await rowCount(page);
  check("Shift+Delete on the selected row removes it", before === 2 && afterDelete === 1, `${before} -> ${afterDelete}`);
  await page.keyboard.press("Control+z");
  await pacedWait(page, 300);
  const afterUndo = await rowCount(page);
  check("Ctrl/Cmd+Z restores the row (same undo stack as the mouse-click delete)", afterUndo === 2, `${afterUndo}`);
  await ctx.close();
}

console.log("\n=== NEW-7 — Save button label never shows a double space, and states the real count ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "a11y7" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  const saveLabel = async () => (await page.locator("button", { hasText: /^Save/ }).textContent()).trim();

  check("0 rows: 'Save comps', no double space", !/\s{2,}/.test(await saveLabel()) && (await saveLabel()) === "Save comps", await saveLabel());
  await pasteBlock(page, [
    "West Hardy tract\tLand\t3.2\tAC\t3/14/2026\t\t\t850000",
    "Second tract\tLand\t5.0\tAC\t3/15/2026\t\t\t900000",
    "Third tract\tLand\t2.0\tAC\t3/16/2026\t\t\t400000",
  ].join("\n"));
  const label3 = await saveLabel();
  check("3 rows, none ready (Location unpicked): 'Save comps', no double space", !/\s{2,}/.test(label3) && label3 === "Save comps", label3);
  await ctx.close();
}

console.log("\n=== NEW-8 — Close arms a discard confirmation when the sheet holds unsaved rows ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "a11y8a" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteOneLine(page, "West Hardy tract, 3.2 AC, $850,000, closed 3/14/2026");
  check("1 row on the sheet", (await rowCount(page)) === 1);

  await page.getByLabel("Close", { exact: true }).click();
  await pacedWait(page, 200);
  const promptText = await page.evaluate(() => document.body.innerText);
  check("header ✕ arms the confirmation, naming the count", /Discard 1 unsaved comp\?/.test(promptText), promptText.match(/Discard[^\n]*/)?.[0]);
  await page.getByRole("button", { name: "Keep editing" }).click();
  await pacedWait(page, 200);
  check("Keep editing leaves the row intact and the sheet open", (await rowCount(page)) === 1 && (await page.locator("[data-comp-entry-panel]").count()) === 1);

  await pasteOneLine(page, "Second tract, 5.0 AC, $900,000, closed 3/15/2026");
  check("2 rows on the sheet", (await rowCount(page)) === 2);
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await pacedWait(page, 200);
  const promptText2 = await page.evaluate(() => document.body.innerText);
  check("footer Close arms the SAME confirmation, naming the updated count", /Discard 2 unsaved comps\?/.test(promptText2), promptText2.match(/Discard[^\n]*/)?.[0]);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await pacedWait(page, 300);
  check("Discard actually closes the panel", (await page.locator("[data-comp-entry-panel]").count()) === 0);
  await ctx.close();
}

console.log("\n=== NEW-8 — Close on an EMPTY sheet stays instant and silent ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "a11y8b" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  check("0 rows on the sheet", (await rowCount(page)) === 0);
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await pacedWait(page, 200);
  check("panel closed instantly, no prompt anywhere", (await page.locator("[data-comp-entry-panel]").count()) === 0 && !/Discard/.test(await page.evaluate(() => document.body.innerText)));
  await ctx.close();
}

console.log("\n=== NEW-8 — same discard confirmation on the MOBILE sheet ===");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "a11y8c" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteOneLine(page, "West Hardy tract, 3.2 AC, $850,000, closed 3/14/2026");
  check("mobile sheet mounted", (await page.evaluate(() => !!document.querySelector('[data-comp-entry-mobile="1"]'))));
  await page.getByLabel("Close", { exact: true }).click();
  await pacedWait(page, 200);
  const promptText = await page.evaluate(() => document.body.innerText);
  check("mobile Close arms the discard confirmation", /Discard 1 unsaved comp\?/.test(promptText), promptText.match(/Discard[^\n]*/)?.[0]);
  await page.getByRole("button", { name: "Discard" }).click();
  await pacedWait(page, 300);
  check("mobile sheet closed after Discard", (await page.evaluate(() => !document.querySelector('[data-comp-entry-mobile="1"]'))));
  await ctx.close();
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed.`);
await browser.close();
if (results.some((r) => !r.ok)) process.exit(1);
