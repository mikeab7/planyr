#!/usr/bin/env node
/* verify-comp-entry-type-to-edit — B1113714 (NEW-1): type-to-edit doubled the first character
 * typed into a comp-sheet cell that was SELECTED but not yet editing (reached via click+Escape,
 * or via arrow-key navigation from a neighbour — document.activeElement is the <td>,
 * cell.querySelector('input') is null).
 *
 * ROOT CAUSE (confirmed by source read, `CompEntryGrid.jsx`'s `onGridKeyDown`): every OTHER
 * branch of that handler (Tab, Enter, arrows, Delete/Backspace, F2, Ctrl+Z/D) calls
 * `e.preventDefault()` before acting. The printable-character ("type-to-edit") branch didn't.
 * `beginEdit()` seeds React state with `e.key` and focuses the freshly-mounted `<input>`
 * synchronously (the `editing` useLayoutEffect runs `.focus()` before this native keydown's
 * default action fires) — so with the default action left unprevented, the browser's own
 * character-insertion then lands the SAME keystroke a second time into the now-focused input,
 * doubling it. Fix: `e.preventDefault()` added to that branch, matching every sibling branch.
 *
 * This is a SANDBOX-DOABLE check (ATTEMPT-BEFORE-YOU-PARK): signed out, no external GIS, no
 * real-project data — a fixture-seeded local plan is sufficient, same as verify-comp-entry-p0.
 *
 * Root cause is in the ONE shared keydown handler, not per-column code (SheetCell's generic
 * <input> branch is identical for every `kind` except "select" and the "compDate" extra Tdy
 * button, which uses the same value/onChange/onKeyDown/onBlur wiring) — so this checks a
 * representative cell of each affected kind (text, number, date, notes) rather than every column.
 *
 * TEETH-PROVEN: pass --mutate to re-comment-out the `e.preventDefault()` fix, run, confirm the
 * targeted checks go red, then restore it automatically. (The repo's standing convention for a
 * guard nobody has seen fail.)
 *
 *   node ui-audit/verify-comp-entry-type-to-edit.mjs [--url http://localhost:4319/] [--mutate]
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MUTATE = process.argv.includes("--mutate");

let results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src", "shared", "comps", "components", "CompEntryGrid.jsx");
const MARKER = "beginEdit(selection.row, selection.col, e.key, false);";
const GUARD_LINE = "      e.preventDefault();\n      " + MARKER;

function setFixArmed(armed) {
  const text = readFileSync(SRC, "utf8");
  const armedText = text.includes(GUARD_LINE) ? text : text.replace(MARKER, GUARD_LINE.trim());
  const disarmedText = text.replace(/e\.preventDefault\(\);\n(\s*)beginEdit\(selection\.row, selection\.col, e\.key, false\);/, "$1beginEdit(selection.row, selection.col, e.key, false);");
  const next = armed ? armedText : disarmedText;
  if (next !== text) writeFileSync(SRC, next);
}

async function openEntrySheet(page) {
  await page.goto(`${BASE}#/site`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await pacedWait(page, 2500);
  await assertMeasurable(page, "verify-comp-entry-type-to-edit");
  await page.getByRole("tab", { name: /^Comps/ }).first().click();
  await pacedWait(page, 400);
  await page.getByText("＋ Paste comps", { exact: true }).click();
  await pacedWait(page, 300);
  const textarea = page.locator("textarea").first();
  await textarea.click();
  await textarea.fill("West Hardy tract, 3.2 AC, $850,000, closed 3/14/2026");
  await page.keyboard.press("Enter");
  await pacedWait(page, 400);
}

/** Select a cell via click, then Escape back out of edit mode — repro path (a): document.activeElement
 * is the <td>, no <input> mounted. */
async function selectWithoutEditing(page, dataCell) {
  await page.locator(`td[data-cell="${dataCell}"]`).click();
  await pacedWait(page, 150);
  await page.keyboard.press("Escape");
  await pacedWait(page, 150);
  const state = await page.evaluate((sel) => {
    const el = document.activeElement;
    return { tag: el.tagName, dataCell: el.dataset?.cell };
  }, dataCell);
  return state.tag === "TD" && state.dataCell === dataCell;
}

