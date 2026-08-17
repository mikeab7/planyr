/* audit-notes-enter-inherit — A NEW LINE CONTINUES THE ONE ABOVE IT (NEW-ENTER-INHERIT).
 *
 * ⛔ HIS REPORT: *"it doesn't seem like when I start a new line, it carries the formatting (at
 * least the text size of what's directly above it)."*
 *
 * ⛔ AND HIS INSTRUCTION, which is the whole design of this file: *"Verify against the STORED
 * document, not the screen: type a line, set a size, press Enter with a real key, type again,
 * then read both paragraphs' attrs out of the saved document and assert they match. Screen
 * inheritance can look right through CSS while the document has lost the attribute — that is the
 * exact trap the resize bug hid behind."* So every verdict here is `localStorage`, every key is a
 * REAL key (SYNTHETIC-KEYS-DONT-EDIT), and nothing is judged by how it renders.
 *
 * ⛔ WHY BOTH TIERS ARE READ SEPARATELY, and it matters for the diagnosis: a text size in this
 * module lives in TWO places — a `textStyle` mark on the inline run (what the toolbar sets) and a
 * `fontSize` attribute on the BLOCK (mirrored by `deriveBlockSizes` so the line box can shrink,
 * B532641). A split can lose either one independently, and losing only the block attribute
 * produces text at the right size in a line box of the wrong height — which reads as a spacing
 * bug, not a formatting one. The table below prints both so the failure names itself.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "audit-notes-enter-inherit");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

let pass = 0; let fail = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

/** A doc whose first paragraph already carries a non-default size, on the block AND the run. */
const sized = (extra = {}) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { fontSize: 22, lineHeight: 1.5, textAlign: "right", ...extra },
      content: [{ type: "text", marks: [{ type: "textStyle", attrs: { fontSize: "22px", color: "#B8418C" } }, { type: "bold" }], text: "SIZED first line" }],
    },
  ],
});

const inBox = () => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "flow" }] },
    {
      type: "noteAnchor", attrs: { x: 380, y: 140, w: 300 },
      content: [{
        type: "paragraph",
        attrs: { fontSize: 22, lineHeight: 1.5 },
        content: [{ type: "text", marks: [{ type: "textStyle", attrs: { fontSize: "22px" } }], text: "SIZED in a box" }],
      }],
    },
  ],
});

const listDoc = () => ({
  type: "doc",
  content: [{
    type: "bulletList",
    content: [{
      type: "listItem",
      content: [{
        type: "paragraph",
        attrs: { fontSize: 22 },
        content: [{ type: "text", marks: [{ type: "textStyle", attrs: { fontSize: "22px" } }], text: "SIZED item" }],
      }],
    }],
  }],
});

async function seed(doc) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, key, d]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Enter", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(key, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** Every textblock in the STORED document: its own attrs, and the marks on its first run. */
const storedBlocks = () => page.evaluate((k) => {
  const out = [];
  const walk = (n, inList = false) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "paragraph" || n.type === "heading") {
      const run = (n.content || []).find((c) => c.type === "text");
      const style = (run?.marks || []).find((m) => m.type === "textStyle");
      out.push({
        text: (n.content || []).filter((c) => c.type === "text").map((c) => c.text).join(""),
        attrs: n.attrs || {},
        runSize: style?.attrs?.fontSize ?? null,
        runColor: style?.attrs?.color ?? null,
        runMarks: (run?.marks || []).map((m) => m.type).sort().join("+"),
        inList,
      });
    }
    (n.content || []).forEach((c) => walk(c, inList || n.type === "listItem"));
  };
  try { walk(JSON.parse(localStorage.getItem(k))); } catch (_) { /* unreadable */ }
  return out;
}, PAGE_KEY);

/** Put the caret at a place in a word, with a REAL click, then press REAL keys. */
async function caretIn(word, where = "end") {
  const spot = await page.evaluate(([needle, w]) => {
    const pm = document.querySelector(".ProseMirror");
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.nodeValue.indexOf(needle);
      if (i < 0) continue;
      const r = document.createRange();
      const at = w === "end" ? i + needle.length : w === "start" ? i : i + Math.floor(needle.length / 2);
      r.setStart(n, at); r.collapse(true);
      const b = r.getBoundingClientRect();
      const p = n.parentElement.getBoundingClientRect();
      return { x: Math.round(b.left || p.left + 2), y: Math.round((b.top || p.top) + (b.height || p.height) / 2) };
    }
    return null;
  }, [word, where]);
  if (!spot) return false;
  await page.mouse.click(spot.x, spot.y);
  await pacedWait(page, 250);
  /* ⛔ A POSITIONED BOX TAKES TWO PRESSES, AND THE FIRST VERSION OF THIS HARNESS SENT ONE — so
   * case 4 reported "the typing landed nowhere" against an app that was fine. Press 1 SELECTS the
   * box (B434416's two-stage model, deliberately: the box is the thing you have hold of) and
   * press 2 puts the caret in its words. A driver that presses once never gets a caret and then
   * blames the feature. */
  const needsSecond = await page.evaluate(() => !document.querySelector(".ProseMirror")
    ?.contains(document.getSelection()?.anchorNode || null));
  if (needsSecond) {
    await page.mouse.click(spot.x, spot.y);
    await pacedWait(page, 250);
  }
  return true;
}

const pad = (s, n) => String(s == null ? "—" : s).padEnd(n);
const show = (b) => `${pad(b.text.slice(0, 18), 20)}block fs=${pad(b.attrs.fontSize, 6)}lh=${pad(b.attrs.lineHeight, 6)}align=${pad(b.attrs.textAlign, 7)}run fs=${pad(b.runSize, 7)}marks=${b.runMarks || "—"}`;

