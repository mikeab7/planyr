/* Model workspace — the pure spreadsheet data model.
 *
 * A sheet is columns x rows. Every mutator is pure (returns a NEW sheet, never mutates its
 * argument) so the workspace's undo/redo can be a plain snapshot stack (see lib/undoStack.js)
 * and so the model can be unit-tested with no DOM.
 *
 * CELL ADDRESSING lives HERE, not in the view: SheetView talks in (rowIndex, colIndex) pairs
 * and this module resolves them to storage keys via each column's stable `id` —
 * `cellKey(colId, rowIndex)`. Columns can be renamed or reordered without disturbing stored
 * data because the key is the id, never the display name or position.
 *
 * ⛔ B891184-FOLLOWUP (live production finding, 2026-08-31, owner-driven real-Excel-user
 * testing): FORMULAS ARE PER CELL, NOT PER COLUMN. The first shipped version made every
 * formula apply to the WHOLE column, evaluated identically for every row — because the shared
 * formula engine (src/shared/formula/formula.js) had, at the time, no cell addressing at all,
 * only same-row [Column] references, and a per-row calculated column (an Excel Table column)
 * was the closest honest fit. That reasoning is now stale: a CONCURRENT session shipped real
 * A1-style cell references to the SAME engine (commit 0d2d1b3e, "Formula engine: add A1 cell
 * references", merged the same day) — exactly what a pro-forma needs, and exactly what makes
 * per-cell formulas possible without forking the engine. Measured live: typing "=SUM(A1:A2)"
 * into ONE cell converted the ENTIRE column into that one formula, repeated for every row, and
 * the two numbers already in A1/A2 vanished from view. That is not a spreadsheet.
 *
 * So `cells[key]` now stores raw text UNIFORMLY — a literal value OR a formula (leading "="),
 * exactly the way a real cell holds one or the other. There is no column-level formula field
 * any more. `lib/sheetEngine.js` decides, per cell, whether its raw text is a formula and
 * evaluates a dependency graph across CELLS (not columns) to get the order right.
 *
 * ⛔ AND THE SAME LESSON APPLIES TO NUMBER FORMAT, FOUND BUILDING THIS SESSION'S OWN
 * verification pro-forma: a column-level `format` field meant formatting ONE cell (a "Yield on
 * cost" row) as a percent silently reformatted every OTHER value already sitting above it in
 * that column — Land cost rendered as "250000000.00%". A real underwriting sheet routinely
 * mixes a dollar amount, a percentage and a $/SF rate in the SAME column, one row apart —
 * exactly the shape a per-column format cannot express. `formats[key]` (same cellKey shape as
 * `cells`) is now a per-CELL override; there is no column-level default to fall back to,
 * mirroring the formula decision above rather than inventing a third, different rule.
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

const makeColumn = (id, name) => ({ id, name, width: 120 });

export function createSheet() {
  const columns = Array.from({ length: DEFAULT_COLS }, (_, i) => makeColumn(`c${i + 1}`, colLetterName(i)));
  return {
    version: SHEET_VERSION,
    nextColId: DEFAULT_COLS + 1,
    columns,
    rowCount: DEFAULT_ROW_COUNT,
    cells: {},   // "colId:rowIndex" -> raw typed text, a literal value OR a formula ("=" prefix)
    formats: {}, // "colId:rowIndex" -> a number-format token, or absent = General
  };
}

/** Read a possibly-foreign blob back into a sheet this module understands. Never guesses at a
 *  shape it does not recognize (LOUD-FAILURE belongs to the caller, which can compare the
 *  returned sheet's identity against what it read to decide whether to warn) — an unreadable
 *  or pre-versioning blob returns a fresh, empty sheet rather than a half-understood one.
 *  A blob saved by the OLD per-column shape (a `formula` and/or `format` field on a column)
 *  migrates cleanly: both fields are simply dropped — they named column-wide rules no cell
 *  ever stored a real value or a real per-cell format under, so there is nothing of the
 *  user's DATA to carry forward from either (a display preference is not worth a lossy
 *  best-effort backfill onto up to 200 rows it may not even apply to). */
