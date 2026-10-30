/* notesFakeBullets — A NOTE PASTED BEFORE THE OFFICE-LIST FIX HOLDS "BULLETS" THAT ARE JUST TEXT. THIS TURNS THEM INTO REAL
 * LISTS, LOSSLESSLY, ON READ (NEW-1 of the 2026-10-30 follow-up block: "press Enter after a pasted bullet and the new line comes
 * in flush left with no bullet").
 *
 * ⛔ WHY ENTER DID NOTHING. Before notesOfficeLists.js, a Word / OneNote outline pasted as ordinary paragraphs whose text BEGAN
 * with the bullet drawn as a character — `·` / `o` / `§` / a private-use square, then a run of spaces or non-breaking spaces,
 * then the words (measured: the stored paragraph is the text nodes ["o", "       ", "Design and engineering"]). There is no list
 * node, so the list keymap has nothing to continue: Enter splits a PARAGRAPH, and the new line is a plain paragraph. Fixing
 * future pastes does not touch a note the owner already has full of these; this does.
 *
 * WHAT IT DOES. A paragraph is BULLET-SHAPED when its text starts with an Office bullet glyph (or a numbered marker `1.` / `a.` /
 * `iv.`) followed by a WIDE gap — two or more spaces / non-breaking spaces or a tab (four for a bare `o`, which is also a word).
 * Consecutive bullet-shaped paragraphs (empty paragraphs between them ride along inside the item above, so the nesting survives a
 * blank line) become real nested `bulletList` / `orderedList` at the level the glyph says: Word cycles its bullet glyphs by
 * level, so the glyph's class (· • / o ○ / § ▪ / □ ❑) is the level, kept within one step of the line above (a level cannot be
 * skipped). The marker and its gap are removed from the text — Planyr draws the bullet now — and nothing else is touched: same
 * words, same marks, same order, same kind (bullet / numbered) and same level. A numbered run keeps a start number other than 1.
 *
 * ⛔ WHAT IT MUST NEVER DO — touch text the person typed. A typed "• item" or "- item" has ONE space after the glyph, so it is not
 * bullet-shaped; `-` `*` `–` are not in the glyph set at all; text that is not at the START of a paragraph is never read. A
 * paragraph inside a table, a heading, code or any non-paragraph node is skipped. A line that merely begins with a letter and a
 * dot ("a.   note") is only numbered when its gap is wide AND it sits in a run with a bullet-shaped neighbour or alone with the
 * wide gap — the gap is the signal, because Word's marker gap is always wide and a typed one never is.
 *
 * PURE and ONE-WAY, like notesFlowMigration.js: `NoteEditor.jsx` runs it on the initial document, never inside a transaction, so
 * `hasUserInputRef` still gates the first save on a real edit — the converted shape reaches storage the first time the person
 * edits (pressing Enter IS that edit), and a page nobody edits is not rewritten. A document with nothing bullet-shaped is returned
 * as the exact same object (cheap on every open).
 */
import { planOutline } from "./notesOfficeLists.js";

const WS = "[\\s\\u00a0\\u2007\\u202f]";
/* glyph classes, by Word's own level cycle (· o § …) and the common alternates; the INDEX is the level hint */
const CLASSES = [
  ["·", "•", "", "•", "●", "·", "∙", "▪︎"],        // 1
  ["o", "○", "◦", "○", "◦"],                                                    // 2
  ["§", "▪", "■", "", "▪", "■", "‣"],                                // 3
  ["□", "", "❑", "□", "❑", "◻", "", "q"],                      // 4
];
const GLYPH_CLASS = new Map();
CLASSES.forEach((set, i) => set.forEach((g) => { if (!GLYPH_CLASS.has(g)) GLYPH_CLASS.set(g, i); }));
// "q" in Wingdings is the level-4 square, but a bare "q"/"o" is also a letter — both need the widest gap (see below)
const WEAK = new Set(["o", "q"]);

