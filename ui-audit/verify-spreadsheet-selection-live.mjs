/* verify-spreadsheet-selection-live — B2530688 / V1971824 (drag-select edge autoscroll) and B2530689 / V1971825
 * (Ctrl+click multi-range selection). SIGNED IN as the throwaway test account on a THROWAWAY project (never a real one);
 * removes everything it makes and re-asks the database. Real mouse + real Control key only.
 *
 *  A1 drag past the bottom, mouse held STILL: scrolls and keeps extending (scroll grows between two reads, no mouse move)
 *  A2 release: scrolling stops at once, selection holds     A3 drag back UP over the header band: scrolls up, grows upward
 *  A4 drag past the RIGHT edge: scrolls right, selection reaches off-screen columns   A5 corner: both axes scroll
 *  A6 release OUTSIDE the window: drag ends, selection holds, no runaway scroll     A7 plain click / type / dblclick-edit unchanged
 *  B1 Ctrl+click A1, C3, E5 -> three separate highlighted cells, active cell E5    B2 Bold -> all three bold; ONE Ctrl+Z reverts all
 *  B3 Ctrl+click a selected cell deselects it   B4 Ctrl+drag adds a block + Ctrl+click a column header adds the column; Delete clears all
 *  B5 Ctrl+Enter fills every selected cell      B6 Ctrl+C on several ranges shows the "multiple selections" message
 *  B7 plain click collapses to one range
 * KNOWN-GOOD ARM: the plain-click arm (A7/B7) and the served-build read must succeed before anything is judged.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-spreadsheet-selection-live.mjs [base] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
const PROJECT = `${LIVE_PREFIX}sheetsel-${Date.now().toString(36)}`;
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };

const s = await openSignedIn({ base: BASE });
const { page } = s;
const sheet = page.getByTestId("model-sheet");
const cell = (r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`);
const selected = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="model-sheet"] [data-selected="true"]')].map((n) => `${n.dataset.row}:${n.dataset.col}`));
const maxOf = (keys, i) => (keys.length ? Math.max(...keys.map((k) => Number(k.split(":")[i]))) : -1);
const scrollPos = () => sheet.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
const bold = (r, c) => cell(r, c).evaluate((n) => getComputedStyle(n).fontWeight === "700");
const build = () => page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build));
const scriptHashes = () => page.evaluate(() => [...document.querySelectorAll("script[src]")].map((n) => n.src.split("/").pop()).filter((x) => /ModelApp|index/.test(x)));
const CTRL = { modifiers: ["Control"] };
/** The last row / column whose cell lies fully inside the grid's viewport right now (what "visible" means to the owner). */
const lastVisible = (axis) => sheet.evaluate((el, ax) => {
  const b = el.getBoundingClientRect(); let best = -1;
  for (const n of el.querySelectorAll("[data-row][data-col]")) {
    const r = n.getBoundingClientRect(); const v = Number(ax === "row" ? n.dataset.row : n.dataset.col);
    if (ax === "row" ? r.bottom <= b.bottom : r.right <= b.right) best = Math.max(best, v);
  }
  return best;
}, axis);

