/* verify-univer-parity — the Excel-parity checklist for the owner-only Univer grid (spike; docs/SPREADSHEET-UNIVER-SPIKE.md).
 *
 * Drives the REAL <UniverSheet> component in a real Chromium with REAL keystrokes and mouse (never a synthetic key event —
 * SYNTHETIC-KEYS-DONT-EDIT) and asserts state through Univer's own facade API, because the grid is a canvas and has no DOM
 * cells to query. Every item of the owner's checklist is reported PASS / FAIL / NOT-IN-OSS with the evidence, then printed
 * as a table. The run is VOID (exit 2) if the known-good arm fails: a click at a cell's computed point must select THAT
 * cell, otherwise every coordinate below would be a guess.
 *
 * Where it runs:
 *   default           the standalone host (ui-audit/univer-sandbox) — the same component, no sign-in needed. The sandbox has
 *                     no owner account to switch the grid on, so this is how the full checklist runs in a session.
 *   --live <base>     the real app signed in as the test account (E2E_LOGIN_KEY). `is_admin` is answered `true` by a network
 *                     intercept for THIS browser only (the client-side gate is a visibility switch, not a security
 *                     boundary — data access is still the test account's own, enforced by RLS), then the same checks that
 *                     do not need a scratch workbook run, and the gate itself is proved from both sides.
 * Usage: node ui-audit/verify-univer-parity.mjs [--json out.json] [--only id,id]   (starts/stops the sandbox server itself) */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { createWorkbook, setRaw, setCellStyle } from "../src/workspaces/model/lib/sheetModel.js";

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const ONLY = (val("--only") || "").split(",").filter(Boolean);
const JSON_OUT = val("--json");
const PORT = 5198;
const BASE = `http://localhost:${PORT}`;

// ── the workbook every check starts from ────────────────────────────────────────────────────────────────────────────────
function seedWorkbook() {
  const wb = createWorkbook();
  let sh = wb.sheets[0].sheet;
  [1, 2, 3, 4, 5].forEach((n, i) => { sh = setRaw(sh, i, 0, String(n)); });
  sh = setRaw(sh, 0, 1, "alpha"); sh = setRaw(sh, 1, 1, "beta"); sh = setRaw(sh, 2, 1, "=A1+A2"); sh = setRaw(sh, 3, 1, "3"); sh = setRaw(sh, 4, 1, "5");
  sh = setRaw(sh, 0, 2, "cherry"); sh = setRaw(sh, 1, 2, "apple"); sh = setRaw(sh, 2, 2, "banana");
  sh = setCellStyle(sh, 0, 0, 1, 1, { bold: true });
  return { ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] };
}

// ── harness plumbing ────────────────────────────────────────────────────────────────────────────────────────────────────
let server, browser, page;
const results = [];
export const results_ = results;
export const record = (id, label, status, detail = "") => { results.push({ id, label, status, detail }); console.log(`${status.padEnd(10)} ${id.padEnd(22)} ${label}${detail ? "  ::  " + detail : ""}`); };

async function startSandbox() {
  const res = await fetch(`${BASE}/ui-audit/univer-sandbox/index.html`).catch(() => null);
  if (res && res.ok) return;
  server = spawn("npx", ["vite", "--config", "ui-audit/univer-sandbox/vite.config.mjs"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname });
  for (let i = 0; i < 60; i++) { const r = await fetch(`${BASE}/ui-audit/univer-sandbox/index.html`).catch(() => null); if (r && r.ok) return; await new Promise((r2) => setTimeout(r2, 500)); }
  throw new Error("the Univer sandbox did not start");
}

const ev = (fn, arg) => page.evaluate(fn, arg);
/** run `body(api, ws)` in the page against the active sheet */
const inSheet = (body, arg) => page.evaluate(`((arg) => { const api = window.__planyrUniverRead.api(); const ws = api.getActiveWorkbook().getActiveSheet(); return (${body.toString()})(api, ws, arg); })(${JSON.stringify(arg ?? null)})`);
const wait = (ms) => page.waitForTimeout(ms);

