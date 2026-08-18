/* SCHEDULE GRID — INDENT/OUTDENT IGNORED A MULTI-ROW SELECTION, AND DELETING A TASK WITH
 * SUBTASKS GAVE NO CHOICE.
 *
 * Owner report #1, verbatim: "I literally highlighted all these and then press shift alt right,
 * and it only indented the top one... that specific bug is even worse when you try and write
 * click and then press outdent or indent. It, like, only works on the specific cell that you
 * indented or outdented." Measured live before this fix (throwaway repro, not committed): the
 * keyboard path calls `indentTaskById(selectedId)`/`outdentTaskById(selectedId)` — `selectedId`
 * is whichever row is the drag/shift-click ANCHOR, not the whole highlighted range — and the
 * context-menu path calls the same by-id helpers with `taskCtx.task.id`, the right-clicked row,
 * again ignoring any active multi-row selection entirely. Both are fixed the same way: resolve
 * the FULL row range first (`rowRangeSelIds`/`structuralTargets`, public/sequence/index.html) and
 * pass every id through `indentSelection`/`outdentSelection` in ONE batch.
 *
 * Owner report #2 (superseded mid-report, final form is what's implemented): deleting a task with
 * subtasks looked "blocked." Measured: right-click Delete Row and a full-row-selected keyboard
 * Delete already cascade-delete the whole subtree successfully with NO guard at all — that path
 * was never broken. The likely real mechanism (also measured): pressing Delete while a single
 * PARENT-LOCKED cell (start/end/duration/cost on a row with children) is selected — not the whole
 * row — is Excel-style "clear this cell," which correctly refuses to clear a locked cell, but does
 * so with zero feedback; that reads exactly like "not letting me delete." The owner's own
 * correction moots the "why was it blocked" question and asks for something new instead: never
 * silently cascade, never silently promote — ask, with exactly two choices + Cancel, same-sized
 * buttons (his standing complaint about the OTHER modal in this file, SuccessorPromptModal).
 *
 * NONE of this file runs in CI — .github/workflows/build.yml invokes no ui-audit/verify-*.mjs
 * script. It exists, it is not enforced. The fast, CI-runnable half of this fix is
 * test/scheduleIndentOutdentDelete.test.js (source-pin regexes + the pure-function unit tests).
 *
 * Run: node ui-audit/verify-schedule-indent-outdent-delete.mjs   [PW_CHROME=<chrome>]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const realBody = await readFile(HTML_PATH, "utf8");
await ensureVendored();

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

async function makeServer(bodyOverride) {
  const server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      if (p.endsWith("sequence/index.html")) {
        const src = bodyOverride ?? realBody;
        res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(rewriteCdn(src))); return;
      }
      const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      const body = await readFile(fp);
      res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, r));
  return { server, url: `http://localhost:${server.address().port}/sequence/` };
}

function task(over) {
  return { start: "2026-01-05", end: "2026-01-05", duration: 1, predecessors: [], health: "gray",
    percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true,
    durUnit: "d", durValue: 1, ...over };
}

// ── Indent/outdent fixture ──────────────────────────────────────────────────────────────────
// Kickoff (1, control depth-0 row)
// ALTA & Topo Survey (2)
//   PI Alpha (3)                          <- valid indent target for PI
//   PI (4)                                 <- typed duration 3d; will gain children (leaf->parent)
//     Solicit ALTA/Topo Proposals (5)      <- first child: cannot indent alone (no sibling above)
//     Select Surveyor (6)                  <- typed duration 3d; will gain children too
//     Field Work (7)                       <- valid indent target: previous sibling (6) at same level
//     Draft Review (8)
//     Comments & Revisions (9)
//     Revisions & Final ALTA Delivery (10) <- milestone (duration 0) for the "milestone" adjacent case
// Next top-level task (11)
const IO_FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Indent Outdent Fixture", tasks: [
    task({ id: 1, name: "Kickoff", health: "green" }),
    task({ id: 2, name: "ALTA & Topo Survey" }),
    task({ id: 3, name: "PI Alpha", parentId: 2 }),
    task({ id: 4, name: "PI", parentId: 2, durValue: 3, duration: 3, end: "2026-01-08" }),
    task({ id: 5, name: "Solicit ALTA/Topo Proposals", parentId: 4 }),
    task({ id: 6, name: "Select Surveyor", parentId: 4, durValue: 3, duration: 3, end: "2026-01-08" }),
    task({ id: 7, name: "Field Work", parentId: 4 }),
    task({ id: 8, name: "Draft Review", parentId: 4 }),
    task({ id: 9, name: "Comments & Revisions", parentId: 4 }),
    task({ id: 10, name: "Revisions & Final ALTA Delivery", parentId: 4, durValue: 0, duration: 0 }),
    task({ id: 11, name: "Next top-level task" }),
  ]}},
};

async function bootAndImport(page, url, fixture) {
  page.removeAllListeners("dialog");
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-schedule-indent-outdent-delete");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', {
    name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 4200);
}

async function rowsByName(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-task-row]')].map(r => {
    const id = Number(r.getAttribute('data-task-row'));
    const nameCell = r.querySelector('[data-col-key="name"]');
    const durCell = r.querySelector('[data-col-key="duration"]');
    return { id, name: (nameCell?.innerText || "").replace(/^▾\s*|^▸\s*/, "").trim(), duration: (durCell?.innerText || "").trim() };
  }));
}
const idByName = async (page, name) => {
  const rows = await rowsByName(page);
  const row = rows.find(r => r.name === name);
  return row ? row.id : null;
};

