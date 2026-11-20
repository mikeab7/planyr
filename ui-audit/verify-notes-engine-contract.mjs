#!/usr/bin/env node
/* verify-notes-engine-contract — WHAT THE NOTES EDITOR RELIES ON FROM ITS UPSTREAM ENGINE (Tiptap), PINNED AT THE BROWSER
 * (NEW-1, 2026-11-05: the Tiptap 3.29 → 3.33 upgrade and the move onto upstream's own hooks).
 *
 * An upgrade can change a default that a decided Planyr behaviour sits on top of — silently, with every unit test green. Each
 * arm below is a place the upgrade DID or COULD do that, driven through the real editor and judged on the stored document / the
 * live DOM:
 *
 *   A. TAB AFTER A LIST. Tiptap 3.33's list keymap gained a Tab that moves a paragraph starting right after a list INTO the
 *      list's last item (measured on the upgraded build: the paragraph became a second child of the last bullet). The pinned Tab
 *      table (lib/notesTabKey.js) says a plain paragraph gets a real tab character and Tab never re-parents a node. Known-good
 *      arm: Tab on the SECOND bullet still nests it under the first (the list's own behaviour is untouched).
 *   B. COLUMN WIDTH UNDO. NoteTableView subclasses the library's TableView (3.33 still leaves a stale `width` on a column that goes
 *      from dragged back to unset). A column set to 260, then undone, must read min-width only — and the width must really be
 *      there while it is set (known-good arm: a view that never applied a width would pass the undo half).
 *   C. A RIGHT-CLICK ON A MULTI-CELL SELECTION. 3.33 added a plugin that preserves a cell selection on context-menu press;
 *      Ctrl+click's MultiCellSelection (a CellSelection subclass) must come through it intact.
 *   D. A STYLE VALUE CANNOT BREAK OUT OF ITS DECLARATION. A font family stored as `Arial; background: red` renders no
 *      `background` (the editor's FontFamily / FontSize now use the library's isValidCSSStyleValue).
 *
 * `BASE_URL` (default http://127.0.0.1:5199) · `PW_CHROME`. Any known-good arm failing VOIDS the run (exit 2). */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const EXEC = process.env.PW_CHROME || undefined;
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-engine-contract");

let passN = 0; let failN = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};
const voided = async (why) => { console.log(`\nVOID: ${why}`); await browser.close(); process.exit(2); };

const t = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const para = (text, marks) => ({ type: "paragraph", content: text ? [t(text, marks)] : [] });
const box = (aid, content) => ({ type: "noteAnchor", attrs: { x: 40, y: 40, w: 520, h: null, aid }, content });
const cell = (text) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para(text)] });
const row = (...c) => ({ type: "tableRow", content: c });

async function seed(content) {
  /* ⛔ LEAVE THE PAGE FIRST. An editor that was edited flushes its document to storage as the tab unloads — so a seed written while
   * the previous section's editor is still alive is overwritten by that section's own (undone) document on the reload, and the
   * next section silently runs against the wrong fixture. */
  await page.goto("about:blank");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Throwaway", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, { type: "doc", content }]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 800);
}
async function clickAt(needle, mods = [], button = "left") {
  const p = await page.evaluate((n) => {
    const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const i = node.nodeValue.indexOf(n);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + n.length);
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    }
    return null;
  }, needle);
  if (!p) throw new Error(`could not find "${needle}" to click — page shows: ${JSON.stringify(await page.evaluate(() => (document.querySelector(".ProseMirror")?.innerText || "").replace(/\s+/g, " ").slice(0, 160)))}`);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down({ button }); await pacedWait(page, 50); await page.mouse.up({ button });
  for (const m of mods.slice().reverse()) await page.keyboard.up(m);
  await pacedWait(page, 250);
}
/** Desktop is TWO-STAGE: press 1 selects the box, press 2 (spaced out, not a double-click) puts the caret in. */
const enter = async (needle) => { await clickAt(needle); await pacedWait(page, 650); await clickAt(needle); };
const stored = async () => { await pacedWait(page, 1200); return JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY) || "null"); };

/* ── A. TAB AFTER A LIST ─────────────────────────────────────────────────────────────────────────────────────── */
console.log("\n=== A. Tab at the start of a paragraph right after a list ===");
const list = () => ({ type: "bulletList", content: [{ type: "listItem", content: [para("Bullet one")] }, { type: "listItem", content: [para("Bullet two")] }] });
await seed([box("b1", [list(), para("After the list")]), para("")]);
await enter("Bullet two");
await page.evaluate(() => window.__noteEditor.caretAt(window.__noteEditor.startOf([0, 0, 1, 0])));
await pacedWait(page, 200);
await page.keyboard.press("Tab"); await pacedWait(page, 400);
{
  const d = await stored();
  const items = d.content[0].content[0].content;
  ok("[known-good] Tab on the second bullet nests it under the first (the list's own Tab is untouched)", items.length === 1 && items[0].content.length === 2, JSON.stringify(items.map((i) => i.content.length)));
}
if (failN) await voided("Tab did not nest a list item — the harness cannot see a Tab, so the paragraph arm below means nothing.");
await seed([box("b1", [list(), para("After the list")]), para("")]);
await enter("After the list");
await page.evaluate(() => window.__noteEditor.caretAt(window.__noteEditor.startOf([0, 1])));
await pacedWait(page, 200);
await page.keyboard.press("Tab"); await pacedWait(page, 400);
{
  const d = await stored();
  const inner = d.content[0].content;
  const lastItem = inner[0].content[inner[0].content.length - 1];
  ok("Tab at the start of the paragraph after the list does NOT move it into the last bullet", lastItem.content.length === 1, `last item children: ${lastItem.content.length}`);
  ok("…the paragraph is still its own block after the list", inner.length === 2 && inner[1].type === "paragraph", JSON.stringify(inner.map((n) => n.type)));
  ok("…and it holds a real tab character (Tab in a plain paragraph inserts one)", /^\t/.test(inner[1]?.content?.[0]?.text || ""), JSON.stringify(inner[1]?.content));
}

