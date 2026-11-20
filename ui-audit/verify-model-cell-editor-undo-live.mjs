/* verify-model-cell-editor-undo-live — B2535792: Ctrl+Z while typing in a Spreadsheet cell undoes the typing, never the sheet's own undo
 * stack. Signed in as the test account on a real deploy. PORTED to the Univer grid (NEW-2, 2026-10-31).
 *
 * The Univer cell editor is canvas-rendered rich text, so there is no <input> to read mid-edit: each case types with REAL keys, performs the
 * undo / redo keys, COMMITS with Enter and reads the committed cell through Univer's facade (`window.__planyrUniverRead`, armed by
 * `window.__PLANYR_E2E`, set before load). Univer's editor groups a typed run into one undo step (the old grid stepped one character at a
 * time) — the user-level promise is unchanged: Ctrl+Z reverts the typing, never a committed cell.
 *
 *  1 typing        type "abc" into an empty cell, Ctrl+Z, Enter → the cell is empty (the typing was undone); committed cells untouched
 *  2 redo          Ctrl+Z then Ctrl+Y (and Ctrl+Shift+Z) → "abc" comes back
 *  3 abandon       undo past the first keystroke, then more → nothing left; the edit commits as empty; committed cells intact
 *  4 committed     Enter commits; Ctrl+Z then undoes that whole cell as ONE step; the earlier cells stay
 *  5 formula bar   Ctrl+Z inside the formula bar leaves committed cells alone
 *  6 paused typing "ab" · pause · "cd" · Ctrl+Z → never commits "abcd"; committed cells intact
 * KNOWN-GOOD ARM: two seeded cells must read back before anything is judged (else the run is VOID).
 * CLEANUP (constraint 15): every cell this writes is blanked again and verified empty.
 * Run (live): node ui-audit/verify-model-cell-editor-undo-live.mjs [base=https://planyr.io]
 *     (local, throwaway project, no sign-in): node ui-audit/verify-model-cell-editor-undo-live.mjs --local http://localhost:4173 */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { launchLocalHarness, gotoSpreadsheet, clickCell, enter, press, value } from "../e2e/lib/univerGrid.js";

const argv = process.argv.slice(2);
const LOCAL = argv.includes("--local");
const BASE = (argv.find((a) => /^https?:/.test(a)) || (LOCAL ? "http://localhost:4173" : "https://planyr.io")).replace(/\/$/, "");
const PROJECT = LOCAL ? "zz-editor-undo-local" : FIXTURE_SITE_ID;
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };

