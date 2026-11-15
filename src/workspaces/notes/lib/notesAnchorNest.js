/* notesAnchorNest — A BOX IS NEVER INSIDE ANOTHER BOX (NEW-1, B2671237, owner report 2026-11-12: "pasting a line
 * into a box makes it overlap the box below").
 *
 * ⛔ MEASURED, NOT INFERRED. A real Ctrl+C of text inside a box puts this on the clipboard:
 *     <p data-pm-slice="1 1 [&quot;noteAnchor&quot;,{&quot;aid&quot;:&quot;a&quot;,&quot;x&quot;:40,&quot;y&quot;:100,…}]">Understand the tax rate…</p>
 * — the slice remembers it came from INSIDE a noteAnchor. Pasting that at the start of ANOTHER box's text makes
 * ProseMirror fit the slice by re-creating the wrapper, so the receiving box ended up holding a BOX:
 *     noteAnchor b › noteAnchor { x: 40, y: 100 } › paragraph "Understand the tax rate cap an…We did get a…"
 * A box is an absolutely positioned thing, so the inner one is drawn at ITS OWN x/y measured from the OUTER box's corner:
 * 57 px to the right of the box it was pasted into ("the text starts indented") and 100 px below it, i.e. on top of
 * the neighbours underneath ("draws straight on top of"). Nothing in the schema forbade it (`noteAnchor` is a `block`
 * and a box's content is `block+`), and nothing noticed, because every layout rule here assumes boxes are top-level.
 *
 * THE RULE, once: a `noteAnchor` is only ever a direct child of the document. Anywhere else it is replaced by its own
 * children — the words stay, the stray frame goes.
 *
 * TWO DOORS, ONE RULE:
 *   · `unnestTr(state)`        — a LIVE edit (paste, drop, undo, anything). Run as an `appendTransaction`, so the repair
 *                                 rides the SAME undo step as the edit that caused it: one Ctrl+Z puts everything back.
 *                                 It UNWRAPS in place (a `ReplaceAroundStep`) rather than deleting and re-inserting, so a
 *                                 caret inside the pasted text keeps its place.
 *   · `unnestDoc(json)`        — a page ALREADY STORED with a nested box (the owner's own page may hold one). Pure JSON,
 *                                 run on read like `normalizeFakeBullets`, never inside a transaction, so `hasUserInputRef`
 *                                 still gates the first save on a real edit.
 * PURE where it can be: no DOM, no editor, no React. */
import { Slice } from "@tiptap/pm/model";
import { ReplaceAroundStep } from "@tiptap/pm/transform";

const ANCHOR = "noteAnchor";

/** JSON door. Returns the SAME object when nothing is nested (callers compare by identity to know nothing changed). */
export function unnestDoc(doc) {
  if (!doc || !Array.isArray(doc.content)) return doc;
  let changed = false;
  const flatten = (children, insideBox) => {
    const out = [];
    for (const c of children || []) {
      if (c && c.type === ANCHOR && insideBox) {
        changed = true;
        out.push(...flatten(c.content, true));
        continue;
      }
      if (c && Array.isArray(c.content)) {
        const inner = flatten(c.content, insideBox || c.type === ANCHOR);
        out.push(inner.length === c.content.length && inner.every((n, i) => n === c.content[i]) ? c : { ...c, content: inner });
      } else out.push(c);
    }
    return out;
  };
  const content = flatten(doc.content, false);
  return changed ? { ...doc, content } : doc;
}

/** The first box in `doc` whose parent is not the document, or null. */
function firstNested(doc) {
  let hit = null;
  doc.descendants((node, pos, parent) => {
    if (hit) return false;
    if (node.type.name === ANCHOR && parent && parent.type.name !== "doc") { hit = { pos, size: node.nodeSize }; return false; }
    return true;
  });
  return hit;
}

/** ProseMirror door: a transaction that unwraps every nested box, or null when there is none. */
export function unnestTr(state) {
  if (!firstNested(state.doc)) return null;
  const tr = state.tr;
  for (let guard = 0; guard < 200; guard++) {
    const hit = firstNested(tr.doc);
    if (!hit) break;
    /* Unwrap: keep the box's inner content [pos+1, pos+size-1] and drop only its two boundary tokens. */
    tr.step(new ReplaceAroundStep(hit.pos, hit.pos + hit.size, hit.pos + 1, hit.pos + hit.size - 1, Slice.empty, 0, true));
  }
  tr.setStoredMarks(state.storedMarks);
  return tr;
}
