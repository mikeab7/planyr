/* verify-spreadsheet-file-live — B2509040 / V1958848: an uploaded Excel opens in Spreadsheet, edits save into the SAME
 * Library file, survive a cache-busted reload, and the downloaded .xlsx re-opens cleanly. SIGNED IN as the throwaway test
 * account on a THROWAWAY project (never a real one); cleans up everything it makes and re-asks the database.
 *
 *  1 upload a multi-sheet .xlsx (a formula reading another sheet, a serial-number date, a leading blank column, a header
 *    with stray spaces, a frozen row)             2 click the row → Spreadsheet shows it (both tabs, date as a date, no banner)
 *  3 edit a value + a formula, wait for the save  4 reload (cache-bust), re-open the row → the edits are there, formulas intact
 *  5 File ▸ Download as Excel → re-read outside the app   6 Download original → byte-identical to the upload, 2 stored versions
 *  7 .csv: edits go to a new .xlsx beside it; the .csv is byte-identical; clicking the .csv again opens the edited copy
 *  8 a workbook with a chart: opens, the banner names it, the original is intact
 *  9 a password-protected file and a text file renamed .xlsx: a plain "couldn't be opened" panel naming the file, not a blank grid
 * 10 File ▸ Open Excel or CSV file… inside Spreadsheet files it into the Library and opens it   11 phone width (Chromium, not WebKit)
 * KNOWN-GOOD ARM: step 2 must show the seeded values before anything is judged. Run: E2E_LOGIN_KEY=… node ui-audit/verify-spreadsheet-file-live.mjs [base] */
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
const STAMP = Date.now().toString(36);
const PROJECT = `${LIVE_PREFIX}sheetfile-${STAMP}`;
const T = `zzsheet${STAMP}`;
const fx = (n) => readFileSync(new URL(`../test/fixtures/spreadsheet/${n}`, import.meta.url));

let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const same = (a, b) => a.length === b.length && Buffer.compare(a, b) === 0;

