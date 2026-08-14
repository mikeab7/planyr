/* audit-notes-tab — WHICH CONTEXTS TAB FAILS IN, MEASURED RATHER THAN GUESSED.
 *
 * ⛔ THE REPORT IS ONE WORD LONG AND IT IS "SOMETIMES": *"tab sometimes doesnt work."* His
 * instruction was explicit about what to do with that — *"Do not fix a guess — INSTRUMENT IT.
 * Capture the caret context at the moment Tab is pressed … and find which contexts fail. Then
 * report the failing set, not a theory."*
 *
 * So this file does not assert anything on its first run. It drives a REAL Tab in every context he
 * enumerated, records what the caret was in at the moment of the press and what the STORED document
 * did about it, and prints a table. The failing set comes out of the table.
 *
 * ⛔ EVERY KEY IS A REAL KEY. `page.keyboard.press` only — a dispatched KeyboardEvent mutates
 * nothing in this app (SYNTHETIC-KEYS-DONT-EDIT), so a harness built on one would print a tidy
 * table describing nothing that happened. And the judgement is the STORED DOCUMENT, never the
 * screen: this module has twice shipped a change that looked right on screen while the document
 * underneath was untouched.
 *
 * ⛔ THE FIXTURE IS HIS NOTE, not a blank page. His screenshot is a Richfield "Utilities" note: a
 * bulleted list with a nested sub-list under it, and an AUTOLINKED email inside the nest. A list
 * with a link in it behaves differently from a list without one, which is exactly the sort of
 * difference "sometimes" is made of.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ONLY = process.env.TAB_ONLY || "";

const rows = [];
const pageErrors = [];

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const storedDoc = (page) => page.evaluate((k) => localStorage.getItem(k), `${PAGE_PREFIX}p1`);

/** ⛔ THE CARET CONTEXT AT THE MOMENT OF THE PRESS, which is the thing he asked to be captured.
 *  Read from the live selection: what block the caret is in, how deep it is nested, where in the
 *  text it sits, whether anything is selected, and what is immediately either side of it. */
const caretContext = (page) => page.evaluate(() => {
  const sel = document.getSelection();
  const pm = document.querySelector(".ProseMirror");
  if (!sel || !sel.anchorNode || !pm || !pm.contains(sel.anchorNode)) {
    const a = document.activeElement;
    return { where: a?.getAttribute?.("data-testid") || a?.tagName || "nowhere", inDoc: false };
  }
  const el = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
  const block = el.closest("li, td, th, p, h1, h2, h3, h4, pre, blockquote, div.planyr-anchor") || el;
  /* ⛔ THE CHAIN, NOT THE INNERMOST NODE. `closest` with a list of selectors returns the NEAREST
   * match, which for a paragraph inside a table cell inside a list is always "p" — so the first
   * run's `node` column read "p" for all twenty-eight rows and said nothing about anything. */
  const chain = [];
  for (let n = block; n && n !== pm; n = n.parentElement) {
    const t = n.tagName.toLowerCase();
    if (["li", "td", "th", "ul", "ol", "table", "p", "h1", "h2", "h3", "h4", "pre", "blockquote"].includes(t)) chain.unshift(t);
    if (n.classList?.contains("planyr-anchor")) chain.unshift("box");
  }
  let depth = 0;
  for (let n = block.parentElement; n && n !== pm; n = n.parentElement) {
    if (n.tagName === "UL" || n.tagName === "OL") depth += 1;
  }
  const text = block.innerText || "";
  const off = sel.anchorOffset;
  const inLink = !!el.closest("a");
  const prevSib = block.previousElementSibling;
  return {
    inDoc: true,
    node: chain.join(">") || block.tagName.toLowerCase(),
    listDepth: depth,
    firstOfList: !prevSib && depth > 0,
    empty: !text.trim(),
    offset: off,
    atStart: off === 0,
    atEnd: off >= (sel.anchorNode.nodeValue?.length ?? 0),
    collapsed: sel.isCollapsed,
    inLink,
    afterLink: !inLink && !!(el.previousElementSibling?.tagName === "A"),
    before: text.slice(Math.max(0, off - 8), off),
    after: text.slice(off, off + 8),
  };
});

