/* verify-model-cell-editor-undo-live — B2535792: Ctrl+Z while typing in a Spreadsheet cell undoes the typing,
 * never the sheet's own undo stack. Signed in as the test account on a real deploy.
 *
 *  1 typing        type "abc" into an empty cell, Ctrl+Z → "ab"; committed cells untouched
 *  2 redo          Ctrl+Y → "abc", Ctrl+Shift+Z after another undo → "abc"
 *  3 abandon       undo past the first keystroke, then once more → editor closes, cell empty
 *  4 committed     Enter commits; Ctrl+Z then undoes that whole cell as ONE step; the earlier cells stay
 *  5 formula bar   Ctrl+Z inside the formula bar leaves committed cells alone
 * KNOWN-GOOD ARM: two seeded cells must read back before anything is judged (else the run is VOID).
 * CLEANUP (constraint 15): every cell this writes is blanked again and verified empty.
 * Run: node ui-audit/verify-model-cell-editor-undo-live.mjs [base=https://planyr.io] */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";

const BASE = process.argv.slice(2).find((a) => /^https?:/.test(a)) || "https://planyr.io";
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };

const s = await openSignedIn({ base: BASE });
const page = s.page;
console.log("BUILD", s.build, "PROOF", JSON.stringify(s.proof));
try {
  await page.goto(`${BASE}/#/project/${FIXTURE_SITE_ID}/spreadsheet`);
  const sheet = page.getByTestId("model-sheet");
  await sheet.waitFor({ timeout: 30000 });
  await assertMeasurable(page, "verify-model-cell-editor-undo-live");
  // Served chunk hash IN THE SAME OBSERVATION as the assertions (CLAUDE.md live-measurement rule).
  const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 4));
  console.log("SERVED", JSON.stringify(chunks));

  const cell = (r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
  const editor = () => sheet.locator("input").first();
  // On-screen rows (the grid virtualises rows) in column D, asserted EMPTY below before anything is written.
  const R = 12, C = 3;
  const before = [await cell(R, C).innerText(), await cell(R + 1, C).innerText(), await cell(R + 2, C).innerText()];
  ok("known-good arm: scratch cells start empty", before.every((t) => t.trim() === ""), JSON.stringify(before));
  if (failures) throw new Error("VOID run: scratch cells not empty");

  await cell(R, C).click(); await page.keyboard.type("500"); await page.keyboard.press("Enter");
  await cell(R + 1, C).click(); await page.keyboard.type("300"); await page.keyboard.press("Enter");
  ok("known-good arm: two committed cells read back", (await cell(R, C).innerText()) === "500" && (await cell(R + 1, C).innerText()) === "300");
  if (failures) throw new Error("VOID run: seed cells did not commit");
  const intact = async () => (await cell(R, C).innerText()) === "500" && (await cell(R + 1, C).innerText()) === "300";

  // 1 typing + 2 redo
  await cell(R + 2, C).click(); await page.keyboard.type("abc");
  await page.keyboard.press("Control+z");
  ok("1 Ctrl+Z steps the typing back", (await editor().inputValue()) === "ab" && await intact());
  await page.keyboard.press("Control+y");
  ok("2 Ctrl+Y redoes it", (await editor().inputValue()) === "abc" && await intact());
  await page.keyboard.press("Control+z"); await page.keyboard.press("Control+Shift+z");
  ok("2 Ctrl+Shift+Z redoes it", (await editor().inputValue()) === "abc" && await intact());

  // 3 abandon
  for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
  ok("3 nothing left to undo abandons the edit; cell stays empty; committed cells intact",
    (await sheet.locator("input").count()) === 0 && (await cell(R + 2, C).innerText()).trim() === "" && await intact());

  // 4 committed edit = one sheet step
  await cell(R + 2, C).click(); await page.keyboard.type("999"); await page.keyboard.press("Enter");
  ok("4a Enter commits", (await cell(R + 2, C).innerText()) === "999");
  await page.keyboard.press("Control+z");
  ok("4b Ctrl+Z then undoes that whole committed edit as one step", (await cell(R + 2, C).innerText()).trim() === "" && await intact());

  // 5 formula bar
  await cell(R + 2, C).click();
  const fb = page.getByTestId("model-formula-bar");
  await fb.click(); await page.keyboard.type("hello"); await page.keyboard.press("Control+z");
  ok("5 Ctrl+Z in the formula bar leaves the committed cells alone", await intact());
  await page.keyboard.press("Escape");
} catch (e) {
  console.log("ERROR", e.message); failures++;
} finally {
  // CLEANUP — blank what this wrote and verify (real key presses, re-read until gone).
  try {
    const sheet = page.getByTestId("model-sheet");
    const cell = (r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
    await sheet.focus().catch(() => {});
    await cell(12, 3).click();
    await cell(14, 3).click({ modifiers: ["Shift"] });
    await page.keyboard.press("Delete");
    let clean = false;
    for (let i = 0; i < 20 && !clean; i++) {
      await page.waitForTimeout(250);
      clean = (await cell(12, 3).innerText()).trim() === "" && (await cell(13, 3).innerText()).trim() === "" && (await cell(14, 3).innerText()).trim() === "";
    }
    ok("cleanup: scratch cells are empty again", clean);
  } catch (e) { console.log("CLEANUP ERROR", e.message); failures++; }
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