async function multiSheet() {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("Assumptions");
  a.getCell("B1").value = " Land "; a.getCell("C1").value = 1000;
  a.getCell("B2").value = "Date"; a.getCell("C2").value = 45292; a.getCell("C2").numFmt = "m/d/yyyy";
  a.views = [{ state: "frozen", ySplit: 1 }];
  const m = wb.addWorksheet("Model");
  m.getCell("B1").value = "Total"; m.getCell("C1").value = { formula: "Assumptions!C1*2", result: 2000 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const s = await openSignedIn({ base: BASE });
const { page } = s;
const made = [];            // review ids to clean up
const driveKeys = new Set();
try {
  await assertMeasurable(page, "verify-spreadsheet-file-live");
  const build = (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  console.log(`served build: ${build}  account: ${s.proof.email}  base: ${BASE}`);
  await seedThrowawayPlan(page, PROJECT);

  const settle = (ms = 1200) => page.waitForTimeout(ms);
  const libraryUrl = (cb) => `${BASE}/${cb ? `?cb=${Date.now()}` : ""}#/project/${PROJECT}/library`;
  const sheetUrl = () => `${BASE}/#/project/${PROJECT}/spreadsheet`;
  const goLibrary = async (cb = false) => { await page.goto(libraryUrl(cb), { waitUntil: "load" }); await page.waitForSelector('[data-testid="library-unified"]', { timeout: 60000 }); await settle(2000); };
  // the Library shows a file's composed TITLE ("<date> <project> - <name without extension>"), not its raw file name
  // A CSV and its new .xlsx copy share a title, so the row also carries the file-type tag (CSV / XLSX) to tell them apart
  const rowFor = (name) => page.locator('[data-testid="library-file-row"]', { hasText: name.replace(/\.[^.]+$/, "") }).filter({ hasText: new RegExp(name.split(".").pop().toUpperCase()) });
  const rec = (id) => page.evaluate(async (i) => (await window.pfSupabase.from("doc_reviews").select("data").eq("id", i).single()).data?.data, id);
  const idFor = async (token) => { const q = await page.evaluate(async (t) => (await window.pfSupabase.from("doc_reviews").select("id").ilike("title", `%${t}%`).is("deleted_at", null)).data || [], token); return q.map((r) => r.id); };
  const bytesOf = async (driveKey) => {
    driveKeys.add(driveKey);
    const b64 = await page.evaluate(async (k) => {
      const { data: { session } } = await window.pfSupabase.auth.getSession();
      const r = await fetch(`/api/files?key=${encodeURIComponent(k)}`, { headers: { authorization: `Bearer ${session.access_token}` } });
      const u = new Uint8Array(await r.arrayBuffer()); let str = "";
      for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(str);
    }, driveKey);
    return Buffer.from(b64, "base64");
  };
  const upload = async (name, buffer, mimeType) => {
    await page.locator('[data-testid="library-unified"] input[type=file]:not([webkitdirectory])').first().setInputFiles({ name, mimeType, buffer });
    await rowFor(name).first().waitFor({ timeout: 90000 });
    await settle(1500);
    const ids = await idFor(name.replace(/\.[^.]+$/, ""));
    if (!ids[0]) throw new Error(`void run — ${name} never reached doc_reviews`);
    made.push(ids[0]);
    return ids[0];
  };
  const cell = (r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
  const cellText = async (r, c) => (await cell(r, c).first().innerText()).trim();
  const waitSaved = async (id, nSources) => {
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const r = await rec(id);
      const bar = await page.locator('[data-testid="model-file-bar"]').innerText().catch(() => "");
      if ((r.sources || []).length >= nSources && !/Saving/i.test(bar)) return r;
      await page.waitForTimeout(700);
    }
    throw new Error(`save never landed for ${id} (wanted ${nSources} stored versions)`);
  };
  const typeInto = async (r, c, text) => { await cell(r, c).first().click(); await page.keyboard.type(text); await page.keyboard.press("Enter"); };
  const openRow = async (name) => { await rowFor(name).first().click(); await page.waitForSelector('[data-testid="model-root"]', { timeout: 30000 }); };

  // ---- 1 + 2: upload, open ----
  await goLibrary();
  const multi = await multiSheet();
  const multiName = `${T}-proforma.xlsx`;
  const multiId = await upload(multiName, multi, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const before = await rec(multiId);
  ok("1 uploaded: the Library record has the original as its one stored version", (before.sources || []).length === 1);
  await openRow(multiName);
  await page.waitForSelector('[data-testid="model-file-bar"]', { timeout: 60000 });
  await settle(1500);
  ok("2 the Spreadsheet tab is showing (route)", /\/spreadsheet$/.test(new URL(page.url()).hash));
  ok("2 file bar names the file and says edits save to it", /proforma\.xlsx/.test(await page.getByTestId("model-file-name").innerText()) && /edits save to this file/i.test(await page.getByTestId("model-file-bar").innerText()));
  ok("2 KNOWN-GOOD ARM: both sheet tabs are there", (await page.locator('[data-testid^="model-sheet-tab-"]').count()) === 2);
  ok("2 the value, the formula's computed value and the date (as a date) show", (await cellText(0, 2)) === "1000" && (await cellText(1, 2)) === "1/1/2024");
  ok("2 header keeps its stray spaces (a leading blank column A, text ' Land ')", (await cellText(0, 0)) === "" && (await cell(0, 1).first().innerText()).includes("Land"));
  ok("2 nothing to apologise for: no 'won't carry over' banner", (await page.getByTestId("model-file-notes").count()) === 0);
  await page.locator('[data-testid="model-sheet-tab-1"]').click(); await settle(500);
  ok("2 the cross-sheet formula shows its computed value", (await cellText(0, 2)) === "2000");

  // ---- 3: edit a value and a formula ----
  await page.locator('[data-testid="model-sheet-tab-0"]').click(); await settle(500);
  await typeInto(0, 2, "5000");
  await page.locator('[data-testid="model-sheet-tab-1"]').click(); await settle(500);
  ok("3 the dependent formula recomputed on screen", (await cellText(0, 2)) === "10000");
  await typeInto(1, 2, "=C1+1");
  ok("3 a formula typed in a second cell computes", (await cellText(1, 2)) === "10001");
  const saved = await waitSaved(multiId, 2);
  ok("3 saved into the SAME record: 2 stored versions, no second file", saved.sources.length === 2 && (await idFor(T + "-proforma")).length === 1);
  ok("3 the header badge is not in error", (await page.locator('[data-testid="model-file-save-error"]').count()) === 0);

  // ---- 4: cache-busted reload, re-open ----
  await goLibrary(true);
  await openRow(multiName);
  await page.waitForSelector('[data-testid="model-file-bar"]', { timeout: 60000 }); await settle(1500);
  await page.locator('[data-testid="model-sheet-tab-1"]').click(); await settle(500);
  ok("4 after a cache-busted reload the edits persisted and computed (10000 / 10001)", (await cellText(0, 2)) === "10000" && (await cellText(1, 2)) === "10001");
  await cell(1, 2).first().click();
  ok("4 the second cell is still a FORMULA (formula bar shows =C1+1)", (await page.getByTestId("model-formula-bar").inputValue()) === "=C1+1");
  await page.locator('[data-testid="model-sheet-tab-0"]').click(); await settle(500);
  ok("4 the date is still a date after the round trip", (await cellText(1, 2)) === "1/1/2024");

  // ---- 5: Download as Excel, re-read outside the app ----
  await page.getByTestId("model-file-menu-btn").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("model-export-xlsx").click()]);
  const outPath = await dl.path();
  const ex = new ExcelJS.Workbook(); await ex.xlsx.readFile(outPath);
  const mf = ex.getWorksheet("Model").getCell("C2").value;
  ok("5 downloaded .xlsx re-opens: both sheets, the formula text with a cached result, a real date", ex.worksheets.length === 2 && mf && mf.formula === "C1+1" && mf.result === 10001 && ex.getWorksheet("Assumptions").getCell("C2").value instanceof Date);
  ok("5 the edited value is in the file", ex.getWorksheet("Assumptions").getCell("C1").value === 5000);

  // ---- 6: Download original ----
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByTestId("model-file-download-original").click()]);
  const origBytes = readFileSync(await dl2.path());
  ok("6 Download original is byte-identical to what was uploaded", same(origBytes, multi));
  const finalRec = await rec(multiId);
  ok("6 the upload is still stored as the oldest version, byte for byte", same(await bytesOf(finalRec.sources[finalRec.sources.length - 1].driveKey), multi));

  // ---- 7: csv → new xlsx copy ----
  await goLibrary();
  const csvName = `${T}-comps.csv`;
  const csvBytes = Buffer.from("Name,Rent\nAlpha,7.25\nBeta,8\n");
  const csvId = await upload(csvName, csvBytes, "text/csv");
  await openRow(csvName);
  await page.waitForSelector('[data-testid="model-file-bar"]', { timeout: 60000 }); await settle(1500);
  ok("7 the CSV opened with its note that edits go to a new Excel copy", /new Excel (file|copy)/i.test(await page.getByTestId("model-file-bar").innerText() + await page.getByTestId("model-file-notes").innerText().catch(() => "")));
  await typeInto(1, 1, "9.5");
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !(await rec(csvId)).spreadsheetCopyId) await page.waitForTimeout(700);
  const copyId = (await rec(csvId)).spreadsheetCopyId;
  if (copyId) made.push(copyId);
  ok("7 the original CSV record links to a new copy", !!copyId);
  ok("7 the CSV bytes are unchanged", same(await bytesOf((await rec(csvId)).sources[0].driveKey), csvBytes));
  await goLibrary();
  ok("7 a '.xlsx' copy sits in the Library beside it", (await rowFor(`${T}-comps.xlsx`).count()) === 1);
  await openRow(csvName); await page.waitForSelector('[data-testid="model-file-bar"]', { timeout: 60000 }); await settle(1500);
  ok("7 clicking the CSV again opens the EDITED copy (9.5), with the note", (await cellText(1, 1)) === "9.5" && /editable Excel copy/i.test(await page.getByTestId("model-file-notes").innerText().catch(() => "")));

  // ---- 8: a chart ----
  await goLibrary();
  const chartName = `${T}-dash.xlsx`;
  const chartId = await upload(chartName, fx("chart.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await openRow(chartName); await page.waitForSelector('[data-testid="model-file-bar"]', { timeout: 60000 }); await settle(1500);
  ok("8 the chart workbook opens and the banner names the chart", /1 chart/i.test(await page.getByTestId("model-file-notes").innerText().catch(() => "")));
  ok("8 its cells are there (Row 1)", (await cellText(1, 0)) === "Row 1");
  ok("8 the original is intact in the Library", same(await bytesOf((await rec(chartId)).sources[0].driveKey), fx("chart.xlsx")));

  // ---- 9: refusals ----
  await goLibrary();
  const lockName = `${T}-locked.xlsx`;
  await upload(lockName, fx("locked.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await openRow(lockName); await page.waitForSelector('[data-testid="model-file-problem"]', { timeout: 60000 });
  const lockText = await page.getByTestId("model-file-problem-text").innerText();
  ok("9 password-protected: a plain panel names the file and the password", lockText.includes("locked.xlsx") && /password/i.test(lockText) && (await page.getByTestId("model-sheet").count()) === 0);
  await page.getByTestId("model-file-problem-close").click(); await settle(800);
  await goLibrary();
  const fakeName = `${T}-fake.xlsx`;
  await upload(fakeName, Buffer.from("just some words, not a workbook"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await openRow(fakeName); await page.waitForSelector('[data-testid="model-file-problem"]', { timeout: 60000 });
  const fakeText = await page.getByTestId("model-file-problem-text").innerText();
  ok("9 a text file renamed .xlsx: names the file, no library jargon", fakeText.includes("fake.xlsx") && !/zip|jszip|central directory/i.test(fakeText));
  await page.getByTestId("model-file-problem-close").click(); await settle(800);

  // ---- 10: the in-module door ----
  await page.goto(sheetUrl(), { waitUntil: "load" }); await page.waitForSelector('[data-testid="model-root"]', { timeout: 60000 }); await settle(2000);
  await page.getByTestId("model-file-menu-btn").click();
  const door = `${T}-door.xlsx`;
  const doorWb = new ExcelJS.Workbook(); doorWb.addWorksheet("Door").getCell("A1").value = "via the File menu";
  await page.getByTestId("model-open-file-input").setInputFiles({ name: door, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await doorWb.xlsx.writeBuffer()) });
  await page.waitForSelector('[data-testid="model-file-bar"]', { timeout: 90000 }); await settle(1500);
  const doorIds = await idFor(`${T}-door`); doorIds.forEach((i) => made.push(i));
  ok("10 File ▸ Open Excel or CSV file… filed it in the Library and opened it", doorIds.length === 1 && (await cellText(0, 0)) === "via the File menu");

  // ---- 11: phone width (Chromium viewport — reported as such, not as WebKit/iPhone) ----
  await page.setViewportSize({ width: 390, height: 780 }); await settle(1000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok("11 at phone width the file opens with its bar visible and no sideways page scroll (Chromium viewport)", (await page.getByTestId("model-file-bar").isVisible()) && overflow <= 1, `overflow=${overflow}`);
} catch (e) {
  console.log("ERROR", e && e.message); failures++;
} finally {
  // ---- 12: clean up, then re-ask ----
  try {
    const keys = await page.evaluate(async (ids) => {
      const out = [];
      for (const id of ids) { const r = await window.pfSupabase.from("doc_reviews").select("data").eq("id", id).maybeSingle(); for (const src of (r.data?.data?.sources || [])) if (src.driveKey) out.push(src.driveKey); }
      return out;
    }, made);
    keys.forEach((k) => driveKeys.add(k));
    await page.evaluate(async ([ids, keys2]) => {
      const { data: { session } } = await window.pfSupabase.auth.getSession();
      for (const k of keys2) await fetch(`/api/files?key=${encodeURIComponent(k)}`, { method: "DELETE", headers: { authorization: `Bearer ${session.access_token}` } }).catch(() => {});
      for (const id of ids) { await window.pfSupabase.from("file_facts").delete().eq("id", id); await window.pfSupabase.from("doc_reviews").delete().eq("id", id); }
    }, [made, [...driveKeys]]);
    const left = await page.evaluate(async (ids) => (await window.pfSupabase.from("doc_reviews").select("id").in("id", ids)).data?.length ?? -1, made);
    ok("cleanup: every uploaded file and copy removed (verified)", left === 0, `rows left: ${left}`);
    const pf = await page.evaluate(async (pid) => { await window.pfSupabase.from("project_folders").delete().eq("project_id", pid); return ((await window.pfSupabase.from("project_folders").select("id").eq("project_id", pid)).data || []).length; }, PROJECT).catch(() => -1);
    const cl = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)], left: {} }));
    ok("cleanup: throwaway project removed (verified)", pf === 0 && cl.left.site === 0, `folders left: ${pf}, project left: ${cl.left.site}, errors: ${(cl.errors || []).join("; ") || "none"}`);
  } catch (e) { console.log("CLEANUP ERROR", e && e.message); failures++; }
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
