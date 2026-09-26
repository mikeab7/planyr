/* verify-notes-table-click — NEW-1, 2026-09-26. Owner report, verbatim: "I can't even interact
 * with the table that I placed on the notebook module... it seems like it's only taking my
 * double clicks to be like the double click canvas tool. But if it's on a table... a double
 * click should hit the table, not the other canvas tool."
 *
 * ⛔ ROOT CAUSE. The Notes page is a pure placement surface (NOTES-CARRY-FORWARD's NEW-1,
 * 2026-09-22): every mousedown that does not land on a `.planyr-anchor` box (or a picture/file,
 * the one existing exemption) is read by `focusFromMat` as BLANK CANVAS, where a stationary
 * double-click creates a NEW box. `NoteToolbar.jsx`'s table insert (the grid picker and the "+"
 * menu) used to call `insertTable()` at whatever the editor's CURRENT SELECTION happened to be,
 * with no check that the selection was inside a box — and on a page nothing has been clicked
 * into yet, that selection defaults to the document's own top-level trailing paragraph: real to
 * ProseMirror, but unreachable by any click (`focusFromMat` never focuses it). A table inserted
 * there sits outside the box model entirely, and — before this fix — `focusFromMat`'s content
 * guard did not recognise a bare table either, so every subsequent press on it read as blank
 * canvas: exactly his report.
 *
 * ⛔ TWO FIXES, BOTH EXERCISED HERE, EITHER ONE OF WHICH ALONE WOULD HAVE MADE THE BUG
 * UNREACHABLE — but a legacy document or a future insertion path can still put a table at the
 * top level, so both stay in place together:
 *   (1) `NoteToolbar.jsx`'s table-insert paths (`insertTableSmart`) now check
 *       `selectionInsideAnchor` (notesAnchorNode.js) first, and create a box (`addNoteAnchorAt`)
 *       before inserting whenever nothing is already focused — a table can no longer be CREATED
 *       outside a box from the toolbar or the "+" menu.
 *   (2) `focusFromMat`'s content guard (NoteEditor.jsx) now also recognises a bare
 *       `table`/`.tableWrapper` as content, never blank canvas — a safety net for whatever else
 *       might put one at the top level (a legacy document not yet reopened; some path this file's
 *       own section 4 does not anticipate). `notesFlowMigration.js`'s existing, unconditional
 *       on-read migration already folds any top-level table into a box the next time the page is
 *       OPENED — section 5 here proves that continues to work, unchanged.
 *
 * ⛔ RED-PROOFED against the pre-fix build (measured, not asserted): 14/37 checks fail there —
 * every check in sections 1, 2, 4 and 6 that exercises either fix, plus none in section 3 (the
 * right-click menu is wired independently of the placement guard, via `onContextMenu`'s own
 * `.closest("table")` read, and already worked) or section 5 (`notesFlowMigration.js`'s existing,
 * unconditional on-read migration was untouched by this round and already worked). 23/37 pass on
 * the pre-fix build for the same reason: several sub-checks in 1/2/4/6 test things this round did
 * not change (Tab navigation once inside a table, the "no box on typing" property, etc.) and hold
 * either way.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const pageKey = (id) => `planyr:notes:page:v1:local:${id}`;

let pass = 0; let fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

async function seedTree(page, pages) {
  await page.evaluate(([tk, ps]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: ps.map((p) => ({ id: p.id, title: p.title, createdAt: 1, updatedAt: 1, projectId: null, pages: [] })),
    }));
  }, [TREE_KEY, pages]);
}

/** Every fixture here seeds exactly ONE page, so `Notes.jsx`'s own "no stored active page yet"
 *  fallback (`firstPageId(loaded)`) always lands on it — nothing here depends on rail order. */
async function openNote(pages) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await assertMeasurable(page, "verify-notes-table-click");
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await seedTree(page, pages);
  for (const p of pages) {
    if (p.doc) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [pageKey(p.id), p.doc]);
    }
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 500);
  return { page, errs };
}

function boxCount(page) { return page.locator(".planyr-anchor").count(); }

async function storedDoc(page, id) {
  const raw = await page.evaluate((k) => localStorage.getItem(k), pageKey(id));
  return raw ? JSON.parse(raw) : null;
}

/** Poll the stored page until `pred(doc)` is true or the timeout elapses — the save is on a
 *  600ms debounce (`SAVE_DEBOUNCE_MS`, NoteEditor.jsx), so a fixed wait guesses; this doesn't. */
async function waitForStored(page, id, pred, timeoutMs = 4000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    last = await storedDoc(page, id);
    if (last && pred(last)) return last;
    // eslint-disable-next-line no-await-in-loop
    await pacedWait(page, 150);
  }
  return last;
}

