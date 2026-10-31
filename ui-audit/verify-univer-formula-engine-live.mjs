/* verify-univer-formula-engine-live — V2034432 (B2585376, one formula engine) on a REAL deploy.
 * SIGNED IN as the throwaway test account on ONE throwaway project (deleted and re-asked at the end — owner rule 15).
 * The Univer grid is the default for every account (cutover 2026-10-31): the test account, NOT an admin, sees it with no switch and no
 * is_admin intercept. Builds a workbook with the real grid (facade writes + REAL keystrokes for the typed formulas),
 * lets the formula Web Worker calculate it, then File ▾ → Export to Excel and re-reads the .xlsx with ExcelJS:
 *   K  known-good arm   =SUM(B1:B2) = 300 in the grid AND as the cached result in the file (VOID if the grid does not say 300)
 *   E1 every cached result in the file equals the number the grid shows for that cell (SUM, PMT, EDATE, interleaved XIRR)
 *   E2 the typed interleaved XIRR is stored AND exported as Excel's two-list CHOOSE form (no Planyr-only syntax in the file)
 *   E3 the circular pair is named in the notice the person sees (grid after calc, and again after the export)
 *   E4 the CSV export carries the same numbers
 * The build id is read in the SAME call as the assertions and must equal the merge commit given as --build.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-univer-formula-engine-live.mjs [base] --build 9ff17ea [--json out.json] */
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const WANT = args.includes("--build") ? args[args.indexOf("--build") + 1] : null;
const JSON_OUT = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const A = `${LIVE_PREFIX}fe-${Date.now().toString(36)}`;
const out = [];
let failures = 0, voided = null;
const ok = (name, cond, extra = "") => { out.push({ name, pass: !!cond, extra }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const VOID = (msg) => { voided = voided || msg; throw Object.assign(new Error("VOID — " + msg), { void: true }); };

const s = await openSignedIn({ base: BASE });
const { page } = s;
try {
  await assertMeasurable(page, "verify-univer-formula-engine-live");
  await seedThrowawayPlan(page, A);
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.goto(`${BASE}/?cb=${Date.now()}#/project/${A}/spreadsheet`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="univer-grid"] canvas', { timeout: 90000 });
  await page.waitForFunction(() => window.__planyrUniverRead && window.__planyrUniverRead.api() && window.__planyrUniverRead.api().getActiveWorkbook());
  const served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
  ok("0 the served build is the merge commit", !WANT || String(served.build).startsWith(WANT), `served ${served.build}, wanted ${WANT || "(any)"}`);
  if (WANT && !String(served.build).startsWith(WANT)) VOID(`the deploy is not serving ${WANT} yet`);
  console.log(`account: ${s.proof.email}  base: ${BASE}  build: ${served.build}`);

  await page.waitForSelector('canvas[id^="univer-sheet-main-canvas"]', { timeout: 60000 });
  await page.waitForTimeout(2500);                                                    // let the first load, the worker and the early warm-up settle
  const sheet = (fn, arg) => page.evaluate(fn, arg);
  await sheet(() => {
    const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet();
    ws.getRange(0, 1).setValue(100); ws.getRange(1, 1).setValue(200); ws.getRange(2, 1).setFormula("=SUM(B1:B2)");
    ws.getRange(0, 2).setFormula("=PMT(0.06/12,360,-250000)");
    ws.getRange(0, 3).setFormula("=DATE(2026,1,15)"); ws.getRange(1, 3).setFormula("=EDATE(D1,2)");
    ws.getRange(0, 4).setFormula("=E2"); ws.getRange(1, 4).setFormula("=E1");        // a circular pair
  });
  const pt = (r, c) => sheet(([rr, cc]) => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); const q = ws.getRange(rr, cc).getCellRect(); const o = typeof q === "string" ? JSON.parse(q) : q; const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect(); return { x: cv.left + o.x + o.width / 2, y: cv.top + o.y + o.height / 2 }; }, [r, c]);
  const p = await pt(0, 5); await page.mouse.click(p.x, p.y); await page.waitForTimeout(250);
  await page.keyboard.type("=XIRR(-1000,DATE(2026,1,1),1500,DATE(2027,1,1))", { delay: 6 }); await page.keyboard.press("Enter");
  await page.waitForTimeout(3500);                                                    // worker calculation + the 300 ms save
  const grid = await sheet(() => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); const g = (r, c) => { const x = ws.getRange(r, c); const d = x.getCellData && x.getCellData(); return d && typeof d.v === "number" ? d.v : (x.getValue() ?? x.getDisplayValue()); }; return { sum: g(2, 1), pmt: g(0, 2), edate: g(1, 3), xirr: g(0, 5), formulaF1: ws.getRange(0, 5).getFormula() }; });
  console.log("grid:", JSON.stringify(grid));
  if (grid.sum !== 300) VOID(`KNOWN-GOOD ARM: the grid shows =SUM(B1:B2) = ${JSON.stringify(grid.sum)}, not 300 — the build/worker is not calculating`);
  ok("K known-good arm: =SUM(B1:B2) is 300 in the grid", true);
  ok("E2a the typed interleaved XIRR is stored in Excel's two-list form", /CHOOSE\(\{1,2\}/.test(grid.formulaF1 || ""), grid.formulaF1);
  const notice1 = await page.evaluate(() => (document.querySelector('[data-testid="model-file-notice"]') || {}).innerText || "");

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e.message).slice(0, 300)));
  await page.click('[data-testid="model-file-menu-btn"]'); await page.waitForTimeout(250);
  // The notice clears itself after ~9 s, so it is sampled WHILE waiting (a read after the wait would always say "none").
  const seenNotices = new Set();
  const sampler = setInterval(() => { page.evaluate(() => [...document.querySelectorAll('[data-testid="model-file-notice"],[data-testid="model-notice"]')].map((n) => n.innerText).join(" ⏐ ")).then((t) => { if (t) seenNotices.add(t.slice(0, 400)); }).catch(() => {}); }, 400);
  const dlP = page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
  await page.click('[data-testid="model-export-xlsx"]');
  const dl = await dlP;
  clearInterval(sampler);
  if (!dl) {
    ok("X the Excel download started", false, `notices seen: ${[...seenNotices].join(" || ") || "(none)"} | console: ${consoleErrors.slice(-4).join(" || ")}`);
    throw Object.assign(new Error("export produced no download"), { void: false });
  }
  const wbx = new ExcelJS.Workbook(); await wbx.xlsx.read(await dl.createReadStream());
  const ws = wbx.worksheets[0];
  const cell = (a) => ws.getCell(a).value;
  const res = (a) => { const v = cell(a); return v && typeof v === "object" && "result" in v ? v.result : v; };
  const asNum = (v) => (v instanceof Date ? v.getTime() / 86400000 + 25569 : Number(v));
  ok("K2 the file's =SUM cached result is 300 (formula SUM(B1:B2))", cell("B3") && cell("B3").formula === "SUM(B1:B2)" && res("B3") === 300, JSON.stringify(cell("B3")));
  const close = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  ok("E1 cached results equal the grid: PMT, EDATE, interleaved XIRR", close(asNum(res("C1")), grid.pmt) && close(asNum(res("D2")), typeof grid.edate === "number" ? grid.edate : asNum(grid.edate)) && close(asNum(res("F1")), grid.xirr), `file C1=${res("C1")} D2=${res("D2")} F1=${res("F1")}  grid ${grid.pmt} / ${grid.edate} / ${grid.xirr}`);
  ok("E2b the file carries Excel's two-list XIRR and no Planyr-only syntax", /^XIRR\(CHOOSE\(\{1,2\},-1000,1500\),CHOOSE\(\{1,2\},DATE\(2026,1,1\),DATE\(2027,1,1\)\)\)$/.test((cell("F1") || {}).formula || ""), (cell("F1") || {}).formula);
  const notice2 = [...seenNotices].join(" ⏐ ");
  ok("E3 the circular pair is named in the notice (grid and/or export)", /circular reference/.test(notice1 + " " + notice2) && /E1|E2/.test(notice1 + " " + notice2), `grid notice: ${notice1.slice(0, 110)} | export notice: ${notice2.slice(0, 110)}`);

  await page.click('[data-testid="model-file-menu-btn"]'); await page.waitForTimeout(250);
  const csvBtn = page.locator('[data-testid="model-export-csv"]');
  if (await csvBtn.count()) {
    const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), csvBtn.click()]);
    const chunks = []; for await (const c of await dl2.createReadStream()) chunks.push(c);
    const csv = Buffer.concat(chunks).toString("utf8");
    ok("E4 the CSV carries the same numbers (300 and the PMT)", /,300(,|\r?\n|$)/.test(csv) && csv.includes(String(grid.pmt).slice(0, 8)), csv.split(/\r?\n/).slice(0, 3).join(" ⏎ "));
  } else ok("E4 CSV menu item present", false, "model-export-csv not found");
} catch (e) {
  if (e.void) console.log(String(e.message)); else { failures++; console.log("FAIL — threw: " + String(e.stack || e).split("\n").slice(0, 3).join(" | ")); }
} finally {
  try {
    await page.evaluate(async (pid) => { await window.pfSupabase.from("model_sheets").delete().eq("id", pid); await window.pfSupabase.from("project_folders").delete().eq("project_id", pid); }, A).catch(() => {});
    const cl = await cleanupLive(page, { planId: A }).catch((e) => ({ errors: [String(e)], left: {} }));
    const ms = await page.evaluate(async (pid) => ((await window.pfSupabase.from("model_sheets").select("id").eq("id", pid)).data || []).length, A).catch(() => -1);
    ok("cleanup: the throwaway project and its workbook are removed (verified)", cl.left.site === 0 && ms === 0, `project left: ${cl.left.site}, workbook rows left: ${ms}`);
  } catch (e) { failures++; console.log("FAIL — cleanup threw: " + e); }
  await s.close().catch(() => {});
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), failures, voided, out }, null, 2));
  console.log(voided ? `\nVOID: ${voided}` : failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(voided ? 2 : failures ? 1 : 0);
}
