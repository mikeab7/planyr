/* verify-notes-table-to-text — NEW-2 / B649377: "Convert table to text" (right-click a table),
 * plus a regression check that the paste-time half of this ask (a single-column table pastes
 * as plain lines already) is still working. Real right-click, judged on the STORED document.
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
await assertMeasurable(page, "verify-notes-table-to-text");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

let pass = 0; let fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

// Michael's Silvestri fixture shape: table is the ONLY content of a list item, several levels
// deep. First cell carries a link mark and a bold mark, to prove marks survive the conversion.
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
              { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [
                { type: "text", text: "Executive Assistant", marks: [{ type: "bold" }] },
              ] }] }] },
              { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "O: 281-305-1115" }] }] }] },
              { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "M: (281) 705-2931" }] }] }] },
              { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [
                { type: "text", text: "Kandicec@quadvest.com", marks: [{ type: "link", attrs: { href: "mailto:Kandicec@quadvest.com" } }] },
              ] }] }] },
            ] },
          ] },
        ] },
      ] },
    ] },
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
const marksOn = (doc, needle) => {
  let found = null;
  const walk = (n) => {
    if (found || !n) return;
    if (n.text === needle) { found = (n.marks || []).map((m) => m.type); return; }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return found;
};

console.log("\n1 · RIGHT-CLICK A TABLE > CONVERT TO TEXT — Silvestri fixture, table is the WHOLE list item");
await seed(FIXTURE_DOC, "Utility");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
ok("fixture has a table with 4 rows before conversion", await page.locator(".ProseMirror table td").count() === 4);

const cellBox = await page.locator(".ProseMirror table td").first().boundingBox();
await page.mouse.click(cellBox.x + 10, cellBox.y + cellBox.height / 2, { button: "right" });
await pacedWait(page, 300);
const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="note-menu-"]')]
  .map((b) => b.getAttribute("data-testid").replace("note-menu-", "")));
ok("the right-click menu offers Convert table to text", rows.includes("convert-table-text"), rows.join(","));

await page.locator('[data-testid="note-menu-convert-table-text"]').click();
await pacedWait(page, 900);

ok("the table is GONE from the DOM", await page.locator(".ProseMirror table").count() === 0);
const doc1 = await storedDoc();
ok("⛔ the table is gone from the STORED document too", !typesIn(doc1).includes("table"), typesIn(doc1).join(","));
ok("all four lines survive, in order", textOf(doc1).includes("Executive Assistant|O: 281-305-1115|M: (281) 705-2931|Kandicec@quadvest.com"),
  textOf(doc1));
ok("⛔ the bold mark on the first line survived", (marksOn(doc1, "Executive Assistant") || []).includes("bold"),
  JSON.stringify(marksOn(doc1, "Executive Assistant")));
ok("⛔ the link mark on the last line survived", (marksOn(doc1, "Kandicec@quadvest.com") || []).includes("link"),
  JSON.stringify(marksOn(doc1, "Kandicec@quadvest.com")));
ok("the four lines became sibling LIST ITEMS (the table was the item's only content)",
  (typesIn(doc1).filter((t) => t === "listItem").length) >= 4, `listItem count: ${typesIn(doc1).filter((t) => t === "listItem").length}`);

console.log("\n2 · ONE UNDO STEP PUTS THE TABLE BACK");
await page.keyboard.press("Control+z");
await pacedWait(page, 900);
const doc2 = await storedDoc();
ok("⛔ Ctrl+Z restores the table in a single press", typesIn(doc2).includes("table"), typesIn(doc2).join(","));

console.log("\n3 · A TABLE WITH CONTENT ABOVE IT IN THE SAME LIST ITEM — only the table is replaced");
const WITH_SIBLING_CONTENT = {
  type: "doc",
  content: [
    { type: "bulletList", content: [
      { type: "listItem", content: [
        { type: "paragraph", content: [{ type: "text", text: "Kept line above" }] },
        { type: "table", content: [
          { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Row one" }] }] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Row two" }] }] }] },
        ] },
      ] },
    ] },
  ],
};
await seed(WITH_SIBLING_CONTENT, "Sibling");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
const box2 = await page.locator(".ProseMirror table td").first().boundingBox();
await page.mouse.click(box2.x + 10, box2.y + box2.height / 2, { button: "right" });
await pacedWait(page, 300);
await page.locator('[data-testid="note-menu-convert-table-text"]').click();
await pacedWait(page, 900);
const doc3 = await storedDoc();
ok("the line ABOVE the table survived untouched", textOf(doc3).includes("Kept line above"), textOf(doc3));
ok("both row lines are present", textOf(doc3).includes("Row one") && textOf(doc3).includes("Row two"), textOf(doc3));
ok("no table remains", !typesIn(doc3).includes("table"));

console.log("\n4 · A TOP-LEVEL TABLE (not inside a list) → plain paragraphs, not list items");
const TOP_LEVEL = { type: "doc", content: [
  { type: "table", content: [
    { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha" }] }] }] },
    { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Beta" }] }] }] },
  ] },
] };
await seed(TOP_LEVEL, "Top-level");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
const box3 = await page.locator(".ProseMirror table td").first().boundingBox();
await page.mouse.click(box3.x + 10, box3.y + box3.height / 2, { button: "right" });
await pacedWait(page, 300);
await page.locator('[data-testid="note-menu-convert-table-text"]').click();
await pacedWait(page, 900);
const doc4 = await storedDoc();
ok("no table remains", !typesIn(doc4).includes("table"));
ok("no list items were invented outside a list context", !typesIn(doc4).includes("listItem"), typesIn(doc4).join(","));
ok("both lines present as plain paragraphs", textOf(doc4).includes("Alpha") && textOf(doc4).includes("Beta"));

console.log("\n5 · REGRESSION — the PASTE half (single-column table → plain lines) is already shipped; confirm it still works");
await seed({ type: "doc", content: [{ type: "paragraph" }] }, "Paste check");
await page.locator('[data-testid="note-body"]').click();
await pacedWait(page, 200);
const html = "<table><tr><td>Line one</td></tr><tr><td>Line two</td></tr><tr><td>Line three</td></tr></table>";
await page.evaluate((h) => {
  const dt = new DataTransfer();
  dt.setData("text/html", h);
  dt.setData("text/plain", "Line one\nLine two\nLine three");
  const target = document.querySelector(".ProseMirror");
  target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, html);
await pacedWait(page, 900);
const doc5 = await storedDoc();
ok("⛔ a pasted single-column table lands as plain lines, not a table (isLayoutTable, notesPastePlain.js)",
  !typesIn(doc5).includes("table"), typesIn(doc5).join(","));
ok("all three pasted lines present", ["Line one", "Line two", "Line three"].every((t) => textOf(doc5).includes(t)), textOf(doc5));

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(`page errors: ${errs.length ? errs.slice(0, 5).join(" | ") : "clean"}`);
await browser.close();
process.exit(fail ? 1 : 0);
