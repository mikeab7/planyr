/* notesFlowMigration — PURE, one-way: TWO legacy shapes → the boxes-only page.
 *
 * ⛔ WHY THIS EXISTS (NEW-1, then NEW-2, 2026-09-22). *"I don't want anything regular
 * paragraph... I just want the double-click thing."* — and, the same day, *"I don't care for
 * the sketch boxes at all... it'd be better if I just had a free canvas to play with."* The
 * Notes page is now a pure placement surface holding nothing but positioned rich-text boxes
 * (`noteAnchor`) connected by document-level arrows (`doc.attrs.arrows`). Two things an old
 * page can still carry must not be lost: real flow content typed directly into the body
 * (paragraphs, headings, lists, tables, images), and a sketch — its own small canvas of
 * label/body boxes and arrows, now retired as a concept.
 *
 * ⛔ RUN `migrateSketchesToBoxes` FIRST, THEN `migrateFlowBody` — ORDER IS LOAD-BEARING.
 * Converting every `noteSketch` into real `noteAnchor` boxes (+ arrows) first means that by
 * the time `migrateFlowBody` walks the document, those converted boxes are already ordinary
 * anchors — kept in place, never mistaken for flow content to bundle away. Composed once, in
 * `NoteEditor.jsx`'s `initialDoc`: `migrateFlowBody(migrateSketchesToBoxes(raw))`.
 *
 * ⛔ THE FLOW RULE: every top-level child that is not a `noteAnchor`, and is not the one
 * trailing structural paragraph every doc ends with (see notesAnchorNode.js's own header on
 * why that paragraph exists and must stay last), is gathered — IN DOCUMENT ORDER — into ONE
 * new `noteAnchor` anchored at the sheet's top-left content corner (`x:0, y:0`), at the
 * page's normal writing-column width. Existing anchors are left exactly where they are.
 *
 * ⛔ BOTH RUN ON READ, NEVER ON WRITE. `NoteEditor.jsx` calls them once, on the initial
 * document it hands to `useEditor({ content })` — never inside a transaction, never through
 * `onUpdate`. So the migrated shape is what the editor STARTS with, and `hasUserInputRef`
 * (B1662464) still gates every save on a genuine, trusted user action: opening an old page
 * does not rewrite it. The migrated shape is only ever written to storage once the person
 * actually edits something, at which point it saves like any other change.
 *
 * ⛔ `migrateFlowBody` MINTS NO `aid`. `NoteEditor.jsx` already calls `ensureNoteAnchorIds()`
 * once on mount, with `addToHistory: false`, specifically to backfill missing identities —
 * that function leaves `aid: null` on the box it builds and lets that existing mechanism do
 * it. `migrateSketchesToBoxes` CANNOT do the same: its own converted arrows need real ids to
 * reference at migration time, before any later backfill could run, so it mints them itself,
 * deterministically (`mig_<sketch-box-id>` — no randomness, so a test can assert on the
 * exact id), guaranteed not to collide with a `ensureNoteAnchorIds`-minted id (`a<...>`).
 *
 * ⛔ A PAGE WITH NEITHER SHAPE IS A NO-OP, returned as the exact same object reference — this
 * is what makes both migrations cheap to run on every single page open, including the
 * overwhelming majority created after both shipped.
 */
import { layoutSketch, normalizeSketch } from "./notesSketchModel.js";

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

/** Where a converted sketch's boxes start, horizontally — clear of the flow-migration bundle
 *  (`MIGRATED_BOX_WIDTH`), so the two never land on top of each other sight-unseen. Multiple
 *  sketches in one document stack vertically below one another instead of side by side, so
 *  the page grows the direction it already knows how to (down), not sideways off-screen. */
const SKETCH_GROUP_X = MIGRATED_BOX_WIDTH + 40;
const SKETCH_GROUP_GAP = 40;

/** A sketch box's short text, drawn into a real paragraph: the LABEL as the first line, the
 *  BODY (if any) as a plain run after it — no synthetic bold/heading invented on its behalf,
 *  since a sketch box never had real formatting to begin with. */
function sketchBoxParagraph(label, body) {
  const text = [label, body].filter(Boolean).join("\n");
  if (!text) return { type: "paragraph" };
  const lines = text.split("\n");
  const content = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: "hardBreak" });
    if (line) content.push({ type: "text", text: line });
  });
  return { type: "paragraph", content };
}

/** `doc` → every top-level `noteSketch` converted to real `noteAnchor` boxes at the same
 *  RELATIVE layout its own boxes already had, plus `doc.attrs.arrows` entries for its links.
 *  Returns `doc` UNCHANGED (same reference) when there is no sketch to convert. */
export function migrateSketchesToBoxes(doc) {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.content)) return doc;
  const sketches = doc.content.filter((n) => n && n.type === "noteSketch");
  if (!sketches.length) return doc;

  const converted = [];
  const arrows = Array.isArray(doc.attrs?.arrows) ? [...doc.attrs.arrows] : [];
  let groupY = 0;
  for (const sketch of sketches) {
    const model = normalizeSketch(sketch.attrs);
    const layout = layoutSketch(model);
    const idFor = (sketchBoxId) => `mig_${sketchBoxId}`;
    for (const b of model.boxes) {
      converted.push({
        type: "noteAnchor",
        attrs: {
          aid: idFor(b.id),
          x: Math.round(SKETCH_GROUP_X + b.x),
          y: Math.round(groupY + b.y),
          w: 180,   // a sketch box's own short label/body fits the anchor's ordinary default
          h: null,
        },
        content: [sketchBoxParagraph(b.label, b.body)],
      });
    }
    for (const l of model.links) arrows.push({ from: idFor(l.from), to: idFor(l.to) });
    groupY += layout.height + SKETCH_GROUP_GAP;
  }

  const nonSketchContent = doc.content.filter((n) => !n || n.type !== "noteSketch");
  /* ⛔ THE TRAILING FILLER STAYS LAST. `migrateFlowBody` (which composes with this function
   * right after it, in NoteEditor.jsx's `initialDoc`) only recognises the doc's one trailing
   * structural paragraph as filler when it is genuinely the LAST child — otherwise it reads
   * as real content and gets bundled into a box of its own. A naive append would put the
   * converted boxes after it instead. */
  const lastIdx = nonSketchContent.length - 1;
  const hasTrailing = lastIdx >= 0 && isTrailingFiller(nonSketchContent[lastIdx], true);
  const body = hasTrailing ? nonSketchContent.slice(0, lastIdx) : nonSketchContent;
  const tail = hasTrailing ? [nonSketchContent[lastIdx]] : [];
  return { ...doc, attrs: { ...doc.attrs, arrows }, content: [...body, ...converted, ...tail] };
}