/** ⛔ WHERE THE CARET IS, AS A STABLE MARK — and this is not a nicety.
 *
 * The first run reported TEN contexts as "did nothing", and several of them were the app being
 * CORRECT: Tab between two table cells, and Tab out of the title into the body, MOVE THE CARET and
 * change no document at all. An instrument that only watches the document cannot tell "did nothing"
 * from "did exactly the right thing", and reporting that difference as a defect list is how a
 * session ends up fixing something that was never broken. */
const caretMark = (page) => page.evaluate(() => {
  const sel = document.getSelection();
  const pm = document.querySelector(".ProseMirror");
  if (!sel?.anchorNode) return "none";
  if (!pm?.contains(sel.anchorNode)) {
    const a = document.activeElement;
    return `outside:${a?.getAttribute?.("data-testid") || a?.tagName || "?"}`;
  }
  const el = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
  const block = el.closest("li, td, th, p, h1, h2, h3, h4, pre, blockquote") || el;
  const all = [...pm.querySelectorAll("li, td, th, p, h1, h2, h3, h4, pre, blockquote")];
  return `${all.indexOf(block)}@${sel.anchorOffset}${sel.isCollapsed ? "" : "+sel"}`;
});

/** ⛔ HIS NOTE. A bulleted list, a NESTED sub-list under it, an autolinked email and URL inside the
 *  nest, a table, a positioned box, and a plain paragraph — every surface he listed, in one page. */
async function seed(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Utilities", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    const T = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
    const P = (...c) => ({ type: "paragraph", content: c.length ? c : undefined });
    const LI = (...c) => ({ type: "listItem", content: c });
    const link = (href) => [{ type: "link", attrs: { href } }];
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [T("Utilities")] },
        { type: "bulletList", content: [
          LI(P(T("MUD Engineer - Pape Dawson"))),
          LI(
            P(T("Dustin O'Neal")),
            { type: "bulletList", content: [
              LI(P(T("281-555-0134"))),
              LI(P(T("doneal@papedawson.com", link("mailto:doneal@papedawson.com")))),
              LI(P(T("https://papedawson.com", link("https://papedawson.com")))),
              LI(P()),                                   // an EMPTY nested item
            ] },
          ),
          LI(P(T("Third top-level item"))),
        ] },
        { type: "table", content: [
          { type: "tableRow", content: [
            { type: "tableHeader", content: [P(T("Utility"))] },
            { type: "tableHeader", content: [P(T("Contact"))] },
          ] },
          { type: "tableRow", content: [
            { type: "tableCell", content: [P(T("Water"))] },
            { type: "tableCell", content: [P(T("MUD 501"))] },
          ] },
        ] },
        { type: "noteAnchor", attrs: { x: 420, y: 420, w: 180 }, content: [P(T("a placed box"))] },
        P(T("A plain paragraph of flow text.")),
      ],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** Put the caret somewhere by clicking real text, then optionally stepping with real keys. */
async function placeCaret(page, { text, at = "start", steps = [] }) {
  const spot = await page.evaluate(([needle, where]) => {
    const pm = document.querySelector(".ProseMirror");
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue.includes(needle)) continue;
      const r = document.createRange();
      const i = n.nodeValue.indexOf(needle);
      r.setStart(n, where === "end" ? i + needle.length : i);
      r.collapse(true);
      const rect = r.getBoundingClientRect();
      const el = n.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.left || el.left + 2), y: Math.round((rect.top || el.top) + (rect.height || el.height) / 2) };
    }
    return null;
  }, [text, at]);
  if (!spot) return false;
  await page.mouse.click(spot.x, spot.y);
  await pacedWait(page, 200);
  for (const k of steps) { await page.keyboard.press(k); await pacedWait(page, 90); }
  return true;
}

