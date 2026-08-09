/* BACKSPACE AT POSITION ZERO, DEFINED FOR EVERY BLOCK BOUNDARY — driven against the REAL
 * built app, headless (B291536 / B291537, and the guard the B36051 alignment fix must not
 * lose).
 *
 * ⛔ WHY THIS FILE EXISTS. B36051 defined Backspace-at-the-start-of-a-block for exactly ONE
 * node type — a paragraph carrying an odd alignment — and left every other boundary to
 * whatever the default keymap happened to do. The owner then hit the same class again in
 * LISTS: one press at the start of a nested bullet un-nested it AND merged it into its
 * parent; one press at the start of a top-level bullet merged it upward, left an EMPTY
 * orphan bullet behind, and promoted a child he had not touched. Three structural changes
 * from one keypress. So the fix is not another special case: it is a TABLE that names every
 * boundary, and this harness, which drives each row for real and asserts the resulting
 * DOCUMENT TREE — node types, nesting depth, child counts, and that no empty node appeared.
 *
 * ⛔ WHAT THIS DELIBERATELY DOES NOT DO: assert that a handler ran, or count characters.
 * Both are satisfied by builds that are visibly broken. Every row states the whole tree
 * before and the whole tree after, and compares structurally.
 *
 * The keypress is a REAL browser keypress every time. Only the SETUP is programmatic — the
 * `__PLANYR_E2E`-gated `window.__noteEditor` seeds an exact tree and puts the caret at an
 * exact position, because a harness that has to type its way into a shape cannot state the
 * case it is testing.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-backspace.mjs            # assert
 *   node ui-audit/verify-notes-backspace.mjs --report   # print every before/after tree
 *
 * MUTATION CHECK (how you prove the guard is not green by accident): drop `NoteBlockKeys`
 * out of NOTE_EXTENSIONS, or return `false` from its Backspace, rebuild, and run again. The
 * owner's own symptoms come back by name — "bullet onebullet two" as a single item, and an
 * empty list item where there should be none.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const REPORT = process.argv.includes("--report");

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

/* ---- document builders (the case table below reads as prose because of these) ---------- */
const P = (t, attrs) => ({ type: "paragraph", ...(attrs ? { attrs } : {}), ...(t ? { content: [{ type: "text", text: t }] } : {}) });
const B = (t) => ({ type: "paragraph", content: [{ type: "text", text: t, marks: [{ type: "bold" }] }] });
const H = (t, level = 2) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text: t }] });
const LI = (t, sub) => ({ type: "listItem", content: [P(t), ...(sub ? [sub] : [])] });
const UL = (...items) => ({ type: "bulletList", content: items });
const OL = (...items) => ({ type: "orderedList", content: items });
const TI = (t, sub) => ({ type: "taskItem", attrs: { checked: false }, content: [P(t), ...(sub ? [sub] : [])] });
const TL = (...items) => ({ type: "taskList", content: items });
const QUOTE = (...blocks) => ({ type: "blockquote", content: blocks });
const CODE = (t) => ({ type: "codeBlock", content: [{ type: "text", text: t }] });
const CELL = (t) => ({ type: "tableCell", content: [P(t)] });
const ROW = (...cells) => ({ type: "tableRow", content: cells });
const TABLE = (...rows) => ({ type: "table", content: rows });
const IMG = () => ({ type: "noteImage", attrs: { imageId: "probe-image", alt: "probe" } });
const SKETCH = () => ({ type: "noteSketch", attrs: { boxes: [{ id: "b1", label: "Box", body: "", x: 40, y: 30 }], links: [] } });
const doc = (...content) => ({ type: "doc", content });

/* ---- structural printing / comparison -------------------------------------------------- */
/** Attributes worth showing: anything not at its default. Keeps the printed tree readable
 *  while still failing on an alignment or a heading level that changed. */
