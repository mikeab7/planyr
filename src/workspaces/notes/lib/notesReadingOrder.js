/* notesReadingOrder — PURE, zero dependencies (no @tiptap/*, no DOM): a document's TOP-LEVEL
 * boxes/sketches, in the order a person would read the page — top to bottom, then left to
 * right, by each one's own top-left corner.
 *
 * ⛔ WHY THIS EXISTS (NEW-1). A box's position in the stored document array is its CREATION
 * order, not its reading order — the second box someone drew might sit above the first. The
 * on-screen page never had to care (every box is drawn at its own absolute `x`/`y`), but
 * Markdown has no such thing as a position and must pick SOME order to write the boxes down
 * in, and the printed sheet's underlying HTML source order should match what a person
 * scanning the page top-to-bottom actually sees, even though the boxes still paint at their
 * own CSS position on paper too (PDF-PARITY — this reorders the SOURCE, never the geometry).
 *
 * ⛔ ONLY THE TOP LEVEL IS TOUCHED. Nothing nested inside a box (a list, a table, a heading)
 * is reordered — those already have a real reading order, the one the person typed them in.
 *
 * ⛔ A SINGLE-BOX DOCUMENT IS A NO-OP, BYTE FOR BYTE. This is what keeps a migrated
 * flow-body page's Markdown export identical to its pre-migration export: `notesFlowMigration.js`
 * bundles a page's whole flow body into ONE box, and sorting a one-item array changes nothing.
 */

/** Stable sort by (y, then x) of a node's own position attrs. Anything without a readable
 *  position (should not happen for a `noteAnchor`/`noteSketch`, but a defensively-read stored
 *  document is never trusted) sorts as if it were `Infinity` — after everything placed,
 *  never silently dropped. */
export function sortTopLevelForReading(content) {
  if (!Array.isArray(content)) return content;
  const positioned = [];
  const other = [];
  content.forEach((node, i) => {
    const x = Number(node?.attrs?.x);
    const y = Number(node?.attrs?.y);
    if (node && (node.type === "noteAnchor" || node.type === "noteSketch") && Number.isFinite(x) && Number.isFinite(y)) {
      positioned.push({ node, x, y, i });
    } else {
      other.push(node);
    }
  });
  if (positioned.length < 2) return content;   // nothing to reorder — keep the same shape
  positioned.sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.i - b.i));
  return [...positioned.map((p) => p.node), ...other];
}
