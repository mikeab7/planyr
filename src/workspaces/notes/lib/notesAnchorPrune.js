/* notesAnchorPrune — AN ABANDONED DOUBLE-CLICK LEAVES NOTHING BEHIND.
 *
 * ⛔ WHAT THIS EXISTS FOR, and it is one bug wearing two faces. Double-clicking blank space
 * committed a `noteAnchor` to the document THE INSTANT it was pressed, before a single
 * character was typed. Five double-clicks with nothing typed produced five nodes in storage,
 * each with x/y/w and no text, all surviving a reload. An empty block draws nothing you can
 * see — and still occupies its box and still takes the press. So the SECOND double-click at a
 * spot you already tried lands inside an invisible leftover and appears to do nothing at all.
 * **That is the whole of "it works intermittently": it fails exactly where you already tried
 * once and gave up.**
 *
 * ⛔ SO AN EMPTY BLOCK IS PROVISIONAL, AND THE RULE IS ENFORCED AT THE STORAGE SEAM RATHER
 * THAN AT EACH GESTURE. The editor removes one the moment the caret leaves it, which is what
 * you SEE; this is what makes it TRUE. A crash, a closed tab, an autosave that fires in the
 * half-second between the press and the first keystroke, a cloud push — every one of those
 * paths runs through `writePage`, and none of them can carry an empty block out of the
 * session. Gesture-side cleanup alone would have left every one of those doors open.
 *
 * ⛔ AND IT MUST NEVER TAKE ANYTHING WITH CONTENT IN IT. The bar is deliberately conservative:
 * a block is empty ONLY if it holds no text at all AND every node inside it is a plain
 * paragraph. A picture, an attachment, a sketch, a table, a callout, a heading, a list — any
 * of them, and the block is somebody's work and is left alone, whether or not this file has
 * heard of that node type. The test is a whitelist for exactly that reason: a node type added
 * next year is UNKNOWN, and unknown must mean "keep".
 *
 * Pure and dependency-free — it is imported by the store, which is on the Notes route's static
 * path and may never pull the editor engine.
 */

/** The only node type that can appear inside a block and still leave it empty. */
const EMPTY_OK = new Set(["paragraph"]);

const kids = (node) => (Array.isArray(node?.content) ? node.content : []);

/** Does this node — or anything under it — hold something a person put there? */
function holdsContent(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "text") return String(node.text || "").trim().length > 0;
  if (!EMPTY_OK.has(node.type)) return true;      // unknown or non-paragraph ⇒ content
  return kids(node).some(holdsContent);
}

/** ⛔ TRUE ONLY FOR A BLOCK NOBODY HAS PUT ANYTHING IN. See the whitelist note above. */
export function anchorIsEmpty(node) {
  if (!node || node.type !== "noteAnchor") return false;
  return !kids(node).some(holdsContent);
}

/** How many empty blocks a document is carrying. Cheap enough to ask on every read. */
export function countEmptyAnchors(doc) {
  let n = 0;
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (anchorIsEmpty(node)) { n += 1; return; }   // nothing inside one can be another
    for (const k of kids(node)) walk(k);
  };
  walk(doc);
  return n;
}

/**
 * The same document with every empty block removed.
 *
 * ⛔ RETURNS THE INPUT OBJECT ITSELF WHEN THERE IS NOTHING TO REMOVE, which is not a
 * micro-optimisation: this runs inside the save path, and handing back a fresh deep copy of
 * every document on every keystroke's autosave would make identity meaningless for everything
 * downstream that compares documents — the version snapshot, the duplicate scan, the editor's
 * own "did this change?" — and would quietly turn a no-op save into a change.
 *
 * `removed` is the count, so a caller that wants to say something can.
 */
export function pruneEmptyAnchors(doc) {
  if (!doc || typeof doc !== "object") return { doc, removed: 0 };
  let removed = 0;

  const rebuild = (node) => {
    const content = kids(node);
    if (!content.length) return node;
    const next = [];
    let changed = false;
    for (const child of content) {
      if (anchorIsEmpty(child)) { removed += 1; changed = true; continue; }
      const rebuilt = rebuild(child);
      if (rebuilt !== child) changed = true;
      next.push(rebuilt);
    }
    return changed ? { ...node, content: next } : node;
  };

  const out = rebuild(doc);
  return { doc: out, removed };
}