function collect(node, type, found = []) {
  if (!node || typeof node !== "object") return found;
  if (node.type === type) found.push(node);
  (node.content || []).forEach((c) => collect(c, type, found));
  return found;
}

const tableInsideAnchor = (doc) => (doc.content || []).some((n) => n.type === "noteAnchor" && collect(n, "table").length > 0);
const tableAtTopLevel = (doc) => (doc.content || []).some((n) => n.type === "table");
const anchorCountInDoc = (doc) => (doc.content || []).filter((n) => n.type === "noteAnchor").length;
const docText = (doc) => collect(doc, "text").map((n) => n.text).join(" ");

/** Is the live caret sitting inside a table cell? Read off the real DOM selection, never PM
 *  state — this is what a click actually produced, not what the app claims. */
const caretInCell = (page) => page.evaluate(() => {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const node = sel.getRangeAt(0).startContainer;
  const el = node.nodeType === 3 ? node.parentElement : node;
  return !!el?.closest("td, th");
});

const selectedText = (page) => page.evaluate(() => (document.getSelection()?.toString() || ""));

const cellRect = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, sel);

/** ⛔ THE POINT MUST BE OVER THE WORD, NOT MERELY OVER THE CELL. A cell is wider than its own
 *  short word (a table column floors at 100px, per notesTableWidth.js), so the cell's overall
 *  centre often lands in empty padding — a double-click there selects nothing, which nearly
 *  became a false "word-select is broken" finding here. Range over the exact text node. */
const wordCenter = (page, word) => page.evaluate((w) => {
  const walker = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const i = node.textContent.indexOf(w);
    if (i === -1) continue;
    const range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + w.length);
    const r = range.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }
  return null;
}, word);

const TABLE_2X2_HEADER = { type: "table", content: [
  { type: "tableRow", content: [
    { type: "tableHeader", content: [{ type: "paragraph", content: [] }] },
    { type: "tableHeader", content: [{ type: "paragraph", content: [] }] },
  ] },
  { type: "tableRow", content: [
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Zulu" }] }] },
    { type: "tableCell", content: [{ type: "paragraph", content: [] }] },
  ] },
] };

console.log("\n0 · KNOWN-GOOD ARM — double-click blank canvas, type a character, get a box");
console.log("  (a press only ARMS a caret — NEW-8 — the first keystroke is what COMMITS it; this");
console.log("  proves the box-count instrument used below can actually detect a real creation)");
{
  const { page } = await openNote([{ id: "p0", title: "Control" }]);
  ok("starts with zero boxes", await boxCount(page) === 0);
  const blank = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
    return { x: Math.round(r.left + 60), y: Math.round(r.top + 260) };   // clear of the title band
  });
  await page.mouse.dblclick(blank.x, blank.y);
  await pacedWait(page, 150);
  ok("a double-click alone (no keystroke yet) creates NOTHING (NEW-8)", await boxCount(page) === 0);
  await page.keyboard.type("Q");
  await pacedWait(page, 150);
  ok("⛔ the first keystroke commits a real box (instrument sanity check)", await boxCount(page) === 1);
  await page.close();
}

