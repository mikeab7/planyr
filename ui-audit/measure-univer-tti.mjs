/* measure-univer-tti — time to interactive of the Spreadsheet grid, the old grid against the Univer grid (NEW-1, B2587264 —
 * docs/SPREADSHEET-UNIVER-SPIKE.md cutover step 4, load time).
 *
 * WHAT IT MEASURES, stated so the number is not over-read. A 1,000-row × 12-column sheet (the last column a formula per row) is
 * seeded; EVERY run opens a BRAND-NEW browser context (cold HTTP cache, no service worker). A run ends at the first moment BOTH the
 * first cell and the LAST formula cell hold a readable number (so Univer's formula pass is inside the figure, never skipped).
 * Two arms, each for both grids:
 *   COLD   navigation → values.  old = the real built app on #/project/<id>/spreadsheet (shell boots, Spreadsheet chunk loads, grid draws);
 *          Univer = ui-audit/univer-sandbox/lazy.html mounting the real component through React.lazy (host page + the Univer chunk
 *          + its formula worker + engine + first calculation). The sandbox has no app shell, so Univer's figure is a floor, not the
 *          signed-in figure — that one is the V# live check (ui-audit/verify-univer-live.mjs + verify-univer-load-live.mjs).
 *   CLICK  the tab click → values, after the pointer rested on the tab long enough for the app's own warm-up to finish.
 *          old = the real app: Site route, hover + click the Spreadsheet tab (src/app/modulePrefetch.js warms the chunk);
 *          Univer = lazy.html: window.__warm() (src/workspaces/model/lib/univerWarm.js — what that hover does) then __mountUniver().
 * The statement is the MEDIAN of RUNS (default 5); raw runs printed. Also per run: the main thread's BLOCKED time (sum and worst
 * of the browser's long tasks inside the window — what the user feels as a frozen page), JS files / bytes transferred, and — the
 * other half of the target — how many hyphenation language files the ENGLISH sheet asked for.
 *
 * FOREGROUND-OR-VOID: every page asserts a visible tab with a live rAF before it is timed (lib/tabTiming.mjs).
 * KNOWN-GOOD ARM (clause 6): Univer's last formula cell must equal the independently computed row sum, or the run is VOID, not
 * scored; and the language-file detector (lib/univerLangFiles.mjs) is proven against the real file names by test/univerPrune.test.js.
 *
 * Usage: node ui-audit/measure-univer-tti.mjs [--runs 5] [--rows 1000] [--assert] [--tolerance 0.25] [--json out.json]
 *                                              [--app-dist dist] [--sandbox-dist dist-univer-sandbox] [--label before|after]
 *   needs: npm run build   AND   NODE_OPTIONS=--max-old-space-size=4096 npx vite build --config ui-audit/univer-sandbox/vite.config.mjs
 *   --assert  exit 1 unless, in BOTH arms, median(Univer) <= median(old) × (1 + tolerance) AND no hyphenation file was requested. */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { isLangFile } from "./lib/univerLangFiles.mjs";
import { createWorkbook } from "../src/workspaces/model/lib/sheetModel.js";

const args = process.argv.slice(2);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const RUNS = Number(val("--runs", 5));
const ROWS = Number(val("--rows", 1000)), COLS = 12;
const TOL = Number(val("--tolerance", 0.25));
const ASSERT = args.includes("--assert");
const JSON_OUT = val("--json", null);
const LABEL = val("--label", "");
const APP_DIST = val("--app-dist", "dist");
const SANDBOX_DIST = val("--sandbox-dist", "dist-univer-sandbox");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP = "http://localhost:4173", SANDBOX = "http://localhost:4198";
const LAZY = `${SANDBOX}/ui-audit/univer-sandbox/lazy.html`;
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
async function serve(label, argv, port, path) {
  const up = await fetch(`http://localhost:${port}${path}`).catch(() => null);
  if (up) throw new Error(`port ${port} is already serving something — a stale preview would be measured instead of ${label}; stop it and rerun`);
  servers.push(spawn("npx", argv, { stdio: "ignore", cwd: ROOT, detached: true }));
  for (let i = 0; i < 80; i++) { const r = await fetch(`http://localhost:${port}${path}`).catch(() => null); if (r && r.ok) return; await new Promise((r2) => setTimeout(r2, 500)); }
  throw new Error(`${label} did not start on ${port}`);
}
const stopServers = () => { for (const s of servers) { try { process.kill(-s.pid); } catch (_) { try { s.kill(); } catch (__) { /* gone */ } } } };

// Long tasks (the main thread was blocked ≥ 50 ms) — recorded from the page's start, read back with the window the run cared about.
const LONGTASK_INIT = () => { window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true }); } catch (_) { /* unsupported: reported as null */ } };
const blocked = (page, fromMark) => page.evaluate((from) => { const lt = (window.__lt || []).filter(([s]) => s >= from); return { sum: lt.reduce((a, [, d]) => a + d, 0), worst: lt.reduce((a, [, d]) => Math.max(a, d), 0), n: lt.length }; }, fromMark);

