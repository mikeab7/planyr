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
