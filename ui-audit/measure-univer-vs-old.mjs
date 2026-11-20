/* measure-univer-vs-old — the spike's numbers (docs/SPREADSHEET-UNIVER-SPIKE.md), measured in ONE Chromium on ONE machine:
 *   A  recalc        5,000 dependent formulas, Planyr's engine vs Univer's (a deep chain AND a wide fan), first calc + one edit
 *   B  memory        JS heap after loading the largest real fixture and a large synthetic sheet, old grid (real app) vs Univer
 *   C  first paint   a 1,000-row sheet: navigation -> first value readable, old grid (real app, built) vs Univer (built sandbox)
 * Production BUILDS are measured, never the dev server. Foreground tab asserted (FOREGROUND-OR-VOID); timing never uses
 * setTimeout inside a timed section. Each figure is the median of RUNS runs; the raw runs are printed.
 * Usage: node ui-audit/measure-univer-vs-old.mjs [--runs 3] [--json out.json]
 *   needs:  npm run build            (-> dist/, the real app)
 *           npx vite build --config ui-audit/univer-sandbox/vite.config.mjs   (-> dist-univer-sandbox/) */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { createWorkbook, setRaw, migrateWorkbook } from "../src/workspaces/model/lib/sheetModel.js";
import { parseSpreadsheetFile } from "../src/workspaces/model/lib/spreadsheetFile.js";

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const RUNS = Number(val("--runs", 3));
const JSON_OUT = val("--json", null);
const SECTIONS = val("--sections", "A,B,C").split(",");
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const fmt = (a, unit = "ms") => `${Math.round(median(a) * 10) / 10} ${unit}  (runs: ${a.map((x) => Math.round(x * 10) / 10).join(", ")})`;

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function chainWorkbook(n) {            // A1 = 1, A2 = A1+1, … A{n}: depth n
  const wb = createWorkbook(); let sh = wb.sheets[0].sheet;
  sh = { ...sh, rowCount: Math.max(sh.rowCount, n + 5) };
  sh = setRaw(sh, 0, 0, "1");
  for (let r = 1; r < n; r++) sh = setRaw(sh, r, 0, `=A${r}+1`);
  return { ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] };
}
function fanWorkbook(n) {              // inputs in A, one formula per row in B reading its own input and a shared one: depth 1
  const wb = createWorkbook(); let sh = wb.sheets[0].sheet;
  sh = { ...sh, rowCount: Math.max(sh.rowCount, n + 5) };
  sh = setRaw(sh, 0, 3, "1.5");
  for (let r = 0; r < n; r++) { sh = setRaw(sh, r, 0, String(r + 1)); sh = setRaw(sh, r, 1, `=A${r + 1}*$D$1+SUM(A${Math.max(1, r)}:A${r + 1})`); }
  return { ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] };
}
function rowsWorkbook(rows, cols, formulas = false) {   // built in ONE pass: setRaw copies the whole cell map per call, which is quadratic at 60k cells
  const wb = createWorkbook(); const sh = wb.sheets[0].sheet;
  const cells = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells[`${sh.columns[c].id}:${r}`] = formulas && c === cols - 1 ? `=SUM(A${r + 1}:${String.fromCharCode(64 + cols - 1)}${r + 1})` : String(((r * 31 + c * 7) % 1000) + 0.5);
  return { ...wb, sheets: [{ ...wb.sheets[0], sheet: { ...sh, rowCount: Math.max(sh.rowCount, rows + 5), cells } }] };
}
async function largestFixture() {
  let best = null;
  for (const name of ["chart.xlsx", "legacy.xls"]) {
    const bytes = new Uint8Array(readFileSync(new URL(`../test/fixtures/spreadsheet/${name}`, import.meta.url)));
    try { const { workbook } = await parseSpreadsheetFile(bytes, name); const n = workbook.sheets.reduce((s, x) => s + Object.keys(x.sheet.cells).length, 0); if (!best || n > best.cells) best = { name, cells: n, workbook }; } catch (_) { /* a fixture that does not parse is not the largest */ }
  }
  return best;
}

// ── servers ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const servers = [];
async function serve(label, argv, port, path) {
  const up = await fetch(`http://localhost:${port}${path}`).catch(() => null);
  if (up && up.ok) return;
  servers.push(spawn("npx", argv, { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname }));
  for (let i = 0; i < 60; i++) { const r = await fetch(`http://localhost:${port}${path}`).catch(() => null); if (r && r.ok) return; await new Promise((r2) => setTimeout(r2, 500)); }
  throw new Error(`${label} did not start on ${port}`);
}
const APP = "http://localhost:4173", SANDBOX = "http://localhost:4198";
const SANDBOX_PATH = "/ui-audit/univer-sandbox/index.html";