const LAST_VALUE_READY = ([lr, lc]) => { const a = window.__planyrUniverRead && window.__planyrUniverRead.api(); const ws = a && a.getActiveWorkbook() && a.getActiveWorkbook().getActiveSheet(); try { return !!ws && typeof ws.getRange(0, 0).getValue() === "number" && typeof ws.getRange(lr, lc).getValue() === "number"; } catch (_) { return false; } };

async function main() {
  for (const d of [APP_DIST, SANDBOX_DIST]) if (!existsSync(resolve(ROOT, d))) throw new Error(`build first — ${d} is missing (see the header)`);
  await serve("app preview", ["vite", "preview", "--outDir", APP_DIST, "--port", "4173", "--strictPort"], 4173, "/");
  await serve("sandbox preview", ["vite", "preview", "--config", "ui-audit/univer-sandbox/vite.config.mjs", "--outDir", SANDBOX_DIST, "--port", "4198", "--strictPort"], 4198, "/ui-audit/univer-sandbox/lazy.html");
  const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const wb = rowsWorkbook(ROWS, COLS);
  const R = { oldCold: [], uniCold: [], oldClick: [], uniClick: [], oldColdBlock: [], uniColdBlock: [], oldClickBlock: [], uniClickBlock: [], uniColdWorst: [], uniClickWorst: [], oldColdWorst: [], oldClickWorst: [], files: [], gz: [], raw: [], lang: [] };
  let voided = null;

  const newOldPage = async () => {
    const pid = `zz-tti-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const site = { id: pid, groupId: pid, site: "ZZ tti", name: "ZZ tti", origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [] };
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
    await page.addInitScript(LONGTASK_INIT);
    await page.addInitScript(([sid, rec, key, w]) => { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: rec })); localStorage.setItem(key, JSON.stringify(w)); }, [pid, site, `planyr:model:sheet:v1:local:${pid}`, wb]);
    return { ctx, page, pid };
  };
  const oldValues = (page) => page.waitForFunction(() => { const s = document.querySelector('[data-testid="model-sheet"]'); return !!s && /\d\.\d/.test(s.innerText); }, null, { timeout: 90000, polling: 25 });
  const newUniPage = async (track) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
    const reqs = [];
    if (track) page.on("response", async (resp) => { try { const u = resp.url(); if (!/\.js(\?|$)/.test(u)) return; const body = await resp.body(); reqs.push({ u, raw: body.length, gz: gzipSync(body, { level: 9 }).length }); } catch (_) { /* a response that went away */ } });
    await page.addInitScript(LONGTASK_INIT);
    return { ctx, page, reqs };
  };
  const uniValues = (page) => page.waitForFunction(LAST_VALUE_READY, [ROWS - 1, COLS - 1], { timeout: 90000, polling: 25 });
  const knownGood = async (page) => {
    const got = await page.evaluate(([lr, lc]) => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange(lr, lc).getValue(), [ROWS - 1, COLS - 1]);
    if (Math.abs(got - expectedLastSum()) > 1e-6) voided = `the last formula cell read ${got}, the workbook says ${expectedLastSum()}`;
  };

  for (let i = 0; i < RUNS; i++) {
    // ── COLD · old grid ──
    { const { ctx, page, pid } = await newOldPage();
      await page.goto("about:blank"); await assertMeasurable(page, "measure-univer-tti");
      const t0 = Date.now(); await page.goto(`${APP}/#/project/${pid}/spreadsheet`, { waitUntil: "commit" });
      await oldValues(page); R.oldCold.push(Date.now() - t0);
      const b = await blocked(page, 0); R.oldColdBlock.push(b.sum); R.oldColdWorst.push(b.worst); await ctx.close(); }

    // ── COLD · Univer ──
    { const { ctx, page, reqs } = await newUniPage(true);
      await page.goto("about:blank"); await assertMeasurable(page, "measure-univer-tti");
      const t0 = Date.now(); await page.goto(LAZY, { waitUntil: "commit" });
      await page.waitForFunction(() => window.__hostReady === true, null, { timeout: 60000, polling: 10 });
      await page.evaluate((w) => window.__mountUniver(w), wb);
      await uniValues(page); R.uniCold.push(Date.now() - t0);
      await knownGood(page);
      const b = await blocked(page, 0); R.uniColdBlock.push(b.sum); R.uniColdWorst.push(b.worst);
      await page.waitForTimeout(500);       // let any straggling lazy file arrive before counting what was requested
      R.files.push(reqs.length); R.raw.push(reqs.reduce((s, x) => s + x.raw, 0)); R.gz.push(reqs.reduce((s, x) => s + x.gz, 0)); R.lang.push(reqs.filter((x) => isLangFile(x.u)).length);
      if (i === 0) global.__reqs = reqs.map((x) => `${x.u.split("/").pop()} ${(x.gz / 1024).toFixed(0)} KB gz`);
      await ctx.close(); }

    // ── CLICK · old grid: Site route, hover the Spreadsheet tab, rest, click ──
    { const { ctx, page, pid } = await newOldPage();
      await page.goto(`${APP}/#/project/${pid}`, { waitUntil: "load" });
      const tab = page.locator('[data-testid="module-tab-model"]').first(); await tab.waitFor({ timeout: 60000 });
      await page.waitForTimeout(1500);      // the Site route settles first: this arm times the TAB CLICK, not the boot
      await assertMeasurable(page, "measure-univer-tti");
      await tab.hover(); await page.waitForTimeout(SETTLE_MS);
      const mark = await page.evaluate(() => performance.now()); const t0 = Date.now(); await tab.click();
      await oldValues(page); R.oldClick.push(Date.now() - t0);
      const b = await blocked(page, mark); R.oldClickBlock.push(b.sum); R.oldClickWorst.push(b.worst); await ctx.close(); }

    // ── CLICK · Univer: host idle, warm (what the hover does), rest, mount (what the click does) ──
    { const { ctx, page } = await newUniPage(false);
      await page.goto(LAZY, { waitUntil: "load" });
      await page.waitForFunction(() => window.__hostReady === true, null, { timeout: 60000, polling: 10 });
      await page.waitForTimeout(1500);
      await assertMeasurable(page, "measure-univer-tti");
      await page.evaluate(() => window.__warm()); await page.waitForTimeout(SETTLE_MS);
      const mark = await page.evaluate(() => performance.now()); const t0 = Date.now();
      await page.evaluate((w) => window.__mountUniver(w), wb);
      await uniValues(page); R.uniClick.push(Date.now() - t0);
      await knownGood(page);
      const b = await blocked(page, mark); R.uniClickBlock.push(b.sum); R.uniClickWorst.push(b.worst); await ctx.close(); }
  }
  await browser.close();
  stopServers();

  const rc = median(R.uniCold) / median(R.oldCold), rk = median(R.uniClick) / median(R.oldClick);
  console.log(`\nTIME TO INTERACTIVE — ${ROWS}-row × ${COLS}-column sheet, median of ${RUNS}, cold browser each run, localhost${LABEL ? "  [" + LABEL + "]" : ""}`);
  console.log(`  COLD   (navigation → values)`);
  console.log(`    old grid  ${fmt(R.oldCold)}     main thread blocked ${fmt(R.oldColdBlock)}, worst single block ${fmt(R.oldColdWorst)}`);
  console.log(`    Univer    ${fmt(R.uniCold)}     main thread blocked ${fmt(R.uniColdBlock)}, worst single block ${fmt(R.uniColdWorst)}`);
  console.log(`    ratio Univer / old = ${rc.toFixed(2)}   (target ≤ ${(1 + TOL).toFixed(2)})`);
  console.log(`  CLICK  (tab click after the hover warm-up → values)`);
  console.log(`    old grid  ${fmt(R.oldClick)}     main thread blocked ${fmt(R.oldClickBlock)}, worst single block ${fmt(R.oldClickWorst)}`);
  console.log(`    Univer    ${fmt(R.uniClick)}     main thread blocked ${fmt(R.uniClickBlock)}, worst single block ${fmt(R.uniClickWorst)}`);
  console.log(`    ratio Univer / old = ${rk.toFixed(2)}   (target ≤ ${(1 + TOL).toFixed(2)})`);
  console.log(`  Univer cold run requested ${R.files[0]} JS files: ${(global.__reqs || []).join(" · ")}`);
  console.log(`  Univer JS transferred (cold): ${fmt(R.files, "files")}  raw ${fmt(R.raw.map((x) => x / 1048576), "MB")}  gzip ${fmt(R.gz.map((x) => x / 1048576), "MB")}`);
  console.log(`  hyphenation language files requested on this English sheet: ${R.lang.join(", ")}`);
  if (voided) console.log(`  ⚠ VOID — the known-good arm failed: ${voided}`);
  const pass = !voided && rc <= 1 + TOL && rk <= 1 + TOL && R.lang.every((n) => n === 0);
  console.log(`  verdict: ${voided ? "VOID" : pass ? "PASS" : "OVER TARGET"}`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), label: LABEL, runs: RUNS, rows: ROWS, ...R, ratioCold: rc, ratioClick: rk, voided }, null, 2));
  if (ASSERT && !pass) process.exit(1);
}
main().catch((e) => { console.error(e); stopServers(); process.exit(1); });
