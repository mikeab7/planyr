/* verify-spreadsheet-drag-autoscroll-live — B2452528 / V1896032: in the Spreadsheet, holding the mouse on a cell and
 * dragging past the edge of the grid scrolls it and keeps extending the selection, like Excel. SIGNED IN as the throwaway
 * test account on a THROWAWAY project (never a real one); cleans up what it makes and re-asks the database.
 *
 *  1 down      press a cell, move past the bottom edge, hold STILL → the grid scrolls and the selection keeps growing
 *  2 up        press far down the sheet, hold above the grid     → scrolls back up, anchor stays put
 *  3 right     hold past the right edge                          → scrolls sideways, selection reaches new columns
 *  4 diagonal  hold past the bottom-right corner                 → both axes scroll
 *  5 header drags + release outside the grid → selection holds, scrolling stops at once (no runaway)
 * KNOWN-GOOD ARM: a plain in-view drag selects exactly its rectangle and does not scroll — if that fails the run is VOID.
 * The served build is read in the SAME call as the first assertion. Run: E2E_LOGIN_KEY=… node ui-audit/verify-spreadsheet-drag-autoscroll-live.mjs [base] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
const PROJECT = `${LIVE_PREFIX}dragscroll-${Date.now().toString(36)}`;

let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };

const s = await openSignedIn({ base: BASE });
const { page } = s;
try {
  await assertMeasurable(page, "verify-spreadsheet-drag-autoscroll-live");
  const build = (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 3));
  console.log(`served build: ${build}  chunks: ${chunks.join(" ")}  account: ${s.proof.email}  base: ${BASE}`);
  await seedThrowawayPlan(page, PROJECT);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(`${BASE}/#/project/${PROJECT}/spreadsheet`, { waitUntil: "load" });
  const sheet = page.getByTestId("model-sheet");
  await sheet.waitFor({ timeout: 60000 });
  await page.waitForSelector('[data-row="0"][data-col="0"]', { timeout: 30000 });
  await page.waitForTimeout(1500);

  const hold = (ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms);
  const below = (b, n) => Math.min(b.bottom + n, 700 - 2);
  const box = () => sheet.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.left + el.clientWidth, bottom: r.top + el.clientHeight }; });
  const read = () => sheet.evaluate((el) => {
    const sel = [...el.querySelectorAll('[data-selected="true"]')];
    const rows = sel.map((n) => +n.dataset.row), cols = sel.map((n) => +n.dataset.col);
    return { top: el.scrollTop, left: el.scrollLeft, minRow: Math.min(...rows), maxRow: Math.max(...rows), minCol: Math.min(...cols), maxCol: Math.max(...cols), n: sel.length };
  });
  const anchor = async () => {
    const v = (await page.getByTestId("model-name-box").inputValue()).trim();
    const colNum = (L) => [...L].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    // a whole-column / whole-row selection reads "B:H" / "3:25" (B2455074) — its first line is the anchor
    let m = /^([A-Z]+):([A-Z]+)$/.exec(v); if (m) return { row: 0, col: colNum(m[1]) };
    m = /^(\d+):(\d+)$/.exec(v); if (m) return { row: +m[1] - 1, col: 0 };
    m = /^([A-Z]+)(\d+)$/.exec(v);
    return { row: +m[2] - 1, col: colNum(m[1]) };
  };
  const cellBox = (r, c) => page.locator(`[data-row="${r}"][data-col="${c}"]`).boundingBox();
  const reset = async () => { await sheet.evaluate((el) => { el.scrollTop = 0; el.scrollLeft = 0; }); await hold(300); };

  // KNOWN-GOOD ARM
  {
    const a = await cellBox(1, 1), z = await cellBox(3, 2);
    await page.mouse.move(a.x + 5, a.y + 5); await page.mouse.down();
    await page.mouse.move(z.x + 5, z.y + 5, { steps: 5 }); await page.mouse.up();
    const r = await read();
    const good = r.minRow === 1 && r.maxRow === 3 && r.minCol === 1 && r.maxCol === 2 && r.top === 0 && r.left === 0;
    ok("known-good arm: a plain in-view drag selects exactly B2:C4 and does not scroll", good, JSON.stringify(r));
    if (!good) throw new Error("VOID — the instrument cannot see a plain drag");
  }

  // 1 down
  {
    await reset();
    const b = await box(), a = await cellBox(2, 1);
    await page.mouse.move(a.x + 20, a.y + 8); await page.mouse.down();
    await page.mouse.move(a.x + 20, b.bottom - 30, { steps: 4 });
    const inside = await read();
    await page.mouse.move(a.x + 20, below(b, 25)); await hold(900);
    const mid = await read(); await hold(600); const later = await read();
    ok("down: held still below the grid, it scrolls", mid.top > 0, `scrollTop ${mid.top}`);
    ok("down: the selection grew beyond the first screenful and keeps growing", mid.maxRow > inside.maxRow && later.maxRow > mid.maxRow, `visible end ${inside.maxRow} → ${mid.maxRow} → ${later.maxRow}`);
    ok("down: the anchor never moved", (await anchor()).row === 2);
    await page.mouse.up(); const done = await read(); await hold(300); const settled = await read(); await hold(600); const after = await read();
    // scroll position is the runaway witness (exact); the RENDERED selected rows lag a scroll by a frame or two (virtualised
    // render window), so the selection end is compared only once that has settled
    ok("down: release stops it at once (no runaway)", after.top === done.top && settled.top === done.top && after.maxRow === settled.maxRow,
      `scrollTop ${done.top} → ${settled.top} → ${after.top}; rendered end row ${done.maxRow} → ${settled.maxRow} → ${after.maxRow}`);
  }
  // 2 up
  {
    await sheet.evaluate((el) => { el.scrollTop = 6000; }); await hold(400);
    const b = await box();
    const loc = page.locator('[data-col="1"]').nth(8);
    const a = await loc.boundingBox(); const anchorRow = +(await loc.getAttribute("data-row"));
    await page.mouse.move(a.x + 20, a.y + 8); await page.mouse.down();
    const before = await read();
    await page.mouse.move(a.x + 20, b.top - 15); await hold(900);
    const mid = await read();
    ok("up: held above the grid, it scrolls back up and extends upward", mid.top < before.top && mid.minRow < before.minRow, `scrollTop ${before.top} → ${mid.top}`);
    ok("up: the anchor row stays put", (await anchor()).row === anchorRow);
    await page.mouse.up();
  }
  // 3 right
  {
    await reset();
    const b = await box(), a = await cellBox(1, 0);
    await page.mouse.move(a.x + 10, a.y + 8); await page.mouse.down();
    await page.mouse.move(b.right - 40, a.y + 8, { steps: 4 });
    const inside = await read();
    await page.mouse.move(b.right + 6, a.y + 8); await hold(900);
    const mid = await read();
    ok("right: held past the right edge, it scrolls sideways and reaches new columns", mid.left > 0 && mid.maxCol > inside.maxCol, `scrollLeft ${mid.left}, end col ${inside.maxCol} → ${mid.maxCol}`);
    await page.mouse.up();
  }
  // 4 diagonal
  {
    await reset();
    const b = await box(), a = await cellBox(0, 0);
    await page.mouse.move(a.x + 10, a.y + 8); await page.mouse.down();
    await page.mouse.move(b.right + 6, below(b, 25), { steps: 6 }); await hold(900);
    const mid = await read();
    ok("diagonal: both axes scroll from one still pointer", mid.top > 0 && mid.left > 0 && mid.maxRow > 15 && mid.maxCol > 5, JSON.stringify(mid));
    await page.mouse.up();
  }
  // 5 headers + release outside
  {
    await reset();
    const b = await box(), h = await page.getByTestId("model-col-header-1").boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
    await page.mouse.move(b.right + 6, h.y + h.height / 2, { steps: 4 }); await hold(900);
    const c = await read();
    ok("column-header drag past the right edge selects more columns", c.left > 0 && c.maxCol > 6 && (await anchor()).col === 1, JSON.stringify(c));
    await page.mouse.up();
    await reset();
    const rh = await page.getByTestId("model-row-header-2").boundingBox();
    await page.mouse.move(rh.x + rh.width / 2, rh.y + rh.height / 2 - 2); await page.mouse.down();
    await page.mouse.move(rh.x + rh.width / 2, below(b, 25), { steps: 4 }); await hold(900);
    const r = await read();
    ok("row-header drag past the bottom edge selects more rows", r.top > 0 && r.maxRow > 20 && (await anchor()).row === 2, JSON.stringify(r));
    await page.mouse.up(); // released over the tab strip, outside the grid
    const done = await read(); await hold(300); const settled = await read(); await hold(600); const after = await read();
    ok("release outside the grid: selection holds and scrolling stops", after.top === done.top && settled.top === done.top && after.maxRow === settled.maxRow,
      `scrollTop ${done.top} → ${settled.top} → ${after.top}; rendered end row ${done.maxRow} → ${settled.maxRow} → ${after.maxRow}`);
  }
} catch (e) {
  console.log("ERROR", e && e.message); failures++;
} finally {
  try {
    await page.evaluate(async (pid) => { await window.pfSupabase.from("model_sheets").delete().eq("id", pid); }, PROJECT).catch(() => {});
    const cl = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)], left: {} }));
    ok("cleanup: throwaway project removed (verified)", cl.left.site === 0, `project left: ${cl.left.site}, errors: ${(cl.errors || []).join("; ") || "none"}`);
  } catch (e) { console.log("CLEANUP ERROR", e && e.message); failures++; }
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