const s = LOCAL ? await launchLocalHarness(BASE, PROJECT) : await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
console.log(LOCAL ? `LOCAL against ${BASE}` : `BUILD ${JSON.stringify(s.build)} PROOF ${JSON.stringify(s.proof)}`);
const R = 12, C = 3;   // D13, D14, D15 — on screen, asserted EMPTY below before anything is written
const empty = (v) => v === null || v === undefined || v === "";
try {
  await gotoSpreadsheet(page, BASE, PROJECT, "spreadsheet");
  await assertMeasurable(page, "verify-model-cell-editor-undo-live");
  // Served chunk hash IN THE SAME OBSERVATION as the assertions (CLAUDE.md live-measurement rule).
  const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 4));
  console.log("SERVED", JSON.stringify(chunks));
  const before = [await value(page, R, C), await value(page, R + 1, C), await value(page, R + 2, C)];
  ok("known-good arm: scratch cells start empty", before.every(empty), JSON.stringify(before));
  if (failures) throw new Error("VOID run: scratch cells not empty");

  await enter(page, R, C, "500"); await enter(page, R + 1, C, "300");
  ok("known-good arm: two committed cells read back", (await value(page, R, C)) === 500 && (await value(page, R + 1, C)) === 300);
  if (failures) throw new Error("VOID run: seed cells did not commit");
  const intact = async () => (await value(page, R, C)) === 500 && (await value(page, R + 1, C)) === 300;
  const target = R + 2;
  /** type "abc" into the empty cell, press `keys` (real), commit with Enter, return what the cell holds, then blank it again. */
  const run = async (typed, keys, { pause = false } = {}) => {
    await clickCell(page, target, C);
    if (pause) { await page.keyboard.type("ab", { delay: 10 }); await page.waitForTimeout(700); await page.keyboard.type("cd", { delay: 10 }); }
    else await page.keyboard.type(typed, { delay: 10 });
    for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(250); }
    await page.keyboard.press("Enter"); await page.waitForTimeout(350);
    const got = await value(page, target, C);
    await clickCell(page, target, C); await page.keyboard.press("Delete"); await page.waitForTimeout(300);
    return got;
  };

  // 1 typing
  let got = await run("abc", ["Control+z"]);
  ok("1 Ctrl+Z in the editor reverts the typing; the committed cells are intact", empty(got) && await intact(), `cell committed as ${JSON.stringify(got)}`);
  // 2 redo
  got = await run("abc", ["Control+z", "Control+y"]);
  ok("2 Ctrl+Y redoes it", got === "abc" && await intact(), `cell committed as ${JSON.stringify(got)}`);
  got = await run("abc", ["Control+z", "Control+Shift+z"]);
  ok("2 Ctrl+Shift+Z redoes it", got === "abc" && await intact(), `cell committed as ${JSON.stringify(got)}`);
  // 3 abandon
  got = await run("abc", ["Control+z", "Control+z", "Control+z", "Control+z"]);
  ok("3 nothing left to undo abandons the edit; cell stays empty; committed cells intact", empty(got) && await intact(), `cell committed as ${JSON.stringify(got)}`);
  // 6 paused typing
  got = await run("", ["Control+z"], { pause: true });
  ok("6 paused typing: Ctrl+Z never commits the whole 'abcd'; committed cells intact", got !== "abcd" && await intact(), `cell committed as ${JSON.stringify(got)}`);

  // 4 committed edit = one sheet step
  await enter(page, target, C, "999");
  ok("4a Enter commits", (await value(page, target, C)) === 999);
  await clickCell(page, target, C); await press(page, "Control+z");
  ok("4b Ctrl+Z then undoes that whole committed edit as one step", empty(await value(page, target, C)) && await intact());

  // 5 formula bar
  await clickCell(page, target, C);
  const fb = await page.evaluate(() => { const e = [...document.querySelectorAll('[data-u-comp="formula-editor"]')].find((x) => x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  ok("5 setup: the formula bar is on screen", !!fb);
  if (fb) {
    await page.mouse.click(fb.x, fb.y); await page.waitForTimeout(250);
    await page.keyboard.type("hello", { delay: 10 }); await page.keyboard.press("Control+z"); await page.waitForTimeout(250);
    ok("5 Ctrl+Z in the formula bar leaves the committed cells alone", await intact());
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
    ok("5 Escape leaves the target cell empty", empty(await value(page, target, C)));
  }
} catch (e) {
  console.log("ERROR", e.message); failures++;
} finally {
  // CLEANUP — blank what this wrote and verify (real key presses, re-read until gone).
  try {
    await page.keyboard.press("Escape").catch(() => {});
    await clickCell(page, R, C);
    await page.keyboard.down("Shift"); await clickCell(page, R + 2, C); await page.keyboard.up("Shift");
    await page.keyboard.press("Delete");
    let clean = false;
    for (let i = 0; i < 20 && !clean; i++) {
      await page.waitForTimeout(250);
      clean = empty(await value(page, R, C)) && empty(await value(page, R + 1, C)) && empty(await value(page, R + 2, C));
    }
    ok("cleanup: scratch cells are empty again", clean);
    await page.waitForTimeout(2500); // let the cloud push of the restored workbook go (live)
  } catch (e) { console.log("CLEANUP ERROR", e.message); failures++; }
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