/* ── B. COLUMN WIDTH, SET THEN UNDONE ────────────────────────────────────────────────────────────────────── */
console.log("\n=== B. A column set to a width, then undone, drops the width ===");
await seed([box("b1", [{ type: "table", content: [row(cell("A1"), cell("B1")), row(cell("A2"), cell("B2"))] }]), para("")]);
await enter("A1");
const colStyles = () => page.evaluate(() => [...document.querySelectorAll(".ProseMirror table colgroup col")].map((c) => ({ w: c.style.width, m: c.style.minWidth })));
{
  const ran = await page.evaluate(() => window.__noteEditor.runCommand("setCellAttribute", "colwidth", [260]));
  await pacedWait(page, 400);
  const cols = await colStyles();
  ok("[known-good] setting a column width reaches the live <col> (width 260px, no min-width)", ran && cols[0] && cols[0].w === "260px" && cols[0].m === "", JSON.stringify(cols));
  if (!(ran && cols[0] && cols[0].w === "260px")) await voided("the column width never reached the DOM — the undo arm below would pass vacuously.");
  await page.evaluate(() => window.__noteEditor.runCommand("undo")); await pacedWait(page, 500);
  const after = await colStyles();
  ok("after undo the first column has NO stale width and carries its min-width", after[0] && after[0].w === "" && after[0].m !== "", JSON.stringify(after));
}

/* ── C. A RIGHT-CLICK ON A MULTI-CELL SELECTION ──────────────────────────────────────────────────────────── */
console.log("\n=== C. Right-click on a Ctrl+click multi-selection keeps it ===");
await seed([box("b1", [{ type: "table", content: [row(cell("A1"), cell("B1"), cell("C1")), row(cell("A2"), cell("B2"), cell("C2"))] }]), para("")]);
const dbg = async (tag) => { if (process.env.DBG) console.log("   [dbg]", tag, JSON.stringify(await page.evaluate(() => document.querySelectorAll(".ProseMirror td").length + " td; " + document.querySelector(".ProseMirror").innerText.replace(/\s+/g, " ")))); };
await dbg("seeded");
await enter("A1");
await dbg("entered");
const selected = () => page.evaluate(() => [...document.querySelectorAll(".ProseMirror .selectedCell")].map((c) => c.textContent.trim()).sort());
await clickAt("B2"); await dbg("B2"); await clickAt("A1"); await dbg("A1"); await clickAt("C2", ["Control"]);
{
  const before = await selected();
  ok("[known-good] Ctrl+click highlights both cells", JSON.stringify(before) === JSON.stringify(["A1", "C2"]), JSON.stringify(before));
  if (JSON.stringify(before) !== JSON.stringify(["A1", "C2"])) await voided("Ctrl+click did not multi-select — the right-click arm would pass vacuously.");
  await clickAt("C2", [], "right");
  const afterRight = await selected();
  ok("right-clicking one of the selected cells keeps BOTH selected", JSON.stringify(afterRight) === JSON.stringify(["A1", "C2"]), JSON.stringify(afterRight));
  await page.keyboard.press("Escape");
}

/* ── D. A STYLE VALUE CANNOT BREAK OUT OF ITS DECLARATION ───────────────────────────────────────────────── */
console.log("\n=== D. A stored font value with a ';' renders no extra declaration ===");
await seed([box("b1", [{ type: "paragraph", content: [t("Fine", [{ type: "textStyle", attrs: { fontFamily: "Georgia" } }]), t("Hostile", [{ type: "textStyle", attrs: { fontFamily: "Arial; background: red", fontSize: "12px; color: red" } }])] }]), para("")]);
{
  const styles = await page.evaluate(() => [...document.querySelectorAll(".ProseMirror span")].map((s) => ({ text: s.textContent, style: s.getAttribute("style") || "" })));
  const fine = styles.find((s) => s.text === "Fine");
  const bad = styles.find((s) => s.text === "Hostile");
  ok("[known-good] a plain font family still renders (Georgia)", !!fine && /Georgia/.test(fine.style), JSON.stringify(styles));
  ok("a family with ';' renders no declaration of its own (no `background`)", !bad || !/background/.test(bad.style), JSON.stringify(bad));
  ok("a size with ';' renders no declaration of its own (no `color`)", !bad || !/color/.test(bad.style), JSON.stringify(bad));
}

ok("no page error", errs.length === 0, errs.slice(0, 3).join(" | "));
console.log(`\n${passN} passed, ${failN} failed`);
await browser.close();
process.exit(failN ? 1 : 0);