async function selectRowRangeByIdColumn(page, topAppId, bottomAppId, rows) {
  const topRow = rows.find(r => r.id === topAppId), bottomRow = rows.find(r => r.id === bottomAppId);
  const topBox = await page.locator(`[data-task-row="${topRow.id}"] [data-col-key="id"]`).boundingBox();
  const botBox = await page.locator(`[data-task-row="${bottomRow.id}"] [data-col-key="id"]`).boundingBox();
  await page.mouse.move(topBox.x + topBox.width / 2, topBox.y + topBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(botBox.x + botBox.width / 2, botBox.y + botBox.height / 2, { steps: 5 });
  await page.mouse.up();
  await pacedWait(page, 120);
}

// Resolve the app's live row id (renumbered) for a task by its ORIGINAL fixture name, via the DOM.
async function liveIds(page, names) {
  const rows = await rowsByName(page);
  const out = {};
  names.forEach(n => { const r = rows.find(x => x.name === n); out[n] = r ? r.id : null; });
  return out;
}

async function indentViaKeyboard(page, topName, bottomName) {
  const rows = await rowsByName(page);
  const ids = await liveIds(page, [topName, bottomName]);
  await selectRowRangeByIdColumn(page, ids[topName], ids[bottomName], rows);
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await pacedWait(page, 300);
}
async function outdentViaKeyboard(page, topName, bottomName) {
  const rows = await rowsByName(page);
  const ids = await liveIds(page, [topName, bottomName]);
  await selectRowRangeByIdColumn(page, ids[topName], ids[bottomName], rows);
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await pacedWait(page, 300);
}
async function indentViaContextMenu(page, topName, bottomName, rightClickOn) {
  const rows = await rowsByName(page);
  const ids = await liveIds(page, [topName, bottomName, rightClickOn]);
  await selectRowRangeByIdColumn(page, ids[topName], ids[bottomName], rows);
  await page.locator(`[data-task-row="${ids[rightClickOn]}"] [data-col-key="id"]`).click({ button: "right" });
  await pacedWait(page, 150);
  await page.locator("i.ti-indent-increase").locator("..").click();
  await pacedWait(page, 300);
}
async function outdentViaContextMenu(page, topName, bottomName, rightClickOn) {
  const rows = await rowsByName(page);
  const ids = await liveIds(page, [topName, bottomName, rightClickOn]);
  await selectRowRangeByIdColumn(page, ids[topName], ids[bottomName], rows);
  await page.locator(`[data-task-row="${ids[rightClickOn]}"] [data-col-key="id"]`).click({ button: "right" });
  await pacedWait(page, 150);
  await page.locator("i.ti-indent-decrease").locator("..").click();
  await pacedWait(page, 300);
}

// Parent-of(name) via the visual "level" — reads indentation depth by comparing name-cell
// paddingLeft, cheap and DOM-observable without reaching into React state.
async function levelOf(page, name) {
  return page.evaluate((n) => {
    const rows = [...document.querySelectorAll('[data-task-row]')];
    for (const r of rows) {
      const nameCell = r.querySelector('[data-col-key="name"] span');
      if (nameCell && nameCell.closest('[data-col-key="name"]').innerText.replace(/^▾\s*|^▸\s*/, "").trim() === n) {
        const inner = r.querySelector('[data-col-key="name"] > span');
        return inner ? parseFloat(getComputedStyle(inner).paddingLeft) : null;
      }
    }
    return null;
  }, name);
}

let browser, page;
async function freshPage(url, fixture) {
  if (page) await page.close();
  page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const pageErrors = []; page.on("pageerror", e => pageErrors.push(e.message));
  page._errors = pageErrors;
  await bootAndImport(page, url, fixture);
  return page;
}

const { server, url } = await makeServer(null);
browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

// =================================================================================================
// SECTION A — INDENT: whole selection moves, both entry points
// =================================================================================================
{
  await freshPage(url, IO_FIXTURE);
  // A1 — a positive multi-row indent: "Field Work".."Revisions & Final ALTA Delivery" (4 rows,
  // topmost has a valid preceding sibling "Select Surveyor") via KEYBOARD, drag-selected top->bottom
  // (so the drag-anchor ends at the BOTTOM row — the exact shape that reproduced "only the top one
  // moved" when the anchor and the true selection top diverge).
  await indentViaKeyboard(page, "Field Work", "Revisions & Final ALTA Delivery");
  const afterKbAll = await rowsByName(page);
  const movedNames = ["Field Work", "Draft Review", "Comments & Revisions", "Revisions & Final ALTA Delivery"];
  const untouchedNames = ["Solicit ALTA/Topo Proposals"];
  // Every moved row now renders one level deeper than "Select Surveyor" (its new parent).
  const selectSurveyorLevel = await levelOf(page, "Select Surveyor");
  const movedLevels = await Promise.all(movedNames.map(n => levelOf(page, n)));
  ok("A1 (keyboard) · ALL FOUR selected rows indent, not just the drag anchor",
    movedLevels.every(l => l === movedLevels[0]) && movedLevels[0] > selectSurveyorLevel,
    JSON.stringify({ selectSurveyorLevel, movedLevels }));
  const untouchedLevel = await levelOf(page, "Solicit ALTA/Topo Proposals");
  ok("A1 · a row OUTSIDE the selection ('Solicit ALTA/Topo Proposals') is unaffected",
    untouchedLevel === selectSurveyorLevel, `untouchedLevel=${untouchedLevel} vs PI-child level=${selectSurveyorLevel}`);
}

{
  await freshPage(url, IO_FIXTURE);
  // A2 — the SAME positive indent via the RIGHT-CLICK CONTEXT MENU, right-clicking the TOPMOST
  // row of the selection (the exact case that no-op'd before this fix, because the context menu
  // used to act only on the row it was opened on).
  await indentViaContextMenu(page, "Field Work", "Revisions & Final ALTA Delivery", "Field Work");
  const selectSurveyorLevel = await levelOf(page, "Select Surveyor");
  const movedLevels = await Promise.all(["Field Work", "Draft Review", "Comments & Revisions", "Revisions & Final ALTA Delivery"].map(n => levelOf(page, n)));
  ok("A2 (context menu, right-clicked the TOP row) · ALL FOUR rows indent",
    movedLevels.every(l => l === movedLevels[0]) && movedLevels[0] > selectSurveyorLevel, JSON.stringify(movedLevels));
}

{
  await freshPage(url, IO_FIXTURE);
  // A3 — the SAME positive indent via context menu, right-clicking the BOTTOM row this time (the
  // other half of "only works on the specific cell you indented" — must give the identical result
  // regardless of which row inside the selection was right-clicked).
  await indentViaContextMenu(page, "Field Work", "Revisions & Final ALTA Delivery", "Revisions & Final ALTA Delivery");
  const selectSurveyorLevel = await levelOf(page, "Select Surveyor");
  const movedLevels = await Promise.all(["Field Work", "Draft Review", "Comments & Revisions", "Revisions & Final ALTA Delivery"].map(n => levelOf(page, n)));
  ok("A3 (context menu, right-clicked the BOTTOM row) · ALL FOUR rows indent identically",
    movedLevels.every(l => l === movedLevels[0]) && movedLevels[0] > selectSurveyorLevel, JSON.stringify(movedLevels));
}

// =================================================================================================
// SECTION B — INDENT adjacent cases: block that cannot indent, selection spanning depths
// =================================================================================================
{
  await freshPage(url, IO_FIXTURE);
  // B1 — the WHOLE block of PI's children (topmost = "Solicit ALTA/Topo Proposals", PI's FIRST
  // child — no sibling above it at its own level) is a clean NO-OP, all-or-nothing: none of the
  // six rows move, not even the ones that (in isolation) could have found a target further down.
  const before = await rowsByName(page);
  await indentViaKeyboard(page, "Solicit ALTA/Topo Proposals", "Revisions & Final ALTA Delivery");
  const after = await rowsByName(page);
  ok("B1 · a block whose TOPMOST row has no eligible predecessor is a clean no-op for the WHOLE block",
    JSON.stringify(before) === JSON.stringify(after));
}

{
  await freshPage(url, IO_FIXTURE);
  // B2 — selection SPANNING DIFFERENT DEPTHS: select "PI" together with its own six children.
  // Only PI (the one root row) is eligible to move — up to "PI Alpha" (its own valid preceding
  // sibling) — and every child must follow PI down, keeping its relative depth to PI exactly as
  // it was (never flattened to PI Alpha's level).
  const piAlphaLevel = await levelOf(page, "PI Alpha");
  const piLevelBefore = await levelOf(page, "PI");
  const childLevelBefore = await levelOf(page, "Field Work");
  ok("B2 (setup) · PI starts as PI Alpha's SIBLING (same level), children one level deeper", piLevelBefore === piAlphaLevel && childLevelBefore > piLevelBefore);
  await indentViaKeyboard(page, "PI", "Revisions & Final ALTA Delivery");
  const piLevelAfter = await levelOf(page, "PI");
  const childLevelAfter = await levelOf(page, "Field Work");
  ok("B2 · PI itself moved one level deeper (now under PI Alpha)", piLevelAfter > piLevelBefore);
  ok("B2 · PI's children followed PI down and kept the SAME relative depth to PI as before (not flattened)",
    (childLevelAfter - piLevelAfter) === (childLevelBefore - piLevelBefore),
    `before delta=${childLevelBefore - piLevelBefore} after delta=${childLevelAfter - piLevelAfter}`);
}

// =================================================================================================
// SECTION C — OUTDENT: whole selection moves, both entry points; depth-0 no-op; mixed selection
// =================================================================================================
{
  await freshPage(url, IO_FIXTURE);
  // C1 — outdent "Field Work".."Comments & Revisions" (3 of PI's middle children) via KEYBOARD —
  // all three promote to PI's own parent (ALTA & Topo Survey), landing right after PI, in order.
  const altaLevel = await levelOf(page, "ALTA & Topo Survey");
  await outdentViaKeyboard(page, "Field Work", "Comments & Revisions");
  const movedLevels = await Promise.all(["Field Work", "Draft Review", "Comments & Revisions"].map(n => levelOf(page, n)));
  ok("C1 (keyboard) · ALL THREE selected rows outdent to PI's own parent's level",
    movedLevels.every(l => l === movedLevels[0]) && movedLevels[0] > altaLevel && movedLevels[0] < (await levelOf(page, "PI")) + 100 /* sanity: still deeper than root */);
  const rowsAfter = await rowsByName(page);
  const order = rowsAfter.map(r => r.name);
  const iField = order.indexOf("Field Work"), iDraft = order.indexOf("Draft Review"), iComments = order.indexOf("Comments & Revisions"), iSolicit = order.indexOf("Solicit ALTA/Topo Proposals"), iSurveyor = order.indexOf("Select Surveyor"), iRevisions = order.indexOf("Revisions & Final ALTA Delivery");
  ok("C1 · promoted rows keep their RELATIVE ORDER (Field Work, Draft Review, Comments & Revisions)",
    iField < iDraft && iDraft < iComments, JSON.stringify(order));
  ok("C1 · PI's remaining children ('Solicit...', 'Select Surveyor') stay put and precede the promoted block",
    iSolicit < iSurveyor && iSurveyor < iField);
  ok("C1 · PI's last remaining child ('Revisions & Final ALTA Delivery') stays UNDER pi, not swept into the promoted block",
    (await levelOf(page, "Revisions & Final ALTA Delivery")) > (await levelOf(page, "PI")));
}

{
  await freshPage(url, IO_FIXTURE);
  // C2 — the SAME outdent via the RIGHT-CLICK CONTEXT MENU, right-clicked on the row in the
  // MIDDLE of the selection this time (neither endpoint) — the context-menu path must resolve the
  // whole range regardless of which row inside it was clicked.
  await outdentViaContextMenu(page, "Field Work", "Comments & Revisions", "Draft Review");
  const altaLevel = await levelOf(page, "ALTA & Topo Survey");
  const movedLevels = await Promise.all(["Field Work", "Draft Review", "Comments & Revisions"].map(n => levelOf(page, n)));
  ok("C2 (context menu, right-clicked the MIDDLE row) · ALL THREE rows outdent",
    movedLevels.every(l => l === movedLevels[0]) && movedLevels[0] > altaLevel, JSON.stringify(movedLevels));
}

{
  await freshPage(url, IO_FIXTURE);
  // C3 — OUTDENT AT DEPTH ZERO is a clean no-op: select the single top-level row "Kickoff" and
  // outdent it. Must not throw, must not change anything.
  const before = await rowsByName(page);
  await outdentViaKeyboard(page, "Kickoff", "Kickoff"); // single row (r1===r2 collapses to [selectedId] path)
  const after = await rowsByName(page);
  ok("C3 · outdenting an already-top-level row is a clean no-op (no throw, no change)", JSON.stringify(before) === JSON.stringify(after) && !page._errors.length);
}

{
  await freshPage(url, IO_FIXTURE);
  // C4 — MIXED multi-row outdent: select "Revisions & Final ALTA Delivery" (PI's last child,
  // depth>0, a root row) TOGETHER WITH "Next top-level task" (already depth 0) in one contiguous
  // range. Per-row policy: the depth>0 row promotes; the already-top-level row is left exactly
  // where it is — neither blocks the other.
  const before = await rowsByName(page);
  await outdentViaKeyboard(page, "Revisions & Final ALTA Delivery", "Next top-level task");
  const revLevel = await levelOf(page, "Revisions & Final ALTA Delivery");
  const piLevel = await levelOf(page, "PI");
  const altaLevel = await levelOf(page, "ALTA & Topo Survey");
  const nextLevel = await levelOf(page, "Next top-level task");
  ok("C4 · the depth>0 root row in a mixed selection promotes to become PI's own SIBLING (PI's parent's child)",
    revLevel === piLevel && revLevel > altaLevel, `rev=${revLevel} pi=${piLevel} alta=${altaLevel}`);
  ok("C4 · the already-depth-0 row in the SAME mixed selection is left untouched (no throw, no forced move)",
    nextLevel === altaLevel /* top-level rows share the root level */ && !page._errors.length);
}

// =================================================================================================
// SECTION D — SINGLE UNDO STEP for the whole multi-row operation
// =================================================================================================
{
  await freshPage(url, IO_FIXTURE);
  const before = await rowsByName(page);
  await indentViaKeyboard(page, "Field Work", "Revisions & Final ALTA Delivery"); // 4 rows move
  const afterIndent = await rowsByName(page);
  ok("D1 (setup) · the 4-row indent actually changed something", JSON.stringify(before) !== JSON.stringify(afterIndent));
  await page.locator('[data-task-row]').first().click(); // give the grid focus for Ctrl+Z
  await page.keyboard.press("Control+z");
  await pacedWait(page, 300);
  const afterUndo = await rowsByName(page);
  ok("D1 · ONE Ctrl+Z after a 4-row indent restores ALL FOUR rows (single undo step for the whole batch)",
    JSON.stringify(afterUndo) === JSON.stringify(before), "undo did not fully restore the pre-indent state");
}

{
  await freshPage(url, IO_FIXTURE);
  const before = await rowsByName(page);
  await outdentViaKeyboard(page, "Field Work", "Comments & Revisions"); // 3 rows move
  await page.locator('[data-task-row]').first().click();
  await page.keyboard.press("Control+z");
  await pacedWait(page, 300);
  const afterUndo = await rowsByName(page);
  ok("D2 · ONE Ctrl+Z after a 3-row outdent restores the pre-outdent state in one step",
    JSON.stringify(afterUndo) === JSON.stringify(before));
}

// =================================================================================================
// SECTION E — B463072-SHAPED LANDMINE: a leaf's typed duration when it becomes a parent, and back
// =================================================================================================
{
  await freshPage(url, IO_FIXTURE);
  // "Select Surveyor" is a LEAF with a typed duration of 3d (rendered "3d") before this op. Indent
  // "Field Work".."Revisions..." under it, making it a parent for the first time, and read its
  // duration cell — this MUST show the ROLLED span (its children's dates), never the stale 3d.
  const beforeDur = (await rowsByName(page)).find(r => r.name === "Select Surveyor").duration;
  ok("E1 (setup) · Select Surveyor reads its typed 3d duration before gaining children", beforeDur === "3d", beforeDur);
  await indentViaKeyboard(page, "Field Work", "Revisions & Final ALTA Delivery");
  const afterDur = (await rowsByName(page)).find(r => r.name === "Select Surveyor").duration;
  ok("E1 · once Select Surveyor becomes a PARENT, its duration cell shows a ROLLED span, not the stale leaf 3d",
    /\d+d$/.test(afterDur) && afterDur !== "3d", `now shows "${afterDur}" (B463072 already covers this — fmtTaskDuration reads isSummary)`);

  // Now outdent those same rows back out — Select Surveyor loses every child again (back to a
  // leaf). MEASURED, not assumed: does its duration snap back to something sane, or does the
  // stale durValue/durUnit (never touched by rollupParentDates while it WAS a parent) reassert a
  // number disconnected from what's on screen?
  await outdentViaKeyboard(page, "Field Work", "Revisions & Final ALTA Delivery");
  const afterOutdentDur = (await rowsByName(page)).find(r => r.name === "Select Surveyor").duration;
  console.log(`E1 FINDING · Select Surveyor's duration after losing every child again: "${afterOutdentDur}" (was "${beforeDur}" before ever gaining children, "${afterDur}" while it had them)`);
  ok("E1 · MEASURED: losing every child again restores the leaf's OWN typed duration cleanly — no B463072-shaped leftover, because cascadeDates re-derives a leaf's span from durValue/durUnit the moment it drops out of the parentIds set (nothing ever stales, since rollupParentDates never touched durValue/durUnit in the first place)",
    afterOutdentDur === beforeDur, `before=${beforeDur} afterOutdent=${afterOutdentDur}`);
}

// =================================================================================================
// SECTION E2 — HEALTH ROLLUP: a parent that gains or loses children ends up with the right rolled colour
// =================================================================================================
const HEALTH_FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Health Rollup Fixture", tasks: [
    // Future dates throughout so computeDisplayHealth's own overdue/due-soon promotion can't
    // interfere — every colour here comes from the STORED health, not the calendar.
    task({ id: 1, name: "Anchor Leaf", start: "2027-06-01", end: "2027-06-01", health: "gray" }),
    task({ id: 2, name: "Group", start: "2027-06-01", end: "2027-06-01" }),
    task({ id: 3, name: "Fine Child A", parentId: 2, start: "2027-06-01", end: "2027-06-01", health: "gray" }),
    task({ id: 4, name: "Fine Child B", parentId: 2, start: "2027-06-01", end: "2027-06-01", health: "gray" }),
    task({ id: 5, name: "Red Child", parentId: 2, start: "2027-06-01", end: "2027-06-01", health: "red" }),
  ]}},
};
async function collapseAndReadHealth(page, name) {
  await page.locator('[data-task-row]').filter({ hasText: name }).locator('span[title="Collapse"]').click();
  await pacedWait(page, 150);
  const rgb = await page.evaluate((n) => {
    const rows = [...document.querySelectorAll('[data-task-row]')];
    const row = rows.find(r => (r.querySelector('[data-col-key="name"]')?.innerText||"").replace(/^▾\s*|^▸\s*/,"").trim() === n);
    // The colored dot is the INNERMOST span inside [data-health-dot] (wrapped in a pointer-events:
    // none sizing span) — take the LAST span in document order, not the first, which is the
    // outer wrapper and carries no background of its own.
    const spans = row?.querySelectorAll('[data-health-dot] span') || [];
    const dot = spans[spans.length - 1];
    return dot ? getComputedStyle(dot).backgroundColor : null;
  }, name);
  return rgb;
}
const RED_RGB = "rgb(220, 38, 38)";
{
  await freshPage(url, HEALTH_FIXTURE);
  // E2a — GAINING a red descendant: indent "Fine Child B" and "Red Child" together (both
  // children of Group; topmost "Fine Child B" has a valid preceding sibling, "Fine Child A") so
  // they become children of "Fine Child A" instead. Fine Child A must now roll up to red.
  await indentViaKeyboard(page, "Fine Child B", "Red Child");
  const fineARgb = await collapseAndReadHealth(page, "Fine Child A");
  ok("E2a · a row that GAINS a red descendant via indent rolls up to red once collapsed",
    fineARgb === RED_RGB, `Fine Child A dot colour = ${fineARgb}`);
}
{
  await freshPage(url, HEALTH_FIXTURE);
  // E2b — LOSING the red child: outdent "Red Child" alone out of "Group" (Group keeps Fine Child
  // A/B, both gray) — Group's rolled health must improve to gray now that its worst-case child left.
  const groupRgbBefore = await collapseAndReadHealth(page, "Group");
  ok("E2b (setup) · Group starts red (worst-of-children, Red Child present)", groupRgbBefore === RED_RGB, groupRgbBefore);
  await page.locator('[data-task-row]').filter({ hasText: "Group" }).locator('span[title="Expand"]').click();
  await pacedWait(page, 150);
  await outdentViaKeyboard(page, "Red Child", "Red Child");
  const groupRgbAfter = await collapseAndReadHealth(page, "Group");
  ok("E2b · Group's rolled colour improves once its red child is outdented away (worst-of-CURRENT-children, not stale)",
    groupRgbAfter !== RED_RGB, `Group dot colour after = ${groupRgbAfter}`);
}

