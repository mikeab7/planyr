/* Model workspace — copy / paste / fill-down (build-brief follow-up items 6 and 7, live
 * production findings: "copy/paste do nothing", "Ctrl+D does nothing").
 *
 * Both are the SAME underlying operation — stamp one range's raw cell text onto another
 * location — and both need the SAME relative-reference behavior a spreadsheet user expects:
 * copying `=A1+1` from B2 to B3 should read `=A2+1` at the new address, not literally repeat
 * `=A1+1` in every destination cell. The formula engine's own `rewriteFormulaForCopy` (added
 * alongside A1 references, commit 0d2d1b3e) is exactly this transform — token-level, leaves
 * `[Column]` structured refs completely untouched (they're same-row by meaning and never need
 * shifting), and turns a reference that would land off the sheet into the literal text
 * "#REF!" (which the engine then surfaces as a real #REF! error on the next evaluation,
 * exactly like Excel). This module is a thin, pure coordinating layer over that primitive plus
 * sheetModel's own cell addressing — it does not reimplement any reference math itself.
 *
 * An INTERNAL clipboard (not the OS one): Ctrl+C copies the selected range's raw text into a
 * small in-memory structure the workspace holds; Ctrl+V pastes it at the new active cell,
 * shifting every formula's relative references by the same delta. This reliably fixes the
 * reported defect (copy inside the sheet, paste inside the sheet) without the added surface of
 * async Clipboard-API permissions, which behave inconsistently across a real browser and a
 * headless test run — a scope call worth stating plainly rather than silently narrowing.
 */
import { rewriteFormulaForCopy, parseRefText } from "../../../shared/formula/formula.js";
import { cellAddressText } from "./sheetEngine.js";
import { ensureColumnCount, isFormulaText, rawAt, setRaw } from "./sheetModel.js";

/** Snapshot a rectangular range's raw cell text, anchored at its own top-left corner — the
 *  shape both copy-then-paste and fill-down share. `rows` is an array of arrays of raw text,
 *  row-major, top-left first. */
export function copyRange(sheet, r1, r2, c1, c2) {
  const rr1 = Math.min(r1, r2), rr2 = Math.max(r1, r2);
  const cc1 = Math.min(c1, c2), cc2 = Math.max(c1, c2);
  const rows = [];
  for (let r = rr1; r <= rr2; r++) {
    const row = [];
    for (let c = cc1; c <= cc2; c++) row.push(rawAt(sheet, r, c));
    rows.push(row);
  }
  return { rows, height: rr2 - rr1 + 1, width: cc2 - cc1 + 1, anchorRow: rr1, anchorCol: cc1 };
}

/** One raw cell's text, relocated from (fromR, fromC) to (toR, toC) — a formula's relative A1
 *  references shift by the delta; everything else (a literal value, a [Column] structured
 *  ref) is copied verbatim, because rewriteFormulaForCopy only ever touches A1-shaped tokens. */
function relocateText(text, fromR, fromC, toR, toC) {
  if (!isFormulaText(text)) return text;
  if (fromR === toR && fromC === toC) return text;
  const src = cellAddressText(fromR, fromC), dst = cellAddressText(toR, toC);
  // rewriteFormulaForCopy expects the source text WITHOUT special-casing the leading "=" —
  // it tokenizes whatever it's given and leaves anything it doesn't recognize alone, so the
  // "=" rides through untouched exactly like any other non-reference character.
  return rewriteFormulaForCopy(text, src, dst);
}

/** Paste a previously-copied range at a new anchor cell. Tiles the clipboard if the current
 *  SELECTION is a whole multiple of its size (Excel's own paste-tiling rule — select a 4-row
 *  block and paste a 2-row copy, it repeats twice); otherwise pastes once at `targetR/targetC`.
 *  Extends the sheet's column count when the paste would land past the last column (item 9 —
 *  paste must not silently clip); rows already grow via setRaw's own "type past the end". */
export function pasteRange(sheet, targetR, targetC, clip, selR2 = targetR, selC2 = targetC) {
  if (!clip || !clip.rows.length) return sheet;
  const selH = Math.max(1, selR2 - targetR + 1), selW = Math.max(1, selC2 - targetC + 1);
  const tileRows = selH >= clip.height && selH % clip.height === 0 ? selH / clip.height : 1;
  const tileCols = selW >= clip.width && selW % clip.width === 0 ? selW / clip.width : 1;
  const destRows = clip.height * tileRows, destCols = clip.width * tileCols;

  let s = ensureColumnCount(sheet, targetC + destCols);
  for (let dr = 0; dr < destRows; dr++) {
    const r = targetR + dr;
    const srcRow = clip.rows[dr % clip.height];
    for (let dc = 0; dc < destCols; dc++) {
      const c = targetC + dc;
      const text = srcRow[dc % clip.width];
      const relocated = relocateText(text, clip.anchorRow + (dr % clip.height), clip.anchorCol + (dc % clip.width), r, c);
      s = setRaw(s, r, c, relocated);
    }
  }
  return s;
}

/** Ctrl+D: fill the selection's TOP row down through every row beneath it in the same
 *  selection, shifting relative references per row exactly like dragging Excel's fill handle. */
export function fillDown(sheet, r1, r2, c1, c2) {
  const rr1 = Math.min(r1, r2), rr2 = Math.max(r1, r2);
  const cc1 = Math.min(c1, c2), cc2 = Math.max(c1, c2);
  if (rr2 <= rr1) return sheet;
  let s = sheet;
  for (let c = cc1; c <= cc2; c++) {
    const sourceText = rawAt(s, rr1, c);
    for (let r = rr1 + 1; r <= rr2; r++) {
      const relocated = relocateText(sourceText, rr1, c, r, c);
      s = setRaw(s, r, c, relocated);
    }
  }
  return s;
}

