/* verify-univer-adopt-real-unit — the Spreadsheet grid ADOPTS a unit built from the device's stored workbook ahead of the click (NEW-1, B2607857 —
 * src/workspaces/model/components/univerFramework.js, UniverSheet.jsx `adoptable`). Run in a REAL browser on the BUILT app.
 *
 * Adopting skips the whole load, so the dangerous question is the opposite of "is it fast": can it ever show the WRONG workbook, or lose something the
 * normal load does? Arms:
 *   1 ADOPT        hover the tab (a grid is built off-screen from the stored workbook), click → the grid ADOPTED it; every number matches an independent sum;
 *                  an edit reaches its dependent and is SAVED (the stored workbook changes) — adoption must not have turned saving off.
 *   2 STALE        the stored workbook changes between the hover and the click → NOT adopted, the NEW numbers show (never the waiting unit's).
 *   3 NO COPY      nothing stored for the project → nothing to adopt; the grid still opens, empty, with no error.
 *   4 CIRCULAR     a circular reference calculated while the unit waited is still reported (the notice) after adoption.
 *   5 ONE FORMULA  an adopted grid recalculates after a precedent edit (the dependency graph is intact) — checked inside arm 1.
 * KNOWN-GOOD ARM: arm 1's numbers are compared with an independent JS sum; arm 1 must report `adopted === true` or the run is VOID (a run that never adopts
 * proves nothing about adoption).
 * Run: node ui-audit/verify-univer-adopt-real-unit.mjs [--dist dist] */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { createWorkbook } from "../src/workspaces/model/lib/sheetModel.js";

const args = process.argv.slice(2);
const DIST = (() => { const i = args.indexOf("--dist"); return i >= 0 ? args[i + 1] : "dist"; })();
const PORT = 4196, BASE = `http://localhost:${PORT}`, ROWS = 200, COLS = 12;
let failures = 0, voided = null;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };

function workbook({ a1 = null, circular = false } = {}) {
  const wb = createWorkbook(); const sh = wb.sheets[0].sheet; const cells = {};
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells[`${sh.columns[c].id}:${r}`] = c === COLS - 1 ? `=SUM(A${r + 1}:K${r + 1})` : String(((r * 31 + c * 7) % 1000) + 0.5);
  if (a1 !== null) cells[`${sh.columns[0].id}:0`] = String(a1);
  if (circular) { cells[`${sh.columns[0].id}:${ROWS + 1}`] = `=A${ROWS + 3}`; cells[`${sh.columns[0].id}:${ROWS + 2}`] = `=A${ROWS + 2}`; }
  return { ...wb, sheets: [{ ...wb.sheets[0], sheet: { ...sh, rowCount: ROWS + 10, cells } }] };
}
const rowSum = (r, a1 = null) => { let s = 0; for (let c = 0; c < COLS - 1; c++) s += (r === 0 && c === 0 && a1 !== null) ? a1 : (((r * 31 + c * 7) % 1000) + 0.5); return s; };