// =================================================================================================
// SECTION F — DELETE: leaf has no prompt; parent-with-children asks; equal-size buttons
// =================================================================================================
const DEL_FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Delete Fixture", tasks: [
    task({ id: 1, name: "ALTA & Topo Survey" }),
    task({ id: 2, name: "New task", parentId: 1 }),
    task({ id: 3, name: "Solicit ALTA/Topo Proposals", parentId: 2 }),
    task({ id: 4, name: "Select Surveyor", parentId: 2 }),
    task({ id: 5, name: "Field Work", parentId: 2 }),
    task({ id: 6, name: "Grandchild of Field Work", parentId: 5 }),          // multi-level subtree
    task({ id: 7, name: "Draft Review", parentId: 2 }),
    task({ id: 8, name: "Comments & Revisions", parentId: 2 }),
    task({ id: 9, name: "Revisions & Final ALTA Delivery", parentId: 2, isExpanded: false }), // has a hidden child
    task({ id: 10, name: "Hidden grandchild", parentId: 9 }),                // collapsed — invisible until expanded
    task({ id: 11, name: "Plain leaf, no children" }),
    task({ id: 12, name: "Next top-level task" }),
  ]}},
};

{
  page = await freshPage(url, DEL_FIXTURE);
  // F1 — deleting a LEAF (no children anywhere) must show NO prompt at all — immediate delete,
  // same as before this feature existed.
  const before = await rowsByName(page);
  await page.locator('[data-task-row]').filter({ hasText: "Plain leaf, no children" }).locator('[data-col-key="id"]').click({ button: "right" });
  await pacedWait(page, 150);
  await page.locator("i.ti-trash").locator("..").click();
  await pacedWait(page, 300);
  const modalUp = await page.locator('[data-delete-children-modal]').count();
  ok("F1 · deleting a LEAF shows NO confirmation prompt (no extra click)", modalUp === 0);
  const after = await rowsByName(page);
  ok("F1 · the leaf is actually gone", !after.some(r => r.name === "Plain leaf, no children") && before.some(r => r.name === "Plain leaf, no children"));
}