const SHOWN_ATTRS = new Set(["level", "textAlign", "checked", "language"]);
/** ⛔ NORMALISE AWAY THE TRAILING NODE, or every table/list case reads as a failure for a
 *  reason that has nothing to do with Backspace. StarterKit's `TrailingNode` keeps one empty
 *  paragraph at the end of a document whose last block is not a textblock, and it adds it on
 *  SEEDING — before the keypress under test. Both sides of the comparison lose it. */
const normalise = (d) => {
  if (!d || !Array.isArray(d.content)) return d;
  const content = [...d.content];
  const last = content[content.length - 1];
  if (last && last.type === "paragraph" && !last.content) content.pop();
  return { ...d, content };
};
const shape = (n, d = 0) => {
  if (!n || typeof n !== "object") return "";
  const pad = "  ".repeat(d);
  const attrs = Object.entries(n.attrs || {})
    .filter(([k, v]) => SHOWN_ATTRS.has(k) && v !== null && v !== false && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  const marks = (n.marks || []).map((m) => m.type).sort();
  const head = `${pad}${n.type}${attrs.length ? `[${attrs.join(" ")}]` : ""}${marks.length ? `{${marks.join(",")}}` : ""}`
    + (n.type === "text" ? ` ${JSON.stringify(n.text)}` : "");
  return [head, ...(n.content || []).map((c) => shape(c, d + 1))].filter(Boolean).join("\n");
};
const indent = (s) => s.split("\n").map((l) => "      " + l).join("\n");

/** Every node in the tree, flat. */
const allNodes = (n, out = []) => { if (n && typeof n === "object") { out.push(n); (n.content || []).forEach((c) => allNodes(c, out)); } return out; };
/** An EMPTY structural node is litter: a list item with no text, or a list with no items. */
const emptyNodes = (d) => allNodes(d).filter((n) => {
  if (n.type === "listItem" || n.type === "taskItem") {
    const text = allNodes(n).filter((x) => x.type === "text").map((x) => x.text).join("");
    return text.trim() === "";
  }
  if (n.type === "bulletList" || n.type === "orderedList" || n.type === "taskList") return (n.content || []).length === 0;
  return false;
}).map((n) => n.type);
const textOf = (d) => allNodes(d).filter((n) => n.type === "text").map((n) => n.text).join("");

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * THE TABLE. One row per block boundary. `at` is a path of child indexes to the TEXTBLOCK the
 * caret goes to the very start of; `after` is the whole document that ONE Backspace must
 * produce. Where a case is "nothing may happen", `after` is the same tree as `before`.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
const CASES = [
  /* ── the two the owner reported, by name ──────────────────────────────────────────────── */
  {
    id: "nested list item — REPRO A",
    why: "one press OUTDENTS it one level and does nothing else; it must NOT also merge into its parent",
    before: doc(P("para one"), UL(LI("bullet one", UL(LI("bullet two"))))),
    at: [1, 0, 1, 0, 0],
    after: doc(P("para one"), UL(LI("bullet one"), LI("bullet two"))),
  },
  {
    id: "top-level list item WITH children — REPRO B",
    why: "it becomes a plain paragraph keeping its text; no merge into the paragraph above, no empty orphan bullet, and the child stays a bullet",
    before: doc(P("para one"), UL(LI("bullet one", UL(LI("bullet two"))))),
    at: [1, 0, 0],
    after: doc(P("para one"), P("bullet one"), UL(LI("bullet two"))),
  },
  {
    id: "top-level list item, second press joins",
    why: "only a FURTHER press joins it with the block above — that is what makes the destructive step the second one",
    before: doc(P("para one"), UL(LI("bullet one", UL(LI("bullet two"))))),
    at: [1, 0, 0],
    presses: 2,
    after: doc(P("para onebullet one"), UL(LI("bullet two"))),
  },

  /* ── lists, the rest of the surface ───────────────────────────────────────────────────── */
  {
    id: "first item of a list, no children",
    why: "leaves the list as a plain paragraph; the items after it stay a list at their own level",
    before: doc(P("para one"), UL(LI("one"), LI("two"))),
    at: [1, 0, 0],
    after: doc(P("para one"), P("one"), UL(LI("two"))),
  },
  {
    id: "a list item in the MIDDLE of a list",
    why: "that one item stops being a bullet; the items either side keep their own level and no empty list is left",
    before: doc(UL(LI("one"), LI("two"), LI("three"))),
    at: [0, 1, 0],
    after: doc(UL(LI("one")), P("two"), UL(LI("three"))),
  },
  {
    id: "the list is the FIRST block of the document",
    why: "there is nothing above to join with, so the item still just leaves the list",
    before: doc(UL(LI("one"), LI("two"))),
    at: [0, 0, 0],
    after: doc(P("one"), UL(LI("two"))),
  },
  {
    id: "nested item that has children of its OWN",
    why: "it outdents one level and takes its own children with it — their depth RELATIVE to it is untouched",
    before: doc(UL(LI("one", UL(LI("two", UL(LI("three"))))))),
    at: [0, 0, 1, 0, 0],
    after: doc(UL(LI("one"), LI("two", UL(LI("three"))))),
  },
  {
    id: "numbered list, top-level item",
    why: "a numbered list is the same rule — nothing about it is bullet-specific",
    before: doc(P("para one"), OL(LI("one"), LI("two"))),
    at: [1, 0, 0],
    after: doc(P("para one"), P("one"), OL(LI("two"))),
  },
  {
    id: "checklist, nested item",
    why: "a task item outdents exactly like a bullet — and its checked state rides along",
    before: doc(P("para one"), TL(TI("task one", TL(TI("task two"))))),
    at: [1, 0, 1, 0, 0],
    after: doc(P("para one"), TL(TI("task one"), TI("task two"))),
  },
  {
    id: "checklist, top-level item",
    why: "it becomes a plain paragraph, keeping its text — and stops being a checkbox",
    before: doc(P("para one"), TL(TI("task one"), TI("task two"))),
    at: [1, 0, 0],
    after: doc(P("para one"), P("task one"), TL(TI("task two"))),
  },
  {
    /* ⛔⛔ THE OWNER'S FIRST SYMPTOM, VERBATIM AND REPRODUCED: one press, and two list items
     * become ONE item reading "bullet onebullet two". Found by
     * ui-audit/find-backspace-symptoms.mjs sweeping 414 single-Backspace probes over 99
     * list-shaped documents — it does NOT happen on a plain bulleted list, which is why the
     * first pass at this item could not reproduce it and shipped a harness that stayed green
     * on the broken build. It happens when one list FOLLOWS ANOTHER of a different type,
     * which is exactly what an Outlook paste makes. RED on the reverted build, by name. */
    id: "⛔⛔ SYMPTOM — a list that FOLLOWS another list: press 1 merged two items into \"A1A2\"",
    defect: true,
    why: "the owner's \"bullet onebullet two\": the first item of the second list leaves its list as a plain line — it must never be absorbed into the item above",
    before: doc(TL(TI("A1")), UL(LI("A2")), P("A3")),
    at: [1, 0, 0],
    after: doc(TL(TI("A1")), P("A2"), P("A3")),
  },
  {
    /* ⛔⛔ THE OWNER'S SECOND SYMPTOM: an EMPTY ORPHAN list item, from one press. Same sweep,
     * same shape — a bulleted sub-list under a checklist item, caret on the blank line after
     * it. The default keymap's two passes leave a husk behind. */
    id: "⛔⛔ SYMPTOM — the blank line after a nested list: press 1 left an EMPTY ORPHAN bullet",
    defect: true,
    why: "no step may leave an empty list item behind; the blank line joins the last line above it and nothing is created",
    before: doc(P("A0"), TL(TI("A1", UL(LI("A2")))), P("")),
    at: [2],
    after: doc(P("A0"), TL(TI("A1", UL(LI("A2"))))),
  },
  {
    /* ⛔ THE ROW THAT REPRODUCES THE OWNER'S SYMPTOM CLASS, and the reason the list half of
     * this file is not green by accident. Tiptap's ListKeymap runs its Backspace handler
     * ONCE PER LIST TYPE over a forEach that does not stop at the first one to act — so on a
     * document that MIXES a checklist with a bulleted list, pass two runs against the state
     * pass one already changed. Measured on the default keymap: ONE press here dissolved BOTH
     * levels, leaving "bullet one" and "task two" as plain paragraphs — the whole two-level
     * list gone from a single keystroke. */
    id: "⛔ a CHECKLIST nested inside a BULLETED list — the two-pass keymap case",
    defect: true,
    why: "one press takes ONE step: the inner item stops being a checkbox and becomes a line of its parent bullet. The parent must NOT also leave its list",
    before: doc(P("para one"), UL(LI("bullet one", TL(TI("task two"))))),
    at: [1, 0, 1, 0, 0],
    after: doc(P("para one"), UL({ type: "listItem", content: [P("bullet one"), P("task two")] })),
  },
  {
    id: "⛔ BULLETS nested inside a CHECKLIST — the same case the other way round",
    defect: true,
    why: "the hazard is not bullet-specific; one press, one step, and the parent checklist survives",
    before: doc(P("para one"), TL(TI("task one", UL(LI("bullet two"))))),
    at: [1, 0, 1, 0, 0],
    after: doc(P("para one"), TL({ type: "taskItem", attrs: { checked: false }, content: [P("task one"), P("bullet two")] })),
  },
  {
    id: "paragraph after a CHECKLIST",
    why: "its words join the last task — the checklist is a container, so the paragraph must not quietly become another checkbox",
    before: doc(TL(TI("task one"), TI("task two")), P("after")),
    at: [1],
    after: doc(TL(TI("task one"), TI("task twoafter"))),
  },
  {
    id: "an EMPTY paragraph BETWEEN two lists",
    why: "the blank line goes and the two lists stay two lists — nothing is merged across it",
    before: doc(UL(LI("b1")), P(""), TL(TI("t1"))),
    at: [1],
    after: doc(UL(LI("b1")), TL(TI("t1"))),
  },
  {
    id: "an EMPTY list item",
    why: "an empty bullet is the one case where leaving the list IS the whole gesture, and it must not leave a husk",
    before: doc(P("para one"), UL(LI("one"), LI(""), LI("three"))),
    at: [1, 1, 0],
    after: doc(P("para one"), UL(LI("one")), P(""), UL(LI("three"))),
  },

  /* ── paragraphs, headings and the formatting-first rule ───────────────────────────────── */
  {
    id: "plain paragraph after a plain paragraph",
    why: "the ordinary join, unchanged — one step, and it is the step everybody expects",
    before: doc(P("one"), P("two")),
    at: [1],
    after: doc(P("onetwo")),
  },
  {
    id: "the very first block of the document",
    why: "nothing above to step to, so NOTHING happens at all",
    before: doc(P("only line")),
    at: [0],
    after: doc(P("only line")),
  },
  {
    id: "paragraph after a heading",
    why: "the ordinary join — the paragraph's words go up into the heading, which is one visible step",
    before: doc(H("Heading"), P("body")),
    at: [1],
    after: doc(H("Headingbody")),
  },
  {
    id: "HEADING after a paragraph",
    defect: true,
    why: "the formatting comes off FIRST (it becomes a plain paragraph) — the join is the second press, by which point it is visible",
    before: doc(P("body"), H("Heading")),
    at: [1],
    after: doc(P("body"), P("Heading")),
  },
  {
    id: "heading after a paragraph, second press",
    defect: true,
    why: "…and THEN it joins",
    before: doc(P("body"), H("Heading")),
    at: [1],
    presses: 2,
    after: doc(P("bodyHeading")),
  },
  {
    id: "a paragraph whose only difference is ALIGNMENT (B36051 — guard it stays fixed)",
    why: "the alignment is undone first; the whole-chunk-moves-left report is exactly this",
    before: doc(P("above"), P("right one", { textAlign: "right" })),
    at: [1],
    after: doc(P("above"), P("right one")),
  },
  {
    id: "a paragraph whose only difference is a MARK",
    why: "a mark is not a structural difference, so this is the ordinary join and nothing is lost",
    before: doc(P("above"), B("bold one")),
    at: [1],
    after: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "above" }, { type: "text", text: "bold one", marks: [{ type: "bold" }] }] }] },
  },
  {
    id: "paragraph immediately after a LIST",
    why: "its words join the last bullet — one step, nothing re-levelled, no item created or destroyed",
    before: doc(UL(LI("one"), LI("two")), P("after")),
    at: [1],
    after: doc(UL(LI("one"), LI("twoafter"))),
  },
  {
    id: "paragraph immediately after a BLOCKQUOTE",
    why: "same rule as the list — its words join the last quoted line; the paragraph does not quietly become part of the quote",
    before: doc(QUOTE(P("quoted")), P("after")),
    at: [1],
    after: doc(QUOTE(P("quotedafter"))),
  },
  {
    id: "blockquote, first paragraph",
    why: "it leaves the quote rather than merging into the block above — one step, and the quote is not silently dissolved into its neighbour",
    before: doc(P("before"), QUOTE(P("quoted"), P("second"))),
    at: [1, 0],
    after: doc(P("before"), P("quoted"), QUOTE(P("second"))),
  },
  {
    id: "code block",
    defect: true,
    why: "the first press turns it back into a plain paragraph — it never merges its code into the prose above",
    before: doc(P("before"), CODE("const x = 1;")),
    at: [1],
    after: doc(P("before"), P("const x = 1;")),
  },

  /* ── tables, images, sketches: the boundaries where the WRONG answer destroys content ─── */
  {
    id: "the FIRST cell of a table (owner-verified safe — must stay safe)",
    why: "nothing destructive: the table survives whole and no cells merge",
    before: doc(P("before"), TABLE(ROW(CELL("a1"), CELL("b1")), ROW(CELL("a2"), CELL("b2")))),
    at: [1, 0, 0, 0],
    after: doc(P("before"), TABLE(ROW(CELL("a1"), CELL("b1")), ROW(CELL("a2"), CELL("b2")))),
  },
  {
    id: "a cell that is NOT the first",
    why: "cells never merge into each other on a Backspace at their start",
    before: doc(TABLE(ROW(CELL("a1"), CELL("b1")), ROW(CELL("a2"), CELL("b2")))),
    at: [0, 0, 1, 0],
    after: doc(TABLE(ROW(CELL("a1"), CELL("b1")), ROW(CELL("a2"), CELL("b2")))),
  },
  {
    id: "paragraph immediately AFTER a table",
    defect: true,
    why: "the press must not put the whole table one keystroke from deletion — it steps the caret into the last cell and changes nothing",
    before: doc(TABLE(ROW(CELL("a1"), CELL("b1"))), P("after")),
    at: [1],
    after: doc(TABLE(ROW(CELL("a1"), CELL("b1"))), P("after")),
    caretEndsIn: "tableCell",
  },
  {
    id: "paragraph after a PICTURE",
    defect: true,
    why: "the picture is selected, never deleted — the destructive step is a second, deliberate press",
    before: doc(IMG(), P("after")),
    at: [1],
    after: doc(IMG(), P("after")),
    nodeSelected: "noteImage",
  },
  {
    id: "paragraph after a SKETCH",
    defect: true,
    why: "same rule as the picture — a sketch is a drawing somebody made, and one stray press must not take it",
    before: doc(SKETCH(), P("after")),
    at: [1],
    after: doc(SKETCH(), P("after")),
    nodeSelected: "noteSketch",
  },
  {
    id: "EMPTY paragraph after a picture",
    defect: true,
    why: "the empty-line case is the one people actually hit, and it must behave the same",
    before: doc(IMG(), P("")),
    at: [1],
    after: doc(IMG(), P("")),
    nodeSelected: "noteImage",
  },
];

