/* verify-univer-save-live — NEW-2 (B2577681) on a REAL deploy: every way out of the Univer grid saves the edit made a moment ago.
 * SIGNED IN as the throwaway test account on THROWAWAY rows (two plans, one Library file, one org workbook); everything it
 * makes is deleted and the database is asked again to prove it is gone (owner rule 15). `is_admin` is answered `true` by a
 * network intercept for THIS browser only (the client gate is a visibility switch; data access is still the test account's own).
 *
 * THE DEBOUNCE IS FROZEN for the one step of each check that makes the edit (window.setTimeout is wrapped so the grid's 300 ms
 * save timer cannot fire for ~10 minutes): the edit can then reach the saved workbook ONLY through the flush under test, so a
 * green result cannot be the debounce winning a race. KNOWN-GOOD ARM per check: `pending()` must be true before leaving —
 * otherwise the check is VOID, not green.
 *
 *  P1 grid toggle  P2 Export (.xlsx re-read with ExcelJS)  P3 module tab hidden  P4 project change (old project gets it, the new
 *  one does not)  P5 reload (beforeunload)  P6 Ctrl+Z in the regular grid after switching back: one step per committed Univer edit
 *  F1 file mode: Library .xlsx opened in Univer, edit, Close file → stored file holds it, reopens with it in the regular grid
 *  O1 org workbook: edit in Univer, back to the list, reload, same value
 *  H  header drag (NEW-1 / B2577680): the four header-drag checks of verify-univer-parity, run on the real page
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-univer-save-live.mjs [base=https://planyr.io] [--json out.json] */
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { bind, checks as parityChecks, record as parityRecord, results_ as parityResults } from "./verify-univer-parity.mjs";

