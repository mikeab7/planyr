/* Model workspace — the pure spreadsheet data model.
 *
 * A sheet is columns x rows. Every mutator is pure (returns a NEW sheet, never mutates its
 * argument) so the workspace's undo/redo can be a plain snapshot stack (see lib/undoStack.js)
 * and so the model can be unit-tested with no DOM.
 *
 * CELL ADDRESSING lives HERE, not in the view (per the build brief): SheetView talks in
 * (rowIndex, colIndex) pairs and this module resolves them to storage keys via each column's
 * stable `id` — `cellKey(colId, rowIndex)`. Columns can be renamed or reordered without
 * disturbing stored data because the key is the id, never the display name or position. When
 * the formula engine grows real A1-style cell references, that is a change to
 * lib/sheetEngine.js's reference resolution — this addressing layer does not move.
 *
 * FORMULAS ARE PER-COLUMN, not per-cell — this mirrors the Schedule module's existing
 * "Formula column" mechanism exactly (public/sequence/index.html's computeFormulaValues) and
 * reuses its proven planFormulaColumns dependency ordering unchanged. A column's `formula` is
 * either null (an ordinary, independently-typed data column) or one formula text applied to
 * every row, referencing that row's OTHER columns by name in brackets — e.g. [Revenue] -
 * [Cost] — exactly like an Excel Table's calculated column. This is a deliberate, honest
 * reading of "v1 uses the engine's own reference syntax": the engine has no cell references at
 * all, only same-row named-column references, so a true independent per-cell formula (Excel's
 * A1 model) is not something this engine can support without a parser change. See
 * lib/sheetEngine.js's header for the full contract.
 */

export const SHEET_VERSION = 1;
const DEFAULT_COLS = 8;
// A blank sheet starts with real spreadsheet-sized room, not a short list that grows one
// keystroke past its own edge at a time — virtualization means the DOM cost of a bigger
// blank area is ~0 (only the visible slice ever renders), so there is no reason to make it
// feel cramped. Measured live: at 30 rows, scrolling to a row far below the visible data hit
// the padding ceiling and simply had nowhere further to go.
const DEFAULT_ROW_COUNT = 200;

/** Excel-style column letters: A, B, … Z, AA, AB, … — used only as the default NAME for a
 *  freshly-added column. Renaming is free-text; this is just a starting point. */
