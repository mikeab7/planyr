#!/usr/bin/env node
/* verify-notes-table-copy-paste — A TABLE THAT IS ALREADY ON A NOTES PAGE CAN BE COPIED, CUT AND
 * PASTED (NEW-1, owner report 2026-10-06: "I'm trying to copy a table that's already in the notebook
 * module, and I can't paste it.").
 *
 * Distinct from verify-notes-table-paste.mjs (a table arriving FROM another app): here the clipboard is
 * written by the editor's OWN Ctrl+C / Ctrl+X, then read back by a real Ctrl+V. Trusted input throughout —
 * Playwright keyboard/mouse, the real clipboard (clipboard-read/write granted), no synthetic ClipboardEvent.
 *
 * Every case asserts STRUCTURE on the STORED document (table count, rows × columns, cell text, header row,
 * column widths, bold), and every paste case reloads the page to prove it persisted.
 *
 * ⛔ KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): the same real Ctrl+C → Ctrl+V on plain paragraph text
 * must land. If it does not, the harness (clipboard grant, focus) is on trial and the run is VOID.
 *
 * `BASE_URL` (default http://localhost:4173) · `ONLY=<case,case>` to narrow.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || undefined;
const TREE_KEY = "planyr:notes:tree:v1:local";
const PK = (id) => `planyr:notes:page:v1:local:${id}`;
const ACTIVE_KEY = "planyr:notes:activePage:v1:local";
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-table-copy-paste");

let passN = 0; let failN = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; failures.push(label); console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};

/* ── fixtures ─────────────────────────────────────────────────────────────────────────── */
const para = (text, marks) => ({ type: "paragraph", content: text ? [{ type: "text", text, ...(marks ? { marks } : {}) }] : [] });
const cell = (t, colwidth, marks, kind = "tableCell") => ({ type: kind, attrs: { colspan: 1, rowspan: 1, colwidth: colwidth ?? null }, content: [para(t, marks)] });
const SRC_TABLE = () => ({ type: "table", content: [
  { type: "tableRow", content: [cell("Item", [120], null, "tableHeader"), cell("Qty", [140], null, "tableHeader"), cell("Cost", [160], null, "tableHeader")] },
  { type: "tableRow", content: [cell("Slab", [120]), cell("12", [140]), cell("Bold $5", [160], [{ type: "bold" }])] },
  { type: "tableRow", content: [cell("Steel", [120]), cell("7", [140]), cell("$9", [160])] },
] });
const SRC_GRID = [["Item", "Qty", "Cost"], ["Slab", "12", "Bold $5"], ["Steel", "7", "$9"]];
const box = (aid, x, y, content, w = 420) => ({ type: "noteAnchor", attrs: { x, y, w, h: null, aid }, content });
const trailing = () => para("");
const TWO_BOXES = () => [box("b1", 40, 40, [SRC_TABLE()]), box("b2", 40, 420, [para("Target text")]), trailing()];
const ONE_BOX = () => [box("b1", 40, 40, [SRC_TABLE()]), trailing()];
const OTHER_TABLE = () => ({ type: "table", content: [
  { type: "tableRow", content: [cell("A1"), cell("A2")] }, { type: "tableRow", content: [cell("B1"), cell("B2")] },
] });
const TREE = {
  v: 3, tombs: [], trash: [],
  pages: [
    { id: "p1", title: "Source", createdAt: 1, updatedAt: 1, projectId: null, pages: [] },
    { id: "p2", title: "Other notebook", createdAt: 1, updatedAt: 1, projectId: null, pages: [{ id: "p3", title: "Other notebook page", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] },
  ],
};

async function seed(p1Doc, active = "p1") {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tree, d1, act, ak]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    localStorage.setItem("planyr:notes:tree:v1:local", JSON.stringify(tree));
    localStorage.setItem("planyr:notes:page:v1:local:p1", JSON.stringify({ type: "doc", content: d1 }));
    localStorage.setItem("planyr:notes:page:v1:local:p2", JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }));
    localStorage.setItem("planyr:notes:page:v1:local:p3", JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }));
    localStorage.setItem(ak, act);
  }, [TREE, p1Doc, active, ACTIVE_KEY]);
  await reload();
}
async function reload() {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 800);
}
const stored = async (id = "p1") => JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PK(id)) || "null");

