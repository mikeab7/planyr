/* verify-notes-list-indent-height — THE VERTICAL-DROP REPORT, DRIVEN WITH REAL KEYS.
 *
 * Owner report, verbatim: *"the next thing to work on in the notebook module is the indenting
 * because it's broken. Or like the list function, like if I press tab again, it indents it
 * further, but then drops it down. So it's literally at a different height. So which can't be
 * right."*
 *
 * ⛔ MEASURED CAUSE. `sinkListItem` (real ProseMirror nesting — the mechanism Tab uses whenever
 * the pressed item has a sibling above it to tuck under, see lib/notesListIndent.js's header)
 * wraps the item in a brand-new `<ul>`/`<ol>`. The stylesheet's generic
 * ".ProseMirror ul, ol { margin: 1em 0 0 0 }" rule — meant to space a list away from a paragraph
 * that PRECEDES it elsewhere in the document — also landed on that new nested list, so the
 * sunk item sat 15px below its parent instead of the ordinary 6px sibling gap. A SECOND Tab
 * (the flat `indent` attribute, once real nesting has nowhere left to sink) adds no further
 * vertical change on its own — the whole drop is already there after the first press, which is
 * why "press Tab again" is when it becomes obvious rather than when it is introduced.
 *
 * This harness asserts PIXELS, which `test/notesListIndent.test.js`'s stylesheet-text check
 * cannot (that suite is node-only, per SYNTHETIC-KEYS-DONT-EDIT's layout twin — it can prove the
 * rule EXISTS, not that the browser actually applies it). Both halves are required to ship.
 *
 * ⛔ AND THE TWO SWEEP FINDINGS (NEW-2): the flat `indent` attribute is invisible to
 * ProseMirror's own structural depth, so an item wearing it read as an ordinary top-level item
 * to the native "Enter on an empty item" and "Backspace at position zero" handling — skipping
 * the expected "give the level back first" step and jumping straight to leaving the list /
 * losing list-item status. `emptyIndentableAt` (lib/notesListIndent.js) and the
 * `outdent-indent-attr` row (lib/notesBlockKeys.js) fix both; this harness drives both with real
 * keys, matching FOREGROUND-OR-VOID and SYNTHETIC-KEYS-DONT-EDIT.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
await assertMeasurable(page, "verify-notes-list-indent-height");

const T = (t) => ({ type: "text", text: t });
const P = (...c) => ({ type: "paragraph", content: c.length ? c : undefined });
const LI = (...c) => ({ type: "listItem", content: c });

async function seed(content) {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 400);
  await page.evaluate(([treeKey, prefix, doc]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Indent height", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify({ type: "doc", content: doc }));
  }, [TREE_KEY, PAGE_PREFIX, content]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
}

async function placeCaret(text, at = "end") {
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
      return { x: Math.round(rect.left || 5), y: Math.round(rect.top + (rect.height || 14) / 2) };
    }
    return null;
  }, [text, at]);
  if (!spot) throw new Error(`could not place the caret at "${text}" (${at})`);
  await page.mouse.click(spot.x, spot.y);
  await pacedWait(page, 150);
}

async function paraRect(text) {
  return page.evaluate((needle) => {
    const p = [...document.querySelectorAll(".ProseMirror p")].find((el) => el.textContent === needle);
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
  }, text);
}

async function html() { return page.evaluate(() => document.querySelector(".ProseMirror").innerHTML); }

const rows = [];
const check = (name, ok, detail) => { rows.push({ name, ok, detail }); };

/* ── 1. the reported case: THE GAP after a real-sink Tab must match an ordinary sibling gap ── */
await seed([{ type: "bulletList", content: [LI(P(T("First"))), LI(P(T("Second"))), LI(P(T("Third")))] }]);
const ordinaryGapRect = await paraRect("Second");
const firstRect = await paraRect("First");
const ordinaryGap = ordinaryGapRect.top - firstRect.bottom;

await placeCaret("Second", "end");
await page.keyboard.press("Tab");                                    // real sinkListItem
await pacedWait(page, 400);
const afterFirst = await paraRect("First");                          // parent's own line, unmoved
const afterSecond = await paraRect("Second");                        // now the sunk child
const nestedGap = afterSecond.top - afterFirst.bottom;
check(
  "real-sink Tab: nested child sits at the ordinary sibling gap, not a bigger one",
  nestedGap === ordinaryGap,
  `ordinary sibling gap ${ordinaryGap}px, nested-child gap ${nestedGap}px`,
);

await page.keyboard.press("Tab");                                    // the attribute path, level 2
await pacedWait(page, 400);
const afterSecondTab2 = await paraRect("Second");
check(
  "a SECOND Tab (attribute path) adds no further vertical change",
  afterSecondTab2.top === afterSecond.top,
  `after 1st Tab top=${afterSecond.top}, after 2nd Tab top=${afterSecondTab2.top}`,
);

/* ── 2. Enter on an empty item wearing the ATTRIBUTE level gives it back before leaving ─────── */
await seed([{ type: "bulletList", content: [LI(P(T("Only item")))] }]);
await placeCaret("Only item", "end");
await page.keyboard.press("Tab");                                    // attribute indent=1 (no sibling to sink under)
await pacedWait(page, 300);
await page.keyboard.press("Enter");                                  // new empty sibling, inherits indent=1
await pacedWait(page, 300);
const afterCreate = await html();
await page.keyboard.press("Enter");                                  // the empty item's own Enter
await pacedWait(page, 400);
const afterEnter = await html();
check(
  "Enter on the new empty item inherits the attribute level",
  /data-indent="1"[^>]*>(?:(?!<\/li>).)*?<br class="ProseMirror-trailingBreak">/.test(afterCreate) || /<li data-indent="1"><p><br class="ProseMirror-trailingBreak">/.test(afterCreate),
  afterCreate.slice(0, 220),
);
check(
  "⛔ Enter on the empty attribute-indented item OUTDENTS it — stays in the list, loses the level",
  /<ul>(?:(?!<\/ul>).)*<li><p><br class="ProseMirror-trailingBreak">/.test(afterEnter) && !afterEnter.includes('data-placeholder'),
  afterEnter,
);

/* ── 3. Backspace at the START of an item wearing the ATTRIBUTE level ────────────────────────── */
await seed([{ type: "bulletList", content: [LI(P(T("Solo item")))] }]);
await placeCaret("Solo item", "end");
await page.keyboard.press("Tab");
await pacedWait(page, 300);
await placeCaret("Solo item", "start");
await page.keyboard.press("Backspace");
await pacedWait(page, 400);
const afterBackspace = await html();
check(
  "⛔ Backspace at the start of an attribute-indented item OUTDENTS it — stays a list item",
  /<ul><li><p>Solo item<\/p><\/li><\/ul>/.test(afterBackspace),
  afterBackspace,
);

/* ── table ────────────────────────────────────────────────────────────────────────────────── */
console.log("\n" + "=".repeat(100));
console.log("NOTES LIST-INDENT HEIGHT — the vertical-drop report and the two sweep findings it led to");
console.log("=".repeat(100));
for (const r of rows) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : `\n      ${r.detail}`}`);
console.log(`  ${pageErrors.length ? "✗" : "✓"} no page errors during the run${pageErrors.length ? `\n      ${pageErrors.slice(0, 3).join(" | ")}` : ""}`);

const failed = rows.filter((r) => !r.ok).length + (pageErrors.length ? 1 : 0);
console.log(`\n${rows.length + 1 - failed}/${rows.length + 1} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