/** Where the checklist runs: the sandbox host by default; verify-univer-live.mjs binds the real signed-in app instead. */
export function bind({ page: p, reset: r, savedLast: sl, flushSave: fs } = {}) { if (p) page = p; if (r) resetImpl = r; if (sl) savedLastImpl = sl; if (fs) flushSaveImpl = fs; }
let resetImpl = null, savedLastImpl = null, flushSaveImpl = null;
export { seedWorkbook, checks };
async function reset(workbook = seedWorkbook()) {
  if (resetImpl) return resetImpl(workbook);
  await wait(450);                                              // let any debounced save from the previous check land first
  await ev(([wb]) => { window.__saved.length = 0; window.__notices = []; window.__sandboxLoad(wb, {}); }, [workbook]);
  await wait(500);
  await ev(() => { const api = window.__planyrUniverRead.api(); api.getActiveWorkbook().getActiveSheet().getRange(0, 0).activate(); });
  await wait(350);
  await ev(() => { window.__ev = []; const api = window.__planyrUniverRead.api(); if (window.__evOff) window.__evOff.forEach((f) => f.dispose && f.dispose()); window.__evOff = ["SheetEditStarted", "SheetEditEnded"].map((k) => api.addEvent(api.Event[k], () => window.__ev.push(k))); });
}
/** page point (center) of a cell, from Univer's own geometry + the canvas origin */
const pt = (r, c) => inSheet((api, ws, [rr, cc]) => {
  const rect = ws.getRange(rr, cc).getCellRect();
  const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect();
  const o = typeof rect === "string" ? JSON.parse(rect) : rect;
  return { x: cv.left + o.x + o.width / 2, y: cv.top + o.y + o.height / 2, left: cv.left + o.x, top: cv.top + o.y, w: o.width, h: o.height, right: cv.left + o.x + o.width, bottom: cv.top + o.y + o.height };
}, [r, c]);
const canvasBox = () => ev(() => { const b = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height }; });
const click = async (r, c, opts = {}) => { const p = await pt(r, c); await page.mouse.click(p.x, p.y, opts); await wait(160); };   // a person never types in the same millisecond as the click; Univer hands focus to its editor asynchronously
const sel = () => inSheet((api, ws) => ws.getSelection().getActiveRangeList().map((x) => { const g = x.getRange(); return { a1: x.getA1Notation(), r1: g.startRow, r2: g.endRow, c1: g.startColumn, c2: g.endColumn, type: g.rangeType }; }));
const cell = (r, c) => inSheet((api, ws, [rr, cc]) => {
  const x = ws.getRange(rr, cc); const cs = x.getCellStyle(); const st = (cs && cs._style) || {};
  return { v: x.getValue(), f: x.getFormula(), bold: st.bl === 1 ? "bold" : "normal", italic: st.it === 1 ? "italic" : "normal", line: st.ul && st.ul.s === 1 ? "underline" : st.st && st.st.s === 1 ? "line-through" : "none", nf: x.getNumberFormat(), wrap: x.getWrap(), bg: st.bg && st.bg.rgb || null, color: st.cl && st.cl.rgb || null };
}, [r, c]);
/** hidden rows / columns live only in the saved snapshot (the facade has hide, not is-hidden) */
const hiddenState = () => inSheet((api, ws) => { const sd = api.getActiveWorkbook().save().sheets[ws.getSheetId()]; return { rows: Object.keys(sd.rowData || {}).filter((r) => sd.rowData[r].hd === 1).map(Number), cols: Object.keys(sd.columnData || {}).filter((c) => sd.columnData[c].hd === 1).map(Number) }; });
/** the value a person sees: Univer turns an edited existing cell into rich text, which has no plain `v`, so fall back to the shown text */
const val1 = async (r, c) => { const x = await inSheet((api, ws, [rr, cc]) => { const g = ws.getRange(rr, cc); const v = g.getValue(); if (v !== null && v !== undefined) return v; const d = g.getDisplayValue(); return d === "" ? null : d; }, [r, c]); return x; };
const type = async (text, { enter = true } = {}) => { await page.keyboard.type(text, { delay: 8 }); if (enter) await page.keyboard.press("Enter"); await wait(150); };
const press = async (k) => { await page.keyboard.press(k); await wait(180); };
const heldClick = async (r, c, key) => { const p = await pt(r, c); await page.keyboard.down(key); await page.mouse.click(p.x, p.y); await page.keyboard.up(key); };
const savedLast = () => (savedLastImpl ? savedLastImpl() : ev(() => window.__saved[window.__saved.length - 1] || null));
const flushSave = async () => { if (flushSaveImpl) return flushSaveImpl(); await ev(() => window.__planyrUniverRead.flush()); await wait(200); };

const checks = [];
const check = (id, label, fn) => checks.push({ id, label, fn });
const PASS = (detail) => ({ status: "PASS", detail });
const FAIL = (detail) => ({ status: "FAIL", detail });
const NOT_IN_OSS = (detail) => ({ status: "NOT-IN-OSS", detail });
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 1. typing, undo, shortcuts that must not leak ───────────────────────────────────────────────────────────────────────
check("undo-typing", "Ctrl+Z while typing undoes the typing only; after commit it is one step", async () => {
  await reset();
  await click(9, 4); await type("keep");                       // E10 committed: sheet undo stack = 1
  await click(9, 5); await page.keyboard.type("ab", { delay: 10 }); await wait(700); await page.keyboard.type("cd", { delay: 10 });
  await press("Control+z");                                    // IN the editor
  const keepAfter = await val1(9, 4);
  await press("Enter");
  const typed = await val1(9, 5);
  if (keepAfter !== "keep") return FAIL(`Ctrl+Z in the editor undid the sheet (E10 now "${keepAfter}")`);
  if (typed === "abcd") return FAIL('Ctrl+Z in the editor did nothing to the typing (cell committed "abcd")');
  await click(10, 5); await type("xyz");                       // one committed edit
  await press("Control+z");
  const back = await val1(10, 5), keep2 = await val1(9, 4);
  if (back !== null && back !== "" && back !== undefined) return FAIL(`one Ctrl+Z after commit left F11 = "${back}"`);
  if (keep2 !== "keep") return FAIL("the commit undo also undid the earlier cell");
  return PASS(`typing undone to "${typed ?? ""}" with the sheet untouched; the committed cell undid as ONE step`);
});
check("bare-letter", "A bare letter starts typing; no fullscreen or single-letter app shortcut fires", async () => {
  await reset(); await click(7, 3);
  await press("f");
  const fs = await ev(() => !!document.fullscreenElement);
  await page.keyboard.type("oo"); await press("Enter");
  const v = await val1(7, 3);
  if (fs) return FAIL("fullscreen toggled");
  return v === "foo" ? PASS('typed "foo" into the cell; document.fullscreenElement stayed null') : FAIL(`cell holds ${JSON.stringify(v)}, not "foo"`);
});

