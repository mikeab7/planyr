/* Model workspace — the sheet's SELECTION MODEL (NEW-2, 2026-10-29): a list of rectangular ranges
 * plus an active cell, replacing "one rectangle".
 *
 * SHAPE (kept backward-compatible on purpose): `{ r1, r2, c1, c2, extra? }`.
 *  · `r1,c1` is the ACTIVE CELL / anchor of the MOST RECENT range; `r2,c2` is that range's moving end
 *    (so `r1===r2 && c1===c2` is a single cell, exactly what every caller already assumed).
 *  · `extra` (optional) is the list of EARLIER ranges, each normalised `{r1<=r2, c1<=c2}`. Absent / empty
 *    = the ordinary single-rectangle selection every existing caller still gets.
 * Everything that only knows about `selRange.r1..c2` keeps working and acts on the active range; the
 * commands that must hit every range go through `rangesOf`.
 *
 * Excel-for-Windows rules this implements: Ctrl+click / Ctrl+drag ADDS a range and makes it active;
 * Ctrl+click on an already-selected cell REMOVES that cell (splitting its range); Shift extends only the
 * most recent range; a plain click collapses to one range. Pure and DOM-free — unit-tested.
 */

/** A range as a normalised plain rect (r1<=r2, c1<=c2), dropping the anchor direction and `extra`. */
export function normRect(g) {
  return { r1: Math.min(g.r1, g.r2), r2: Math.max(g.r1, g.r2), c1: Math.min(g.c1, g.c2), c2: Math.max(g.c1, g.c2) };
}

/** The most recent (active) range, normalised. */
export function activeRect(sel) { return normRect(sel); }

/** Every range in the selection, normalised, ACTIVE LAST. */
export function rangesOf(sel) {
  const out = [];
  if (sel && Array.isArray(sel.extra)) for (const g of sel.extra) out.push(normRect(g));
  if (sel) out.push(normRect(sel));
  return out;
}

/** True when more than one range is selected (the cases Excel answers with "won't work on multiple selections"). */
export function isMulti(sel) { return !!(sel && Array.isArray(sel.extra) && sel.extra.length > 0); }

const rectHas = (g, r, c) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;

/** Is (r, c) inside ANY selected range? */
export function selContains(sel, r, c) {
  if (!sel) return false;
  if (rectHas(normRect(sel), r, c)) return true;
  if (Array.isArray(sel.extra)) for (const g of sel.extra) if (rectHas(g, r, c)) return true;
  return false;
}

/** Does any selected range touch row `r` (resp. column `c`)? — the row-number gutter / column header tint. */
export function selTouchesRow(sel, r) { return rangesOf(sel).some((g) => r >= g.r1 && r <= g.r2); }
export function selTouchesCol(sel, c) { return rangesOf(sel).some((g) => c >= g.c1 && c <= g.c2); }

/** Build a selection from an active range + the earlier ranges. */
export function makeSelection(active, extra) {
  const sel = { r1: active.r1, r2: active.r2, c1: active.c1, c2: active.c2 };
  if (extra && extra.length) sel.extra = extra.map(normRect);
  return sel;
}

/** Same active range, earlier ranges untouched — what Shift+click / Shift+arrows / a drag in progress do. */
export function withActive(sel, active) {
  return makeSelection(active, sel && sel.extra);
}

/** A plain click: one range only. */
export function collapse(sel) { return sel && sel.extra ? { r1: sel.r1, r2: sel.r2, c1: sel.c1, c2: sel.c2 } : sel; }

/** Ctrl+click / Ctrl+drag: keep every existing range and add `rect` as the new ACTIVE one. */
export function addRange(sel, rect) {
  return makeSelection(rect, rangesOf(sel));
}

/** The pieces of `g` left after removing the single cell (r, c) — up to four rectangles, none overlapping. */
export function subtractCell(g, r, c) {
  if (!rectHas(g, r, c)) return [g];
  const out = [];
  if (r > g.r1) out.push({ r1: g.r1, r2: r - 1, c1: g.c1, c2: g.c2 });
  if (c > g.c1) out.push({ r1: r, r2: r, c1: g.c1, c2: c - 1 });
  if (c < g.c2) out.push({ r1: r, r2: r, c1: c + 1, c2: g.c2 });
  if (r < g.r2) out.push({ r1: r + 1, r2: g.r2, c1: g.c1, c2: g.c2 });
  return out;
}

/** Ctrl+click on an already-selected cell: take that cell out of the selection (Excel 365). The last
 *  remaining piece becomes the active range. Deselecting the ONLY cell is refused (returns `sel`
 *  unchanged — Excel always keeps an active cell). */
export function toggleCellOut(sel, r, c) {
  const kept = [];
  for (const g of rangesOf(sel)) for (const piece of subtractCell(g, r, c)) kept.push(piece);
  if (kept.length === 0) return sel;
  const active = kept[kept.length - 1];
  return makeSelection(active, kept.slice(0, -1));
}

/** Every distinct ROW index touched by any range, ascending, clipped to [0, maxRow] — what a row-level command
 *  (delete rows, copy rows) acts on when the selection is several blocks. */
export function selRowsOf(sel, maxRow) {
  const seen = new Set();
  for (const g of rangesOf(sel)) for (let r = Math.max(0, g.r1); r <= Math.min(maxRow, g.r2); r++) seen.add(r);
  return [...seen].sort((a, b) => a - b);
}

/** Which sides of cell (r, c) lie on the outside edge of a selected range — for painting the selection outline
 *  when several ranges are shown. A cell inside two ranges gets the edges of both. */
export function selEdgesAt(sel, r, c) {
  const e = { top: false, bottom: false, left: false, right: false };
  for (const g of rangesOf(sel)) {
    if (!rectHas(g, r, c)) continue;
    if (r === g.r1) e.top = true;
    if (r === g.r2) e.bottom = true;
    if (c === g.c1) e.left = true;
    if (c === g.c2) e.right = true;
  }
  return e;
}

/** Does the selection span more than one cell (several ranges, or one range bigger than a cell)? */
export function selIsRange(sel) {
  if (!sel) return false;
  if (isMulti(sel)) return true;
  return sel.r1 !== sel.r2 || sel.c1 !== sel.c2;
}

/** Every distinct cell across all ranges, row-major per range, de-duplicated — for "do this to each cell". */
export function cellsOf(sel) {
  const seen = new Set();
  const out = [];
  for (const g of rangesOf(sel)) {
    for (let r = g.r1; r <= g.r2; r++) {
      for (let c = g.c1; c <= g.c2; c++) {
        const key = r * 100003 + c;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ r, c });
      }
    }
  }
  return out;
}

/** Excel's wording for a command that can't act on several ranges at once. */
export const MULTI_SELECTION_MESSAGE = "This action won’t work on multiple selections.";

/** Run a per-range sheet mutator `fn(sheet, r1, r2, c1, c2, ...args)` over EVERY range, threading the sheet
 *  through — so a whole multi-range command is ONE pure sheet → sheet function, i.e. one undo step. */
export function applyToRanges(sheet, ranges, fn, ...args) {
  let s = sheet;
  for (const g of ranges) s = fn(s, g.r1, g.r2, g.c1, g.c2, ...args);
  return s;
}
