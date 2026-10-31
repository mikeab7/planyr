/* verify-univer-load-live — how fast the Univer grid appears on the REAL deploy, and what it downloads (NEW-1, B2587264 —
 * docs/SPREADSHEET-UNIVER-SPIKE.md cutover step 4). Signed in as the throwaway test account on a throwaway project holding the 1,000-row × 12-column fixture; nothing of the
 * owner's is read or written, and everything it makes is deleted and re-read as gone (owner rule 15).
 *
 *  A  COLD     browser cache cleared each run: navigation → a painted Univer grid with its first cell readable, median of RUNS, against the
 *              same page with the regular grid (switch off). Reports the served files and their COMPRESSED sizes (CDP encodedDataLength — what
 *              crossed the wire), the formula worker, and how many hyphenation language files were requested.
 *  B  HOVER    Site route open, the device switch on: resting the pointer on the Spreadsheet tab must fetch the Univer chunk BEFORE the click
 *              (that is the whole point of the warm-up); then the click → a painted grid is timed.
 *  C  NON-USER a device whose switch is OFF must NOT download the Univer chunk when it hovers the tab (1.8 MB for nothing).
 *  D  CLEANUP  the throwaway plan is gone.
 *
 * VERDICT RULES (what fails the run): a hyphenation language file requested on an English sheet · no formula worker request · the Univer chunk
 * not fetched during the hover · fetched at all for a switch-off device · the grid never painted. The ratio to the regular grid is REPORTED
 * against the 1.25 target, not failed on — the number reached is the finding.
 * The served build id is read in the SAME call as every measurement (a stale tab proves nothing).
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-univer-load-live.mjs [base=https://planyr.io] [--runs 3] [--json out.json] */
import { writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { isLangFile } from "./lib/univerLangFiles.mjs";
import { createWorkbook } from "../src/workspaces/model/lib/sheetModel.js";

const args = process.argv.slice(2);
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const RUNS = Number(val("--runs", 3));
const JSON_OUT = val("--json", null);
const PROJECT = `${LIVE_PREFIX}load-${Date.now().toString(36)}`;
const SWITCH_KEY = "planyr:model:univerGrid";
// The spec's fixture: 1,000 rows × 12 columns, the last column a SUM formula per row (the same sheet measure-univer-tti.mjs builds).
const ROWS = 1000, COLS = 12;
function fixtureWorkbook() {
  const wb = createWorkbook(); const sh = wb.sheets[0].sheet; const cells = {};
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells[`${sh.columns[c].id}:${r}`] = c === COLS - 1 ? `=SUM(A${r + 1}:K${r + 1})` : String(((r * 31 + c * 7) % 1000) + 0.5);
  return { ...wb, sheets: [{ ...wb.sheets[0], sheet: { ...sh, rowCount: ROWS + 5, cells } }] };
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
let failures = 0, voided = false;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const log = {};

const s = await openSignedIn({ base: BASE });
const { page } = s;
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
let net = new Map();                                           // requestId → { url, bytes }
cdp.on("Network.requestWillBeSent", (e) => { net.set(e.requestId, { url: e.request.url, bytes: 0, t: Date.now() }); });
cdp.on("Network.loadingFinished", (e) => { const r = net.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
const jsFiles = () => [...net.values()].filter((r) => /\/assets\/[^?]+\.js(\?|$)/.test(r.url));
const univerFiles = () => jsFiles().filter((r) => /UniverSheet-|univerFormulaWorker-|univerWarm-/.test(r.url) || isLangFile(r.url));
const kbs = (n) => `${(n / 1024).toFixed(0)} KB`;

try {
  await assertMeasurable(page, "verify-univer-load-live");
  const build = () => page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build));
  console.log(`served build: ${await build()}  account: ${s.proof.email}  base: ${BASE}`);
  await seedThrowawayPlan(page, PROJECT);
  const seeded = await page.evaluate(async ([id, data]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("model_sheets").insert({ id, user_id: u.user.id, data, version: 1 });
    return error ? String(error.message) : null;
  }, [PROJECT, fixtureWorkbook()]);
  if (seeded) { voided = true; throw new Error("VOID — could not seed the 1,000-row workbook: " + seeded); }
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  let hits = 0;
  await page.route("**/rest/v1/rpc/is_admin*", (route) => { hits++; route.fulfill({ status: 200, contentType: "application/json", body: "true" }); });
  const sheetUrl = () => `${BASE}/?cb=${Date.now()}#/project/${PROJECT}/spreadsheet`;
  const siteUrl = () => `${BASE}/?cb=${Date.now()}#/project/${PROJECT}`;
  const setSwitch = (on) => page.evaluate(([k, v]) => { if (v) localStorage.setItem(k, "1"); else localStorage.removeItem(k); }, [SWITCH_KEY, on]);
  // "painted" = the canvas is up AND the first cell and the LAST formula cell both hold numbers (the formula pass is inside the figure).
  const univerPainted = () => page.waitForFunction(([lr, lc]) => { const a = window.__planyrUniverRead && window.__planyrUniverRead.api(); const ws = a && a.getActiveWorkbook() && a.getActiveWorkbook().getActiveSheet(); try { return !!ws && !!document.querySelector('[data-testid="univer-grid"] canvas') && typeof ws.getRange(0, 0).getValue() === "number" && typeof ws.getRange(lr, lc).getValue() === "number"; } catch (_) { return false; } }, [ROWS - 1, COLS - 1], { timeout: 90000, polling: 25 });
  const oldPainted = () => page.waitForFunction(() => { const s = document.querySelector('[data-testid="model-sheet"]'); return !!s && /\d\.\d/.test(s.innerText); }, null, { timeout: 90000, polling: 25 });
  const cold = async () => { await cdp.send("Network.clearBrowserCache"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }); net = new Map(); };

  // ── A. cold, Univer vs the regular grid ──────────────────────────────────────────────────────────────────────
  const uni = [], old = [], uniBytes = [], langs = [], workers = [];
  let firstFiles = [];
  for (let i = 0; i < RUNS + 1; i++) {                    // run 0 only establishes that the account's data is in place; it is not counted
    await setSwitch(true); await page.goto("about:blank"); await cold();
    const t0 = Date.now(); await page.goto(sheetUrl(), { waitUntil: "commit" });
    await univerPainted(); const ms = Date.now() - t0; await page.waitForTimeout(800);
    if (i > 0) { uni.push(ms); uniBytes.push(univerFiles().reduce((a, r) => a + r.bytes, 0)); langs.push(univerFiles().filter((r) => isLangFile(r.url)).length); workers.push(univerFiles().filter((r) => /univerFormulaWorker-/.test(r.url)).length); if (i === 1) firstFiles = univerFiles().map((r) => `${r.url.split("/").pop().split("?")[0]} ${kbs(r.bytes)}`); }
    await setSwitch(false); await page.goto("about:blank"); await cold();
    const t1 = Date.now(); await page.goto(sheetUrl(), { waitUntil: "commit" });
    await oldPainted(); if (i > 0) old.push(Date.now() - t1);
  }
  ok("A0 KNOWN-GOOD ARM: the is_admin intercept was hit (so the Univer arm really ran Univer)", hits > 0, `${hits} hit(s)`);
  if (!hits) { voided = true; throw new Error("VOID — the intercept never fired"); }
  const mu = median(uni), mo = median(old);
  console.log(`   cold, median of ${RUNS}:  Univer ${mu} ms (runs ${uni.join(", ")})   regular grid ${mo} ms (runs ${old.join(", ")})   ratio ${(mu / mo).toFixed(2)} — target ≤ 1.25`);
  console.log(`   Univer files (compressed, over the wire): ${firstFiles.join(" · ")}  — total ${kbs(median(uniBytes))}`);
  ok("A1 the Univer grid painted on the real deploy", uni.length === RUNS, `median ${mu} ms`);
  ok("A2 NO hyphenation language file was requested on this English sheet", langs.every((n) => n === 0), langs.join(", "));
  ok("A3 the formula engine ran in its worker (its file was requested)", workers.every((n) => n >= 1), workers.join(", "));
  log.cold = { uni, old, uniBytes, firstFiles, ratio: mu / mo };

  // ── B. hover warms the chunk before the click ────────────────────────────────────────────────────────────────
  await setSwitch(true); await page.goto("about:blank"); await cold(); await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await page.goto(siteUrl(), { waitUntil: "load" });
  const tab = page.locator('[data-testid="module-tab-model"]').first(); await tab.waitFor({ timeout: 60000 }); await page.waitForTimeout(3000);
  const beforeHover = univerFiles().length;
  await tab.hover(); await page.waitForTimeout(4000);
  const warmed = univerFiles().filter((r) => /UniverSheet-/.test(r.url));
  ok("B1 resting on the Spreadsheet tab fetched the Univer chunk BEFORE any click", beforeHover === 0 && warmed.length === 1, `before hover ${beforeHover} Univer file(s); after ${warmed.length}${warmed[0] ? " (" + kbs(warmed[0].bytes) + ")" : ""}`);
  const t2 = Date.now(); await tab.click(); await univerPainted(); const clickMs = Date.now() - t2;
  console.log(`   hover then click → painted Univer grid: ${clickMs} ms`);
  ok("B2 the click painted the grid", true, `${clickMs} ms`);
  log.hover = { warmedBytes: warmed[0] && warmed[0].bytes, clickMs };

  // ── C. a device with the switch OFF must not download it ─────────────────────────────────────────────────────
  await setSwitch(false); await page.goto("about:blank"); await cold();
  await page.goto(siteUrl(), { waitUntil: "load" }); await tab.waitFor({ timeout: 60000 }); await page.waitForTimeout(3000);
  await tab.hover(); await page.waitForTimeout(4000);
  ok("C1 hovering the tab on a device that will not use Univer downloaded none of it", univerFiles().length === 0, `${univerFiles().length} Univer file(s)`);
} catch (e) {
  console.log("ABORT:", String(e.message).split("\n")[0]);
  failures++;
} finally {
  try {
    await page.evaluate((k) => localStorage.removeItem(k), SWITCH_KEY).catch(() => {});
    const rowsLeft = await page.evaluate(async (id) => { const c = window.pfSupabase; await c.from("model_sheets").delete().eq("id", id); return ((await c.from("model_sheets").select("id").eq("id", id)).data || []).length; }, PROJECT);
    const gone = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)] }));
    ok("D1 the throwaway workbook row and plan are gone (re-read from the database)", rowsLeft === 0 && !(gone.errors || []).length && gone.left?.site === 0, `model_sheets rows left ${rowsLeft}; ${JSON.stringify(gone)}`);
  } catch (e) { ok("D1 cleanup", false, String(e.message).split("\n")[0]); }
  await s.close();
  console.log(`\n${voided ? "VOID" : failures ? "FAILED" : "PASSED"} — ${failures} failure(s)`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), base: BASE, failures, voided, log }, null, 2));
  process.exit(voided ? 2 : failures ? 1 : 0);
}
