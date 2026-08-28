/* verify-notes-table-select — NEW-1 / B649376: "when I click and highlight stuff [in a table],
 * it just jumps and flashes" (owner report, Silvestri "Utility" note, 2026-08-28).
 *
 * ⛔ ROOT CAUSE, MEASURED WITH A REAL MOUSE DRAG (docs/NOTES-CARRY-FORWARD.md trap #3/#5 — a
 * programmatic Range proves nothing here). `NoteToolbar`'s Table button group only renders
 * `{inTable && (...)}`, so the instant the caret enters a table the toolbar wraps to an extra
 * row and grows by ~36px. The toolbar is a SIBLING of the scrollable mat in the same flex
 * column, so the mat's own top edge — and everything painted inside it, the table included —
 * slides down by that exact delta the moment you press the mouse down inside a cell. A drag
 * that starts there has its target crawl out from under a STATIONARY pointer on the very
 * first frame: instrumented before the fix, the native selection never extended across cells
 * at all — it stayed collapsed and hopped between wrong text nodes (some OUTSIDE the table)
 * on every mousemove, because each move's screen coordinates resolved against content that
 * had silently moved since mousedown. Leaving the table reverts the bar and the sheet snaps
 * back — the "flash". Fixed in `NoteEditor.jsx` (VIEWPORT-STABLE): a `ResizeObserver` on the
 * toolbar folds its measured height delta into the mat's own `transform`, before paint.
 *
 * ⛔ A KNOWN-GOOD CONTROL ARM IS INCLUDED (DRIVER-SCROLL-IS-NOT-APP-SCROLL clause 6 /
 * WRONG-CASE): the same real drag across four plain paragraphs (no table) is asserted to
 * extend a selection correctly, so a future change to the drag driver itself would fail THAT
 * arm rather than being misread as a table-specific regression.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "verify-notes-table-select");
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

let pass = 0; let fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

/* Michael's Silvestri fixture shape: a 4-row × 1-col Outlook signature table, no class on
 * <table>, nested several levels deep inside a list item. Simplifying this (a flat table,
 * fewer levels) is exactly the trap docs/NOTES-CARRY-FORWARD.md §2 warns against. */
const FIXTURE_DOC = {
  type: "doc",
  content: [
    { type: "bulletList", content: [
      { type: "listItem", content: [
        { type: "paragraph", content: [{ type: "text", text: "Utility" }] },
        { type: "bulletList", content: [
          { type: "listItem", content: [
            { type: "paragraph", content: [{ type: "text", text: "Quadvest MUD" }] },
            { type: "table", content: [
              { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Executive Assistant" }] }] }] },
              { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "O: 281-305-1115" }] }] }] },
              { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "M: (281) 705-2931" }] }] }] },
              { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "E: Kandicec@quadvest.com" }] }] }] },
            ] },
          ] },
        ] },
      ] },
    ] },
  ],
};

const PLAIN_DOC = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Executive Assistant" }] },
    { type: "paragraph", content: [{ type: "text", text: "O: 281-305-1115" }] },
    { type: "paragraph", content: [{ type: "text", text: "M: (281) 705-2931" }] },
    { type: "paragraph", content: [{ type: "text", text: "E: Kandicec@quadvest.com" }] },
  ],
};

async function seed(doc, title) {
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

/** Real drag (page.mouse down/move/up via CDP — a trusted gesture, not a programmatic Range).
 *  Samples the FIRST element's bounding rect on every move to catch a mid-gesture jump. */
async function realDrag(fromEl, toEl, { steps = 10 } = {}) {
  const boxes = await page.evaluate(([sel1, sel2]) => {
    const b = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
    return [b(document.querySelector(sel1)), b(document.querySelector(sel2))];
  }, [fromEl, toEl]);
  const [start, end] = boxes;
  const rects = [];
  const sampleRect = async () => rects.push(await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { top: r.top, left: r.left };
  }, fromEl));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await sampleRect();
  for (let i = 1; i <= steps; i += 1) {
    const x = Math.round(start.x + (end.x - start.x) * (i / steps));
    const y = Math.round(start.y + (end.y - start.y) * (i / steps));
    await page.mouse.move(x, y);
    await pacedWait(page, 45);
    await sampleRect();
  }
  await page.mouse.up();
  await pacedWait(page, 150);
  await sampleRect();
  let maxJump = 0;
  for (let i = 1; i < rects.length; i += 1) {
    maxJump = Math.max(maxJump, Math.abs(rects[i].top - rects[i - 1].top), Math.abs(rects[i].left - rects[i - 1].left));
  }
  return { maxJump, rects };
}