/** Drive ONE context: place the caret, snapshot, press the key for real, snapshot again. */
async function probe(page, name, place, key) {
  if (ONLY && !name.includes(ONLY)) return;
  await seed(page);
  const placed = await place(page);
  if (!placed) { rows.push({ name, key, ctx: null, verdict: "COULD-NOT-PLACE", changed: null }); return; }

  const ctx = await caretContext(page);
  const before = await storedDoc(page);
  const domBefore = await page.evaluate(() => document.querySelector(".ProseMirror").innerHTML);
  const caretBefore = await caretMark(page);

  await page.keyboard.press(key);
  await pacedWait(page, 900);                 // past the editor's 600 ms save debounce

  const after = await storedDoc(page);
  const domAfter = await page.evaluate(() => document.querySelector(".ProseMirror").innerHTML);
  const caretAfter = await caretMark(page);
  const stillInDoc = await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    return !!(pm && (pm === document.activeElement || pm.contains(document.activeElement)));
  });

  const docChanged = before !== after;
  const domChanged = domBefore !== domAfter;
  let verdict = "nothing";
  if (docChanged) {
    const a = JSON.parse(before || "null");
    const b = JSON.parse(after || "null");
    const txt = (n) => { let s = ""; const dig = (x) => { if (x?.type === "text") s += x.text; (x?.content || []).forEach(dig); }; dig(n); return s; };
    if (txt(a) !== txt(b)) verdict = txt(b).length > txt(a).length ? "INSERTED-TEXT" : "REMOVED-TEXT";
    else verdict = "restructured";
  } else if (domChanged) verdict = "SCREEN-ONLY";
  else if (caretBefore !== caretAfter) verdict = "moved-caret";

  rows.push({ name, key, ctx, verdict, changed: docChanged, focusKept: stillInDoc, caret: `${caretBefore} → ${caretAfter}` });
}

const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true })).newPage();
page.on("pageerror", (e) => pageErrors.push(e.message));
await assertMeasurable(page, "audit-notes-tab");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

/* ⛔ EVERY CONTEXT HE NAMED, and Shift+Tab for each. */
const CONTEXTS = [
  ["start of a list item", (p) => placeCaret(p, { text: "Third top-level item", at: "start" })],
  ["mid-word in a list item", (p) => placeCaret(p, { text: "Third top-level item", at: "start", steps: ["ArrowRight", "ArrowRight", "ArrowRight"] })],
  ["end of a list item", (p) => placeCaret(p, { text: "Third top-level item", at: "end" })],
  ["EMPTY nested list item", async (p) => {
    // the seeded empty <li> has no text to click, so reach it from the URL item with a real key
    const okp = await placeCaret(p, { text: "https://papedawson.com", at: "end" });
    if (!okp) return false;
    await p.keyboard.press("ArrowDown");
    await pacedWait(p, 150);
    return true;
  }],
  ["FIRST item of a list", (p) => placeCaret(p, { text: "MUD Engineer", at: "end" })],
  ["already-nested item", (p) => placeCaret(p, { text: "281-555-0134", at: "end" })],
  ["after an autolinked EMAIL", (p) => placeCaret(p, { text: "doneal@papedawson.com", at: "end" })],
  ["after an autolinked URL", (p) => placeCaret(p, { text: "https://papedawson.com", at: "end" })],
  ["range across two list items", async (p) => {
    const okp = await placeCaret(p, { text: "MUD Engineer", at: "start" });
    if (!okp) return false;
    for (let i = 0; i < 6; i += 1) { await p.keyboard.press("Shift+ArrowDown"); await pacedWait(p, 60); }
    return true;
  }],
  ["inside a table cell", (p) => placeCaret(p, { text: "Water", at: "end" })],
  ["LAST cell of a table", (p) => placeCaret(p, { text: "MUD 501", at: "end" })],
  ["inside a positioned text box", async (p) => {
    const okp = await placeCaret(p, { text: "a placed box", at: "end" });
    if (!okp) return false;
    await placeCaret(p, { text: "a placed box", at: "end" });     // two presses: select, then enter
    return true;
  }],
  ["plain paragraph", (p) => placeCaret(p, { text: "A plain paragraph", at: "end" })],
  ["the page TITLE field", async (p) => {
    await p.locator('[data-testid="note-title"]').first().click();
    await pacedWait(p, 200);
    return true;
  }],
];

for (const [name, place] of CONTEXTS) {
  await probe(page, name, place, "Tab");
  await probe(page, name, place, "Shift+Tab");
}

/* ⛔ AND ONE PROPERTY RATHER THAN A CONTEXT: TAB IS REVERSIBLE. A tab stop you can add and cannot
 * take back is its own small trap, and "Shift+Tab did nothing" in a plain paragraph is only correct
 * when there was nothing there to remove. */
