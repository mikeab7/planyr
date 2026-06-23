/* Markup z-order — "Arrange" (B421).
 *
 * Draw order IS z-order: the Document Review overlay paints a sheet's markups in array order
 * (pageMarks.map in DocReview.jsx), so the LAST same-page entry draws on top. These pure helpers
 * move one markup within its same-page siblings — Bluebeam's four Arrange ops — and splice the
 * permuted group back into the global markups array WITHOUT disturbing other sheets' markups
 * (they keep their absolute slots, so an arrange never silently shuffles another sheet's stack).
 *
 * The four modes:
 *   "front"    — Bring to Front  (draw last  among same-page peers → on top)
 *   "forward"  — Bring Forward   (swap with the next peer above)
 *   "backward" — Send Backward   (swap with the previous peer below)
 *   "back"     — Send to Back    (draw first among same-page peers → at the bottom)
 */

export const ARRANGE_MODES = ["front", "forward", "backward", "back"];

// Where the markup `id` sits within its same-page peers, and whether an op is a no-op.
//   { page, count, index, atTop, atBottom } | null (id not found).
// atTop  = already drawn last  (topmost — Bring to Front / Forward are no-ops).
// atBottom = already drawn first (bottom — Send to Back / Backward are no-ops).
// A lone markup on its sheet (count < 2) reads atTop && atBottom, so all four ops disable.
export function arrangeFlags(markups, id) {
  const list = Array.isArray(markups) ? markups : [];
  const m = list.find((x) => x && x.id === id);
  if (!m) return null;
  const peers = list.filter((x) => x && x.page === m.page);
  const index = peers.findIndex((x) => x.id === id);
  return { page: m.page, count: peers.length, index, atTop: index === peers.length - 1, atBottom: index === 0 };
}

// Return a NEW markups array with `id` moved per `mode` within its same-page peers — or the SAME
// array reference when the move is a no-op (id missing, only one peer, already at that end, or an
// unknown mode). Callers lean on the reference equality to skip a history push + state write, so a
// shortcut/menu item at the top or bottom of the stack does nothing (and stays greyed in the menu).
export function reorderWithinPage(markups, id, mode) {
  const f = arrangeFlags(markups, id);
  if (!f || f.count < 2) return markups;
  if ((mode === "front" || mode === "forward") && f.atTop) return markups;
  if ((mode === "back" || mode === "backward") && f.atBottom) return markups;
  const m = markups.find((x) => x.id === id);
  const peers = markups.filter((x) => x.page === f.page);
  const next = peers.slice();
  next.splice(f.index, 1); // pull the selected markup out of its peer order
  if (mode === "front") next.push(m);              // → last (top)
  else if (mode === "back") next.unshift(m);       // → first (bottom)
  else if (mode === "forward") next.splice(f.index + 1, 0, m);   // swap with the peer above
  else if (mode === "backward") next.splice(f.index - 1, 0, m);  // swap with the peer below
  else return markups; // unknown mode → no-op
  // Splice the permuted peer group back in: walk the global array and, at each slot that held a
  // same-page markup, take the next entry from `next`; every other sheet's markup keeps its place.
  let k = 0;
  return markups.map((x) => (x.page === f.page ? next[k++] : x));
}
