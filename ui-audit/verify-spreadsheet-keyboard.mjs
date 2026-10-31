/* verify-spreadsheet-keyboard — the Spreadsheet's Excel keyboard shortcuts, Alt key-tips, header selection and the REAL system clipboard
 * (Ctrl+C / Ctrl+X / Ctrl+V), driven with REAL keystrokes and a real mouse against the real page — now against the UNIVER grid, the grid
 * every account gets since the default-on cutover (NEW-2, 2026-10-31). The grid is a canvas: there is nothing to query, so every click
 * lands on a cell's POINT computed from Univer's own geometry and every result is read back through Univer's facade
 * (`window.__planyrUniverRead`, armed only when `window.__PLANYR_E2E === true`; helper: e2e/lib/univerGrid.js). No synthetic key events
 * (SYNTHETIC-KEYS-DONT-EDIT).
 *
 * THIS HARNESS WAS THE OLD DOM GRID'S (H/S/K/C sections, model-sheet, [data-row][data-col], model-col-header-*, the Planyr key-tip
 * overlay). Disposition of every old check — "ran here" = ported below; "REPLACED by <id>" = the Univer parity checklist already guards
 * the same behaviour STRICTLY (ui-audit/verify-univer-parity.mjs, 73/73 green when this was written; it runs against the sandbox host,
 * and `verify-univer-live.mjs` runs the same ids against the real app signed in); "RETIRED" = the behaviour no longer exists. The table is
 * printed at the end of every run so a reader sees what each old id became.
 *
 *   ARM   known-good: a typed value commits, a real Ctrl+Z undoes it .............. ran here (ARM)
 *   H1/H1b  headers are labels, no editor ........................................ REPLACED by headers-fixed
 *   H2    labels recomputed after an insert ...................................... REPLACED by headers-fixed + key-insert-delete (a column's letter IS Univer's position; no stored header text exists)
 *   H3/H3b/H4/H5  header click / drag / Shift / Ctrl / corner ....................... REPLACED by header-select, ctrl-click, header-press-keeps-others
 *   H6    border drag resizes, double-click autofits ............................... REPLACED by header-resize-autofit
 *   H7    whole-column Ctrl+B and Delete ........................................... ran here (H7)
 *   H8    header right-click menu carries the Excel items .......................... ran here (H8)
 *   S1    Ctrl+B over a range = ONE undo step ...................................... ran here (S1)
 *   S2    Ctrl+Shift+$ % ! ~ chords ................................................ REPLACED by key-currency / key-percent / key-number / key-general
 *   S3    Ctrl+1 number-format dialog .............................................. REPLACED by key-format-cells
 *   S4    Ctrl+; today ............................................................. REPLACED by key-today
 *   S5    Alt+= autosum ............................................................ ran here (S5)
 *   S6    Ctrl+9 / Ctrl+Shift+9 / Ctrl+0 hide ...................................... REPLACED by key-hide
 *   S7    Shift+Space / Ctrl+Space / Ctrl+A twice .................................. REPLACED by key-row-col + key-select-all
 *   S8    Ctrl+Shift+= / Ctrl+- on a row ........................................... REPLACED by key-insert-delete
 *   S9    F4 reference cycling ..................................................... REPLACED by key-f4 ; F4 = repeat last action ran here (S9)
 *   S10   Alt+Enter new line ....................................................... REPLACED by key-alt-enter
 *   S11   Ctrl+PgUp / Ctrl+PgDn between sheets ..................................... ran here (S11)
 *   S12   Ctrl+R / Ctrl+Enter ...................................................... REPLACED by key-fill + key-ctrl-enter
 *   K1,K2,K5,K6  Alt H O I / H O A / H B A / H A C / H O W ......................... REPLACED by alt-h-o-i, alt-h-o-a, alt-h-b-a-n-o-t, alt-h-a-l-c-r-t-m-b, alt-h-o-w
 *   K3    Esc backs out one level; unknown key and a click cancel ................... Esc: REPLACED by alt-keytips ; unknown key + click cancel ran here (K3)
 *   K4    plain Alt+Enter and Alt+click do not open the sequence ................... Alt+Enter: REPLACED by alt-keytips (control arm) ; Alt+click ran here (K4)
 *   C1    Ctrl+C writes TSV text/plain + styled text/html ........................... ran here (C1); the "Planyr marker" half is RETIRED — Univer's own clipboard format carries no `data-planyr-clip`, and the same-sheet round trip no longer needs it (clip-internal proves copy/paste keeps formatting)
 *   C1b/C7  dashed copy outline drawn, Escape drops it ............................. ran here (C1b/C7) as a canvas-pixel check (the outline is painted on Univer's canvas; no DOM or facade read exists)
 *   C2    paste keeps values, shifted formulas, bold ............................... ran here (C2)
 *   C3    paste a captured Excel fragment .......................................... REPLACED for values+formatting by clip-excel ; the fixture itself (formula text, merge, $/% formats) ran here (C3)
 *   C4/C5 plain text with commas is ONE cell; TSV block; single value fills .......... ran here (C4, C5)
 *   C6    cut + paste moves, formulas follow, ONE undo ............................. REPLACED by clip-cut
 *   C8    paste into the cell editor stays native text ............................ ran here (C8)
 *   C9    an unusable paste says so ................................................ ran here (C9)
 *   C10   the copy survives a reload ............................................... ran here (C10)
 *   C11   hidden rows are skipped when copying ..................................... ran here (C11)
 * KNOWN-GOOD ARM: a plain typed value and a plain Ctrl+Z must work before anything else is judged (else the run is VOID, exit 2).
 * Each check starts from a FRESH throwaway project (a new page load), so no check can lean on another's leftovers.
 * Run: node ui-audit/verify-spreadsheet-keyboard.mjs [base=http://localhost:4173] [--signed-in] [--only H,S] [--shots dir]
 *   --signed-in  signs in as the test account (E2E_LOGIN_KEY) and works on its fixture site; each check then starts by clearing the sheet
 *                through the facade (a fresh load per check would re-read the cloud copy) — run it after a deploy that carries the default-on grid */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import {
  CANVAS, seedProject, waitForGrid, inSheet, cellPoint, clickCell, dblclickCell, rightClickCell, typeText, enter, press,
  value, shown, formulaOf, styleOf, selection, activeCell, sheetNames, columnHeaderPoint, rowHeaderPoint, flushGrid,
} from "../e2e/lib/univerGrid.js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "http://localhost:4173";
const ONLY = (val("--only") || "").split(",").map((x) => x.trim()).filter(Boolean);
const SHOTS = val("--shots");
const SIGNED_IN = flag("--signed-in");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const FIXTURE = readFileSync(new URL("../test/fixtures/spreadsheet/excel-range.html", import.meta.url), "utf8");