/* ---- drive ----------------------------------------------------------------------------- */
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-notes-backspace");
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

console.log("Backspace at the start of a block — every boundary, driven for real\n");

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await page.locator('[data-testid="notes-new-page"]').click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.waitForFunction(() => !!window.__noteEditor, null, { timeout: 20000 });

let failures = 0;
/* ⛔ A ROW THAT PASSES ON THE BROKEN BUILD IS NOT EVIDENCE, and the two kinds must never be
 * confused for each other. A **defect row** goes RED when this branch's fix is reverted to
 * main — it is proof. A **pin** is a boundary main already gets right, kept so a future
 * change cannot take it away silently; it proves nothing about today and is labelled so
 * nobody reads it as if it did. The split is printed at the end of every run, and
 * `DEFECT_ROWS_EXPECTED` fails the run if a defect row is quietly downgraded to a pin. */
let defectRows = 0;
let pinRows = 0;
const DEFECT_ROWS_EXPECTED = 11;
for (const c of CASES) {
  const seeded = await page.evaluate(([d, path]) => {
    window.__noteEditor.setDoc(d);
    const pos = window.__noteEditor.startOf(path);
    if (pos === null) return null;
    window.__noteEditor.caretAt(pos);
    return { pos, sel: window.__noteEditor.selection(), json: window.__noteEditor.json() };
  }, [c.before, c.at]);
  if (!seeded) { ok(c.id, false, "the harness could not reach that caret position"); failures += 1; continue; }

  for (let i = 0; i < (c.presses || 1); i += 1) {
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(90);
  }
  const got = await page.evaluate(() => ({ json: window.__noteEditor.json(), sel: window.__noteEditor.selection() }));

  const want = shape(normalise(c.after));
  const have = shape(normalise(got.json));
  const treeOk = want === have;

  /* Litter: an empty structural node that was NOT there before. */
  const litterBefore = emptyNodes(c.before).length;
  const litterAfter = emptyNodes(got.json).length;
  const noLitter = litterAfter <= litterBefore;

  /* Nothing may vanish: every character that was in the document is still in it (the join
   * cases concatenate, they never drop). */
  const keptText = textOf(got.json).replace(/\s/g, "") === textOf(c.after).replace(/\s/g, "");

  const pass = treeOk && noLitter && keptText;
  if (!pass) failures += 1;
  ok(c.id, pass, c.why);
  if (c.defect) defectRows += 1; else pinRows += 1;
  if (REPORT || !pass) {
    console.log("    before:\n" + indent(shape(normalise(c.before))));
    console.log("    expected:\n" + indent(want));
    console.log("    got:\n" + indent(have));
    if (!noLitter) console.log(`    ⛔ EMPTY NODE(S) LEFT BEHIND: ${emptyNodes(got.json).join(", ")}`);
  }
}

