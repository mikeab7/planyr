/* e2e helpers for the Spreadsheet's UNIVER grid — the grid every account gets since the default-on cutover (NEW-2, 2026-10-31).
 *
 * WHY THIS FILE EXISTS. The old grid was DOM: every cell was a `[data-row][data-col]` node a spec could click and read. Univer
 * draws a CANVAS — there is nothing to query — so a spec drives it the way a person does (REAL mouse + keyboard at a cell's computed
 * point) and READS state through Univer's own facade, handed out by `window.__planyrUniverRead`. That handle answers ONLY when
 * `window.__PLANYR_E2E === true` (set before the page loads by `armUniverE2E`), so no production page exposes it.
 *
 * Same pattern as ui-audit/verify-univer-parity.mjs (which runs the checklist against a standalone host); this file is the
 * Playwright-test flavour for specs that run against the real app.
 *
 * RULES THE HELPERS ENFORCE (each was paid for in this repo — docs/AGENT-RULES.md):
 *   · SYNTHETIC-KEYS-DONT-EDIT — keys go through `page.keyboard` (real input), never a dispatched KeyboardEvent.
 *   · A click is followed by a short settle: Univer hands focus to its cell editor asynchronously, so typing in the same
 *     millisecond as the click loses the first character on a real machine too.
 *   · Read the value a PERSON sees: an edited existing cell is rich text in Univer (no plain `v`), so fall back to the shown text.
 *   · Empty never means zero: `value()` returns null for an empty cell, not 0 / "".
 */
import { expect } from "@playwright/test";

export const CANVAS = 'canvas[id^="univer-sheet-main-canvas"]';

/** Must run BEFORE the first navigation: arms the read-only facade handle for this page. */
export async function armUniverE2E(page) {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
}

/** A throwaway local project (a Site Planner site group — a project IS one) the Spreadsheet can attach to. Local storage only. */
export async function seedProject(page, id, name = "ZZ Model e2e (throwaway)") {
  const site = {
    id, groupId: id, site: name, name,
    origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([siteId, rec]) => {
    const KEY = "planarfit:sites:v1";
    let cur = {};
    try { cur = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (_) { /* start clean */ }
    cur[siteId] = rec;
    localStorage.setItem(KEY, JSON.stringify(cur));
  }, [id, site]);
}

/** Wait until the Univer grid is mounted AND holds a workbook (the canvas exists, the facade answers, a sheet is active). */
export async function waitForGrid(page, { timeout = 60_000 } = {}) {
  await page.waitForSelector(CANVAS, { timeout });
  await page.waitForFunction(() => {
    const h = window.__planyrUniverRead;
    const api = h && h.api && h.api();
    const wb = api && api.getActiveWorkbook && api.getActiveWorkbook();
    return !!(wb && wb.getActiveSheet && wb.getActiveSheet());
  }, null, { timeout });
  await page.waitForTimeout(500); // Univer paints ~300 ms after it is ready; a click before that lands on nothing
}

/** Open the Spreadsheet on a seeded project and wait for the grid. `slug` = "model" (legacy) or "spreadsheet". */
export async function openSpreadsheet(page, siteId, { slug = "spreadsheet", name } = {}) {
  await armUniverE2E(page);
  await seedProject(page, siteId, name);
  await page.goto(`/#/project/${siteId}/${slug}`);
  await waitForGrid(page);
}

/** Run `body(api, ws, arg)` in the page against the ACTIVE sheet and return its (serialisable) result. */
export function inSheet(page, body, arg) {
  return page.evaluate(`((arg) => { const api = window.__planyrUniverRead.api(); const ws = api.getActiveWorkbook().getActiveSheet(); return (${body.toString()})(api, ws, arg); })(${JSON.stringify(arg ?? null)})`);
}

/** Page point of a cell: its centre plus edges, from Univer's own geometry and the canvas origin. */
export const cellPoint = (page, r, c) => inSheet(page, (api, ws, [rr, cc]) => {
  const rect = ws.getRange(rr, cc).getCellRect();
  const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect();
  const o = typeof rect === "string" ? JSON.parse(rect) : rect;
  return { x: cv.left + o.x + o.width / 2, y: cv.top + o.y + o.height / 2, left: cv.left + o.x, top: cv.top + o.y, w: o.width, h: o.height, right: cv.left + o.x + o.width, bottom: cv.top + o.y + o.height };
}, [r, c]);

export const canvasBox = (page) => page.evaluate(() => {
  const b = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect();
  return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height };
});