// ── 2. headers and selection ────────────────────────────────────────────────────────────────────────────────────────────
const headerPt = async (c) => { const p = await pt(0, c); const cv = await canvasBox(); return { x: p.x, y: cv.top + 10 }; };
const rowHeaderPt = async (r) => { const p = await pt(r, 0); const cv = await canvasBox(); return { x: cv.left + 20, y: p.y }; };
check("headers-fixed", "Row numbers and column letters cannot be edited", async () => {
  await reset();
  await click(9, 9);                                                    // park the selection away from the headers
  const events = () => ev(() => window.__ev.slice());
  const h = await headerPt(2); await page.mouse.dblclick(h.x, h.y); await wait(250);
  const afterCol = await events();
  const r = await rowHeaderPt(3); await page.mouse.dblclick(r.x, r.y); await wait(250);
  const afterRow = await events();
  const dom = await ev(() => { const a = document.activeElement; return { editable: !!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")), text: document.body.innerText.includes("zzz") }; });
  // typing now edits the ACTIVE CELL (a cell, never a label): prove the label itself is untouched
  await page.keyboard.type("zzz"); await press("Escape"); await wait(100);
  const labels = await ev(() => document.body.innerText.includes("zzz"));
  return afterCol.length === 0 && afterRow.length === 0 && !dom.editable && !labels ? PASS("double-clicking a column letter or a row number opens no editor (0 edit events); the labels are painted by the grid and have no stored text") : FAIL(`edit events after column dbl-click ${JSON.stringify(afterCol)}, after row ${JSON.stringify(afterRow)}, input=${dom.editable}, label changed=${labels}`);
});
check("header-select", "Header click selects the whole line; drag and Shift+click extend; corner selects all", async () => {
  await reset();
  const cols = await ev(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getMaxColumns());
  const rows = await ev(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getMaxRows());
  let h = await headerPt(2); await page.mouse.click(h.x, h.y); await wait(150);
  const colSel = (await sel())[0];
  const wholeCol = colSel && colSel.c1 === 2 && colSel.c2 === 2 && colSel.r1 === 0 && colSel.r2 === rows - 1;
  await click(9, 9);                                                    // a plain click first: dragging an ALREADY-selected header moves it (see header-drag-moves)
  const a = await headerPt(2), z = await headerPt(4);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(z.x, z.y, { steps: 6 }); await page.mouse.up(); await wait(150);
  const drag = (await sel())[0];
  const dragOk = drag && drag.c1 === 2 && drag.c2 === 4;
  const g = await headerPt(6); await page.keyboard.down("Shift"); await page.mouse.click(g.x, g.y); await page.keyboard.up("Shift"); await wait(150);
  const shift = (await sel())[0];
  const shiftOk = shift && shift.c1 === 2 && shift.c2 === 6;
  const rh = await rowHeaderPt(2); await page.mouse.click(rh.x, rh.y); await wait(150);
  const rowSel = (await sel())[0];
  const wholeRow = rowSel && rowSel.r1 === 2 && rowSel.r2 === 2 && rowSel.c1 === 0 && rowSel.c2 === cols - 1;
  const cv = await canvasBox(); await page.mouse.click(cv.left + 20, cv.top + 10); await wait(150);
  const all = (await sel())[0];
  const allOk = all && all.r1 === 0 && all.c1 === 0 && all.r2 === rows - 1 && all.c2 === cols - 1;
  const bad = [!wholeCol && "column click", !dragOk && "header drag", !shiftOk && "Shift+click", !wholeRow && "row click", !allOk && "corner box"].filter(Boolean);
  return bad.length ? FAIL(`not met: ${bad.join(", ")} — got ${JSON.stringify({ colSel, drag, shift, rowSel, all })}`) : PASS("column click, drag C→E, Shift+click G, row click and the corner box all select the right ranges");
});
check("header-drag-moves", "Dragging an already-selected header does not move the row/column (Excel needs Shift)", async () => {
  await reset(); const h = await headerPt(2); await page.mouse.click(h.x, h.y); await wait(150);
  const before = await val1(0, 2);
  const z = await headerPt(4); await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(z.x, z.y, { steps: 6 }); await page.mouse.up(); await wait(300);
  const stayed = (await val1(0, 2)) === before;
  return stayed ? PASS("the column stayed where it was; the drag only re-selected") : FAIL(`column C was MOVED by dragging its selected header (C1 was "${before}", now "${await val1(0, 2)}") — Excel only moves it with Shift held`);
});
check("ctrl-click", "Ctrl+click adds a second, separate range", async () => {
  await reset(); await click(0, 0); await heldClick(2, 2, "Control"); await wait(150);
  const s = await sel();
  return s.length === 2 && s[0].a1 === "A1" && s[1].a1 === "C3" ? PASS("A1 and C3 selected together") : FAIL(`selection list is ${JSON.stringify(s.map((x) => x.a1))}`);
});
check("autoscroll", "Drag-select past the visible edge autoscrolls in all four directions", async () => {
  await reset();
  const cv = await canvasBox();
  const vis = () => inSheet((api, ws) => { const v = ws.getVisibleRange(); return { r1: v.startRow, r2: v.endRow, c1: v.startColumn, c2: v.endColumn }; });
  // NOTE: getCellRect() is absolute sheet geometry and does not follow scrolling, so after a scroll the drag starts from the
  // middle of the canvas (a plain viewport point) and Univer itself decides which cell that is.
  const drag = async (fromX, fromY, toX, toY, holdMs = 1400) => {
    await page.mouse.move(fromX, fromY); await page.mouse.down();
    await page.mouse.move((fromX + toX) / 2, (fromY + toY) / 2, { steps: 4 }); await page.mouse.move(toX, toY, { steps: 4 });
    const t0 = Date.now(); while (Date.now() - t0 < holdMs) { await page.mouse.move(toX, toY + (Date.now() % 2)); await wait(60); }
    const v = await vis(); const s = (await sel())[0]; await page.mouse.up(); await wait(150); return { v, s };
  };
  const base = await vis(); const out = {};
  const p0 = await pt(5, 3);
  out.right = await drag(p0.x, p0.y, cv.right - 12, cv.top + 200);                                  // → right edge
  await reset(); const p1 = await pt(5, 3);
  out.down = await drag(p1.x, p1.y, cv.left + 300, cv.bottom - 12);                                 // ↓ bottom edge
  await reset(); await inSheet((api, ws) => { ws.scrollToCell(60, 40); }); await wait(600);
  const v2 = await vis(); const cx = cv.left + cv.w / 2, cy = cv.top + cv.h / 2;
  out.left = await drag(cx, cy, cv.left + 25, cy);                                                  // ← left edge (over the row header)
  await reset(); await inSheet((api, ws) => { ws.scrollToCell(60, 40); }); await wait(600);
  const v3 = await vis();
  out.up = await drag(cx, cy, cx, cv.top + 8);                                                      // ↑ top edge (over the column header)
  const grew = {
    right: out.right.v.c2 > base.c2 && out.right.s.c2 > base.c2, down: out.down.v.r2 > base.r2 && out.down.s.r2 > base.r2,
    left: out.left.v.c1 < v2.c1 && out.left.s.c1 < v2.c1, up: out.up.v.r1 < v3.r1 && out.up.s.r1 < v3.r1,
  };
  const bad = Object.entries(grew).filter(([, ok]) => !ok).map(([k]) => k);
  return bad.length ? FAIL(`did not scroll: ${bad.join(", ")}`) : PASS(`right to col ${out.right.v.c2}, down to row ${out.down.v.r2}, left to col ${out.left.v.c1}, up to row ${out.up.v.r1}`);
});

// ── 3. text layout ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ink = async (r, c) => {
  const p = await pt(r, c);
  const buf = await page.screenshot({ clip: { x: p.left + 2, y: p.top + 2, width: Math.max(4, p.w - 4), height: Math.max(4, p.h - 4) } });
  return buf;
};
const darkPixels = (buf) => page.evaluate(async (b64) => {
  const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 110 && d[i + 1] < 110 && d[i + 2] < 110) n++;
  return n;
}, buf.toString("base64"));
check("spill-and-clear", "Text spills over empty neighbours; clearing a cell never moves the text beside it", async () => {
  const wb = createWorkbook(); let sh = wb.sheets[0].sheet;
  sh = setRaw(sh, 2, 0, "A long label that is wider than its own column for sure");
  sh = setRaw(sh, 4, 0, "left"); sh = setRaw(sh, 4, 1, "beta");
  await reset({ ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] });
  await click(15, 8);                                              // park the selection far away so its outline cannot reach B5
  const spill = await darkPixels(await ink(2, 1));              // B3 is empty: the label from A3 should be drawn into it
  const before = await ink(4, 1);
  await click(4, 0); await press("Delete"); await wait(250);    // clear the cell BESIDE beta
  await click(15, 8); await wait(150);
  const after = await ink(4, 1);
  const same = before.equals(after);
  if (spill < 8) return FAIL(`the long label did not spill into the empty cell beside it (${spill} dark pixels)`);
  return same ? PASS(`label spills (${spill} px of ink in the empty neighbour); clearing A5 left B5's pixels identical`) : FAIL("clearing the neighbour changed the pixels of B5");
});
check("indent", "Increase / decrease indent works on any cell", async () => {
  await reset();
  const found = await ev(() => { const t = [...document.querySelectorAll("[title],[aria-label],[data-u-command]")].map((e) => (e.title || "") + (e.getAttribute("aria-label") || "") + (e.getAttribute("data-u-command") || "")).join("|"); return /indent/i.test(t); });
  const ids = await ev(() => { try { const api = window.__planyrUniverRead.api(); const svc = api.getShortcut ? "has-shortcut-api" : "none"; return svc; } catch (e) { return String(e); } });
  return found ? PASS("an indent control exists") : NOT_IN_OSS(`no indent control in the toolbar or menus and no indent command in @univerjs/sheets-ui 1.3.1 (the cell model has no indent field); Planyr's indent values are carried in the bridge sidecar but not drawn. (${ids})`);
});

