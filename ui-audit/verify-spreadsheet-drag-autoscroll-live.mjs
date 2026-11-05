/* verify-spreadsheet-drag-autoscroll-live — B2452528 / V1896032: in the Spreadsheet, holding the mouse on a cell and dragging past the edge of
 * the grid scrolls it and keeps extending the selection, like Excel. SIGNED IN as the throwaway test account on a THROWAWAY project (never a
 * real one); cleans up what it makes and re-asks the database. PORTED to the Univer grid (NEW-2, 2026-10-31): the grid is a canvas, so the
 * scroll and the selection are read through Univer's facade (armed by `window.__PLANYR_E2E`, set before load) and every gesture is the REAL
 * mouse at a point computed from Univer's cell geometry. Univer's drag autoscroll is native (standalone parity check `autoscroll`); this keeps
 * the user-level checks against the real, deployed app.
 *
 *  1 down      press a cell, move past the bottom edge, hold STILL → the grid scrolls and the selection keeps growing
 *  2 up        press far down the sheet, hold above the grid     → scrolls back up, anchor stays put
 *  3 right     hold past the right edge                          → scrolls sideways, selection reaches new columns
 *  4 diagonal  hold past the bottom-right corner                 → both axes scroll
 *  5 header drags + release outside the grid → selection holds, scrolling stops at once (no runaway)
 * KNOWN-GOOD ARM: a plain in-view drag selects exactly its rectangle and does not scroll — if that fails the run is VOID.
 * The served build is read in the SAME call as the first assertion.
 * Run (live): E2E_LOGIN_KEY=… node ui-audit/verify-spreadsheet-drag-autoscroll-live.mjs [base]
 *     (local, no sign-in): node ui-audit/verify-spreadsheet-drag-autoscroll-live.mjs --local http://localhost:4173 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import {
  launchLocalHarness, gotoSpreadsheet, cellPoint, canvasBox, columnHeaderPoint, rowHeaderPoint, clickCell, selection, activeCell, sheetView, scrollGridTo, inSheet,
} from "../e2e/lib/univerGrid.js";

const argv = process.argv.slice(2);
const LOCAL = argv.includes("--local");
const BASE = (argv.find((a) => /^https?:/.test(a)) || (LOCAL ? "http://localhost:4173" : "https://planyr.io")).replace(/\/$/, "");
const PROJECT = `${LIVE_PREFIX}dragscroll-${Date.now().toString(36)}`;
const VIEW_W = 1000, VIEW_H = 700;

let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };

const s = LOCAL
  ? await launchLocalHarness(BASE, PROJECT, { viewport: { width: VIEW_W, height: VIEW_H } })
  : await openSignedIn({ base: BASE, viewport: { width: VIEW_W, height: VIEW_H }, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
try {
  await assertMeasurable(page, "verify-spreadsheet-drag-autoscroll-live");
  const build = LOCAL ? "local" : (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 3));
  console.log(`served build: ${build}  chunks: ${chunks.join(" ")}  account: ${LOCAL ? "(none — local)" : s.proof.email}  base: ${BASE}`);
  if (!LOCAL) await seedThrowawayPlan(page, PROJECT);
  await gotoSpreadsheet(page, BASE, PROJECT, "spreadsheet");
  await page.waitForTimeout(1000);

  const hold = (ms) => page.waitForTimeout(ms);
  const below = (b, n) => Math.min(b.bottom + n, VIEW_H - 2);
  const rightOf = (b, n) => Math.min(b.right + n, VIEW_W - 2);
  const sel0 = async () => (await selection(page))[0];
  const pos = async () => {
    const v = await sheetView(page);
    const rh = await inSheet(page, (api, ws) => ws.getRowHeight(0)), cw = await inSheet(page, (api, ws) => ws.getColumnWidth(0));
    return { top: v.top * rh + v.offY, left: v.left * cw + v.offX };
  };
  const maxes = () => inSheet(page, (api, ws) => ({ r2: ws.getMaxRows() - 1, c2: ws.getMaxColumns() - 1 }));
  const growing = async (key, prev) => { const x = (await sel0())[key]; const m = (await maxes())[key]; return x > prev || x === m; };
  const reset = async () => { await scrollGridTo(page, 0, 0); await clickCell(page, 0, 0); await hold(400); };

  // KNOWN-GOOD ARM
  {
    const a = await cellPoint(page, 1, 1), z = await cellPoint(page, 3, 2);
    await page.mouse.move(a.left + 5, a.top + 5); await page.mouse.down();
    await page.mouse.move(z.left + 5, z.top + 5, { steps: 5 }); await page.mouse.up();
    const r = await sel0(), p = await pos();
    const good = r.r1 === 1 && r.r2 === 3 && r.c1 === 1 && r.c2 === 2 && p.top === 0 && p.left === 0;
    ok("known-good arm: a plain in-view drag selects exactly B2:C4 and does not scroll", good, JSON.stringify({ r, p }));
    if (!good) throw new Error("VOID — the instrument cannot see a plain drag");
  }

  // 1 down
  {
    await reset();
    const b = await canvasBox(page), a = await cellPoint(page, 2, 1);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(a.x, b.bottom - 30, { steps: 4 });
    const inside = await sel0();
    await page.mouse.move(a.x, below(b, 25)); await hold(900);
    const mid = await sel0(), midPos = await pos(); await hold(600); const later = await sel0();
    ok("down: held still below the grid, it scrolls", midPos.top > 0, `scrollTop ${midPos.top}`);
    ok("down: the selection grew beyond the first screenful and keeps growing", mid.r2 > inside.r2 && later.r2 > mid.r2, `visible end ${inside.r2} → ${mid.r2} → ${later.r2}`);
    ok("down: the anchor never moved", (await activeCell(page))[0] === 2);
    await page.mouse.up(); const done = await sel0(), donePos = await pos(); await hold(300); const settled = await pos(); await hold(600); const after = await pos(); const afterSel = await sel0();
    ok("down: release stops it at once (no runaway)", after.top === donePos.top && settled.top === donePos.top && afterSel.r2 === done.r2, `scrollTop ${donePos.top} → ${settled.top} → ${after.top}; end row ${done.r2} → ${afterSel.r2}`);
  }
  // 2 up
  {
    await reset(); await scrollGridTo(page, 250, 0); await hold(600);
    const b = await canvasBox(page); const sx = b.left + b.w / 2, sy = b.top + b.h / 2;
    await page.mouse.move(sx, sy); await page.mouse.down();
    const before = await sel0(), beforePos = await pos(); const anchorRow = (await activeCell(page))[0];
    await page.mouse.move(sx, b.top - 15); await hold(900);
    const mid = await sel0(), midPos = await pos();
    ok("up: held above the grid, it scrolls back up and extends upward", midPos.top < beforePos.top && mid.r1 < before.r1, `scrollTop ${beforePos.top} → ${midPos.top}`);
    ok("up: the anchor row stays put", (await activeCell(page))[0] === anchorRow);
    await page.mouse.up();
  }
  // 3 right
  {
    await reset();
    const b = await canvasBox(page), a = await cellPoint(page, 1, 0);
    await page.mouse.move(a.left + 10, a.top + 8); await page.mouse.down();
    await page.mouse.move(b.right - 150, a.top + 8, { steps: 4 });
    const inside = await sel0(), insidePos = await pos();
    await page.mouse.move(rightOf(b, 6), a.top + 8, { steps: 8 }); await hold(900);   // travelled there like a hand (a one-event jump onto the scrollbar strip starts nothing)
    const mid = await sel0(), midPos = await pos();
    ok("right: held past the right edge, it scrolls sideways and reaches new columns", midPos.left > insidePos.left && mid.c2 > inside.c2, `scrollLeft ${midPos.left}, end col ${inside.c2} → ${mid.c2}`);
    ok("right: it keeps going (or has reached the last column) while held", await growing("c2", mid.c2));
    await page.mouse.up();
  }
  // 4 diagonal
  {
    await reset();
    const b = await canvasBox(page), a = await cellPoint(page, 0, 0);
    await page.mouse.move(a.left + 10, a.top + 8); await page.mouse.down();
    await page.mouse.move(rightOf(b, 6), below(b, 25), { steps: 6 }); await hold(900);
    const mid = await sel0(), p = await pos();
    ok("diagonal: both axes scroll from one still pointer", p.top > 0 && p.left > 0 && mid.r2 > 15 && mid.c2 > 5, JSON.stringify({ p, r2: mid.r2, c2: mid.c2 }));
    await page.mouse.up();
  }
  // 5 headers + release outside
  {
    await reset();
    const b = await canvasBox(page), h = await columnHeaderPoint(page, 1);
    await page.mouse.move(h.x, h.y); await page.mouse.down();
    await page.mouse.move(rightOf(b, 6), h.y, { steps: 4 }); await hold(900);
    const c = await sel0(), cp = await pos();
    ok("column-header drag past the right edge selects more columns", cp.left > 0 && c.c2 > 6 && c.c1 === 1 && c.r1 === 0, JSON.stringify({ c1: c.c1, c2: c.c2, left: cp.left }));
    await page.mouse.up();
    await reset();
    const rh = await rowHeaderPoint(page, 2);
    await page.mouse.move(rh.x, rh.y - 2); await page.mouse.down();
    await page.mouse.move(rh.x, below(b, 25), { steps: 4 }); await hold(900);
    const r = await sel0(), rp = await pos(); const cols = await inSheet(page, (api, ws) => ws.getMaxColumns());
    ok("row-header drag past the bottom edge selects more rows (whole rows)", rp.top > 0 && r.r2 > 20 && r.r1 === 2 && r.c1 === 0 && r.c2 === cols - 1, JSON.stringify({ r1: r.r1, r2: r.r2, top: rp.top }));
    await page.mouse.up(); // released over the tab strip, outside the grid
    const done = await sel0(), dp = await pos(); await hold(300); const settled = await pos(); await hold(600); const after = await pos(); const afterSel = await sel0();
    ok("release outside the grid: selection holds and scrolling stops", after.top === dp.top && settled.top === dp.top && afterSel.r2 === done.r2, `scrollTop ${dp.top} → ${settled.top} → ${after.top}; end row ${done.r2} → ${afterSel.r2}`);
  }
} catch (e) {
  console.log("ERROR", e && e.message); failures++;
} finally {
  if (!LOCAL) {
    try {
      await page.evaluate(async (pid) => { await window.pfSupabase.from("model_sheets").delete().eq("id", pid); }, PROJECT).catch(() => {});
      const cl = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)], left: {} }));
      ok("cleanup: throwaway project removed (verified)", cl.left.site === 0, `project left: ${cl.left.site}, errors: ${(cl.errors || []).join("; ") || "none"}`);
    } catch (e) { console.log("CLEANUP ERROR", e && e.message); failures++; }
  }
  await s.close();
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
