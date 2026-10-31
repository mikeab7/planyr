/* verify-univer-formula-engine — NEW-1 (one formula engine), the GRID half, with REAL keystrokes in a real Chromium.
 *
 * Drives the REAL <UniverSheet> in the stand-alone host (ui-audit/univer-sandbox) and asserts what a person gets:
 *   load-rewrite   a workbook with [Column] formulas opens with a plain-words note, shows the RIGHT numbers, and the rewritten text is SAVED
 *   typed-minus    typing  =-Site.Acres  (a minus before a name) calculates -12.5, not #NAME?, and is stored as =-(Site.Acres)
 *   typed-xirr     typing Planyr's interleaved XIRR(v,d,v,d) calculates and is stored in Excel's two-list form
 *   circular       a circular reference raises a visible notice (Univer shows 0 for it, like Excel — never silently)
 *   known-good     a plain =B2*2 is untouched (the guard rewrites nothing it should not) — the arm that must stay green
 * VOID (exit 2) if the known-good arm does not report its known value. Usage: node ui-audit/verify-univer-formula-engine.mjs [--json out.json] */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { createWorkbook, setRaw } from "../src/workspaces/model/lib/sheetModel.js";
import { acquisitionProForma, columnRefTable, PROJECT_NAMES } from "../test/fixtures/spreadsheet/proFormaWorkbooks.js";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const PORT = 5198;
const URL_ = `http://localhost:${PORT}/ui-audit/univer-sandbox/index.html`;
let server, browser, page;
const results = [];
const record = (id, label, status, detail = "") => { results.push({ id, label, status, detail }); console.log(`${status.padEnd(8)} ${id.padEnd(14)} ${label}${detail ? "  ::  " + detail : ""}`); };
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);

async function startSandbox() {
  const up = async () => { const r = await fetch(URL_).catch(() => null); return r && r.ok; };
  if (await up()) return;
  server = spawn("npx", ["vite", "--config", "ui-audit/univer-sandbox/vite.config.mjs"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname });
  for (let i = 0; i < 80; i++) { if (await up()) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("the Univer sandbox did not start");
}
async function open(workbook, names = {}) {
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__planyrUniverRead && window.__planyrUniverRead.api() && window.__sandboxLoad && window.__sandboxHandle);
  await assertMeasurable(page, "verify-univer-formula-engine");
  await ev(([w, n]) => { window.__saved.length = 0; window.__notices = []; window.__sandboxLoad(w, n); }, [workbook, names]);
  await wait(1500);
}
const cellPt = (r, c) => ev(([rr, cc]) => {
  const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); const rect = ws.getRange(rr, cc).getCellRect();
  const o = typeof rect === "string" ? JSON.parse(rect) : rect; const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect();
  return { x: cv.left + o.x + o.width / 2, y: cv.top + o.y + o.height / 2 };
}, [r, c]);
const gridValue = (r, c, sheetIdx = 0) => ev(([rr, cc, si]) => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getSheets()[si]; return ws.getRange(rr, cc).getValue(); }, [r, c, sheetIdx]);
const gridFormula = (r, c) => ev(([rr, cc]) => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange(rr, cc).getFormula(), [r, c]);
async function typeInto(r, c, text) { const p = await cellPt(r, c); await page.mouse.click(p.x, p.y); await wait(200); await page.keyboard.type(text, { delay: 5 }); await page.keyboard.press("Enter"); await wait(900); }
const lastSaved = () => ev(() => { const s = window.__saved; return s.length ? s[s.length - 1].wb : null; });
const savedCell = (wb, sheetIdx, r, c) => { const sh = wb.sheets[sheetIdx].sheet; return sh.cells[`${sh.columns[c].id}:${r}`] ?? null; };
const notices = () => ev(() => (window.__notices || []).slice());

const checks = [];
const check = (id, label, fn) => checks.push({ id, label, fn });