/** Centre of a column header / row header (the strip above / left of the cells). */
export async function columnHeaderPoint(page, c) { const p = await cellPoint(page, 0, c); const cv = await canvasBox(page); return { x: p.x, y: cv.top + 10 }; }
export async function rowHeaderPoint(page, r) { const p = await cellPoint(page, r, 0); const cv = await canvasBox(page); return { x: cv.left + 20, y: p.y }; }

const settle = (page, ms = 160) => page.waitForTimeout(ms);

export async function clickCell(page, r, c, opts = {}) { const p = await cellPoint(page, r, c); await page.mouse.click(p.x, p.y, opts); await settle(page); }
export async function dblclickCell(page, r, c) { const p = await cellPoint(page, r, c); await page.mouse.dblclick(p.x, p.y); await settle(page, 250); }
export async function rightClickCell(page, r, c) { const p = await cellPoint(page, r, c); await page.mouse.click(p.x, p.y, { button: "right" }); await settle(page, 250); }

/** Type text with real keys and (by default) press Enter. */
export async function typeText(page, text, { enter = true } = {}) {
  await page.keyboard.type(text, { delay: 8 });
  if (enter) await page.keyboard.press("Enter");
  await settle(page, 150);
}
/** Select a cell and type a value into it (the common one-liner). */
export async function enter(page, r, c, text, opts) { await clickCell(page, r, c); await typeText(page, text, opts); }
export async function press(page, key) { await page.keyboard.press(key); await settle(page, 180); }

/** The value a person sees (null for an empty cell). A formula returns its computed result. */
export const value = (page, r, c) => inSheet(page, (api, ws, [rr, cc]) => {
  const g = ws.getRange(rr, cc);
  const v = g.getValue();
  if (v !== null && v !== undefined && v !== "") return v;
  const d = g.getDisplayValue();
  return d === "" || d === undefined ? null : d;
}, [r, c]);
/** What the cell SHOWS (formatted text, e.g. "$1,200.00" / "#REF!"). */
export const shown = (page, r, c) => inSheet(page, (api, ws, [rr, cc]) => { const d = ws.getRange(rr, cc).getDisplayValue(); return d === undefined ? "" : String(d); }, [r, c]);
/** The formula text (e.g. "=A1+A2") or null for a literal / empty cell. */
export const formulaOf = (page, r, c) => inSheet(page, (api, ws, [rr, cc]) => ws.getRange(rr, cc).getFormula() || null, [r, c]);
/** Style facts for a cell. */
export const styleOf = (page, r, c) => inSheet(page, (api, ws, [rr, cc]) => {
  const x = ws.getRange(rr, cc); const cs = x.getCellStyle(); const st = (cs && cs._style) || {};
  return { bold: st.bl === 1, italic: st.it === 1, underline: !!(st.ul && st.ul.s === 1), strike: !!(st.st && st.st.s === 1), nf: x.getNumberFormat(), wrap: x.getWrap(), bg: (st.bg && st.bg.rgb) || null, color: (st.cl && st.cl.rgb) || null, ht: st.ht ?? null, pd: st.pd || null };
}, [r, c]);

/** Active selection(s) as plain ranges. */
export const selection = (page) => inSheet(page, (api, ws) => ws.getSelection().getActiveRangeList().map((x) => { const g = x.getRange(); return { a1: x.getA1Notation(), r1: g.startRow, r2: g.endRow, c1: g.startColumn, c2: g.endColumn, type: g.rangeType }; }));
/** The active (cursor) cell as [row, col], or null. */
export const activeCell = (page) => inSheet(page, (api, ws) => { const a = ws.getSelection().getCurrentCell(); return a ? [a.actualRow, a.actualColumn] : null; });

/** Sheet tabs, in order, with which is active. */
export const sheetNames = (page) => page.evaluate(() => { const wb = window.__planyrUniverRead.api().getActiveWorkbook(); const act = wb.getActiveSheet().getSheetId(); return wb.getSheets().map((s) => ({ name: s.getSheetName(), id: s.getSheetId(), active: s.getSheetId() === act })); });

/** Ask the grid to hand its pending edits to ModelApp NOW (the debounce is 300 ms) and let the write-through land. */
export async function flushGrid(page) { await page.evaluate(() => window.__planyrUniverRead.flush()); await page.waitForTimeout(250); }

