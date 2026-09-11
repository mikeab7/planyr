/* verify-notes-sheet-bottom-strip — B1550976/NEW-1: THE WHITE PAGE'S OWN BOTTOM PADDING IS NOT
 * BLANK MAT, AND A CLICK THERE MUST REACH THE DOCUMENT (owner report 2026-09-11, live on
 * planyr.io, Goose Creek → Notes, a page from the Project Contacts template).
 *
 * ⛔ THE MEASURED CAUSE, so this harness tests the actual mechanism rather than a guess.
 * `note-sheet` pads its own bottom by 96px of real white page; that strip sits OUTSIDE
 * `note-body`'s (the ProseMirror contenteditable's) own rendered box. `focusFromMat` clamps a
 * press's coordinates to that box before resolving a document position, so a press deep in the
 * strip resolved a position at the very last line, `pressIsBesideLine` correctly refused it (a
 * whole padding's worth below the last line, not one line-height beyond it), and the press fell
 * through to the grey MAT's "place a note" gesture — built for the page OUTSIDE the sheet, not
 * blank paper still inside it. So the OLD caret is what stayed on screen — "it's just... taking
 * it to near the geotechnical engineer" was the old caret never having moved at all.
 *
 * ⛔ A REAL MOUSE, NEVER A SYNTHETIC EVENT (docs/NOTES-CARRY-FORWARD.md §1.2). `page.mouse.click`
 * drives a real `mousedown`/`mouseup` pair; the click's effect is judged by TYPING immediately
 * after it and reading the STORED document, never by a DOM snapshot alone (§1.6).
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const failures = [];
const ok = (label, cond, detail) => {
  console.log(`${cond ? "✓" : "⛔"} ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

/** Mirrors the reported shape: several labelled contact lines, the last one NOT empty — a
 *  Project-Contacts-template stand-in without needing the real template. */
const DOC = (lastEmpty = false) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Civil Engineer: Kimley-Horn" }] },
    { type: "paragraph", content: [{ type: "text", text: "Geotechnical Engineer: Terracon" }] },
    { type: "paragraph", content: [{ type: "text", text: "Surveyor: Pape-Dawson" }] },
    lastEmpty
      ? { type: "paragraph" }
      : { type: "paragraph", content: [{ type: "text", text: "Title Company: Stewart Title" }] },
  ],
});

async function open(doc) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-sheet-bottom-strip");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Goose Creek", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
  return page;
}

const geom = (page) => page.evaluate(() => {
  const sheet = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
  const body = document.querySelector('[data-testid="note-body"]').getBoundingClientRect();
  return {
    sheetL: Math.round(sheet.left), sheetR: Math.round(sheet.right),
    sheetT: Math.round(sheet.top), sheetB: Math.round(sheet.bottom),
    bodyB: Math.round(body.bottom),
  };
});

const text = (page) => page.evaluate((k) => {
  const out = [];
  const walk = (n) => {
    if (n?.type === "paragraph") out.push((n.content || []).map((c) => c.text || "").join(""));
    (n?.content || []).forEach(walk);
  };
  try { walk(JSON.parse(localStorage.getItem(k))); } catch (_) { /* empty on parse failure */ }
  return out;
}, PAGE_KEY);