check("known-good", "A plain =B2*2 calculates and is stored untouched (the guard rewrites nothing it should not)", async () => {
  let sh = createWorkbook().sheets[0].sheet; sh = setRaw(sh, 1, 1, "21"); const wb = { ...createWorkbook(), sheets: [{ ...createWorkbook().sheets[0], sheet: sh }] };
  await open(wb); await typeInto(1, 2, "=B2*2");
  const v = await gridValue(1, 2), f = await gridFormula(1, 2), saved = await lastSaved();
  return v === 42 && f === "=B2*2" && saved && savedCell(saved, 0, 1, 2) === "=B2*2" ? { status: "PASS", detail: "42 in the grid; stored =B2*2" } : { status: "FAIL", detail: `value=${v} formula=${f} stored=${saved && savedCell(saved, 0, 1, 2)}` };
});
check("load-rewrite", "A [Column] workbook opens with a plain-words note, the right numbers, and the rewrite SAVED", async () => {
  await open(columnRefTable());
  const d2 = await gridValue(1, 3), e2 = await gridValue(1, 4), n = await notices(), saved = await lastSaved();
  const said = n.some((t) => /\[Column\] names.*rewritten to ordinary cell references/.test(t));
  const stored = saved && savedCell(saved, 0, 1, 3);
  return d2 === 25 && Math.abs(e2 - 25 / 430.25) < 1e-9 && said && stored === "=B2*C2"
    ? { status: "PASS", detail: `D2=25, E2=${e2.toFixed(6)}; note shown; stored "${stored}"` } : { status: "FAIL", detail: `D2=${d2} E2=${e2} said=${said} stored=${stored}` };
});
check("typed-minus", "Typing =-Site.Acres calculates -12.5 (Univer alone answers #NAME?) and stores =-(Site.Acres)", async () => {
  await open(createWorkbook(), PROJECT_NAMES); await typeInto(0, 0, "=-Site.Acres");
  const v = await gridValue(0, 0), f = await gridFormula(0, 0), saved = await lastSaved();
  return v === -12.5 && f === "=-(Site.Acres)" && saved && savedCell(saved, 0, 0, 0) === "=-(Site.Acres)" ? { status: "PASS", detail: "-12.5; stored =-(Site.Acres)" } : { status: "FAIL", detail: `value=${JSON.stringify(v)} formula=${f}` };
});
check("typed-xirr", "Typing the interleaved XIRR(v,d,v,d) calculates and is stored in Excel's two-list form", async () => {
  await open(createWorkbook()); await typeInto(0, 0, "=XIRR(-1000,DATE(2026,1,1),1500,DATE(2027,1,1))");
  const v = await gridValue(0, 0), saved = await lastSaved(), st = saved && savedCell(saved, 0, 0, 0);
  return typeof v === "number" && Math.abs(v - 0.5) < 1e-6 && /CHOOSE\(\{1,2\},-1000,1500\)/.test(st || "") ? { status: "PASS", detail: `0.5; stored ${st}` } : { status: "FAIL", detail: `value=${JSON.stringify(v)} stored=${st}` };
});
check("circular", "A circular reference raises a visible notice (Univer shows 0, like Excel — never silently)", async () => {
  await open(acquisitionProForma(), PROJECT_NAMES);
  const n = await notices(); const hit = n.find((t) => /circular reference/.test(t));
  return hit ? { status: "PASS", detail: hit.slice(0, 140) } : { status: "FAIL", detail: `notices=${JSON.stringify(n).slice(0, 200)}` };
});

async function main() {
  await startSandbox();
  browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message).slice(0, 200)));
  for (const c of checks) {
    try { const r = await c.fn(); record(c.id, c.label, r.status, r.detail); }
    catch (e) { record(c.id, c.label, "FAIL", `threw: ${String(e.message).split("\n")[0].slice(0, 220)}`); }
  }
  await browser.close(); if (server) server.kill();
  const tally = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  console.log("\nSUMMARY", JSON.stringify(tally));
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), tally, results }, null, 2));
  const knownGood = results.find((r) => r.id === "known-good");
  process.exit(!knownGood || knownGood.status !== "PASS" ? 2 : tally.FAIL ? 1 : 0);
}
main().catch((e) => { console.error(e); if (server) server.kill(); process.exit(1); });