/**
 * The core case: caret at the end of a formatted line, real Enter, real typing, read storage.
 * `key` lets the same body run for Shift+Enter.
 */
async function enterCase(name, { doc, word, where = "end", key = "Enter", expectSplit = true }) {
  console.log("\n" + "=".repeat(112));
  console.log(name);
  console.log("=".repeat(112));
  await seed(doc);
  const before = await storedBlocks();
  if (!(await caretIn(word, where))) { ok(`${name}: the fixture text is reachable`, false, `"${word}" not found`); return; }
  await page.keyboard.press(key);
  await pacedWait(page, 250);
  await page.keyboard.type("NEWLINE");
  await pacedWait(page, 900);
  const after = await storedBlocks();

  console.log("  BEFORE");
  before.forEach((b) => console.log("    " + show(b)));
  console.log("  AFTER");
  after.forEach((b) => console.log("    " + show(b)));

  const src = before.find((b) => b.text.includes("SIZED")) || before[0];
  const fresh = after.find((b) => b.text.includes("NEWLINE"));
  if (!fresh) {
    ok(`${name} · the typing landed somewhere readable`, false, "no block holds the typed text");
    return;
  }
  if (!expectSplit) {
    ok(`${name} · a soft break stays in the SAME paragraph`, after.length === before.length,
      `${before.length} → ${after.length} blocks`);
  }

  /* ⛔ THE BLOCK TIER — the one the spacing work added, and the prime suspect. */
  ok(`${name} · the new line keeps the block font size`, fresh.attrs.fontSize === src.attrs.fontSize,
    `${src.attrs.fontSize} → ${fresh.attrs.fontSize}`);
  ok(`${name} · …and the line height`, fresh.attrs.lineHeight === src.attrs.lineHeight,
    `${src.attrs.lineHeight} → ${fresh.attrs.lineHeight}`);
  if (src.attrs.textAlign !== undefined) {
    ok(`${name} · …and the alignment`, fresh.attrs.textAlign === src.attrs.textAlign,
      `${src.attrs.textAlign} → ${fresh.attrs.textAlign}`);
  }

  /* ⛔ THE INLINE TIER — a size that survives here but not above renders right and measures
   * wrong, which is a spacing bug wearing a formatting bug's clothes. */
  ok(`${name} · the typed run keeps the text size`, fresh.runSize === src.runSize,
    `${src.runSize} → ${fresh.runSize}`);
  ok(`${name} · …and every mark that was in force`, fresh.runMarks === src.runMarks,
    `${src.runMarks || "—"} → ${fresh.runMarks || "—"}`);
  if (src.runColor) {
    ok(`${name} · …including the colour`, fresh.runColor === src.runColor, `${src.runColor} → ${fresh.runColor}`);
  }
  if (src.inList) {
    ok(`${name} · …and it is still a list item`, fresh.inList === true, `inList=${fresh.inList}`);
  }
}

await enterCase("1 · Enter at the END of a sized line", { doc: sized(), word: "SIZED first line" });
await enterCase("2 · Enter in the MIDDLE, splitting the line in two", { doc: sized(), word: "SIZED first line", where: "mid" });
await enterCase("3 · Enter at the START of a sized line", { doc: sized(), word: "SIZED first line", where: "start" });
await enterCase("4 · Enter inside a POSITIONED BOX", { doc: inBox(), word: "SIZED in a box" });
await enterCase("5 · Enter in a sized LIST ITEM", { doc: listDoc(), word: "SIZED item" });
await enterCase("6 · Shift+Enter (soft break) resets nothing", { doc: sized(), word: "SIZED first line", key: "Shift+Enter", expectSplit: false });

/* ⛔ THE EXCEPTION HE NAMED, AND IT MUST NOT BE BROKEN BY THE FIX: Enter on an EMPTY list item
 * exits the list. Any fix that carries attributes across a split by force will happily carry the
 * list item too, so this is asserted in the same run rather than left to be noticed later. */
console.log("\n" + "=".repeat(112));
console.log("7 · ⛔ Enter on an EMPTY list item still EXITS the list (the exception he named)");
console.log("=".repeat(112));
await seed({
  type: "doc",
  content: [{
    type: "bulletList",
    content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "ITEM one" }] }] },
      { type: "listItem", content: [{ type: "paragraph" }] },
    ],
  }],
});
const listedBefore = await page.evaluate((k) => (localStorage.getItem(k) || "").includes("bulletList"), PAGE_KEY);
await caretIn("ITEM one", "end");
/* ⛔ DRIVEN THE WAY A PERSON ACTUALLY DOES IT: Enter makes a new empty item, Enter again leaves
 * the list. The first version pressed ArrowDown to reach the pre-seeded empty item and could not
 * prove it had arrived — an instrument that cannot confirm its own precondition reports whatever
 * it finds. This way the empty item is one this run created, so there is no doubt where the caret
 * is. */
await page.keyboard.press("Enter");
await pacedWait(page, 250);
await page.keyboard.press("Enter");
await pacedWait(page, 250);
await page.keyboard.type("OUT");
await pacedWait(page, 900);
const outBlocks = await storedBlocks();
outBlocks.forEach((b) => console.log("    " + show(b)));
const escaped = outBlocks.find((b) => b.text.includes("OUT"));
ok("the fixture really was a list", listedBefore);
ok("⛔ Enter on the empty item left the list rather than continuing it",
  Boolean(escaped) && escaped.inList === false, escaped ? `inList=${escaped.inList}` : "no OUT block");

console.log(`\n${pass}/${pass + fail} checks passed`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(`page errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "clean"}`);
await browser.close();
process.exit(fail ? 1 : 0);
