#!/usr/bin/env node
/* verify-notes-table-size — TEXT SIZE ON A SELECTED ROW (NEW-1), A NEW ROW / COLUMN TAKING ITS NEIGHBOUR'S SIZE
 * (NEW-2) AND DRAGGING A ROW'S HEIGHT (NEW-3). Owner report 2026-11-05, Grand Port permits table.
 *
 * Real mouse + real keys, judged on the STORED document and on RENDERED font sizes / row heights, then re-read
 * after a reload (carry-forward §1.6: persistence claims are read from storage after a reload).
 * Throwaway data only: the page lives in a fresh browser context's own localStorage (signed out), or — with
 * `SIGNED_IN=1` — on the e2e test account's own throwaway page; Grand Port / any real notebook is never opened.
 *
 * ⛔ KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): picking 14 on a FILLED cell must give 14. If the driver
 * cannot do that, every verdict below is about the driver and the run is VOID.
 * ⛔ THE FIXTURE IS MIXED IN EVERY DIMENSION IT GRADES (trap 14): filled · empty-between-filled · a whole empty row
 * · empty-at-the-end — ui-audit/lib/notesTableSizeFixture.mjs.
 *
 * `BASE_URL` (default http://127.0.0.1:5199) · `PW_CHROME` · `SIGNED_IN=1` (then BASE_URL is the deployed site).
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { DOC, TREE, PK, ACTIVE_KEY, MIXED_TABLE, box, para, cell, row, cellSizes, rowHeights } from "./lib/notesTableSizeFixture.mjs";
import { loadFixture } from "./lib/clipboardTableFixtures.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const EXEC = process.env.PW_CHROME || undefined;
const SIGNED_IN = process.env.SIGNED_IN === "1";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-table-size");

let passN = 0; let failN = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};
const J = (x) => JSON.stringify(x);

/* ── seeding / reading ─────────────────────────────────────────────────────────────────────── */
async function reload() {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 800);
}
async function seed(doc = DOC()) {
  /* ⛔ leave the previous page FIRST: its beforeunload flush would otherwise write the OLD document over the one
   * seeded below (found when the first case after the known-good arm read the arm's own size back). */
  await page.goto("about:blank");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tree, d, pk, ak]) => {
    localStorage.clear();
    localStorage.setItem("planyr:notes:tree:v1:local", JSON.stringify(tree));
    localStorage.setItem(pk, JSON.stringify({ type: "doc", content: d }));
    localStorage.setItem(ak, "p1");
  }, [TREE, doc, PK, ACTIVE_KEY]);
  await reload();
}
/* ⛔ the wait lives INSIDE the reader (a read before the 600 ms save debounce is a false failure). */
const stored = async () => { await pacedWait(page, 1100); return JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PK) || "null"); };
const persisted = async () => { await pacedWait(page, 1100); await reload(); return stored(); };

/** Rendered font size (CSS px) of every cell of table `t`: its text's computed size, else its empty paragraph's. */
const renderedSizes = (t = 0) => page.evaluate((ti) => {
  const table = document.querySelectorAll(".ProseMirror table")[ti];
  return [...table.rows].map((r) => [...r.cells].map((c) => {
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    const n = w.nextNode();
    const el = n ? n.parentElement : c.querySelector("p");
    return Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
  }));
}, t);
const rowMetrics = (t = 0) => page.evaluate((ti) => {
  const table = document.querySelectorAll(".ProseMirror table")[ti];
  return [...table.rows].map((r) => ({ h: r.getBoundingClientRect().height / (r.offsetHeight || 1) * r.offsetHeight, css: r.offsetHeight, scale: r.getBoundingClientRect().height / (r.offsetHeight || 1), top: r.getBoundingClientRect().top, bottom: r.getBoundingClientRect().bottom }));
}, t);
const cellPoint = (r, c, t = 0) => page.evaluate(([r, c, ti]) => {
  const rc = document.querySelectorAll(".ProseMirror table")[ti].rows[r].cells[c].getBoundingClientRect();
  return { x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + rc.height / 2) };
}, [r, c, t]);
const pause = (ms = 300) => pacedWait(page, ms);