/* a REAL Roman numeral, 1-39 (the range a document outline uses): "iv", "xxxix" yes; "mix", "dim", "civil", "xl" no */
const isRoman = (w) => /^(?:x{0,3})(?:ix|iv|v?i{0,3})$/i.test(w) && w.length > 0;
/* a marker with no glyph needs the WIDE gap Word writes (its tab is six or seven non-breaking spaces); a typed double space is two */
const ORDERED_MIN_GAP = 3;

const markerRe = new RegExp(`^(${WS}*)([^\\s\\u00a0]{1,8}?)(${WS}{2,}|\\t${WS}*)(?=\\S)`);

/** The marker a paragraph's text starts with, or null. `text` is the paragraph's leading text, `gap` the characters consumed
 *  in total (marker + gap + any leading blanks) so the caller can cut exactly that much. */
export function readMarker(text) {
  const m = markerRe.exec(String(text ?? ""));
  if (!m) return null;
  const mark = m[2];
  const gap = m[3].replace(/\t/g, "    ").length;
  if (GLYPH_CLASS.has(mark)) {
    if (WEAK.has(mark) && gap < 4) return null;                        // a bare "o" / "q" needs a really wide gap: it is also a word
    return { kind: "bullet", cls: GLYPH_CLASS.get(mark), start: null, consumed: m[0].length, text: mark };
  }
  /* from here on the marker has no glyph: it is a number or a letter, and typed text looks exactly like that ("Mr.  Jones", "A.  Ryan",
   * "1.  Entitlements"), so it needs the wide gap AND (checked by the caller) a neighbour — a lone one is never converted */
  if (gap < ORDERED_MIN_GAP) return null;
  const num = /^\(?(\d{1,3})[.)]$/.exec(mark);
  if (num) return { kind: "ordered", cls: 0, start: parseInt(num[1], 10), consumed: m[0].length, text: mark };
  const alpha = /^\(?([a-zA-Z]+)[.)]$/.exec(mark);
  if (alpha) {
    const w = alpha[1];
    const roman = isRoman(w);
    if (w.length > 1 && !roman) return null;                          // only ONE letter, or a real Roman numeral: "Mr." "No." "Re." are words
    return { kind: "ordered", cls: roman ? 2 : 1, start: null, consumed: m[0].length, text: mark, letter: w, roman };
  }
  return null;
}

/** The text a paragraph starts with: its leading text nodes joined (stops at the first non-text node). */
function leadingText(p) {
  let s = "";
  for (const n of p.content || []) { if (n.type !== "text") break; s += n.text || ""; if (s.length > 40) break; }
  return s;
}

/** A copy of the paragraph with its first `count` characters removed from the front of its leading text nodes (emptied nodes go). */
function cutLeading(p, count) {
  const content = [];
  let left = count;
  for (const n of p.content || []) {
    if (left > 0 && n.type === "text") {
      const t = n.text || "";
      if (t.length <= left) { left -= t.length; continue; }
      content.push({ ...n, text: t.slice(left) });
      left = 0;
      continue;
    }
    content.push(n);
  }
  const out = { ...p };
  if (content.length) out.content = content; else delete out.content;
  return out;
}

const isEmptyPara = (n) => n?.type === "paragraph" && !(n.content || []).some((c) => (c.type === "text" ? (c.text || "").replace(/[\s ]/g, "") : true));