let failures = 0, passes = 0;
const results = [];
const ok = (id, name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${id} ${name}${extra ? "  ::  " + extra : ""}`);
  results.push({ id, cond: !!cond });
  if (cond) passes++; else failures++;
};
const wants = (sec) => ONLY.length === 0 || ONLY.includes(sec);

let browser, page, signed = null, projectId;
const origin = new URL(BASE).origin;
const stamp = Date.now().toString(36);
let seq = 0;
if (SIGNED_IN) {
  signed = await openSignedIn({ base: BASE });
  page = signed.page;
  projectId = FIXTURE_SITE_ID;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
} else {
  browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  page = await ctx.newPage();
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
}
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

/** A clean grid for the next check. Local: a brand-new throwaway project in a fresh page load. Signed in: clear the fixture sheet in place. */
const fresh = async () => {
  if (SIGNED_IN) {
    if (!seq++) { await page.goto(`${BASE}/#/project/${projectId}/spreadsheet`, { waitUntil: "load" }); await waitForGrid(page); await assertMeasurable(page, "verify-spreadsheet-keyboard"); }
    await inSheet(page, (api, ws) => { ws.getRange(0, 0, 200, 40).clear(); });
    await page.waitForTimeout(300);
    return;
  }
  const id = `zz-kbd-${stamp}-${++seq}`;
  await seedProject(page, id, "ZZ Keyboard (throwaway)");
  // a hash-only goto keeps the old document, so the init script that seeds THIS project would not run: reload to start from the new project's seed
  // (never via about:blank — the seeding script touches localStorage, which an about:blank document refuses with an uncaught error)
  await page.goto(`${BASE}/#/project/${id}/spreadsheet`, { waitUntil: "load" });
  if (seq > 1) await page.reload({ waitUntil: "load" });
  await waitForGrid(page);
  if (seq === 1) await assertMeasurable(page, "verify-spreadsheet-keyboard");
  await page.mouse.move(5, 5);
};