const srv = spawn("npx", ["vite", "preview", "--outDir", DIST, "--port", String(PORT), "--strictPort"], { stdio: "ignore", detached: true, cwd: new URL("..", import.meta.url).pathname });
const stop = () => { try { process.kill(-srv.pid); } catch (_) { try { srv.kill(); } catch (__) { /* gone */ } } };
try {
  if (!existsSync(DIST)) throw new Error(`build first — ${DIST} is missing`);
  for (let i = 0; i < 80; i++) { const r = await fetch(BASE + "/").catch(() => null); if (r && r.ok) break; await new Promise((r2) => setTimeout(r2, 500)); }
  const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

  async function session(label, wb) {
    const pid = `zz-ad-${label}-${Date.now().toString(36)}`;
    const site = { id: pid, groupId: pid, site: "ZZ adopt", name: "ZZ adopt", origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [] };
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const key = `planyr:model:sheet:v1:local:${pid}`;
    await ctx.addInitScript(([sid, rec, k, w]) => { window.__PLANYR_E2E = true; try { if (!(globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))("planarfit:sites:v1")) localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: rec })); if (w && !(globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k)) localStorage.setItem(k, JSON.stringify(w)); } catch (_) { /* */ } }, [pid, site, key, wb]);
    const page = await ctx.newPage(); await page.goto("about:blank"); await assertMeasurable(page, "verify-univer-adopt-real-unit");
    await page.goto(`${BASE}/#/project/${pid}`, { waitUntil: "load" });
    const tab = page.locator('[data-testid="module-tab-model"]').first(); await tab.waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    await tab.hover(); await page.waitForTimeout(4500);                      // a grid is built off-screen in this time
    const waiting = () => page.locator("body > [data-univer-prewarm]").count();
    const open = async () => { await tab.click(); await page.waitForFunction(() => { const a = window.__planyrUniverRead && window.__planyrUniverRead.api(); return !!a && !!a.getActiveWorkbook() && !!document.querySelector('[data-testid="univer-grid"] canvas'); }, null, { timeout: 60000, polling: 25 }); };
    const cell = (r, c) => page.evaluate(([row, col]) => { try { return window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange(row, col).getValue(); } catch (_) { return null; } }, [r, c]);
    const waitNum = (r, c, want) => page.waitForFunction(([row, col, w]) => { try { return Math.abs(Number(window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange(row, col).getValue()) - w) < 1e-6; } catch (_) { return false; } }, [r, c, want], { timeout: 20000, polling: 25 });
    const calc = () => page.evaluate(() => window.__planyrUniverRead.calc());
    const stored = () => page.evaluate((k) => { try { return JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k)); } catch (_) { return null; } }, key);
    return { ctx, page, tab, key, waiting, open, cell, waitNum, calc, stored };
  }

  // ── 1 + 5 ADOPT ──
  { const s = await session("a", workbook());
    ok("1 hovering the tab left a grid BUILT off-screen", (await s.waiting()) === 1, `${await s.waiting()} waiting`);
    await s.open(); const c = await s.calc();
    ok("1 the click ADOPTED it (a unit built from the stored workbook)", c.adopted === true && c.prewarmed === true, JSON.stringify({ adopted: c.adopted, adoptWhy: c.adoptWhy }));
    if (c.adopted !== true) voided = "arm 1 did not adopt — the other arms prove nothing";
    let right = true; try { await s.waitNum(ROWS - 1, COLS - 1, rowSum(ROWS - 1)); } catch (_) { right = false; }
    ok("1 …and the numbers are right (known-good arm: an independent sum)", right && Math.abs((await s.cell(0, COLS - 1)) - rowSum(0)) < 1e-6, `last = ${await s.cell(ROWS - 1, COLS - 1)}, want ${rowSum(ROWS - 1)}`);
    ok("1 …with the remembered/computed results seeded or calculated (no blank formula cell)", Number.isFinite(Number(await s.cell(Math.floor(ROWS / 2), COLS - 1))));
    await s.page.evaluate(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange(0, 0).setValue(1000));
    let followed = true; try { await s.waitNum(0, COLS - 1, rowSum(0, 1000)); } catch (_) { followed = false; }
    ok("5 an edit in the adopted grid reaches its dependent (the dependency graph is intact)", followed, `L1 = ${await s.cell(0, COLS - 1)}, want ${rowSum(0, 1000)}`);
    await s.page.waitForTimeout(900); await s.page.evaluate(() => window.__planyrUniverRead.flush()); await s.page.waitForTimeout(600);
    const st = await s.stored(); const sh = st && st.sheets[0].sheet; const a1Raw = sh && sh.cells && sh.cells[`${sh.columns[0].id}:0`];
    ok("1 …and the edit is SAVED (adoption did not turn saving off)", String(a1Raw) === "1000", `stored A1 = ${a1Raw}`);
    ok("1 …and nothing was reported as wrong", (await s.page.locator('[data-testid="univer-error"]').count()) === 0);
    await s.ctx.close(); }

  // ── 2 STALE ──
  { const s = await session("s", workbook());
    ok("2 a grid is waiting (built from the ORIGINAL stored workbook)", (await s.waiting()) === 1);
    await s.page.evaluate(([k, w]) => localStorage.setItem(k, JSON.stringify(w)), [s.key, workbook({ a1: 4242 })]);   // the stored workbook changes behind the waiting grid's back
    await s.open(); const c = await s.calc();
    ok("2 STALE: the waiting unit is NOT adopted when the stored workbook is not the one it was built from", c.adopted === false && c.adoptWhy && c.adoptWhy.canon === false, JSON.stringify(c.adoptWhy));
    let fresh = true; try { await s.waitNum(0, COLS - 1, rowSum(0, 4242)); } catch (_) { fresh = false; }
    ok("2 …and the NEW numbers show", fresh, `L1 = ${await s.cell(0, COLS - 1)}, want ${rowSum(0, 4242)}`);
    await s.ctx.close(); }

  // ── 3 NO COPY ──
  { const s = await session("n", null);
    await s.open(); const c = await s.calc();
    ok("3 NO COPY: nothing stored → nothing adopted, and the grid still opens", c.adopted === false, JSON.stringify(c.adoptWhy));
    ok("3 …with no error", (await s.page.locator('[data-testid="univer-error"]').count()) === 0);
    await s.ctx.close(); }

  // ── 4 CIRCULAR ──
  { const s = await session("c", workbook({ circular: true }));
    await s.open(); const c = await s.calc();
    ok("4 the circular workbook's waiting unit was adopted", c.adopted === true, JSON.stringify(c.adoptWhy));
    let said = true; try { await s.page.waitForFunction(() => /circular reference/.test((document.querySelector('[data-testid="model-notice"]') || {}).innerText || ""), null, { timeout: 15000 }); } catch (_) { said = false; }
    ok("4 …and the circular reference is STILL reported (its calculation ran before the grid listened)", said);
    await s.ctx.close(); }

  await browser.close();
} catch (e) { console.log("ABORT:", String(e.message).split("\n")[0]); failures++; }
finally { stop(); }
console.log(`\n${voided ? "VOID — " + voided : failures ? "FAILED" : "PASSED"} — ${failures} failure(s)`);
process.exit(voided ? 2 : failures ? 1 : 0);