{
  page = await freshPage(url, DEL_FIXTURE);
  // F2 — deleting "New task" (a parent with 6 children, one of which has its own grandchild, one
  // of which has a COLLAPSED hidden child) via the CONTEXT MENU must show the prompt.
  await page.locator('[data-task-row]').filter({ hasText: "New task" }).locator('[data-col-key="id"]').click({ button: "right" });
  await pacedWait(page, 150);
  await page.locator("i.ti-trash").locator("..").click();
  await pacedWait(page, 250);
  const modal = page.locator('[data-delete-children-modal]');
  ok("F2 · deleting a PARENT WITH CHILDREN shows the confirmation prompt", (await modal.count()) === 1);

  // The true subtree here is: New task + 6 direct children + 1 grandchild (Field Work's) + 1
  // hidden grandchild (under the COLLAPSED "Revisions..." row) = 9 rows total, but only 6 direct
  // children are VISIBLE when the prompt appears (the collapsed one hides its own child).
  const cascadeBtn = page.locator('[data-delete-children-choice="cascade"]');
  const cascadeText = await cascadeBtn.innerText();
  ok("F2 · the prompt's total is the TRUE total including the COLLAPSED grandchild (9), not just the 6 visible children",
    /\b9\b/.test(cascadeText), `cascade button reads "${cascadeText}"`);

  // Equal-size buttons — his standing complaint about the OTHER modal in this file. Measure, don't assert in prose.
  const cancelBox = await page.locator('[data-delete-children-choice="cancel"]').boundingBox();
  const promoteBox = await page.locator('[data-delete-children-choice="promote"]').boundingBox();
  const cascadeBox = await cascadeBtn.boundingBox();
  // Tolerance matches this repo's OWN precedent for the OTHER modal (verify-successor-complete.mjs
  // EQUAL_WIDTH_TOLERANCE_PX=0.1) — a measured Blink LayoutUnit rounding artifact (±1/64 CSS px) on
  // independently-shrinking flex siblings, not a real size difference; nowhere close to what either
  // mutation below moves the delta by.
  const EQUAL_TOL = 0.1;
  ok("F2 · Cancel / Keep subtasks / Delete all render at the SAME size (measured via getBoundingClientRect, within Chromium's own sub-pixel rounding)",
    Math.abs(cancelBox.width - promoteBox.width) <= EQUAL_TOL && Math.abs(promoteBox.width - cascadeBox.width) <= EQUAL_TOL &&
    Math.abs(cancelBox.height - promoteBox.height) <= EQUAL_TOL && Math.abs(promoteBox.height - cascadeBox.height) <= EQUAL_TOL,
    `cancel=${JSON.stringify(cancelBox)} promote=${JSON.stringify(promoteBox)} cascade=${JSON.stringify(cascadeBox)}`);

  // Cancel does nothing, leaves the tree exactly as it was.
  const before = await rowsByName(page);
  await page.locator('[data-delete-children-choice="cancel"]').click();
  await pacedWait(page, 200);
  ok("F2 · Cancel closes the prompt and changes nothing", (await page.locator('[data-delete-children-modal]').count()) === 0 && JSON.stringify(await rowsByName(page)) === JSON.stringify(before));
}