await seed(page);
await placeCaret(page, { text: "A plain paragraph", at: "end" });
const revBefore = await storedDoc(page);
await page.keyboard.press("Tab");
await pacedWait(page, 900);
const revMid = await storedDoc(page);
await page.keyboard.press("Shift+Tab");
await pacedWait(page, 900);
const revAfter = await storedDoc(page);
rows.push({
  name: "REVERSIBILITY (plain para)", key: "Tab then Shift+Tab",
  ctx: { node: "p", listDepth: 0 },
  verdict: revMid !== revBefore && revAfter === revBefore ? "reversible"
    : revMid === revBefore ? "TAB-DID-NOTHING" : "NOT-REVERSIBLE",
  focusKept: true,
});

/* ⛔ HIS TWO CONSTRAINTS, DRIVEN WITH REAL KEYS ON THE FIRST BULLET OF A LIST (NEW-TAB).
 *
 *   *"No empty parent node in the document, ever — assert this in the test by reading the STORED
 *   document after the indent, not the screen."*
 *   *"Round-trip: indent, outdent … the document is byte-identical to before the indent/outdent
 *   pair."*
 *
 * Both are asked of the STORED document, and both are asked HERE rather than only in the unit
 * suite because the unit suite cannot press a key: it drives the command, so it proves the rule
 * and not the keymap. Only this half can tell you that Tab reaches the right handler at all, and
 * that Shift+Tab gives the level back instead of `liftListItem` lifting the bullet clean out of
 * its list — the specific thing the priority ordering exists to prevent. */
await seed(page);
/* ⛔ AND THE PLACEMENT IS CHECKED, NOT ASSUMED — this probe's first run reported
 * "TAB-DID-NOTHING" for a caret that was never in the list at all, because it named a string the
 * fixture does not contain. `placeCaret` returns false in that case and the old code threw the
 * answer away, so an instrument failure was one edit from being read as a product failure. That is
 * the same trap the CONTEXTS loop already guards with COULD-NOT-PLACE. */
const placedFirst = await placeCaret(page, { text: "MUD Engineer", at: "end" });   // the FIRST bullet
if (!placedFirst) throw new Error("could not place the caret on the first bullet — the fixture changed");
const indBefore = await storedDoc(page);
await page.keyboard.press("Tab");
await pacedWait(page, 900);
const indAfter = await storedDoc(page);
await page.keyboard.press("Shift+Tab");
await pacedWait(page, 900);
const indBack = await storedDoc(page);

/** Every list item in a stored document, as `[text, level]` — read from the DOCUMENT. */
const itemsIn = (raw) => {
  let doc = null;
  try { doc = JSON.parse(raw || "null"); } catch (_) { return null; }
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === "listItem" || n.type === "taskItem") {
      let text = "";
      const dig = (x) => { if (x?.type === "text") text += x.text; (x?.content || []).forEach(dig); };
      (n.content || []).forEach(dig);
      out.push([text, Number(n.attrs?.indent) || 0]);
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out;
};

const wasItems = itemsIn(indBefore) || [];
const nowItems = itemsIn(indAfter) || [];
const backItems = itemsIn(indBack) || [];
/* ⛔ EVERY ONE OF THESE IS RELATIVE TO THE DOCUMENT AS IT WAS, NOT TO AN ABSOLUTE. The first
 * version asked "is any bullet empty?" and the answer was YES before the key was ever pressed —
 * the fixture deliberately contains an empty nested bullet, because that is one of the contexts
 * he named. So a working feature measured as NODE-INVENTED against a baseline nobody checked.
 * The claim is "Tab did not ADD one", and that is a comparison, not a property. */
const firstLevelRose = (nowItems[0]?.[1] ?? 0) > (wasItems[0]?.[1] ?? 0);
const noNewNode = nowItems.length === wasItems.length;
const emptyCount = (list) => list.filter(([t]) => t.trim() === "").length;
const noNewEmpty = emptyCount(nowItems) === emptyCount(wasItems);
const sameTexts = JSON.stringify(nowItems.map(([t]) => t)) === JSON.stringify(wasItems.map(([t]) => t));