console.log("\n1 · THE REPORTED REPRO — insert a table from the toolbar grid picker on a page");
console.log("    where nothing is focused; it must land INSIDE a box, not at the top level");
{
  const { page } = await openNote([{ id: "p1", title: "TableClick" }]);
  ok("starts with zero boxes", await boxCount(page) === 0);

  await page.locator('[data-testid="nt-table"]').click();
  await page.waitForSelector('[data-testid="nt-table-cell-2-2"]');
  await page.locator('[data-testid="nt-table-cell-2-2"]').click();
  await page.waitForSelector(".ProseMirror table", { timeout: 10000 });
  await pacedWait(page, 200);

  ok("exactly one box now exists", await boxCount(page) === 1, `count=${await boxCount(page)}`);
  ok("the table lives inside that box, in the DOM", await page.locator(".planyr-anchor table").count() === 1);
  ok("⛔ no table sits directly on the sheet, outside any box", await page.locator('[data-testid="note-body"] > table').count() === 0);

  const doc = await waitForStored(page, "p1", (d) => tableInsideAnchor(d) || tableAtTopLevel(d));
  ok("stored document: the table is nested inside a noteAnchor box", tableInsideAnchor(doc), JSON.stringify(doc.content?.map((n) => n.type)));
  ok("⛔ stored document: the table is NOT a top-level sibling", !tableAtTopLevel(doc));
  ok("stored document: still exactly one top-level box", anchorCountInDoc(doc) === 1, `boxes=${anchorCountInDoc(doc)}`);

  console.log("\n2 · THE CELL BEHAVES LIKE ANY OTHER CELL — click/dblclick never place a box,");
  console.log("    the caret goes in, typing lands in the model, dblclick selects the word, Tab moves cells");
  console.log("    (the box was just CREATED by the toolbar, never yet mouse-selected — so the FIRST");
  console.log("    physical click on it is Stage 1 of the pre-existing OneNote-style select-then-enter");
  console.log("    box model, B434416: it SELECTS the box, exactly as it would for a plain text box.");
  console.log("    That is not this bug — the bug is what used to happen instead: nothing selected,");
  console.log("    a NEW box created. A second click then enters it, matching the report's own repro");
  console.log('    steps, "Click, then double-click, inside a cell.")');

  const cell0 = await cellRect(page, ".ProseMirror table td");
  await page.mouse.click(cell0.x, cell0.y);
  await pacedWait(page, 120);
  ok("first click on the never-yet-selected box: box count unchanged (no new box)", await boxCount(page) === 1);
  ok("⛔ first click SELECTS the box (Stage 1) rather than falling through to blank-canvas placement",
    await page.locator(".planyr-anchor[data-selected=\"1\"]").count() === 1);

  await page.mouse.click(cell0.x, cell0.y);
  await pacedWait(page, 120);
  ok("second click (Stage 2) box count unchanged", await boxCount(page) === 1);
  ok("second click ENTERS the box and places the caret in the clicked cell", await caretInCell(page));

  await page.keyboard.type("Alpha");
  const typed = await waitForStored(page, "p1", (d) => docText(d).includes("Alpha"));
  ok("typed text lands in the cell in the stored document", docText(typed).includes("Alpha"), docText(typed));
  ok("box count still unchanged after typing", await boxCount(page) === 1);

  const alphaWord = await wordCenter(page, "Alpha");
  await page.mouse.dblclick(alphaWord.x, alphaWord.y);
  await pacedWait(page, 120);
  ok("⛔ double click IN THE CELL never creates a new box (the reported defect)", await boxCount(page) === 1, `count=${await boxCount(page)}`);
  ok("double click on the cell's word selects that word", (await selectedText(page)).trim() === "Alpha", `selected="${(await selectedText(page)).trim()}"`);

  const beforeTabCell = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".ProseMirror table td, .ProseMirror table th")];
    const sel = document.getSelection();
    const el = sel?.anchorNode ? (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode) : null;
    const cell = el?.closest("td, th");
    return cells.indexOf(cell);
  });
  await page.keyboard.press("Tab");
  await pacedWait(page, 120);
  const afterTabCell = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".ProseMirror table td, .ProseMirror table th")];
    const sel = document.getSelection();
    const el = sel?.anchorNode ? (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode) : null;
    const cell = el?.closest("td, th");
    return cells.indexOf(cell);
  });
  ok("Tab moves the selection to the next cell", afterTabCell === beforeTabCell + 1, `${beforeTabCell} → ${afterTabCell}`);
  ok("box count unchanged after Tab", await boxCount(page) === 1);

  console.log("\n3 · THE RIGHT-CLICK MENU STILL OFFERS TABLE ACTIONS");
  const cellForMenu = await cellRect(page, ".ProseMirror table td");
  await page.mouse.click(cellForMenu.x, cellForMenu.y, { button: "right" });
  await pacedWait(page, 150);
  const menuText = await page.evaluate(() => document.body.innerText);
  ok('the document menu offers "Convert table to text"', menuText.includes("Convert table to text"));
  await page.keyboard.press("Escape");
  await page.close();
}

console.log("\n4 · THE SAFETY NET — a table that reaches the TOP LEVEL some other way is still");
console.log("    content, never blank canvas (drives focusFromMat's content guard directly, independent");
console.log("    of the toolbar fix in section 1)");
{
  const { page } = await openNote([{ id: "p4", title: "GuardOnly" }]);
  const inserted = await page.evaluate((table) => window.__noteEditor?.runCommand("insertContentAt", 0, table), TABLE_2X2_HEADER);
  ok("the synthetic top-level table was actually inserted", !!inserted);
  await page.waitForSelector(".ProseMirror table", { timeout: 10000 });
  await pacedWait(page, 200);
  ok("⛔ it really did land OUTSIDE any box (the state this section exists to test)", await boxCount(page) === 0);

  const zuluWord = await wordCenter(page, "Zulu");
  await page.mouse.click(zuluWord.x, zuluWord.y);
  await pacedWait(page, 120);
  ok("⛔ a single click on the top-level table's cell places the caret in it, not blank canvas", await caretInCell(page));
  ok("single click creates no box", await boxCount(page) === 0);

  await page.mouse.dblclick(zuluWord.x, zuluWord.y);
  await pacedWait(page, 120);
  ok("⛔ THE CORE FIX: a double click on a top-level table's cell does NOT create a new box", await boxCount(page) === 0, `count=${await boxCount(page)}`);
  ok("⛔ and it selects the cell's word instead, exactly like an ordinary boxed table", (await selectedText(page)).trim() === "Zulu", `selected="${(await selectedText(page)).trim()}"`);
  await page.close();
}