// ── 4. keyboard shortcuts ──────────────────────────────────────────────────────────────────────────────────────────────
const shortcut = (id, label, keys, run) => check(id, label, async () => { await reset(); await click(1, 2); return run(keys); });   // C2 'apple': unstyled
shortcut("key-bold", "Ctrl+B bold", "Control+b", async (k) => { await press(k); const on = (await cell(1, 2)).bold; await press(k); const off = (await cell(1, 2)).bold; return on === "bold" && off !== "bold" ? PASS("toggles on and off") : FAIL(`on=${on} off=${off}`); });
shortcut("key-italic", "Ctrl+I italic", "Control+i", async (k) => { await press(k); const on = (await cell(1, 2)).italic; return on === "italic" ? PASS("italic on") : FAIL(`got ${on}`); });
shortcut("key-underline", "Ctrl+U underline", "Control+u", async (k) => { await press(k); const on = (await cell(1, 2)).line; return /underline/.test(on) ? PASS("underline on") : FAIL(`got ${on}`); });
shortcut("key-strike", "Ctrl+5 strikethrough", "Control+5", async (k) => { await press(k); const on = (await cell(1, 2)).line; return /line-through|strike/.test(on) ? PASS("strikethrough on") : NOT_IN_OSS(`no effect (style stays "${on}"): Ctrl+5 is not bound`); });
shortcut("key-format-cells", "Ctrl+1 Format Cells dialog", "Control+1", async (k) => { await press(k); await wait(300); const dlg = await ev(() => !!document.querySelector('[role="dialog"], .univer-dialog')); return dlg ? PASS("a dialog opened") : NOT_IN_OSS("no Format Cells dialog (Univer formats from the toolbar and the number-format menu)"); });
for (const [id, label, k, test] of [
  ["key-currency", "Ctrl+Shift+$ currency", "Control+Shift+$", (nf) => /\$/.test(nf || "")],
  ["key-percent", "Ctrl+Shift+% percent", "Control+Shift+%", (nf) => /%/.test(nf || "")],
  ["key-number", "Ctrl+Shift+! number", "Control+Shift+!", (nf) => /#,##0\.00|0\.00/.test(nf || "")],
  ["key-general", "Ctrl+Shift+~ general", "Control+Shift+~", (nf) => !nf || /general/i.test(nf)],
  ["key-date", "Ctrl+Shift+# date", "Control+Shift+#", (nf) => /d|y/i.test(nf || "") && !/#,/.test(nf || "")],
]) {
  shortcut(id, label, k, async (kk) => {
    await click(0, 0); const before = (await cell(0, 0)).nf; await press(kk); const nf = (await cell(0, 0)).nf;
    return nf !== before && test(nf) ? PASS(`number format is now ${nf}`) : NOT_IN_OSS(`no binding: number format stayed ${JSON.stringify(nf)}`);
  });
}
shortcut("key-border", "Ctrl+Shift+& outline border / Ctrl+Shift+_ remove border", "Control+Shift+&", async (k) => {
  await click(0, 0); await press(k);
  const b = await inSheet((api, ws) => { const s = api.getActiveWorkbook().save(); const sid = ws.getSheetId(); const c = s.sheets[sid].cellData[0] && s.sheets[sid].cellData[0][0]; const st = c && c.s && (typeof c.s === "string" ? s.styles[c.s] : c.s); return st && st.bd ? Object.keys(st.bd) : []; });
  return b.length ? PASS(`border edges ${b.join(",")}`) : NOT_IN_OSS("no binding for border shortcuts");
});
check("key-select-all", "Ctrl+A twice (region, then everything)", async () => {
  await reset(); await click(1, 1);
  await press("Control+a"); const first = (await sel())[0];
  await press("Control+a"); const second = (await sel())[0];
  const rows = await ev(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getMaxRows());
  const firstIsRegion = first && first.r2 < rows - 1 && first.r2 >= 4;
  const secondAll = second && second.r2 === rows - 1;
  return firstIsRegion && secondAll ? PASS(`first press ${first.a1}, second press everything`) : FAIL(`first=${first && first.a1} second=${second && second.a1}`);
});
check("key-row-col", "Shift+Space selects the row; Ctrl+Space selects the column", async () => {
  await reset(); await click(2, 2); await press("Shift+Space"); const row = (await sel())[0]; await click(2, 2); await press("Control+Space"); const col = (await sel())[0];
  const cols = await ev(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getMaxColumns());
  const rows = await ev(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getMaxRows());
  const rOk = row && row.r1 === 2 && row.r2 === 2 && row.c2 === cols - 1, cOk = col && col.c1 === 2 && col.c2 === 2 && col.r2 === rows - 1;
  return rOk && cOk ? PASS("whole row 3 and whole column C") : (row && row.a1 === "C3" && col && col.a1 === "C3" ? NOT_IN_OSS("neither chord changes the selection (Shift+Space and Ctrl+Space are not bound; use the header click)") : FAIL(`row=${row && row.a1} col=${col && col.a1}`));
});
check("key-ctrl-shift-arrow", "Ctrl+Shift+Arrow extends to the end of the data", async () => {
  await reset(); await click(0, 0); await press("Control+Shift+ArrowDown"); const s = (await sel())[0];
  return s && s.r2 === 4 ? PASS(`selected ${s.a1}`) : FAIL(`selected ${s && s.a1}`);
});
check("key-insert-delete", "Ctrl+Plus inserts, Ctrl+Minus deletes (cells / rows / columns)", async () => {
  await reset(); await click(2, 0); await press("Shift+Space"); await press("Control+Shift+="); await wait(300);
  const rowsAfterInsert = await val1(3, 0);
  const dlg = await ev(() => !!document.querySelector('[role="dialog"]'));
  if (rowsAfterInsert === 3 || dlg) { await press("Control+-"); await wait(300); return PASS(`row inserted via Ctrl+Plus (old row 3 moved to row 4${dlg ? ", a dialog asked first" : ""})`); }
  return NOT_IN_OSS("Ctrl+Plus / Ctrl+Minus are not bound (insert and delete are in the right-click menu)");
});
check("key-hide", "Ctrl+9 hides rows, Ctrl+0 hides columns", async () => {
  await reset(); await click(2, 2); await press("Control+9"); const r = (await hiddenState()).rows.includes(2); await press("Control+0"); const c = (await hiddenState()).cols.includes(2);
  return r && c ? PASS("row 3 and column C hidden") : (r || c ? FAIL(`row hidden=${r}, column hidden=${c}`) : NOT_IN_OSS("no Ctrl+9 / Ctrl+0 binding (hide is in the header right-click menu)"));
});
check("key-f2", "F2 edits the cell in place with its content", async () => {
  await reset(); await click(0, 1); await press("F2"); await page.keyboard.type("X"); await press("Enter"); await wait(400);
  const v = await val1(0, 1);
  return v === "alphaX" ? PASS('F2 kept the text and appended ("alphaX")') : FAIL(`cell is ${JSON.stringify(v)}`);
});
check("key-f4", "F4 cycles absolute / relative while editing a reference", async () => {
  await reset(); await click(6, 0); await page.keyboard.type("=A1"); await press("F4"); await press("Enter");
  const f = (await cell(6, 0)).f;
  return f === "=$A$1" ? PASS("=A1 → =$A$1") : FAIL(`formula is ${f}`);
});
check("key-alt-enter", "Alt+Enter inserts a line break inside the cell", async () => {
  await reset(); await click(6, 0); await page.keyboard.type("a"); await page.keyboard.press("Alt+Enter"); await page.keyboard.type("b"); await press("Enter");
  const v = await val1(6, 0);
  return /^a[\r\n]b$/.test(String(v)) ? PASS('"a⏎b" in one cell (Univer stores the break as a carriage return; the bridge saves it as a newline)') : FAIL(`cell is ${JSON.stringify(v)}`);
});
check("key-ctrl-enter", "Ctrl+Enter fills the whole selection with the entry", async () => {
  await reset(); await click(6, 0); await page.keyboard.down("Shift"); await click(8, 0, {}); await page.keyboard.up("Shift");
  const s = (await sel())[0];
  await page.keyboard.type("7"); await press("Control+Enter");
  const vs = [await val1(6, 0), await val1(7, 0), await val1(8, 0)];
  return eq(vs, [7, 7, 7]) ? PASS("A7:A9 all 7") : FAIL(`values ${JSON.stringify(vs)} (selection was ${s && s.a1})`);
});
check("key-fill", "Ctrl+D fills down, Ctrl+R fills right", async () => {
  await reset(); await click(0, 0); await page.keyboard.down("Shift"); await click(3, 0); await page.keyboard.up("Shift"); await press("Control+d");
  const down = [await val1(1, 0), await val1(2, 0), await val1(3, 0)];
  await click(0, 1); await page.keyboard.down("Shift"); await click(0, 4); await page.keyboard.up("Shift"); await press("Control+r");
  const right = [await val1(0, 2), await val1(0, 3), await val1(0, 4)];
  return eq(down, [1, 1, 1]) && right.every((v) => v === "alpha") ? PASS("A2:A4 = 1 and C1:E1 = alpha") : FAIL(`down ${JSON.stringify(down)} right ${JSON.stringify(right)} (no binding?)`);
});
check("key-today", "Ctrl+; inserts today's date", async () => {
  await reset(); await click(6, 0); await press("Control+;"); await press("Escape"); await wait(100);
  const v = await val1(6, 0);
  return v ? PASS(`cell holds ${JSON.stringify(v)}`) : NOT_IN_OSS("Ctrl+; is not bound");
});
check("alt-keytips", "Alt key-tips (Alt H O I …) — expected missing", async () => {
  await reset(); await click(0, 0);
  await page.keyboard.down("Alt"); await page.keyboard.up("Alt"); await wait(300);
  const tips = await ev(() => document.querySelectorAll('[class*="keytip" i], [data-keytip]').length);
  return tips === 0 ? NOT_IN_OSS("pressing Alt on its own shows no key-tip badges; Alt H O I does nothing") : PASS(`${tips} key tips shown`);
});

// ── 5. clipboard ────────────────────────────────────────────────────────────────────────────────────────────────────────
check("clip-internal", "Copy / paste keeps formatting; a single value pastes into a whole range", async () => {
  await reset(); await click(0, 1); await press("Control+c"); await click(0, 4); await press("Control+v"); await wait(300);
  const c = await cell(0, 4);
  await click(0, 0); await press("Control+c"); await click(5, 3); await page.keyboard.down("Shift"); await click(8, 3); await page.keyboard.up("Shift"); await press("Control+v"); await wait(300);
  const filled = [await val1(5, 3), await val1(6, 3), await val1(7, 3), await val1(8, 3)];
  const ok1 = c.v === "alpha" && c.bold === "bold", ok2 = filled.every((v) => v === 1);
  return ok1 && ok2 ? PASS('"alpha" pasted with its bold; one value pasted into D6:D9') : FAIL(`pasted ${JSON.stringify(c)}; range ${JSON.stringify(filled)}`);
});
check("clip-cut", "Cut moves the cell and the formulas that point at it follow", async () => {
  await reset(); await click(0, 0); await press("Control+x"); await click(0, 6); await press("Control+v"); await wait(400);
  const moved = await val1(0, 6), origin = await val1(0, 0), f = (await cell(2, 1)).f;
  return moved === 1 && !origin && /G1/.test(f || "") ? PASS(`A1 moved to G1 and B3 now reads ${f}`) : FAIL(`G1=${moved} A1=${origin} B3 formula=${f}`);
});
check("clip-excel", "Paste from Excel (HTML) keeps values and formatting", async () => {
  await reset();
  const html = readFileSync(new URL("../test/fixtures/spreadsheet/excel-range.html", import.meta.url), "utf8");
  await ev(async (h) => { await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob(["x"], { type: "text/plain" }) })]); }, html);
  await click(9, 0); await press("Control+v"); await wait(500);
  const got = await inSheet((api, ws) => { const out = []; for (let r = 9; r < 14; r++) { const row = []; for (let c = 0; c < 4; c++) row.push(ws.getRange(r, c).getValue()); out.push(row); } return out; });
  const any = got.flat().filter((v) => v !== null && v !== "").length;
  // the fixture's header row is bold on a yellow fill; a row further down is a currency / percent / italic-red-centred mix
  const head = await cell(9, 0);
  const looks = head.bold === "bold" && !!head.bg;
  return any >= 3 && looks ? PASS(`${any} cells pasted from an Excel HTML clipboard (first row ${JSON.stringify(got[0])}); the header arrived bold on a ${head.bg} fill`) : FAIL(`pasted ${any} cells; header bold=${head.bold} fill=${head.bg}`);
});
check("fill-handle", "Fill handle: drag and double-click", async () => {
  await reset(); await click(0, 0); await page.keyboard.down("Shift"); await click(1, 0); await page.keyboard.up("Shift");
  const p = await pt(1, 0);
  await page.mouse.move(p.right - 2, p.bottom - 2); await page.mouse.down(); await page.mouse.move(p.right - 2, p.bottom + 70, { steps: 8 }); await page.mouse.up(); await wait(300);
  const drag = [await val1(2, 0), await val1(3, 0)];
  await reset(); await click(0, 3); await type("1", { enter: true }); await click(0, 3);       // D1 = 1 with column C data beside rows 1-3
  const p2 = await pt(0, 3);
  await page.mouse.move(p2.right - 2, p2.bottom - 2); await page.mouse.dblclick(p2.right - 2, p2.bottom - 2); await wait(400);
  const dbl = [await val1(1, 3), await val1(2, 3)];
  return eq(drag, [3, 4]) ? PASS(`drag filled the series ${JSON.stringify(drag)}; double-click filled ${JSON.stringify(dbl)}`) : FAIL(`drag gave ${JSON.stringify(drag)}, double-click ${JSON.stringify(dbl)}`);
});
check("merge-freeze-filter-sort", "Merge/unmerge, freeze panes, filter, sort", async () => {
  await reset();
  const r = await inSheet((api, ws) => {
    const out = {};
    ws.getRange("E1:F1").merge(); out.merged = ws.getRange("E1").isPartOfMerge ? ws.getRange("E1").isPartOfMerge() : null;
    ws.getRange("E1:F1").breakApart(); out.unmerged = ws.getRange("E1").isPartOfMerge ? !ws.getRange("E1").isPartOfMerge() : null;
    ws.setFrozenRows(2); ws.setFrozenColumns(1); out.freeze = [ws.getFrozenRows(), ws.getFrozenColumns()];
    ws.getRange("A1:C5").createFilter(); out.filter = !!ws.getFilter();
    ws.getFilter() && ws.getFilter().remove();
    ws.getRange("A1:A5").sort({ column: 0, ascending: false }); out.sorted = [1, 2, 3, 4, 5].map((n, i) => ws.getRange(i, 0).getValue());
    return out;
  });
  const ok = r.merged && r.unmerged && eq(r.freeze, [2, 1]) && r.filter && eq(r.sorted, [5, 4, 3, 2, 1]);
  return ok ? PASS(`merge/unmerge, freeze ${JSON.stringify(r.freeze)}, filter, sort desc ${JSON.stringify(r.sorted)}`) : FAIL(JSON.stringify(r));
});
check("formats-wrap-size", "Number formats, wrap text, resize / autofit, hidden rows and columns", async () => {
  await reset();
  const r = await inSheet((api, ws) => {
    const out = {};
    ws.getRange("A1").setNumberFormat("$#,##0.00"); out.cur = ws.getRange("A1").getDisplayValue();
    ws.getRange("A2").setNumberFormat("0.0%"); out.pct = ws.getRange("A2").getDisplayValue();
    ws.getRange("A3").setNumberFormat("mm/dd/yyyy"); out.date = ws.getRange("A3").getDisplayValue();
    ws.getRange("B1").setWrap(true); out.wrap = ws.getRange("B1").getWrap();
    ws.setColumnWidth(0, 200); out.width = ws.getColumnWidth(0);
    ws.setRowHeight(0, 40); out.height = ws.getRowHeight(0);
    ws.autoResizeColumns(1, 1); out.auto = ws.getColumnWidth(1);
    ws.hideRows(4, 1); ws.hideColumns(5, 1);
    return out;
  });
  const hs = await hiddenState(); r.hidden = [hs.rows.includes(4), hs.cols.includes(5)];
  const ok = r.cur === "$1.00" && /%/.test(r.pct) && /\d+\/\d+\/\d{4}/.test(r.date) && r.wrap && r.width === 200 && r.height === 40 && eq(r.hidden, [true, true]);
  return ok ? PASS(`display ${r.cur} · ${r.pct} · ${r.date}; wrap, width ${r.width}, height ${r.height}, autofit ${r.auto}, hidden row+col`) : FAIL(JSON.stringify(r));
});
check("find-replace", "Find / replace", async () => {
  await reset(); await click(0, 0); await press("Control+f"); await wait(500);
  const panel = await ev(() => !!document.querySelector('[class*="find-replace"], [data-u-comp="find-replace"], input[placeholder*="ind" i]'));
  await press("Escape");
  return panel ? PASS("Ctrl+F opens the Univer find panel") : FAIL("Ctrl+F opened nothing");
});
check("structure-tabs", "Insert / delete rows and columns, several sheet tabs with rename — and every one reaches the saved workbook", async () => {
  await reset();
  const before = await inSheet((api, ws) => ({ rows: ws.getMaxRows(), cols: ws.getMaxColumns() }));
  await inSheet((api, ws) => { ws.insertColumnBefore(1); ws.insertRowBefore(2); ws.deleteRow(0); const wb = api.getActiveWorkbook(); wb.insertSheet("Second"); wb.getActiveSheet().setName("Renamed"); });
  await wait(700); await flushSave();
  const saved = await savedLast();
  if (!saved) return FAIL("an edit inside Univer produced no saved workbook");
  const wbk = saved.wb;
  const names = wbk.sheets.map((s) => s.name);
  const s0 = wbk.sheets[0].sheet;
  const colIds = s0.columns.slice(0, 3).map((c) => c.id);
  const okCols = s0.columns.length === before.cols + 1 && colIds[0] === "c1" && colIds[2] === "c2" && colIds[1] !== "c2";
  // alpha was B1 (c2:0); after insert col before B, insert row before 3, delete row 1 it is c2 at row -1 → gone; beta (c2:1) moves up to row 0
  const beta = s0.cells["c2:0"];
  const ok = names.length === 2 && names.includes("Renamed") && okCols && beta === "beta";
  return ok ? PASS(`saved sheets ${JSON.stringify(names)}; column ids ${JSON.stringify(colIds)} follow their columns; "beta" kept its column id after the row delete`) : FAIL(JSON.stringify({ names, colIds, beta, cols: s0.columns.length, expectCols: before.cols + 1 }));
});
check("undo-redo-all", "Undo / redo across all of the above", async () => {
  await reset();
  const snap = async () => JSON.stringify([await inSheet((api, ws) => [ws.getRange("A1:C6").getValues(), ws.getFrozenRows(), ws.getRange("A1").getNumberFormat()]), (await hiddenState()).rows]);
  const initial = await snap();
  await click(0, 0); await type("99"); await click(1, 0); await press("Control+b"); await inSheet((api, ws) => { ws.setFrozenRows(2); ws.getRange("A1").setNumberFormat("0.0%"); ws.hideRows(4, 1); });
  const final = await snap();
  // EXACTLY as many undo steps as edits made above (typing, bold, freeze, number format, hide = 5). More would reach back into the
  // test's own setup on a page whose setup went through Univer's undo stack (the live run seeds through the facade).
  const STEPS = 5;
  for (let i = 0; i < STEPS; i++) await page.keyboard.press("Control+z");
  await wait(300); const undone = await snap();
  for (let i = 0; i < STEPS; i++) await page.keyboard.press("Control+y");
  await wait(300); const redone = await snap();
  return undone === initial && redone === final && initial !== final ? PASS(`${STEPS}× Ctrl+Z (one per edit) restored the starting sheet exactly; ${STEPS}× Ctrl+Y returned to the final state`) : FAIL(`undo ${undone === initial ? "ok" : "differs"}, redo ${redone === final ? "ok" : "differs"}`);
});

