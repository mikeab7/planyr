/* verify-univer-save-path — NEW-2: every way out of the Univer grid saves the edit made a moment ago.
 *
 * Drives the REAL <UniverSheet> in the stand-alone host (ui-audit/univer-sandbox) with REAL keystrokes, then leaves the
 * grid the way a person would, INSIDE the 300 ms save debounce, and asserts what was saved:
 *   export        type + Enter, then Export's own call (`__sandboxExport` = flush + read the workbook from the result)
 *   unmount       type + Enter, then the grid unmounts (the module tab / project / grid-toggle swap)
 *   navigation    type + Enter, then a REAL navigation away (fires beforeunload + pagehide); the host persisted synchronously
 *   idempotent    flushing again, and again, saves nothing more (the echo guard holds)
 *   two quick     two edits flushed back to back: both survive, the grid is never rebuilt to the older one
 *   mid-typing    text still in the open cell editor is committed by `commitEditing` (the grid-toggle path)
 *   loud failure  a snapshot that throws is reported to the host and the edit stays pending, then saves on the retry
 * VOID (exit 2) if the precondition fails: each check must prove the edit was STILL INSIDE the debounce window
 * (`__saved` empty, controller pending) before leaving — otherwise it would pass on a debounce that had already fired.
 * Usage: node ui-audit/verify-univer-save-path.mjs [--json out.json] */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { createWorkbook, setRaw } from "../src/workspaces/model/lib/sheetModel.js";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const PORT = 5198;
const BASE = `http://localhost:${PORT}`;
const URL_ = `${BASE}/ui-audit/univer-sandbox/index.html`;
let server, browser, page;
const results = [];
const record = (id, label, status, detail = "") => { results.push({ id, label, status, detail }); console.log(`${status.padEnd(8)} ${id.padEnd(14)} ${label}${detail ? "  ::  " + detail : ""}`); };
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function startSandbox() {
  const up = async () => { const r = await fetch(URL_).catch(() => null); return r && r.ok; };
  if (await up()) return;
  server = spawn("npx", ["vite", "--config", "ui-audit/univer-sandbox/vite.config.mjs"], { stdio: "ignore", cwd: new URL("..", import.meta.url).pathname });
  for (let i = 0; i < 80; i++) { if (await up()) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("the Univer sandbox did not start");
}
const seed = () => { const wb = createWorkbook(); let sh = wb.sheets[0].sheet; sh = setRaw(sh, 0, 0, "start"); sh = setRaw(sh, 1, 0, "two"); return { ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] }; };
async function open(fresh = true) {
  await page.goto(URL_, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__planyrUniverRead && window.__planyrUniverRead.api() && window.__sandboxLoad && window.__sandboxHandle);
  await assertMeasurable(page, "verify-univer-save-path");
  if (fresh) await ev((w) => { window.__saved.length = 0; window.__sandboxLoad(w, {}); }, seed());
  await wait(900);
}
const cellPt = (r, c) => ev(([rr, cc]) => {
  const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); const rect = ws.getRange(rr, cc).getCellRect();
  const o = typeof rect === "string" ? JSON.parse(rect) : rect; const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect();
  return { x: cv.left + o.x + o.width / 2, y: cv.top + o.y + o.height / 2 };
}, [r, c]);
const cellValue = (r, c) => ev(([rr, cc]) => { const g = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange(rr, cc); const v = g.getValue(); return v !== null && v !== undefined ? v : (g.getDisplayValue() || null); }, [r, c]);
/** a real click, real typing, real Enter — then NOTHING else: the caller leaves the grid immediately */
async function typeInto(r, c, text, { enter = true } = {}) {
  const p = await cellPt(r, c); await page.mouse.click(p.x, p.y); await wait(200);
  await page.keyboard.type(text, { delay: 5 }); if (enter) await page.keyboard.press("Enter");
}
/** the edit's cell text inside a Planyr workbook (column ids are stable: row r, first column) */
const planyrCell = (wb, r, c = 0) => { const s = wb.sheets[0].sheet; return s.cells[`${s.columns[c].id}:${r}`] ?? null; };
const insideWindow = async (label) => {
  const st = await ev(() => ({ saved: window.__saved.length, pending: window.__planyrUniverRead.pending() }));
  if (st.saved !== 0 || !st.pending) throw Object.assign(new Error(`VOID: ${label} — the edit was not inside the debounce window (saved=${st.saved}, pending=${st.pending})`), { void: true });
};