/** Desktop is TWO-STAGE: press 1 on a box SELECTS it, a second spaced press puts the caret in. */
async function enter(r = 0, c = 0, t = 0) {
  const p = await cellPoint(r, c, t);
  await page.mouse.click(p.x, p.y); await pause(650); await page.mouse.click(p.x, p.y); await pause(300);
}
async function drag(a, b, t = 0) {
  const p = await cellPoint(a[0], a[1], t); const q = await cellPoint(b[0], b[1], t);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 8 }); await page.mouse.up(); await pause(300);
}
async function shiftSel(a, b, t = 0) {
  const p = await cellPoint(a[0], a[1], t); const q = await cellPoint(b[0], b[1], t);
  await page.mouse.click(p.x, p.y); await pause(300);
  await page.keyboard.down("Shift"); await page.mouse.click(q.x, q.y); await page.keyboard.up("Shift"); await pause(300);
}
const selectedCellCount = () => page.evaluate(() => document.querySelectorAll(".ProseMirror .selectedCell").length);
async function pickSize(n) {
  await page.locator('[data-testid="nt-size"]').first().click(); await pause(250);
  const opt = page.locator(`[data-testid="nt-size-opt-${n}"]`).first();
  if (await opt.count()) await opt.click();
  else { const inp = page.locator('[data-testid="nt-size-input"]').first(); await inp.fill(String(n)); await inp.press("Enter"); }
  await pause(450);
}
const click = async (testid) => { await page.locator(`[data-testid="${testid}"]`).first().click(); await pause(450); };
const key = async (k) => { await page.keyboard.press(k); await pause(500); };
/** The cells of table 0 expected to carry size `n`, as [r,c] pairs, vs the rendered grid. */
const wrong = (grid, cells, n) => cells.filter(([r, c]) => grid[r]?.[c] !== n).map(([r, c]) => `[${r},${c}]=${grid[r]?.[c]}`);
const range = (r1, c1, r2, c2) => { const o = []; for (let r = r1; r <= r2; r += 1) for (let c = c1; c <= c2; c += 1) o.push([r, c]); return o; };
const DEFAULT_PX = 15;                                   // the editor's base size, read from the untouched cells below

/* ── KNOWN-GOOD ARM ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== KNOWN-GOOD ARM — picking 14 on a selected word in a FILLED cell gives 14 ===");
await seed();
const base = await renderedSizes();
await enter(0, 0);
{ const p0 = await cellPoint(0, 0); await page.mouse.dblclick(p0.x, p0.y); await pause(300); }      // a real word selection
await pickSize(14);
const arm = await renderedSizes();
ok("a filled cell takes 14 (driver + selection work)", arm[0][0] === 14, `rendered ${J(arm)}`);
if (arm[0][0] !== 14) { console.log("\nVOID: the known-good arm failed — no size verdict means anything."); await browser.close(); process.exit(2); }
const BASE_SIZE = base[0][0];
ok(`(baseline) untouched cells render the default size ${BASE_SIZE}`, base.flat().every((v) => v === BASE_SIZE), J(base));

/* ── NEW-1 — the selection matrix ─────────────────────────────────────────────────────────── */
async function newOne(name, select, cells, { size = 9 } = {}) {
  await seed();
  await enter(1, 0);
  await select();
  const n = await selectedCellCount();
  await pickSize(size);
  const grid = await renderedSizes();
  const bad = wrong(grid, cells, size);
  const others = range(0, 0, 3, 2).filter(([r, c]) => !cells.some(([a, b]) => a === r && b === c)).filter(([r, c]) => grid[r][c] !== BASE_SIZE);
  ok(`${name}: every selected cell (empty ones included) renders ${size}`, bad.length === 0, `selected=${n} · not ${size}: ${bad.join(" ")} · rendered ${J(grid)}`);
  ok(`${name}: nothing outside the selection changed`, others.length === 0, others.map(([r, c]) => `[${r},${c}]=${grid[r][c]}`).join(" "));
  const d = await persisted();
  const after = await renderedSizes();
  ok(`${name}: it holds after a reload (rendered)`, wrong(after, cells, size).length === 0, `${J(after)}   stored: ${J(cellSizes(d))}`);
}
console.log("\n=== NEW-1 — a whole row (the reported case) ===");
await newOne("row by dragging across its cells (mixed filled / empty)", () => drag([1, 0], [1, 2]), range(1, 0, 1, 2));
await newOne("row by shift-click", () => shiftSel([1, 0], [1, 2]), range(1, 0, 1, 2));
await newOne("a WHOLE EMPTY row (row 3 of 4)", () => drag([2, 0], [2, 2]), range(2, 0, 2, 2));
await newOne("the row with an empty cell at the end", () => drag([3, 0], [3, 2]), range(3, 0, 3, 2));
console.log("\n=== NEW-1 — adjacent cases ===");
await newOne("several rows (2–4)", () => drag([1, 0], [3, 2]), range(1, 0, 3, 2));
await newOne("a whole column (middle, mostly empty)", () => drag([0, 1], [3, 1]), range(0, 1, 3, 1));
await newOne("the whole table (Select table button)", async () => { await click("nt-table-select"); }, range(0, 0, 3, 2));
await newOne("one EMPTY cell, selected as a cell", () => drag([1, 1], [1, 1]), [[1, 1]]);
for (const s of [8, 10, 14, 18, 24]) await newOne(`row at size ${s}`, () => drag([1, 0], [1, 2]), range(1, 0, 1, 2), { size: s });