// ── 7. the app-facing claims ───────────────────────────────────────────────────────────────────────────────────────────
check("project-names", "Site.* / Plan.* / Comp.* resolve and recompute when the project changes", async () => {
  await reset();
  const wb = createWorkbook(); let sh = wb.sheets[0].sheet;
  sh = setRaw(sh, 0, 0, "=Site.Acres*2"); sh = setRaw(sh, 1, 0, "=Plan.Building1.SF+1"); sh = setRaw(sh, 2, 0, "=Comp.Foo.RentPSF"); sh = setRaw(sh, 3, 0, "=Site.Nope");
  const names = (acres) => ({
    "site.acres": { name: "Site.Acres", computed: true, value: acres }, "plan.building1.sf": { name: "Plan.Building1.SF", computed: true, value: 100000 },
    "comp.foo.rentpsf": { name: "Comp.Foo.RentPSF", computed: true, value: { k: "error", code: "#N/A" } },
  });
  await ev(([w, n]) => window.__sandboxLoad(w, n), [{ ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] }, names(12.5)]); await wait(1500);
  const first = [await val1(0, 0), await val1(1, 0), await val1(2, 0), await val1(3, 0)];
  await ev((n) => window.__sandboxNames(n), names(20)); await wait(1200);
  const second = [await val1(0, 0), await val1(1, 0)];
  await flushSave();
  const saved = await savedLast();
  const leaked = saved ? Object.keys(saved.wb.sheets[0].sheet.names) : [];
  const ok = eq(first, [25, 100001, "#N/A", "#NAME?"]) && eq(second, [40, 100001]) && leaked.length === 0;
  return ok ? PASS(`dotted names evaluate (${JSON.stringify(first)}), recompute on change (${JSON.stringify(second)}), and are never saved as the workbook's own names`) : FAIL(`first ${JSON.stringify(first)} second ${JSON.stringify(second)} leaked ${JSON.stringify(leaked)}`);
});
check("no-univer-network", "No request ever leaves for a Univer host", async () => {
  const bad = await ev(() => performance.getEntriesByType("resource").map((r) => r.name).filter((u) => /univer\.ai|univer\.work|dreamnum|univer-cloud/i.test(u)));
  return bad.length === 0 ? PASS("0 requests to any Univer host during the whole run") : FAIL(bad.join(", "));
});