console.log("\n5 · THE MIGRATED FORM — a legacy/loose top-level table is folded into a box on the");
console.log("    NEXT OPEN (notesFlowMigration.js, unchanged by this round), and behaves normally there");
{
  const legacyDoc = { type: "doc", content: [TABLE_2X2_HEADER, { type: "paragraph" }] };
  const { page } = await openNote([{ id: "p5", title: "Legacy", doc: legacyDoc }]);
  ok("on open, the legacy top-level table is migrated into exactly one box", await boxCount(page) === 1, `count=${await boxCount(page)}`);
  ok("the table itself is preserved inside that box", await page.locator(".planyr-anchor table").count() === 1);

  const zuluWord = await wordCenter(page, "Zulu");
  // Same as section 2: this box has never been mouse-selected (it arrived via migration, not a
  // click), so the first press is Stage 1 of the pre-existing select-then-enter box model.
  await page.mouse.click(zuluWord.x, zuluWord.y);
  await pacedWait(page, 120);
  ok("first click on the migrated box selects it, creates no box", await boxCount(page) === 1);
  await page.mouse.dblclick(zuluWord.x, zuluWord.y);
  await pacedWait(page, 120);
  ok("double click in the migrated table's cell creates no second box", await boxCount(page) === 1);
  ok("and selects its word", (await selectedText(page)).trim() === "Zulu");
  await page.close();
}

console.log("\n6 · WHILE PANNED AND ZOOMED — the same click/dblclick behaviour holds once the");
console.log("    canvas has been moved and scaled (the guard is DOM-structural, never coordinate math,");
console.log("    but this proves it rather than assuming it)");
{
  const { page } = await openNote([{ id: "p6", title: "PanZoom" }]);
  await page.evaluate((table) => window.__noteEditor?.runCommand("insertContentAt", 0, table), TABLE_2X2_HEADER);
  await page.waitForSelector(".ProseMirror table", { timeout: 10000 });
  await pacedWait(page, 200);

  const readTableWidth = () => page.evaluate(() => document.querySelector(".ProseMirror table")?.getBoundingClientRect().width || 0);
  const widthBefore = await readTableWidth();

  const mat = await page.$('[data-testid="note-mat"]');
  const box = await mat.boundingBox();
  const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
  /* ⛔ MODEST, DELIBERATELY. A first draft zoomed with one big -400 wheel tick (≈2.7×) and pushed
   * the table's on-screen position into the LEFT RAIL's own screen area — `elementFromPoint` at
   * the computed word centre then resolved to `notes-group-none` (the rail), not the table, and
   * every click "failed" for a reason that had nothing to do with the guard being tested. A
   * measurement bug in the test, not the app (WRONG-CASE: test the case that is actually there). */
  await page.mouse.move(cx, cy);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await pacedWait(page, 150);
  await page.mouse.wheel(30, 20);
  await pacedWait(page, 150);

  const widthAfter = await readTableWidth();
  ok("⛔ vacuity guard: the zoom gesture actually scaled the canvas (rendered table width changed)",
    Math.abs(widthAfter - widthBefore) > 5, `${widthBefore.toFixed(1)}px → ${widthAfter.toFixed(1)}px`);

  const zuluWord = await wordCenter(page, "Zulu");
  const matBoxNow = await mat.boundingBox();
  const wordOnScreen = zuluWord && matBoxNow
    && zuluWord.x >= matBoxNow.x && zuluWord.x <= matBoxNow.x + matBoxNow.width
    && zuluWord.y >= matBoxNow.y && zuluWord.y <= matBoxNow.y + matBoxNow.height;
  ok("⛔ known-good precondition: the word is still inside the mat's own visible area after pan/zoom (else the click below would be judging the wrong element)",
    wordOnScreen, JSON.stringify({ zuluWord, matBoxNow }));
  await page.mouse.click(zuluWord.x, zuluWord.y);
  await pacedWait(page, 120);
  ok("single click still places the caret in the cell, panned/zoomed", await caretInCell(page));
  await page.mouse.dblclick(zuluWord.x, zuluWord.y);
  await pacedWait(page, 120);
  ok("⛔ double click still selects the word rather than creating a box, panned/zoomed", (await selectedText(page)).trim() === "Zulu");
  ok("box count still zero, panned/zoomed", await boxCount(page) === 0);
  await page.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);