const checks = [];
const check = (id, label, fn) => checks.push({ id, label, fn });

check("export", "Export right after an edit includes it (flush returns the up-to-date workbook)", async () => {
  await open(); await typeInto(5, 3, "fresh"); await insideWindow("export");
  const r = await ev(() => window.__sandboxExport());
  const got = r && r.workbook && planyrCell(r.workbook, 5, 3);
  const saved = await ev(() => window.__saved.length);
  return r && r.ok && r.changed && got === "fresh" && saved === 1 ? { status: "PASS", detail: `the flushed workbook holds "fresh" in D6; exactly one save was emitted` } : { status: "FAIL", detail: `result=${JSON.stringify(r && { ok: r.ok, changed: r.changed })}, D6=${JSON.stringify(got)}, saves=${saved}` };
});
check("idempotent", "Flushing again (any number of times) saves nothing more — the echo guard holds", async () => {
  await open(); await typeInto(5, 3, "once"); await insideWindow("idempotent");
  await ev(() => { window.__sandboxExport(); window.__sandboxExport(); window.__planyrUniverRead.flush(); window.__sandboxExport(); });
  await wait(700);                                                      // the original debounce timer must not fire a second save either
  const n = await ev(() => window.__saved.length), cell = await cellValue(5, 3);
  return n === 1 && cell === "once" ? { status: "PASS", detail: "4 flushes + the original timer → 1 save; the grid still shows its own cell" } : { status: "FAIL", detail: `saves=${n}, D6 in grid=${JSON.stringify(cell)}` };
});
check("unmount", "Unmounting inside the debounce window saves the edit (the module-tab / project / grid-toggle swap)", async () => {
  await open(); await typeInto(5, 3, "gone"); await insideWindow("unmount");
  await ev(() => window.__sandboxMount(false)); await wait(400);
  const saved = await ev(() => window.__saved.slice()), persisted = await ev(() => { try { return JSON.parse(localStorage.getItem("sandbox:persisted")); } catch (_) { return null; } });
  const last = saved[saved.length - 1];
  return last && last.urgent && planyrCell(last.wb, 5, 3) === "gone" && persisted && planyrCell(persisted, 5, 3) === "gone"
    ? { status: "PASS", detail: "an URGENT save carrying \"gone\" reached the host, which persisted it synchronously" }
    : { status: "FAIL", detail: `saves=${saved.length}, last urgent=${last && last.urgent}, D6=${JSON.stringify(last && planyrCell(last.wb, 5, 3))}, persisted D6=${JSON.stringify(persisted && planyrCell(persisted, 5, 3))}` };
});
check("navigation", "A real navigation away (beforeunload + pagehide) inside the window leaves the edit persisted", async () => {
  await open(); await ev(() => localStorage.removeItem("sandbox:persisted"));
  await typeInto(5, 3, "bye"); await insideWindow("navigation");
  await page.goto("about:blank"); await wait(300);                     // a REAL navigation: Chromium fires beforeunload then pagehide
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  const persisted = await ev(() => { try { return JSON.parse(localStorage.getItem("sandbox:persisted")); } catch (_) { return null; } });
  return persisted && planyrCell(persisted, 5, 3) === "bye" ? { status: "PASS", detail: "after navigating away and back, the synchronously persisted copy holds \"bye\"" } : { status: "FAIL", detail: `persisted D6 = ${JSON.stringify(persisted && planyrCell(persisted, 5, 3))}` };
});
check("reload", "Closing via a reload inside the window (page.reload fires beforeunload) persists it too", async () => {
  await open(); await ev(() => localStorage.removeItem("sandbox:persisted"));
  await typeInto(6, 3, "reloaded"); await insideWindow("reload");
  await page.reload({ waitUntil: "domcontentloaded" });
  const persisted = await ev(() => { try { return JSON.parse(localStorage.getItem("sandbox:persisted")); } catch (_) { return null; } });
  return persisted && planyrCell(persisted, 6, 3) === "reloaded" ? { status: "PASS", detail: "D7 = \"reloaded\" in the persisted copy" } : { status: "FAIL", detail: `persisted D7 = ${JSON.stringify(persisted && planyrCell(persisted, 6, 3))}` };
});
check("two-quick", "Two edits flushed back to back both survive; the grid is not rebuilt to the older save", async () => {
  await open(); await typeInto(5, 3, "first");
  await ev(() => window.__sandboxExport());                             // flush 1 — React has not yet handed it back
  await typeInto(6, 3, "second");
  const r = await ev(() => window.__sandboxExport());                   // flush 2
  await wait(900);
  const [a, b] = [await cellValue(5, 3), await cellValue(6, 3)];
  const wbLast = r && r.workbook;
  return a === "first" && b === "second" && wbLast && planyrCell(wbLast, 5, 3) === "first" && planyrCell(wbLast, 6, 3) === "second"
    ? { status: "PASS", detail: "grid shows first + second; the flushed workbook holds both" } : { status: "FAIL", detail: `grid D6=${JSON.stringify(a)} D7=${JSON.stringify(b)}` };
});
check("mid-typing", "Text still typed in the open cell editor is committed by the grid-toggle path (commitEditing, then flush)", async () => {
  await open(); await typeInto(5, 3, "half", { enter: false });         // the editor is open, nothing committed
  await ev(() => window.__sandboxCommitEditing()); await wait(150);
  const r = await ev(() => window.__sandboxExport());
  const got = r && r.workbook && planyrCell(r.workbook, 5, 3);
  return got === "half" ? { status: "PASS", detail: "\"half\" was committed and reached the flushed workbook" } : { status: "FAIL", detail: `D6 = ${JSON.stringify(got)}` };
});
check("loud-failure", "A save that cannot be read is REPORTED, stays pending, and saves on the retry", async () => {
  await open(); await typeInto(5, 3, "retry"); await insideWindow("loud-failure");
  await ev(() => { const api = window.__planyrUniverRead.api(); window.__origGet = api.getWorkbook; api.getWorkbook = () => { throw new Error("boom"); }; window.__notices = []; });
  const fail = await ev(() => { const r = window.__sandboxExport(); return { ok: r.ok, notices: window.__notices.slice(), pending: window.__planyrUniverRead.pending(), saves: window.__saved.length }; });
  await ev(() => { window.__planyrUniverRead.api().getWorkbook = window.__origGet; });
  const okAfter = await ev(() => { const r = window.__sandboxExport(); return { ok: r.ok, changed: r.changed, cell: r.workbook && r.workbook.sheets[0].sheet.cells }; });
  const said = fail.notices.some((n) => /could not be saved/i.test(n));
  return !fail.ok && said && fail.pending && fail.saves === 0 && okAfter.ok && okAfter.changed
    ? { status: "PASS", detail: "reported to the host, still pending, nothing half-saved; the retry saved it" } : { status: "FAIL", detail: `failed ok=${fail.ok}, said=${said}, pending=${fail.pending}, saves=${fail.saves}; retry ${JSON.stringify({ ok: okAfter.ok, changed: okAfter.changed })}` };
});

async function main() {
  await startSandbox();
  browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message).slice(0, 200)));
  let voided = null;
  for (const c of checks) {
    try { const r = await c.fn(); record(c.id, c.label, r.status, r.detail); }
    catch (e) { if (e.void) { voided = e.message; record(c.id, c.label, "VOID", e.message); } else record(c.id, c.label, "FAIL", `threw: ${String(e.message).split("\n")[0].slice(0, 220)}`); }
  }
  await browser.close(); if (server) server.kill();
  const tally = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
  console.log("\nSUMMARY", JSON.stringify(tally));
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), tally, results }, null, 2));
  process.exit(voided ? 2 : tally.FAIL ? 1 : 0);
}
main().catch((e) => { console.error(e); if (server) server.kill(); process.exit(1); });