/** Assert a cell's value with a clear message (reads through the facade, retries until the debounce/recalc settles). */
export async function expectValue(page, r, c, expected, msg) {
  await expect.poll(() => value(page, r, c), { message: msg || `cell (${r},${c})`, timeout: 8000 }).toEqual(expected);
}
export async function expectShown(page, r, c, expected, msg) {
  await expect.poll(() => shown(page, r, c), { message: msg || `shown (${r},${c})`, timeout: 8000 }).toEqual(expected);
}

/** Open a Univer toolbar/ribbon button by its visible label (e.g. "Bold"). Univer buttons carry an aria-label / tooltip text. */
export async function clickToolbar(page, label) {
  const btn = page.locator(`[data-u-comp="headerbar"], header, [class*="univer"]`).locator(`[aria-label="${label}"], [title="${label}"]`).first();
  await btn.click();
  await settle(page, 200);
}

/* ---- NEW-2 additions (audit tools / palette / file I/O specs) — ADD-ONLY ---------------------------------------------------------- */

/** The Planyr tools controller (window.__planyrUniverRead.tools()) — run `body(tools, arg)` in the page and return its serialisable result. */
export function toolsState(page, body, arg) {
  return page.evaluate(`((arg) => { const t = window.__planyrUniverRead.tools(); return (${body.toString()})(t, arg); })(${JSON.stringify(arg ?? null)})`);
}

/** Bring the Formulas tab (where the Planyr tools sit) into Univer's one header strip. A no-op when it is already showing. */
export async function showFormulasTab(page) {
  const seen = () => page.evaluate(() => [...document.querySelectorAll('[data-u-command="planyr.tools.trace-precedents"]')].some((e) => e.getBoundingClientRect().width > 0));
  if (await seen()) return;
  await page.click('[data-u-comp="headerbar"] a[data-state]'); await page.waitForTimeout(350);
  await page.getByText("Formulas", { exact: true }).first().click(); await page.waitForTimeout(600);
}
/** Click one of the Planyr tool buttons on the real toolbar (`trace-precedents`, `trace-dependents`, `trace-clear`, `toggle-inconsistencies`, `toggle-name-manager`, `toggle-autocolor`...). */
export async function clickPlanyrTool(page, id) {
  await showFormulasTab(page);
  await page.locator(`[data-u-command="planyr.tools.${id}"]`).first().click();
  await page.waitForTimeout(450);
}
/** How many pixels inside `clip` ({x,y,width,height}) satisfy `test` — a boolean expression of r, g, b — read off the page's own screenshot. */
export async function countPixels(page, clip, test) {
  const buf = await page.screenshot({ clip });
  return page.evaluate(async ({ b64, src }) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; const f = new Function("r", "g", "b", `return ${src};`); let n = 0;
    for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) n++;
    return n;
  }, { b64: buf.toString("base64"), src: test });
}
/** Pixel tests used by the tools' canvas drawing (same colours the ui-audit parity checks use). */
export const PIXEL = {
  ORANGE: "r > 150 && g < 140 && b < 90 && r - b > 80",   // the inconsistency corner marker
  ARROW: "b > 150 && b - r > 80 && g < 170",              // the trace arrow
};
/** The top-left 11 px of a cell, where the inconsistency marker is drawn. */
export const cornerClip = async (page, r, c) => { const p = await cellPoint(page, r, c); return { x: p.left + 1, y: p.top + 1, width: 11, height: 11 }; };
/** The page rectangle spanning cells (r1,c1)..(r2,c2). */
export const gridClip = async (page, r1, c1, r2, c2) => { const a = await cellPoint(page, r1, c1), b = await cellPoint(page, r2, c2); return { x: a.left, y: a.top, width: b.right - a.left, height: b.bottom - a.top }; };