{
  page = await freshPage(url, DEL_FIXTURE);
  // F3 — the CASCADE choice removes EXACTLY the true total (9 rows: New task + 6 children + 2
  // grandchildren, one of them hidden) — data-safety count, before vs after, nothing more and
  // nothing less vanishes.
  const before = await rowsByName(page); // note: this only sees EXPANDED rows; true count computed structurally below
  const trueCountBefore = 12; // fixture has 12 tasks total
  await page.locator('[data-task-row]').filter({ hasText: "New task" }).locator('[data-col-key="id"]').click({ button: "right" });
  await pacedWait(page, 150);
  await page.locator("i.ti-trash").locator("..").click();
  await pacedWait(page, 200);
  await page.locator('[data-delete-children-choice="cascade"]').click();
  await pacedWait(page, 300);
  const after = await rowsByName(page);
  ok("F3 · cascade removes 'New task' AND all 8 of its descendants (visible + the collapsed one) — 3 rows survive",
    after.length === 3 && after.some(r => r.name === "ALTA & Topo Survey") && after.some(r => r.name === "Plain leaf, no children") && after.some(r => r.name === "Next top-level task"),
    JSON.stringify(after));
  // Single undo restores everything, including the row that was never visible (collapsed).
  await page.locator('[data-task-row]').first().click();
  await page.keyboard.press("Control+z");
  await pacedWait(page, 300);
  const afterUndo = await rowsByName(page);
  ok("F3 · ONE Ctrl+Z restores the cascade-deleted subtree completely (single undo step)",
    afterUndo.length === before.length, `before=${before.length} afterUndo=${afterUndo.length}`);
}