/** Excel's "block jump": from (r, c), Ctrl+Arrow moves to the edge of the current run of
 *  occupied cells in `dir`, or to the far sheet edge / next occupied cell if the start cell is
 *  itself blank — the exact four-case rule Excel uses. Pure over a `hasContent(r, c) -> bool`
 *  predicate so it needs no live sheet access beyond that one question. */
export function ctrlArrowTarget(hasContent, rowCount, colCount, r, c, dr, dc) {
  const inBounds = (rr, cc) => rr >= 0 && rr < rowCount && cc >= 0 && cc < colCount;
  const edge = () => ({ r: dr > 0 ? rowCount - 1 : dr < 0 ? 0 : r, c: dc > 0 ? colCount - 1 : dc < 0 ? 0 : c });
  if (!inBounds(r + dr, c + dc)) return { r, c };
  const nr0 = r + dr, nc0 = c + dc;
  const startOccupied = hasContent(r, c);
  const neighborOccupied = inBounds(nr0, nc0) && hasContent(nr0, nc0);
  if (!startOccupied || !neighborOccupied) {
    // Blank start, OR an occupied start whose immediate neighbour is blank: both advance to
    // the first occupied cell in this direction (Excel treats them the same way), or the
    // sheet edge if there is none.
    let nr = nr0, nc = nc0;
    while (inBounds(nr, nc) && !hasContent(nr, nc)) { nr += dr; nc += dc; }
    return inBounds(nr, nc) ? { r: nr, c: nc } : edge();
  }
  // Occupied start, occupied neighbour: walk the contiguous run, stop at its LAST occupied
  // cell — or the sheet edge if the whole rest of the run is occupied.
  let nr = nr0, nc = nc0;
  while (inBounds(nr + dr, nc + dc) && hasContent(nr + dr, nc + dc)) { nr += dr; nc += dc; }
  return { r: nr, c: nc };
}

// ── Stage 1 — the Name Box (type "C50", jump there / Ctrl+G) ───────────────────────────────

/** Parse a typed Name Box address ("C50", "$C$50", lowercase "c50") into a (rowIndex, colIndex)
 *  pair, or `null` if it isn't a valid address OR falls outside the sheet's CURRENT bounds —
 *  the Name Box only ever jumps within the sheet as it exists today, never past it (unlike a
 *  formula reference, which can legally name a cell that doesn't exist yet). Reuses the formula
 *  engine's own address grammar (parseRefText) rather than a second, possibly-disagreeing regex. */
export function parseNameBoxAddress(text, rowCount, colCount) {
  const info = parseRefText(String(text || "").trim());
  if (!info) return null;
  const r = info.row - 1, c = info.col - 1; // parseRefText is 1-based
  if (r < 0 || r >= rowCount || c < 0 || c >= colCount) return null;
  return { r, c };
}

// ── Stage 1 — Find and Replace (Ctrl+F / Ctrl+H) ────────────────────────────────────────────

/** Every cell whose RAW text (never the displayed/formatted value — same convention the
 *  formula bar uses) contains `needle`, case-insensitive, in row-major order. `[]` for an empty
 *  needle rather than "everything" (an empty Find box matching every cell is not a useful
 *  answer and isn't how Excel's own Find behaves either). */
export function findMatches(sheet, needle) {
  const n = String(needle || "").toLowerCase();
  if (!n) return [];
  const matches = [];
  for (let r = 0; r < sheet.rowCount; r++) {
    for (let c = 0; c < sheet.columns.length; c++) {
      const text = rawAt(sheet, r, c);
      if (text && String(text).toLowerCase().includes(n)) matches.push({ r, c });
    }
  }
  return matches;
}

// Case-insensitive substring replace, every occurrence — plain indexOf/slice rather than a
// RegExp, so `find` never needs regex-metacharacter escaping (a literal "." or "(" in a typed
// Find box must match itself, not be read as a pattern). Exported (as `replaceInCellText`) so
// the "Replace" (singular — one match cell at a time) UI action can reuse the exact same
// substring logic `replaceAll` uses internally, rather than a second, possibly-diverging copy.
export function replaceInCellText(text, find, replace) {
  const lower = text.toLowerCase(), needle = find.toLowerCase();
  let out = "", i = 0;
  for (;;) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) { out += text.slice(i); break; }
    out += text.slice(i, idx) + replace;
    i = idx + needle.length;
  }
  return out;
}

/** Replace every occurrence of `find` with `replace` across every cell's raw text, in ONE pure
 *  pass — a single undo frame for the whole operation, never one per cell touched. A no-op
 *  (nothing matched) returns `sheet` unchanged. */
export function replaceAll(sheet, find, replace) {
  const needle = String(find || "");
  if (!needle) return sheet;
  let s = sheet;
  let changed = false;
  for (let r = 0; r < sheet.rowCount; r++) {
    for (let c = 0; c < sheet.columns.length; c++) {
      const text = rawAt(s, r, c);
      if (!text || !String(text).toLowerCase().includes(needle.toLowerCase())) continue;
      const next = replaceInCellText(String(text), needle, replace);
      if (next !== text) { s = setRaw(s, r, c, next); changed = true; }
    }
  }
  return changed ? s : sheet;
}