console.log("\n1 · KNOWN-GOOD CONTROL ARM — plain paragraphs, no table (must already work)");
await seed(PLAIN_DOC, "Utility-plain");
{
  const { maxJump } = await realDrag(".ProseMirror > p:first-child", ".ProseMirror > p:last-child");
  const sel = await page.evaluate(() => window.__noteEditor?.selection());
  ok("no jump dragging across plain paragraphs", maxJump < 4, `max frame delta ${maxJump.toFixed(1)}px`);
  ok("selection extends (not collapsed)", sel && !sel.empty, JSON.stringify(sel));
}

console.log("\n2 · THE REPORTED CASE — Silvestri-shaped table, nested in a list, real drag");
await seed(FIXTURE_DOC, "Utility");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
const cellCount = await page.locator(".ProseMirror table td").count();
ok("fixture has all 4 rows", cellCount === 4, `${cellCount} cells`);

// Real cross-cell drag: first cell's text to last cell's text.
async function dragAcrossCells() {
  const cellBoxes = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror table td")].map((c) => {
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }));
  const start = cellBoxes[0]; const end = cellBoxes[cellBoxes.length - 1];
  const rects = [];
  const sample = async () => rects.push(await page.evaluate(() => document.querySelector(".ProseMirror table").getBoundingClientRect().top));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await sample();
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    const x = Math.round(start.x + (end.x - start.x) * (i / steps));
    const y = Math.round(start.y + (end.y - start.y) * (i / steps));
    await page.mouse.move(x, y);
    await pacedWait(page, 45);
    await sample();
  }
  await page.mouse.up();
  await pacedWait(page, 150);
  await sample();
  let maxJump = 0;
  for (let i = 1; i < rects.length; i += 1) maxJump = Math.max(maxJump, Math.abs(rects[i] - rects[i - 1]));
  return maxJump;
}

const maxJump = await dragAcrossCells();
ok("⛔ the table does not jump under the pointer during the drag", maxJump < 4, `max frame delta ${maxJump.toFixed(1)}px (was 36px before the fix)`);

const cellSelState = await page.evaluate(() => ({
  selectedCells: document.querySelectorAll(".ProseMirror table td.selectedCell").length,
  sel: window.__noteEditor?.selection(),
}));
ok("⛔ the drag actually creates a selection spanning cells (was always collapsed before the fix)",
  cellSelState.sel && !cellSelState.sel.empty, JSON.stringify(cellSelState.sel));
ok("all 4 cells carry the selectedCell class at rest", cellSelState.selectedCells === 4, `${cellSelState.selectedCells}/4`);

console.log("\n3 · LEAVING THE TABLE RESTORES THE ORIGINAL LAYOUT (no permanent drift)");
await page.locator(".ProseMirror").first().click({ position: { x: 20, y: 5 } });
await pacedWait(page, 250);
const settled = await page.evaluate(() => {
  const mat = document.querySelector('[data-testid="note-mat"]');
  return { transform: mat.style.transform, toolbarHeight: Math.round(document.querySelector('[data-testid="note-toolbar"]').getBoundingClientRect().height) };
});
ok("mat transform clears back to none once the caret leaves the table", !settled.transform || settled.transform === "translateY(0px)" || settled.transform === "",
  JSON.stringify(settled));

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(`page errors: ${errs.length ? errs.slice(0, 5).join(" | ") : "clean"}`);
await browser.close();
process.exit(fail ? 1 : 0);