{
  page = await freshPage(url, DEL_FIXTURE);
  // F4 — the PROMOTE choice: "New task"'s 6 children move up to ITS parent ("ALTA & Topo Survey"),
  // keeping their order and relative depth — "Grandchild of Field Work" stays under "Field Work"
  // (multi-level subtree preserved), and the collapsed "Hidden grandchild" survives too.
  await page.locator('[data-task-row]').filter({ hasText: "New task" }).locator('[data-col-key="id"]').click({ button: "right" });
  await pacedWait(page, 150);
  await page.locator("i.ti-trash").locator("..").click();
  await pacedWait(page, 200);
  await page.locator('[data-delete-children-choice="promote"]').click();
  await pacedWait(page, 300);
  const after = await rowsByName(page);
  ok("F4 · 'New task' itself is gone", !after.some(r => r.name === "New task"));
  ok("F4 · EXACTLY 'New task' is gone — every one of its 6 direct children (and their own descendants) survives",
    ["Solicit ALTA/Topo Proposals","Select Surveyor","Field Work","Grandchild of Field Work","Draft Review","Comments & Revisions","Revisions & Final ALTA Delivery"]
      .every(n => after.some(r => r.name === n)));
  const altaLevel = await levelOf(page, "ALTA & Topo Survey");
  const solicitLevel = await levelOf(page, "Solicit ALTA/Topo Proposals");
  const fieldLevel = await levelOf(page, "Field Work");
  const grandchildLevel = await levelOf(page, "Grandchild of Field Work");
  ok("F4 · promoted children now sit one level under ALTA & Topo Survey (the deleted row's OWN parent)", solicitLevel > altaLevel && fieldLevel === solicitLevel);
  ok("F4 · the multi-level subtree's relative depth is preserved (grandchild still one level under Field Work)",
    grandchildLevel - fieldLevel > 0, `field=${fieldLevel} grandchild=${grandchildLevel}`);
  const order = after.map(r => r.name);
  ok("F4 · promoted children keep their original relative ORDER",
    order.indexOf("Solicit ALTA/Topo Proposals") < order.indexOf("Select Surveyor") &&
    order.indexOf("Select Surveyor") < order.indexOf("Field Work") &&
    order.indexOf("Comments & Revisions") < order.indexOf("Revisions & Final ALTA Delivery"));
  // Single undo restores the exact pre-delete tree, including "New task" itself.
  await page.locator('[data-task-row]').first().click();
  await page.keyboard.press("Control+z");
  await pacedWait(page, 300);
  const afterUndo = await rowsByName(page);
  ok("F4 · ONE Ctrl+Z restores 'New task' and the original structure in one step", afterUndo.some(r => r.name === "New task"));
}