async function readCellState(page, dataCell) {
  return page.evaluate((sel) => {
    const td = document.querySelector(`td[data-cell="${sel}"]`);
    const input = td?.querySelector("input");
    return {
      textContent: td?.textContent ?? null,
      inputMounted: !!input,
      inputValue: input ? input.value : null,
      selectionStart: input ? input.selectionStart : null,
    };
  }, dataCell);
}

async function run() {
  results = []; // fresh per pass — the mutation-proof harness calls run() twice and each pass's
  // tally must stand on its own, never accumulate into the other's.
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const fixture = readFixture("bain");
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "typetoedit01" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  // Column layout (B986096-HARDENING-27): 0=Type, 1=Location, 2=Title, 3=Size, ... Executed and
  // Notes located by header text so this survives a future column reorder.
  const headerCells = await page.locator("th").allTextContents();
  const colIdx = (label) => headerCells.findIndex((t) => t.trim() === label);
  const execCol = colIdx("Executed");
  const findColByX = async (targetColIdx) => {
    const hb = await page.locator("th").nth(targetColIdx).boundingBox();
    const rowTds = page.locator('td[data-cell^="0-"]');
    const n = await rowTds.count();
    for (let i = 0; i < n; i++) {
      const b = await rowTds.nth(i).boundingBox();
      if (b && hb && Math.abs(b.x - hb.x) < 3) return await rowTds.nth(i).getAttribute("data-cell");
    }
    return null;
  };
  const execCellSel = execCol >= 0 ? await findColByX(execCol) : null;
  check("located the Executed (date) cell", !!execCellSel, execCellSel);

  console.log("\n=== CASE 1 — select-then-type on Size (number), single char: no double ===");
  {
    const ok = await selectWithoutEditing(page, "0-3");
    check("Size cell reached selected-not-editing state (TD focused, no input)", ok);
    await page.keyboard.press("7");
    await pacedWait(page, 150);
    const st = await readCellState(page, "0-3");
    check("editor mounted after one keystroke", st.inputMounted, JSON.stringify(st));
    check("input.value.length === 1", st.inputValue?.length === 1, JSON.stringify(st));
    check("input.value === '7' (not '77')", st.inputValue === "7", JSON.stringify(st));
    // Commit and re-read the SETTLED cell — a reading taken while the input is still mounted is
    // not final (a stray double-write could still be queued behind a not-yet-flushed re-render).
    await page.locator('td[data-cell="0-2"]').click();
    await pacedWait(page, 200);
    const settled = await readCellState(page, "0-3");
    check("after clicking away, Size reads the committed '7' with no input left mounted",
      !settled.inputMounted && settled.textContent.trim() === "7", JSON.stringify(settled));
  }

  console.log("\n=== CASE 2 — select-then-type, TWO keystrokes: '45' stays '45', not '445' ===");
  {
    const ok = await selectWithoutEditing(page, "0-3");
    check("Size cell reselected, not editing", ok);
    await page.keyboard.press("4");
    await pacedWait(page, 100);
    await page.keyboard.press("5");
    await pacedWait(page, 150);
    const st = await readCellState(page, "0-3");
    check("input.value === '45' (only the first char would double, giving '445')", st.inputValue === "45", JSON.stringify(st));
    // The caret must land AFTER the seeded character — if it landed before, the second keystroke
    // ('5') would have been inserted ahead of the first, producing '54' instead of '45'. The
    // selectionStart read below is the direct assertion of that same fact.
    check("caret sits at the end of the input (after the seeded char, not before it)", st.selectionStart === 2, JSON.stringify(st));
    await page.keyboard.press("Escape");
    await pacedWait(page, 150);
  }

  console.log("\n=== CASE 3 — select-then-type on Title (text) ===");
  {
    const ok = await selectWithoutEditing(page, "0-2");
    check("Title cell reached selected-not-editing state", ok);
    await page.keyboard.press("x");
    await pacedWait(page, 150);
    const st = await readCellState(page, "0-2");
    check("Title: input.value === 'x' (not 'xx')", st.inputValue === "x", JSON.stringify(st));
    await page.keyboard.press("Escape");
    await pacedWait(page, 150);
  }

  console.log("\n=== CASE 4 — select-then-type on Executed (date) — the exact repro's own case ===");
  if (execCellSel) {
    const ok = await selectWithoutEditing(page, execCellSel);
    check("Executed cell reached selected-not-editing state", ok);
    await page.keyboard.press("8");
    await pacedWait(page, 150);
    const st = await readCellState(page, execCellSel);
    check("Executed: input.value === '8' (not '88')", st.inputValue === "8", JSON.stringify(st));
    await page.keyboard.press("Escape");
    await pacedWait(page, 150);
  }

  console.log("\n=== CASE 5 — select-then-type on Notes (text, flexKey column) ===");
  {
    const headers2 = await page.locator("th").allTextContents();
    const notesCol = headers2.findIndex((t) => t.trim() === "Notes");
    const notesCellSel = notesCol >= 0 ? await findColByX(notesCol) : null;
    check("located the Notes cell", !!notesCellSel, notesCellSel);
    if (notesCellSel) {
      const ok = await selectWithoutEditing(page, notesCellSel);
      check("Notes cell reached selected-not-editing state", ok);
      await page.keyboard.press("n");
      await pacedWait(page, 150);
      const st = await readCellState(page, notesCellSel);
      check("Notes: input.value === 'n' (not 'nn')", st.inputValue === "n", JSON.stringify(st));
      await page.keyboard.press("Escape");
      await pacedWait(page, 150);
    }
  }

  console.log("\n=== CONTROL — click-to-edit path is UNCHANGED (mounts first, then types) ===");
  {
    await page.locator('td[data-cell="0-2"]').click();
    await pacedWait(page, 150);
    const preState = await readCellState(page, "0-2");
    check("click alone (no Escape) mounts the editor immediately", preState.inputMounted, JSON.stringify(preState));
    await page.keyboard.press("1");
    await pacedWait(page, 150);
    const st = await readCellState(page, "0-2");
    check("click-to-edit control: input.value === '1' (untouched by this fix)", st.inputValue === "1", JSON.stringify(st));
    await page.keyboard.press("Escape");
    await pacedWait(page, 150);
  }

  console.log("\n=== CASE 6 — reached via ARROW navigation from a neighbour, not click+Escape ===");
  {
    const ok = await selectWithoutEditing(page, "0-2"); // Title
    check("Title selected, not editing (starting point for arrow nav)", ok);
    await page.keyboard.press("ArrowRight"); // -> Size (0-3)
    await pacedWait(page, 150);
    const afterArrow = await page.evaluate(() => {
      const el = document.activeElement;
      return { tag: el.tagName, dataCell: el.dataset?.cell };
    });
    check("ArrowRight lands on Size, still not editing", afterArrow.tag === "TD" && afterArrow.dataCell === "0-3", JSON.stringify(afterArrow));
    await page.keyboard.press("3");
    await pacedWait(page, 150);
    const st = await readCellState(page, "0-3");
    check("arrow-navigated-then-typed: input.value === '3' (not '33')", st.inputValue === "3", JSON.stringify(st));
  }

  await ctx.close();
  await browser.close();
  return results;
}

async function main() {
  if (MUTATE) {
    console.log("### PASS 1 — fix DISARMED (expect the doubling checks to fail) ###");
    setFixArmed(false);
    const before = await run();
    const brokenNames = before.filter((r) => !r.ok).map((r) => r.name);
    console.log(`\n${brokenNames.length} check(s) failed with the fix removed (expected > 0).\n`);
    console.log("### PASS 2 — fix RESTORED ###");
    setFixArmed(true);
  }
  const finalResults = await run();
  const fails = finalResults.filter((r) => !r.ok);
  console.log(`\n${finalResults.length - fails.length}/${finalResults.length} checks passed.`);
  if (fails.length) {
    console.log("FAILURES:");
    fails.forEach((f) => console.log(`  ✗ ${f.name}`));
    process.exitCode = 1;
  }
}

main().catch((err) => { console.error(err); setFixArmed(true); process.exitCode = 1; });
