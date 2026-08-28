/* verify-notes-table-gaps — NEW-3, closing the specific gaps the owner named after the
 * table-selection sweep reported "32 green checks, no gaps": (a) merge/split on a genuinely
 * multi-column table (the shipped sweep only ever merged an EDGE-TO-EDGE 2-column table, so a
 * merge could never be checked against an untouched neighbour column, and never covered a
 * ROWSPAN/vertical merge); (b) what actually lands on the SYSTEM clipboard on copy, read back
 * from the clipboard itself, not from what our own paste path can reconstruct; (c) a REAL
 * Outlook-shaped clipboard HTML paste (MSO wrapper markup, nested layout tables, a live
 * mailto link) — "this is the case Michael actually hits", per the owner, and the shipped
 * regression test used a hand-authored `<table><tr><td>` fragment with none of that; (d) a
 * table inside a positioned text box (`noteAnchor`) exercising more than row-add — delete-row
 * and the NEW-2 "Convert table to text" command, both from inside the box.
 *
 * Judged on the STORED document and, for (b), the real OS clipboard — never the screen alone.
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
await assertMeasurable(page, "verify-notes-table-gaps");
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

let pass = 0; let fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

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
const marksOn = (doc, text) => {
  let found = null;
  const walk = (n) => { if (!n) return; if (n.text === text) found = (n.marks || []).map((m) => m.type); (n.content || []).forEach(walk); };
  walk(doc);
  return found;
};

async function cellBox(nth) {
  return page.locator(".ProseMirror table td, .ProseMirror table th").nth(nth).boundingBox();
}
async function clickCellNth(nth) {
  const box = await cellBox(nth);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await pacedWait(page, 150);
}
async function dragBetween(nthA, nthB) {
  const a = await cellBox(nthA);
  const b = await cellBox(nthB);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await pacedWait(page, 80);
  await page.mouse.up();
  await pacedWait(page, 200);
}

// A genuinely multi-column, multi-row table — 2 rows x 3 columns — so a merge can leave a
// column untouched beside it, and a vertical drag exercises a real rowspan merge.
const TABLE_2X3 = { type: "table", content: [
  { type: "tableRow", content: [
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A1" }] }] },
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B1" }] }] },
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "C1" }] }] },
  ] },
  { type: "tableRow", content: [
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A2" }] }] },
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B2" }] }] },
    { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "C2" }] }] },
  ] },
] };

console.log("\n=== (a) MERGE AND SPLIT ON A GENUINELY MULTI-COLUMN TABLE ===");
await seed([TABLE_2X3, { type: "paragraph" }], "MultiCol");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });

// Horizontal merge of the MIDDLE and RIGHT cells of row 1 (B1+C1), leaving A1 untouched.
await dragBetween(1, 2);
const selHoriz = await page.evaluate(() => document.querySelectorAll(".ProseMirror table .selectedCell").length);
await page.locator('[data-testid="nt-merge"]').click();
await pacedWait(page, 900);
const afterHoriz = await storedDoc();
ok("horizontal merge of B1+C1 leaves A1 (the neighbour column) untouched", textOf(afterHoriz).includes("A1"),
  `sel=${selHoriz}, text=${textOf(afterHoriz)}`);
ok("the merged cell keeps both B1 and C1", textOf(afterHoriz).includes("B1") && textOf(afterHoriz).includes("C1"), textOf(afterHoriz));
ok("cell count drops from 6 to 5 (2 rows x 3 cols, one horizontal merge)", (await page.locator(".ProseMirror table td, .ProseMirror table th").count()) === 5);
await page.locator('[data-testid="nt-merge"]').click();
await pacedWait(page, 900);
ok("⛔ split restores the full 2x3 = 6 cells with A1 still untouched",
  (await page.locator(".ProseMirror table td, .ProseMirror table th").count()) === 6 && textOf(await storedDoc()).includes("A1"));
await page.keyboard.press("Control+z");
await pacedWait(page, 500);
await page.keyboard.press("Control+z");
await pacedWait(page, 500);

// Vertical (rowspan) merge: same column, two rows — B1 + B2.
await seed([TABLE_2X3, { type: "paragraph" }], "MultiColVert");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
await dragBetween(1, 4); // B1 (index 1) to B2 (index 4) in row-major order
const selVert = await page.evaluate(() => document.querySelectorAll(".ProseMirror table .selectedCell").length);
await page.locator('[data-testid="nt-merge"]').click();
await pacedWait(page, 900);
const afterVert = await storedDoc();
ok("⛔ a VERTICAL (rowspan) merge of B1+B2 actually merges (was never exercised before)",
  selVert === 2 && (await page.locator(".ProseMirror table td, .ProseMirror table th").count()) === 5,
  `sel=${selVert}`);
ok("the rowspan-merged cell keeps both texts", textOf(afterVert).includes("B1") && textOf(afterVert).includes("B2"), textOf(afterVert));
ok("neighbour columns A and C are untouched by the vertical merge",
  textOf(afterVert).includes("A1") && textOf(afterVert).includes("A2") && textOf(afterVert).includes("C1") && textOf(afterVert).includes("C2"),
  textOf(afterVert));
await page.locator('[data-testid="nt-merge"]').click();
await pacedWait(page, 900);
ok("⛔ split restores the rowspan back to 2 separate cells (6 total)",
  (await page.locator(".ProseMirror table td, .ProseMirror table th").count()) === 6);

console.log("\n=== (b) WHAT ACTUALLY LANDS ON THE SYSTEM CLIPBOARD (not just what we can read back) ===");
await seed([TABLE_2X3, { type: "paragraph" }], "ClipHtml");
await page.waitForSelector(".ProseMirror table", { timeout: 20000 });
await dragBetween(0, 1); // A1 + B1
await page.keyboard.press("Control+c");
await pacedWait(page, 250);
const clipTypes = await page.evaluate(async () => {
  try {
    const items = await navigator.clipboard.read();
    return items.flatMap((it) => it.types);
  } catch (e) { return [`ERR:${e.message}`]; }
});
ok("⛔ copying a cross-cell selection puts a text/html entry on the SYSTEM clipboard (not just plain text)",
  clipTypes.includes("text/html"), JSON.stringify(clipTypes));
let clipHtml = "";
if (clipTypes.includes("text/html")) {
  clipHtml = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((it) => it.types.includes("text/html"));
    const blob = await item.getType("text/html");
    return blob.text();
  });
}
ok("⛔ the text/html clipboard entry is an ACTUAL TABLE FRAGMENT (so it pastes correctly into Excel/Outlook/Word), not just wrapped text",
  /<table[\s>]/i.test(clipHtml) && /<td[\s>]/i.test(clipHtml), clipHtml.slice(0, 200));
const clipText = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return `ERR:${e.message}`; } });
ok("the plain-text clipboard entry still carries both cells' text (the round-trip path this app itself uses)",
  clipText.includes("A1") && clipText.includes("B1"), JSON.stringify(clipText));

console.log("\n=== (c) PASTE OF A SINGLE-COLUMN TABLE FROM REAL OUTLOOK-SHAPED CLIPBOARD HTML ===");
console.log("    (MSO wrapper markup, a conditional-comment XML block, a NESTED 1x1-over-4x1");
console.log("    layout table, and a live mailto link — not a hand-authored <table><tr><td> —");
console.log("    this is the shape Michael's real signature pastes actually arrive in.)");
const OUTLOOK_HTML = `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:m="http://schemas.microsoft.com/office/2004/12/omml" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=Generator content="Microsoft Word 15 (filtered medium)">
<style>
<!--
 p.MsoNormal, li.MsoNormal, div.MsoNormal
	{margin:0in;
	font-size:11.0pt;
	font-family:"Calibri",sans-serif;}
-->
</style>
</head>
<body lang=EN-US link="#0563C1" vlink="#954F72" style='word-wrap:break-word'>
<div class=WordSection1>
<p class=MsoNormal><b><span style='font-size:12.0pt;color:#1F4E79'>Kandice Castillo</span></b></p>
<!--[if gte mso 9]><xml>
<o:shapedefaults v:ext="edit" spidmax="1026"/>
</xml><![endif]-->
<table class=MsoNormalTable border=0 cellspacing=0 cellpadding=0 width="100%" style='width:100.0%'>
 <tr>
  <td style='padding:0in 0in 0in 0in'>
   <table class=MsoNormalTable border=0 cellspacing=0 cellpadding=0 style='border-collapse:collapse'>
    <tr><td style='padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal><span style='font-size:9.0pt'>Executive Assistant</span></p></td></tr>
    <tr><td style='padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal><span style='font-size:9.0pt'>O: 281-305-1115</span></p></td></tr>
    <tr><td style='padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal><span style='font-size:9.0pt'>M: (281) 705-2931</span></p></td></tr>
    <tr><td style='padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal><span style='font-size:9.0pt'>E: <a href="mailto:Kandicec@quadvest.com"><span style='color:#0563C1'>Kandicec@quadvest.com</span></a></span></p></td></tr>
   </table>
  </td>
 </tr>
</table>
<p class=MsoNormal>&nbsp;</p>
</div>
</body>
</html>`;
await seed([{ type: "paragraph" }], "OutlookPaste");
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await page.locator(".ProseMirror").click();
await page.evaluate((html) => {
  const dt = new DataTransfer();
  dt.setData("text/html", html);
  dt.setData("text/plain", "Executive Assistant\nO: 281-305-1115\nM: (281) 705-2931\nE: Kandicec@quadvest.com");
  document.querySelector(".ProseMirror").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, OUTLOOK_HTML);
await pacedWait(page, 900);
const docOutlook = await storedDoc();
ok("⛔ no page error while parsing real Outlook markup (MSO comments, xmlns cruft, nested tables)", errs.length === 0, errs.join(" | "));
ok("⛔ the nested single-column tables are unwrapped — no table node survives the paste", !typesIn(docOutlook).includes("table"), typesIn(docOutlook).join(","));
ok("the bold name line above the table survived", textOf(docOutlook).includes("Kandice Castillo"), textOf(docOutlook));
ok("all four contact lines survived, in order", ["Executive Assistant", "O: 281-305-1115", "M: (281) 705-2931", "Kandicec@quadvest.com"].every((t) => textOf(docOutlook).includes(t)),
  textOf(docOutlook));
ok("⛔ the mailto link mark survived on the email line", (marksOn(docOutlook, "Kandicec@quadvest.com") || []).includes("link"),
  JSON.stringify(marksOn(docOutlook, "Kandicec@quadvest.com")));
ok("⛔ no MSO/XML cruft leaked into the visible text (xmlns, o:shapedefaults, MsoNormal, etc.)",
  !/xmlns|shapedefaults|MsoNormal|WordSection/i.test(textOf(docOutlook).replace(/\|/g, " ")), textOf(docOutlook));

console.log("\n=== (d) A TABLE INSIDE A POSITIONED TEXT BOX — beyond row-add: delete a row, and Convert to text ===");
const TABLE_IN_BOX = { type: "doc", content: [
  { type: "noteAnchor", attrs: { x: 100, y: 120, w: 320 }, content: [
    { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Row one" }] }] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Row two" }] }] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Row three" }] }] }] },
    ] },
  ] },
  { type: "paragraph" },
] };
await page.evaluate(([treeKey, prefix, d]) => {
  localStorage.clear();
  localStorage.setItem(treeKey, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "InBox2", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
  localStorage.setItem(prefix + "p1", JSON.stringify(d));
}, [TREE_KEY, PAGE_PREFIX, TABLE_IN_BOX]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await pacedWait(page, 500);
// ⛔ CLICK THE BOX'S ACTUAL CONTENT, NEVER ITS TOP-LEFT CORNER — the corner (a few px in from
// the border) is where the 9x14px drag grip lives (`.planyr-anchor-grip`, left:3px;top:5px in
// notesAnchorNode's CSS), and a press there goes through the grip's OWN mousedown handler,
// never `focusFromMat`, which looks exactly like a stuck caret if you're not watching for it.
const firstCellBox = await page.locator(".planyr-anchor table td", { hasText: "Row one" }).boundingBox();
await page.mouse.click(firstCellBox.x + firstCellBox.width / 2, firstCellBox.y + firstCellBox.height / 2);
await pacedWait(page, 150);
await page.mouse.click(firstCellBox.x + firstCellBox.width / 2, firstCellBox.y + firstCellBox.height / 2); // stage 2: enter the box
await pacedWait(page, 150);
const midCell = await page.locator(".planyr-anchor table td", { hasText: "Row two" }).boundingBox();
await page.mouse.click(midCell.x + midCell.width / 2, midCell.y + midCell.height / 2);
await pacedWait(page, 150);
const caretRow = await page.evaluate(() => window.__noteEditor?.selection?.());
console.log(`    (caret placed, about to delete — selection: ${JSON.stringify(caretRow)})`);
await page.locator('[data-testid="nt-row-del"]').click();
await pacedWait(page, 900);
const docBoxRowDel = await storedDoc();
ok("⛔ Row ✕ works on a table inside a box — 'Row two' is gone, the others remain",
  !textOf(docBoxRowDel).includes("Row two") && textOf(docBoxRowDel).includes("Row one") && textOf(docBoxRowDel).includes("Row three"),
  textOf(docBoxRowDel));
await page.keyboard.press("Control+z");
await pacedWait(page, 900);
ok("⛔ undo restores the deleted row inside the box", textOf(await storedDoc()).includes("Row two"));

// Right-click a cell inside the box and use "Convert table to text".
const cellForMenu = await page.locator(".planyr-anchor table td").first().boundingBox();
await page.mouse.click(cellForMenu.x + cellForMenu.width / 2, cellForMenu.y + cellForMenu.height / 2, { button: "right" });
await pacedWait(page, 200);
const convertItem = page.locator('[data-testid="note-menu-convert-table-text"]');
const convertPresent = await convertItem.count();
ok("⛔ the right-click menu offers Convert table to text for a table inside a box", convertPresent > 0, `${convertPresent} matches`);
if (convertPresent) {
  await convertItem.first().click();
  await pacedWait(page, 900);
  const docBoxConverted = await storedDoc();
  ok("⛔ Convert table to text works on a table inside a box — no table node survives, box remains",
    !typesIn(docBoxConverted).includes("table") && typesIn(docBoxConverted).includes("noteAnchor"),
    typesIn(docBoxConverted).join(","));
  ok("all three row texts survive the conversion, in order",
    ["Row one", "Row two", "Row three"].every((t) => textOf(docBoxConverted).includes(t)), textOf(docBoxConverted));
}

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(`page errors: ${errs.length ? errs.slice(0, 8).join(" | ") : "clean"}`);
console.log("\nSTILL NOT COVERED (named, not silently skipped):");
console.log("  · a real Outlook paste landing INSIDE a list item at the same time as the nested-table unwrap");
console.log("    (the nesting-into-list path (B36051 fix B) is covered separately with a synthesized fragment)");
console.log("  · an embedded logo image (cid: src) inside a real Outlook signature paste");
console.log("  · pasting real Outlook HTML into a cell that is itself inside another table");
await browser.close();
process.exit(fail ? 1 : 0);