// ---- helpers (real mouse / real keys only) ----
const kb = page.keyboard;
const put = async (r, c, text) => enter(page, r, c, text);
// A range selected with a real click + Shift+click. The check that follows must not act until Univer's OWN selection reports that range — on a loaded
// machine a key pressed in the gap acts on the previous selection (measured: Ctrl+B landed on the wrong cells and C2 read a bold-less source).
const select = async (r1, c1, r2, c2) => {
  await clickCell(page, r1, c1); await kb.down("Shift"); await clickCell(page, r2, c2); await kb.up("Shift");
  const want = [Math.min(r1, r2), Math.max(r1, r2), Math.min(c1, c2), Math.max(c1, c2)].join(",");
  for (let i = 0; i < 25; i++) { const sel = await selection(page); if (sel.length === 1 && [sel[0].r1, sel[0].r2, sel[0].c1, sel[0].c2].join(",") === want) return; await settle(80); }
  throw new Error(`the selection never became ${want}`);
};
const bold = async (r, c) => (await styleOf(page, r, c)).bold;
const settle = (ms = 200) => page.waitForTimeout(ms);
const colHeaderClick = async (c, opts = {}) => { const p = await columnHeaderPoint(page, c); await page.mouse.click(p.x, p.y, opts); await settle(250); };
const clipRead = () => page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const out = { types: [], text: "", html: "" };
  for (const it of items) {
    out.types.push(...it.types);
    if (it.types.includes("text/plain")) out.text = await (await it.getType("text/plain")).text();
    if (it.types.includes("text/html")) out.html = await (await it.getType("text/html")).text();
  }
  return out;
});
const clipWrite = (html, text) => page.evaluate(async ([h, t]) => {
  const data = {};
  if (h != null) data["text/html"] = new Blob([h], { type: "text/html" });
  if (t != null) data["text/plain"] = new Blob([t], { type: "text/plain" });
  await navigator.clipboard.write([new window.ClipboardItem(data)]);
}, [html, text]);
const tipPanel = () => page.evaluate(() => { const p = document.querySelector('[data-testid="excel-keys-keytip-panel"]'); return p && p.style.display !== "none" ? p.innerText.replace(/\s+/g, " ") : null; });
// read from the saved snapshot (`hd: 1`), the same read verify-univer-parity's hiddenState uses — the live Worksheet facade has no isRowHidden
const hiddenRows = () => inSheet(page, (api, ws) => { const sd = api.getActiveWorkbook().save().sheets[ws.getSheetId()]; return Object.keys(sd.rowData || {}).filter((r) => sd.rowData[r].hd === 1).map(Number); });
/** pixels of a band of the canvas around a cell range — the copy outline lives on the canvas, so a screenshot is the only read there is */
const bandShot = async (r1, c1, r2, c2) => {
  const a = await cellPoint(page, r1, c1), b = await cellPoint(page, r2, c2);
  return page.screenshot({ clip: { x: Math.max(0, a.left - 6), y: Math.max(0, a.top - 6), width: b.right - a.left + 12, height: b.bottom - a.top + 12 } });
};
const tryCheck = async (id, name, fn) => { try { await fn(); } catch (e) { ok(id, name, false, `threw: ${String(e.message).split("\n").slice(0, process.env.DEBUGERR ? 14 : 1).join(" / ").slice(0, process.env.DEBUGERR ? 1500 : 200)}`); } };

