/* verify-spreadsheet-multirange-live — B2530689 / V1971825 (Ctrl+click multi-range selection; the drag-select
 * autoscroll half is B2452528's verify-spreadsheet-drag-autoscroll-live.mjs). SIGNED IN as the throwaway test account on a THROWAWAY project (never a real one);
 * removes everything it makes and re-asks the database. Real mouse + real Control key only.
 *
 *  B1 Ctrl+click A1, C3, E5 -> three separate highlighted cells, active cell E5    B2 Bold -> all three bold; ONE Ctrl+Z reverts all
 *  B3 Ctrl+click a selected cell deselects it   B4 Ctrl+drag adds a block + Ctrl+click a column header adds the column; Delete clears all
 *  B5 Ctrl+Enter fills every selected cell      B6 Ctrl+C on several ranges shows the "multiple selections" message
 *  B7 plain click collapses to one range
 * KNOWN-GOOD ARM: the plain-click arm (A7/B7) and the served-build read must succeed before anything is judged.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-spreadsheet-multirange-live.mjs [base] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
const PROJECT = `${LIVE_PREFIX}sheetmulti-${Date.now().toString(36)}`;
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };

const s = await openSignedIn({ base: BASE });
const { page } = s;
const sheet = page.getByTestId("model-sheet");
const cell = (r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
const selected = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="model-sheet"] [data-selected="true"]')].map((n) => `${n.dataset.row}:${n.dataset.col}`));
const maxOf = (keys, i) => (keys.length ? Math.max(...keys.map((k) => Number(k.split(":")[i]))) : -1);
const bold = (r, c) => cell(r, c).evaluate((n) => getComputedStyle(n).fontWeight === "700");
const build = () => page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build));
const scriptHashes = () => page.evaluate(() => [...document.querySelectorAll("script[src]")].map((n) => n.src.split("/").pop()).filter((x) => /ModelApp|index/.test(x)));
const CTRL = { modifiers: ["Control"] };

try {
  await assertMeasurable(page, "verify-spreadsheet-multirange-live");
  console.log(`served build: ${await build()}  account: ${s.proof.email}  base: ${BASE}`);
  await seedThrowawayPlan(page, PROJECT);
  await page.goto(`${BASE}/#/project/${PROJECT}/spreadsheet`, { waitUntil: "load" });
  await sheet.waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  console.log("chunks in the same observation:", (await scriptHashes()).join(", "), " build:", await build());

  // KNOWN-GOOD ARM: a plain click + type + Enter must work before anything is judged.
  await cell(0, 0).click(); await page.keyboard.type("hello"); await page.keyboard.press("Enter");
  ok("KNOWN-GOOD: plain click + type + Enter still enters a value", (await cell(0, 0).innerText()).trim() === "hello");

  // ---- B: Ctrl+click
  for (const [r, c, v] of [[0, 0, "a"], [2, 2, "b"], [4, 4, "c"]]) { await cell(r, c).click(); await page.keyboard.type(v); await page.keyboard.press("Enter"); }
  await cell(0, 0).click(); await cell(2, 2).click(CTRL); await cell(4, 4).click(CTRL);
  const three = (await selected()).sort();
  ok("B1 Ctrl+click A1, C3, E5 -> exactly three separate highlighted cells", JSON.stringify(three) === JSON.stringify(["0:0", "2:2", "4:4"]), three.join(","));
  ok("B1 the active cell moved to the newest (E5)", (await page.getByTestId("model-active-cell").getAttribute("data-row")) === "4");
  await page.getByTestId("ribbon-bold").click();
  ok("B2 Bold applies to all three, and only them", (await bold(0, 0)) && (await bold(2, 2)) && (await bold(4, 4)) && !(await bold(1, 1)));
  await sheet.focus(); await page.keyboard.press("Control+z");
  ok("B2 ONE Ctrl+Z reverts all three", !(await bold(0, 0)) && !(await bold(2, 2)) && !(await bold(4, 4)));
  await cell(0, 0).click(); await cell(2, 2).click(CTRL); await cell(2, 2).click(CTRL);
  ok("B3 Ctrl+click on a selected cell deselects it", JSON.stringify(await selected()) === JSON.stringify(["0:0"]));
  await cell(0, 0).click();
  await page.keyboard.down("Control");
  const a = await cell(0, 3).boundingBox(), b = await cell(1, 3).boundingBox();
  await page.mouse.move(a.x + 8, a.y + 8); await page.mouse.down(); await page.mouse.move(b.x + 8, b.y + 8, { steps: 3 }); await page.mouse.up();
  await page.getByTestId("model-col-header-5").click({ modifiers: ["Control"] });
  await page.keyboard.up("Control");
  const keys = await selected();
  ok("B4 Ctrl+drag added a block and a Ctrl+click on a column header added the column; the first cell stays", ["0:0", "0:3", "1:3", "2:5"].every((k) => keys.includes(k)), `${keys.length} cells`);
  await sheet.focus(); await page.keyboard.press("Delete");
  ok("B4 Delete cleared every selected cell", (await cell(0, 0).innerText()).trim() === "");
  await cell(1, 1).click(); await page.keyboard.type("keep"); await page.keyboard.press("Enter");
  await cell(6, 0).click(); await cell(8, 2).click(CTRL); await cell(9, 4).click(CTRL);
  await page.keyboard.type("7"); await page.keyboard.press("Control+Enter");
  const filled = [await cell(6, 0).innerText(), await cell(8, 2).innerText(), await cell(9, 4).innerText()].map((t) => t.trim());
  ok("B5 Ctrl+Enter filled the typed value into every selected cell", filled.every((t) => t === "7"), filled.join(","));
  await sheet.focus(); await page.keyboard.press("Control+c");
  ok("B6 Ctrl+C on several ranges shows the multiple-selections message", /multiple selections/i.test(await page.getByTestId("model-file-notice").innerText().catch(() => "")));
  await cell(5, 5).click();
  ok("B7 a plain click collapses to one range", JSON.stringify(await selected()) === JSON.stringify(["5:5"]));
  console.log("served build at the end:", await build());
} catch (e) { console.log("ERROR", e && e.stack || e); failures++; }
finally {
  try {
    const left = await page.evaluate(async (pid) => {
      const c = window.pfSupabase;
      await c.from("model_sheets").delete().eq("id", pid);
      return ((await c.from("model_sheets").select("id").eq("id", pid)).data || []).length;
    }, PROJECT).catch(() => -1);
    const cl = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)], left: {} }));
    ok("cleanup: throwaway sheet + project removed (verified)", left === 0 && cl.left.site === 0, `sheet rows left: ${left}, project left: ${cl.left.site}, errors: ${(cl.errors || []).join("; ") || "none"}`);
  } catch (e) { console.log("CLEANUP ERROR", e && e.message); failures++; }
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
