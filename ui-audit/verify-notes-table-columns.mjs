/* Live verification for B1554272/B1554273 (NEW-1/NEW-2) — widening a table column must not
 * squeeze its neighbours, a column may never be squeezed below a readable floor, and an
 * already-broken stored table must repair itself on open. Driven with a real mouse (a
 * synthetic drag would never reach the columnResizing plugin's mousedown handler). */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { TABLE_COL_MIN_WIDTH } from "../src/workspaces/notes/lib/notesTableWidth.js";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await assertMeasurable(page, "verify-notes-table-columns");
await page.addInitScript(() => { window.__PLANYR_E2E = true; });

let pass = 0; let fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function seed(doc, title = "Table test") {
  /* ⛔ SETTLE BEFORE CLEARING, NOT ONLY AFTER (docs/NOTES-CARRY-FORWARD.md trap #6). A case that
   * ends on an EDIT (a drag, an undo) leaves a 600ms autosave in flight on the PREVIOUS page;
   * clearing localStorage immediately loses the race and this seed's own write is what gets
   * overwritten a moment later by that straggler. Waiting here, before touching storage, lets
   * any such write land first so this one goes last and wins — cheaper than hunting down every
   * call site that edits right before its own trailing wait. */
  await page.waitForTimeout(700);
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
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
  /* ⛔ MUST CLEAR THE 600ms SAVE DEBOUNCE, not just settle the DOM (docs/NOTES-CARRY-FORWARD.md
   * trap #6). An on-mount normalization (ensureNoteAnchorIds / normalizeTableColumnWidths) can
   * itself dispatch one real transaction, which autosaves 600ms later — a seed() for the NEXT
   * case that clears localStorage before that timer fires loses the race and reads back the
   * PREVIOUS case's own normalized doc instead of what was just seeded. */
  await page.waitForTimeout(900);
}

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const cell = (text, colwidth = null) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth, align: null }, content: [p(text)] });
const row = (cells) => ({ type: "tableRow", content: cells });

async function colWidths() {
  return page.evaluate(() => {
    const table = document.querySelector('[data-testid="note-body"] table');
    if (!table) return null;
    const tr = table.querySelector("tr");
    return [...tr.children].map((td) => Math.round(td.getBoundingClientRect().width));
  });
}

async function sheetWidth() {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="note-sheet"]');
    return sheet ? Math.round(sheet.getBoundingClientRect().width) : null;
  });
}

/* ════════════════════════════════ CASE 1 — repair on load (NEW-2) ═══════════════════════ */
console.log("\n[1] An already-broken stored table (Michael's exact shape) repairs on open:");
{
  const doc = {
    type: "doc",
    content: [{
      type: "table",
      content: [row([
        cell("AHJ"), cell("Permit"), cell("Number"),
        cell("Notes", [300]), cell("Status", [300]),
      ])],
    }],
  };
  await seed(doc, "Permitting");
  const widths = await colWidths();
  ok("table found", !!widths, JSON.stringify(widths));
  if (widths) {
    ok("AHJ/Permit/Number are NOT squeezed to a sliver", widths[0] >= 90 && widths[1] >= 90 && widths[2] >= 90, JSON.stringify(widths));
    ok("the two wide columns kept ~300", widths[3] >= 280 && widths[4] >= 280, JSON.stringify(widths));
  }
  // Reload again — the repair must have actually SAVED, not merely rendered correctly once.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await page.waitForTimeout(900);
  const widths2 = await colWidths();
  ok("survives a reload (the repair persisted, not just rendered)", widths2 && widths2[0] >= 90 && widths2[1] >= 90 && widths2[2] >= 90, JSON.stringify(widths2));
}

