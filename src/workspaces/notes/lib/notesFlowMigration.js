/* notesFlowMigration — PURE, one-way: a page's stored FLOW body → ONE rich-text box.
 *
 * ⛔ WHY THIS EXISTS (NEW-1, owner direction 2026-09-22, superseding B1393's whole lineage).
 * *"I don't want anything regular paragraph because I feel like that's what's fucking us up
 * here. I just want the double-click thing."* The Notes page is no longer a flow document
 * with boxes floating over it — it is a placement surface holding nothing but positioned
 * boxes (`noteAnchor`) and sketches (`noteSketch`). A page saved before this shipped still
 * has real flow content (paragraphs, headings, lists, tables, images typed directly into the
 * body) sitting at the TOP LEVEL of its document, and that content must not be lost.
 *
 * ⛔ THE RULE: every top-level child that is not a `noteAnchor` or a `noteSketch`, and is not
 * the one trailing structural paragraph every doc ends with (see notesAnchorNode.js's own
 * header on why that paragraph exists and must stay last), is gathered — IN DOCUMENT ORDER —
 * into ONE new `noteAnchor` anchored at the sheet's top-left content corner (`x:0, y:0`), at
 * the page's normal writing-column width. Existing anchors and sketches are left exactly
 * where they are, at the positions they already have. Nothing else changes.
 *
 * ⛔ THIS RUNS ON READ, NEVER ON WRITE. `NoteEditor.jsx` calls this once, on the initial
 * document it hands to `useEditor({ content })` — never inside a transaction, never through
 * `onUpdate`. So the migrated shape is what the editor STARTS with, and `hasUserInputRef`
 * (B1662464) still gates every save on a genuine, trusted user action: opening an old page
 * does not rewrite it. The migrated shape is only ever written to storage once the person
 * actually edits something, at which point it saves like any other change.
 *
 * ⛔ NOTHING MINTS AN `aid` HERE. `NoteEditor.jsx` already calls `ensureNoteAnchorIds()` once
 * on mount, with `addToHistory: false`, specifically to backfill missing identities — this
 * file leaves `aid: null` on the box it builds and lets that existing mechanism do it, rather
 * than growing a second id minter in a file that has to stay engine-free.
 *
 * ⛔ A PAGE ALREADY MADE ENTIRELY OF BOXES (AND SKETCHES) IS A NO-OP, returned as the exact
 * same object reference — this is what makes the migration cheap to run on every single page
 * open, including the overwhelming majority that were already created after this shipped.
 */

/** The migrated box's width — the page's ordinary writing column (NoteEditor.jsx's own
 *  `SHEET_MAX_WIDTH`, less the anchor's own edge padding on both sides), not the small
 *  180px default a text box starts at. A whole document's worth of headings, lists and
 *  tables needs the column it was written in, not a sticky-note's width. */
export const MIGRATED_BOX_WIDTH = 560;

/** True for the one paragraph every doc structurally ends with — no marks, no content,
 *  nothing to lose by hiding it. Anything else (a paragraph with real text, an empty
 *  paragraph that is NOT last) is real authored structure and travels into the box. */
function isTrailingFiller(node, isLast) {
  return isLast && node && node.type === "paragraph"
    && (!Array.isArray(node.content) || node.content.length === 0)
    && (!node.attrs || Object.keys(node.attrs).every((k) => node.attrs[k] == null));
}

/** `doc` → a doc whose top-level content is ONLY `noteAnchor`/`noteSketch` nodes plus the
 *  one trailing filler paragraph. Returns `doc` UNCHANGED (same reference) when there is
 *  nothing to migrate. */
export function migrateFlowBody(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.content)) return doc;
  const content = doc.content;

  const keep = [];     // existing noteAnchor / noteSketch children, untouched, in order
  const flow = [];      // real flow content — what gets bundled into the new box
  let trailing = null;

  content.forEach((node, i) => {
    if (!node) return;
    if (node.type === "noteAnchor" || node.type === "noteSketch") { keep.push(node); return; }
    if (isTrailingFiller(node, i === content.length - 1)) { trailing = node; return; }
    flow.push(node);
  });

  if (!flow.length) return doc;   // already boxes-only (or genuinely empty) — nothing to do

  const box = {
    type: "noteAnchor",
    attrs: { aid: null, x: 0, y: 0, w: MIGRATED_BOX_WIDTH, h: null },
    content: flow,
  };
  return { ...doc, content: [box, ...keep, trailing || { type: "paragraph" }] };
}