export function migrateSheet(raw) {
  if (!raw || typeof raw !== "object") return createSheet();
  if (raw.version === SHEET_VERSION && Array.isArray(raw.columns) && raw.cells && typeof raw.cells === "object") {
    // Defend against a hand-edited/partial blob missing a column field a newer build added.
    const columns = raw.columns.map((c, i) => {
      const merged = { ...makeColumn(c.id || `c${i + 1}`, c.name || colLetterName(i)), ...c };
      delete merged.formula; // old per-column-formula field — see header note
      delete merged.format;  // old per-column-format field — see header note
      return merged;
    });
    const formats = raw.formats && typeof raw.formats === "object" ? { ...raw.formats } : {};
    return { version: SHEET_VERSION, nextColId: raw.nextColId || columns.length + 1, columns, rowCount: raw.rowCount || DEFAULT_ROW_COUNT, cells: { ...raw.cells }, formats };
  }
  return createSheet();
}

/** Two ALREADY-MIGRATED sheets carry meaningfully different content (B891184-FOLLOWUP-2).
 *  Used to detect a cross-device divergence at load: "local always wins on load" (ModelApp.jsx)
 *  means a device with its own older local copy never shows what the cloud actually holds, so
 *  without this check its next edit saves cleanly (no CAS conflict — nothing raced) and
 *  silently overwrites another device's work. Both inputs are the same post-migration shape, so
 *  a plain structural compare is exact and needs no semantic diff. */