const args = process.argv.slice(2);
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const JSON_OUT = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const STAMP = Date.now().toString(36);
const A = `${LIVE_PREFIX}usave-a-${STAMP}`, B = `${LIVE_PREFIX}usave-b-${STAMP}`;
const T = `zzusave${STAMP}`;
const SWITCH_KEY = "planyr:model:univerGrid";
const out = [];
let failures = 0, voided = null;
const ok = (name, cond, extra = "") => { out.push({ name, pass: !!cond, extra }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const VOID = (msg) => { voided = voided || msg; throw Object.assign(new Error("VOID — " + msg), { void: true }); };

const s = await openSignedIn({ base: BASE });
const { page } = s;
const freeze = (on) => page.evaluate((v) => { window.__freezeDebounce = v; }, on);   // outside the try: the cleanup must always be able to call it
const madeReviews = [], driveKeys = new Set();
let orgIdsBefore = [];
try {
  await assertMeasurable(page, "verify-univer-save-live");
  const build = (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  console.log(`served build: ${build}  account: ${s.proof.email}  base: ${BASE}`);
  await seedThrowawayPlan(page, A); await seedThrowawayPlan(page, B);

  await page.addInitScript(() => {
    window.__PLANYR_E2E = true;
    // The grid's 300 ms save timer is stretched to ~10 minutes while __freezeDebounce is on (see the header).
    const orig = window.setTimeout.bind(window);
    window.__freezeDebounce = false;
    window.setTimeout = (fn, ms, ...rest) => orig(fn, window.__freezeDebounce && ms === 300 ? 600000 : ms, ...rest);
  });
  let adminHits = 0;
  await page.route("**/rest/v1/rpc/is_admin*", (route) => { adminHits++; route.fulfill({ status: 200, contentType: "application/json", body: "true" }); });

  const url = (id) => `${BASE}/?cb=${Date.now()}#/project/${id}/spreadsheet`;
  const waitGrid = async () => { await page.waitForSelector('[data-testid="univer-grid"] canvas', { timeout: 90000 }); await page.waitForFunction(() => { const a = window.__planyrUniverRead && window.__planyrUniverRead.api(); return !!(a && a.getActiveWorkbook() && a.getActiveWorkbook().getActiveSheet()); }, null, { timeout: 90000, polling: 25 }); await page.waitForTimeout(1500); };
  const openSheet = async (id, { univer = true } = {}) => {
    await page.goto(url(id), { waitUntil: "load" });
    await page.evaluate(([k, on]) => (on ? localStorage.setItem(k, "1") : localStorage.removeItem(k)), [SWITCH_KEY, univer]);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('[data-testid="model-root"]', { timeout: 60000 });
    if (univer) await waitGrid(); else { await page.waitForSelector('[data-testid="model-sheet"]', { timeout: 60000 }); await page.waitForTimeout(1500); }
  };
  const pending = () => page.evaluate(() => window.__planyrUniverRead && window.__planyrUniverRead.pending());
  const uPt = (r, c) => page.evaluate(([rr, cc]) => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); const q = ws.getRange(rr, cc).getCellRect(); const o = typeof q === "string" ? JSON.parse(q) : q; const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect(); return { x: cv.left + o.x + o.width / 2, y: cv.top + o.y + o.height / 2 }; }, [r, c]);
  const uVal = (r, c) => page.evaluate(([rr, cc]) => { const g = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange(rr, cc); const v = g.getValue(); return v !== null && v !== undefined ? v : (g.getDisplayValue() || null); }, [r, c]);
  /** real click + real keys; the grid is left with the edit pending (debounce frozen) */
  const uType = async (r, c, text) => { const p = await uPt(r, c); await page.mouse.click(p.x, p.y); await page.waitForTimeout(250); await page.keyboard.type(text, { delay: 6 }); await page.keyboard.press("Enter"); await page.waitForTimeout(120); };
  /** type with the debounce frozen and PROVE the edit is still inside the window; returns after unfreezing is the caller's job */
  const editPending = async (r, c, text) => { await freeze(true); await uType(r, c, text); if (!(await pending())) VOID(`the edit "${text}" was not pending before leaving — this check would pass on the debounce`); };
  const oldCell = (r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`).first();
  const cloudRow = (id) => page.evaluate(async (i) => (await window.pfSupabase.from("model_sheets").select("data, version").eq("id", i).maybeSingle()).data || null, id);
  const cellsOf = (row) => Object.values(row?.data?.sheets?.[0]?.sheet?.cells || {});
  const waitCloud = async (id, text, ms = 40000) => { const t0 = Date.now(); for (;;) { const r = await cloudRow(id); if (cellsOf(r).includes(text)) return r; if (Date.now() - t0 > ms) return r; await page.waitForTimeout(800); } };
  const openFileMenu = async () => { await page.click('[data-testid="model-file-menu-btn"]'); await page.waitForTimeout(250); };

  // KNOWN-GOOD ARM for the gate + coordinates
  await openSheet(A);
  ok("0 KNOWN-GOOD ARM: the is_admin intercept was hit and the Univer grid mounted", adminHits > 0 && (await page.locator('[data-testid="univer-grid"]').count()) === 1, `${adminHits} hit(s)`);
  if (!adminHits) VOID("the intercept never fired");
  await uType(0, 0, "arm"); await page.waitForTimeout(700);
  if ((await uVal(0, 0)) !== "arm") VOID("a click + typing at A1's computed point did not land in A1");

  // ── H header drag on the real page (the parity checks, bound to this page) ──────────────────────────────────────────────────
  const SEED = [["1", "alpha", "cherry"], ["2", "beta", "apple"], ["3", "=A1+A2", "banana"], ["4", 3], ["5", 5]];
  const liveReset = async () => {
    await page.waitForTimeout(450);
    await page.evaluate((seed) => {
      const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet();
      ws.getRange(0, 0, 60, 14).clear(); ws.setFrozenRows(0); ws.setFrozenColumns(0);
      seed.forEach((row, r) => row.forEach((v, c) => { const x = ws.getRange(r, c); if (typeof v === "string" && v.startsWith("=")) x.setFormula(v); else x.setValue(/^\d+$/.test(String(v)) ? Number(v) : v); }));
      ws.scrollToCell(0, 0); ws.getRange(0, 0).activate();
    }, SEED);
    await page.waitForTimeout(500);
  };
  bind({ page, reset: liveReset });
  parityResults.length = 0;
  const HEADER_IDS = ["header-drag-moves", "header-drag-moves-rows", "header-shift-drag-moves", "header-press-keeps-others", "header-resize-autofit"];
  for (const c of parityChecks.filter((x) => HEADER_IDS.includes(x.id))) {
    try { const r = await c.fn(); parityRecord(c.id, c.label, r.status, r.detail); } catch (e) { parityRecord(c.id, c.label, "FAIL", "threw: " + String(e.message).split("\n")[0].slice(0, 200)); }
  }
  for (const r of parityResults) ok(`H ${r.id}: ${r.label}`, r.status === "PASS", r.detail);
  ok("H0 all five header-drag checks ran on the real page", parityResults.length === HEADER_IDS.length, `${parityResults.length}/${HEADER_IDS.length}`);
  await page.evaluate(() => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); ws.getRange(0, 0, 60, 14).clear(); ws.setFrozenRows(0); ws.setFrozenColumns(0); ws.getRange(0, 0).activate(); });
  await page.waitForTimeout(1200);   // ← the grid is blank again (and saved) before the save-path checks start

  // ── P1 grid toggle ─────────────────────────────────────────────────────────────────────────────────────────────────────
  await editPending(2, 0, "toggle-1");
  await openFileMenu(); await page.click('[data-testid="model-univer-switch"]');
  await freeze(false);
  await page.waitForSelector('[data-testid="model-sheet"]', { timeout: 30000 }); await page.waitForTimeout(1200);
  ok("P1 switching to the regular grid inside the debounce window shows the edit", (await oldCell(2, 0).innerText()).trim() === "toggle-1");
  const p1 = await waitCloud(A, "toggle-1");
  ok("P1b …and it reached the cloud row", cellsOf(p1).includes("toggle-1"), `version ${p1?.version}`);

  // ── P6 Ctrl+Z in the regular grid: one step per committed Univer edit (set up here: the regular grid is showing) ─────────
  await openFileMenu(); await page.click('[data-testid="model-univer-switch"]'); await waitGrid();
  await uType(4, 0, "undo-a"); await page.waitForTimeout(900);           // > debounce: committed edit 1
  await uType(5, 0, "undo-b"); await page.waitForTimeout(900);           // committed edit 2
  await openFileMenu(); await page.click('[data-testid="model-univer-switch"]');
  await page.waitForSelector('[data-testid="model-sheet"]', { timeout: 30000 }); await page.waitForTimeout(1200);
  const shown = [(await oldCell(4, 0).innerText()).trim(), (await oldCell(5, 0).innerText()).trim()];
  await oldCell(10, 5).click(); await page.keyboard.press("Control+z"); await page.waitForTimeout(500);
  const afterOne = [(await oldCell(4, 0).innerText()).trim(), (await oldCell(5, 0).innerText()).trim()];
  await page.keyboard.press("Control+z"); await page.waitForTimeout(500);
  const afterTwo = [(await oldCell(4, 0).innerText()).trim(), (await oldCell(5, 0).innerText()).trim()];
  ok("P6 after switching back, ONE Ctrl+Z undoes only the LAST Univer edit; a second undoes the one before", shown[0] === "undo-a" && shown[1] === "undo-b" && afterOne[0] === "undo-a" && afterOne[1] === "" && afterTwo[0] === "" && afterTwo[1] === "", `shown ${JSON.stringify(shown)} → ${JSON.stringify(afterOne)} → ${JSON.stringify(afterTwo)}`);

  // ── P2 Export ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  await openFileMenu(); await page.click('[data-testid="model-univer-switch"]'); await waitGrid();
  await editPending(6, 0, "export-1");
  await openFileMenu();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click('[data-testid="model-export-xlsx"]')]);
  await freeze(false);
  const wbx = new ExcelJS.Workbook(); await wbx.xlsx.read(await dl.createReadStream());
  const exported = []; wbx.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => exported.push(String(cell.value)))));
  ok("P2 Export inside the debounce window contains the edit", exported.includes("export-1"), `cells in the .xlsx: ${exported.slice(0, 8).join(", ")}${exported.length > 8 ? "…" : ""}`);

  // ── P3 module tab hidden ────────────────────────────────────────────────────────────────────────────────────────────────
  await editPending(7, 0, "tab-1");
  await page.click('[data-testid="module-tab-library"]'); await page.waitForTimeout(800);
  await freeze(false);
  const p3 = await waitCloud(A, "tab-1");
  ok("P3 switching module tab inside the debounce window saves it to the cloud", cellsOf(p3).includes("tab-1"));
  await page.click('[data-testid="module-tab-model"]').catch(() => {}); await page.waitForTimeout(800);

  // ── P4 project change ───────────────────────────────────────────────────────────────────────────────────────────────────
  await openSheet(A); // fresh page, Univer on
  await editPending(8, 0, "proj-1");
  await page.evaluate((id) => { location.hash = `#/project/${id}/spreadsheet`; }, B);
  await page.waitForTimeout(2500); await freeze(false);
  const local = await page.evaluate(([id]) => Object.keys(localStorage).filter((k) => k.includes(id)).map((k) => [k, (localStorage.getItem(k) || "").includes("proj-1")]), [A]);
  const pa = await waitCloud(A, "proj-1", 30000);
  const pb = await cloudRow(B);
  ok("P4 changing project inside the debounce window saves the edit to the project it was made in", cellsOf(pa).includes("proj-1"), `local copies holding it: ${local.filter((x) => x[1]).length}`);
  ok("P4b …and the edit did NOT land in the project that was opened", !cellsOf(pb).includes("proj-1"), `project B cells: ${JSON.stringify(cellsOf(pb))}`);

  // ── P5 reload (beforeunload) ────────────────────────────────────────────────────────────────────────────────────────────
  await openSheet(A);
  await editPending(9, 0, "reload-1");
  await page.reload({ waitUntil: "load" });                                   // a REAL reload: beforeunload + pagehide fire
  await freeze(false);
  await page.waitForSelector('[data-testid="univer-grid"] canvas', { timeout: 90000 }); await waitGrid();
  ok("P5 reloading inside the debounce window: the edit is in the sheet that comes back", (await uVal(9, 0)) === "reload-1");
  const p5 = await waitCloud(A, "reload-1");
  ok("P5b …and in the cloud row", cellsOf(p5).includes("reload-1"));
  ok("P5c no 'different copy saved in the cloud' bar at any point of the reload", (await page.locator('[data-testid="model-diverged-bar"]').count()) === 0);

  // ── F1 file mode ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const xl = new ExcelJS.Workbook(); const ws1 = xl.addWorksheet("Data"); ws1.getCell("A1").value = "alpha"; ws1.getCell("B1").value = 1000; ws1.getCell("C1").value = { formula: "B1*2", result: 2000 };
  const xlBuf = Buffer.from(await xl.xlsx.writeBuffer());
  const fileName = `${T}-model.xlsx`;
  await page.goto(`${BASE}/?cb=${Date.now()}#/project/${A}/library`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="library-unified"]', { timeout: 60000 }); await page.waitForTimeout(2000);
  await page.locator('[data-testid="library-unified"] input[type=file]:not([webkitdirectory])').first().setInputFiles({ name: fileName, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: xlBuf });
  const rowFor = () => page.locator('[data-testid="library-file-row"]', { hasText: fileName.replace(/\.[^.]+$/, "") });
  await rowFor().first().waitFor({ timeout: 90000 }); await page.waitForTimeout(1500);
  const fileIds = await page.evaluate(async (t) => ((await window.pfSupabase.from("doc_reviews").select("id").ilike("title", `%${t}%`).is("deleted_at", null)).data || []).map((r) => r.id), T);
  if (!fileIds[0]) VOID("the fixture file never reached doc_reviews"); madeReviews.push(fileIds[0]);
  const rec = () => page.evaluate(async (i) => (await window.pfSupabase.from("doc_reviews").select("data").eq("id", i).single()).data?.data, fileIds[0]);
  const bytesOf = async (driveKey) => { driveKeys.add(driveKey); const b64 = await page.evaluate(async (k) => { const { data: { session } } = await window.pfSupabase.auth.getSession(); const r = await fetch(`/api/files?key=${encodeURIComponent(k)}`, { headers: { authorization: `Bearer ${session.access_token}` } }); const u = new Uint8Array(await r.arrayBuffer()); let str = ""; for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(str); }, driveKey); return Buffer.from(b64, "base64"); };
  await page.evaluate(([k]) => localStorage.setItem(k, "1"), [SWITCH_KEY]);
  await rowFor().first().click(); await page.waitForSelector('[data-testid="model-file-bar"]', { timeout: 60000 }); await waitGrid();
  ok("F1a KNOWN-GOOD ARM: the Library file opened in the Univer grid with its own values", (await uVal(0, 0)) === "alpha" && (await uVal(0, 1)) === 1000, `A1=${JSON.stringify(await uVal(0, 0))} B1=${JSON.stringify(await uVal(0, 1))}`);
  if ((await uVal(0, 0)) !== "alpha") VOID("file mode did not show the file's values in Univer");
  await editPending(2, 0, "file-edit");
  await page.click('[data-testid="model-file-close"]');                       // Close file: flush Univer, then wait for the upload
  await freeze(false);
  await page.waitForSelector('[data-testid="model-file-bar"]', { state: "detached", timeout: 90000 }).catch(() => {});
  let r1 = null; const t0 = Date.now(); while (Date.now() - t0 < 60000) { r1 = await rec(); if ((r1.sources || []).length >= 2) break; await page.waitForTimeout(800); }
  ok("F1b Close file inside the debounce window uploaded a NEW stored version (the upload kept as the prior one)", (r1.sources || []).length >= 2, `${(r1.sources || []).length} stored version(s)`);
  const newest = r1.sources[r1.sources.length - 1] && r1.sources[0];
  let stored = []; if (r1.sources.length >= 2) { const wbS = new ExcelJS.Workbook(); await wbS.xlsx.load(await bytesOf(r1.sources[0].driveKey)); wbS.eachSheet((w) => w.eachRow((row) => row.eachCell((c) => stored.push(String(c.value?.result ?? c.value))))); }
  const wbO = new ExcelJS.Workbook(); if (r1.sources.length >= 2) await wbO.xlsx.load(await bytesOf(r1.sources[r1.sources.length - 1].driveKey));
  ok("F1c the stored file holds the edit AND the file's own values and formula (re-read with ExcelJS — the Excel side)", stored.includes("file-edit") && stored.includes("alpha") && stored.includes("2000"), `cells: ${stored.join(", ")}`);
  ok("F1d …and the upload is still stored, byte for byte, as the oldest version", r1.sources.length >= 2 && Buffer.compare(await bytesOf(r1.sources[r1.sources.length - 1].driveKey), xlBuf) === 0);
  await page.evaluate(([k]) => localStorage.removeItem(k), [SWITCH_KEY]);
  await page.goto(`${BASE}/?cb=${Date.now()}#/project/${A}/library`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="library-unified"]', { timeout: 60000 }); await page.waitForTimeout(2000);
  await rowFor().first().click(); await page.waitForSelector('[data-testid="model-file-bar"]', { timeout: 60000 }); await page.waitForSelector('[data-testid="model-sheet"]', { timeout: 60000 }); await page.waitForTimeout(1500);
  ok("F1e reopened in the REGULAR grid, the file shows the Univer edit", (await oldCell(2, 0).innerText()).trim() === "file-edit" && (await oldCell(0, 0).innerText()).trim() === "alpha");
  await page.locator('[data-testid="model-file-close"]').click().catch(() => {}); await page.waitForTimeout(800);

  // ── O1 org workbook ─────────────────────────────────────────────────────────────────────────────────────────────────────
  orgIdsBefore = await page.evaluate(async () => ((await window.pfSupabase.from("org_model_sheets").select("id")).data || []).map((r) => r.id));
  await page.evaluate(([k]) => localStorage.setItem(k, "1"), [SWITCH_KEY]);
  await page.goto(`${BASE}/?cb=${Date.now()}#/org/spreadsheet`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="org-workbook-new"]', { timeout: 60000 }); await page.waitForTimeout(1500);
  await page.click('[data-testid="org-workbook-new"]'); await waitGrid();
  await editPending(2, 0, "org-1");
  await page.getByText("‹ Workbooks").click(); await freeze(false);
  await page.waitForSelector('[data-testid="org-workbook-row"]', { timeout: 30000 }); await page.waitForTimeout(1500);
  const orgNow = await page.evaluate(async () => ((await window.pfSupabase.from("org_model_sheets").select("id, data")).data || []));
  const mine = orgNow.filter((r) => !orgIdsBefore.includes(r.id));
  ok("O1a an org workbook was created for this run (known-good arm)", mine.length === 1, `${mine.length} new row(s)`);
  if (mine.length !== 1) VOID("could not identify the org workbook this run created");
  let orgRow = null; const t1 = Date.now(); while (Date.now() - t1 < 40000) { orgRow = (await page.evaluate(async (i) => (await window.pfSupabase.from("org_model_sheets").select("data").eq("id", i).maybeSingle()).data, mine[0].id)); if (Object.values(orgRow?.data?.sheets?.[0]?.sheet?.cells || {}).includes("org-1")) break; await page.waitForTimeout(800); }
  ok("O1b going back to the list inside the debounce window saved the edit to the org workbook's cloud row", Object.values(orgRow?.data?.sheets?.[0]?.sheet?.cells || {}).includes("org-1"));
  await page.goto(`${BASE}/?cb=${Date.now()}#/org/spreadsheet`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="org-workbook-open"]', { timeout: 60000 }); await page.locator('[data-testid="org-workbook-open"]').first().click(); await waitGrid();
  ok("O1c after a cache-busted reload the workbook opens in Univer with the same value", (await uVal(2, 0)) === "org-1");
} catch (e) {
  if (!e.void) { failures++; console.log("FAIL — threw: " + String(e.stack || e).split("\n").slice(0, 3).join(" | ")); }
  else console.log(String(e.message));
} finally {
  try {
    await freeze(false).catch(() => {});
    await page.evaluate(([k]) => localStorage.removeItem(k), [SWITCH_KEY]).catch(() => {});
    // Library file + copies
    const keys = await page.evaluate(async (ids) => { const o = []; for (const id of ids) { const r = await window.pfSupabase.from("doc_reviews").select("data").eq("id", id).maybeSingle(); for (const src of (r.data?.data?.sources || [])) if (src.driveKey) o.push(src.driveKey); } return o; }, madeReviews).catch(() => []);
    keys.forEach((k) => driveKeys.add(k));
    const left = await page.evaluate(async ([ids]) => { for (const id of ids) { await window.pfSupabase.from("file_facts").delete().eq("id", id); await window.pfSupabase.from("doc_reviews").delete().eq("id", id); } return ((await window.pfSupabase.from("doc_reviews").select("id").in("id", ids)).data || []).length; }, [madeReviews]).catch(() => -1);
    ok("cleanup: the Library file is removed (verified)", left === 0, `rows left: ${left}`);
    // org workbook(s) this run made
    const orgLeft = await page.evaluate(async ([before]) => { const now = (await window.pfSupabase.from("org_model_sheets").select("id")).data || []; const mine = now.filter((r) => !before.includes(r.id)).map((r) => r.id); for (const id of mine) await window.pfSupabase.from("org_model_sheets").delete().eq("id", id); return ((await window.pfSupabase.from("org_model_sheets").select("id")).data || []).filter((r) => !before.includes(r.id)).length; }, [orgIdsBefore]).catch(() => -1);
    ok("cleanup: the org workbook is removed (verified)", orgLeft === 0, `rows left: ${orgLeft}`);
    for (const id of [A, B]) {
      await page.evaluate(async (pid) => { await window.pfSupabase.from("model_sheets").delete().eq("id", pid); await window.pfSupabase.from("project_folders").delete().eq("project_id", pid); }, id).catch(() => {});
      const cl = await cleanupLive(page, { planId: id }).catch((e) => ({ errors: [String(e)], left: {} }));
      const ms = await page.evaluate(async (pid) => ((await window.pfSupabase.from("model_sheets").select("id").eq("id", pid)).data || []).length, id).catch(() => -1);
      ok(`cleanup: throwaway project ${id.slice(-6)} and its workbook are removed (verified)`, cl.left.site === 0 && ms === 0, `project left: ${cl.left.site}, workbook rows left: ${ms}, errors: ${(cl.errors || []).join("; ") || "none"}`);
    }
  } catch (e) { failures++; console.log("FAIL — cleanup threw: " + e); }
  await s.close().catch(() => {});
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), failures, voided, out }, null, 2));
  console.log(voided ? `\nVOID: ${voided}` : failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(voided ? 2 : failures ? 1 : 0);
}