/* Two cases assert WHERE THE CARET ENDED UP as well as the tree, because "changed nothing"
 * is only the right answer if the press also went somewhere sensible. */
for (const c of CASES.filter((x) => x.caretEndsIn || x.nodeSelected)) {
  await page.evaluate(([d, path]) => {
    window.__noteEditor.setDoc(d);
    window.__noteEditor.caretAt(window.__noteEditor.startOf(path));
  }, [c.before, c.at]);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(120);
  const where = await page.evaluate(() => {
    const sel = window.__noteEditor.selection();
    const el = document.querySelector(".ProseMirror-selectednode");
    return { sel, selectedNode: el ? (el.getAttribute("data-node-type") || el.tagName.toLowerCase()) : null };
  });
  if (c.caretEndsIn) {
    ok(`…and the caret lands in the ${c.caretEndsIn}, not nowhere — ${c.id}`, where.sel && where.sel.empty, JSON.stringify(where.sel));
  }
  if (c.nodeSelected) {
    ok(`…and the ${c.nodeSelected} is SELECTED rather than deleted — ${c.id}`, where.sel && !where.sel.empty, JSON.stringify(where.sel));
  }
}

ok(`${DEFECT_ROWS_EXPECTED} rows are DEFECT rows — proven RED with the fix reverted to main`,
  defectRows === DEFECT_ROWS_EXPECTED, `${defectRows} defect · ${pinRows} pin (a pin is a boundary main already gets right, kept as a regression guard — it is never evidence)`);
ok("no page errors during the run", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
process.exit(passed === checks.length ? 0 : 1);
