/* verify-model-tab-switch-commit-live — B2540736 (V1981872): a half-typed Spreadsheet entry commits to ITS sheet when the tab changes and never
 * lands on the next one. Signed in as the test account on a real deploy. PORTED to the Univer grid (NEW-2, 2026-10-31): the sheet tabs are
 * Univer's own DOM strip (`[data-u-comp="slide-tab-item"]`, the "+" is `sheet-bar-append-button`), the cells are a canvas read through Univer's
 * facade (`window.__planyrUniverRead`, armed by `window.__PLANYR_E2E`, set before load).
 *
 *  1 cell editor   Sheet1!D14: type 500 (no Enter) → click the scratch sheet's tab → scratch!D14 still 222, a click + Enter there does not
 *                  receive the 500 → back on Sheet1 D14 = 500
 *  2 formula bar   Sheet1!D15: type 777 in the formula bar → click the scratch tab → scratch!D15 untouched → back: 777
 *  3 add sheet     type 900 in Sheet1!D13, click "+" → the new sheet is empty at D13 → back on Sheet1: 900
 * KNOWN-GOOD ARM: the scratch cells read empty before anything is written, and 222 reads back on the scratch sheet (else VOID).
 * CLEANUP (constraint 15): the cells are blanked and EVERY scratch sheet this added is deleted; tab count and cells verified restored.
 * Run (live): node ui-audit/verify-model-tab-switch-commit-live.mjs [base=https://planyr.io]
 *     (local, throwaway project, no sign-in): node ui-audit/verify-model-tab-switch-commit-live.mjs --local http://localhost:4173 */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { launchLocalHarness, gotoSpreadsheet, clickCell, enter, press, value, sheetNames } from "../e2e/lib/univerGrid.js";

const argv = process.argv.slice(2);
const LOCAL = argv.includes("--local");
const BASE = (argv.find((a) => /^https?:/.test(a)) || (LOCAL ? "http://localhost:4173" : "https://planyr.io")).replace(/\/$/, "");
const PROJECT = LOCAL ? "zz-tab-switch-local" : FIXTURE_SITE_ID;
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = LOCAL ? await launchLocalHarness(BASE, PROJECT) : await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
console.log(LOCAL ? `LOCAL against ${BASE}` : `BUILD ${JSON.stringify(s.build)} PROOF ${JSON.stringify(s.proof)}`);
const tabs = () => page.locator('[data-u-comp="slide-tab-item"]');
const addSheet = async () => { await page.locator('[data-u-comp="sheet-bar-append-button"]').first().click(); await sleep(600); };
const val = (r, c) => value(page, r, c);
const empty = (v) => v === null || v === undefined || v === "";
const C = 3; // column D
let tabs0 = null;
try {
  await gotoSpreadsheet(page, BASE, PROJECT, "spreadsheet");
  await assertMeasurable(page, "verify-model-tab-switch-commit-live");
  const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 4));
  console.log("SERVED", JSON.stringify(chunks));
  tabs0 = await tabs().count();
  const first = tabs().first();
  await first.click(); await sleep(300);
  const before = [await val(12, C), await val(13, C), await val(14, C)];
  ok("known-good arm: scratch cells D13:D15 start empty", before.every(empty), JSON.stringify(before));
  if (failures) throw new Error("VOID run: scratch cells not empty");

  await addSheet();
  ok("a scratch sheet was added", (await tabs().count()) === tabs0 + 1);
  const scratch = () => tabs().nth(tabs0);
  await enter(page, 13, C, "222");
  ok("known-good arm: 222 reads back on the scratch sheet", (await val(13, C)) === 222);
  if (failures) throw new Error("VOID run: scratch sheet did not take 222");

  // 1 cell editor
  await first.click(); await sleep(400);
  ok("1 setup: back on Sheet1", (await sheetNames(page)).find((x) => x.active).name === (await sheetNames(page))[0].name);
  await clickCell(page, 13, C); await page.keyboard.type("500", { delay: 10 });
  await scratch().click(); await sleep(500);
  ok("1a scratch!D14 still 222 after switching with a half-typed 500", (await val(13, C)) === 222);
  await clickCell(page, 15, C); await press(page, "Enter"); await sleep(300); await page.keyboard.press("Escape"); await sleep(200);
  ok("1c a click + Enter on the scratch sheet does not receive the 500", (await val(13, C)) === 222 && empty(await val(15, C)));
  await first.click(); await sleep(500);
  ok("1d Sheet1!D14 holds 500", (await val(13, C)) === 500);

  // 2 formula bar
  await clickCell(page, 14, C);
  const fb = await page.evaluate(() => { const e = [...document.querySelectorAll('[data-u-comp="formula-editor"]')].find((x) => x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  ok("2 setup: the formula bar is on screen", !!fb);
  await page.mouse.click(fb.x, fb.y); await sleep(250); await page.keyboard.type("777", { delay: 10 });
  await scratch().click(); await sleep(500);
  ok("2a scratch!D15 untouched by the formula-bar text", empty(await val(14, C)));
  await first.click(); await sleep(500);
  ok("2b Sheet1!D15 holds 777", (await val(14, C)) === 777);

  // 3 add sheet while typing
  await clickCell(page, 12, C); await page.keyboard.type("900", { delay: 10 });
  await addSheet();
  ok("3a the second scratch sheet is empty at D13", empty(await val(12, C)));
  await first.click(); await sleep(500);
  ok("3b Sheet1!D13 holds 900", (await val(12, C)) === 900);
} catch (e) {
  console.log("ERROR", e.message); failures++;
} finally {
  try {
    await page.keyboard.press("Escape").catch(() => {});
    await tabs().first().click(); await sleep(300);
    await clickCell(page, 12, C);
    await page.keyboard.down("Shift"); await clickCell(page, 14, C); await page.keyboard.up("Shift");
    await page.keyboard.press("Delete");
    let clean = false;
    for (let i = 0; i < 20 && !clean; i++) { await sleep(250); clean = empty(await val(12, C)) && empty(await val(13, C)) && empty(await val(14, C)); }
    ok("cleanup: Sheet1 scratch cells are empty again", clean);
    // delete every scratch sheet (right-click → Delete), newest first
    for (let guard = 0; guard < 6 && tabs0 != null && (await tabs().count()) > tabs0; guard++) {
      await tabs().last().click({ button: "right" }); await sleep(300);
      await page.getByText("Delete", { exact: true }).last().click(); await sleep(400);
      const confirm = page.getByRole("button", { name: /^(ok|confirm|delete|yes)$/i });
      if (await confirm.count()) await confirm.last().click().catch(() => {});
      await sleep(500);
    }
    ok("cleanup: tab count restored", tabs0 != null && (await tabs().count()) === tabs0, `${await tabs().count()} vs ${tabs0}`);
    const rest = [await val(12, C), await val(13, C), await val(14, C)];
    ok("cleanup: cells empty on the remaining sheet", rest.every(empty), JSON.stringify(rest));
    await sleep(2500); // let the cloud push of the restored workbook go (live)
  } catch (e) { console.log("CLEANUP ERROR", e.message); failures++; }
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