{
  page = await freshPage(url, DEL_FIXTURE);
  // F5 — a multi-row selection that includes BOTH a parent AND one of its own children: select
  // "New task" through "Field Work" (parent + its first 2 children). Cascade must remove exactly
  // that whole selection's transitive closure; nothing outside it is touched.
  const before = await rowsByName(page);
  const rows = await rowsByName(page);
  const ids = await liveIds(page, ["New task", "Field Work"]);
  await selectRowRangeByIdColumn(page, ids["New task"], ids["Field Work"], rows);
  await page.locator(`[data-task-row="${ids["Field Work"]}"] [data-col-key="id"]`).click({ button: "right" });
  await pacedWait(page, 150);
  await page.locator("i.ti-trash").locator("..").click();
  await pacedWait(page, 250);
  ok("F5 · a selection spanning a parent + its own child still shows the prompt", (await page.locator('[data-delete-children-modal]').count()) === 1);
  await page.locator('[data-delete-children-choice="cascade"]').click();
  await pacedWait(page, 300);
  const after = await rowsByName(page);
  // New task + Solicit + Select Surveyor + Field Work + Grandchild-of-Field-Work + Draft Review +
  // Comments & Revisions + Revisions...+hidden = same 9 rows as F3 (Draft/Comments/Revisions were
  // NOT explicitly selected, but they ARE New task's children, so cascade-deleting New task takes
  // them too — same semantics as deleting New task alone).
  ok("F5 · cascade-deleting a parent+child selection removes the parent's WHOLE subtree, nothing extra",
    after.length === 3, JSON.stringify(after));
}

// =================================================================================================
// SECTION G — MUTATION PROOFS: each fix disabled independently, the SAME check goes red, controls stay green
// =================================================================================================
async function runMutation(needle, replacement, label, testFn) {
  if (!realBody.includes(needle)) { ok(`${label} · mutation target found in source`, false); return; }
  const mutated = realBody.replace(needle, replacement);
  const { server: ms, url: murl } = await makeServer(mutated);
  const mpage = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  mpage._errors = [];
  mpage.on("pageerror", e => mpage._errors.push(e.message));
  await bootAndImport(mpage, murl, IO_FIXTURE);
  await testFn(mpage, label);
  await mpage.close();
  ms.close();
}

await runMutation(
  "if (!e.repeat && selectedId !== null) indentSelectionByIds(structuralTargets(selectedId));",
  "if (!e.repeat && selectedId !== null) indentSelectionByIds([selectedId]);",
  "G1 (keyboard indent reverted to single-anchor)",
  async (mpage) => {
    const rows = await mpage.evaluate(() => [...document.querySelectorAll('[data-task-row]')].map(r => ({ id: Number(r.getAttribute('data-task-row')), name: (r.querySelector('[data-col-key="name"]')?.innerText || "").replace(/^▾\s*|^▸\s*/, "").trim() })));
    const idsMap = {}; rows.forEach(r => { idsMap[r.name] = r.id; });
    const topBox = await mpage.locator(`[data-task-row="${idsMap["Field Work"]}"] [data-col-key="id"]`).boundingBox();
    const botBox = await mpage.locator(`[data-task-row="${idsMap["Revisions & Final ALTA Delivery"]}"] [data-col-key="id"]`).boundingBox();
    await mpage.mouse.move(topBox.x + 5, topBox.y + 5); await mpage.mouse.down();
    await mpage.mouse.move(botBox.x + 5, botBox.y + 5, { steps: 5 }); await mpage.mouse.up();
    await pacedWait(mpage, 150);
    await mpage.keyboard.press("Alt+Shift+ArrowRight");
    await pacedWait(mpage, 300);
    const levels = await Promise.all(["Field Work","Draft Review","Comments & Revisions","Revisions & Final ALTA Delivery"].map(n => mpage.evaluate((name) => {
      const rows = [...document.querySelectorAll('[data-task-row]')];
      for (const r of rows) { const nc = r.querySelector('[data-col-key="name"] > span'); const nameCell = r.querySelector('[data-col-key="name"]'); if (nameCell && nameCell.innerText.replace(/^▾\s*|^▸\s*/,"").trim() === name) return nc ? parseFloat(getComputedStyle(nc).paddingLeft) : null; }
      return null;
    }, n)));
    ok("G1 · MUTATION (single-anchor reverted): the 4-row selection no longer moves together — levels diverge, as expected",
      !(levels.every(l => l === levels[0])), JSON.stringify(levels));
  }
);