try {
  // ── KNOWN-GOOD ARM ──
  await fresh();
  await put(0, 0, "7");
  const typed = (await value(page, 0, 0)) === 7;
  await press(page, "Control+z"); await settle(250);
  const undone = (await value(page, 0, 0)) === null;
  await put(0, 0, "7");
  const again = (await value(page, 0, 0)) === 7;
  ok("ARM", "a typed value commits and a real Ctrl+Z undoes it (instrument can see edits)", typed && undone && again, `typed=${typed} afterUndo=${undone} retyped=${again}`);
  if (!(typed && undone && again)) { console.log("VOID — the instrument cannot see a plain edit"); process.exitCode = 2; throw new Error("void"); }

  // ═══════════════ H — HEADERS ═══════════════
  if (wants("H")) {
    await tryCheck("H7", "whole-column bold and Delete work", async () => {
      await fresh();
      await put(2, 6, "x"); await put(3, 6, "y");
      await colHeaderClick(6);
      await press(page, "Control+b");
      const b = [await bold(2, 6), await bold(3, 6), await bold(9, 6)];
      await press(page, "Delete"); await settle(250);
      const cleared = [await value(page, 2, 6), await value(page, 3, 6)];
      ok("H7", "Ctrl+B on a selected column bolds every cell of it (incl. an empty one far down); Delete clears its contents", b.every(Boolean) && cleared.every((v) => v === null), `bold=${b} cleared=${cleared}`);
    });
    await tryCheck("H8", "header right-click menu offers Insert / Delete / Clear / Hide / Width (and the row menu the row versions)", async () => {
      await fresh();
      const text = async () => page.evaluate(() => [...document.querySelectorAll('[role="menu"], [class*="univer-context"], [data-u-comp="context-menu"], [class*="menu"]')].map((e) => e.innerText).join("\n") || document.body.innerText);
      const colP = await columnHeaderPoint(page, 2);
      await page.mouse.click(colP.x, colP.y); await settle(200);
      await page.mouse.click(colP.x, colP.y, { button: "right" }); await settle(450);
      const t1 = await text();
      if (process.env.DEBUGERR) console.log("COLMENU", JSON.stringify(t1.slice(0, 400)));
      await kb.press("Escape"); await settle(250);
      const need = (t, words) => words.filter((w) => !new RegExp(w, "i").test(t));
      const missCol = need(t1, ["Insert", "Delete", "Clear", "Hide", "(Column )?width"]);
      const rp = await rowHeaderPoint(page, 4);
      await page.mouse.click(rp.x, rp.y); await settle(200);
      await page.mouse.click(rp.x, rp.y, { button: "right" }); await settle(450);
      const t2 = await text();
      await kb.press("Escape"); await settle(200);
      const missRow = need(t2, ["Insert", "Delete", "Clear", "Hide", "(Row )?height"]);
      ok("H8", "column and row header menus carry the Excel items", missCol.length === 0 && missRow.length === 0, `missingCol=${missCol} missingRow=${missRow}`);
    });
  }

  // ═══════════════ S — SHORTCUTS (the ones the Univer parity checklist does not already drive) ═══════════════
  if (wants("S")) {
    await tryCheck("S1", "Ctrl+B over a range bolds all of it in ONE undo step", async () => {
      await fresh();
      await put(0, 0, "a"); await put(1, 0, "b"); await put(0, 1, "c");
      await select(0, 0, 1, 1);
      await press(page, "Control+b");
      const on = [await bold(0, 0), await bold(1, 1)];
      await press(page, "Control+z"); await settle(250);
      const off = [await bold(0, 0), await bold(1, 1)];
      ok("S1", "Ctrl+B bolds the whole range; ONE Ctrl+Z reverts all of it", on.every(Boolean) && off.every((b) => !b), `on=${on} off=${off}`);
    });
    await tryCheck("S5", "Alt+= sums the numbers above", async () => {
      await fresh();
      await put(7, 2, "10"); await put(8, 2, "20"); await put(9, 2, "30");
      await clickCell(page, 10, 2);
      await press(page, "Alt+="); await settle(300);
      const v = await value(page, 10, 2), f = await formulaOf(page, 10, 2);
      ok("S5", "Alt+= under 10,20,30 gives 60 (a =SUM over the three)", v === 60 && /SUM\(C8:C10\)/i.test(f || ""), `value=${v} formula=${f}`);
    });
    await tryCheck("S9", "F4 outside a formula repeats the last action", async () => {
      await fresh();
      await put(0, 0, "p"); await put(1, 0, "q");
      await clickCell(page, 0, 0); await press(page, "Control+b");
      await clickCell(page, 1, 0); await press(page, "F4"); await settle(250);
      ok("S9", "F4 re-applies bold to the next cell (Excel's repeat-last-action)", (await bold(0, 0)) && (await bold(1, 0)), `p bold=${await bold(0, 0)} q bold=${await bold(1, 0)}`);
    });
    await tryCheck("S11", "Ctrl+PageUp / Ctrl+PageDown move between sheet tabs", async () => {
      await fresh();
      await put(0, 0, "on-sheet-1");
      await page.locator('[data-u-comp="sheet-bar-append-button"]').first().click(); await settle(500);
      const names1 = await sheetNames(page);
      const onNew = names1.findIndex((s) => s.active) === names1.length - 1 && names1.length === 2;
      await clickCell(page, 0, 0);
      await press(page, "Control+PageUp"); await settle(300);
      const back = (await sheetNames(page)).findIndex((s) => s.active) === 0 && (await value(page, 0, 0)) === "on-sheet-1";
      await press(page, "Control+PageDown"); await settle(300);
      const fwd = (await sheetNames(page)).findIndex((s) => s.active) === 1 && (await value(page, 0, 0)) === null;
      ok("S11", "after adding a sheet: Ctrl+PgUp shows the first sheet's A1, Ctrl+PgDn the new blank one", onNew && back && fwd, `newActive=${onNew} pgup=${back} pgdn=${fwd}`);
    });
  }

  // ═══════════════ K — KEY TIPS (only what alt-keytips does not already drive) ═══════════════
  if (wants("K")) {
    await tryCheck("K3", "an unknown letter and a click cancel the key-tip sequence", async () => {
      await fresh();
      await clickCell(page, 0, 0);
      await kb.down("Alt"); await kb.up("Alt"); await settle(250);
      const opened = await tipPanel();
      await kb.press("h"); await settle(200);
      await kb.press("q"); await settle(250);
      const cancelled = (await tipPanel()) === null;
      await kb.down("Alt"); await kb.up("Alt"); await settle(250); await kb.press("h"); await settle(200);
      const reopened = await tipPanel();
      await clickCell(page, 3, 3);
      const clickCancelled = (await tipPanel()) === null;
      ok("K3", "Alt shows the strip; Alt H Q (unknown) cancels it; a click on a cell cancels it", !!opened && cancelled && !!reopened && clickCancelled, `opened=${!!opened} cancelled=${cancelled} reopened=${!!reopened} click=${clickCancelled}`);
    });
    await tryCheck("K4", "Alt+click does not open the key-tip sequence", async () => {
      await fresh();
      await clickCell(page, 5, 5);
      await clickCell(page, 6, 6, { modifiers: ["Alt"] });
      ok("K4", "Alt+click on a cell leaves the key tips closed", (await tipPanel()) === null);
    });
  }

  // ═══════════════ C — CLIPBOARD ═══════════════
  if (wants("C")) {
    await tryCheck("C1", "Ctrl+C writes TSV text/plain and styled text/html to the SYSTEM clipboard", async () => {
      await fresh();
      await put(0, 0, "Item"); await put(0, 1, "100"); await put(1, 0, "Total"); await put(1, 1, "=B1*2");
      await select(0, 0, 0, 1); await press(page, "Control+b");
      await select(0, 0, 1, 1);
      const before = await bandShot(0, 0, 1, 1);
      await press(page, "Control+c"); await settle(400);
      const clip = await clipRead();
      ok("C1", "the OS clipboard holds text/plain TSV and text/html (a table carrying the bold)", clip.text === "Item\t100\nTotal\t200" && /<table/i.test(clip.html) && /font-weight:\s*(700|bold)|<b[\s>]|<strong/i.test(clip.html), `text='${clip.text.replace(/\n/g, "\\n").replace(/\t/g, "→")}' types=${clip.types} html=${clip.html.slice(0, 120).replace(/\s+/g, " ")}`);
      const during = await bandShot(0, 0, 1, 1);
      ok("C1b", "a copy outline is painted around the copied range (canvas pixels differ from the same band before the copy)", !before.equals(during));
      await press(page, "Escape"); await settle(400);
      const after = await bandShot(0, 0, 1, 1);
      ok("C7", "Escape removes the copied-range outline (the band is pixel-identical to its pre-copy state again)", before.equals(after));
    });
    await tryCheck("C2", "Ctrl+V inside Planyr keeps values, shifted formulas and bold", async () => {
      await fresh();
      await put(0, 0, "Item"); await put(0, 1, "100"); await put(1, 0, "Total"); await put(1, 1, "=B1*2");
      await select(0, 0, 0, 1); await press(page, "Control+b");
      const srcBold = await bold(0, 0);            // precondition: the bold the paste must carry really is on the source (else this run measured nothing)
      await select(0, 0, 1, 1); await press(page, "Control+c"); await settle(500);
      await clickCell(page, 4, 0); await press(page, "Control+v"); await settle(600);
      const got = [await value(page, 4, 0), await value(page, 4, 1), await value(page, 5, 0), await value(page, 5, 1)];
      const f = await formulaOf(page, 5, 1);
      ok("C2", "pasting at A5 reproduces the block; =B1*2 became =B5*2 (200); the bold came along", got.join("|") === "Item|100|Total|200" && /B5\*2/.test(f || "") && srcBold && (await bold(4, 0)), `got=${got.join("|")} formula=${f} srcBold=${srcBold} bold=${await bold(4, 0)}`);
    });
    await tryCheck("C3", "pasting a captured Excel fragment keeps values, fill, number formats and the merge", async () => {
      await fresh();
      await clipWrite(FIXTURE, "Item\tCost\tShare\nLand & site\t$1,234.50\t25.00%");
      await clickCell(page, 10, 0); await press(page, "Control+v"); await settle(500);
      const vals = [await shown(page, 10, 0), await shown(page, 11, 1), await shown(page, 11, 2)];
      const st = await styleOf(page, 10, 0);
      const headBold = await bold(10, 0);
      const merges = await inSheet(page, (api, ws) => (ws.getMergedRanges ? ws.getMergedRanges().map((x) => x.getA1Notation()) : []));
      ok("C3", "Excel's HTML pastes as cells: header bold on yellow, $1,234.50, 25.00%, the last row merged across the block", vals[0] === "Item" && vals[1] === "$1,234.50" && vals[2] === "25.00%" && /^#?ffff00$/i.test(String(st.bg || "").replace(/^#|rgb\(|\)|\s/g, "").replace(/^255,255,0$/, "ffff00")) && headBold && merges.includes("A15:C15"), `vals=${vals.join("|")} fill=${st.bg} headBold=${headBold} merges=${merges}`);
      ok("C3b", "a <b>…</b> run inside an Excel cell (the 'Total' label) pastes bold", await bold(13, 0), `bold(Total)=${await bold(13, 0)}`);
      const f = await formulaOf(page, 13, 1);
      ok("C3c", "an Excel cell carrying x:fmla pastes as a FORMULA (=SUM(B2:B3)), not as its frozen result", f === "=SUM(B2:B3)", `formula=${f} shown=${await shown(page, 13, 1)}`);
    });
    await tryCheck("C4", "a plain text line with commas pastes into ONE cell", async () => {
      await fresh();
      await clipWrite(null, "alpha, beta, gamma");
      await clickCell(page, 18, 0); await press(page, "Control+v"); await settle(400);
      ok("C4", "no comma splitting: one cell holds 'alpha, beta, gamma' and its neighbour stays empty", (await value(page, 18, 0)) === "alpha, beta, gamma" && (await value(page, 18, 1)) === null, `a='${await value(page, 18, 0)}' b='${await value(page, 18, 1)}'`);
    });
    await tryCheck("C5", "a tab/newline block lands in a grid; a single value fills the whole selection", async () => {
      await fresh();
      await clipWrite(null, "1\t2\n3\t4");
      await clickCell(page, 20, 0); await press(page, "Control+v"); await settle(400);
      const block = [await value(page, 20, 0), await value(page, 20, 1), await value(page, 21, 0), await value(page, 21, 1)];
      await clipWrite(null, "9");
      await select(24, 0, 25, 1); await press(page, "Control+v"); await settle(400);
      const filled = [await value(page, 24, 0), await value(page, 24, 1), await value(page, 25, 0), await value(page, 25, 1)];
      ok("C5", "TSV -> 2x2 block; single value -> every selected cell", block.join(",") === "1,2,3,4" && filled.every((v) => v === 9), `block=${block} filled=${filled}`);
    });
    await tryCheck("C8", "paste inside the cell editor stays a native text paste", async () => {
      await fresh();
      await clipWrite(null, "pasted-into-editor");
      await clickCell(page, 22, 0); await press(page, "F2"); await settle(400);
      await press(page, "Control+v"); await settle(300);
      await press(page, "Enter"); await settle(300);
      ok("C8", "with a cell open for editing, Ctrl+V pastes the text into THAT cell only (not a grid paste)", (await value(page, 22, 0)) === "pasted-into-editor" && (await value(page, 23, 0)) === null, `A23='${await value(page, 22, 0)}' A24='${await value(page, 23, 0)}'`);
    });
    await tryCheck("C9", "pasting when nothing usable is on the clipboard says so", async () => {
      await fresh();
      await page.evaluate(async () => { await navigator.clipboard.writeText(""); });
      await clickCell(page, 22, 0); await press(page, "Control+v"); await settle(800);
      const said = await page.evaluate(() => /Nothing to paste/i.test(document.body.innerText) || !!document.querySelector('[data-testid="model-notice"]'));
      ok("C9", "an empty paste shows a visible message instead of silently doing nothing (owner rule: never a silent no-op)", said);
    });
    await tryCheck("C10", "the copy survives a reload", async () => {
      await fresh();
      await put(0, 0, "Item");
      await clickCell(page, 0, 0); await press(page, "Control+c"); await settle(500);
      const beforeReload = (await clipRead()).text;   // precondition: the copy reached the OS clipboard at all
      await flushGrid(page);
      await page.reload({ waitUntil: "load" });
      await waitForGrid(page);
      await clickCell(page, 14, 0); await press(page, "Control+v"); await settle(500);
      ok("C10", "after a reload Ctrl+V still pastes what was copied (the OS clipboard, not in-page state)", beforeReload === "Item" && (await value(page, 14, 0)) === "Item", `clipboardBeforeReload='${beforeReload}' got='${await value(page, 14, 0)}'`);
    });
    await tryCheck("C11", "hidden rows are skipped when copying", async () => {
      await fresh();
      await put(10, 0, "a"); await put(11, 0, "b"); await put(12, 0, "c");
      await clickCell(page, 11, 0); await press(page, "Control+9"); await settle(300);
      const hid = await hiddenRows();
      await select(10, 0, 12, 0); await press(page, "Control+c"); await settle(400);
      const clip = await clipRead();
      ok("C11", "copying a, [hidden b], c puts only a and c on the clipboard", hid.includes(11) && clip.text === "a\nc", `hidden=${hid} text='${clip.text.replace(/\n/g, "\\n")}'`);
    });
  }

  if (pageErrors.length) console.log("PAGE ERRORS:", pageErrors.slice(0, 5));
  ok("ERR", "no uncaught page errors during the run", pageErrors.length === 0, pageErrors[0] || "");
} catch (e) {
  if (e.message !== "void") { console.log("HARNESS ERROR:", e.stack || e.message); failures++; }
} finally {
  console.log(`\n${passes} passed, ${failures} failed`);
  console.log("FAILED_IDS " + results.filter((r) => !r.cond).map((r) => r.id).join(","));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/end.png` }).catch(() => {});
  if (signed) await signed.close?.(); else if (browser) await browser.close();
  if (failures) process.exitCode = process.exitCode || 1;
}