try {
  await assertMeasurable(page, "verify-spreadsheet-selection-live");
  console.log(`served build: ${await build()}  account: ${s.proof.email}  base: ${BASE}`);
  await seedThrowawayPlan(page, PROJECT);
  await page.goto(`${BASE}/#/project/${PROJECT}/spreadsheet`, { waitUntil: "load" });
  await sheet.waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  console.log("chunks in the same observation:", (await scriptHashes()).join(", "), " build:", await build());

  // ---- A: drag-select autoscroll
  const vp = page.viewportSize();
  const box = await sheet.boundingBox();
  await cell(0, 0).click(); await page.keyboard.press("Shift+ArrowDown");
  const initialMax = await lastVisible("row");
  const start = await cell(2, 1).boundingBox();
  await cell(2, 1).click();
  await page.mouse.move(start.x + 10, start.y + 8); await page.mouse.down();
  await page.mouse.move(start.x + 12, box.y + box.height - 20, { steps: 6 });
  await page.mouse.move(start.x + 12, box.y + box.height + 30);          // past the bottom edge, then HOLD STILL
  await page.waitForTimeout(500); const a1 = await scrollPos();
  await page.waitForTimeout(500); const a2 = await scrollPos();
  ok("A1 held still below the grid: it scrolls on its own and keeps scrolling", a1.top > 0 && a2.top > a1.top, `${a1.top} -> ${a2.top}`);
  const grown = maxOf(await selected(), 0);
  ok("A1 the selection grew beyond what was visible when the drag began", grown > initialMax + 5, `last visible row ${initialMax} -> selected through ${grown}`);
  await page.mouse.up(); const a3 = await scrollPos(); await page.waitForTimeout(500); const a4 = await scrollPos();
  ok("A2 release stops the scroll at once", a4.top === a3.top, `${a3.top} -> ${a4.top}`);
  ok("A2 the selection holds after release", maxOf(await selected(), 0) >= grown - 1);

  // up: start low in the visible rows, drag over the header band
  const lowRow = await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid="model-sheet"] [data-row]')].map((n) => Number(n.dataset.row)); return rows.sort((x, y) => x - y)[Math.floor(rows.length / 2)]; });
  const lb = await cell(lowRow, 1).boundingBox();
  await page.mouse.move(lb.x + 10, lb.y + 8); await page.mouse.down();
  await page.mouse.move(lb.x + 12, box.y + 6, { steps: 6 }); await page.waitForTimeout(500);
  const up1 = await scrollPos(); await page.waitForTimeout(400); const up2 = await scrollPos();
  ok("A3 held over the header band: scrolls UP", up2.top < a4.top && up2.top <= up1.top, `${a4.top} -> ${up1.top} -> ${up2.top}`);
  await page.mouse.up();

  await sheet.evaluate((el) => { el.scrollTop = 0; el.scrollLeft = 0; });
  await page.waitForTimeout(200);
  const visibleCols = await lastVisible("col");
  const rb = await cell(1, 1).boundingBox();
  await page.mouse.move(rb.x + 10, rb.y + 8); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, rb.y + 8, { steps: 8 }); await page.waitForTimeout(700);
  const r1 = await scrollPos();
  ok("A4 held at the right edge: scrolls RIGHT", r1.left > 0, `scrollLeft ${r1.left}`);
  ok("A4 the selection reaches columns that were off-screen", maxOf(await selected(), 1) > visibleCols + 3, `last visible col ${visibleCols} -> ${maxOf(await selected(), 1)}`);
  await page.mouse.move(box.x + box.width - 1, box.y + box.height + 30); await page.waitForTimeout(600);
  const r2 = await scrollPos();
  ok("A5 corner: both axes scroll together", r2.top > 0 && r2.left >= r1.left, `${JSON.stringify(r2)}`);
  await page.mouse.move(box.x + 6, box.y + 4); await page.waitForTimeout(600);
  const r3 = await scrollPos();
  ok("A5 back toward the top-left scrolls the other way on both axes", r3.top < r2.top && r3.left < r2.left, `${JSON.stringify(r2)} -> ${JSON.stringify(r3)}`);
  await page.mouse.up();

  await sheet.evaluate((el) => { el.scrollTop = 0; el.scrollLeft = 0; }); await page.waitForTimeout(200);
  const ob = await cell(2, 1).boundingBox();
  await page.mouse.move(ob.x + 10, ob.y + 8); await page.mouse.down();
  await page.mouse.move(ob.x + 12, vp.height - 30, { steps: 6 });
  await page.mouse.move(ob.x + 12, vp.height + 60); await page.waitForTimeout(500);
  const o1 = await scrollPos();
  await page.mouse.up();
  const o2 = await scrollPos(); await page.waitForTimeout(500); const o3 = await scrollPos();
  ok("A6 released OUTSIDE the window: it had scrolled, then stops dead", o1.top > 0 && o3.top === o2.top, `${o1.top} / ${o2.top} -> ${o3.top}`);
  ok("A6 the selection holds", maxOf(await selected(), 0) > 20);

  await sheet.evaluate((el) => { el.scrollTop = 0; el.scrollLeft = 0; }); await page.waitForTimeout(200);
  await cell(0, 0).click(); await page.keyboard.type("hello"); await page.keyboard.press("Enter");
  ok("A7 KNOWN-GOOD: plain click + type + Enter still enters a value", (await cell(0, 0).innerText()).trim() === "hello");
  await cell(3, 3).click();
  ok("A7 a plain click selects exactly one cell", JSON.stringify(await selected()) === JSON.stringify(["3:3"]));
  await cell(0, 0).dblclick();
  ok("A7 double-click still opens the in-cell editor", await page.locator('[data-testid="model-sheet"] input').first().isVisible());
  await page.keyboard.press("Escape");

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