/** Open the command palette with a REAL Ctrl+K from the grid. */
export async function openPalette(page) {
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("model-command-palette-input")).toBeVisible();
  await expect(page.getByTestId("model-command-palette-input"), "the palette input has focus, so a person's next keystrokes land in it").toBeFocused();
}
/** Open the palette, type `query`, press Enter — exactly how a person drives it. */
export async function runPaletteCommand(page, query) {
  await openPalette(page);
  await page.keyboard.type(query, { delay: 12 });
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("model-command-palette-input"), "the palette closes the moment a command runs").toHaveCount(0);
  await page.waitForTimeout(450);
}
/** Define a workbook name over the CURRENT selection through the Name Manager (opened from the palette), then close the panel. */
export async function defineNameFromSelection(page, name) {
  await runPaletteCommand(page, "Name Manager");
  await page.getByTestId("name-manager-new-input").fill(name);
  await page.getByTestId("name-manager-create").click();
  await page.waitForTimeout(500);
  await page.getByTestId("name-manager").getByTitle("Close (Esc)").click();
  await page.waitForTimeout(200);
}
/** The workbook's defined names as Univer holds them: [{ name, ref }]. */
export const definedNames = (page) => page.evaluate(() => {
  const r = (window.__planyrUniverRead.api().getActiveWorkbook().save().resources || []).find((x) => x.name === "SHEET_DEFINED_NAME_PLUGIN");
  return r ? Object.values(JSON.parse(r.data)).map((d) => ({ name: d.name, ref: d.formulaOrRefString })) : [];
});

/* ---- NEW-2 additions (clear-cell / indent / drag / multi-range / editor specs) — ADD-ONLY ---------------------------------------- */

/** Click a Univer toolbar button by its command id (`planyr.sheet.command.increase-indent`, `sheet.command.set-range-bold`…). The toolbar
 *  keeps a hidden 0×0 measuring copy of every item, so the VISIBLE one is picked. THROWS if there is none (never a silent no-op). */
export async function clickUniverCommand(page, cmd) {
  const box = await page.locator(`[data-u-command="${cmd}"]`).evaluateAll((els) => { for (const e of els) { const r = e.getBoundingClientRect(); if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; } return null; });
  if (!box) throw new Error(`clickUniverCommand: no visible toolbar button for ${cmd}`);
  await page.mouse.click(box.x, box.y); await settle(page, 250);
}
/** Park the cursor on a far-away cell so its outline can never touch the cells under measurement. */
export const parkCursor = (page, r = 20, c = 8) => clickCell(page, r, c);

