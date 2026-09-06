/* SEARCH for the owner's reported SYMPTOMS across list-shaped documents, on whatever build is
 * being served (B291536, extended by B1260000).
 *
 * ⛔ WHY THIS EXISTS AND WHY IT IS COMMITTED. The first pass at B291536 could not reproduce
 * *"bullet onebullet two"* as ONE item, or the EMPTY ORPHAN bullet, on a plain three-block
 * bulleted list — so the harness that shipped beside it asserted a SPEC those rows already
 * met, and 26 of 37 rows stayed green with the fix reverted. A row that passes on the broken
 * build is not evidence. This is the instrument that closes that: it sweeps list-shaped
 * documents and caret positions, presses a REAL Backspace once at each, and reports every
 * position that produces any of THREE symptoms BY NAME.
 *
 * ⛔ B1260000 ADDED THE THIRD SYMPTOM AND THE ONE CELL OF THE MATRIX THAT WAS MISSING. Every
 * row here used to give the OUTER item its own text ("A1"); the owner's iPhone report was an
 * EMPTY outer item carrying a non-empty nested child, which this sweep had never once
 * generated. And a whole paragraph OUTSIDE any list disappearing (his "Tell Talbert…") is
 * invisible to the first two symptoms — both only look INSIDE list items. LOST CONTENT below
 * closes that: any label present anywhere in the document before the press that is gone from
 * the whole document after it.
 *
 * Run it against a build with the fix REVERTED to find the defect rows; run it against the
 * fixed build and it must come back with NOTHING.
 *
 *   node ui-audit/find-backspace-symptoms.mjs            # list every hit
 *   node ui-audit/find-backspace-symptoms.mjs --assert   # exit 1 if ANY hit (the fixed build)
 *
 * Every item is labelled uniquely (`A1`, `A2`, …) so a merge is detected by seeing two
 * labels inside one item rather than by eyeballing a tree.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ASSERT = process.argv.includes("--assert");

const P = (t) => ({ type: "paragraph", ...(t ? { content: [{ type: "text", text: t }] } : {}) });
const LI = (t, ...rest) => ({ type: "listItem", content: [P(t), ...rest] });
const TI = (t, ...rest) => ({ type: "taskItem", attrs: { checked: false }, content: [P(t), ...rest] });
const UL = (...i) => ({ type: "bulletList", content: i });
const OL = (...i) => ({ type: "orderedList", content: i });
const TL = (...i) => ({ type: "taskList", content: i });
const QUOTE = (...b) => ({ type: "blockquote", content: b });
const CELL = (...b) => ({ type: "tableCell", content: b });
const ROW = (...c) => ({ type: "tableRow", content: c });
const TABLE = (...r) => ({ type: "table", content: r });
const doc = (...c) => ({ type: "doc", content: c });

/* Every combination of outer list × inner list, with a plain paragraph above and without,
 * plus the shapes an Outlook paste actually produces: an item with two paragraphs, an empty
 * item, a list inside a quote, a list inside a table cell, three levels deep. */
const OUTER = [["bullets", UL, LI], ["numbers", OL, LI], ["checklist", TL, TI]];
const CORPUS = [];
for (const [oname, O, OI] of OUTER) {
  for (const [iname, I, II] of OUTER) {
    CORPUS.push([`${oname} > ${iname}`, doc(P("A0"), O(OI("A1", I(II("A2")))))]);
    CORPUS.push([`${oname} > ${iname}, no paragraph above`, doc(O(OI("A1", I(II("A2")))))]);
    CORPUS.push([`${oname} > ${iname}, two inner items`, doc(P("A0"), O(OI("A1", I(II("A2"), II("A3")))))]);
    CORPUS.push([`${oname} > ${iname}, sibling after`, doc(P("A0"), O(OI("A1", I(II("A2"))), OI("A3")))]);
    CORPUS.push([`${oname} > ${iname}, EMPTY inner item`, doc(P("A0"), O(OI("A1", I(II("")))))]);
    /* B1260000: the owner's iPhone repro — the OUTER item itself is empty and carries a
     * non-empty nested child. Never generated before this line: every other row here gives the
     * outer item its own text ("A1"), so this exact combination was the one cell of the matrix
     * nothing had ever driven. */
    CORPUS.push([`${oname} > ${iname}, EMPTY OUTER item WITH a nested child`, doc(P("A0"), O(OI("", I(II("A2")))), P("A3"))]);
    CORPUS.push([`${oname} > ${iname} > ${iname}, three deep`, doc(P("A0"), O(OI("A1", I(II("A2", I(II("A3")))))))]);
    CORPUS.push([`${oname} > ${iname}, item with TWO paragraphs`, doc(P("A0"), O({ ...OI("A1"), content: [P("A1"), P("A1b"), I(II("A2"))] }))]);
    CORPUS.push([`${oname} then ${iname}, two SIBLING lists`, doc(O(OI("A1")), I(II("A2")), P("A3"))]);
    CORPUS.push([`paragraph between a ${oname} and a ${iname}`, doc(O(OI("A1")), P("A2"), I(II("A3")))]);
    CORPUS.push([`${oname} > ${iname} inside a QUOTE`, doc(P("A0"), QUOTE(O(OI("A1", I(II("A2"))))))]);
    CORPUS.push([`${oname} > ${iname} inside a TABLE CELL`, doc(TABLE(ROW(CELL(O(OI("A1", I(II("A2"))))), CELL(P("A3")))))]);
  }
}

