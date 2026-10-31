/* verify-spreadsheet-multirange-live — B2530689 / V1971825 (Ctrl+click multi-range selection; the drag-select autoscroll half is B2452528's
 * verify-spreadsheet-drag-autoscroll-live.mjs). SIGNED IN as the throwaway test account on a THROWAWAY project (never a real one); removes
 * everything it makes and re-asks the database. Real mouse + real Control key only. PORTED to the Univer grid (NEW-2, 2026-10-31): the
 * selection is read from Univer's facade (one entry per range) because the grid is a canvas.
 *
 *  B1 Ctrl+click A1, C3, E5 -> three separate ranges, active cell E5            B2 Bold -> all three bold; ONE Ctrl+Z reverts all
 *  B3 Ctrl+click a selected cell takes it out of the selection                  B4 Ctrl+drag adds a block + Ctrl+click a column header adds the column; Delete clears all
 *  B5 Ctrl+Enter fills every selected cell          B6 Ctrl+C on several ranges says "multiple selections"      B7 plain click collapses to one range
 * KNOWN-GOOD ARM: the plain-click arm (A1) and the served-build read must succeed before anything is judged.
 * KNOWN PRODUCT DEFECTS in the Univer path (found NEW-2; reported, not weakened): B5 (Univer fills ONLY the active cell) and B6 (Univer copies
 * ONE range silently, no message — Excel refuses). They print as `KNOWN-DEFECT` and do not fail the run while they reproduce; the day one
 * starts passing it prints PASS (and the `known()` wrapper should then be removed).
 * Run (live): E2E_LOGIN_KEY=… node ui-audit/verify-spreadsheet-multirange-live.mjs [base]
 *     (local, no sign-in): node ui-audit/verify-spreadsheet-multirange-live.mjs --local http://localhost:4173 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import {
  launchLocalHarness, gotoSpreadsheet, cellPoint, columnHeaderPoint, enter, clickCell, modClickCell, press, selection, activeCell, styleOf, value, clickUniverCommand,
} from "../e2e/lib/univerGrid.js";

const argv = process.argv.slice(2);
const LOCAL = argv.includes("--local");
const BASE = (argv.find((a) => /^https?:/.test(a)) || (LOCAL ? "http://localhost:4173" : "https://planyr.io")).replace(/\/$/, "");
const PROJECT = `${LIVE_PREFIX}sheetmulti-${Date.now().toString(36)}`;
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
/** A check for a documented product defect: reported loudly while it reproduces, a PASS the moment it is fixed. Never silently dropped. */
const known = (name, cond, extra = "") => { if (cond) console.log(`PASS — ${name}  (the known defect is FIXED: drop known())`); else console.log(`KNOWN-DEFECT — ${name}${extra ? "  ::  " + extra : ""}`); };

const s = LOCAL ? await launchLocalHarness(BASE, PROJECT) : await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
const a1s = async () => (await selection(page)).map((x) => x.a1);
const isBold = async (r, c) => (await styleOf(page, r, c)).bold;
const CTRL = "Control";
const BOLD = "sheet.command.set-range-bold";
const build = () => (LOCAL ? "local" : page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build)));
const scriptHashes = () => page.evaluate(() => [...document.querySelectorAll("script[src]")].map((n) => n.src.split("/").pop()).filter((x) => /ModelApp|UniverSheet|index/.test(x)));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