/* ═══ 1. HIS REPRO — the strip below a NON-empty last block ══════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("1. HIS REPRO — click, then double-click, in the strip below a non-empty last line");
console.log("=".repeat(100));
{
  const page = await open(DOC(false));
  const g = await geom(page);
  const stripY = Math.round(g.bodyB + 40);
  ok("the fixture genuinely has a dead-strip-sized gap between note-body and note-sheet",
    g.sheetB - g.bodyB >= 60, `body bottom ${g.bodyB}, sheet bottom ${g.sheetB} (gap ${g.sheetB - g.bodyB})`);
  ok("…and the probe point sits inside that strip, not past the sheet",
    stripY > g.bodyB && stripY < g.sheetB, `probe y=${stripY}`);

  // Establish a KNOWN caret position first — exactly his repro's own step 2.
  const geometryBeforeClick = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('[data-testid="note-body"] p')];
    const target = ps.find((p) => p.textContent.includes("Geotechnical"));
    const r = target.getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.click(geometryBeforeClick.x, geometryBeforeClick.y);
  await pacedWait(page, 200);

  // Single click in the dead strip, then type — the click's effect is judged by what the
  // keystroke lands next to, never by a DOM snapshot alone.
  await page.mouse.click(g.sheetL + 100, stripY);
  await pacedWait(page, 200);
  await page.keyboard.type("CLICK-MARK");
  await pacedWait(page, 900);
  const afterClick = await text(page);
  ok("a single click in the strip moves the caret to the end of the document, not into the middle line",
    !afterClick.some((t) => t.includes("Geotechnical") && t.includes("CLICK-MARK")) &&
    afterClick.some((t) => t.includes("CLICK-MARK")),
    JSON.stringify(afterClick));
  ok("…and the line he clicked first is completely untouched",
    afterClick.some((t) => t === "Geotechnical Engineer: Terracon"), JSON.stringify(afterClick));
  await page.context().close();
}

{
  const page = await open(DOC(false));
  const g = await geom(page);
  const stripY = Math.round(g.bodyB + 40);
  const at = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('[data-testid="note-body"] p')];
    const target = ps.find((p) => p.textContent.includes("Surveyor"));
    const r = target.getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.click(at.x, at.y);
  await pacedWait(page, 200);
  // His own double-click repro.
  await page.mouse.dblclick(g.sheetL + 100, stripY);
  await pacedWait(page, 200);
  await page.keyboard.type("DBLCLICK-MARK");
  await pacedWait(page, 900);
  const afterDbl = await text(page);
  ok("a double-click in the strip also moves the caret to the end, not into the line he clicked before",
    !afterDbl.some((t) => t.includes("Surveyor") && t.includes("DBLCLICK-MARK")) &&
    afterDbl.some((t) => t.includes("DBLCLICK-MARK")),
    JSON.stringify(afterDbl));
  await page.context().close();
}

/* ═══ 2. AN ALREADY-EMPTY LAST BLOCK IS REUSED, NEVER DOUBLED ═════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("2. AN ALREADY-EMPTY TRAILING PARAGRAPH IS REUSED — no litter piles up");
console.log("=".repeat(100));
{
  const page = await open(DOC(true));
  const before = await text(page);
  const g = await geom(page);
  const stripY = Math.round(g.bodyB + 40);
  await page.mouse.click(g.sheetL + 100, stripY);
  await pacedWait(page, 200);
  await page.keyboard.type("REUSED");
  await pacedWait(page, 900);
  const after = await text(page);
  ok("exactly one paragraph carries the typed text — the existing empty one, not a fresh extra",
    after.length === before.length && after.filter((t) => t === "REUSED").length === 1,
    `before ${before.length} paras, after ${JSON.stringify(after)}`);
  await page.context().close();
}

/* ═══ 3. THE ADJACENT CASE STAYS WORKING — side padding at a line's own height ═══════════════ */
console.log("\n" + "=".repeat(100));
console.log("3. THE ADJACENT CASE — side padding beside a short line still places the caret there");
console.log("=".repeat(100));
{
  const page = await open({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Short." }] }],
  });
  const lineRect = await page.evaluate(() => {
    // The paragraph itself is a block and fills the whole content column — measure the actual
    // GLYPH end via a Range on the text node, not the block's own (much wider) bounding box.
    const p = document.querySelector('[data-testid="note-body"] p');
    const textNode = p.firstChild;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const r = range.getBoundingClientRect();
    return { right: Math.round(r.right), top: Math.round(r.top), height: Math.round(r.height) };
  });
  await page.mouse.click(lineRect.right + 60, Math.round(lineRect.top + lineRect.height / 2));
  await pacedWait(page, 200);
  await page.keyboard.type("SIDE");
  await pacedWait(page, 900);
  const after = await text(page);
  ok("a press beside a short line still lands on that line, exactly as before this fix",
    after.some((t) => t === "Short.SIDE"), JSON.stringify(after));
  await page.context().close();
}

console.log("\n" + "=".repeat(100));
if (failures.length) { console.log(`⛔ ${failures.length} FAILED:\n  ${failures.join("\n  ")}`); process.exitCode = 1; }
else console.log("✓ every case passed");
await browser.close();