const _decode = (page, buf, fn) => page.evaluate(async ([b64, src]) => {
  const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  return new Function("d", "w", "h", `return (${src})(d, w, h);`)(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
}, [buf.toString("base64"), fn.toString()]);
/** PNG of one cell's interior (2 px inset: no grid line, no selection outline when the cursor is parked elsewhere). */
export async function cellShot(page, r, c) {
  const p = await cellPoint(page, r, c);
  const buf = await page.screenshot({ clip: { x: p.left + 2, y: p.top + 2, width: Math.max(4, p.w - 4), height: Math.max(4, p.h - 4) } });
  return { buf, left: p.left + 2, top: p.top + 2, w: Math.max(4, p.w - 4) };
}
/** The painted text ink of a cell: absolute page-x of its left / right-most DARK pixel and the dark-pixel count (-1 / 0 for an empty cell). */
export async function cellInk(page, r, c) {
  const s = await cellShot(page, r, c);
  const e = await _decode(page, s.buf, (d, w, h) => { let left = -1, right = -1, dark = 0; for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { const i = (y * w + x) * 4; if (d[i] < 110 && d[i + 1] < 110 && d[i + 2] < 110) { dark++; if (left < 0) left = x; right = x; } } return { left, right, dark }; });
  return { left: e.left < 0 ? -1 : s.left + e.left, right: e.right < 0 ? -1 : s.left + e.right, dark: e.dark, buf: s.buf };
}
/** The active sheet's scroll state + the rows / columns currently on screen. `r1`/`c1` change only when the grid really scrolled. */
export const sheetView = (page) => inSheet(page, (api, ws) => { const v = ws.getVisibleRange(); const s = ws.getScrollState(); return { r1: v.startRow, r2: v.endRow, c1: v.startColumn, c2: v.endColumn, top: s.sheetViewStartRow, left: s.sheetViewStartColumn, offX: s.offsetX, offY: s.offsetY }; });
/** Scroll the grid so a cell is at its top-left (Univer's own scroll, not a driver scroll). */
export const scrollGridTo = (page, r, c) => inSheet(page, (api, ws, [rr, cc]) => { ws.scrollToCell(rr, cc); }, [r, c]);
/** Hold the mouse perfectly STILL for `ms` (a MessageChannel-free wait is fine: the page's own rAF drives Univer's autoscroll). */
export const holdStill = (page, ms) => page.waitForTimeout(ms);
/** The persisted workbook this device saved for a local (signed-out) project — what a reload would read back. */
export const storedWorkbook = (page, projectId) => page.evaluate((id) => { try { return JSON.parse(localStorage.getItem(`planyr:model:sheet:v1:local:${id}`)); } catch (_) { return null; } }, projectId);
/** The saved indent level of one cell of the first sheet (0 when none), read from the persisted workbook. */
export const storedIndent = async (page, projectId, r, c) => {
  const wb = await storedWorkbook(page, projectId); const sh = wb && wb.sheets && wb.sheets[0] && wb.sheets[0].sheet;
  const col = sh && sh.columns && sh.columns[c]; const st = sh && col && sh.styles && sh.styles[`${col.id}:${r}`];
  return st && st.indent ? st.indent : 0;
};
/** Widths of the first `n` columns, and every cell rect of one row — the geometry an indent / a clear must never change. */
export const rowGeometry = (page, r, n = 6) => inSheet(page, (api, ws, [rr, nn]) => { const out = []; for (let c = 0; c < nn; c++) { const rc = ws.getRange(rr, c).getCellRect(); const o = typeof rc === "string" ? JSON.parse(rc) : rc; out.push({ x: Math.round(o.x * 100) / 100, w: Math.round(o.width * 100) / 100, y: Math.round(o.y * 100) / 100, h: Math.round(o.height * 100) / 100, colW: ws.getColumnWidth(c) }); } return out; }, [r, n]);
/** The Univer facade's current selection's bottom-right "fill handle" point (page coords), from the active range's cell rect. */
export const fillHandlePoint = async (page, r, c) => { const p = await cellPoint(page, r, c); return { x: p.right - 1, y: p.bottom - 1 }; };
/** A click with a modifier key HELD (Shift / Control) — `page.mouse.click` takes no modifiers, so hold the real key around it. */
export async function modClickCell(page, r, c, key) { const p = await cellPoint(page, r, c); await page.keyboard.down(key); await page.mouse.click(p.x, p.y); await page.keyboard.up(key); await settle(page, 160); }
/** Open a Univer toolbar DROPDOWN (e.g. `sheet.command.set-horizontal-text-align`) and pick one option by its visible text ("center", "top"…). */
export async function chooseFromToolbarMenu(page, cmd, optionText) {
  const box = await page.locator(`[data-u-command="${cmd}"]`).evaluateAll((els) => { for (const e of els) { const r = e.getBoundingClientRect(); if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; } return null; });
  if (!box) throw new Error(`chooseFromToolbarMenu: no visible toolbar control for ${cmd}`);
  await page.mouse.click(box.x, box.y); await settle(page, 300);
  await page.getByText(optionText, { exact: true }).last().click(); await settle(page, 250);
}

/** Add a sheet with the real "+" at the end of Univer's sheet-tab strip; Univer activates the new sheet. Waits for the count to grow. */
export async function addSheetViaTab(page) {
  const before = (await sheetNames(page)).length;
  await page.locator('[data-u-comp="sheet-bar-append-button"]').first().click();
  await expect.poll(async () => (await sheetNames(page)).length, { message: "a new sheet appears" }).toBe(before + 1);
  await page.waitForTimeout(500);
}
/** Click a sheet's tab by its visible name (real click on Univer's tab strip). */
export async function clickSheetTab(page, name) {
  await page.locator('[data-u-comp="slide-tab-bar"], .univer-sheet-bar, body').first();
  await page.getByText(name, { exact: true }).last().click();
  await page.waitForTimeout(500);
}

/* ---- NEW-2 additions (model-spreadsheet / bare-letters / tab-switch / cell-editor-undo specs) — ADD-ONLY -------------------------- */

/** What the FORMULA BAR holds right now (its own editor document — a canvas, so it is read from Univer, not the DOM). A cell with a
 *  formula reads "=A1+A2" there, never its computed value. Trailing paragraph mark removed. */
export const formulaBarText = (page) => page.evaluate(() => {
  const d = window.__planyrUniverRead.api().getDocument("__INTERNAL_EDITOR__DOCS_FORMULA_BAR");
  return d ? String(d.getBody().dataStream).replace(/\r\n$/, "") : null;
});
/** The text currently IN FLIGHT in the in-cell editor (typed, not yet committed). "" when no edit is open. */
export const cellEditorText = (page) => page.evaluate(() => {
  const d = window.__planyrUniverRead.api().getDocument("__INTERNAL_EDITOR__DOCS_NORMAL");
  return d ? String(d.getBody().dataStream).replace(/\r\n$/, "") : null;
});
/** The Name Box (the address box left of the formula bar) — a real <input>. */
export const nameBoxInput = (page) => page.locator('[data-u-comp="defined-name"] input').first();
/** Click into the formula bar (its editor is a canvas; the first one in the strip is the visible one). */
export async function clickFormulaBar(page) { await page.locator('[data-u-comp="formula-editor"] canvas').first().click(); await settle(page, 300); }
/** Univer's sheet-tab strip: one locator per tab, in order. */
export const sheetTabs = (page) => page.locator('[data-u-comp="slide-tab-item"]');

/** Type a formula into a cell and commit it. A formula that ends in a name or bare function name (`=Site.Acres`, `=A1*TaxRate`) is committed
 *  by CLICKING another cell, because Univer's name / function hint popup owns Enter at that moment: measured, Enter there leaves the editor
 *  open and can REPLACE what was typed with another suggestion (`=Plan.Building2.SF` became `=Plan.Building1.SF`). Excel commits on Enter —
 *  that difference is reported in the specs, not hidden. Any other formula (ending in `)`, a digit, ...) is committed with Enter, as a person
 *  would. Returns "enter" or "click-away". `pause` = ms to wait before Enter (a human pauses; 0 types straight through). */
export async function enterFormula(page, r, c, text, { pause = 0, viaEnter = false } = {}) {
  await clickCell(page, r, c);
  await page.keyboard.type(text, { delay: 8 });
  const endsInName = /[A-Za-z_.][A-Za-z0-9_.]*$/.test(text) && !/\)$/.test(text);
  if (endsInName && !viaEnter) { await clickCell(page, 14, 9); await page.waitForTimeout(300); return "click-away"; }
  if (pause) await page.waitForTimeout(pause);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(450);
  if ((await formulaOf(page, r, c)) !== null) return "enter";
  await clickCell(page, 14, 9); await page.waitForTimeout(300);
  return "click-away";
}