/* ── structure reading ────────────────────────────────────────────────────────────────── */
const cellInfo = (c) => {
  const texts = []; const marks = [];
  const w = (n) => { if (!n) return; if (n.text) { texts.push(n.text); (n.marks || []).forEach((m) => marks.push(`${n.text}:${m.type}`)); } (n.content || []).forEach(w); };
  w(c);
  return { t: texts.join(""), header: c.type === "tableHeader", colwidth: c.attrs?.colwidth || null, marks };
};
function tablesOf(doc) {
  const out = [];
  const walk = (n, inBox) => {
    if (!n) return;
    if (n.type === "table") {
      out.push({ inBox, rows: (n.content || []).map((r) => (r.content || []).map(cellInfo)) });
      return;
    }
    (n.content || []).forEach((c) => walk(c, inBox || n.type === "noteAnchor"));
  };
  walk(doc, false);
  return out;
}
const gridOf = (t) => t.rows.map((r) => r.map((c) => c.t));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const describe = (tabs) => JSON.stringify(tabs.map((t) => ({ inBox: t.inBox, grid: gridOf(t) })));

/** Is a table "intact" — grid text, header row, widths and bold all kept? */
function intactProblems(t, label = "") {
  const p = [];
  if (!t) return [`${label}no table`];
  if (!same(gridOf(t), SRC_GRID)) p.push(`${label}grid ${JSON.stringify(gridOf(t))}`);
  if (!t.rows[0]?.every((c) => c.header)) p.push(`${label}header row lost`);
  if (t.rows[1]?.some((c) => c.header)) p.push(`${label}data row became header`);
  const w = t.rows[1]?.map((c) => c.colwidth && c.colwidth[0]);
  if (!same(w, [120, 140, 160])) p.push(`${label}column widths ${JSON.stringify(w)}`);
  if (!t.rows[1]?.[2]?.marks.some((m) => m.endsWith(":bold"))) p.push(`${label}bold formatting lost`);
  return p;
}

/* ── real input helpers ───────────────────────────────────────────────────────────────── */
async function pointIn(needle, which = "mid") {
  const p = await page.evaluate(([n, w]) => {
    const walker = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.nodeValue.indexOf(n);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, w === "end" ? i + n.length : i + 1); r.collapse(true);
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) };
    }
    return null;
  }, [needle, which]);
  if (!p) throw new Error(`could not find "${needle}" on the page`);
  return p;
}
const clickAt = async (needle, which) => { const p = await pointIn(needle, which); await page.mouse.click(p.x, p.y); await pacedWait(page, 250); };
/** Desktop is TWO-STAGE: press 1 on a box SELECTS it, a second spaced press puts the caret in. */
async function enter(needle, which) { await clickAt(needle, which); await pacedWait(page, 650); await clickAt(needle, which); }
/** Real drag between two cells' text → a cell range inside a box that is already being edited. */
async function dragCells(fromNeedle, toNeedle) {
  const a = await pointIn(fromNeedle); const b = await pointIn(toNeedle, "end");
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  await pacedWait(page, 250);
}
const selectWholeTable = async () => { await enter("Item"); await dragCells("Item", "$9"); };
const key = async (k) => { await page.keyboard.press(k); await pacedWait(page, 700); };
const copy = () => key(`${MOD}+c`);
const cut = () => key(`${MOD}+x`);
const pasteKey = () => key(`${MOD}+v`);
const undo = () => key(`${MOD}+z`);
const readClipboard = () => page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const out = {};
  for (const it of items) for (const t of it.types) out[t] = await (await it.getType(t)).text();
  return out;
});
async function armBlank(fx, fy) {
  const at = await page.evaluate(([a, b]) => {
    const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
    return { x: Math.round(s.left + s.width * a), y: Math.round(s.top + s.height * b) };
  }, [fx, fy]);
  await page.mouse.dblclick(at.x, at.y);
  await pacedWait(page, 450);
  if (!(await page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]')))) throw new Error("blank paper did not arm — harness not in the state it claims");
}
async function openPage(id) {
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [ACTIVE_KEY, id]);
  await reload();
}
/** Wait for the debounced save to land the doc, then reload and re-read it. */
async function persisted(id) { await pacedWait(page, 1500); await reload(); return stored(id); }
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const run = (name) => !only || only.includes(name);

