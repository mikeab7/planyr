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

const TABLE_FIXTURE_ROOT_TABLE = { type: "table", content: [
  { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Executive Assistant" }] }] }] },
  { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "O: 281-305-1115" }] }] }] },
  { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "M: (281) 705-2931" }] }] }] },
  { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "E: Kandicec@quadvest.com" }] }] }] },
] };

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

console.log("\n4 · ⛔ NO FRAME MAY EVER PAINT THE TOOLBAR GROWN WITHOUT THE COMPENSATION (NEW-1,");
console.log("    reopened 2026-08-28 — the shipped ResizeObserver-only fix compensated ONE FRAME");
console.log("    LATE, which every earlier check here sampled too coarsely (every ~45ms / 2-3");
console.log("    frames) to ever catch. A requestAnimationFrame sampler is the only instrument fine");
console.log("    enough to see it: on the pre-fix build, the frame where the toolbar first measures");
console.log("    at its taller height still has the mat's transform empty and the table already");
console.log("    down by the full delta — a real, visible one-frame jump, exactly the reported");
console.log("    \"jump and flash\". This is why AGAINST current main this section is REQUIRED to");
console.log("    reproduce the defect before trusting the fix: it failed here first, then passed");
console.log("    once NoteEditor.jsx compensated synchronously in a useLayoutEffect instead of");
console.log("    waiting on the ResizeObserver alone. See docs/NOTES-CARRY-FORWARD.md §5.4.");
await page.locator(".ProseMirror").first().click({ position: { x: 20, y: 5 } });
await pacedWait(page, 200);
await page.evaluate(() => {
  window.__frames = [];
  const mat = document.querySelector('[data-testid="note-mat"]');
  const toolbar = document.querySelector('[data-testid="note-toolbar"]');
  const table = document.querySelector(".ProseMirror table");
  let n = 0;
  function tick() {
    window.__frames.push({
      n,
      toolbarH: Math.round(toolbar.getBoundingClientRect().height * 10) / 10,
      transform: mat.style.transform,
      tableTop: Math.round(table.getBoundingClientRect().top * 10) / 10,
    });
    n += 1;
    if (n < 60) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
});
await pacedWait(page, 60);
const firstCell = await page.evaluate(() => {
  const r = document.querySelectorAll(".ProseMirror table td")[1].getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
await page.mouse.click(firstCell.x, firstCell.y);
await pacedWait(page, 1100);
const frames = await page.evaluate(() => window.__frames);
const baseline = frames[0].toolbarH;
/* ⛔ THE RACE CHECK MEASURES `tableTop` DIRECTLY, NEVER THE `transform` STRING'S SHAPE. An
 * earlier version of this check called a frame "uncompensated" whenever `transform` read ""
 * — correct for the GROWING case (an empty transform there really is no compensation), but
 * that same test would have misjudged the SHRINKING case below, whose correct SETTLED state
 * is net-zero, i.e. an EMPTY transform. Comparing the visible position against its own final,
 * settled value is the mechanism-agnostic version of the same check (VIEWPORT-STABLE is about
 * the picture staying put, not about which CSS property does it). */
const settledTop = frames[frames.length - 1].tableTop;
let raceFrames = 0;
let sawGrowth = false;
for (const f of frames) {
  if (f.toolbarH > baseline + 1) sawGrowth = true;
  if (Math.abs(f.tableTop - settledTop) > 1) raceFrames += 1;
}
ok("⛔ the table entry is actually exercised by this probe (vacuity guard)", sawGrowth,
  `baseline ${baseline}px, ${frames.length} frames sampled`);
ok("⛔ zero frames ever paint the table away from its settled position (no visible jump)", raceFrames === 0,
  `${raceFrames}/${frames.length} frames were in the race window (was 1+ before the fix)`);

console.log("\n5 · ⛔ THE SCROLLER PINNED AT MAXIMUM SCROLL, NO SLACK LEFT TO COMPENSATE WITH");
console.log("    (owner correction, 2026-08-28): the ORIGINAL note-jump fix compensated");
console.log("    `scrollTop`, and was replaced with a `transform` specifically because a short");
console.log("    note has `scrollHeight - clientHeight === 0` — zero slack, so adding to");
console.log("    scrollTop clamps straight back to zero and the table still moves the full");
console.log("    delta. The owner's live report had `scrollTop` PINNED at a constant non-zero");
console.log("    value the whole gesture, which is consistent with EITHER a working transform");
console.log("    OR a silently-clamped scrollTop compensation — the number alone can't tell them");
console.log("    apart. This section pins the scroller at its OWN maximum scroll (whatever that");
console.log("    is, including zero on a short note) before the drag, and asserts (a) scrollTop");
console.log("    genuinely never changes — ruling out scroll-based compensation entirely — and");
console.log("    (b) the frame-by-frame race check from section 4 still holds at zero slack.");
async function assertNoRaceAtMaxScroll(label, gesture) {
  await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    mat.scrollTop = mat.scrollHeight; // pin to whatever "maximum" is, short note or not
  });
  const scrollBefore = await page.evaluate(() => document.querySelector('[data-testid="note-mat"]').scrollTop);
  await page.evaluate(() => {
    window.__frames = [];
    const mat = document.querySelector('[data-testid="note-mat"]');
    const toolbar = document.querySelector('[data-testid="note-toolbar"]');
    const table = document.querySelector(".ProseMirror table");
    let n = 0;
    function tick() {
      window.__frames.push({
        n,
        toolbarH: Math.round(toolbar.getBoundingClientRect().height * 10) / 10,
        transform: mat.style.transform,
        tableTop: Math.round(table.getBoundingClientRect().top * 10) / 10,
        scrollTop: mat.scrollTop,
      });
      n += 1;
      if (n < 60) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  await pacedWait(page, 60);
  await gesture();
  await pacedWait(page, 1100);
  const frames = await page.evaluate(() => window.__frames);
  const scrollAfter = await page.evaluate(() => document.querySelector('[data-testid="note-mat"]').scrollTop);
  const scrollDrifted = frames.some((f) => f.scrollTop !== scrollBefore);
  ok(`${label}: scrollTop never moves (compensation is NOT scroll-based) at max-scroll`,
    !scrollDrifted && scrollAfter === scrollBefore, `before=${scrollBefore}, after=${scrollAfter}, drifted=${scrollDrifted}`);
  const baseline = frames[0].toolbarH;
  const settledTop = frames[frames.length - 1].tableTop;
  let raceFrames = 0;
  let sawChange = false;
  for (const f of frames) {
    if (Math.abs(f.toolbarH - baseline) > 1) sawChange = true;
    // Measure the visible position against its own settled value, not the `transform`
    // string's shape — the correct settled state for a SHRINKING toolbar is net-zero (an
    // empty transform), which a check for "transform is non-empty" would misread as a race.
    if (Math.abs(f.tableTop - settledTop) > 1) raceFrames += 1;
  }
  ok(`${label}: the toolbar transition is actually exercised (vacuity guard)`, sawChange, `baseline ${baseline}px`);
  ok(`${label}: zero race frames at maximum scroll (no slack to fall back on)`, raceFrames === 0,
    `${raceFrames}/${frames.length} frames raced`);
  return frames;
}

await seed(FIXTURE_DOC, "MaxScroll");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });

// ENTERING the table — the toolbar GROWS.
await assertNoRaceAtMaxScroll("entering the table (toolbar grows)", async () => {
  const c = await page.evaluate(() => {
    const r = document.querySelectorAll(".ProseMirror table td")[1].getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.click(c.x, c.y);
});

// ⛔ THE MIRROR CASE, the owner named explicitly: leaving the table SHRINKS the toolbar, which
// moves content the OTHER way (up, not down) — a compensation that only cancels growth and
// happens to look right by coincidence would fail this arm.
await assertNoRaceAtMaxScroll("leaving the table (toolbar shrinks)", async () => {
  await page.locator(".ProseMirror").first().click({ position: { x: 20, y: 5 } });
});

console.log("\n6 · ⛔ A PLAIN PARAGRAPH AFTER THE TABLE MUST NOT MOVE EITHER (owner's exact repro shape:");
console.log("    click from inside a table out to plain text, assert the PARAGRAPH's own client");
console.log("    rect, not the table's — the compensation is one transform on the whole scroller,");
console.log("    so proving it on the table already implies it here, but this asserts it directly");
console.log("    rather than by inference.)");
/* ⛔ A LEADING PARAGRAPH BEFORE THE TABLE IS NOT OPTIONAL HERE — every real note's blank
 * document is `EMPTY_DOC` (`notesExtensions.js`): `{ paragraph }`, never a bare table, so a
 * table can only ever be inserted as a LATER sibling of content that already existed. A doc
 * whose content[0] IS the table (no leading paragraph at all) is unreachable through any real
 * user action and, worse, is its own instrument trap: ProseMirror's default mount selection
 * (`Selection.atStart(doc)`) then resolves INSIDE the table before any click ever happens, so
 * the very first height reading this file's fix ever sees is already the tall "in table" one —
 * a fixture artifact of stripping the table down to being the ENTIRE document, not a case this
 * bug needs to survive. */
const TABLE_THEN_PARAGRAPH = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Notes above the table." }] },
    TABLE_FIXTURE_ROOT_TABLE,
    { type: "paragraph", content: [{ type: "text", text: "Plain text after the table." }] },
  ],
};
await seed(TABLE_THEN_PARAGRAPH, "ParagraphAfterTable");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
await page.evaluate(() => {
  const mat = document.querySelector('[data-testid="note-mat"]');
  mat.scrollTop = mat.scrollHeight;
});
// Enter the table first (so the toolbar's second row is showing), THEN click the paragraph.
const cellPoint = await page.evaluate(() => {
  const r = document.querySelectorAll(".ProseMirror table td")[0].getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
await page.mouse.click(cellPoint.x, cellPoint.y);
await pacedWait(page, 300);
await page.evaluate(() => {
  window.__frames = [];
  // The paragraph AFTER the table (last of the two `.ProseMirror > p`s — the first is the
  // leading paragraph BEFORE the table, added so the fixture is a real note shape rather than
  // a bare table as the document's first block).
  const p = document.querySelector(".ProseMirror > p:last-of-type");
  let n = 0;
  function tick() {
    const r = p.getBoundingClientRect();
    window.__frames.push({ n, top: Math.round(r.top * 10) / 10, left: Math.round(r.left * 10) / 10 });
    n += 1;
    if (n < 60) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
});
await pacedWait(page, 60);
await page.locator(".ProseMirror > p", { hasText: "Plain text after the table." }).click(); // leave the table — the toolbar SHRINKS
await pacedWait(page, 1100);
const paraFrames = await page.evaluate(() => window.__frames);
const settledParaTop = paraFrames[paraFrames.length - 1].top;
const paraRace = paraFrames.filter((f) => Math.abs(f.top - settledParaTop) > 1).length;
ok("⛔ the plain paragraph's client rect never moves while leaving the table (toolbar shrinking), even at max scroll",
  paraRace === 0, `${paraRace}/${paraFrames.length} frames raced, settled top=${settledParaTop}`);

console.log("\n7 · ⛔ THE OWNER'S EXACT REPORTED SHAPE (NEW-1/B831600 ×3, reopened 2026-08-28): a");
console.log("    4-row × 1-col table with NO CLASS on it, nested FOUR listItem/bulletList levels");
console.log("    deep — matching docs/NOTES-CARRY-FORWARD.md §2's own worked fixture (MUD 377 ›");
console.log("    Engineer › Dustin O'Neal › Utility › Quadvest MUD › table) — with real sibling");
console.log("    content above and below, not a table stripped down to being the whole document.");
console.log("    Honesty, stated once here rather than left implicit: this section is GREEN on");
console.log("    both the pre-round-3 accumulator code and the round-3 fix — the owner's exact drag");
console.log("    race could not be forced through this repo's headless Chromium (a documented");
console.log("    instrument gap, see the B831600 ×3 writeup in BACKLOG-DONE.md). It stays as the");
console.log("    STANDING regression fixture NEW-2 requires: built from the reported shape, kept");
console.log("    alongside the top-level case rather than replacing it, so a FUTURE change cannot");
console.log("    quietly re-introduce a nesting-sensitive assumption without this catching it.");
const mkPara = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
const DEEP_TABLE = { type: "table", content: [
  { type: "tableRow", content: [{ type: "tableCell", content: [mkPara("Executive Assistant")] }] },
  { type: "tableRow", content: [{ type: "tableCell", content: [mkPara("O: 281-305-1115")] }] },
  { type: "tableRow", content: [{ type: "tableCell", content: [mkPara("M: (281) 705-2931")] }] },
  { type: "tableRow", content: [{ type: "tableCell", content: [mkPara("E: Kandicec@quadvest.com")] }] },
] };
const DEEP_NESTED_DOC = {
  type: "doc",
  content: [
    mkPara("MUD 377"),
    { type: "bulletList", content: [
      { type: "listItem", content: [mkPara("Active")] },
      { type: "listItem", content: [
        mkPara("Engineer - Pape Dawson"),
        { type: "bulletList", content: [
          { type: "listItem", content: [
            mkPara("Dustin O'Neal"),
            { type: "bulletList", content: [
              { type: "listItem", content: [mkPara("P: 713-428-2400")] },
              { type: "listItem", content: [
                mkPara("Utility"),
                { type: "bulletList", content: [
                  { type: "listItem", content: [mkPara("Quadvest MUD"), DEEP_TABLE] },
                ] },
              ] },
            ] },
          ] },
        ] },
      ] },
      { type: "listItem", content: [mkPara("MUD ATTORNEY: BRIAN YATES")] },
    ] },
    mkPara("Water Authority: Northwest Regional Water Authority"),
    mkPara("Sanitary:"),
    { type: "bulletList", content: [
      { type: "listItem", content: [mkPara("Discharge Permit may be 18 months")] },
    ] },
  ],
};
await seed(DEEP_NESTED_DOC, "Utility");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
const deepDepth = await page.evaluate(() => {
  let d = 0; let el = document.querySelector(".ProseMirror table");
  while (el && !el.classList.contains("ProseMirror")) { d += 1; el = el.parentElement; }
  return d;
});
ok("fixture is genuinely nested several levels deep (not simplified)", deepDepth >= 8, `${deepDepth} DOM levels from table to .ProseMirror`);
const deepTableClass = await page.evaluate(() => document.querySelector(".ProseMirror table").className);
ok("no class on the <table> element (matches the reported shape exactly)", deepTableClass === "", `class="${deepTableClass}"`);
// Scroll to a position with slack on BOTH sides, matching the owner's own measurement setup.
await page.evaluate(() => {
  const mat = document.querySelector('[data-testid="note-mat"]');
  const table = document.querySelector(".ProseMirror table");
  const tableOffsetTop = table.getBoundingClientRect().top - mat.getBoundingClientRect().top + mat.scrollTop;
  mat.scrollTop = Math.max(0, tableOffsetTop - 150);
});
await page.locator(".ProseMirror > p", { hasText: "MUD 377" }).click(); // caret starts OUTSIDE the table
await pacedWait(page, 200);
const deepCellBoxes = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror table td")].map((c) => {
  const r = c.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}));
const deepFrames = [];
const sampleDeep = async () => deepFrames.push(await page.evaluate(() => ({
  top: Math.round(document.querySelector(".ProseMirror table").getBoundingClientRect().top * 10) / 10,
  scrollTop: document.querySelector('[data-testid="note-mat"]').scrollTop,
})));
await page.mouse.move(deepCellBoxes[0].x, deepCellBoxes[0].y);
await page.mouse.down();
await sampleDeep();
for (let i = 1; i <= 12; i += 1) {
  const x = Math.round(deepCellBoxes[0].x + (deepCellBoxes[3].x - deepCellBoxes[0].x) * (i / 12));
  const y = Math.round(deepCellBoxes[0].y + (deepCellBoxes[3].y - deepCellBoxes[0].y) * (i / 12));
  await page.mouse.move(x, y);
  await pacedWait(page, 30);
  await sampleDeep();
}
await page.mouse.up();
await pacedWait(page, 150);
await sampleDeep();
const deepScrollDrifted = deepFrames.some((f) => f.scrollTop !== deepFrames[0].scrollTop);
let deepMaxJump = 0;
for (let i = 1; i < deepFrames.length; i += 1) deepMaxJump = Math.max(deepMaxJump, Math.abs(deepFrames[i].top - deepFrames[i - 1].top));
ok("⛔ the deeply-nested table does not jump under the pointer during the drag", deepMaxJump < 4,
  `max frame delta ${deepMaxJump.toFixed(1)}px, scrollTop drifted=${deepScrollDrifted}`);
const deepSel = await page.evaluate(() => window.__noteEditor?.selection());
ok("the drag across the deeply-nested table builds a real selection", deepSel && !deepSel.empty, JSON.stringify(deepSel));

console.log("\n8 · ⛔ THE ACCUMULATOR-DESYNC CLASS ITSELF (round 3's actual root fix): a note whose");
console.log("    FIRST EVER block is a table mounts with the selection already inside it (ProseMirror's");
console.log("    default Selection.atStart(doc)), so the very FIRST height reading is already the tall");
console.log("    'in table' one. Round 2's accumulator had nothing shorter in its history to null the");
console.log("    drift against and stayed uncompensated for the table's WHOLE lifetime; round 3's");
console.log("    stateless baseline self-corrects the moment a genuinely shorter reading arrives.");
console.log("    This is a DIFFERENT trigger than nesting depth, but the IDENTICAL failure mode the");
console.log("    owner measured — one wrong jump, never self-correcting — through a path this sandbox");
console.log("    CAN reliably reproduce (unlike section 7's exact drag race).");
const TABLE_IS_FIRST_BLOCK = {
  type: "doc",
  content: [
    TABLE_FIXTURE_ROOT_TABLE,
    { type: "paragraph", content: [{ type: "text", text: "Plain text after the table." }] },
  ],
};
await seed(TABLE_IS_FIRST_BLOCK, "TableFirstBlock");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
const mountInTable = await page.evaluate(() =>
  document.querySelector('[data-testid="note-toolbar"]').getBoundingClientRect().height > 50);
ok("⛔ vacuity guard — this fixture genuinely mounts with the toolbar already grown (the case being tested)",
  mountInTable, `toolbar height at mount reflects "in table" without any click`);
/* ⛔ THE ACTUAL PROOF, and why it is NOT "does the paragraph move on leaving" — that check
 * passes on round 2's own broken code too, which is exactly the trap worth naming rather than
 * silently avoiding. Round 2's accumulator, poisoned at mount (baseline captured as the tall
 * "in table" reading, nothing shorter in its history yet), computes an EQUAL-AND-OPPOSITE wrong
 * delta on the first leave (`delta = 39 - 75 = -36` → `translateY(+36px)`) that happens to add
 * the exact 36px BACK that mounting never subtracted — so the paragraph's absolute position
 * reads IDENTICAL before and after leaving (a "nothing moved" false pass), while the actual
 * value is wrong by 36px in BOTH states and the accumulator has entered a permanent two-state
 * OSCILLATION (0 while in table, `translateY(+36px)` while out of it) that never reaches the
 * true baseline. The property that is actually TRUE, structurally, regardless of any fixture's
 * specific pixel geometry: being OUT of the table is the reference state by definition, so the
 * compensating `transform` must be EMPTY once the caret has genuinely left — never a nonzero
 * value "coincidentally" canceling an unrelated earlier mistake. */
await page.locator(".ProseMirror > p", { hasText: "Plain text after the table." }).click(); // leave the table for the first time, straight from the poisoned mount state
await pacedWait(page, 300);
const afterLeaveTransform = await page.evaluate(() => document.querySelector('[data-testid="note-mat"]').style.transform);
ok("⛔ the compensating transform is EMPTY once the caret has genuinely left the table — even coming straight from a poisoned mount reading (never a nonzero value masquerading as correct)",
  !afterLeaveTransform || afterLeaveTransform === "translateY(0px)", `transform="${afterLeaveTransform}"`);

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(`page errors: ${errs.length ? errs.slice(0, 5).join(" | ") : "clean"}`);
console.log("\nNOT COVERED by this file (named, not silently skipped):");
console.log("  · a drag that starts OUTSIDE the table and ends INSIDE it while the scroller has");
console.log("    to auto-scroll to keep the endpoint in view (a different mechanism — the browser's");
console.log("    own edge-autoscroll — layered on top of this compensation; not exercised here)");
console.log("  · two rapid successive enter/leave transitions inside one animation frame (the");
console.log("    accumulator is additive by construction, but this file only ever exercises one");
console.log("    transition per sampling window)");
console.log("  · a table inside a positioned box (`noteAnchor`) triggering the SAME toolbar growth");
console.log("    — covered by row-level tests in sweep-notes-table.mjs, not by a frame sampler here");
await browser.close();
process.exit(fail ? 1 : 0);