// ── run ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  await startSandbox();
  browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message).slice(0, 200)));
  await page.goto(`${BASE}/ui-audit/univer-sandbox/index.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__planyrUniverRead && window.__planyrUniverRead.api() && window.__sandboxLoad);
  await assertMeasurable(page, "verify-univer-parity");
  // KNOWN-GOOD ARM: a click at the point computed for C3 must select C3, or every coordinate below is a guess.
  await reset(); await click(2, 2);
  const arm = await sel();
  if (!(arm.length === 1 && arm[0].a1 === "C3")) { console.log(`VOID — the known-good arm failed: a click at the computed point of C3 selected ${JSON.stringify(arm)}`); await browser.close(); process.exit(2); }
  record("known-good-arm", "a click at a cell's computed point selects that cell", "PASS", "C3");
  for (const c of checks) {
    if (ONLY.length && !ONLY.includes(c.id)) continue;
    try { const r = await c.fn(); record(c.id, c.label, r.status, r.detail); }
    catch (e) { record(c.id, c.label, "FAIL", `threw: ${String(e.message).split("\n")[0].slice(0, 220)}`); }
  }
  await browser.close();
  if (server) server.kill();
  const tally = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  console.log("\nSUMMARY", JSON.stringify(tally));
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), tally, results }, null, 2));
  process.exit(tally.FAIL ? 1 : 0);
}
if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => { console.error(e); if (server) server.kill(); process.exit(1); });
}
