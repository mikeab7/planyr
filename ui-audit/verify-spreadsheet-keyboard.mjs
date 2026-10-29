/* verify-spreadsheet-keyboard — the Spreadsheet's Excel keyboard shortcuts, Alt key-tips, fixed header labels,
 * whole-row / whole-column header selection, and the REAL system clipboard (Ctrl+C / Ctrl+X / Ctrl+V), all driven
 * with REAL keystrokes and a real mouse against the real page (no synthetic key events — SYNTHETIC-KEYS-DONT-EDIT).
 *
 * Sections (each check prints PASS/FAIL with its own id so a RED-ON-MAIN run reads as a list of what was broken):
 *   H  headers      H1 no rename route · H2 label = position letter after insert · H3 click selects whole column/row (name box
 *                   C:C / 5:5, active cell first cell) · H4 drag + Shift+click spans · H5 corner = whole sheet · H6 border drag
 *                   still resizes and double-click autofits · H7 whole-column Ctrl+B / Delete · H8 header right-click menu
 *   S  shortcuts    S1 Ctrl+B over a range, ONE undo step · S2 number-format chords · S3 Ctrl+1 dialog · S4 Ctrl+; · S5 Alt+=
 *                   S6 hide / unhide rows and columns · S7 Shift+Space / Ctrl+Space / Ctrl+A twice · S8 Ctrl+Shift+= on a row
 *                   S9 F4 repeat + F4 reference cycling · S10 Alt+Enter new line · S11 Ctrl+PgDn · S12 Ctrl+R / Ctrl+Enter
 *   K  key tips     K1 Alt H O I widens the column · K2 Alt H O A grows a wrapped row · K3 Esc backs out one level, unknown key
 *                   cancels, a click cancels · K4 plain Alt+Enter / Alt+click do NOT open the sequence · K5 Alt H B A / Alt H A C
 *                   · K6 Alt H O W dialog
 *   C  clipboard    C1 copy writes text/plain TSV + styled text/html with the Planyr marker · C2 paste back keeps values, formulas
 *                   (relative refs shifted), bold, fill, number format · C3 paste of a captured EXCEL fragment (fixture) · C4 plain
 *                   text with commas is ONE cell · C5 single value fills the selection · C6 cut + paste MOVES and the formula that
 *                   pointed at the block follows · C7 Escape drops the outline · C8 paste into the cell editor stays native text
 *                   · C9 paste with nothing usable says so · C10 clipboard survives a reload · C11 hidden rows are skipped
 * KNOWN-GOOD ARM: a plain typed value and a plain Ctrl+Z must work before anything else is judged (else the run is VOID).
 * Run: node ui-audit/verify-spreadsheet-keyboard.mjs [base=http://localhost:5199] [--signed-in] [--only H,S] [--shots dir]
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "http://localhost:5199";
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
if (SIGNED_IN) {
  signed = await openSignedIn({ base: BASE });
  page = signed.page;
  projectId = FIXTURE_SITE_ID;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
} else {
  browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  page = await ctx.newPage();
  projectId = `zz-kbd-${Date.now().toString(36)}`;
  const site = { id: projectId, groupId: projectId, site: "ZZ Keyboard (throwaway)", name: "ZZ Keyboard (throwaway)", origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([sid, rec]) => { if (!localStorage.getItem("planarfit:sites:v1")) localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: rec })); }, [projectId, site]);
}
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const open = async () => {
  await page.goto(`${BASE}/#/project/${projectId}/spreadsheet`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="model-sheet"]', { timeout: 60000 });
  await page.waitForTimeout(600);
  await assertMeasurable(page, "verify-spreadsheet-keyboard");
};

// ---- helpers (real mouse / real keys only) ----
const cell = (r, c) => page.locator(`[data-testid="model-sheet"] [data-row="${r}"][data-col="${c}"]`);
const header = (c) => page.getByTestId(`model-col-header-${c}`);
const rowHeader = (r) => page.getByTestId(`model-row-header-${r}`);
const display = async (r, c) => (await cell(r, c).innerText()).trim();
const nameBox = () => page.getByTestId("model-name-box").inputValue();
const letters = (c) => { let n = c + 1, s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
// The grid is virtualised: bring a cell into the DOM through the REAL Name Box (type the address, Enter) when it is not rendered.
const ensure = async (r, c) => {
  if ((await cell(r, c).count()) > 0) return;
  const box = page.getByTestId("model-name-box");
  await box.click(); await box.fill(`${letters(c)}${r + 1}`); await page.keyboard.press("Enter");
  await cell(r, c).waitFor({ timeout: 5000 });
};
const at = async (r, c, opts) => { await ensure(r, c); await cell(r, c).click(opts); };
const put = async (r, c, text) => { await at(r, c); await page.keyboard.type(text); await page.keyboard.press("Enter"); };
const fontWeight = (r, c) => cell(r, c).evaluate((el) => getComputedStyle(el).fontWeight);
const bg = (r, c) => cell(r, c).evaluate((el) => getComputedStyle(el).backgroundColor);
const colWidth = (c) => header(c).evaluate((el) => el.getBoundingClientRect().width);
const rowHeight = async (r) => ((await rowHeader(r).count()) === 0 ? 0 : rowHeader(r).evaluate((el) => el.getBoundingClientRect().height)); // a hidden row is not rendered at all
const reset = async () => { await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("planarfit:model") || k.startsWith("planyr:model")) localStorage.removeItem(k); }); };
const select = async (r1, c1, r2, c2) => { await at(r1, c1); await ensure(r2, c2); await page.keyboard.down("Shift"); await cell(r2, c2).click(); await page.keyboard.up("Shift"); };
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
const tryCheck = async (id, name, fn) => { try { await fn(); } catch (e) { ok(id, name, false, `threw: ${String(e.message).split("\n").slice(0, process.env.DEBUGERR ? 14 : 1).join(" / ").slice(0, process.env.DEBUGERR ? 1500 : 160)}`); } };

try {
  await open();
  // ── KNOWN-GOOD ARM ──
  await put(0, 0, "7");
  await page.keyboard.press("Control+z");
  const armOk = (await display(0, 0)) === "";
  await put(0, 0, "7");
  const arm2 = (await display(0, 0)) === "7";
  ok("ARM", "a typed value commits and a real Ctrl+Z undoes it (instrument can see edits)", armOk && arm2, `afterUndo='${armOk}' typed='${arm2}'`);
  if (!(armOk && arm2)) { console.log("VOID — the instrument cannot see a plain edit"); process.exitCode = 2; throw new Error("void"); }

  // ═══════════════ H — HEADERS ═══════════════
  if (wants("H")) {
    await tryCheck("H1", "double-clicking a column letter opens NO editor; typing while a header is focused changes nothing", async () => {
      await header(1).dblclick();
      const inputs = await page.locator('[data-testid="model-col-header-1"] input').count();
      await page.keyboard.type("Zed");
      await page.keyboard.press("Enter");
      const label = (await header(1).innerText()).trim();
      ok("H1", "double-clicking a column letter opens NO editor; typing leaves the label alone", inputs === 0 && label === "B", `inputs=${inputs} label='${label}'`);
    });
    await tryCheck("H1b", "row numbers / corner are not editable and not focusable", async () => {
      const flags = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll('[data-header], [data-testid^="model-col-header-"], [data-testid^="model-row-header-"]')) {
          if (el.isContentEditable || el.getAttribute("contenteditable") === "true" || el.tabIndex >= 0 || el.querySelector("input,textarea")) bad.push(el.getAttribute("data-testid") || el.getAttribute("data-header"));
        }
        return bad;
      });
      await rowHeader(2).dblclick();
      const afterRowDbl = await page.locator('[data-testid="model-row-header-2"] input').count();
      ok("H1b", "no header / row number / corner is editable or in the tab order", flags.length === 0 && afterRowDbl === 0, `bad=${JSON.stringify(flags)}`);
    });
    await tryCheck("H3", "click a column letter -> whole column, active cell first, name box C:C", async () => {
      await header(2).click();
      const nb = await nameBox();
      const active = await page.locator('[data-testid="model-active-cell"]').first().getAttribute("data-row");
      const selCount = await page.locator('[data-selected="true"]').count();
      ok("H3", "click a column letter selects the whole column (name box C:C, active cell on row 1)", nb === "C:C" && active === "0" && selCount > 10, `namebox='${nb}' activeRow=${active} selectedVisible=${selCount}`);
    });
    await tryCheck("H3b", "click a row number -> whole row, name box 5:5", async () => {
      await rowHeader(4).click();
      const nb = await nameBox();
      const onlyRow = await page.evaluate(() => [...document.querySelectorAll('[data-selected="true"]')].every((e) => e.getAttribute("data-row") === "4"));
      const count = await page.locator('[data-selected="true"]').count();
      ok("H3b", "click a row number selects the whole row (name box 5:5, every column of that row)", nb === "5:5" && onlyRow && count >= 20, `namebox='${nb}' onlyRow=${onlyRow} count=${count}`);
    });
    await tryCheck("H4", "drag across headers and Shift+click give the right spans", async () => {
      const a = await header(3).boundingBox(), b = await header(5).boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
      await page.mouse.up();
      const drag = await nameBox();
      await header(1).click();
      await page.keyboard.down("Shift");
      await header(4).click();
      await page.keyboard.up("Shift");
      const shiftSpan = await nameBox();
      await rowHeader(2).click();
      await page.keyboard.down("Shift");
      await rowHeader(6).click();
      await page.keyboard.up("Shift");
      const rowSpan = await nameBox();
      await header(7).click({ modifiers: ["Control"] });
      const ctrlClick = await nameBox();
      ok("H4", "drag D->F = D:F; Shift+click B->E = B:E; rows 3->7 = 3:7; Ctrl+click is a plain single-column click", drag === "D:F" && shiftSpan === "B:E" && rowSpan === "3:7" && ctrlClick === "H:H", `drag='${drag}' shift='${shiftSpan}' rows='${rowSpan}' ctrl='${ctrlClick}'`);
    });
    await tryCheck("H5", "corner box selects the whole sheet", async () => {
      await page.getByTestId("model-corner").click();
      const nb = await nameBox();
      ok("H5", "clicking the top-left corner selects everything (name box A:Z)", nb === "A:Z", `namebox='${nb}'`);
    });
    await tryCheck("H6", "border drag resizes, a header-middle click selects, double-click on the border autofits", async () => {
      await put(0, 4, "a fairly long piece of text for autofit");
      const w0 = await colWidth(4);
      const hb = await header(4).boundingBox();
      await page.mouse.move(hb.x + hb.width - 1, hb.y + hb.height / 2);
      await page.mouse.down();
      await page.mouse.move(hb.x + hb.width + 40, hb.y + hb.height / 2, { steps: 5 });
      await page.mouse.up();
      const w1 = await colWidth(4);
      await header(4).click();
      const midClick = await nameBox();
      const hb2 = await header(4).boundingBox();
      await page.mouse.dblclick(hb2.x + hb2.width - 1, hb2.y + hb2.height / 2);
      const w2 = await colWidth(4);
      ok("H6", "dragging a header border widens it; clicking the middle selects the column; double-click autofits to the content", w1 > w0 + 20 && midClick === "E:E" && Math.abs(w2 - w1) > 5, `w0=${w0} w1=${w1} mid='${midClick}' w2=${w2}`);
    });
    await tryCheck("H7", "whole-column bold and Delete work", async () => {
      await put(2, 6, "x"); await put(3, 6, "y");
      await header(6).click();
      await page.keyboard.press("Control+b");
      const fw = [await fontWeight(2, 6), await fontWeight(3, 6), await fontWeight(9, 6)];
      await page.keyboard.press("Delete");
      const cleared = [await display(2, 6), await display(3, 6)];
      ok("H7", "Ctrl+B on a selected column bolds every cell of it; Delete clears its contents", fw.every((w) => Number(w) >= 600) && cleared.every((t) => t === ""), `weights=${fw} cleared=${cleared}`);
    });
    await tryCheck("H8", "header right-click menu offers Insert / Delete / Clear contents / Hide / Unhide / Column width", async () => {
      await header(2).click({ button: "right" });
      const text = await page.evaluate(() => document.body.innerText);
      const wanted = ["Insert", "Delete", "Clear contents", "Hide", "Unhide", "Column width"];
      const missing = wanted.filter((w) => !text.includes(w));
      await page.keyboard.press("Escape");
      await rowHeader(2).click({ button: "right" });
      const text2 = await page.evaluate(() => document.body.innerText);
      const missing2 = ["Insert", "Delete", "Clear contents", "Hide", "Unhide", "Row height"].filter((w) => !text2.includes(w));
      await page.keyboard.press("Escape");
      ok("H8", "column and row header menus carry the Excel items", missing.length === 0 && missing2.length === 0, `missingCol=${missing} missingRow=${missing2}`);
    });
    await tryCheck("H2", "labels are recomputed after an insert (no stale or duplicate letters)", async () => {
      await header(2).click();
      await page.keyboard.press("Control+Shift+=");
      await page.waitForTimeout(150);
      const labels = [];
      for (let i = 0; i < 6; i++) labels.push((await header(i).innerText()).trim());
      ok("H2", "after inserting a column the headers still read A B C D E F in order", labels.join("") === "ABCDEF", `labels=${labels.join(",")}`);
    });
  }

  // ═══════════════ S — SHORTCUTS ═══════════════
  if (wants("S")) {
    await reset(); await open();
    await tryCheck("S1", "Ctrl+B over a range bolds all of it in ONE undo step", async () => {
      await put(0, 0, "a"); await put(1, 0, "b"); await put(0, 1, "c");
      await select(0, 0, 1, 1);
      await page.keyboard.press("Control+b");
      const on = [await fontWeight(0, 0), await fontWeight(1, 1)];
      await page.keyboard.press("Control+z");
      const off = [await fontWeight(0, 0), await fontWeight(1, 1)];
      ok("S1", "Ctrl+B bolds the whole range; ONE Ctrl+Z reverts all of it", on.every((w) => Number(w) >= 600) && off.every((w) => Number(w) < 600), `on=${on} off=${off}`);
    });
    await tryCheck("S2", "Ctrl+Shift+$ / % / ! / ~ number-format chords", async () => {
      await put(3, 0, "1234.5");
      await at(3, 0);
      await page.keyboard.press("Control+Shift+$");
      const cur = await display(3, 0);
      await page.keyboard.press("Control+Shift+%");
      const pct = await display(3, 0);
      await page.keyboard.press("Control+Shift+!");
      const comma = await display(3, 0);
      await page.keyboard.press("Control+Shift+~");
      const gen = await display(3, 0);
      ok("S2", "currency, percent, comma, general chords reformat the cell", cur.startsWith("$") && pct.includes("%") && comma === "1,234.50" || false, `cur='${cur}' pct='${pct}' comma='${comma}' general='${gen}'`);
    });
    await tryCheck("S3", "Ctrl+1 opens the number format dialog and applies", async () => {
      await put(4, 0, "0.25");
      await at(4, 0);
      await page.keyboard.press("Control+1");
      const dlg = page.getByTestId("model-shortcut-dialog");
      await dlg.waitFor({ timeout: 3000 });
      await dlg.locator("select").selectOption({ label: "Percent" });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);
      const shown = await display(4, 0);
      ok("S3", "Ctrl+1 -> pick Percent -> Enter formats the cell as a percentage", shown.includes("%"), `shown='${shown}'`);
    });
    await tryCheck("S4", "Ctrl+; enters today's date", async () => {
      await at(5, 0);
      await page.keyboard.press("Control+;");
      const shown = await display(5, 0);
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, "0"), dd = String(now.getDate()).padStart(2, "0");
      ok("S4", "Ctrl+; puts today's date in the cell", shown.includes(String(now.getFullYear())) && shown.includes(mm) && shown.includes(dd), `shown='${shown}'`);
    });
    await tryCheck("S5", "Alt+= sums the numbers above", async () => {
      await put(7, 2, "10"); await put(8, 2, "20"); await put(9, 2, "30");
      await at(10, 2);
      await page.keyboard.press("Alt+=");
      const v = await display(10, 2);
      ok("S5", "Alt+= under 10,20,30 gives 60", v === "60", `value='${v}'`);
    });
    await tryCheck("S6", "Ctrl+9 / Ctrl+Shift+9 hide and unhide rows; Ctrl+0 hides columns", async () => {
      await put(12, 0, "r12"); await put(13, 0, "r13"); await put(14, 0, "r14");
      const h0 = await rowHeight(13);
      await at(13, 0);
      await page.keyboard.press("Control+9");
      const hHidden = await rowHeight(13);
      await page.keyboard.press("Control+Shift+(");
      const hBack = await rowHeight(13);
      const cols0 = await page.locator('[data-testid^="model-col-header-"]').count();
      await at(0, 3);
      await page.keyboard.press("Control+0");
      const cols1 = await page.locator('[data-testid^="model-col-header-"]').count();
      ok("S6", "Ctrl+9 collapses the row, Ctrl+Shift+9 brings it back, Ctrl+0 hides a column", h0 > 10 && hHidden === 0 && hBack > 10 && cols1 === cols0 - 1, `h0=${h0} hidden=${hHidden} back=${hBack} cols ${cols0}->${cols1}`);
      await page.keyboard.press("Control+Shift+)");
    });
    await tryCheck("S7", "Shift+Space, Ctrl+Space, Ctrl+A (twice)", async () => {
      await at(2, 2);
      await page.keyboard.press("Shift+Space");
      const row = await nameBox();
      await page.keyboard.press("Control+Space");
      const rowThenCol = await nameBox(); // Excel: a row, then Ctrl+Space = the whole sheet
      await at(2, 2);
      await page.keyboard.press("Control+Space");
      const col = await nameBox();
      await page.keyboard.press("Control+a");
      const first = await nameBox();
      await page.keyboard.press("Control+a");
      const second = await nameBox();
      ok("S7", "Shift+Space = row 3:3, then Ctrl+Space = whole sheet, Ctrl+Space alone = column C:C, Ctrl+A twice = whole sheet", row === "3:3" && /^A:[A-Z]+$/.test(rowThenCol) && col === "C:C" && /^A:[A-Z]+$/.test(second), `row='${row}' rowThenCol='${rowThenCol}' col='${col}' first='${first}' second='${second}'`);
    });
    await tryCheck("S8", "Ctrl+Shift+= with a whole row selected inserts a row", async () => {
      await put(20, 0, "marker");
      await rowHeader(19).click();
      await page.keyboard.press("Control+Shift+=");
      await page.waitForTimeout(120);
      const moved = await display(21, 0);
      ok("S8", "inserting at row 20 pushes 'marker' down one row", moved === "marker", `row22='${moved}'`);
      await rowHeader(19).click();
      await page.keyboard.press("Control+-");
      await page.waitForTimeout(120);
      ok("S8b", "Ctrl+- on a whole row deletes it again", (await display(20, 0)) === "marker", `row21='${await display(20, 0)}'`);
    });
    await tryCheck("S9", "F4 repeats the last action; F4 in a formula cycles $A$1 / A$1 / $A1 / A1", async () => {
      await put(24, 0, "p"); await put(25, 0, "q");
      await at(24, 0);
      await page.keyboard.press("Control+b");
      await at(25, 0);
      await page.keyboard.press("F4");
      const rep = await fontWeight(25, 0);
      await at(26, 0);
      await page.keyboard.type("=A1+B2");
      await page.keyboard.press("F4");
      const inEditor = await page.locator("[data-cell-editor]").inputValue();
      await page.keyboard.press("Escape");
      ok("S9", "F4 re-applies bold to the next cell; in an open formula F4 turns the reference at the caret into $B$2", Number(rep) >= 600 && inEditor === "=A1+$B$2", `weight=${rep} editor='${inEditor}'`);
    });
    await tryCheck("S10", "Alt+Enter makes a new line in the cell and the row grows", async () => {
      await at(28, 0);
      await page.keyboard.type("line1");
      await page.keyboard.press("Alt+Enter");
      await page.keyboard.type("line2");
      await page.keyboard.press("Enter");
      const txt = await cell(28, 0).innerText();
      const h = await rowHeight(28);
      ok("S10", "Alt+Enter inside the editor adds a line break; the committed cell shows two lines and the row is taller", /line1\s*\n?\s*line2/.test(txt) && h > 28, `text='${txt.replace(/\n/g, "\\n")}' rowH=${h}`);
    });
    await tryCheck("S12", "Ctrl+R fills right; Ctrl+Enter fills the selection", async () => {
      await put(30, 0, "fill");
      await select(30, 0, 30, 2);
      await page.keyboard.press("Control+r");
      const right = [await display(30, 1), await display(30, 2)];
      await select(32, 0, 33, 1);
      await page.keyboard.press("F2");
      await page.keyboard.type("z");
      await page.keyboard.press("Control+Enter");
      const sel = [await display(32, 0), await display(33, 1)];
      ok("S12", "Ctrl+R copies the left cell across; Ctrl+Enter writes the typed entry into every selected cell", right.every((t) => t === "fill") && sel.every((t) => t === "z"), `right=${right} sel=${sel}`);
    });
    await tryCheck("S11", "Ctrl+PageUp / Ctrl+PageDown move between sheet tabs", async () => {
      await page.keyboard.press("Control+Home"); // earlier checks scrolled the virtualised grid down
      await page.waitForTimeout(150);
      await put(0, 0, "on-sheet-1");
      await page.getByTestId("model-add-sheet").click();
      await page.waitForTimeout(150);
      const onNew = await display(0, 0);
      await page.keyboard.press("Control+PageUp");
      await page.waitForTimeout(150);
      const back = await display(0, 0);
      await page.keyboard.press("Control+PageDown");
      await page.waitForTimeout(150);
      const fwd = await display(0, 0);
      ok("S11", "after adding a sheet: Ctrl+PgUp shows the first sheet's A1, Ctrl+PgDn the new blank one", onNew === "" && back === "on-sheet-1" && fwd === "", `new='${onNew}' pgup='${back}' pgdn='${fwd}'`);
    });
  }

  // ═══════════════ K — KEY TIPS ═══════════════
  if (wants("K")) {
    await reset(); await open();
    await tryCheck("K1", "Alt H O I autofits the column", async () => {
      await put(0, 0, "a very long value that needs a wider column than the default");
      const w0 = await colWidth(0);
      await at(0, 0);
      await page.keyboard.press("Alt");
      await page.getByTestId("model-keytip-panel").waitFor({ timeout: 2000 });
      await page.keyboard.press("h"); await page.keyboard.press("o"); await page.keyboard.press("i");
      await page.waitForTimeout(150);
      const w1 = await colWidth(0);
      const gone = (await page.getByTestId("model-keytip-panel").count()) === 0;
      ok("K1", "Alt, H, O, I widens the column to fit and closes the key-tip strip", w1 > w0 + 40 && gone, `w ${w0}->${w1} panelGone=${gone}`);
    });
    await tryCheck("K2", "Alt H O A grows a wrapped row", async () => {
      await put(2, 1, "wrap me please because this text is quite a bit longer than the column is wide");
      await at(2, 1);
      await page.keyboard.press("Alt"); await page.keyboard.press("h"); await page.keyboard.press("w");
      const h0 = await rowHeight(2);
      await page.keyboard.press("Alt"); await page.keyboard.press("h"); await page.keyboard.press("o"); await page.keyboard.press("a");
      await page.waitForTimeout(150);
      const h1 = await rowHeight(2);
      ok("K2", "Alt H W wraps, Alt H O A grows the row to show all the wrapped lines", h1 > h0 + 10, `h ${h0}->${h1}`);
    });
    await tryCheck("K3", "Escape backs out one level; an unknown letter and a click cancel", async () => {
      await at(0, 0);
      await page.keyboard.press("Alt"); await page.keyboard.press("h"); await page.keyboard.press("o");
      const atO = await page.getByTestId("model-keytip-panel").innerText();
      await page.keyboard.press("Escape");
      const up = await page.getByTestId("model-keytip-panel").innerText();
      await page.keyboard.press("q");
      const cancelled = (await page.getByTestId("model-keytip-panel").count()) === 0;
      await page.keyboard.press("Alt"); await page.keyboard.press("h");
      await at(3, 3);
      const clickCancelled = (await page.getByTestId("model-keytip-panel").count()) === 0;
      ok("K3", "Alt H O shows the Format choices, Esc steps back to Home, an unknown key cancels, a click cancels", /Autofit column/.test(atO) && /Format|Alignment/.test(up) && !/Autofit column/.test(up) && cancelled && clickCancelled, `at='${atO.replace(/\n/g, " ").slice(0, 60)}' up='${up.replace(/\n/g, " ").slice(0, 60)}' cancelled=${cancelled} click=${clickCancelled}`);
    });
    await tryCheck("K4", "plain Alt+Enter and Alt+click do not open the sequence", async () => {
      await at(5, 5);
      await page.keyboard.type("x");
      await page.keyboard.press("Alt+Enter");
      await page.keyboard.press("Escape");
      const afterEnter = await page.getByTestId("model-keytip-panel").count();
      await at(6, 6, { modifiers: ["Alt"] });
      const afterClick = await page.getByTestId("model-keytip-panel").count();
      ok("K4", "Alt+Enter (in the editor) and Alt+click leave the key tips closed", afterEnter === 0 && afterClick === 0, `afterEnter=${afterEnter} afterClick=${afterClick}`);
    });
    await tryCheck("K5", "Alt H B A all borders; Alt H A C centre", async () => {
      await put(8, 0, "m"); await put(8, 1, "n");
      await select(8, 0, 8, 1);
      await page.keyboard.press("Alt"); await page.keyboard.press("h"); await page.keyboard.press("b"); await page.keyboard.press("a");
      const border = await cell(8, 0).evaluate((el) => getComputedStyle(el).borderTopWidth);
      await page.keyboard.press("Alt"); await page.keyboard.press("h"); await page.keyboard.press("a"); await page.keyboard.press("c");
      const justify = await cell(8, 0).evaluate((el) => getComputedStyle(el).justifyContent);
      ok("K5", "Alt H B A draws borders; Alt H A C centres", parseFloat(border) >= 1 && justify === "center", `borderTop=${border} justify=${justify}`);
    });
    await tryCheck("K6", "Alt H O W opens the column width dialog", async () => {
      await at(0, 4);
      await page.keyboard.press("Alt"); await page.keyboard.press("h"); await page.keyboard.press("o"); await page.keyboard.press("w");
      const dlg = page.getByTestId("model-shortcut-dialog");
      await dlg.waitFor({ timeout: 3000 });
      await dlg.locator("input").fill("200");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);
      const w = await colWidth(4);
      ok("K6", "Alt H O W -> 200 -> Enter sets the column to that width", Math.abs(w - 200) < 3, `width=${w}`);
    });
  }

  // ═══════════════ C — CLIPBOARD ═══════════════
  if (wants("C")) {
    await reset(); await open();
    await tryCheck("C1", "Ctrl+C writes TSV text/plain and styled text/html with the Planyr marker to the SYSTEM clipboard", async () => {
      await put(0, 0, "Item"); await put(0, 1, "100"); await put(1, 0, "Total"); await put(1, 1, "=B1*2");
      await select(0, 0, 0, 1);
      await page.keyboard.press("Control+b");
      await select(0, 0, 1, 1);
      await page.keyboard.press("Control+c");
      const clip = await clipRead();
      ok("C1", "the OS clipboard holds text/plain TSV and text/html (a table with bold + the Planyr marker)", clip.text === "Item\t100\nTotal\t200" && /<table/.test(clip.html) && /font-weight:700/.test(clip.html) && /data-planyr-clip=/.test(clip.html), `text='${clip.text.replace(/\n/g, "\\n").replace(/\t/g, "→")}' types=${clip.types}`);
      ok("C1b", "Escape-able dashed outline is drawn around the copied range", (await page.getByTestId("model-cut-outline").count()) === 1);
    });
    await tryCheck("C2", "Ctrl+V inside Planyr keeps values, shifted formulas and bold", async () => {
      await at(4, 0);
      await page.keyboard.press("Control+v");
      await page.waitForTimeout(150);
      const got = [await display(4, 0), await display(4, 1), await display(5, 0), await display(5, 1)];
      const bold = await fontWeight(4, 0);
      ok("C2", "pasting at A5 reproduces the block; =B1*2 became =B5*2 (200); the bold came along", got.join("|") === "Item|100|Total|200" && Number(bold) >= 600, `got=${got.join("|")} bold=${bold}`);
    });
    await tryCheck("C3", "pasting a captured Excel fragment keeps values, formula, fill, bold, number format and the merge", async () => {
      await clipWrite(FIXTURE, "Item\tCost\tShare\nLand & site\t$1,234.50\t25.00%");
      await at(10, 0);
      await page.keyboard.press("Control+v");
      await page.waitForTimeout(200);
      const vals = [await display(10, 0), await display(11, 1), await display(11, 2)];
      await at(30, 5); // move the selection off the pasted block so its tint doesn't mask the fill
      const fill = await bg(10, 0);
      const boldTotal = await fontWeight(13, 0);
      const merged = await page.locator('[data-row="14"][data-merged="true"]').count();
      await at(13, 1);
      const formula = await page.getByTestId("model-formula-bar").inputValue();
      ok("C3", "Excel's HTML pastes as cells: header bold on yellow, $1,234.50, 25.00%, the formula text, merged last row", vals[0] === "Item" && vals[1] === "$1,234.50" && vals[2] === "25.00%" && formula === "=SUM(B2:B3)" && fill === "rgb(255, 255, 0)" && Number(boldTotal) >= 600 && merged >= 1, `vals=${vals.join("|")} fill=${fill} boldTotal=${boldTotal} merged=${merged} formula='${formula}'`);
    });
    await tryCheck("C4", "a plain text line with commas pastes into ONE cell", async () => {
      await clipWrite(null, "alpha, beta, gamma");
      await at(18, 0);
      await page.keyboard.press("Control+v");
      await page.waitForTimeout(120);
      ok("C4", "no comma splitting: one cell holds 'alpha, beta, gamma' and its neighbour stays empty", (await display(18, 0)) === "alpha, beta, gamma" && (await display(18, 1)) === "", `a='${await display(18, 0)}' b='${await display(18, 1)}'`);
    });
    await tryCheck("C5", "a tab/newline block lands in a grid; a single value fills the whole selection", async () => {
      await clipWrite(null, "1\t2\n3\t4");
      await at(20, 0);
      await page.keyboard.press("Control+v");
      const block = [await display(20, 0), await display(20, 1), await display(21, 0), await display(21, 1)];
      await clipWrite(null, "9");
      await select(24, 0, 25, 1);
      await page.keyboard.press("Control+v");
      const filled = [await display(24, 0), await display(24, 1), await display(25, 0), await display(25, 1)];
      ok("C5", "TSV -> 2x2 block; single value -> every selected cell", block.join(",") === "1,2,3,4" && filled.every((v) => v === "9"), `block=${block} filled=${filled}`);
    });
    await tryCheck("C6", "Ctrl+X then Ctrl+V MOVES the cells; the formula pointing at them follows", async () => {
      await put(28, 0, "5"); await put(28, 1, "=A29*10");
      await put(30, 3, "=A29+1");
      await at(28, 0);
      await page.keyboard.press("Control+x");
      const stillThere = await display(28, 0);
      const outline = await page.getByTestId("model-cut-outline").count();
      await at(34, 0);
      await page.keyboard.press("Control+v");
      await page.waitForTimeout(150);
      const moved = [await display(28, 0), await display(34, 0), await display(28, 1), await display(30, 3)];
      await page.keyboard.press("Control+z");
      const undone = [await display(28, 0), await display(34, 0)];
      ok("C6", "cut leaves the source until paste; paste moves it; =A29*10 and =A29+1 now read the new home (50, 6); ONE undo restores both", stillThere === "5" && outline === 1 && moved.join("|") === "|5|50|6" && undone.join("|") === "5|", `stillThere=${stillThere} outline=${outline} moved=${moved.join("|")} undone=${undone.join("|")}`);
    });
    await tryCheck("C7", "Escape drops the outline and cancels the cut", async () => {
      await page.keyboard.press("Control+Home");
      await page.waitForTimeout(150);
      await at(0, 0);
      await page.keyboard.press("Control+c");
      const had = await page.getByTestId("model-cut-outline").count();
      await page.keyboard.press("Escape");
      const gone = await page.getByTestId("model-cut-outline").count();
      ok("C7", "Escape removes the copied-range outline", had === 1 && gone === 0, `had=${had} gone=${gone}`);
    });
    await tryCheck("C8", "paste inside the cell editor stays a native text paste", async () => {
      await clipWrite(null, "pasted-into-editor");
      await at(40, 0);
      await page.keyboard.press("F2");
      await page.keyboard.press("Control+v");
      const inEditor = await page.locator("[data-cell-editor]").inputValue();
      await page.keyboard.press("Escape");
      ok("C8", "with a cell open for editing, Ctrl+V pastes the text into the editor (not a grid paste)", inEditor.includes("pasted-into-editor") && (await display(41, 0)) === "", `editor='${inEditor}'`);
    });
    await tryCheck("C9", "pasting when nothing usable is on the clipboard says so", async () => {
      await page.evaluate(async () => { await navigator.clipboard.writeText(""); });
      await at(42, 0);
      await page.keyboard.press("Control+v");
      await page.getByTestId("model-notice").waitFor({ timeout: 2000 });
      ok("C9", "an empty paste shows a visible message instead of silently doing nothing", /Nothing to paste/.test(await page.getByTestId("model-notice").innerText()));
    });
    await tryCheck("C10", "the copy survives a reload", async () => {
      await page.keyboard.press("Control+Home");
      await page.waitForTimeout(150);
      await at(0, 0);
      await page.keyboard.press("Control+c");
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector('[data-testid="model-sheet"]');
      await page.waitForTimeout(600);
      await at(50, 0);
      await page.keyboard.press("Control+v");
      await page.waitForTimeout(150);
      ok("C10", "after a reload Ctrl+V still pastes what was copied (the OS clipboard, not a React ref)", (await display(50, 0)) === "Item", `got='${await display(50, 0)}'`);
    });
    await tryCheck("C11", "hidden rows are skipped when copying", async () => {
      await at(50, 0);
      for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown"); // bring rows 60+ into the virtualised window
      await page.waitForTimeout(150);
      await put(60, 0, "a"); await put(61, 0, "b"); await put(62, 0, "c");
      await at(61, 0);
      await page.keyboard.press("Control+9");
      await select(60, 0, 62, 0);
      await page.keyboard.press("Control+c");
      const clip = await clipRead();
      ok("C11", "copying a, [hidden b], c puts only a and c on the clipboard", clip.text === "a\nc", `text='${clip.text.replace(/\n/g, "\\n")}'`);
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
