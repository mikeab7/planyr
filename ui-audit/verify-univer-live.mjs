/* verify-univer-live — the Univer spike on a REAL deploy, signed in as the throwaway test account on a THROWAWAY project
 * (docs/SPREADSHEET-UNIVER-SPIKE.md, V-entry for B2557488). Nothing of the owner's is read or written; everything it makes is
 * deleted and the database is asked again to prove it is gone (owner rule: test artifacts are always cleared).
 *
 *  A  GATE, non-admin side   the test account is NOT an admin (the real is_admin() RPC says false): the File menu has no
 *                            "Try the new grid" row, a stored "on" activates nothing, and no Univer file is ever requested
 *  B  GATE, admin side       is_admin is answered `true` by a network intercept for THIS browser only — the client gate is a
 *                            visibility switch, not a security boundary (data access is still the test account's own, by RLS).
 *                            KNOWN-GOOD ARM: the intercept must actually have been hit, or the run is VOID.
 *  C  MOUNT                  the switch turns the Univer grid on; time from the click to its first readable cell is reported
 *  D  CHECKLIST (subset)     the same real-keystroke checks as verify-univer-parity, run against the real app
 *  E  PERSISTENCE            a value typed in Univer reaches the SAME model_sheets row (cloud) and shows in the regular grid
 *  F  PROJECT NAMES          =Site.Acres and =Plan.Building1.SF typed in the regular grid show the same numbers in Univer
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
const SWITCH_KEY = "planyr:model:univerGrid";
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
  const oldCell = (r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`).first();
  const cloudRow = () => page.evaluate(async (id) => { const q = await window.pfSupabase.from("model_sheets").select("data, version").eq("id", id).maybeSingle(); return q.data || null; }, PROJECT);
  const waitCloud = async (pred, ms = 30000) => { const t0 = Date.now(); for (;;) { const r = await cloudRow(); if (r && pred(r)) return r; if (Date.now() - t0 > ms) return r; await page.waitForTimeout(700); } };
  const openFileMenu = async () => { await page.click('[data-testid="model-file-menu-btn"]'); await page.waitForTimeout(250); };

  // ── A. gate, non-admin ──────────────────────────────────────────────────────────────────────────────────────────────────
  const realAdmin = await page.evaluate(async () => { const r = await window.pfSupabase.rpc("is_admin"); return r.error ? "error:" + r.error.message : r.data; });
  ok("A0 the test account is NOT an admin per the real is_admin() RPC (so the next checks really are the non-admin view)", realAdmin === false, `rpc says ${JSON.stringify(realAdmin)}`);
  if (realAdmin !== false) { voided = true; throw new Error("VOID — the test account answered is_admin = " + JSON.stringify(realAdmin)); }
  await openSheet();
  await openFileMenu();
  ok("A1 the File menu has NO 'Try the new grid' row", (await page.locator('[data-testid="model-univer-switch"]').count()) === 0);
  ok("A1b …and does have its ordinary rows (known-good arm: the menu really opened)", (await page.locator('[data-testid="model-export-xlsx"]').count()) === 1);
  await page.keyboard.press("Escape");
  await page.evaluate((k) => localStorage.setItem(k, "1"), SWITCH_KEY);
  await openSheet();
  ok("A2 a stored 'on' activates nothing for a non-admin: the regular grid is showing", (await page.locator('[data-testid="model-sheet"]').count()) === 1 && (await page.locator('[data-testid="univer-grid"]').count()) === 0);
  ok("A3 no Univer file was ever requested by the non-admin view", requested.length === 0, requested.join(", "));
  await page.evaluate((k) => localStorage.removeItem(k), SWITCH_KEY);

  // ── B. gate, admin (intercept) ──────────────────────────────────────────────────────────────────────────────────────────
  let hits = 0;
  await page.route("**/rest/v1/rpc/is_admin*", (route) => { hits++; route.fulfill({ status: 200, contentType: "application/json", body: "true" }); });
  await openSheet();
  await openFileMenu();
  ok("B0 KNOWN-GOOD ARM: the is_admin intercept was actually hit", hits > 0, `${hits} hit(s)`);
  if (!hits) { voided = true; throw new Error("VOID — the intercept never fired, so the admin-side checks would prove nothing"); }
  ok("B1 the File menu now shows 'Try the new grid'", (await page.locator('[data-testid="model-univer-switch"]').innerText().catch(() => "")).includes("Try the new grid"));
  const before = requested.length;

  // ── C. mount ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const resBefore = await page.evaluate(() => performance.getEntriesByType("resource").length);
  const t0 = Date.now();
  await page.click('[data-testid="model-univer-switch"]');
  await page.waitForSelector('[data-testid="univer-grid"] canvas', { timeout: 90000 });
  await page.waitForFunction(() => { const a = window.__planyrUniverRead && window.__planyrUniverRead.api(); return !!(a && a.getActiveWorkbook() && a.getActiveWorkbook().getActiveSheet()); }, null, { timeout: 90000, polling: 25 });
  const mountMs = Date.now() - t0;
  ok("C1 the switch turns the Univer grid on", true, `click → grid ready in ${mountMs} ms (network included)`);
  ok("C2 Univer's own files were requested only after the switch", requested.length > before, `${requested.length - before} file request(s), first: ${(requested[before] || "").split("/").pop()}`);
  const dl = await page.evaluate((n) => { const es = performance.getEntriesByType("resource").slice(n); return { files: es.length, bytes: es.reduce((a, e) => a + (e.transferSize || 0), 0), decoded: es.reduce((a, e) => a + (e.decodedBodySize || 0), 0) }; }, resBefore);
  ok("C2b what the switch downloads on first use (network, compressed)", dl.files > 0, `${dl.files} files, ${(dl.bytes / 1048576).toFixed(2)} MB transferred (${(dl.decoded / 1048576).toFixed(1)} MB once unpacked)`);
  ok("C3 the choice is remembered on this device", (await page.evaluate((k) => localStorage.getItem(k), SWITCH_KEY)) === "1");
  ok("C4 the old grid is gone while Univer is on", (await page.locator('[data-testid="model-sheet"]').count()) === 0);
  await page.waitForTimeout(1500);

  // ── D. the checklist subset, real keys on the real app ─────────────────────────────────────────────────────────────────
  const SEED = [["1", "alpha", "cherry"], ["2", "beta", "apple"], ["3", "=A1+A2", "banana"], ["4", 3], ["5", 5]];
  const liveReset = async () => {
    await page.waitForTimeout(450);
    await page.evaluate((seed) => {
      const api = window.__planyrUniverRead.api(); const ws = api.getActiveWorkbook().getActiveSheet();
      ws.getRange(0, 0, 60, 14).clear(); ws.setFrozenRows(0); ws.setFrozenColumns(0);
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
    "excel-keys-editor-guard", "excel-keys-namebox-guard", "alt-keytips", "alt-h-o-i", "alt-h-o-a", "alt-h-o-w", "alt-h-o-h", "alt-h-b-a-n-o-t", "alt-h-h-h-f-c", "alt-h-a-l-c-r-t-m-b", "alt-h-w", "alt-h-m-m-u-c", "alt-h-i-r-c-h-d-r-c", "alt-h-e-a-f-c", "alt-h-s-s-o-f", "alt-w-f-f-r-c", "alt-h-0-h-9-h-k-h-p-h-1-3-h-n"];
  // KNOWN-GOOD ARM for coordinates on the real page
  await liveReset();
  const pt = await page.evaluate(() => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); const r = ws.getRange(2, 2).getCellRect(); const o = typeof r === "string" ? JSON.parse(r) : r; const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect(); return { x: cv.left + o.x + o.width / 2, y: cv.top + o.y + o.height / 2 }; });
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(250);
  const armSel = await page.evaluate(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getSelection().getActiveRange().getA1Notation());
  ok("D0 KNOWN-GOOD ARM: a click at C3's computed point selects C3 on the real page", armSel === "C3", armSel);
  if (armSel !== "C3") { voided = true; throw new Error("VOID — coordinates are not trustworthy on the real page"); }
  const ctx = page.context(); await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  parityResults.length = 0;
  for (const c of checks.filter((x) => LIVE_IDS.includes(x.id))) {
    try { const r = await c.fn(); record(c.id, c.label, r.status, r.detail); } catch (e) { record(c.id, c.label, "FAIL", "threw: " + String(e.message).split("\n")[0].slice(0, 200)); }
  }
  const liveFails = parityResults.filter((r) => r.status === "FAIL").map((r) => r.id);
  ok("D1 the keyboard checklist subset ran against the real app", parityResults.length === LIVE_IDS.length, `${parityResults.filter((r) => r.status === "PASS").length} PASS / ${liveFails.length} FAIL / ${parityResults.filter((r) => r.status === "NOT-IN-OSS").length} not-in-OSS`);
  log.push({ phase: "D", results: parityResults.slice() });

  // ── E. persistence through the SAME path ─────────────────────────────────────────────────────────────────────────────────
  await liveReset();
  const rect = async (r, c) => page.evaluate(([rr, cc]) => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); const q = ws.getRange(rr, cc).getCellRect(); const o = typeof q === "string" ? JSON.parse(q) : q; const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect(); return { x: cv.left + o.x + o.width / 2, y: cv.top + o.y + o.height / 2 }; }, [r, c]);
  const a10 = await rect(9, 0); await page.mouse.click(a10.x, a10.y); await page.waitForTimeout(250);
  await page.keyboard.type("persist-check-1", { delay: 8 }); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  const row1 = await waitCloud((r) => Object.values(r.data?.sheets?.[0]?.sheet?.cells || {}).includes("persist-check-1"));
  ok("E1 a value typed in Univer reached the cloud row (the same model_sheets path as the regular grid)", !!row1 && Object.values(row1.data.sheets[0].sheet.cells).includes("persist-check-1"), `version ${row1?.version}`);
  const saved = row1 && row1.data.sheets[0].sheet;
  ok("E2 the saved workbook is in Planyr's own shape (stable column ids, raw text, formulas as typed)", !!saved && saved.columns[0].id === "c1" && saved.cells["c1:9"] === "persist-check-1" && saved.cells["c2:2"] === "=A1+A2", saved ? `c1:9=${saved.cells["c1:9"]} c2:2=${saved.cells["c2:2"]}` : "no row");
  ok("E3 no 'different copy in the cloud' bar appeared", (await page.locator('[data-testid="model-diverged-bar"]').count()) === 0);
  await openFileMenu(); await page.click('[data-testid="model-univer-switch"]');
  await page.waitForSelector('[data-testid="model-sheet"]', { timeout: 30000 }); await page.waitForTimeout(1500);
  ok("E4 switching back shows the regular grid with the value Univer saved", (await oldCell(9, 0).innerText()).trim() === "persist-check-1");
  ok("E5 switching back to the regular grid forgets the choice on this device", (await page.evaluate((k) => localStorage.getItem(k), SWITCH_KEY)) === null);

  // ── F. project names ────────────────────────────────────────────────────────────────────────────────────────────────────
  const typeOld = async (r, c, text) => { await oldCell(r, c).click(); await page.keyboard.type(text); await page.keyboard.press("Enter"); };
  await typeOld(11, 0, "=Site.Acres"); await typeOld(12, 0, "=Plan.Building1.SF");
  await page.waitForTimeout(2500);
  const oldAcres = (await oldCell(11, 0).innerText()).trim(), oldSf = (await oldCell(12, 0).innerText()).trim();
  console.log(`regular grid shows Site.Acres = "${oldAcres}"  Plan.Building1.SF = "${oldSf}"`);
  await openFileMenu(); await page.click('[data-testid="model-univer-switch"]');
  await page.waitForSelector('[data-testid="univer-grid"] canvas', { timeout: 60000 }); await page.waitForTimeout(3500);
  const uni = await page.evaluate(() => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); return { acres: ws.getRange(11, 0).getValue(), sf: ws.getRange(12, 0).getValue(), f1: ws.getRange(11, 0).getFormula(), f2: ws.getRange(12, 0).getFormula() }; });
  const num = (t) => parseFloat(String(t).replace(/,/g, ""));
  ok("F1 the formulas arrived in Univer exactly as typed", uni.f1 === "=Site.Acres" && uni.f2 === "=Plan.Building1.SF", `${uni.f1} / ${uni.f2}`);
  // "The same result in both grids": two numbers agree, or two ERRORS read the same. The throwaway plan has no origin / element rows, so the
  // regular grid itself answers #REF! / #NAME? here — Univer must say exactly what the regular grid says, never a naked number or a blank.
  const sameResult = (u, oldText, tol) => (typeof u === "number" && Number.isFinite(num(oldText)) ? Math.abs(u - num(oldText)) < tol : String(u).trim() === String(oldText).trim());
  ok("F2 =Site.Acres shows the same result in Univer as in the regular grid", sameResult(uni.acres, oldAcres, 0.01), `Univer ${JSON.stringify(uni.acres)} vs regular "${oldAcres}"`);
  ok("F3 =Plan.Building1.SF shows the same result in Univer as in the regular grid", sameResult(uni.sf, oldSf, 1), `Univer ${JSON.stringify(uni.sf)} vs regular "${oldSf}"`);
  await page.evaluate((k) => localStorage.removeItem(k), SWITCH_KEY);
} catch (e) {
  console.log("ABORT:", String(e.message).split("\n")[0]);
  failures++;
} finally {
  // ── G. cleanup + proof ──────────────────────────────────────────────────────────────────────────────────────────────────
  try {
    await page.evaluate((k) => localStorage.removeItem(k), SWITCH_KEY).catch(() => {});
    const out = await page.evaluate(async (id) => { const c = window.pfSupabase; await c.from("model_sheets").delete().eq("id", id); return ((await c.from("model_sheets").select("id").eq("id", id)).data || []).length; }, PROJECT);
    const gone = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)] }));
    ok("G1 the throwaway workbook row and plan are gone (re-read from the database)", out === 0 && !(gone.errors || []).length && gone.left?.site === 0, `model_sheets rows left ${out}; ${JSON.stringify(gone)}`);
  } catch (e) { ok("G1 cleanup", false, String(e.message).split("\n")[0]); }
  await s.close();
  console.log(`\n${voided ? "VOID" : failures ? "FAILED" : "PASSED"} — ${failures} failure(s)`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), base: BASE, failures, voided, log }, null, 2));
  process.exit(voided ? 2 : failures ? 1 : 0);
}