/* ---- NEW-2 additions (scrolled-view clicking) — ADD-ONLY ------------------------------------------------------------------------- */

/** Page point of a cell in the view AS IT IS NOW (scrolled, with frozen rows / columns honoured). `cellPoint` is the cell's position on
 *  the UNSCROLLED sheet (Univer's `getCellRect` ignores the scroll), so after a scroll use this one. Valid at 100% zoom. The cell must be
 *  on screen — check `sheetView(page)` first. */
export const visiblePoint = (page, r, c) => inSheet(page, (api, ws, [rr, cc]) => {
  const rc = (a, b) => { const x = ws.getRange(a, b).getCellRect(); return typeof x === "string" ? JSON.parse(x) : x; };
  const st = ws.getScrollState(), fr = ws.getFrozenRows(), fc = ws.getFrozenColumns();
  const o = rc(rr, cc), origin = rc(0, 0), s0 = rc(st.sheetViewStartRow, st.sheetViewStartColumn);
  const frozenH = fr > 0 ? rc(fr, 0).y - origin.y : 0, frozenW = fc > 0 ? rc(0, fc).x - origin.x : 0;
  const y = rr < fr ? o.y : origin.y + frozenH + (o.y - s0.y) - st.offsetY;
  const x = cc < fc ? o.x : origin.x + frozenW + (o.x - s0.x) - st.offsetX;
  const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect();
  return { x: cv.left + x + o.width / 2, y: cv.top + y + o.height / 2, left: cv.left + x, top: cv.top + y, w: o.width, h: o.height, right: cv.left + x + o.width, bottom: cv.top + y + o.height };
}, [r, c]);
/** Click a cell that is on screen in the current scrolled view. */
export async function clickVisible(page, r, c, opts = {}) { const p = await visiblePoint(page, r, c); await page.mouse.click(p.x, p.y, opts); await settle(page); }
/** Header points for the current (scrolled) view: the strip above a column / left of a row. */
export async function visibleColumnHeader(page, c) { const p = await visiblePoint(page, 0, c); const cv = await canvasBox(page); return { x: p.x, y: cv.top + 10 }; }
export async function visibleRowHeader(page, r) { const p = await visiblePoint(page, r, 0); const cv = await canvasBox(page); return { x: cv.left + 20, y: p.y }; }
