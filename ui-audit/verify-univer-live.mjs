/* verify-univer-live — the Spreadsheet (the Univer grid, the only grid) on a REAL deploy, signed in as the throwaway test account on a
 * THROWAWAY project (docs/SPREADSHEET-UNIVER-SPIKE.md). Nothing of the owner's is read or written; everything it makes is deleted and
 * the database is asked again to prove it is gone (owner rule: test artifacts are always cleared).
 *
 *  A  OPENS                  the test account (a non-admin per the real is_admin() RPC) opens the Spreadsheet tab in the Univer grid with NO
 *                            grid switch anywhere, the retired grid-switch keys are dropped, and the old grid is never in the page
 *  C  MOUNT                  the open: time from navigation to its first readable cell is reported
 *  D  CHECKLIST (subset)     the same real-keystroke checks as verify-univer-parity (edit, undo, copy / paste, formatting keys…), run against the real app
 *  E  PERSISTENCE            a value typed in Univer reaches the model_sheets row (cloud), in Planyr's own shape
 *  F  PROJECT NAMES          =Site.Acres and =Plan.Building1.SF typed in Univer arrive as typed and show a result (a number, or the named error
 *                            the throwaway plan's missing data gives — never blank)
 *  H  INDENT                 the indent check passes on the real app
 *  T  TOOLS                  the Planyr-only tools checks (flags, trace, palette, names, colour convention)
 *  G  CLEANUP                the workbook row and the throwaway plan are gone
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-univer-live.mjs [base=https://planyr.io] [--json out.json] */
import { writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { bind, checks, record, results_ as parityResults } from "./verify-univer-parity.mjs";

const args = process.argv.slice(2);
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const JSON_OUT = (() => { const i = args.indexOf("--json"); return i >= 0 ? args[i + 1] : null; })();
const PROJECT = `${LIVE_PREFIX}univer-${Date.now().toString(36)}`;
const REGULAR_KEY = "planyr:model:regularGrid";   // retired: the owner-only "Use the regular grid" device flag — dropped on load, never read
const LEGACY_KEY = "planyr:model:univerGrid";     // retired: the pre-cutover "Try the new grid" key — dropped on load, never read
let failures = 0, voided = false;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const log = [];

const s = await openSignedIn({ base: BASE });
const { page } = s;
const requested = [];
page.on("request", (r) => { if (/UniverSheet|@univerjs|univer\.ai/i.test(r.url())) requested.push(r.url()); });
try {
  await assertMeasurable(page, "verify-univer-live");
  const build = (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  console.log(`served build: ${build}  account: ${s.proof.email}  base: ${BASE}`);
  await seedThrowawayPlan(page, PROJECT);
  const uid = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  const url = () => `${BASE}/?cb=${Date.now()}#/project/${PROJECT}/spreadsheet`;
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });          // the harness handle (never set in a user's tab)
  const openSheet = async () => { await page.goto(url(), { waitUntil: "load" }); await page.waitForSelector('[data-testid="model-root"]', { timeout: 60000 }); await page.waitForTimeout(2500); };
  const cloudRow = () => page.evaluate(async (id) => { const q = await window.pfSupabase.from("model_sheets").select("data, version").eq("id", id).maybeSingle(); return q.data || null; }, PROJECT);
  const waitCloud = async (pred, ms = 30000) => { const t0 = Date.now(); for (;;) { const r = await cloudRow(); if (r && pred(r)) return r; if (Date.now() - t0 > ms) return r; await page.waitForTimeout(700); } };
  const openFileMenu = async () => { await page.click('[data-testid="model-file-menu-btn"]'); await page.waitForTimeout(250); };

  // ── A. default-on, non-admin ───────────────────────────────────────────────────────────────────────────────────────────────────
  const realAdmin = await page.evaluate(async () => { const r = await window.pfSupabase.rpc("is_admin"); return r.error ? "error:" + r.error.message : r.data; });
  ok("A0 the test account is NOT an admin per the real is_admin() RPC (so the next checks really are the non-admin view)", realAdmin === false, `rpc says ${JSON.stringify(realAdmin)}`);
  if (realAdmin !== false) { voided = true; throw new Error("VOID — the test account answered is_admin = " + JSON.stringify(realAdmin)); }
  const gridState = async () => ({ univer: await page.locator('[data-testid="univer-grid"]').count(), old: await page.locator('[data-testid="model-sheet"]').count() });
  const tOpen = Date.now();
  await openSheet();
  await page.waitForSelector('[data-testid="univer-grid"] canvas', { timeout: 90000 });
  await page.waitForFunction(() => { const a = window.__planyrUniverRead && window.__planyrUniverRead.api(); return !!(a && a.getActiveWorkbook() && a.getActiveWorkbook().getActiveSheet()); }, null, { timeout: 90000, polling: 25 });
  const openMs = Date.now() - tOpen;
  const g0 = await gridState();
  ok("A1 the Spreadsheet opens in the Univer grid with no switch to find (and the old grid is not in the page)", g0.univer === 1 && g0.old === 0, `univer canvases ${g0.univer}, old-grid nodes ${g0.old}; open → first readable cell ${openMs} ms (network included, plus this harness's fixed 2.5 s settle)`);
  await openFileMenu();
  ok("A2 the File menu has NO grid switch row (neither wording)", (await page.locator('[data-testid="model-univer-switch"]').count()) === 0 && !/Try the new grid|Use the regular grid|Use the new grid/.test(await page.locator("body").innerText()));
  ok("A2b …and does have its ordinary rows (known-good arm: the menu really opened)", (await page.locator('[data-testid="model-export-xlsx"]').count()) === 1);
  await page.keyboard.press("Escape");
  await page.evaluate(([k, l]) => { localStorage.setItem(k, "1"); localStorage.setItem(l, "0"); }, [REGULAR_KEY, LEGACY_KEY]);
  await openSheet();
  await page.waitForSelector('[data-testid="univer-grid"] canvas', { timeout: 90000 });
  const g1 = await gridState();
  ok("A3 stored flags from the retired grid switches change nothing and are dropped", g1.univer === 1 && g1.old === 0 && (await page.evaluate(([k, l]) => localStorage.getItem(k) === null && localStorage.getItem(l) === null, [REGULAR_KEY, LEGACY_KEY])), `univer ${g1.univer}, old ${g1.old}`);
  ok("A4 Univer's own files were requested by the non-admin view (it IS the grid)", requested.length > 0, `${requested.length} request(s)`);

  // ── C. the grid the rest of the run uses ──────────────────────────────────────────────────────────────────────────────────────
  ok("C1 Univer is showing for the checklist (no click needed)", (await gridState()).univer === 1);
  const dl = await page.evaluate(() => { const es = performance.getEntriesByType("resource"); return { files: es.length, bytes: es.reduce((a, e) => a + (e.transferSize || 0), 0), decoded: es.reduce((a, e) => a + (e.decodedBodySize || 0), 0) }; });
  ok("C2 what this tab has downloaded in total (network, compressed)", dl.files > 0, `${dl.files} files, ${(dl.bytes / 1048576).toFixed(2)} MB transferred (${(dl.decoded / 1048576).toFixed(1)} MB once unpacked)`);
  await page.waitForTimeout(1500);

  // ── D. the checklist subset, real keys on the real app ─────────────────────────────────────────────────────────────────
  const SEED = [["1", "alpha", "cherry"], ["2", "beta", "apple"], ["3", "=A1+A2", "banana"], ["4", 3], ["5", 5]];
  const liveReset = async () => {
    await page.waitForTimeout(450);
    await page.evaluate((seed) => {
      const api = window.__planyrUniverRead.api(); const ws = api.getActiveWorkbook().getActiveSheet();
      // The sandbox reloads the whole workbook between checks; the real page cannot, so EVERYTHING a check can leave behind is
      // put back here — contents, formats, merges, hidden rows / columns (Ctrl+9 / Ctrl+0 leave them), sizes, filter, freeze.
      const base = (window.__liveBase = window.__liveBase || { rh: ws.getRowHeight(0), cw: ws.getColumnWidth(0) });
      ws.getRange(0, 0, 60, 14).breakApart(); ws.getRange(0, 0, 60, 14).clear();
      ws.showRows(0, 60); ws.showColumns(0, 14); ws.setRowHeights(0, 60, base.rh); ws.setColumnWidths(0, 14, base.cw);
      try { const f = ws.getFilter(); if (f) f.remove(); } catch (_) { /* none */ }
      ws.setFrozenRows(0); ws.setFrozenColumns(0);
      seed.forEach((row, r) => row.forEach((v, c) => { const x = ws.getRange(r, c); if (typeof v === "string" && v.startsWith("=")) x.setFormula(v); else x.setValue(/^\d+$/.test(String(v)) ? Number(v) : v); }));
      ws.getRange(0, 1).setFontWeight("bold"); ws.scrollToCell(0, 0); ws.getRange(0, 0).activate();
    }, SEED);
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.__ev = []; const api = window.__planyrUniverRead.api(); (window.__evOff || []).forEach((f) => f.dispose && f.dispose()); window.__evOff = ["SheetEditStarted", "SheetEditEnded"].map((k) => api.addEvent(api.Event[k], () => window.__ev.push(k))); });
  };
  bind({ page, reset: liveReset });
  const LIVE_IDS = ["undo-typing", "bare-letter", "headers-fixed", "header-select", "ctrl-click", "key-bold", "key-italic", "key-underline", "key-select-all", "key-f2", "key-f4", "key-alt-enter", "key-ctrl-enter", "key-fill", "clip-internal", "clip-cut", "fill-handle", "undo-redo-all",
    // the Excel keys the Planyr plugin adds (NEW-1, B2573632) — the same strict checks as the sandbox run
    "key-strike", "key-format-cells", "key-currency", "key-percent", "key-number", "key-date", "key-general", "key-border", "key-row-col", "key-insert-delete", "key-hide", "key-today", "key-copy-above",
    "key-nav-basic", "key-nav-home-end-page", "key-enter-commits-formula", "key-sheet-tabs", "paste-empty-says-so", "multi-range-copy-cut-refused",   // the cutover fixes (B2604256 / B2604258)
    "excel-keys-editor-guard", "excel-keys-namebox-guard", "alt-keytips", "alt-h-o-i", "alt-h-o-a", "alt-h-o-w", "alt-h-o-h", "alt-h-b-a-n-o-t", "alt-h-h-h-f-c", "alt-h-a-l-c-r-t-m-b", "alt-h-5-h-6", "alt-h-w", "alt-h-m-m-u-c", "alt-h-i-r-c-h-d-r-c", "alt-h-e-a-f-c", "alt-h-s-s-o-f", "alt-w-f-f-r-c", "alt-h-0-h-9-h-k-h-p-h-1-3-h-n"];
  // KNOWN-GOOD ARM for coordinates on the real page
  await liveReset();
  const pt = await page.evaluate(() => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); const r = ws.getRange(2, 2).getCellRect(); const o = typeof r === "string" ? JSON.parse(r) : r; const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect(); return { x: cv.left + o.x + o.width / 2, y: cv.top + o.y + o.height / 2 }; });
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(250);
  const armSel = await page.evaluate(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getSelection().getActiveRange().getA1Notation());
  ok("D0 KNOWN-GOOD ARM: a click at C3's computed point selects C3 on the real page", armSel === "C3", armSel);
  if (armSel !== "C3") { voided = true; throw new Error("VOID — coordinates are not trustworthy on the real page"); }
  const ctx = page.context(); await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  parityResults.length = 0;
  const ONLY = (process.env.LIVE_ONLY || "").split(",").filter(Boolean);   // debugging: LIVE_ONLY=id,id runs just those
  for (const c of checks.filter((x) => LIVE_IDS.includes(x.id) && (!ONLY.length || ONLY.includes(x.id)))) {
    try { const r = await c.fn(); record(c.id, c.label, r.status, r.detail); } catch (e) { record(c.id, c.label, "FAIL", "threw: " + String(e.message).split("\n")[0].slice(0, 200)); }
  }
  const liveFails = parityResults.filter((r) => r.status === "FAIL").map((r) => r.id);
  ok("D1 the keyboard checklist subset ran against the real app", parityResults.length === (ONLY.length || LIVE_IDS.length) && liveFails.length === 0, `${parityResults.filter((r) => r.status === "PASS").length} PASS / ${liveFails.length} FAIL / ${parityResults.filter((r) => r.status === "NOT-IN-OSS").length} not-in-OSS`);
  log.push({ phase: "D", results: parityResults.slice() });

  // ── E. persistence through the SAME path ─────────────────────────────────────────────────────────────────────────────────
  await liveReset();
  const rect = async (r, c) => page.evaluate(([rr, cc]) => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); const q = ws.getRange(rr, cc).getCellRect(); const o = typeof q === "string" ? JSON.parse(q) : q; const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect(); return { x: cv.left + o.x + o.width / 2, y: cv.top + o.y + o.height / 2 }; }, [r, c]);
  const a10 = await rect(9, 0); await page.mouse.click(a10.x, a10.y); await page.waitForTimeout(250);
  await page.keyboard.type("persist-check-1", { delay: 8 }); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  const row1 = await waitCloud((r) => Object.values(r.data?.sheets?.[0]?.sheet?.cells || {}).includes("persist-check-1"));
  ok("E1 a value typed in Univer reached the cloud row (the model_sheets row)", !!row1 && Object.values(row1.data.sheets[0].sheet.cells).includes("persist-check-1"), `version ${row1?.version}`);
  const saved = row1 && row1.data.sheets[0].sheet;
  ok("E2 the saved workbook is in Planyr's own shape (stable column ids, raw text, formulas as typed)", !!saved && saved.columns[0].id === "c1" && saved.cells["c1:9"] === "persist-check-1" && saved.cells[`${saved.columns[1].id}:2`] === "=A1+A2", saved ? `c1:9=${saved.cells["c1:9"]} ${saved.columns[1].id}:2=${saved.cells[`${saved.columns[1].id}:2`]} (column ids ${saved.columns.slice(0, 4).map((c) => c.id).join(",")})` : "no row");
  // (column B's id is read from the saved columns, not assumed "c2": the keyboard checks above delete columns and undo them, and Univer's
  // undo of a column delete re-inserts the column under a NEW id — the data follows it, so the cell is stored under whatever id B has now.)
  ok("E3 no 'different copy in the cloud' bar appeared", (await page.locator('[data-testid="model-diverged-bar"]').count()) === 0);

  // ── F. project names ───────────────────────────────────────────────────────────────────
  const typeUniver = async (r, c, text) => { const p = await rect(r, c); await page.mouse.click(p.x, p.y); await page.waitForTimeout(200); await page.keyboard.type(text, { delay: 8 }); await page.keyboard.press("Enter"); await page.waitForTimeout(300); };
  await typeUniver(11, 0, "=Site.Acres"); await typeUniver(12, 0, "=Plan.Building1.SF");
  await page.waitForTimeout(2500);
  const uni = await page.evaluate(() => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); return { acres: ws.getRange(11, 0).getValue(), sf: ws.getRange(12, 0).getValue(), f1: ws.getRange(11, 0).getFormula(), f2: ws.getRange(12, 0).getFormula() }; });
  console.log(`Univer shows Site.Acres = ${JSON.stringify(uni.acres)}  Plan.Building1.SF = ${JSON.stringify(uni.sf)}`);
  ok("F1 the formulas arrived in Univer exactly as typed", uni.f1 === "=Site.Acres" && uni.f2 === "=Plan.Building1.SF", `${uni.f1} / ${uni.f2}`);
  // The throwaway plan has no origin / element rows, so each answers a NAMED error (#REF! / #NAME? / #N/A) — never a blank and never a naked number.
  const shown = (v) => (typeof v === "number" && Number.isFinite(v)) || /^#[A-Z/0!?]+/.test(String(v).trim());
  ok("F2 =Site.Acres shows a result (a number or a named error, never blank)", shown(uni.acres), JSON.stringify(uni.acres));
  ok("F3 =Plan.Building1.SF shows a result (a number or a named error, never blank)", shown(uni.sf), JSON.stringify(uni.sf));

  // ── H. indent (NEW-1): drawn in Univer and saved as Planyr's number ───────────
  // The input / formula colour convention (B2586720) is ON by default and recolours typed text blue; the indent checks measure the DARK ink of a label's left
  // edge, so they start with it off. Section T's `tools-color` check turns it back on itself and asserts the colours.
  await page.evaluate(() => { const t = window.__planyrUniverRead.tools && window.__planyrUniverRead.tools(); if (t && t.getState().autoColor) t.run("planyr.tools.toggle-autocolor"); });
  const COLW = 120, ALIGN_HT = { left: 1, center: 2, right: 3 };
  const seedWorkbook = async (wb) => {              // a Planyr workbook → the live sheet, through the facade (never through the indent commands under test)
    const sh = wb.sheets[0].sheet;
    const at = (key) => { const i = key.lastIndexOf(":"); return [Number(key.slice(i + 1)), sh.columns.findIndex((c) => c.id === key.slice(0, i))]; };
    const cells = [];
    for (const [key, raw] of Object.entries(sh.cells)) { const [r, c] = at(key); const st = sh.styles[key] || {}; cells.push({ r, c, v: /^\d+$/.test(String(raw)) ? Number(raw) : raw, ht: ALIGN_HT[st.align], indent: st.indent || 0 });
    }
    for (const [key, st] of Object.entries(sh.styles)) { const [r, c] = at(key); if (!cells.some((x) => x.r === r && x.c === c)) cells.push({ r, c, v: null, ht: ALIGN_HT[st.align], indent: st.indent || 0 }); }
    await page.evaluate(([cs, widths, colW]) => {
      const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet();
      ws.getRange(0, 0, 60, 14).clear(); ws.showRows(0, 60); ws.showColumns(0, 14); ws.setFrozenRows(0); ws.setFrozenColumns(0);   // the checks before this one leave a hidden row / freeze behind (undo-redo-all) — a hidden row has no pixels to measure
      widths.forEach((w, i) => ws.setColumnWidth(i, w || colW));
      for (const x of cs) { const s = {}; if (x.ht) s.ht = x.ht; if (x.indent) s.pd = { l: 2 + 14 * x.indent }; ws.getRange(x.r, x.c).setValue(x.v == null ? { s } : { v: x.v, s }); }
      ws.scrollToCell(0, 0); ws.getRange(0, 0).activate();
    }, [cells, sh.columns.map((c) => c.width), COLW]);
    await page.waitForTimeout(600);
  };
  // H1: its column-insert step re-ids the first column.
  bind({ page, reset: seedWorkbook, savedLast: async () => { const r = await cloudRow(); return r ? { wb: r.data } : null; }, flushSave: async () => { await page.evaluate(() => window.__planyrUniverRead.flush()); await page.waitForTimeout(3500); } });
  const indentRun = checks.find((x) => x.id === "indent");
  let indentRes;
  try { indentRes = await indentRun.fn(); } catch (e) { indentRes = { status: "FAIL", detail: "threw: " + String(e.message).split("\n")[0].slice(0, 300) }; }
  ok("H1 the indent check (toolbar buttons, painted edge, one undo per click, right / centred / spill / narrow column, column insert, edit, copy-paste) passes on the real app", indentRes.status === "PASS", indentRes.detail);
  log.push({ phase: "H", indent: indentRes });

  // ── T. the Planyr-only tools (NEW-1, cutover step 6): the sandbox `tools-*` checks, unchanged, on the real signed-in app ─────────
  // Each check hands `reset` a Planyr workbook; here that becomes the live sheet through the facade (cells as raw text — "=…" is a formula — plus a clean
  // slate: no leftover defined name, hidden line or freeze), and a saved read is the cloud row. The same strict checks, so a PASS here means the same thing.
  const toolsReset = async (wb) => {
    const sh = wb.sheets[0].sheet;
    const list = Object.entries(sh.cells).map(([key, raw]) => { const i = key.lastIndexOf(":"); return [Number(key.slice(i + 1)), sh.columns.findIndex((c) => c.id === key.slice(0, i)), /^-?\d+(\.\d+)?$/.test(String(raw)) ? Number(raw) : raw]; });
    await page.waitForTimeout(450);
    await page.evaluate((cells) => {
      const wbk = window.__planyrUniverRead.api().getActiveWorkbook(); const ws = wbk.getActiveSheet();
      for (const d of (wbk.getDefinedNames() || [])) { try { d.delete(); } catch (_) { /* gone */ } }
      ws.getRange(0, 0, 60, 14).clear(); ws.showRows(0, 60); ws.showColumns(0, 14); ws.setFrozenRows(0); ws.setFrozenColumns(0);
      for (const [r, c, v] of cells) ws.getRange(r, c).setValue(v);
      ws.scrollToCell(0, 0); ws.getRange(0, 0).activate();
    }, list);
    await page.waitForTimeout(900);
  };
  bind({ page, reset: toolsReset, savedLast: async () => { const r = await cloudRow(); return r ? { wb: r.data } : null; }, flushSave: async () => { await page.evaluate(() => window.__planyrUniverRead.flush()); await page.waitForTimeout(3500); } });
  const TOOL_IDS = ["tools-flags", "tools-flags-pattern", "tools-trace", "tools-palette", "tools-names", "tools-names-retarget", "tools-color"];
  const toolRuns = [];
  for (const c of checks.filter((x) => TOOL_IDS.includes(x.id))) {
    let r;
    try { r = await c.fn(); } catch (e) { r = { status: "FAIL", detail: "threw: " + String(e.message).split("\n")[0].slice(0, 300) }; }
    toolRuns.push({ id: c.id, ...r });
    ok(`T-${c.id} ${c.label}`, r.status === "PASS", r.detail);
  }
  ok("T0 every tools check ran (none silently skipped)", toolRuns.length === TOOL_IDS.length, `${toolRuns.length} of ${TOOL_IDS.length}`);
  log.push({ phase: "T", tools: toolRuns });

} catch (e) {
  console.log("ABORT:", String(e.message).split("\n")[0]);
  failures++;
} finally {
  // ── G. cleanup + proof ──────────────────────────────────────────────────────────────────────────────────────────────────
  try {
    const out = await page.evaluate(async (id) => { const c = window.pfSupabase; await c.from("model_sheets").delete().eq("id", id); return ((await c.from("model_sheets").select("id").eq("id", id)).data || []).length; }, PROJECT);
    const gone = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)] }));
    ok("G1 the throwaway workbook row and plan are gone (re-read from the database)", out === 0 && !(gone.errors || []).length && gone.left?.site === 0, `model_sheets rows left ${out}; ${JSON.stringify(gone)}`);
  } catch (e) { ok("G1 cleanup", false, String(e.message).split("\n")[0]); }
  await s.close();
  console.log(`\n${voided ? "VOID" : failures ? "FAILED" : "PASSED"} — ${failures} failure(s)`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), base: BASE, failures, voided, log }, null, 2));
  process.exit(voided ? 2 : failures ? 1 : 0);
}