console.log("\n=== NEW-1 — typing into a cell that STARTS EMPTY keeps the size (not just how it is drawn) ===");
for (const how of ["row selection", "caret in the empty cell"]) {
  await seed();
  await enter(1, 0);
  if (how === "row selection") await drag([1, 0], [1, 2]);
  else { const p = await cellPoint(1, 1); await page.mouse.click(p.x, p.y); await pause(300); }
  await pickSize(9);
  const p = await cellPoint(1, 1); await page.mouse.click(p.x, p.y); await pause(300);
  await page.keyboard.type("hello", { delay: 25 }); await pause(300);
  const g = await renderedSizes();
  ok(`${how}: the word typed into the empty cell renders 9`, g[1][1] === 9, `rendered ${J(g)}`);
  const d = await persisted();
  const g2 = await renderedSizes();
  ok(`${how}: …and still 9 after a reload`, g2[1][1] === 9, `stored ${J(cellSizes(d)[1])}`);
}

console.log("\n=== NEW-1 — part of the text in one cell; the other formatting on a row selection ===");
await seed();
await enter(1, 0);
{ const p = await cellPoint(1, 2); await page.mouse.click(p.x, p.y); await pause(300); await key("Home"); await page.keyboard.down("Shift"); for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight"); await page.keyboard.up("Shift"); await pause(250); }
await pickSize(9);
{ const inCell = await page.evaluate(() => { const c = document.querySelector(".ProseMirror table").rows[1].cells[2]; return [...c.querySelectorAll("p *")].map((e) => [e.textContent, Math.round(parseFloat(getComputedStyle(e).fontSize))]).filter(([t]) => t); });
  ok("part of one cell's text: only the highlighted part changes", inCell.some(([t, s]) => t === "Texas" && s === 9) && !inCell.some(([t, s]) => /Dept/.test(t) && s === 9), J(inCell)); }
await seed();
await enter(1, 0);
await drag([1, 0], [1, 2]);
await click("nt-bold");
{ const d = await stored(); const t = JSON.stringify(d);
  const row1 = await page.evaluate(() => [...document.querySelector(".ProseMirror table").rows[1].cells].map((c) => { const t = document.createTreeWalker(c, NodeFilter.SHOW_TEXT).nextNode(); return t ? getComputedStyle(t.parentElement).fontWeight : null; }));
  ok("bold on a row selection reaches the FILLED cells", /"bold"/.test(t) && Number(row1[0]) >= 600 && Number(row1[2]) >= 600, J(row1)); }
{ const p = await cellPoint(1, 1); await page.mouse.click(p.x, p.y); await pause(250); await page.keyboard.type("x", { delay: 20 }); await pause(300);
  const w = await page.evaluate(() => { const t = document.createTreeWalker(document.querySelector(".ProseMirror table").rows[1].cells[1], NodeFilter.SHOW_TEXT).nextNode(); return t ? getComputedStyle(t.parentElement).fontWeight : null; });
  ok("bold on a row selection also reaches the EMPTY cell (what is typed there is bold)", Number(w) >= 600, `computed weight ${w}`); }
console.log("\n=== NEW-1 — colour on a row selection reaches the empty cell too ===");
await seed();
await enter(1, 0);
await drag([1, 0], [1, 2]);
{ await page.locator('[data-testid="nt-color"]').first().click(); await pause(300);
  const sw = page.locator('[data-testid="nt-color-popover"] [aria-label="Red"]').first(); const hasSw = await sw.count();
  if (hasSw) { await sw.click(); await pause(400); }
  const p = await cellPoint(1, 1); await page.mouse.click(p.x, p.y); await pause(250); await page.keyboard.type("x", { delay: 20 }); await pause(300);
  const cols = await page.evaluate(() => [0, 1, 2].map((i) => { const t = document.createTreeWalker(document.querySelector(".ProseMirror table").rows[1].cells[i], NodeFilter.SHOW_TEXT).nextNode(); return t ? getComputedStyle(t.parentElement).color : null; }));
  ok("a colour picked for the row colours the filled cells AND the word typed into the empty one", hasSw > 0 && cols[0] === cols[1] && cols[1] === cols[2] && cols[0] === "rgb(192, 57, 43)", `swatch found ${hasSw} · ${J(cols)}`); }

/* ── NEW-2 — a new row / column takes its neighbour's size ────────────────────────────────── */
console.log("\n=== NEW-2 — a new row takes the size of the row it was added from ===");
async function sizedRow1() { await seed(); await enter(1, 0); await drag([1, 0], [1, 2]); await pickSize(9); }
async function newRowCase(name, act, newIdx, wantAll = 9) {
  await sizedRow1();
  const before = (await rowMetrics()).length;
  await act();
  const g = await renderedSizes();
  ok(`${name}: a row was added`, g.length === before + 1, `rows ${g.length}`);
  const bad = wrong(g, range(newIdx, 0, newIdx, 2), wantAll);
  ok(`${name}: the new row's cells (empty) render ${wantAll}`, bad.length === 0, `${bad.join(" ")} · ${J(g)}`);
  const newCells = await page.evaluate((i) => [...document.querySelector(".ProseMirror table").rows[i].cells].map((c) => c.textContent), newIdx);
  ok(`${name}: no cell text carried over`, newCells.every((t) => t === ""), J(newCells));
  // type into the new row's first cell
  const p = await cellPoint(newIdx, 0); await page.mouse.click(p.x, p.y); await pause(300);
  await page.keyboard.type("abc", { delay: 25 }); await pause(300);
  const g2 = await renderedSizes();
  ok(`${name}: typing into the new row's cell renders ${wantAll}`, g2[newIdx][0] === wantAll, J(g2));
  const d = await persisted();
  const g3 = await renderedSizes();
  ok(`${name}: it all holds after a reload`, g3[newIdx][0] === wantAll && wrong(g3, range(newIdx, 1, newIdx, 2), wantAll).length === 0, `${J(g3)} stored ${J(cellSizes(d))}`);
}
const caretIn = async (r, c) => { const p = await cellPoint(r, c); await page.mouse.click(p.x, p.y); await pause(300); };
await newRowCase("Row ↓ (add row below)", async () => { await caretIn(1, 1); await click("nt-row-after"); }, 2);
await newRowCase("Row ↑ (add row above) a sized row", async () => { await caretIn(1, 1); await click("nt-row-before"); }, 1);

{
  await seed(); await enter(3, 0); await drag([3, 0], [3, 2]); await pickSize(9);
  await caretIn(3, 2); await key("Tab");
  const g = await renderedSizes();
  ok("Tab out of the last cell adds a row", g.length === 5, `rows ${g.length}`);
  ok("…whose cells take the last row's size (9)", wrong(g, range(4, 0, 4, 2), 9).length === 0, J(g));
}
{
  await seed(); await enter(0, 0); await drag([0, 0], [0, 2]); await pickSize(14);
  await caretIn(0, 1); await click("nt-row-before");
  const g = await renderedSizes();
  ok("a NEW TOP row (Row ↑ on the first row) takes the size of the row below it (14)", g.length === 5 && wrong(g, range(0, 0, 0, 2), 14).length === 0, J(g));
}
console.log("\n=== NEW-2 — a new column follows the same rule (same size, row by row) ===");
{
  await seed(); await enter(1, 0); await drag([1, 0], [1, 2]); await pickSize(9);
  await caretIn(1, 1); await click("nt-col-after");
  const g = await renderedSizes();
  ok("Col → : the new column's cell in the sized row renders 9", g[1].length === 4 && g[1][2] === 9, J(g));
  ok("Col → : the other rows' new cells stay at the default (they follow THEIR neighbour)", g[0][2] === BASE_SIZE && g[3][2] === BASE_SIZE, J(g));
  await persisted(); const g2 = await renderedSizes();
  ok("Col → : holds after a reload", g2[1][2] === 9, J(g2));
  await seed(); await enter(1, 0); await drag([1, 0], [1, 2]); await pickSize(9);
  await caretIn(1, 0); await click("nt-col-before");
  const h = await renderedSizes();
  ok("Col ← : the new first column's cell in the sized row renders 9", h[1][0] === 9, J(h));
}
console.log("\n=== NEW-2 — undo takes the whole add-row back in one step ===");
{
  await sizedRow1(); await caretIn(1, 1); await click("nt-row-after");
  await key(`${MOD}+z`);
  const g = await renderedSizes();
  ok("Ctrl+Z removes the added row (one step)", g.length === 4, `rows ${g.length}`);
}

/* ── NEW-3 — dragging a row's height ──────────────────────────────────────────────────────── */
const lineAt = async (r, t = 0) => { const m = (await rowMetrics(t))[r]; const q = await cellPoint(r, 1, t); return { x: q.x, y: Math.round(m.bottom), scale: m.scale }; };
const rowH = async (r, t = 0) => { const m = (await rowMetrics(t))[r]; return (m.bottom - m.top) / m.scale; };
async function dragLine(r, dy, t = 0, { dbl = false } = {}) {
  const l = await lineAt(r, t);
  await page.mouse.move(l.x, l.y - 1); await page.mouse.move(l.x, l.y); await pause(120);
  if (dbl) { await page.mouse.dblclick(l.x, l.y); await pause(500); return l; }
  await page.mouse.down(); await page.mouse.move(l.x, l.y + dy / 2, { steps: 5 }); await page.mouse.move(l.x, l.y + dy, { steps: 5 }); await page.mouse.up(); await pause(500);
  return l;
}
const cursorOverLine = async (r) => {
  const l = await lineAt(r);
  await page.mouse.move(l.x, l.y - 3); await page.mouse.move(l.x, l.y); await pause(150);
  return page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return { cls: document.querySelector(".ProseMirror").classList.contains("planyr-row-resize"), cursor: el ? getComputedStyle(el).cursor : null }; }, [l.x, l.y]);
};
console.log("\n=== NEW-3 — row height: the cursor, taller, shorter, reload ===");
await seed(); await enter(1, 0);
{
  const c = await cursorOverLine(1);
  ok("over the line under a row the cursor shows it can be dragged (↕)", c.cursor === "row-resize" && c.cls, J(c));
  const h0 = await rowH(1);
  const l = await dragLine(1, 40);
  const h1 = await rowH(1);
  ok("dragging the line DOWN makes the row taller by the dragged amount", Math.abs((h1 - h0) - 40 / l.scale) < 3, `${h0.toFixed(1)} → ${h1.toFixed(1)} (asked +${(40 / l.scale).toFixed(1)})`);
  let d = await stored();
  ok("…and the height is STORED on the row", Math.abs((rowHeights(d)[1] ?? 0) - h1) < 3, J(rowHeights(d)));
  ok("only that row changed", rowHeights(d).filter((v, i) => i !== 1).every((v) => v == null), J(rowHeights(d)));
  d = await persisted();
  const h2 = await rowH(1);
  ok("it holds after a reload", Math.abs(h2 - h1) < 3 && Math.abs((rowHeights(d)[1] ?? 0) - h1) < 3, `${h1.toFixed(1)} → ${h2.toFixed(1)} · ${J(rowHeights(d))}`);
  await enter(1, 0);
  await dragLine(1, -25);
  const h3 = await rowH(1);
  ok("dragging the line UP makes it shorter again", h3 < h2 - 10 && h3 > h0, `${h2.toFixed(1)} → ${h3.toFixed(1)} (text needs ${h0.toFixed(1)})`);
  d = await persisted();
  ok("…and that holds after a reload", Math.abs((await rowH(1)) - h3) < 3, J(rowHeights(d)));
  await enter(1, 0);
  await dragLine(1, -300);
  const h4 = await rowH(1);
  d = await stored();
  ok("dragged far shorter, the row stops at the height its text needs (never clips)", Math.abs(h4 - h0) < 3, `${h4.toFixed(1)} vs ${h0.toFixed(1)}`);
  ok("…and stores NO height (auto again)", rowHeights(d)[1] == null, J(rowHeights(d)));
  await dragLine(1, 50); await key(`${MOD}+z`);
  ok("Ctrl+Z takes a drag back in ONE step", Math.abs((await rowH(1)) - h0) < 3, `${(await rowH(1)).toFixed(1)}`);
}
console.log("\n=== NEW-3 — empty rows, the first row, the last row ===");
for (const [name, r] of [["an EMPTY row", 2], ["the FIRST row", 0], ["the LAST row", 3]]) {
  await seed(); await enter(1, 0);
  const h0 = await rowH(r);
  const l = await dragLine(r, 36);
  const h1 = await rowH(r);
  ok(`${name}: taller by the dragged amount`, Math.abs((h1 - h0) - 36 / l.scale) < 3, `${h0.toFixed(1)} → ${h1.toFixed(1)}`);
  const d = await persisted();
  ok(`${name}: holds after a reload`, Math.abs((await rowH(r)) - h1) < 3, J(rowHeights(d)));
}
console.log("\n=== NEW-3 — a row that WRAPS ===");
{
  const long = "Texas Commission on Environmental Quality industrial wastewater discharge permit renewal application";
  await seed(DOC({ type: "table", content: [row(cell("Permit"), cell(long), cell("Authority")), row(cell("B"), cell("C"), cell("D"))] }));
  await enter(0, 0);
  const h0 = await rowH(0);
  ok("(setup) the long cell wraps — the row is taller than a one-line row", h0 > (await rowH(1)) + 20, `${h0.toFixed(1)} vs ${(await rowH(1)).toFixed(1)}`);
  const l = await dragLine(0, 30);
  const h1 = await rowH(0);
  ok("taller: wraps + the extra", Math.abs((h1 - h0) - 30 / l.scale) < 3, `${h0.toFixed(1)} → ${h1.toFixed(1)}`);
  await dragLine(0, -400);
  const h2 = await rowH(0);
  ok("dragged shorter than its wrapped text it stops at the wrapped height (text never clipped)", Math.abs(h2 - h0) < 3, `${h2.toFixed(1)} vs ${h0.toFixed(1)}`);
}
console.log("\n=== NEW-3 — several selected rows; AutoFit by double-click; the column drag still works ===");
{
  await seed(); await enter(1, 0);
  await drag([1, 0], [2, 2]);
  const a0 = await rowH(1); const b0 = await rowH(2);
  const l = await dragLine(1, 30);
  const a1 = await rowH(1); const b1 = await rowH(2);
  ok("with rows 2–3 selected, dragging one line sets BOTH to the same height", Math.abs(a1 - b1) < 2 && a1 > a0 + 15, `${a0.toFixed(1)}/${b0.toFixed(1)} → ${a1.toFixed(1)}/${b1.toFixed(1)}`);
  const d = await stored();
  ok("…both stored", rowHeights(d)[1] != null && rowHeights(d)[2] != null, J(rowHeights(d)));
  await seed(); await enter(1, 0);
  await dragLine(1, 40);
  ok("(setup) a height is set", rowHeights(await stored())[1] != null);
  await dragLine(1, 0, 0, { dbl: true });
  ok("double-clicking the line clears it (AutoFit)", rowHeights(await stored())[1] == null, J(rowHeights(await stored())));
}
{
  await seed(); await enter(1, 0);
  const w0 = await page.evaluate(() => document.querySelector(".ProseMirror table").rows[0].cells[0].getBoundingClientRect().width);
  const r0 = await rowMetrics(); const edge = await page.evaluate(() => { const rc = document.querySelector(".ProseMirror table").rows[0].cells[0].getBoundingClientRect(); return { x: rc.right, y: rc.top + rc.height / 2 }; });
  await page.mouse.move(edge.x - 1, edge.y); await page.mouse.move(edge.x, edge.y); await pause(150);
  const colCursor = await page.evaluate(() => document.querySelector(".ProseMirror").classList.contains("resize-cursor"));
  await page.mouse.down(); await page.mouse.move(edge.x + 30, edge.y, { steps: 6 }); await page.mouse.up(); await pause(400);
  const w1 = await page.evaluate(() => document.querySelector(".ProseMirror table").rows[0].cells[0].getBoundingClientRect().width);
  ok("the COLUMN drag still works (and does not set a row height)", colCursor && w1 > w0 + 15 && rowHeights(await stored()).every((v) => v == null), `col cursor ${colCursor} · ${w0.toFixed(0)} → ${w1.toFixed(0)}`);
}
console.log("\n=== NEW-3 — a row shrinks back when its text size is reduced (auto rows) ===");
{
  await seed(); await enter(1, 0);
  await drag([1, 0], [1, 2]); await pickSize(36);
  const big = await rowH(1);
  await drag([1, 0], [1, 2]); await pickSize(9);
  const small = await rowH(1);
  ok("an auto row follows its text back down (36 → 9)", small < big - 15, `${big.toFixed(1)} → ${small.toFixed(1)}`);
  ok("…and no height was stored", rowHeights(await stored())[1] == null);
}
console.log("\n=== NEW-2 tie-in — a new row also takes the HEIGHT of the row it was added from ===");
{
  await seed(); await enter(1, 0);
  await dragLine(1, 40);
  const h1 = await rowH(1);
  await caretIn(1, 1); await click("nt-row-after");
  const h2 = await rowH(2);
  ok("Row ↓ under a tall row: the new row is the same height", Math.abs(h2 - h1) < 3, `${h1.toFixed(1)} vs ${h2.toFixed(1)}`);
  await key(`${MOD}+z`);
  await caretIn(1, 1); await click("nt-row-before");
  ok("Row ↑ on a tall row: the new row above it is the same height", Math.abs((await rowH(1)) - h1) < 3, `${h1.toFixed(1)} vs ${(await rowH(1)).toFixed(1)}`);
  await persisted();
  ok("…held after a reload", Math.abs((await rowH(1)) - h1) < 3 && Math.abs((await rowH(2)) - h1) < 3);
}
console.log("\n=== NEW-3 — a table pasted from Excel behaves the same ===");
{
  await seed();
  await enter(0, 0);
  const p = await page.evaluate(() => { const r = [...document.querySelectorAll(".ProseMirror p")].find((e) => e.textContent === "Target text").getBoundingClientRect(); return { x: r.right - 4, y: r.top + r.height / 2 }; });
  await page.mouse.click(p.x, p.y); await pause(650); await page.mouse.click(p.x, p.y); await pause(300);
  const { html, text } = loadFixture("excel");
  await page.evaluate(([h, t]) => { const dt = new DataTransfer(); dt.setData("text/html", h); dt.setData("text/plain", t); (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, [html, text]);
  await pause(1200);
  const n = await page.evaluate(() => document.querySelectorAll(".ProseMirror table").length);
  ok("(setup) the Excel table landed as a second table", n === 2, `tables ${n}`);
  if (n === 2) {
    await enter(0, 0, 1);
    const h0 = await rowH(0, 1);
    const l = await dragLine(0, 34, 1);
    const h1 = await rowH(0, 1);
    ok("an Excel-pasted row drags taller", Math.abs((h1 - h0) - 34 / l.scale) < 3, `${h0.toFixed(1)} → ${h1.toFixed(1)}`);
    await persisted();
    ok("…and holds after a reload", Math.abs((await rowH(0, 1)) - h1) < 3);
  }
}

console.log(`\n${passN} passed, ${failN} failed${errs.length ? ` · page errors: ${errs.slice(0, 3).join(" | ")}` : ""}`);
await browser.close();
process.exit(failN ? 1 : 0);