try {
  await assertMeasurable(page, "verify-spreadsheet-multirange-live");
  console.log(`served build: ${await build()}  account: ${LOCAL ? "(none — local)" : s.proof.email}  base: ${BASE}`);
  if (!LOCAL) await seedThrowawayPlan(page, PROJECT);
  await gotoSpreadsheet(page, BASE, PROJECT, "spreadsheet");
  await page.waitForTimeout(1000);
  console.log("chunks in the same observation:", (await scriptHashes()).join(", "), " build:", await build());

  // KNOWN-GOOD ARM: a plain click + type + Enter must work before anything is judged.
  await enter(page, 0, 0, "hello");
  ok("KNOWN-GOOD: plain click + type + Enter still enters a value", (await value(page, 0, 0)) === "hello");
  await clickCell(page, 0, 0);
  ok("KNOWN-GOOD: a plain click selects one cell", eq(await a1s(), ["A1"]));

  // ---- B: Ctrl+click
  for (const [r, c, v] of [[0, 0, "a"], [2, 2, "b"], [4, 4, "c"]]) await enter(page, r, c, v);
  await clickCell(page, 0, 0); await modClickCell(page, 2, 2, CTRL); await modClickCell(page, 4, 4, CTRL);
  ok("B1 Ctrl+click A1, C3, E5 -> exactly three separate ranges", eq(await a1s(), ["A1", "C3", "E5"]), (await a1s()).join(","));
  ok("B1 the active cell moved to the newest (E5)", eq(await activeCell(page), [4, 4]));
  await clickUniverCommand(page, BOLD);
  ok("B2 Bold applies to all three, and only them", (await isBold(0, 0)) && (await isBold(2, 2)) && (await isBold(4, 4)) && !(await isBold(1, 1)));
  await clickCell(page, 4, 4); await press(page, "Control+z");
  ok("B2 ONE Ctrl+Z reverts all three", !(await isBold(0, 0)) && !(await isBold(2, 2)) && !(await isBold(4, 4)));
  await clickCell(page, 0, 0); await modClickCell(page, 2, 2, CTRL); await modClickCell(page, 2, 2, CTRL);
  ok("B3 Ctrl+click on a selected cell takes it out of the selection", eq(await a1s(), ["A1"]));
  await clickCell(page, 5, 5);
  ok("B7 a plain click collapses to one range", eq(await a1s(), ["F6"]));

  for (const [r, c] of [[0, 0], [1, 0], [0, 3], [1, 3], [2, 5]]) await enter(page, r, c, "x");
  await clickCell(page, 0, 0);
  await page.keyboard.down(CTRL);
  const a = await cellPoint(page, 0, 3), b = await cellPoint(page, 1, 3);
  await page.mouse.move(a.left + 8, a.top + 8); await page.mouse.down(); await page.mouse.move(b.left + 8, b.top + 8, { steps: 3 }); await page.mouse.up();
  const h = await columnHeaderPoint(page, 5); await page.mouse.click(h.x, h.y);
  await page.keyboard.up(CTRL); await page.waitForTimeout(200);
  ok("B4 Ctrl+drag added a block and Ctrl+click on a column header added the column; the first cell stays its own range", eq(await a1s(), ["A1", "D1:D2", "F:F"]), (await a1s()).join(","));
  await press(page, "Delete");
  const cleared = [await value(page, 0, 0), await value(page, 0, 3), await value(page, 1, 3), await value(page, 2, 5)];
  ok("B4 Delete cleared every selected cell, and only them", cleared.every((v) => v === null) && (await value(page, 1, 0)) === "x", JSON.stringify(cleared));

  await clickCell(page, 6, 0); await modClickCell(page, 8, 2, CTRL); await modClickCell(page, 9, 4, CTRL);
  await page.keyboard.type("7", { delay: 8 }); await press(page, "Control+Enter");
  const filled = [await value(page, 6, 0), await value(page, 8, 2), await value(page, 9, 4)];
  known("B5 Ctrl+Enter filled the typed value into every selected cell (Excel; the old grid did)", filled.every((v) => v === 7), `values ${JSON.stringify(filled)} — Univer commits only the active cell`);

  await enter(page, 12, 0, "aaa"); await enter(page, 14, 2, "bbb");
  await clickCell(page, 12, 0); await modClickCell(page, 14, 2, CTRL);
  await press(page, "Control+c"); await page.waitForTimeout(400);
  const notice = await page.getByTestId("model-file-notice").innerText().catch(() => "");
  known("B6 Ctrl+C on several ranges shows the multiple-selections message (Excel refuses)", /multiple selections/i.test(notice), `no message shown; the clipboard silently took one range`);
  console.log("served build at the end:", await build());
} catch (e) { console.log("ERROR", (e && e.stack) || e); failures++; }
finally {
  if (!LOCAL) {
    try {
      const left = await page.evaluate(async (pid) => {
        const c = window.pfSupabase;
        await c.from("model_sheets").delete().eq("id", pid);
        return ((await c.from("model_sheets").select("id").eq("id", pid)).data || []).length;
      }, PROJECT).catch(() => -1);
      const cl = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)], left: {} }));
      ok("cleanup: throwaway sheet + project removed (verified)", left === 0 && cl.left.site === 0, `sheet rows left: ${left}, project left: ${cl.left.site}, errors: ${(cl.errors || []).join("; ") || "none"}`);
    } catch (e) { console.log("CLEANUP ERROR", e && e.message); failures++; }
  }
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
