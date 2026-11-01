/* verify-univer-calc-cache — the Spreadsheet's calculation cache (src/workspaces/model/lib/univerCalcCache.js), driven in a REAL browser on the built app.
 * The cache is only worth having if it can NEVER show a wrong number, so this checks the dangerous arms, not just the fast one:
 *   1  FIRST OPEN   no entry yet → nothing seeded, every value correct (today's behaviour)
 *   2  SECOND OPEN  after the write → formula cells seeded from the cache, and the numbers are the same as a real calculation
 *   3  EDIT AFTER A SEEDED OPEN  change a precedent in a seeded grid → every dependent follows (the dependency graph is intact — seeding must not
 *                   have turned Univer's recalculation off)
 *   4  STALE         the stored workbook is changed BEHIND the cache's back → not seeded, values correct (a hash mismatch is a miss)
 *   5  VOLATILE      a workbook with =TODAY() is never seeded
 * KNOWN-GOOD ARM: arm 1's values are compared with an independent JS sum, and arm 2's seeded count must equal the formula count (else VOID).
 * Run: node ui-audit/verify-univer-calc-cache.mjs [--dist dist] */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { createWorkbook } from "../src/workspaces/model/lib/sheetModel.js";

const args = process.argv.slice(2);
const DIST = (() => { const i = args.indexOf("--dist"); return i >= 0 ? args[i + 1] : "dist"; })();
const PORT = 4197, BASE = `http://localhost:${PORT}`, ROWS = 200, COLS = 12;
let failures = 0, voided = null;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };

function workbook({ volatile = false, a1 = null } = {}) {
  const wb = createWorkbook(); const sh = wb.sheets[0].sheet; const cells = {};
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells[`${sh.columns[c].id}:${r}`] = c === COLS - 1 ? `=SUM(A${r + 1}:K${r + 1})` : String(((r * 31 + c * 7) % 1000) + 0.5);
  if (a1 !== null) cells[`${sh.columns[0].id}:0`] = String(a1);
  if (volatile) cells[`${sh.columns[0].id}:${ROWS + 1}`] = "=TODAY()";
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
    const pid = `zz-cc-${label}-${Date.now().toString(36)}`;
    const site = { id: pid, groupId: pid, site: "ZZ cc", name: "ZZ cc", origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [] };
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const key = `planyr:model:sheet:v1:local:${pid}`;
    // seeded ONCE (`!localStorage.getItem(k)`): a later open must see what the app, or this harness, stored since
    await ctx.addInitScript(([sid, rec, k, w, first]) => { window.__PLANYR_E2E = true; try { if (first && !localStorage.getItem(k)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: rec })); localStorage.setItem(k, JSON.stringify(w)); } } catch (_) { /* */ } }, [pid, site, key, wb, true]);
    const url = `${BASE}/#/project/${pid}/spreadsheet`;
    const open = async () => {
      const page = await ctx.newPage(); await page.goto("about:blank"); await assertMeasurable(page, "verify-univer-calc-cache");
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction(() => { const a = window.__planyrUniverRead && window.__planyrUniverRead.api(); const ws = a && a.getActiveWorkbook() && a.getActiveWorkbook().getActiveSheet(); try { return !!ws && typeof ws.getRange(0, 0).getValue() === "number" && ws.getRange(0, 11).getValue() !== "" && ws.getRange(0, 11).getValue() !== null; } catch (_) { return false; } }, null, { timeout: 60000, polling: 25 });
      return page;
    };
    const read = (page, r) => page.evaluate((row) => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); return ws.getRange(row, 11).getValue(); }, r);
    const calc = (page) => page.evaluate(() => window.__planyrUniverRead.calc());
    const waitValue = (page, r, want) => page.waitForFunction(([row, w]) => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); return Math.abs(Number(ws.getRange(row, 11).getValue()) - w) < 1e-6; }, [r, want], { timeout: 20000, polling: 25 });
    return { ctx, open, read, calc, waitValue, key };
  }

  // ── 1 + 2 + 3 ──
  { const s = await session("a", workbook());
    let p = await s.open(); await s.waitValue(p, 5, rowSum(5)); let c = await s.calc(p);
    ok("1 FIRST OPEN seeds nothing (no entry yet)", c.seeded === 0, `seeded ${c.seeded}`);
    ok("1 …and the values are right (known-good arm)", Math.abs((await s.read(p, ROWS - 1)) - rowSum(ROWS - 1)) < 1e-6, `row ${ROWS} = ${await s.read(p, ROWS - 1)}`);
    await p.waitForTimeout(4500);                                    // the write is debounced ~1.2 s after the calculation settles
    await p.close();
    p = await s.open(); c = await s.calc(p);
    ok("2 SECOND OPEN seeds every formula cell from the cache", c.seeded === ROWS, `seeded ${c.seeded} of ${ROWS}`);
    if (c.seeded !== ROWS) voided = `the cache did not seed (${c.seeded}/${ROWS}); arms 3–4 would prove nothing`;
    await s.waitValue(p, 5, rowSum(5));
    ok("2 …and a seeded value equals a real calculation", Math.abs((await s.read(p, ROWS - 1)) - rowSum(ROWS - 1)) < 1e-6);
    // 3 — edit a precedent in the SEEDED grid; the dependent must follow
    await p.evaluate(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange(0, 0).setValue(1000));
    let followed = true; try { await s.waitValue(p, 0, rowSum(0, 1000)); } catch (_) { followed = false; }
    ok("3 EDIT after a seeded open: the dependent recalculates (the dependency graph is intact)", followed, `L1 = ${await s.read(p, 0)}, want ${rowSum(0, 1000)}`);
    await p.waitForTimeout(1500); await p.close();
    // 3b — reopen after the edit was saved: its hash is different from the cache's, so no stale seed — and the new answer shows
    p = await s.open(); c = await s.calc(p);
    let fresh = true; try { await s.waitValue(p, 0, rowSum(0, 1000)); } catch (_) { fresh = false; }
    ok("3b REOPEN after the edit shows the edited answer (never the cached one)", fresh, `L1 = ${await s.read(p, 0)}, seeded ${c.seeded}`);
    await p.close();
    // 4 — change the stored workbook behind the cache's back
    const tampered = workbook({ a1: 4242 });
    const p2 = await s.ctx.newPage(); await p2.goto(BASE + "/#/"); await p2.evaluate(([k, w]) => localStorage.setItem(k, JSON.stringify(w)), [s.key, tampered]); await p2.close();
    p = await s.open(); c = await s.calc(p);
    let stale = true; try { await s.waitValue(p, 0, rowSum(0, 4242)); } catch (_) { stale = false; }
    ok("4 STALE: a workbook changed behind the cache's back is not seeded and shows the right answer", c.seeded === 0 && stale, `seeded ${c.seeded}, L1 = ${await s.read(p, 0)}, want ${rowSum(0, 4242)}`);
    await p.close(); await s.ctx.close(); }

  // ── 5 volatile ──
  { const s = await session("v", workbook({ volatile: true }));
    let p = await s.open(); await p.waitForTimeout(4500); await p.close();
    p = await s.open(); const c = await s.calc(p);
    ok("5 VOLATILE: a workbook with =TODAY() is never seeded", c.seeded === 0, `seeded ${c.seeded}`);
    await p.close(); await s.ctx.close(); }
  await browser.close();
} catch (e) { console.log("ABORT:", String(e.message).split("\n")[0]); failures++; }
finally { stop(); }
console.log(`\n${voided ? "VOID — " + voided : failures ? "FAILED" : "PASSED"} — ${failures} failure(s)`);
process.exit(voided ? 2 : failures ? 1 : 0);