/* ════════════════════════ CASE 2 — widening a column, real drag, fresh table ═══════════ */
console.log("\n[2] Widening one column of a FRESH table with a real mouse drag:");
{
  const doc = { type: "doc", content: [{ type: "table", content: [row([cell("A"), cell("B"), cell("C")])] }] };
  await seed(doc, "Fresh table");
  const before = await colWidths();
  ok("three columns rendered", before && before.length === 3, JSON.stringify(before));

  // Drag the first column's right edge (the resize handle sits inside the first td, near its
  // right border) further right by 200px.
  const handle = await page.evaluate(() => {
    const td = document.querySelector('[data-testid="note-body"] table tr td');
    const r = td.getBoundingClientRect();
    return { x: Math.round(r.right - 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) await page.mouse.move(handle.x + 20 * i, handle.y, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = await colWidths();
  ok("column 1 grew by roughly the drag distance", after[0] >= before[0] + 150, `before=${before[0]} after=${after[0]}`);
  ok("column 2 did NOT shrink below what it had", after[1] >= before[1] - 10, `before=${before[1]} after=${after[1]}`);
  ok("column 3 did NOT shrink below what it had", after[2] >= before[2] - 10, `before=${before[2]} after=${after[2]}`);
  ok("neither untouched column collapsed toward the old 25px sliver", after[1] >= 90 && after[2] >= 90, JSON.stringify(after));

  // Reload — the drag's own commit must have saved (and self-normalized the other two columns).
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await page.waitForTimeout(900);
  const persisted = await colWidths();
  ok("the widened column persisted through reload", persisted[0] >= before[0] + 150, JSON.stringify(persisted));
  ok("the other two persisted at a healthy width, not squeezed", persisted[1] >= 90 && persisted[2] >= 90, JSON.stringify(persisted));
}

/* ════════════════════════ CASE 3 — the drag floor (NEW-2) ═════════════════════════════ */
console.log("\n[3] A manual drag cannot squeeze a column below the floor:");
{
  const doc = { type: "doc", content: [{ type: "table", content: [row([cell("A"), cell("B")])] }] };
  await seed(doc, "Floor test");
  const before = await colWidths();
  const handle = await page.evaluate(() => {
    const td = document.querySelector('[data-testid="note-body"] table tr td:first-child');
    const r = td.getBoundingClientRect();
    return { x: Math.round(r.right - 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  // Drag far LEFT — an attempt to crush column 1 to nothing.
  await page.mouse.move(handle.x - 400, handle.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await colWidths();
  ok("column 1 stopped at the floor, not a sliver", after[0] >= 90, `before=${before[0]} after=${after[0]}`);
}

/* ════════════════════════ CASE 4 — the sheet grows to hold a wide table ═══════════════ */
console.log("\n[4] The sheet grows to hold a wide table (not just an inner scrollbar):");
{
  const naturalSheet = await (async () => {
    await seed({ type: "doc", content: [p("hello")] }, "Plain");
    return sheetWidth();
  })();
  const doc = {
    type: "doc",
    content: [{
      type: "table",
      content: [row([cell("A", [400]), cell("B", [400]), cell("C", [400]), cell("D", [400])])],
    }],
  };
  await seed(doc, "Wide table");
  const grownSheet = await sheetWidth();
  ok("the sheet is wider than its ordinary size once a table overflows it", grownSheet > naturalSheet, `natural=${naturalSheet} grown=${grownSheet}`);
  const widths = await colWidths();
  ok("all four 400px columns render at their explicit width, none squeezed", widths.every((w) => w >= 380), JSON.stringify(widths));
}

/* ════════════════════════ CASE 5 — narrow / undo / adjacent cases ═════════════════════ */
console.log("\n[5] Adjacent cases:");
{
  // Widen the LAST column instead of the first.
  const doc = { type: "doc", content: [{ type: "table", content: [row([cell("A"), cell("B"), cell("C")])] }] };
  await seed(doc, "Last column");
  const before = await colWidths();
  const handle = await page.evaluate(() => {
    const tds = document.querySelectorAll('[data-testid="note-body"] table tr td');
    const td = tds[tds.length - 1];
    const r = td.getBoundingClientRect();
    return { x: Math.round(r.right - 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(handle.x + 20 * i, handle.y, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await colWidths();
  ok("widening the LAST column grows it, others don't collapse", after[2] > before[2] && after[0] >= 90 && after[1] >= 90, JSON.stringify({ before, after }));

  // Undo/redo of a resize as a single step. The drag itself never focused the document (a
  // resize handle's own mousedown preventDefaults the focus shift), so a real editor click is
  // needed first — otherwise Ctrl+Z has nowhere to route to, which is a test-harness gap, not a
  // product one.
  await page.click('[data-testid="note-body"] table tr td:first-child');
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  const undone = await colWidths();
  ok("Ctrl+Z undoes the resize in one step", undone[2] < after[2], JSON.stringify({ after, undone }));
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(200);
  const redone = await colWidths();
  ok("Ctrl+Y redoes it", redone[2] >= after[2] - 5, JSON.stringify({ after, redone }));
}

/* ════════════════════════ CASE 6 — a table nested in a list ═══════════════════════════ */
console.log("\n[6] A table nested inside a bullet list:");
{
  const doc = {
    type: "doc",
    content: [{
      type: "bulletList",
      content: [{
        type: "listItem",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Utility contacts" }] },
          { type: "table", content: [row([cell("A"), cell("B"), cell("C")])] },
        ],
      }],
    }],
  };
  await seed(doc, "Nested table");
  const before = await colWidths();
  ok("the nested table rendered with three columns", before && before.length === 3, JSON.stringify(before));
  const handle = await page.evaluate(() => {
    const td = document.querySelector('[data-testid="note-body"] table tr td');
    const r = td.getBoundingClientRect();
    return { x: Math.round(r.right - 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(handle.x + 20 * i, handle.y, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await colWidths();
  ok("widening a column in a nested table doesn't squeeze its siblings", after[0] > before[0] && after[1] >= 90 && after[2] >= 90, JSON.stringify({ before, after }));
}

/* ════════════════════════ CASE 7 — two tables on one page, one wide one narrow ═════════ */
console.log("\n[7] Two tables on one page — a wide one and an untouched one:");
{
  const doc = {
    type: "doc",
    content: [
      { type: "table", content: [row([cell("A", [400]), cell("B", [400]), cell("C", [400])])] },
      { type: "paragraph", content: [{ type: "text", text: "between the two" }] },
      { type: "table", content: [row([cell("X"), cell("Y")])] },
    ],
  };
  await seed(doc, "Two tables");
  const widths = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('[data-testid="note-body"] table')];
    return tables.map((t) => [...t.querySelector("tr").children].map((td) => Math.round(td.getBoundingClientRect().width)));
  });
  ok("both tables render", widths.length === 2, JSON.stringify(widths));
  ok("the wide table's three explicit columns are untouched", widths[0].every((w) => w >= 380), JSON.stringify(widths[0]));
  ok("the narrow, never-touched table stays its own ordinary width (not forced wide by its sibling)", widths[1].every((w) => w < 380), JSON.stringify(widths[1]));
}

/* ════════════════════════ CASE 8 — a table inside a box placed outside the text column ═ */
console.log("\n[8] A table inside a note placed outside the text column:");
{
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph" },
      {
        type: "noteAnchor",
        attrs: { aid: "box1", x: 650, y: 20, w: 320, h: null },
        content: [{ type: "table", content: [row([cell("A", [300]), cell("B", [300])])] }],
      },
    ],
  };
  await seed(doc, "Table in a box");
  const widths = await colWidths();
  ok("the table inside the placed box renders at its explicit widths", widths && widths[0] >= 280 && widths[1] >= 280, JSON.stringify(widths));
  const grown = await sheetWidth();
  ok("the sheet grows to reach a table inside a box placed past the right margin", grown > 580, `grown=${grown}`);
}

/* ════════════════════════ CASE 9 — narrower than the sheet ═════════════════════════════ */
console.log("\n[9] The whole set at a window narrower than the sheet:");
{
  await page.setViewportSize({ width: 420, height: 800 });
  const doc = { type: "doc", content: [{ type: "table", content: [row([cell("A"), cell("B"), cell("C", [400])])] }] };
  await seed(doc, "Narrow window");
  const widths = await colWidths();
  ok("a wide table still renders its explicit column at full width on a narrow window", widths && widths[2] >= 380, JSON.stringify(widths));
  const overflowX = await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    return mat.scrollWidth > mat.clientWidth;
  });
  ok("the OUTER pane scrolls horizontally rather than the page silently clipping", overflowX);
  await page.setViewportSize({ width: 1500, height: 950 });
}

/* ════════════════════════ CASE 10 — PDF-PARITY: the real toolbar Print button ══════════ */
console.log("\n[10] PDF-PARITY — the real toolbar Print button, not just the pure builder:");
{
  const doc = {
    type: "doc",
    content: [{
      type: "table",
      content: [row([
        cell("AHJ"), cell("Permit"), cell("Number"),
        cell("Notes", [300]), cell("Status", [300]),
      ])],
    }],
  };
  await seed(doc, "Print parity");
  await page.click('[data-testid="nt-print"]');
  await page.waitForTimeout(600);
  const printed = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="notes-print-frame"]');
    const pdoc = frame?.contentDocument;
    if (!pdoc) return { found: false };
    const table = pdoc.querySelector("table");
    const tds = table ? [...table.querySelectorAll("tr")[0].children].map((td) => td.getAttribute("colwidth")) : null;
    const sheet = pdoc.querySelector(".sheet");
    return { found: true, tds, sheetStyle: sheet?.getAttribute("style") || "" };
  });
  ok("the print iframe rendered", printed.found, JSON.stringify(printed));
  if (printed.found) {
    ok("AHJ/Permit/Number print at the SAME repaired widths the screen shows (not squeezed)",
      printed.tds && printed.tds[0] === "160" && printed.tds[1] === "160" && printed.tds[2] === "160",
      JSON.stringify(printed.tds));
    ok("the two explicit columns print at their own width", printed.tds && printed.tds[3] === "300" && printed.tds[4] === "300", JSON.stringify(printed.tds));
  }
}

/* ════════════════════════ CASE 11 — narrowing back, and an ordinary table never grows ═══ */
console.log("\n[11] Narrowing a column back down, and a table that already fits stays put:");
{
  // 11a — widen then narrow the SAME column back; it should shrink smoothly, well above the
  // floor, with siblings undisturbed throughout.
  const doc = { type: "doc", content: [{ type: "table", content: [row([cell("A"), cell("B"), cell("C")])] }] };
  await seed(doc, "Narrow back");
  const handle0 = await page.evaluate(() => {
    const td = document.querySelector('[data-testid="note-body"] table tr td');
    const r = td.getBoundingClientRect();
    return { x: Math.round(r.right - 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(handle0.x, handle0.y);
  await page.mouse.down();
  await page.mouse.move(handle0.x + 200, handle0.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const widened = await colWidths();
  const handle1 = await page.evaluate(() => {
    const td = document.querySelector('[data-testid="note-body"] table tr td');
    const r = td.getBoundingClientRect();
    return { x: Math.round(r.right - 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(handle1.x, handle1.y);
  await page.mouse.down();
  await page.mouse.move(handle1.x - 120, handle1.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const narrowed = await colWidths();
  ok("narrowing back shrinks the column well above the floor", narrowed[0] < widened[0] && narrowed[0] >= TABLE_COL_MIN_WIDTH,
    JSON.stringify({ widened, narrowed }));
  ok("shrinking back doesn't disturb siblings either", narrowed[1] === widened[1] && narrowed[2] === widened[2], JSON.stringify({ widened, narrowed }));

  // 11b — a table sized well within the ordinary sheet never grows it, matching pre-existing
  // behaviour for a plain, untouched table exactly.
  const plainDoc = { type: "doc", content: [{ type: "table", content: [row([cell("A"), cell("B")])] }] };
  await seed(plainDoc, "Ordinary width");
  const grownForPlain = await sheetWidth();
  ok("an ordinary table never grows the sheet past its natural width", grownForPlain <= 580, `sheetWidth=${grownForPlain}`);
}

console.log(`\n${pass} passed, ${fail} failed. JS errors: ${errs.length}`);
if (errs.length) console.log(errs.slice(0, 5).join("\n"));
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