// G2: give the cascade button its own extra width, defeating the shared-object equality.
{
  const NEEDLE = 'style={{...FOOTER_BTN_STYLE, border:\'1px solid #dc2626\', background:\'#dc2626\', color:\'#fff\'}}>\n            Delete all {totalCount}';
  if (!realBody.includes(NEEDLE)) {
    ok("G2 · equal-size mutation target found in source", false);
  } else {
    const mutated = realBody.replace(NEEDLE, 'style={{...FOOTER_BTN_STYLE, minWidth:220, border:\'1px solid #dc2626\', background:\'#dc2626\', color:\'#fff\'}}>\n            Delete all {totalCount}');
    const { server: ms, url: murl } = await makeServer(mutated);
    const mpage = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    await bootAndImport(mpage, murl, DEL_FIXTURE);
    await mpage.locator('[data-task-row]').filter({ hasText: "New task" }).locator('[data-col-key="id"]').click({ button: "right" });
    await pacedWait(mpage, 150);
    await mpage.locator("i.ti-trash").locator("..").click();
    await pacedWait(mpage, 250);
    const cancelBox = await mpage.locator('[data-delete-children-choice="cancel"]').boundingBox();
    const cascadeBox = await mpage.locator('[data-delete-children-choice="cascade"]').boundingBox();
    ok("G2 · MUTATION (cascade button given minWidth:220): the three buttons are now visibly UNEQUAL, as expected",
      cascadeBox.width !== cancelBox.width, `cancel=${cancelBox.width} cascade=${cascadeBox.width}`);
    await mpage.close(); ms.close();
  }
}

{
  const NEEDLE = '  const survivingAncestor = (parentId) => {\n    let cur = parentId;\n    while (cur !== null && cur !== undefined && delSet.has(cur)) cur = byId.get(cur)?.parentId ?? null;\n    return cur ?? null;\n  };';
  if (!realBody.includes(NEEDLE)) {
    ok("G3 · transitive-walk mutation target found in source", false);
  } else {
    const mutated = realBody.replace(NEEDLE, '  const survivingAncestor = (parentId) => (delSet.has(parentId) ? null : parentId);');
    const { server: ms, url: murl } = await makeServer(mutated);
    const mpage = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    await bootAndImport(mpage, murl, DEL_FIXTURE);
    // Select "New task" AND "Field Work" together (parent + child, both deleted) with the PROMOTE
    // choice — "Grandchild of Field Work" should promote past BOTH deleted ancestors to "ALTA &
    // Topo Survey". With the mutation it can only see past ONE level, landing on the deleted
    // "Field Work" (parentId now null) instead of nesting under ALTA.
    const rows = await mpage.evaluate(() => [...document.querySelectorAll('[data-task-row]')].map(r => ({ id: Number(r.getAttribute('data-task-row')), name: (r.querySelector('[data-col-key="name"]')?.innerText || "").replace(/^▾\s*|^▸\s*/, "").trim() })));
    const idsMap = {}; rows.forEach(r => { idsMap[r.name] = r.id; });
    const topBox = await mpage.locator(`[data-task-row="${idsMap["New task"]}"] [data-col-key="id"]`).boundingBox();
    const botBox = await mpage.locator(`[data-task-row="${idsMap["Field Work"]}"] [data-col-key="id"]`).boundingBox();
    await mpage.mouse.move(topBox.x + 5, topBox.y + 5); await mpage.mouse.down();
    await mpage.mouse.move(botBox.x + 5, botBox.y + 5, { steps: 5 }); await mpage.mouse.up();
    await pacedWait(mpage, 150);
    await mpage.locator(`[data-task-row="${idsMap["Field Work"]}"] [data-col-key="id"]`).click({ button: "right" });
    await pacedWait(mpage, 150);
    await mpage.locator("i.ti-trash").locator("..").click();
    await pacedWait(mpage, 200);
    await mpage.locator('[data-delete-children-choice="promote"]').click();
    await pacedWait(mpage, 300);
    const altaSpan = await mpage.evaluate(() => {
      const els = [...document.querySelectorAll('[data-task-row]')];
      const alta = els.find(r => (r.querySelector('[data-col-key="name"]')?.innerText||"").includes("ALTA & Topo Survey"));
      const gc = els.find(r => (r.querySelector('[data-col-key="name"]')?.innerText||"").includes("Grandchild of Field Work"));
      if (!alta || !gc) return null;
      const nc = a => a.querySelector('[data-col-key="name"] > span');
      return { alta: nc(alta) ? parseFloat(getComputedStyle(nc(alta)).paddingLeft) : null, gc: nc(gc) ? parseFloat(getComputedStyle(nc(gc)).paddingLeft) : null };
    });
    ok("G3 · MUTATION (transitive walk reverted): the grandchild no longer nests correctly under the surviving ancestor",
      !altaSpan || altaSpan.gc === null || altaSpan.gc <= altaSpan.alta, JSON.stringify(altaSpan));
    await mpage.close(); ms.close();
  }
}

server.close();
if (page) await page.close();
await browser.close();

const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