/* ── KNOWN-GOOD ARM ───────────────────────────────────────────────────────────────────── */
console.log("\n=== KNOWN-GOOD ARM — real Ctrl+C → Ctrl+V of plain paragraph text must land ===");
await seed([box("b1", 40, 40, [para("Plain source words")]), box("b2", 40, 420, [para("Target text")]), trailing()]);
await enter("Plain source words");
{ const q = await pointIn("Plain source words"); await page.mouse.click(q.x, q.y, { clickCount: 3 }); await pacedWait(page, 250); }
await copy();
await enter("Target text", "end");
await pasteKey();
const armDoc = await stored();
if (process.env.DEBUG_ARM) console.log("TEXTS", JSON.stringify(armDoc).match(/"text":"[^"]*"/g), "CLIP", JSON.stringify(await readClipboard()).slice(0, 300));
const armOk = /Target text\s*Plain source words|Target textPlain source words/.test(JSON.stringify(armDoc).replace(/"\},\{"type":"text"[^}]*"text":"/g,""))||(JSON.stringify(armDoc).match(/Plain source words/g)||[]).length===2;
ok("plain text copies and pastes with real keys", armOk, JSON.stringify(armDoc).slice(0, 300));
if (!armOk) { console.log("\nVOID: the known-good arm failed — the harness cannot copy/paste, so no table verdict means anything."); await browser.close(); process.exit(2); }

/* ── CASES ────────────────────────────────────────────────────────────────────────────── */
async function caseWholeTableInto(name, label, prep, check) {
  if (!run(name)) return;
  console.log(`\n=== ${label} ===`);
  await prep();
  await check();
}

await caseWholeTableInto("whole→other-box", "Whole table → Ctrl+C → Ctrl+V into a DIFFERENT box on the same page", async () => {
  await seed(TWO_BOXES());
  await selectWholeTable();
  await copy();
  const src = await stored();
  ok("copy leaves the original table untouched", intactProblems(tablesOf(src)[0], "orig: ").length === 0, intactProblems(tablesOf(src)[0]).join("; "));
  await enter("Target text", "end");
  await pasteKey();
}, async () => {
  const d = await persisted("p1");
  const tabs = tablesOf(d);
  ok("two tables on the page after the paste", tabs.length === 2, describe(tabs));
  ok("original table is still intact", tabs[0] && intactProblems(tabs[0], "orig: ").length === 0, tabs[0] && intactProblems(tabs[0]).join("; "));
  ok("pasted copy keeps rows, columns, text, header row, widths, bold", tabs[1] && intactProblems(tabs[1], "copy: ").length === 0, tabs[1] ? intactProblems(tabs[1]).join("; ") : describe(tabs));
});

await caseWholeTableInto("whole→blank-paper", "Whole table → copy → paste on BLANK PAPER with a caret armed (must create a box)", async () => {
  await seed(ONE_BOX());
  await selectWholeTable();
  await copy();
  await armBlank(0.55, 0.7);
  await pasteKey();
}, async () => {
  const d = await persisted("p1");
  const tabs = tablesOf(d);
  ok("two tables on the page", tabs.length === 2, describe(tabs));
  ok("the pasted table sits inside a box", tabs[1]?.inBox === true, describe(tabs));
  ok("pasted copy is intact", tabs[1] && intactProblems(tabs[1], "copy: ").length === 0, tabs[1] ? intactProblems(tabs[1]).join("; ") : "");
});

await caseWholeTableInto("whole→nothing-focused", "Whole table → copy → paste with NOTHING focused (must create a box)", async () => {
  await seed(ONE_BOX());
  await selectWholeTable();
  await copy();
  await page.locator('[data-testid="note-title"]').click();
  await page.evaluate(() => document.activeElement?.blur?.());
  await pacedWait(page, 250);
  await pasteKey();
}, async () => {
  const d = await persisted("p1");
  const tabs = tablesOf(d);
  ok("two tables on the page", tabs.length === 2, describe(tabs));
  ok("pasted copy is intact and in a box", tabs[1] && tabs[1].inBox && intactProblems(tabs[1], "copy: ").length === 0, tabs[1] ? intactProblems(tabs[1]).join("; ") : "");
});

await caseWholeTableInto("whole→other-page", "Whole table → copy → paste on ANOTHER PAGE", async () => {
  await seed(ONE_BOX());
  await selectWholeTable();
  await copy();
  await openPage("p2");
  await armBlank(0.3, 0.3);
  await pasteKey();
}, async () => {
  const d = await persisted("p2");
  const tabs = tablesOf(d);
  ok("one table on the other page", tabs.length === 1, describe(tabs));
  ok("it is intact", tabs[0] && intactProblems(tabs[0], "copy: ").length === 0, tabs[0] ? intactProblems(tabs[0]).join("; ") : "");
  ok("the source page still has its table", tablesOf(await stored("p1")).length === 1);
});

await caseWholeTableInto("whole→other-notebook", "Whole table → copy → paste in ANOTHER NOTEBOOK", async () => {
  await seed(ONE_BOX());
  await selectWholeTable();
  await copy();
  await openPage("p3");
  await armBlank(0.3, 0.3);
  await pasteKey();
}, async () => {
  const d = await persisted("p3");
  const tabs = tablesOf(d);
  ok("one table in the other notebook", tabs.length === 1, describe(tabs));
  ok("it is intact", tabs[0] && intactProblems(tabs[0], "copy: ").length === 0, tabs[0] ? intactProblems(tabs[0]).join("; ") : "");
});

await caseWholeTableInto("cut→paste", "Whole table → Ctrl+X → Ctrl+V into another box (move), then undo", async () => {
  await seed(TWO_BOXES());
  await selectWholeTable();
  await cut();
  const afterCut = tablesOf(await stored());
  ok("cut removes the table from its box", afterCut.length === 0, describe(afterCut));
  await enter("Target text", "end");
  await pasteKey();
}, async () => {
  const d1 = await stored();
  const tabs = tablesOf(d1);
  ok("exactly one table after cut + paste", tabs.length === 1, describe(tabs));
  ok("the moved table is intact", tabs[0] && intactProblems(tabs[0], "moved: ").length === 0, tabs[0] ? intactProblems(tabs[0]).join("; ") : "");
  await undo();
  ok("undo removes the pasted table", tablesOf(await stored()).length === 0, describe(tablesOf(await stored())));
  await undo();
  if (process.env.DEBUG_UNDO) { console.log("AFTER-UNDO2", describe(tablesOf(await stored()))); for (let i = 3; i < 7; i += 1) { await undo(); console.log("AFTER-UNDO" + i, describe(tablesOf(await stored())), "focus:", await page.evaluate(() => document.activeElement?.className)); } }
  const back = tablesOf(await stored());
  ok("a second undo brings the cut table back, intact", back.length === 1 && intactProblems(back[0], "undone-cut: ").length === 0, describe(back));
});

await caseWholeTableInto("cut-undo", "Whole table → Ctrl+X → Ctrl+Z brings the table straight back", async () => {
  await seed(TWO_BOXES());
  await selectWholeTable();
  await cut();
  await undo();
}, async () => {
  const tabs = tablesOf(await stored());
  ok("one intact table after undoing the cut", tabs.length === 1 && intactProblems(tabs[0], "undo-cut: ").length === 0, describe(tabs));
});

await caseWholeTableInto("paste-undo", "Paste → Ctrl+Z removes exactly the pasted table", async () => {
  await seed(TWO_BOXES());
  await selectWholeTable();
  await copy();
  await enter("Target text", "end");
  await pasteKey();
  await undo();
}, async () => {
  const tabs = tablesOf(await stored());
  ok("one table (the original) after undoing the paste", tabs.length === 1 && intactProblems(tabs[0], "orig: ").length === 0, describe(tabs));
});

await caseWholeTableInto("range→existing-table", "A 2×2 cell range → copy → paste into an existing table", async () => {
  await seed([box("b1", 40, 40, [SRC_TABLE()]), box("b2", 40, 420, [OTHER_TABLE()]), trailing()]);
  await enter("Slab");
  await dragCells("Slab", "7");
  await copy();
  await enter("A1");
  await pasteKey();
}, async () => {
  const d = await persisted("p1");
  const tabs = tablesOf(d);
  const t = tabs[1];
  ok("still two tables", tabs.length === 2, describe(tabs));
  ok("source table untouched", tabs[0] && same(gridOf(tabs[0]), SRC_GRID), tabs[0] && JSON.stringify(gridOf(tabs[0])));
  ok("the 2×2 block (Slab/12/Steel/7) landed from the target's first cell", t && same(t.rows.slice(0, 2).map((r) => r.slice(0, 2).map((c) => c.t)), [["Slab", "12"], ["Steel", "7"]]), t && JSON.stringify(gridOf(t)));
});

await caseWholeTableInto("range→blank", "A cell range (2 rows × 2 columns) → copy → paste into empty space (must create a box with that 2×2 table)", async () => {
  await seed(ONE_BOX());
  await enter("Slab");
  await dragCells("Slab", "7");
  await copy();
  await armBlank(0.55, 0.7);
  await pasteKey();
}, async () => {
  const d = await persisted("p1");
  const tabs = tablesOf(d);
  ok("two tables", tabs.length === 2, describe(tabs));
  ok("the new box holds the 2×2 range", tabs[1] && same(gridOf(tabs[1]), [["Slab", "12"], ["Steel", "7"]]), tabs[1] && JSON.stringify(gridOf(tabs[1])));
});

await caseWholeTableInto("box-copy", "Copy the whole BOX holding the table (box selected, Ctrl+C) → paste on another page", async () => {
  await seed(ONE_BOX());
  await clickAt("Item");                       // press 1 only SELECTS the box
  await pacedWait(page, 500);
  await copy();
  await openPage("p2");
  await armBlank(0.3, 0.3);
  await pasteKey();
}, async () => {
  const tabs = tablesOf(await persisted("p2"));
  ok("the table arrived on the other page", tabs.length === 1 && intactProblems(tabs[0], "boxcopy: ").length === 0, describe(tabs));
});

await caseWholeTableInto("clipboard-out", "Copy OUT — the clipboard holds a real table in text/html AND tab-separated text/plain", async () => {
  await seed(ONE_BOX());
  await selectWholeTable();
  await copy();
}, async () => {
  const clip = await readClipboard();
  ok("text/html is on the clipboard and carries a <table> with all cells", !!clip["text/html"] && /<table/i.test(clip["text/html"]) && ["Item", "Qty", "Cost", "Slab", "12", "Steel", "$9"].every((s) => clip["text/html"].includes(s)), (clip["text/html"] || "").slice(0, 200));
  const lines = (clip["text/plain"] || "").replace(/\r/g, "").split("\n").filter(Boolean);
  ok("text/plain is tab-separated (Excel / Sheets paste it as a grid)", same(lines.map((l) => l.split("\t")), SRC_GRID), JSON.stringify(lines));
  // Round-trip proof of the OUTBOUND html: feed exactly what a Word / Excel / Sheets paste would receive back in.
  await armBlank(0.55, 0.7);
  await pasteKey();
  const tabs = tablesOf(await stored());
  ok("its own clipboard re-pastes as a table", tabs.length === 2 && same(gridOf(tabs[1]), SRC_GRID), describe(tabs));
});

await caseWholeTableInto("context-menu", "Right-click → Copy / Paste (the editor's own menu)", async () => {
  await seed(TWO_BOXES());
  await selectWholeTable();
  const p = await pointIn("Slab");
  await page.mouse.click(p.x, p.y, { button: "right" });
  await pacedWait(page, 500);
}, async () => {
  const copyItem = page.locator('[role="menuitem"]:has-text("Copy")').first();
  const has = await copyItem.count();
  ok("the right-click menu offers Copy", has > 0, "no Copy item found");
  if (!has) return;
  await copyItem.click(); await pacedWait(page, 700);
  await enter("Target text", "end");
  const p = await pointIn("Target text", "end");
  await page.mouse.click(p.x, p.y, { button: "right" });
  await pacedWait(page, 500);
  const pasteItem = page.locator('[role="menuitem"]:has-text("Paste")').first();
  ok("the right-click menu offers Paste", (await pasteItem.count()) > 0, "no Paste item found");
  if (await pasteItem.count()) {
    await pasteItem.hover(); await pacedWait(page, 400);
    const keep = page.locator('[role="menuitem"]:has-text("Keep source formatting")').first();
    ok("Paste offers Keep source formatting", (await keep.count()) > 0, "no sub-item");
    if (await keep.count()) { await keep.click(); await pacedWait(page, 1200); }
  }
  const tabs = tablesOf(await persisted("p1"));
  ok("menu paste produced a second intact table", tabs.length === 2 && tabs[1] && intactProblems(tabs[1], "menu: ").length === 0, describe(tabs));
});

await caseWholeTableInto("select-button", "Caret in a cell → 'Select table' button → Ctrl+C → paste into another box", async () => {
  await seed(TWO_BOXES());
  await enter("Slab");
  await page.locator('[data-testid="nt-table-select"]').click();
  await pacedWait(page, 300);
  await copy();
  await enter("Target text", "end");
  await pasteKey();
}, async () => {
  const tabs = tablesOf(await persisted("p1"));
  ok("two tables, the copy intact", tabs.length === 2 && tabs[1] && intactProblems(tabs[1], "button: ").length === 0, describe(tabs));
});

await caseWholeTableInto("select-button-cut", "'Select table' button → Ctrl+X removes the table (not just its text)", async () => {
  await seed(TWO_BOXES());
  await enter("Slab");
  await page.locator('[data-testid="nt-table-select"]').click();
  await pacedWait(page, 300);
  await cut();
}, async () => {
  const tabs = tablesOf(await persisted("p1"));
  ok("no table left on the page", tabs.length === 0, describe(tabs));
});

await caseWholeTableInto("box-cut", "Box selected → Ctrl+X → paste elsewhere: the box goes, the table arrives intact", async () => {
  await seed(TWO_BOXES());
  await clickAt("Item");
  await pacedWait(page, 500);
  await cut();
  await enter("Target text", "end");
  await pasteKey();
}, async () => {
  const tabs = tablesOf(await persisted("p1"));
  ok("exactly one table, intact, after cutting the box", tabs.length === 1 && intactProblems(tabs[0], "boxcut: ").length === 0, describe(tabs));
});

console.log(`\n${passN} passed, ${failN} failed${errs.length ? ` · page errors: ${errs.slice(0, 3).join(" | ")}` : ""}`);
if (failN) console.log(`FAILED:\n - ${failures.join("\n - ")}`);
await browser.close();
process.exit(failN ? 1 : 0);
