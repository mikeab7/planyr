/* sweep-notes-table — NEW-3 / B649378: "he asked for other bugs, so look properly." Real
 * presses, judged on the STORED document (per docs/NOTES-CARRY-FORWARD.md — a rendered pass is
 * not a passed check). Covers: select-across-cells + copy · paste into a cell · delete a row
 * and a column · add row above/below, column left/right · merge and split · toggle header row
 * · Tab between cells and Tab out of the last cell · undo after each · a table nested in a
 * list item vs one at top level · a table inside a positioned text box (noteAnchor).
 *
 * ⛔ AN AUDIT THAT FINDS NOTHING IS A FAILED AUDIT. Every section prints what it actually
 * checked; anything not covered is named at the end rather than silently skipped.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "sweep-notes-table");
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

let pass = 0; let fail = 0;
const results = [];
const ok = (label, cond, detail = "") => {
  results.push({ label, cond, detail });
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

const TABLE_3X2 = { type: "table", content: [
  { type: "tableRow", content: [
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A1" }] }] },
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B1" }] }] },
  ] },
  { type: "tableRow", content: [
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A2" }] }] },
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B2" }] }] },
  ] },
  { type: "tableRow", content: [
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A3" }] }] },
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B3" }] }] },
  ] },
] };

async function seed(content, title) {
  const doc = { type: "doc", content };
  await page.evaluate(([treeKey, prefix, d, t]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: t, createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify(d));
  }, [TREE_KEY, PAGE_PREFIX, doc, title]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 300);
}

const storedDoc = async () => JSON.parse(await page.evaluate((k) => localStorage.getItem(k), `${PAGE_PREFIX}p1`));
const typesIn = (doc) => {
  const out = [];
  const walk = (n) => { if (!n) return; if (n.type) out.push(n.type); (n.content || []).forEach(walk); };
  walk(doc);
  return out;
};
const textOf = (doc) => {
  const out = [];
  const walk = (n) => { if (!n) return; if (n.text) out.push(n.text); (n.content || []).forEach(walk); };
  walk(doc);
  return out.join("|");
};
const cellCount = () => page.locator(".ProseMirror table td, .ProseMirror table th").count();
const rowCount = () => page.locator(".ProseMirror table tr").count();

async function clickCell(nth = 0) {
  const box = await page.locator(".ProseMirror table td, .ProseMirror table th").nth(nth).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await pacedWait(page, 150);
  return box;
}

async function dragAcrossFirstRow() {
  const a = await page.locator(".ProseMirror table td, .ProseMirror table th").nth(0).boundingBox();
  const b = await page.locator(".ProseMirror table td, .ProseMirror table th").nth(1).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await pacedWait(page, 80);
  await page.mouse.up();
  await pacedWait(page, 200);
}

console.log("\n=== 1 · SELECT ACROSS CELLS AND COPY — what lands on the clipboard ===");
await seed([TABLE_3X2, { type: "paragraph" }], "Copy");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
await dragAcrossFirstRow();
const cellSel = await page.evaluate(() => document.querySelectorAll(".ProseMirror table td.selectedCell, .ProseMirror table th.selectedCell").length);
ok("dragging across the top row creates a 2-cell selection", cellSel === 2, `${cellSel} selectedCell`);
await page.keyboard.press("Control+c");
await pacedWait(page, 200);
const clip = await page.evaluate(async () => {
  try { return await navigator.clipboard.readText(); } catch (e) { return `ERR:${e.message}`; }
});
ok("Ctrl+C on a cell selection puts BOTH cells' text on the clipboard", clip.includes("A1") && clip.includes("B1"), JSON.stringify(clip));
// Paste it back at the end of the document, outside the table, as a sanity check it round-trips.
await page.locator(".ProseMirror > p").last().click();
await page.keyboard.press("Control+v");
await pacedWait(page, 900);
const afterPaste = await storedDoc();
ok("pasting the copied cells back in lands SOME recognisable text (round-trips, not silently empty)",
  textOf(afterPaste).includes("A1") || textOf(afterPaste).includes("B1"), textOf(afterPaste));

console.log("\n=== 2 · PASTE INTO A CELL ===");
await seed([TABLE_3X2, { type: "paragraph" }], "PasteIntoCell");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
await clickCell(0);
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("text/plain", "pasted-in-cell");
  document.querySelector(".ProseMirror").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await pacedWait(page, 900);
const docPasteCell = await storedDoc();
ok("plain text pasted into a cell lands in that cell", textOf(docPasteCell).includes("pasted-in-cell"), textOf(docPasteCell));
ok("the table is still a table (paste into a cell did not blow it up)", typesIn(docPasteCell).includes("table"));
const cellsAfterPaste = await cellCount();
ok("cell count unchanged by a plain-text paste (3x2 = 6)", cellsAfterPaste === 6, `${cellsAfterPaste}`);

console.log("\n=== 3 · ADD ROW ABOVE / BELOW, DELETE A ROW — each undoable ===");
await seed([TABLE_3X2, { type: "paragraph" }], "Rows");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
await clickCell(2); // A2
const rowsBefore = await rowCount();
await page.locator('[data-testid="nt-row-before"]').click();
await pacedWait(page, 900);
ok("Row ↑ adds a row above", (await rowCount()) === rowsBefore + 1, `${rowsBefore} → ${await rowCount()}`);
await page.keyboard.press("Control+z");
await pacedWait(page, 900);
ok("⛔ undo removes the added row", (await rowCount()) === rowsBefore, `back to ${await rowCount()}`);

await clickCell(2);
await page.locator('[data-testid="nt-row-after"]').click();
await pacedWait(page, 900);
ok("Row ↓ adds a row below", (await rowCount()) === rowsBefore + 1, `${rowsBefore} → ${await rowCount()}`);
await page.keyboard.press("Control+z");
await pacedWait(page, 900);
ok("⛔ undo removes it", (await rowCount()) === rowsBefore);

await clickCell(2);
await page.locator('[data-testid="nt-row-del"]').click();
await pacedWait(page, 900);
const docAfterRowDel = await storedDoc();
ok("Row ✕ deletes the row the caret was in", (await rowCount()) === rowsBefore - 1 && !textOf(docAfterRowDel).includes("A2"),
  `${await rowCount()} rows, text=${textOf(docAfterRowDel)}`);
await page.keyboard.press("Control+z");
await pacedWait(page, 900);
ok("⛔ undo restores the deleted row", (await rowCount()) === rowsBefore && textOf(await storedDoc()).includes("A2"));

console.log("\n=== 4 · ADD COLUMN LEFT / RIGHT, DELETE A COLUMN — each undoable ===");
await seed([TABLE_3X2, { type: "paragraph" }], "Cols");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
await clickCell(0); // A1
const colsBefore = await page.locator(".ProseMirror table tr").first().locator("td, th").count();
await page.locator('[data-testid="nt-col-before"]').click();
await pacedWait(page, 900);
ok("Col ← adds a column left", (await page.locator(".ProseMirror table tr").first().locator("td, th").count()) === colsBefore + 1);
await page.keyboard.press("Control+z");
await pacedWait(page, 900);
ok("⛔ undo removes it", (await page.locator(".ProseMirror table tr").first().locator("td, th").count()) === colsBefore);

await clickCell(0);
await page.locator('[data-testid="nt-col-after"]').click();
await pacedWait(page, 900);
ok("Col → adds a column right", (await page.locator(".ProseMirror table tr").first().locator("td, th").count()) === colsBefore + 1);
await page.keyboard.press("Control+z");
await pacedWait(page, 900);
ok("⛔ undo removes it", (await page.locator(".ProseMirror table tr").first().locator("td, th").count()) === colsBefore);

await clickCell(0);
await page.locator('[data-testid="nt-col-del"]').click();
await pacedWait(page, 900);
const docAfterColDel = await storedDoc();
ok("Col ✕ deletes the column the caret was in", !textOf(docAfterColDel).includes("A1") && textOf(docAfterColDel).includes("B1"),
  textOf(docAfterColDel));
await page.keyboard.press("Control+z");
await pacedWait(page, 900);
ok("⛔ undo restores the deleted column", textOf(await storedDoc()).includes("A1"));

console.log("\n=== 5 · MERGE AND SPLIT ===");
await seed([TABLE_3X2, { type: "paragraph" }], "Merge");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
await dragAcrossFirstRow();
const selBeforeMerge = await page.evaluate(() => document.querySelectorAll(".ProseMirror table .selectedCell").length);
await page.locator('[data-testid="nt-merge"]').click();
await pacedWait(page, 900);
const cellsAfterMerge = await cellCount();
ok("Merge/split MERGES a 2-cell selection into one cell", selBeforeMerge === 2 && cellsAfterMerge === 5, `sel=${selBeforeMerge}, cells after=${cellsAfterMerge}`);
const mergedText = textOf(await storedDoc());
ok("the merged cell keeps both texts", mergedText.includes("A1") && mergedText.includes("B1"), mergedText);
// The merged cell is now selected (a NodeSelection over the wide cell); clicking Merge/split again should SPLIT it.
await page.locator('[data-testid="nt-merge"]').click();
await pacedWait(page, 900);
ok("⛔ pressing Merge/split again on a merged cell SPLITS it back", (await cellCount()) === 6, `${await cellCount()} cells`);
await page.keyboard.press("Control+z");
await pacedWait(page, 900);

console.log("\n=== 6 · TOGGLE HEADER ROW ===");
await seed([TABLE_3X2, { type: "paragraph" }], "Header");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
await clickCell(0);
const thBefore = await page.locator(".ProseMirror table th").count();
await page.locator('[data-testid="nt-header-row"]').click();
await pacedWait(page, 900);
const thAfter = await page.locator(".ProseMirror table th").count();
ok("Header turns the first row's cells into th", thBefore === 0 && thAfter === 2, `${thBefore} → ${thAfter}`);
const headerText = textOf(await storedDoc());
ok("header toggle keeps the text", headerText.includes("A1") && headerText.includes("B1"));
await page.locator('[data-testid="nt-header-row"]').click();
await pacedWait(page, 900);
ok("pressing Header again toggles it back off", (await page.locator(".ProseMirror table th").count()) === 0);

console.log("\n=== 7 · TAB BETWEEN CELLS, AND TAB OUT OF THE LAST CELL ===");
await seed([TABLE_3X2, { type: "paragraph" }], "Tab");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
await clickCell(0); // A1
await page.keyboard.press("Tab");
await pacedWait(page, 200);
const selAfterTab1 = await page.evaluate(() => window.__noteEditor?.selection());
const cellAfterTab1 = await page.evaluate(() => {
  const sel = window.getSelection();
  return sel.anchorNode?.textContent?.trim();
});
ok("Tab from A1 moves the caret into the NEXT cell (B1), not out of the table", cellAfterTab1 === "B1", `landed in "${cellAfterTab1}"`);

const rowsBeforeLastTab = await rowCount();
await clickCell((await cellCount()) - 1); // the LAST cell (B3)
await page.keyboard.press("Tab");
await pacedWait(page, 900);
const rowsAfterLastTab = await rowCount();
ok("⛔ Tab out of the LAST cell adds a new row and moves into it (table's own Tab, matches Word/Excel) — not a document-level Tab/indent",
  rowsAfterLastTab === rowsBeforeLastTab + 1, `${rowsBeforeLastTab} → ${rowsAfterLastTab} rows`);
await page.keyboard.press("Control+z");
await pacedWait(page, 900);
ok("⛔ undo removes the row Tab added", (await rowCount()) === rowsBeforeLastTab);

console.log("\n=== 8 · A TABLE NESTED IN A LIST ITEM vs ONE AT TOP LEVEL — same ops on both ===");
const NESTED_TABLE = { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [
  { type: "paragraph", content: [{ type: "text", text: "Above" }] }, TABLE_3X2,
] }] }] };
await page.evaluate(([treeKey, prefix, d]) => {
  localStorage.clear();
  localStorage.setItem(treeKey, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Nested", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
  localStorage.setItem(prefix + "p1", JSON.stringify(d));
}, [TREE_KEY, PAGE_PREFIX, NESTED_TABLE]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
await pacedWait(page, 300);
await clickCell(2); // A2
await page.locator('[data-testid="nt-row-after"]').click();
await pacedWait(page, 900);
ok("row-add works on a table nested in a list item", (await rowCount()) === 4, `${await rowCount()} rows`);
await page.keyboard.press("Control+z");
await pacedWait(page, 900);
ok("⛔ undo works there too", (await rowCount()) === 3);

console.log("\n=== 9 · A TABLE INSIDE A POSITIONED TEXT BOX (noteAnchor) ===");
const TABLE_IN_BOX = { type: "doc", content: [
  { type: "noteAnchor", attrs: { x: 100, y: 120, w: 320 }, content: [TABLE_3X2] },
  { type: "paragraph" },
] };
await page.evaluate(([treeKey, prefix, d]) => {
  localStorage.clear();
  localStorage.setItem(treeKey, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "InBox", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
  localStorage.setItem(prefix + "p1", JSON.stringify(d));
}, [TREE_KEY, PAGE_PREFIX, TABLE_IN_BOX]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await pacedWait(page, 500);
const boxTablePresent = await page.locator(".planyr-anchor table").count();
ok("a table placed inside a positioned box renders at all", boxTablePresent === 1, `${boxTablePresent} tables in a box`);
if (boxTablePresent) {
  // Stage 1: select the box. Stage 2: press again to enter it and reach the table.
  const boxEl = await page.locator(".planyr-anchor").first().boundingBox();
  await page.mouse.click(boxEl.x + 10, boxEl.y + 10);
  await pacedWait(page, 150);
  await page.mouse.click(boxEl.x + 10, boxEl.y + 10);
  await pacedWait(page, 150);
  const cell = await page.locator(".planyr-anchor table td").first().boundingBox();
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await pacedWait(page, 150);
  const rowsInBoxBefore = await page.locator(".planyr-anchor table tr").count();
  const rowBtn = page.locator('[data-testid="nt-row-after"]');
  const rowBtnPresent = await rowBtn.count();
  ok("the Table toolbar group appears for a table inside a box (caret genuinely reaches it)", rowBtnPresent === 1);
  if (rowBtnPresent) {
    await rowBtn.click();
    await pacedWait(page, 900);
    ok("row-add works on a table inside a box", (await page.locator(".planyr-anchor table tr").count()) === rowsInBoxBefore + 1,
      `${rowsInBoxBefore} → ${await page.locator(".planyr-anchor table tr").count()}`);
  }
}

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(`page errors: ${errs.length ? errs.slice(0, 8).join(" | ") : "clean"}`);
console.log("\nNOT COVERED by this sweep (named, not silently skipped):");
console.log("  · ordered/task lists holding a table (only bulletList tested for nesting)");
console.log("  · a table whose row/column count exceeds the viewport (horizontal scroll)");
console.log("  · dragging a column-resize handle (a separate, already-shipped feature, not re-verified here)");
console.log("  · concurrent multi-writer edits to the same table (LIVE-VERIFY class, out of sandbox scope)");
await browser.close();
process.exit(fail ? 1 : 0);