rows.push({
  name: "FIRST bullet: no empty node", key: "Tab",
  ctx: { node: "ul>li", listDepth: 1 },
  verdict: !nowItems.length ? "COULD-NOT-READ"
    : !firstLevelRose ? "TAB-DID-NOTHING"
      : !noNewNode ? "NODE-INVENTED"
        : !noNewEmpty ? "EMPTY-NODE-INVENTED"
          : !sameTexts ? "TEXT-MOVED" : "level-only",
  focusKept: true,
});
rows.push({
  name: "FIRST bullet: round-trip", key: "Tab then Shift+Tab",
  ctx: { node: "ul>li", listDepth: 1 },
  verdict: indBack === indBefore ? "byte-identical"
    : (backItems[0]?.[1] ?? -1) === (wasItems[0]?.[1] ?? 0) ? "SAME-LEVEL-DIFFERENT-BYTES" : "NOT-REVERSIBLE",
  focusKept: true,
});

/* ⛔ PDF-PARITY, MEASURED RATHER THAN ARGUED. The print sheet is built by `lib/notesDocHtml.js`
 * through ProseMirror's own `DOMSerializer`, using the very `renderHTML` that paints the screen —
 * so a level that shows on screen shows on paper BY CONSTRUCTION, and that is a good argument and
 * not a measurement. PDF-PARITY is a mandatory live-verify class here, so the sheet is opened and
 * its first bullet is read. What this would catch: a print stylesheet whose `margin` shorthand beat
 * the item's own margin, which is exactly the shape `.note-body li { margin: 0.15em 0 }` has. */
await placeCaret(page, { text: "MUD Engineer", at: "end" });
await page.keyboard.press("Tab");
await pacedWait(page, 900);
await page.locator('[data-testid="nt-print"]').first().click().catch(() => {});
await pacedWait(page, 1600);
const printed = await page.evaluate(() => {
  const f = document.querySelector('[data-testid="notes-print-frame"]');
  const d = f && f.contentDocument;
  const li = d && d.querySelector(".note-body li");
  if (!li) return null;
  const win = d.defaultView;
  return { attr: li.getAttribute("data-indent"), margin: win.getComputedStyle(li).marginLeft };
});
rows.push({
  name: "FIRST bullet: the PRINTED sheet", key: "Tab",
  ctx: { node: "ul>li", listDepth: 1 },
  verdict: !printed ? "NO-PRINT-FRAME"
    : printed.attr !== "1" ? "LEVEL-LOST-IN-EXPORT"
      : parseFloat(printed.margin) > 0 ? "indented-on-paper" : "MARGIN-OVERRIDDEN",
  focusKept: true,
});

/* ---- the table ------------------------------------------------------------------------- */
console.log("\n" + "=".repeat(112));
console.log("TAB, IN EVERY CONTEXT — measured with a real key, judged by the STORED document");
console.log("=".repeat(112));
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
console.log(pad("context", 30) + pad("key", 10) + pad("node", 22) + pad("depth", 6) + pad("verdict", 16) + "focus kept");
console.log("-".repeat(112));
for (const r of rows) {
  console.log(
    pad(r.name, 30) + pad(r.key, 10)
    + pad(r.ctx?.node ?? (r.ctx?.where || "?"), 22)
    + pad(r.ctx?.listDepth ?? "-", 6)
    + pad(r.verdict, 16)
    + (r.focusKept === undefined ? "-" : r.focusKept ? "yes" : "NO"),
  );
}

const nothings = rows.filter((r) => r.verdict === "nothing");   // now genuinely nothing: no doc, no caret
const screenOnly = rows.filter((r) => r.verdict === "SCREEN-ONLY");
const lostFocus = rows.filter((r) => r.focusKept === false);
console.log("\nSUMMARY");
console.log(`  did nothing at all : ${nothings.length}  →  ${nothings.map((r) => `${r.name} [${r.key}]`).join(" · ") || "none"}`);
console.log(`  changed the SCREEN but not the document : ${screenOnly.length}  →  ${screenOnly.map((r) => `${r.name} [${r.key}]`).join(" · ") || "none"}`);
console.log(`  lost focus out of the document : ${lostFocus.length}  →  ${lostFocus.map((r) => `${r.name} [${r.key}]`).join(" · ") || "none"}`);
console.log(`  page errors : ${pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "clean"}`);