function colLetterName(index) {
  let n = index + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const makeColumn = (id, name) => ({ id, name, format: null, width: 120, formula: null });

export function createSheet() {
  const columns = Array.from({ length: DEFAULT_COLS }, (_, i) => makeColumn(`c${i + 1}`, colLetterName(i)));
  return {
    version: SHEET_VERSION,
    nextColId: DEFAULT_COLS + 1,
    columns,
    rowCount: DEFAULT_ROW_COUNT,
    cells: {}, // "colId:rowIndex" -> raw typed text (meaningless for a formula column)
  };
}

/** Read a possibly-foreign blob back into a sheet this module understands. Never guesses at a
 *  shape it does not recognize (LOUD-FAILURE belongs to the caller, which can compare the
 *  returned sheet's identity against what it read to decide whether to warn) — an unreadable
 *  or pre-versioning blob returns a fresh, empty sheet rather than a half-understood one. */
export function migrateSheet(raw) {
  if (!raw || typeof raw !== "object") return createSheet();
  if (raw.version === SHEET_VERSION && Array.isArray(raw.columns) && raw.cells && typeof raw.cells === "object") {
    // Defend against a hand-edited/partial blob missing a column field a newer build added.
    const columns = raw.columns.map((c, i) => ({ ...makeColumn(c.id || `c${i + 1}`, c.name || colLetterName(i)), ...c }));
    return { version: SHEET_VERSION, nextColId: raw.nextColId || columns.length + 1, columns, rowCount: raw.rowCount || DEFAULT_ROW_COUNT, cells: { ...raw.cells } };
  }
  return createSheet();
}

export const cellKey = (colId, rowIndex) => `${colId}:${rowIndex}`;

export function colAt(sheet, colIndex) { return sheet.columns[colIndex] || null; }

export function rawAt(sheet, rowIndex, colIndex) {
  const col = colAt(sheet, colIndex);
  if (!col) return "";
  return sheet.cells[cellKey(col.id, rowIndex)] ?? "";
}

export function columnIndexByName(sheet, name) {
  const target = String(name || "").trim().toLowerCase();
  return sheet.columns.findIndex((c) => c.name.trim().toLowerCase() === target);
}

/* ---- mutators — every one returns a NEW sheet ------------------------------------------- */

/** Set one cell's raw text in a PLAIN (non-formula) column. Typing a leading "=" turns the
 *  WHOLE column into a formula column instead (see setColumnFormula) — SheetView routes a
 *  commit that starts with "=" there rather than calling this. Growing past the current
 *  row count (typing into a blank padding row) extends it — the Schedule "type past the end"
 *  pattern, so the visible sheet never needs an explicit "add row" step for the common case. */
export function setRaw(sheet, rowIndex, colIndex, text) {
  const col = colAt(sheet, colIndex);
  if (!col || col.formula) return sheet;
  const key = cellKey(col.id, rowIndex);
  const had = Object.prototype.hasOwnProperty.call(sheet.cells, key);
  const next = text ?? "";
  if (next === "" && !had) return sheet; // no-op: never mints an undo frame for nothing
  if (next === "" && had) { const cells = { ...sheet.cells }; delete cells[key]; return { ...sheet, cells }; }
  if (had && sheet.cells[key] === next) return sheet;
  const cells = { ...sheet.cells, [key]: next };
  const rowCount = Math.max(sheet.rowCount, rowIndex + 1);
  return { ...sheet, cells, rowCount };
}

/** Blank every PLAIN-column cell in a rectangular range (Delete). Formula-column cells are
 *  computed, not data, so they are left untouched rather than silently deleting the column's
 *  formula — the "fx" badge on the header is what tells the owner why a cell in the range
 *  didn't clear. */
export function blankRange(sheet, r1, r2, c1, c2) {
  const rr1 = Math.max(0, Math.min(r1, r2)), rr2 = Math.max(r1, r2);
  const cc1 = Math.max(0, Math.min(c1, c2)), cc2 = Math.min(sheet.columns.length - 1, Math.max(c1, c2));
  let cells = sheet.cells;
  let changed = false;
  for (let c = cc1; c <= cc2; c++) {
    const col = sheet.columns[c];
    if (!col || col.formula) continue;
    for (let r = rr1; r <= rr2; r++) {
      const key = cellKey(col.id, r);
      if (Object.prototype.hasOwnProperty.call(cells, key)) {
        if (!changed) cells = { ...cells };
        delete cells[key];
        changed = true;
      }
    }
  }
  return changed ? { ...sheet, cells } : sheet;
}

export function renameColumn(sheet, colIndex, name) {
  const col = colAt(sheet, colIndex);
  if (!col) return sheet;
  const trimmed = String(name || "").trim() || col.name;
  if (trimmed === col.name) return sheet;
  const columns = sheet.columns.map((c, i) => (i === colIndex ? { ...c, name: trimmed } : c));
  return { ...sheet, columns };
}

/** Apply a number-format string (or null = General) to every column touched by a selection.
 *  A no-op (every touched column already carries this exact format) returns `sheet` unchanged
 *  — re-applying the same preset (e.g. re-committing an unedited formula-bar value on blur)
 *  must never mint an undo frame for nothing. */
export function setNumberFormat(sheet, colIndexes, format) {
  const next = format || null;
  const set = new Set(colIndexes);
  if ([...set].every((i) => (sheet.columns[i]?.format ?? null) === next)) return sheet;
  const columns = sheet.columns.map((c, i) => (set.has(i) ? { ...c, format: next } : c));
  return { ...sheet, columns };
}

/** Turn a column into a FORMULA column (or replace its formula). `text` is the full source
 *  INCLUDING the leading "=" — that is what the formula bar round-trips verbatim. Existing
 *  per-row literal cells for this column are cleared: they are no longer the source of truth. */
export function setColumnFormula(sheet, colIndex, text) {
  const col = colAt(sheet, colIndex);
  if (!col) return sheet;
  const formula = String(text || "").trim();
  if (!formula) return clearColumnFormula(sheet, colIndex);
  if (col.formula === formula) return sheet; // unchanged — the column's cells are already stripped
  const columns = sheet.columns.map((c, i) => (i === colIndex ? { ...c, formula } : c));
  const prefix = `${col.id}:`;
  const cells = {};
  let stripped = false;
  for (const [k, v] of Object.entries(sheet.cells)) { if (k.startsWith(prefix)) stripped = true; else cells[k] = v; }
  return { ...sheet, columns, cells: stripped ? cells : sheet.cells };
}

/** Clear a column's formula, turning it back into an ordinary (now-empty) data column. */
export function clearColumnFormula(sheet, colIndex) {
  const col = colAt(sheet, colIndex);
  if (!col || !col.formula) return sheet;
  const columns = sheet.columns.map((c, i) => (i === colIndex ? { ...c, formula: null } : c));
  return { ...sheet, columns };
}

export function addColumn(sheet) {
  const id = `c${sheet.nextColId}`;
  const columns = [...sheet.columns, makeColumn(id, colLetterName(sheet.columns.length))];
  return { ...sheet, columns, nextColId: sheet.nextColId + 1 };
}

/** Delete a column entirely (and every cell stored under it). There is no undo affordance
 *  beyond the workspace's own Ctrl+Z, which already snapshots the whole sheet. */
/** The one commit path every cell edit goes through (typed in-cell, via F2, or via the
 *  formula bar) — so "typing '=' turns a column into a formula column" and "typing a plain
 *  value into a formula-column cell demotes it back to plain data" are decided in exactly
 *  ONE place, matching Excel's own "type-to-edit replaces the whole cell" contract: there is
 *  no meaning for a per-row literal living inside a per-column formula, so committing one
 *  clears the column's formula first. */
export function commitCellText(sheet, rowIndex, colIndex, text) {
  const t = String(text ?? "");
  if (t.trim().startsWith("=")) return setColumnFormula(sheet, colIndex, t.trim());
  const col = colAt(sheet, colIndex);
  const base = col && col.formula ? clearColumnFormula(sheet, colIndex) : sheet;
  return setRaw(base, rowIndex, colIndex, t);
}

export function deleteColumn(sheet, colIndex) {
  const col = colAt(sheet, colIndex);
  if (!col || sheet.columns.length <= 1) return sheet; // never leave a sheet with zero columns
  const columns = sheet.columns.filter((_, i) => i !== colIndex);
  const prefix = `${col.id}:`;
  const cells = {};
  for (const [k, v] of Object.entries(sheet.cells)) if (!k.startsWith(prefix)) cells[k] = v;
  return { ...sheet, columns, cells };
}

/** How many rows the view should render past the real data, so typing never has to "add a
 *  row" first — the Schedule GridView's emptyPad pattern (public/sequence/index.html:9706),
 *  sized to always fill at least one screen's worth AND leave real spreadsheet-sized room
 *  (200, matching DEFAULT_ROW_COUNT) rather than stopping a few rows past whatever's typed. */
export function padRowCount(sheet, viewportRows) {
  return Math.max(200, (viewportRows || 0) + 10);
}
