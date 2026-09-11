/* notesTableWidth — HOW WIDE A TABLE'S COLUMNS ARE, AND WHY WIDENING ONE MUST NOT SHRINK THE
 * OTHERS (NEW-1/NEW-2, owner report 2026-09-11).
 *
 * ⛔ THE MECHANISM, MEASURED RATHER THAN GUESSED. `@tiptap/extension-table` (ProseMirror's own
 * `columnResizing`) writes a resized column's new pixel width onto THAT column alone — it never
 * touches a neighbour's stored `colwidth` (`updateColumnWidth` in `@tiptap/pm/tables` rewrites
 * exactly one column's attrs). So "pairwise compensation" is not something ProseMirror does to
 * the DOCUMENT. The squeeze is a RENDERING artifact: the table's own node view
 * (`createColGroup`/`updateColumns`) only sets an explicit `table.style.width` when EVERY column
 * already carries an explicit `colwidth` — the moment even one column is still unset, it falls
 * back to `min-width` only and clears `width`, and a `<table>` with `width` unset behaves like any
 * other block box: it fills its container. Under `table-layout: fixed`, a column that has never
 * been given an explicit width still only gets whatever is LEFT of the container's width after
 * the explicit columns are subtracted — so once a couple of columns are dragged wide, the
 * untouched ones are squeezed toward their bare minimum, which Tiptap's own default (`cellMinWidth:
 * 25`) sets low enough to read as one character per line.
 *
 * ⛔ THE FIX: EVERY COLUMN OF A TABLE THAT HAS BEEN TOUCHED CARRIES AN EXPLICIT WIDTH, ALWAYS.
 * Once a table has at least one resized column, this module fills in a sensible default for any
 * column still unset and raises anything below the floor — so the node view's own
 * `fixedWidth`/`table.style.width = totalWidth+"px"` branch is ALWAYS the one that fires for a
 * touched table, and the table's rendered width becomes the deterministic SUM of its own columns
 * rather than something the browser has to reconcile against the container. A table nobody has
 * ever resized is left alone — its columns still divide the available width evenly, which is the
 * existing, un-reported-as-broken behaviour for a freshly inserted table.
 *
 * Pure and engine-free on purpose, mirroring `notesBoxResize.js`: `notesPrint.js` needs the same
 * arithmetic (a table's total width, for the print sheet's own page-growth math) without pulling
 * `@tiptap/*` onto its import graph.
 */

/** ⛔ THE FLOOR — "wide enough to hold a short word on one line" (the owner's own words: his
 *  "Permit" and "Number" columns were squeezed to one character per line). 100px is roughly
 *  twelve characters at this module's body size once the cell's own padding (9px each side) is
 *  subtracted — comfortably more than a short header word needs, without being so generous that
 *  a five-column table of short labels is forced needlessly wide. Replaces `@tiptap/extension-
 *  table`'s own default of 25px, which is what let a column collapse to a sliver in the first
 *  place, both during a manual drag (the resize plugin's own `cellMinWidth` floor) and as the
 *  fallback for a column nobody has ever touched. */
export const TABLE_COL_MIN_WIDTH = 100;

/** The width an UNSET column is given the moment its table is normalized (NOT the moment the
 *  table is created — an untouched table keeps dividing the available width evenly). Chosen to
 *  read as a normal column rather than a cramped one, matching this module's sibling
 *  `ANCHOR_WIDTH` in `notesBoxResize.js` for the same "a default that doesn't look like a
 *  different kind of thing" reasoning. */
export const TABLE_DEFAULT_COL_WIDTH = 160;

const num = (v, fallback = null) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** ⛔ A TABLE IS "TOUCHED" THE MOMENT ANY ONE OF ITS COLUMNS HAS AN EXPLICIT WIDTH. Only then
 *  does this module do anything — a table nobody has resized keeps its existing, unreported-as-
 *  broken "divide the available width evenly" behaviour untouched. */
export function isTableTouched(widths) {
  return Array.isArray(widths) && widths.some((w) => Number.isFinite(num(w)));
}

/** Given one table's per-column widths (`number|null`, one entry per column — `null` = never
 *  explicitly resized), returns a NEW array with every unset column defaulted and every column
 *  below the floor raised to it, or `null` when the table is untouched OR already needs no
 *  change (the same idempotence shape `deriveBlockSizes` in `notesExtensions.js` uses, so this
 *  is safe to run on every transaction without looping).
 *
 *  ⛔ A FLAT DEFAULT, DELIBERATELY, NOT "WHATEVER THE COLUMN CURRENTLY RENDERS AT" — see
 *  `notesTableColumns.js`'s own header for why. The other columns get a normal, readable width
 *  rather than being squeezed toward a sliver; they are not guaranteed to land on the EXACT pixel
 *  they happened to render at a moment before. Trying to preserve that exact pixel means reading
 *  live DOM either from inside an `appendTransaction` (no reliable rendered width to read there —
 *  it runs before the view re-renders) or from a SEPARATE, `addToHistory:false` follow-up
 *  transaction — and the latter was tried and reverted: it left the OTHER columns explicit while
 *  the dragged one alone reverted on Ctrl+Z, so the "touched, one column null" table it left
 *  behind triggered the SAME repair again and silently refilled the very column the owner had
 *  just undone. A flat default costs a modest, honest width jump on first touch; the DOM-measured
 *  version cost a broken undo. */
export function normalizedColumnWidths(widths) {
  if (!isTableTouched(widths)) return null;
  let changed = false;
  const next = widths.map((w) => {
    const n = num(w);
    if (n == null) { changed = true; return TABLE_DEFAULT_COL_WIDTH; }
    if (n < TABLE_COL_MIN_WIDTH) { changed = true; return TABLE_COL_MIN_WIDTH; }
    return Math.round(n);
  });
  return changed ? next : null;
}

/** A table's own total rendered width — the sum of its columns, defaulting an unset column to
 *  `TABLE_DEFAULT_COL_WIDTH` (the same number `normalizedColumnWidths` would stamp it with) so a
 *  caller that only needs "how wide is this table" never has to normalize first. Used by the
 *  print sheet's page-growth math and by the live editor's own sheet-growth measurement. */
export function tableTotalWidth(widths) {
  if (!Array.isArray(widths) || !widths.length) return 0;
  return widths.reduce((sum, w) => {
    const n = num(w);
    return sum + (n == null ? TABLE_DEFAULT_COL_WIDTH : Math.max(n, TABLE_COL_MIN_WIDTH));
  }, 0);
}