/* ═══ THE MEASURED TABLE, PINNED ══════════════════════════════════════════════════════════
 *
 * ⛔ THE FIRST RUN WAS A MEASUREMENT AND THIS IS WHAT IT FOUND, so the second run onwards is a
 * GUARD. Any row that changes is announced rather than discovered — which is the whole point of
 * having driven every context with a real key instead of reasoning about the keymap.
 *
 * The one genuine failure the first run found was the first item of a list, and it was STRUCTURAL
 * rather than a slip: a `listItem`'s content is `paragraph block*`, so a bullet can only tuck UNDER
 * the bullet above it, and the first bullet has none. Three "nothing" rows, one fact wearing three
 * hats — the first top-level bullet, the first bullet of the nested list, and a range whose start
 * is the first bullet.
 *
 * ⛔ ALL THREE NOW READ `restructured`, AND THAT IS THE OWNER'S DECISION LANDING (NEW-TAB,
 * 2026-08-13): **Tab changes the LEVEL of the current item; it never creates a node the user did
 * not type.** Where real nesting can happen it still does; where it cannot, the item's own
 * `indent` attribute goes up by one — so the document changes (hence `restructured`) with the same
 * nodes in the same order. `lib/notesListIndent.js` holds the rule and the option that was refused.
 *
 * ⛔ AND THREE ROWS CHANGING FROM "nothing" TO "restructured" IS NOT SUFFICIENT EVIDENCE FOR IT,
 * which is why two PROPERTIES are driven below the contexts. "The document changed" is equally
 * true of the fabricated-parent implementation he refused, and equally true of an outdent that
 * leaves litter behind. So the harness asks the two questions his constraints actually name — is
 * there an empty node in there, and does the pair round-trip byte-identical — with real keys.
 */
const EXPECTED = {
  "start of a list item|Tab": "restructured",
  "start of a list item|Shift+Tab": "restructured",
  "mid-word in a list item|Tab": "restructured",
  "mid-word in a list item|Shift+Tab": "restructured",
  "end of a list item|Tab": "restructured",
  "end of a list item|Shift+Tab": "restructured",
  "EMPTY nested list item|Tab": "restructured",
  "EMPTY nested list item|Shift+Tab": "restructured",
  "FIRST item of a list|Tab": "restructured",       // ⛔ CHANGED — its own level goes up by one
  "FIRST item of a list|Shift+Tab": "restructured",
  "already-nested item|Tab": "restructured",        // ⛔ CHANGED — also a first item, of the nest
  "already-nested item|Shift+Tab": "restructured",
  "after an autolinked EMAIL|Tab": "restructured",
  "after an autolinked EMAIL|Shift+Tab": "restructured",
  "after an autolinked URL|Tab": "restructured",
  "after an autolinked URL|Shift+Tab": "restructured",
  "range across two list items|Tab": "restructured",   // ⛔ CHANGED — every item in the range
  "range across two list items|Shift+Tab": "restructured",
  "inside a table cell|Tab": "moved-caret",
  "inside a table cell|Shift+Tab": "moved-caret",
  "LAST cell of a table|Tab": "restructured",       // adds a row, as Word does
  "LAST cell of a table|Shift+Tab": "moved-caret",
  "inside a positioned text box|Tab": "INSERTED-TEXT",
  "inside a positioned text box|Shift+Tab": "nothing",
  "plain paragraph|Tab": "INSERTED-TEXT",
  "plain paragraph|Shift+Tab": "nothing",           // nothing to take back — see REVERSIBILITY
  "the page TITLE field|Tab": "moved-caret",
  "the page TITLE field|Shift+Tab": "moved-caret",
  "REVERSIBILITY (plain para)|Tab then Shift+Tab": "reversible",
  // ⛔ The two properties his decision names, asked of the STORED document (NEW-TAB).
  "FIRST bullet: no empty node|Tab": "level-only",
  "FIRST bullet: round-trip|Tab then Shift+Tab": "byte-identical",
  "FIRST bullet: the PRINTED sheet|Tab": "indented-on-paper",
};

let drift = 0;
for (const r of rows) {
  const key = `${r.name}|${r.key}`;
  const want = EXPECTED[key];
  if (want === undefined) { console.log(`  ⚠ unpinned row: ${key} → ${r.verdict}`); continue; }
  if (want !== r.verdict) { drift += 1; console.log(`  ✗ ${key}: pinned "${want}", measured "${r.verdict}"`); }
}
console.log(drift ? `\n⛔ ${drift} ROW(S) DRIFTED from the measured table.` : "\n✓ every row matches the measured table.");

await browser.close();
if (drift || ONLY) process.exit(drift ? 1 : 0);
