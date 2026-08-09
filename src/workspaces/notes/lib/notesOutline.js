/* notesOutline — the headings of one note, as a navigable list (NEW-6).
 *
 * PURE, and it works on the stored DOCUMENT MODEL (ProseMirror JSON) rather than on a live
 * editor. That is what lets the whole of it be unit-tested with no browser: the outline of
 * a note is a property of the note, not of the thing displaying it.
 *
 * ⛔ THE ONE SUBTLE PART IS `pos`, AND IT IS NOT GUESSWORK — it is ProseMirror's own size
 * rule, restated here so the outline can hand the editor a real document position to scroll
 * to and to compare the caret against:
 *     a text node's size is its character count;
 *     a LEAF node's size is 1;
 *     any other node's size is 2 + the sum of its children's sizes (its own open and close).
 * `test/notesOutline.test.js` does not take that on trust: it builds the same document
 * through the real schema and asserts every position this file reports resolves to the very
 * heading node it named. If a future extension adds a leaf, that test goes red — which is
 * the point of `LEAF_NODES` being a stated list rather than an assumption.
 *
 * ⛔ AND THE PANE IS ABSENT, NOT EMPTY, WHEN THERE ARE NO HEADINGS. `outlineFromDoc` returns
 * an empty array and the editor renders nothing at all — no header, no "no headings yet"
 * placeholder. A permanent empty box on every short note is exactly the accumulation
 * PANEL-BREVITY forbids.
 */

/** Every node in the notes schema whose size is 1 because it has no content of its own.
 *  Asserted against the real schema in test/notesOutline.test.js — a new atom that is not
 *  listed here fails that test rather than silently shifting every position after it. */
export const LEAF_NODES = new Set(["hardBreak", "horizontalRule", "noteImage", "noteSketch", "noteAttachment"]);

/** ProseMirror's `nodeSize`, computed from JSON. */
export function nodeSize(node) {
  if (!node || typeof node !== "object") return 0;
  if (node.type === "text") return String(node.text || "").length;
  if (LEAF_NODES.has(node.type)) return 1;
  return 2 + contentSize(node.content);
}

function contentSize(content) {
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const child of content) n += nodeSize(child);
  return n;
}

/** The plain text of a node and everything under it — what an outline row shows. */
export function textOfNode(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return String(node.text || "");
  return (node.content || []).map(textOfNode).join("");
}

/** Every heading in the document, in reading order.
 *
 *  Headings NESTED inside another block (a callout, a toggle, a table cell) are included —
 *  a section that folds away is still a section, and leaving it out of the outline is how
 *  you lose track of the part of the note you cannot currently see. */
export function outlineFromDoc(doc) {
  const out = [];
  const walk = (node, pos) => {
    let at = pos + 1;                       // step past this node's own opening token
    for (const child of node.content || []) {
      if (child?.type === "heading") {
        const text = textOfNode(child).trim();
        out.push({
          id: `h${out.length}`,
          level: Math.min(4, Math.max(1, Number(child.attrs?.level) || 1)),
          // An untitled heading still has to be clickable, or the outline develops holes
          // exactly where someone is mid-thought.
          text: text || "Untitled heading",
          empty: !text,
          pos: at,
          index: out.length,
        });
      }
      if (child && !LEAF_NODES.has(child.type) && child.type !== "text") walk(child, at);
      at += nodeSize(child);
    }
  };
  if (doc && typeof doc === "object") walk(doc, -1);   // the doc node itself starts at -1, so its first child is at 0
  return out;
}

/** Which outline row the caret is in: the LAST heading at or before the caret. Returns -1
 *  when the caret sits above the first heading, which is a real state (the opening
 *  paragraph of a note belongs to no section) and must not be reported as section one. */
export function activeOutlineIndex(entries, caretPos) {
  if (!Array.isArray(entries) || !entries.length) return -1;
  const pos = Number(caretPos);
  if (!Number.isFinite(pos)) return -1;
  let hit = -1;
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].pos <= pos) hit = i;
    else break;
  }
  return hit;
}

/** Which entries have entries nested under them — the ones that can fold. Pure so the
 *  disclosure triangles are decided by the document's shape, never by a hover guess. */
export function outlineHasChildren(entries, index) {
  const me = entries[index];
  const next = entries[index + 1];
  return !!(me && next && next.level > me.level);
}

/** Apply a set of collapsed row ids: a row is hidden when any ANCESTOR of it is collapsed.
 *  Pure, so "collapse Heading 2 and everything under it disappears, including the Heading 4
 *  three rows down" is a testable statement rather than a rendering accident. */
export function visibleOutline(entries, collapsed) {
  const shut = collapsed instanceof Set ? collapsed : new Set(collapsed || []);
  const out = [];
  let hideDeeperThan = null;
  for (const e of entries) {
    if (hideDeeperThan != null && e.level > hideDeeperThan) continue;
    hideDeeperThan = null;
    out.push(e);
    if (shut.has(e.id)) hideDeeperThan = e.level;
  }
  return out;
}