/** Turn the bullet-shaped runs among `blocks` (one container's children) into lists. Returns the new array, or `blocks` itself. */
function convertSequence(blocks) {
  const marks = blocks.map((b) => (b?.type === "paragraph" ? readMarker(leadingText(b)) : null));
  if (!marks.some(Boolean)) return blocks;
  const out = [];
  let i = 0;
  while (i < blocks.length) {
    if (!marks[i]) { out.push(blocks[i]); i += 1; continue; }
    /* a run: shaped paragraphs, with empty paragraphs allowed BETWEEN two of them (they ride inside the item above) */
    const run = [];
    let j = i;
    while (j < blocks.length) {
      if (marks[j]) { run.push({ at: j, mark: marks[j], blanks: [] }); j += 1; continue; }
      if (isEmptyPara(blocks[j])) {
        let k = j;
        while (k < blocks.length && isEmptyPara(blocks[k]) && !marks[k]) k += 1;
        if (k < blocks.length && marks[k]) { run[run.length - 1].blanks.push(...blocks.slice(j, k)); j = k; continue; }
      }
      break;
    }
    /* ⛔ A LONE NUMBERED / LETTERED PARAGRAPH IS NEVER CONVERTED (NEW-1, 2026-10-30). Without a glyph the marker is only text that looks like
     * one — "A.  Ryan to send", "1.  Entitlements" — and a real Word list is always two or more lines. A run converts when it has two or more
     * shaped paragraphs (a glyph bullet beside a number counts: that is the "next to a glyph neighbour" case) or when its one paragraph is a
     * glyph bullet, which is how a single pasted bullet has always behaved. */
    if (run.length < 2 && run[0].mark.kind !== "bullet") {
      out.push(blocks[run[0].at]);
      i = run[0].at + 1;
      continue;
    }
    /* levels: the glyph's class, never more than one deeper than the line above; a numbered marker follows its own cycle */
    let prev = 0;
    const assigned = new Map();
    let prevRoman = false;
    let prevLetter = null;
    const descs = run.map((r) => {
      let cls = r.mark.cls;
      if (r.mark.kind === "ordered" && r.mark.letter) {
        const l = r.mark.letter.toLowerCase();
        const nextAfterPrev = prevLetter && l.charCodeAt(0) === prevLetter.charCodeAt(0) + 1;
        cls = r.mark.roman && (prevRoman || !nextAfterPrev) ? 2 : 1;
        prevRoman = cls === 2;
        prevLetter = cls === 1 ? l : null;
      }
      /* a glyph class keeps the level it was first given (a run that OPENS on "o" puts every "o" at the same level, not each one
       * deeper than the last); a different class that lands on that level takes it over */
      let level = assigned.get(cls);
      if (level == null || level > prev + 1) {
        level = Math.min(cls + 1, prev + 1);
        for (const [c, l] of assigned) if (l === level && c !== cls) assigned.delete(c);
        assigned.set(cls, level);
      }
      prev = level;
      return { t: "item", id: "fake", level, kind: r.mark.kind, start: r.mark.start, left: level * 0.5 };
    });
    const plan = planOutline(descs);
    const build = (entry) => {
      const node = { type: entry.ordered ? "orderedList" : "bulletList" };
      if (entry.ordered && entry.start) node.attrs = { start: entry.start };
      node.content = entry.items.map((item) => {
        const r = run[item.src];
        const para = cutLeading(blocks[r.at], r.mark.consumed);
        return { type: "listItem", content: [para, ...r.blanks, ...item.kids.map((k) => build(k))] };
      });
      return node;
    };
    for (const entry of plan) out.push(build(entry));
    i = run[run.length - 1].at + 1;
  }
  return out;
}

/** The whole document, containers recursed. Returns the SAME object when nothing is bullet-shaped. */
export function normalizeFakeBullets(doc) {
  let changed = false;
  const walk = (node) => {
    if (!node || !Array.isArray(node.content)) return node;
    if (node.type === "table" || node.type === "tableRow" || node.type === "tableCell" || node.type === "tableHeader") return node;
    let kids = node.content.map(walk);
    const converted = convertSequence(kids);
    if (converted !== kids) { kids = converted; changed = true; }
    const same = kids.length === node.content.length && kids.every((k, idx) => k === node.content[idx]);
    return same ? node : { ...node, content: kids };
  };
  const out = walk(doc);
  return changed ? out : doc;
}