const allNodes = (n, out = []) => { if (n && typeof n === "object") { out.push(n); (n.content || []).forEach((c) => allNodes(c, out)); } return out; };
const itemsOf = (d) => allNodes(d).filter((n) => n.type === "listItem" || n.type === "taskItem");
const textOfNode = (n) => allNodes(n).filter((x) => x.type === "text").map((x) => x.text).join("");
const labelsIn = (s) => (s.match(/A\d+b?/g) || []);
const emptyItems = (d) => itemsOf(d).filter((n) => textOfNode(n).trim() === "").length;
/* B1260000: an item whose OWN first paragraph is already empty, counted WITHOUT looking at its
 * descendants — distinct from `emptyItems`, which counts an item as empty only when its WHOLE
 * recursive text is empty. An item that is empty at heart (its own line has nothing on it) but
 * carries a non-empty nested child is invisible to `emptyItems` — and OUTDENTING that child is
 * SUPPOSED to reveal the parent's already-latent emptiness as its own standalone empty bullet.
 * That reveal is not a new husk; it is the expected result of "NESTED list item OUTDENTS one
 * level" applied to exactly this shape, so it must not itself read as the ORPHAN symptom. */
const shallowEmptyItems = (d) => itemsOf(d).filter((n) => textOfNode(n.content?.[0] || {}).trim() === "").length;
/* B1260000: every label anywhere in the WHOLE document — not just inside list items — so a
 * paragraph outside any list (his "Tell Talbert…" / "A0") that silently vanishes is caught too.
 * Every caret this sweep presses sits at a TEXTBLOCK START, so a single Backspace there can
 * never truncate a label's own text (it only restructures, merges, or selects) — a label that
 * disappears entirely is content loss, never an expected partial edit. */
const allLabels = (d) => new Set(labelsIn(allNodes(d).filter((n) => n.type === "text").map((n) => n.text).join(" ")));

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "find-backspace-symptoms");

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await page.locator('[data-testid="notes-new-page"]').click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.waitForFunction(() => !!window.__noteEditor, null, { timeout: 20000 });

console.log(`Searching ${CORPUS.length} list-shaped documents for the owner's two symptoms\n`);

const hits = [];
let probes = 0;
for (const [name, d] of CORPUS) {
  /* Every textblock's first position, asked of the app rather than derived here — a sweep
     that computes its own positions is a sweep that can be wrong about the document. */
  const starts = await page.evaluate((dd) => {
    window.__noteEditor.setDoc(dd);
    const out = [];
    window.__noteEditor.eachTextblockStart((pos, name) => out.push({ pos, name }));
    return out;
  }, d);
  const before = { items: itemsOf(d).length, empties: emptyItems(d), shallowEmpties: shallowEmptyItems(d), labels: allLabels(d) };
  /* The labels that were an item's OWN first line before the press — the only ones whose
   * co-occurrence afterwards means two ITEMS merged. */
  const ownLabelsBefore = new Set(itemsOf(d).flatMap((n) => labelsIn(n.content?.[0] ? textOfNode(n.content[0]) : "")));
  for (const s of starts) {
    await page.evaluate(([dd, pos]) => { window.__noteEditor.setDoc(dd); window.__noteEditor.caretAt(pos); }, [d, s.pos]);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(35);
    probes += 1;
    const after = await page.evaluate(() => window.__noteEditor.json());

    /* SYMPTOM 1 — a MERGE OF TWO LIST ITEMS: one item's own first line now holds labels that
     * were the OWN first lines of two DIFFERENT items before. This is "bullet onebullet two"
     * as a single item, stated so a machine can see it.
     * ⛔ THE PRECISION MATTERS. A first version flagged any item holding two labels, which
     * also caught a PARAGRAPH joining the last bullet above it — that is the ordinary "you
     * deleted the line break" join everybody expects, and calling it a defect would have
     * sent the fix off after correct behaviour. Only labels that were each an item's own
     * first line BEFORE the press count. */
    const merged = itemsOf(after)
      .map((n) => ({ text: textOfNode(n), own: labelsIn(n.content?.[0] ? textOfNode(n.content[0]) : "") }))
      .filter((x) => new Set(x.own.filter((l) => ownLabelsBefore.has(l))).size > 1);
    /* SYMPTOM 2 — an EMPTY ORPHAN list item that was not there before. Guarded against
     * B1260000's false positive: an item already empty at heart (own paragraph blank, a
     * non-empty child masking it from the recursive count) LEGITIMATELY becomes a standalone
     * recursively-empty item once that child outdents away — that reveal is the correct result
     * of outdenting, not a new husk, so it must not count as more orphans than were already
     * latent. */
    const orphan = emptyItems(after) > Math.max(before.empties, before.shallowEmpties);
    /* SYMPTOM 3 (B1260000) — LOST CONTENT: a label present anywhere in the document before the
     * press is gone from the WHOLE document after it. This is the owner's "the paragraph above
     * got deleted" class, which lives outside any list item and so symptoms 1/2 cannot see it. */
    const lost = [...before.labels].filter((l) => !allLabels(after).has(l));

    if (merged.length || orphan || lost.length) {
      hits.push({ name, caret: s.name, pos: s.pos, merged: merged.map((m) => m.text), orphan, lost });
      console.log(`  ⛔ ${name}  ·  caret at start of "${s.name}"`);
      if (merged.length) console.log(`       MERGE — one item now reads ${merged.map((m) => JSON.stringify(m.text)).join(", ")}`);
      if (orphan) console.log(`       EMPTY ORPHAN list item (${before.empties} → ${emptyItems(after)})`);
      if (lost.length) console.log(`       LOST CONTENT — ${lost.join(", ")} no longer anywhere in the document`);
    }
  }
}

console.log(`\n${hits.length} symptom hit(s) across ${probes} single-Backspace probes.`);
await browser.close();
if (ASSERT && hits.length) process.exit(1);
