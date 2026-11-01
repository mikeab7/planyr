/* measure-univer-tti — time to interactive of the Spreadsheet grid: the OLD grid against the Univer grid, both in the REAL app
 * (NEW-1, B2587920 / B2604xxx — docs/SPREADSHEET-UNIVER-SPIKE.md "Load time").
 *
 * Since the cutover (2026-10-31) the Univer grid is what the Spreadsheet tab shows for every account, so BOTH arms are the real built app,
 * signed out, on a local project seeded with the same workbook — no stand-alone host, no admin fake:
 *   --ref-dist  a frozen build of the app from BEFORE the cutover (the old grid), the yardstick. Rebuild it any time with
 *               `git worktree add /tmp/ref 2d9ba19 && (cd /tmp/ref && ln -s <repo>/node_modules . && npm run build)` and pass /tmp/ref/dist.
 *   --cur-dist  the build under test (default `dist`).
 * The workbook is 1,000 rows × 12 columns, the last column a SUM per row. A run ends at the first moment the grid is DRAWN and BOTH the first
 * cell and the LAST formula cell hold a readable number (Univer: its canvas is up and its model holds both; old grid: the page text holds a number).
 * Four arms per grid, each in a BRAND-NEW browser context unless noted:
 *   COLD    navigation straight to #/project/<id>/spreadsheet — cold HTTP cache, the whole app boots. A FIRST visit on this device.
 *   CLICK   the Site route is open and settled; the pointer rests on the Spreadsheet tab (the app's own warm-up), then the tab is clicked. First visit.
 *   REPEAT  the same URL a second time in the SAME context (HTTP cache, compiled-code cache AND the device's calculation cache warm) — a returning user.
 *   RETURN  a returning user's tab click: the workbook was opened (and its results remembered) earlier in this context, then Site route → hover → click.
 * The statement is the MEDIAN of RUNS (default 5); raw runs printed. Also per run: main-thread BLOCKED time (the browser's long tasks inside the window).
 *
 * FOREGROUND-OR-VOID: every page asserts a visible tab with a live rAF before it is timed (lib/tabTiming.mjs).
 * KNOWN-GOOD ARM (clause 6): Univer's last formula cell must equal the independently computed row sum, or the run is VOID, not scored.
 *
 * Usage: node ui-audit/measure-univer-tti.mjs --ref-dist <old-grid build> [--cur-dist dist] [--runs 5] [--rows 1000] [--assert]
 *                                              [--tolerance 0.25] [--json out.json] [--label name] [--only cold,click,repeat]
 *   --assert  exit 1 unless every arm run has median(Univer) <= median(old) × (1 + tolerance). */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { createWorkbook } from "../src/workspaces/model/lib/sheetModel.js";

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const RUNS = Number(val("--runs", 5));
const ROWS = Number(val("--rows", 1000)), COLS = 12;
const TOL = Number(val("--tolerance", 0.25));
const ASSERT = args.includes("--assert");
const JSON_OUT = val("--json", null);
const LABEL = val("--label", "");
const REF_DIST = val("--ref-dist", null);
const CUR_DIST = val("--cur-dist", "dist");
const ONLY = new Set(val("--only", "cold,click,repeat,return").split(","));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REF = "http://localhost:4173", CUR = "http://localhost:4198";
const SETTLE_MS = 1500;                 // how long the pointer "rests" on the tab: the warm-up (idle callback, chunk fetch + evaluate) has to be done

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const r1 = (x) => Math.round(x * 10) / 10;
const fmt = (a, unit = "ms") => `${r1(median(a))} ${unit}  (runs: ${a.map(r1).join(", ")})`;

function rowsWorkbook(rows, cols) {            // one pass: setRaw copies the cell map per call, quadratic at this size
  const wb = createWorkbook(); const sh = wb.sheets[0].sheet; const cells = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells[`${sh.columns[c].id}:${r}`] = c === cols - 1 ? `=SUM(A${r + 1}:${String.fromCharCode(64 + cols - 1)}${r + 1})` : String(((r * 31 + c * 7) % 1000) + 0.5);
  return { ...wb, sheets: [{ ...wb.sheets[0], sheet: { ...sh, rowCount: Math.max(sh.rowCount, rows + 5), cells } }] };
}
const expectedLastSum = () => { let s = 0; for (let c = 0; c < COLS - 1; c++) s += ((((ROWS - 1) * 31 + c * 7) % 1000) + 0.5); return s; };

