/* verify-model-tab-switch-commit-live — B2540736 (V1981872): a half-typed Spreadsheet entry commits to ITS sheet when the
 * tab changes and never lands on the next one. Signed in as the test account on a real deploy.
 *
 *  1 cell editor   Sheet1!D13: type 500 (no Enter) → click the scratch sheet's tab → scratch!D13 still 222, no editor open
 *                  → click a cell + Enter there → still 222 → back on Sheet1 D13 = 500
 *  2 formula bar   Sheet1!D14: type 777 in the formula bar → click the scratch tab → scratch!D14 untouched → back: 777
 *  3 add sheet     type 900 in Sheet1!D12, click "Add sheet" → the new sheet is empty at D12 → back on Sheet1: 900
 * KNOWN-GOOD ARM: the scratch cells read empty before anything is written, and 222 reads back on the scratch sheet (else VOID).
 * CLEANUP (constraint 15): the cells are blanked and EVERY scratch sheet this added is deleted; tab count and cells verified restored.
 * Run: node ui-audit/verify-model-tab-switch-commit-live.mjs [base=https://planyr.io] */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";

const BASE = process.argv.slice(2).find((a) => /^https?:/.test(a)) || "https://planyr.io";
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await openSignedIn({ base: BASE });
const page = s.page;
console.log("BUILD", s.build, "PROOF", JSON.stringify(s.proof));
const tabs = () => page.locator('[data-testid^="model-sheet-tab-"]');
const cell = (r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
const txt = async (r, c) => (await cell(r, c).innerText()).trim();
const C = 3; // column D
let tabs0 = null;
try {
  await page.goto(`${BASE}/#/project/${FIXTURE_SITE_ID}/spreadsheet`);
  const sheet = page.getByTestId("model-sheet");
  await sheet.waitFor({ timeout: 30000 });
  await assertMeasurable(page, "verify-model-tab-switch-commit-live");
  const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 4));
  console.log("SERVED", JSON.stringify(chunks));
  tabs0 = await tabs().count();
  const first = tabs().first();
  await first.click();
  const before = [await txt(12, C), await txt(13, C), await txt(14, C)];
  ok("known-good arm: scratch cells D12:D14 start empty", before.every((t) => t === ""), JSON.stringify(before));
  if (failures) throw new Error("VOID run: scratch cells not empty");

  await page.getByTestId("model-add-sheet").click();
  await sleep(500);
  ok("a scratch sheet was added", (await tabs().count()) === tabs0 + 1);
  const scratch = () => tabs().nth(tabs0);
  await cell(13, C).click(); await page.keyboard.type("222"); await page.keyboard.press("Enter");
  ok("known-good arm: 222 reads back on the scratch sheet", (await txt(13, C)) === "222");
  if (failures) throw new Error("VOID run: scratch sheet did not take 222");

  // 1 cell editor
  await first.click(); await sleep(300);
  await cell(13, C).click(); await page.keyboard.type("500");
  await scratch().click(); await sleep(400);
  ok("1a scratch!D13 still 222 after switching with a half-typed 500", (await txt(13, C)) === "222");
  ok("1b no editor is left open on the scratch sheet", (await sheet.locator("input").count()) === 0);
  await cell(15, C).click(); await page.keyboard.press("Enter"); await sleep(300);
  ok("1c a click + Enter on the scratch sheet does not receive the 500", (await txt(13, C)) === "222");
  await first.click(); await sleep(400);
  ok("1d Sheet1!D13 holds 500", (await txt(13, C)) === "500");

  // 2 formula bar
  await cell(14, C).click();
  await page.getByTestId("model-formula-bar").click(); await page.keyboard.type("777");
  await scratch().click(); await sleep(400);
  ok("2a scratch!D14 untouched by the formula-bar text", (await txt(14, C)) === "");
  await first.click(); await sleep(400);
  ok("2b Sheet1!D14 holds 777", (await txt(14, C)) === "777");

  // 3 add sheet while typing
  await cell(12, C).click(); await page.keyboard.type("900");
  await page.getByTestId("model-add-sheet").click(); await sleep(500);
  ok("3a the second scratch sheet is empty at D12", (await txt(12, C)) === "" && (await sheet.locator("input").count()) === 0);
  await first.click(); await sleep(400);
  ok("3b Sheet1!D12 holds 900", (await txt(12, C)) === "900");
} catch (e) {
  console.log("ERROR", e.message); failures++;
} finally {
  try {
    const sheet = page.getByTestId("model-sheet");
    await page.keyboard.press("Escape").catch(() => {});
    await tabs().first().click();
    await sleep(300);
    await cell(12, C).click();
    await cell(14, C).click({ modifiers: ["Shift"] });
    await page.keyboard.press("Delete");
    let clean = false;
    for (let i = 0; i < 20 && !clean; i++) { await sleep(250); clean = (await txt(12, C)) === "" && (await txt(13, C)) === "" && (await txt(14, C)) === ""; }
    ok("cleanup: Sheet1 scratch cells are empty again", clean);
    // delete every scratch sheet (right-click → Delete), newest first
    for (let guard = 0; guard < 6 && tabs0 != null && (await tabs().count()) > tabs0; guard++) {
      await tabs().last().click({ button: "right" });
      await page.getByText("Delete", { exact: true }).last().click();
      await sleep(500);
    }
    ok("cleanup: tab count restored", tabs0 != null && (await tabs().count()) === tabs0, `${await tabs().count()} vs ${tabs0}`);
    await sheet.waitFor({ timeout: 5000 }).catch(() => {});
    const rest = [await txt(12, C), await txt(13, C), await txt(14, C)];
    ok("cleanup: cells empty on the remaining sheet", rest.every((t) => t === ""), JSON.stringify(rest));
    await sleep(2500); // let the cloud push of the restored workbook go
  } catch (e) { console.log("CLEANUP ERROR", e.message); failures++; }
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