export function sheetsDiverge(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export const cellKey = (colId, rowIndex) => `${colId}:${rowIndex}`;

export function colAt(sheet, colIndex) { return sheet.columns[colIndex] || null; }

export function rawAt(sheet, rowIndex, colIndex) {
  const col = colAt(sheet, colIndex);
  if (!col) return "";
  return sheet.cells[cellKey(col.id, rowIndex)] ?? "";
}

/** A cell's own number-format token, or `null` = General. Per-cell (see the header note on why
 *  this is no longer a column-level field). */
export function formatAt(sheet, rowIndex, colIndex) {
  const col = colAt(sheet, colIndex);
  if (!col) return null;
  return sheet.formats[cellKey(col.id, rowIndex)] ?? null;
}

export function columnIndexByName(sheet, name) {
  const target = String(name || "").trim().toLowerCase();
  return sheet.columns.findIndex((c) => c.name.trim().toLowerCase() === target);
}

export const isFormulaText = (text) => String(text ?? "").trim().startsWith("=");

/* ---- mutators — every one returns a NEW sheet ------------------------------------------- */

/** Set one cell's raw text — a literal value OR a formula (leading "="), the ONE thing a real
 *  spreadsheet cell holds. Growing past the current row count (typing into a blank padding
 *  row) extends it — the Schedule "type past the end" pattern, so the visible sheet never
 *  needs an explicit "add row" step for the common case. */
export function setRaw(sheet, rowIndex, colIndex, text) {
  const col = colAt(sheet, colIndex);
  if (!col) return sheet;
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

/** The ONE commit path every cell edit goes through (typed in-cell, via F2, or via the formula
 *  bar). Formulas now live in the SAME cells map as everything else, so this is just setRaw —
 *  kept as its own named export because SheetView/FormulaBar/tests already call it by this
 *  name and "commitCellText" reads better at a call site than "setRaw". */
export const commitCellText = setRaw;

/** Blank every cell in a rectangular range (Delete) — a formula cell clears exactly like a
 *  literal one, matching Excel: Delete removes whatever is in the cell, formula included.
 *  (The OLD per-column-formula shape deliberately protected the formula from Delete, because
 *  Delete on a data cell inside a COLUMN'S formula made no sense — that protection no longer
 *  applies now that a formula belongs to the one cell holding it.) */
export function blankRange(sheet, r1, r2, c1, c2) {
  const rr1 = Math.max(0, Math.min(r1, r2)), rr2 = Math.max(r1, r2);
  const cc1 = Math.max(0, Math.min(c1, c2)), cc2 = Math.min(sheet.columns.length - 1, Math.max(c1, c2));
  let cells = sheet.cells;
  let changed = false;
  for (let c = cc1; c <= cc2; c++) {
    const col = sheet.columns[c];
    if (!col) continue;
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

/** Apply a number-format token (or null = General) to every CELL in a rectangular range —
 *  per-cell, not per-column (see the header note: formatting one cell used to reformat every
 *  other value already sitting above it in the same column, measured live on a real
 *  pro-forma). A no-op (every touched cell already carries this exact format) returns `sheet`
 *  unchanged, so re-committing an unedited picker value never mints an undo frame for nothing. */
export function setNumberFormat(sheet, r1, r2, c1, c2, format) {
  const next = format || null;
  const rr1 = Math.max(0, Math.min(r1, r2)), rr2 = Math.max(r1, r2);
  const cc1 = Math.max(0, Math.min(c1, c2)), cc2 = Math.min(sheet.columns.length - 1, Math.max(c1, c2));
  let formats = sheet.formats;
  let changed = false;
  for (let c = cc1; c <= cc2; c++) {
    const col = sheet.columns[c];
    if (!col) continue;
    for (let r = rr1; r <= rr2; r++) {
      const key = cellKey(col.id, r);
      const had = Object.prototype.hasOwnProperty.call(formats, key);
      const current = had ? formats[key] : null;
      if (current === next) continue;
      if (!changed) formats = { ...formats };
      if (next === null) delete formats[key]; else formats[key] = next;
      changed = true;
    }
  }
  return changed ? { ...sheet, formats } : sheet;
}

export function addColumn(sheet) {
  const id = `c${sheet.nextColId}`;
  const columns = [...sheet.columns, makeColumn(id, colLetterName(sheet.columns.length))];
  return { ...sheet, columns, nextColId: sheet.nextColId + 1 };
}

/** Grow the sheet to have at least `count` columns, adding plain lettered columns as needed.
 *  A no-op (already wide enough) returns `sheet` unchanged. Used by paste/fill so writing past
 *  the current right edge extends the sheet instead of silently clipping — the same "type past
 *  the end" contract rows already have (padRowCount below), now for columns too (item 9). */
export function ensureColumnCount(sheet, count) {
  let s = sheet;
  while (s.columns.length < count) s = addColumn(s);
  return s;
}

/** Delete a column entirely (and every cell stored under it). There is no undo affordance
 *  beyond the workspace's own Ctrl+Z, which already snapshots the whole sheet. */
export function deleteColumn(sheet, colIndex) {
  const col = colAt(sheet, colIndex);
  if (!col || sheet.columns.length <= 1) return sheet; // never leave a sheet with zero columns
  const columns = sheet.columns.filter((_, i) => i !== colIndex);
  const prefix = `${col.id}:`;
  const cells = {};
  for (const [k, v] of Object.entries(sheet.cells)) if (!k.startsWith(prefix)) cells[k] = v;
  // Full cascade: a deleted column's per-cell FORMATS are gone too, not just its values —
  // leaving them behind would resurrect a stale format the moment a new column happened to
  // reuse the same id (TOMBSTONE-DELETES).
  const formats = {};
  for (const [k, v] of Object.entries(sheet.formats)) if (!k.startsWith(prefix)) formats[k] = v;
  return { ...sheet, columns, cells, formats };
}

/** How many rows the view should render past the real data, so typing never has to "add a
 *  row" first — the Schedule GridView's emptyPad pattern (public/sequence/index.html:9706),
 *  sized to always fill at least one screen's worth AND leave real spreadsheet-sized room
 *  (200, matching DEFAULT_ROW_COUNT) rather than stopping a few rows past whatever's typed. */
export function padRowCount(sheet, viewportRows) {
  return Math.max(200, (viewportRows || 0) + 10);
}

/** The last row/column index actually holding something (a value or a formula) — Excel's
 *  "used range", what Ctrl+End jumps to. `null` on a genuinely empty sheet (Ctrl+End has
 *  nowhere useful to go). */
export function usedRangeEnd(sheet) {
  let maxRow = -1, maxCol = -1;
  for (const key of Object.keys(sheet.cells)) {
    if (sheet.cells[key] === "" || sheet.cells[key] == null) continue;
    const sep = key.lastIndexOf(":");
    const colId = key.slice(0, sep);
    const rowIndex = Number(key.slice(sep + 1));
    const colIndex = sheet.columns.findIndex((c) => c.id === colId);
    if (colIndex < 0) continue;
    if (rowIndex > maxRow) maxRow = rowIndex;
    if (colIndex > maxCol) maxCol = colIndex;
  }
  return maxRow < 0 ? null : { row: maxRow, col: maxCol };
}