const results = {};
async function main() {
  if (!existsSync(new URL("../dist/index.html", import.meta.url)) || !existsSync(new URL("../dist-univer-sandbox", import.meta.url))) throw new Error("build first: npm run build  AND  npx vite build --config ui-audit/univer-sandbox/vite.config.mjs");
  await serve("app preview", ["vite", "preview", "--port", "4173", "--strictPort"], 4173, "/");
  await serve("sandbox preview", ["vite", "preview", "--config", "ui-audit/univer-sandbox/vite.config.mjs", "--outDir", "dist-univer-sandbox", "--port", "4198", "--strictPort"], 4198, SANDBOX_PATH);
  const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
  const newPage = async (base, path, init) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); if (init) await page.addInitScript(init.fn, init.arg);
    await page.goto(base + path, { waitUntil: "load" }); return { ctx, page };
  };
  const heap = (page) => page.evaluate(async () => { for (let i = 0; i < 4; i++) { window.gc && window.gc(); await new Promise((r) => setTimeout(r, 60)); } return performance.memory.usedJSHeapSize / 1048576; });
  const tick = (page) => page.evaluate(() => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); }));

  // ── A. recalc ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (SECTIONS.includes("A")) {
  console.log("\nA. RECALC — 5,000 dependent formulas, both engines, one Chromium");
  results.recalc = {};
  // editCell = the input whose change ripples to the LAST formula: the head of the chain, or the shared multiplier D1 of the fan
  for (const [shape, wb, lastRow, editCell] of [["chain (depth 5000)", chainWorkbook(5000), 4999, [0, 0]], ["fan (5000 wide)", fanWorkbook(5000), 4999, [0, 3]]]) {
    const oldFirst = [], oldEdit = [], uniFirst = [], uniEdit = [];
    for (let i = 0; i < RUNS; i++) {
      const { ctx, page } = await newPage(SANDBOX, SANDBOX_PATH);
      await page.waitForFunction(() => window.__planyrUniverRead && window.__planyrUniverRead.api() && window.__sandboxLoad);
      await assertMeasurable(page, "measure-univer-vs-old");
      const o = await page.evaluate(([w, ec]) => {
        const { evaluateWorkbook, migrateWorkbook } = window.__oldEngine;
        const m = migrateWorkbook(w); const t0 = performance.now(); const ev = evaluateWorkbook(m, {}); const first = performance.now() - t0;
        const col = m.sheets[0].sheet.columns[ec[1]].id; const ed = { ...m, sheets: [{ ...m.sheets[0], sheet: { ...m.sheets[0].sheet, cells: { ...m.sheets[0].sheet.cells, [`${col}:${ec[0]}`]: "2" } } }] };
        const t1 = performance.now(); evaluateWorkbook(ed, {}); return { first, edit: performance.now() - t1 };
      }, [wb, editCell]);
      oldFirst.push(o.first); oldEdit.push(o.edit);
      const col = shape.startsWith("chain") ? 0 : 1;
      const want0 = shape.startsWith("chain") ? 5000 : null;
      // Univer: hand the workbook over, time until the LAST formula cell holds a number
      const u = await page.evaluate(async ([w, lr, c, ec]) => {
        const tick = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
        const t0 = performance.now(); window.__sandboxLoad(w, {});
        const num = (ws, r, cc) => { try { const v = ws.getRange(r, cc).getValue(); return typeof v === "number" ? v : null; } catch (_) { return null; } };   // out-of-bounds = the previous 1000-row workbook is still showing: not ready
        let api, ws; for (;;) { api = window.__planyrUniverRead.api(); ws = api && api.getActiveWorkbook() && api.getActiveWorkbook().getActiveSheet(); if (ws && num(ws, lr, c) !== null) break; await tick(); if (performance.now() - t0 > 120000) return { timeout: true }; }
        const first = performance.now() - t0; const before = num(ws, lr, c);
        const t1 = performance.now(); ws.getRange(ec[0], ec[1]).setValue(2);
        for (;;) { const v = num(ws, lr, c); if (v !== null && v !== before) break; await tick(); if (performance.now() - t1 > 120000) return { timeout: true, first }; }
        return { first, edit: performance.now() - t1 };
      }, [wb, lastRow, col, editCell]);
      if (u.timeout) console.log("   Univer timed out", JSON.stringify(u)); else { uniFirst.push(u.first); uniEdit.push(u.edit); }
      await ctx.close(); void want0;
    }
    results.recalc[shape] = { oldFirst, oldEdit, uniFirst, uniEdit };
    console.log(`   ${shape}\n     Planyr engine  first calc ${fmt(oldFirst)}\n                    one edit (full re-evaluate) ${fmt(oldEdit)}\n     Univer         load + first calc ${fmt(uniFirst)}\n                    one edit to A1, last cell updated ${fmt(uniEdit)}`);
  }

  }
  // ── B. memory ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (SECTIONS.includes("B")) {
  console.log("\nB. MEMORY — JS heap (after forced GC) with the workbook loaded, minus the same page with a blank workbook");
  const big = await largestFixture();
  const fixtures = [[`largest real fixture (${big ? big.name + ", " + big.cells + " cells" : "none"})`, big ? big.workbook : createWorkbook()], ["large synthetic (5,000 rows × 12 columns + a formula per row)", rowsWorkbook(5000, 12, true)]];
  results.memory = {};
  for (const [label, wb] of fixtures) {
    const oldD = [], uniD = [];
    for (let i = 0; i < RUNS; i++) {
      // old grid = the real built app, signed out, workbook seeded into the local project's slot
      const pid = `zz-measure-${Date.now().toString(36)}${i}`;
      const site = { id: pid, groupId: pid, site: "ZZ measure", name: "ZZ measure", origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [] };
      const open = async (workbook) => {
        const { ctx, page } = await newPage(APP, "/", { fn: ([sid, rec, key, w]) => { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: rec })); localStorage.setItem(key, JSON.stringify(w)); }, arg: [pid, site, `planyr:model:sheet:v1:local:${pid}`, workbook] });
        await page.goto(`${APP}/#/project/${pid}/spreadsheet`, { waitUntil: "load" }); await page.waitForSelector('[data-testid="model-sheet"]', { timeout: 90000 }); await page.waitForTimeout(1500); return { ctx, page };
      };
      const blank = await open(createWorkbook()); const h0 = await heap(blank.page); await blank.ctx.close();
      const loaded = await open(wb); const h1 = await heap(loaded.page); await loaded.ctx.close(); oldD.push(h1 - h0);
      const u0 = await newPage(SANDBOX, SANDBOX_PATH); await u0.page.waitForFunction(() => window.__planyrUniverRead && window.__planyrUniverRead.api()); await u0.page.waitForTimeout(1500); const g0 = await heap(u0.page);
      await u0.page.evaluate(([w]) => window.__sandboxLoad(w, {}), [wb]); await u0.page.waitForTimeout(4000); const g1 = await heap(u0.page); await u0.ctx.close(); uniD.push(g1 - g0);
    }
    results.memory[label] = { oldD, uniD }; console.log(`   ${label}\n     old grid  +${fmt(oldD, "MB")}\n     Univer    +${fmt(uniD, "MB")}`);
  }

  }
  // ── C. first paint, 1,000 rows ─────────────────────────────────────────────────────────────────────────────────────────
  if (SECTIONS.includes("C")) {
  console.log("\nC. FIRST PAINT — a 1,000-row × 12-column sheet, navigation → first value readable (production builds, localhost)");
  const w1000 = rowsWorkbook(1000, 12, true); const oldT = [], uniT = [], uniMount = [];
  for (let i = 0; i < RUNS; i++) {
    const pid = `zz-tti-${Date.now().toString(36)}${i}`; const site = { id: pid, groupId: pid, site: "ZZ tti", name: "ZZ tti", origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [] };
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
    await page.addInitScript(([sid, rec, key, w]) => { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: rec })); localStorage.setItem(key, JSON.stringify(w)); }, [pid, site, `planyr:model:sheet:v1:local:${pid}`, w1000]);
    const t0 = Date.now(); await page.goto(`${APP}/#/project/${pid}/spreadsheet`, { waitUntil: "commit" });
    await page.waitForFunction(() => { const s = document.querySelector('[data-testid="model-sheet"]'); return !!s && /\d\.\d/.test(s.innerText); }, null, { timeout: 90000, polling: 25 });
    oldT.push(Date.now() - t0); await ctx.close();
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const p2 = await c2.newPage();
    await p2.addInitScript((w) => { window.__sandboxInitial = w; }, w1000);
    const t1 = Date.now(); await p2.goto(SANDBOX + SANDBOX_PATH, { waitUntil: "commit" });
    await p2.waitForFunction(() => { const a = window.__planyrUniverRead && window.__planyrUniverRead.api(); const ws = a && a.getActiveWorkbook() && a.getActiveSheet && a.getActiveWorkbook().getActiveSheet(); try { return !!ws && typeof ws.getRange(0, 0).getValue() === "number" && typeof ws.getRange(999, 11).getValue() === "number"; } catch (_) { return false; } }, null, { timeout: 90000, polling: 25 });
    await tick(p2); uniT.push(Date.now() - t1);
    const mt = await p2.evaluate(() => performance.getEntriesByType("measure").length); void mt; await c2.close();
  }
  results.firstPaint = { oldT, uniT };
  console.log(`   old grid (whole app: shell + lazy Spreadsheet chunk + grid)  ${fmt(oldT)}\n   Univer (host page + Univer chunk + engine + first calc)        ${fmt(uniT)}`);
  }
  await browser.close();
  for (const s of servers) s.kill();
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), runs: RUNS, results }, null, 2));
}
main().catch((e) => { console.error(e); for (const s of servers) s.kill(); process.exit(1); });