const servers = [];
// A server left over from an earlier run would silently serve the WRONG build and make the whole measurement meaningless, so a
// port already answering is an error, never reused; each server is its own process group so killing it kills `npx`'s child too.
async function serve(label, outDir, port) {
  const up = await fetch(`http://localhost:${port}/`).catch(() => null);
  if (up) throw new Error(`port ${port} is already serving something — a stale preview would be measured instead of ${label}; stop it and rerun`);
  servers.push(spawn("npx", ["vite", "preview", "--outDir", outDir, "--port", String(port), "--strictPort"], { stdio: "ignore", cwd: ROOT, detached: true }));
  for (let i = 0; i < 80; i++) { const r = await fetch(`http://localhost:${port}/`).catch(() => null); if (r && r.ok) return; await new Promise((r2) => setTimeout(r2, 500)); }
  throw new Error(`${label} did not start on ${port}`);
}
const stopServers = () => { for (const s of servers) { try { process.kill(-s.pid); } catch (_) { try { s.kill(); } catch (__) { /* gone */ } } } };

// Long tasks (the main thread was blocked ≥ 50 ms) — recorded from the page's start, read back with the window the run cared about.
const LONGTASK_INIT = () => { window.__PLANYR_E2E = true; window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true }); } catch (_) { /* unsupported */ } };
const blocked = (page, fromMark) => page.evaluate((from) => { const lt = (window.__lt || []).filter(([s]) => s >= from); return { sum: lt.reduce((a, [, d]) => a + d, 0), worst: lt.reduce((a, [, d]) => Math.max(a, d), 0) }; }, fromMark);

// "ready": old grid — the page text holds a decimal; Univer — the canvas is up and its model holds the first cell AND the last formula cell.
const OLD_READY = () => { const s = document.querySelector('[data-testid="model-sheet"]'); return !!s && /\d\.\d/.test(s.innerText); };
const UNI_READY = ([lr, lc]) => { const a = window.__planyrUniverRead && window.__planyrUniverRead.api(); const ws = a && a.getActiveWorkbook() && a.getActiveWorkbook().getActiveSheet(); try { return !!ws && !!document.querySelector('[data-testid="univer-grid"] canvas') && typeof ws.getRange(0, 0).getValue() === "number" && typeof ws.getRange(lr, lc).getValue() === "number"; } catch (_) { return false; } };

async function main() {
  if (!REF_DIST) throw new Error("--ref-dist is required: a build of the app from before the cutover (see the header)");
  for (const d of [REF_DIST, CUR_DIST]) if (!existsSync(resolve(ROOT, d))) throw new Error(`build first — ${d} is missing (see the header)`);
  await serve("reference (old grid) preview", REF_DIST, 4173);
  await serve("current preview", CUR_DIST, 4198);
  const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const wb = rowsWorkbook(ROWS, COLS);
  const R = {}; for (const k of ["cold", "click", "repeat", "return"]) R[k] = { old: [], uni: [], oldBlock: [], uniBlock: [] };
  let voided = null;

  const newPage = async (ctx, pid) => {
    const site = { id: pid, groupId: pid, site: "ZZ tti", name: "ZZ tti", origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [] };
    const page = await ctx.newPage();
    await page.addInitScript(LONGTASK_INIT);
    await page.addInitScript(([sid, rec, key, w]) => { try { if (!localStorage.getItem(key)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: rec })); localStorage.setItem(key, JSON.stringify(w)); } } catch (_) { /* private mode */ } }, [pid, site, `planyr:model:sheet:v1:local:${pid}`, wb]);
    return page;
  };
  const ready = async (page, kind) => {
    if (kind === "old") await page.waitForFunction(OLD_READY, null, { timeout: 90000, polling: 25 });
    else await page.waitForFunction(UNI_READY, [ROWS - 1, COLS - 1], { timeout: 90000, polling: 25 });
  };
  const knownGood = async (page) => {
    const got = await page.evaluate(([lr, lc]) => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange(lr, lc).getValue(), [ROWS - 1, COLS - 1]);
    if (Math.abs(got - expectedLastSum()) > 1e-6) voided = `the last formula cell read ${got}, the workbook says ${expectedLastSum()}`;
  };
  const record = async (arm, kind, page, ms, mark) => {
    R[arm][kind].push(ms);
    const b = await blocked(page, mark); R[arm][kind + "Block"].push(b.sum);
    if (kind === "uni") await knownGood(page);
  };
  const newCtx = () => browser.newContext({ viewport: { width: 1440, height: 900 } });

  for (let i = 0; i < RUNS; i++) {
    for (const [kind, base] of [["old", REF], ["uni", CUR]]) {
      const pid = `zz-tti-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
      if (ONLY.has("cold") || ONLY.has("repeat")) {
        const ctx = await newCtx(); const page = await newPage(ctx, pid);
        await page.goto("about:blank"); await assertMeasurable(page, "measure-univer-tti");
        const t0 = Date.now(); await page.goto(`${base}/#/project/${pid}/spreadsheet`, { waitUntil: "commit" });
        await ready(page, kind);
        if (ONLY.has("cold")) await record("cold", kind, page, Date.now() - t0, 0);
        if (ONLY.has("repeat")) {                      // the SAME context, a moment later: caches warm, a new tab load
          await page.waitForTimeout(3500);               // long enough for the device-local calculation cache to be written (debounced ~1.2 s after the results settle)
          await page.goto("about:blank");
          const page2 = await newPage(ctx, pid); await page.close();
          const mark = 0; const t1 = Date.now(); await page2.goto(`${base}/#/project/${pid}/spreadsheet`, { waitUntil: "commit" });
          await ready(page2, kind); await record("repeat", kind, page2, Date.now() - t1, mark);
        }
        await ctx.close();
      }
      if (ONLY.has("return")) {
        const ctx = await newCtx(); const first = await newPage(ctx, pid);
        await first.goto(`${base}/#/project/${pid}/spreadsheet`, { waitUntil: "load" }); await ready(first, kind); await first.waitForTimeout(3500); await first.close();
        const page = await newPage(ctx, pid);
        await page.goto(`${base}/#/project/${pid}`, { waitUntil: "load" });
        const tab = page.locator('[data-testid="module-tab-model"]').first(); await tab.waitFor({ timeout: 60000 });
        await page.waitForTimeout(1500); await assertMeasurable(page, "measure-univer-tti");
        await tab.hover(); await page.waitForTimeout(SETTLE_MS);
        const mark = await page.evaluate(() => performance.now()); const t0 = Date.now(); await tab.click();
        await ready(page, kind); await record("return", kind, page, Date.now() - t0, mark);
        await ctx.close();
      }
      if (ONLY.has("click")) {
        const ctx = await newCtx(); const page = await newPage(ctx, pid);
        await page.goto(`${base}/#/project/${pid}`, { waitUntil: "load" });
        const tab = page.locator('[data-testid="module-tab-model"]').first(); await tab.waitFor({ timeout: 60000 });
        await page.waitForTimeout(1500);      // the Site route settles first: this arm times the TAB CLICK, not the boot
        await assertMeasurable(page, "measure-univer-tti");
        await tab.hover(); await page.waitForTimeout(SETTLE_MS);
        const mark = await page.evaluate(() => performance.now()); const t0 = Date.now(); await tab.click();
        await ready(page, kind); await record("click", kind, page, Date.now() - t0, mark);
        await ctx.close();
      }
    }
  }
  await browser.close();
  stopServers();

  console.log(`\nTIME TO INTERACTIVE — ${ROWS}-row × ${COLS}-column sheet, real app both sides, median of ${RUNS}, localhost${LABEL ? "  [" + LABEL + "]" : ""}`);
  const ratios = {}; let pass = !voided;
  for (const arm of ["cold", "click", "repeat", "return"]) {
    if (!ONLY.has(arm)) continue;
    const a = R[arm]; const ratio = median(a.uni) / median(a.old); ratios[arm] = ratio;
    console.log(`  ${arm.toUpperCase().padEnd(6)} old grid ${fmt(a.old)}   blocked ${fmt(a.oldBlock)}`);
    console.log(`         Univer   ${fmt(a.uni)}   blocked ${fmt(a.uniBlock)}`);
    console.log(`         ratio Univer / old = ${ratio.toFixed(2)}   (target ≤ ${(1 + TOL).toFixed(2)})`);
    if (ratio > 1 + TOL) pass = false;
  }
  if (voided) console.log(`  ⚠ VOID — the known-good arm failed: ${voided}`);
  console.log(`  verdict: ${voided ? "VOID" : pass ? "PASS" : "OVER TARGET"}`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), label: LABEL, runs: RUNS, rows: ROWS, ...R, ratios, voided }, null, 2));
  if (ASSERT && !pass) process.exit(1);
}
main().catch((e) => { console.error(e); stopServers(); process.exit(1); });
