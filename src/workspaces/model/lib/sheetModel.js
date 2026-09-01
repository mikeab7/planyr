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
 *
 * ⛔ STAGE 1 (owner report, 2026-09-01, verbatim: "it's kind of embarrassing that it only goes
 * up to H at first load … this should be a full blown model"): the grid grows up — 26 default
 * columns extending past Z on demand (never a hard cap), 1000-row default — and it gains real
 * structural editing. Columns are already identity-keyed by `id` (never by position), so
 * INSERTING or DELETING a column never has to move a single stored cell — only the `columns`
 * array reorders and every formula's COLUMN references get shifted (see
 * `rewriteFormulaForStructuralShift` in shared/formula/formula.js, a DIFFERENT transform from
 * the copy/fill one: it moves $-anchored references too, because $ means "don't move on copy,"
 * not "don't move when the grid itself restructures"). Rows are the opposite: `cellKey` embeds
 * the raw row INDEX directly (there is no stable row id), so inserting/deleting a row DOES have
 * to relocate every affected cell's storage key, on top of the same formula-reference shift.
 *
 * ⛔ STAGE 2 — THE RIBBON (owner brief, 2026-09-02): a real look, not just values and one number
 * format. `styles[key]` is a NEW per-cell map, same `cellKey` shape as `cells`/`formats`, holding
 * everything font/fill/alignment: `{ bold, italic, underline, strike, fontFamily, fontSize,
 * color, fill, align, valign, wrap, indent, border: {top,right,bottom,left} }` — every field
 * OPTIONAL (absent = inherit the sheet's plain default), so an unformatted cell costs nothing in
 * storage, exactly like `formats` already works for number format. `border`'s four edges are
 * each independently `"thin" | "double" | undefined` — a cell OWNS its own edges rather than
 * sharing them with its neighbour, which keeps every border operation a plain per-cell write (no
 * "which cell does this shared line belong to" bookkeeping) at the cost of a double-drawn line
 * where two adjacent cells both set the same edge — invisible in practice since both draw
 * identical 1px lines in the same place.
 *
 * `merges` is a NEW array of HORIZONTAL-ONLY spans — `{ r, c1Id, c2Id }`, one row, two or more
 * COLUMNS (never rows). ⛔ Scope decision, stated plainly rather than silently shipped thin: a
 * cell spanning multiple ROWS needs a render layer OUTSIDE SheetView's per-row virtualization
 * loop (every row today is an independently absolutely-positioned band — see SheetView.jsx's own
 * header on why sticky/absolute don't compose — so a block spanning several of those bands is
 * real, separate work, not a small extension of the column-spanning case). Horizontal merge
 * (merging a title across several columns, or a section-header row across the model) is the
 * dominant real underwriting pattern and reuses the SAME absolute-span-over-siblings mechanism
 * the existing text-spill rendering already proved out; vertical merge is explicit, tracked
 * follow-up (B1007283), not a silent gap. Anchored on COLUMN ID (stable across insert/delete of
 * OTHER columns, the same reasoning `cells`/`formats`/`styles` already rely on) and the raw ROW
 * INDEX (relocated on row insert/delete exactly like `rowHeights` is).
 */
import { rewriteFormulaForStructuralShift } from "../../../shared/formula/formula.js";

export const SHEET_VERSION = 1;
// STAGE 1 (2026-09-01): 8→26 default columns, extending past Z (AA, AB…) on demand via
// colLetterName below — never a hard cap a user can hit by scrolling or typing.
const DEFAULT_COLS = 26;
// A blank sheet starts with real spreadsheet-sized room, not a short list that grows one
// keystroke past its own edge at a time — virtualization means the DOM cost of a bigger
// blank area is ~0 (only the visible slice ever renders), so there is no reason to make it
// feel cramped. Measured live: at 30 rows, scrolling to a row far below the visible data hit
// the padding ceiling and simply had nowhere further to go. STAGE 1 (2026-09-01): 200→1000,
// matching the owner's "1000+ rows default, extendable" ask — extendable because rowCount only
// ever grows past this floor (typing past the end, or an explicit row insert), never caps it.
const DEFAULT_ROW_COUNT = 1000;

/** Excel-style column letters: A, B, … Z, AA, AB, … — used only as the default NAME for a
 *  freshly-added column. Renaming is free-text; this is just a starting point. */
function colLetterName(index) {
  let n = index + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const makeColumn = (id, name) => ({ id, name, width: 120 });

// STAGE 1 — per-row height override (row index -> px) and freeze-pane counts. Both are
// deliberately NOT stored on `columns`/inside `cells`: a row has no stable id to hang a height
// off of the way a column does (see the file header), and freeze is a simple COUNT of
// leftmost/topmost lines, not tied to any particular row/column's identity — which is exactly
// why insert/delete never needs to adjust it (see insertRowAt/deleteRowAt below).
// ⛔ STAGE 2 VISUAL PASS (owner, "make it visually appealing... right now it looks horrible"):
// 26 → 22. A financial model is read in blocks, not skimmed — density beats airiness. 22 is a
// LITERAL, deliberate match to CONTROL_H.sm (src/shared/ui/designTokens.js) — not an import
// (this module stays pure/DOM-free by design, no UI-layer dependency), the same "duplicate the
// number, document why" pattern controls.jsx's own RADIUS already uses for the identical reason.
export const DEFAULT_ROW_H = 22;

export function createSheet() {
  const columns = Array.from({ length: DEFAULT_COLS }, (_, i) => makeColumn(`c${i + 1}`, colLetterName(i)));
  return {
    version: SHEET_VERSION,
    nextColId: DEFAULT_COLS + 1,
    columns,
    rowCount: DEFAULT_ROW_COUNT,
    cells: {},       // "colId:rowIndex" -> raw typed text, a literal value OR a formula ("=" prefix)
    formats: {},     // "colId:rowIndex" -> a number-format token, or absent = General
    styles: {},      // "colId:rowIndex" -> a per-cell look object (font/fill/alignment/border), absent = plain
    rowHeights: {},  // rowIndex -> px override, absent = DEFAULT_ROW_H
    freezeRows: 0,   // count of frozen TOP rows
    freezeCols: 0,   // count of frozen LEFT columns
    merges: [],      // [{ r, c1Id, c2Id }] — horizontal-only spans, see file header
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
 *  best-effort backfill onto up to 200 rows it may not even apply to). A pre-Stage-1 blob
 *  simply lacks `rowHeights`/`freezeRows`/`freezeCols` — defaulted here exactly like every
 *  other field a later build added, never a reason to refuse the rest of the sheet.
 *
 *  ⛔ B1000960 (owner report, 2026-09-01, relayed verbatim: he opened Stage 1 and said "it
 *  doesn't look like you did anything" — he was looking at 8 columns and a 4-button toolbar).
 *  Stage 1 bumped the DEFAULTS a brand-new sheet is BORN with (26 cols / 1000 rows), but a
 *  sheet that already existed before Stage 1 shipped carries its OWN OLD `columns.length`/
 *  `rowCount` in the saved blob, and this function used to just echo them straight back
 *  (`rowCount: raw.rowCount || DEFAULT_ROW_COUNT` only floors an ABSENT/zero value, and the
 *  old `columns` array was returned completely unpadded) — so the one person Stage 1 was
 *  built for, the one with an existing sheet, was the one person who could never see it. A
 *  saved document must never be able to pin the app to an old capacity ceiling: capacity is
 *  now ALWAYS derived as max(whatever was saved, the current floor), on every load, columns
 *  AND rows both — never a one-time migration flag, so a FUTURE floor increase (Stage 4's
 *  larger pro-forma) heals every existing sheet the exact same way with no new code. */
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
    // STAGE 2 — a pre-ribbon blob simply has no `styles`/`merges` at all, same as a pre-Stage-1
    // blob had no `rowHeights`/`freezeRows`/`freezeCols` above: defaulted here like every other
    // field a later build added, never a reason to refuse the rest of the sheet.
    const styles = raw.styles && typeof raw.styles === "object" ? { ...raw.styles } : {};
    const merges = Array.isArray(raw.merges)
      ? raw.merges.filter((m) => m && typeof m.r === "number" && typeof m.c1Id === "string" && typeof m.c2Id === "string")
      : [];
    const rowHeights = raw.rowHeights && typeof raw.rowHeights === "object" ? { ...raw.rowHeights } : {};
    const freezeRows = Number.isInteger(raw.freezeRows) && raw.freezeRows >= 0 ? raw.freezeRows : 0;
    const freezeCols = Number.isInteger(raw.freezeCols) && raw.freezeCols >= 0 ? raw.freezeCols : 0;
    const migrated = {
      version: SHEET_VERSION, nextColId: raw.nextColId || columns.length + 1, columns,
      rowCount: Math.max(Number(raw.rowCount) || 0, DEFAULT_ROW_COUNT), cells: { ...raw.cells }, formats, styles,
      rowHeights, freezeRows, freezeCols, merges,
    };
    // Always float capacity up to the current floor — never a stored ceiling. Reuses
    // ensureColumnCount (already used by paste/fill to grow the sheet mid-session) so there is
    // one single "grow to at least N columns" rule in the whole module, not a second copy here.
    return ensureColumnCount(migrated, DEFAULT_COLS);
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

// A frozen empty object — every unformatted cell shares this ONE instance rather than each
// getting its own `{}` (styleAt is called once per rendered cell every render; avoiding an
// allocation there is free and keeps identity-based checks, if a caller ever adds one, cheap).
const EMPTY_STYLE = Object.freeze({});

/** A cell's own look — bold/italic/fill/border/alignment/etc — or the shared EMPTY_STYLE object
 *  when the cell carries no override (see the file header for the field shape). Per-cell, same
 *  reasoning as formatAt above. */
export function styleAt(sheet, rowIndex, colIndex) {
  const col = colAt(sheet, colIndex);
  if (!col) return EMPTY_STYLE;
  return (sheet.styles && sheet.styles[cellKey(col.id, rowIndex)]) || EMPTY_STYLE;
}

/** A row's rendered height in px — an explicit override, or DEFAULT_ROW_H (Excel's own
 *  default for an unmodified row; SheetView imports this same constant as ROW_H so the two
 *  can never drift). */
export function rowHeightAt(sheet, rowIndex) {
  return (sheet.rowHeights && sheet.rowHeights[rowIndex]) || DEFAULT_ROW_H;
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

// STAGE 1 — drag-resize floors. A column/row can shrink to a sliver but never to nothing —
// Excel itself refuses to drag a column/row narrower than a handful of px for the same reason
// (a zero-width column would be impossible to ever select or widen again by dragging its own
// border, since there'd be no border left to grab).
const MIN_COL_W = 24;
const MIN_ROW_H = 14;

export function setColumnWidth(sheet, colIndex, width) {
  const col = colAt(sheet, colIndex);
  if (!col) return sheet;
  const w = Math.max(MIN_COL_W, Math.round(width));
  if (col.width === w) return sheet;
  const columns = sheet.columns.map((c, i) => (i === colIndex ? { ...c, width: w } : c));
  return { ...sheet, columns };
}

export function setRowHeight(sheet, rowIndex, height) {
  const h = Math.max(MIN_ROW_H, Math.round(height));
  if ((sheet.rowHeights[rowIndex] || DEFAULT_ROW_H) === h) return sheet;
  const rowHeights = { ...sheet.rowHeights };
  if (h === DEFAULT_ROW_H) delete rowHeights[rowIndex]; else rowHeights[rowIndex] = h;
  return { ...sheet, rowHeights };
}

/** Freeze the top `rows` rows and/or the left `cols` columns — Excel's three menu actions
 *  (Freeze Top Row / Freeze First Column / Freeze Panes at the current selection) all reduce to
 *  setting this one pair of counts; the CALLER decides what counts to pass (SheetView/ModelApp),
 *  this is just the pure setter. 0/0 = no freeze. */
export function setFreeze(sheet, rows, cols) {
  const fr = Math.max(0, Math.min(sheet.rowCount, rows | 0));
  const fc = Math.max(0, Math.min(sheet.columns.length, cols | 0));
  if (fr === sheet.freezeRows && fc === sheet.freezeCols) return sheet;
  return { ...sheet, freezeRows: fr, freezeCols: fc };
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

// ---- STAGE 2 — per-cell look: font/fill/alignment/border, format painter, merge, sort -------

const STYLE_KEYS = ["bold", "italic", "underline", "strike", "fontFamily", "fontSize", "color", "fill", "align", "valign", "wrap", "indent"];

/** Merge a style PATCH into an existing per-cell style object. Every top-level key follows the
 *  same convention `formats` already uses at the cell level: `null` in the patch REMOVES that
 *  key (falls back to the sheet's plain default — how a toggle button un-bolds/un-italicizes),
 *  any other value SETS it. `border` is the one nested field — its four edges get the identical
 *  null-removes/value-sets treatment one level down, so setting just `{border:{top:"thin"}}`
 *  never disturbs an existing bottom/left/right edge already on the cell. Returns `{next,
 *  changed}` rather than mutating — every caller below folds `changed` into its own "did
 *  anything actually move" tracking so a no-op patch across a big range never mints a stray
 *  identical-content style entry (matching setNumberFormat's own no-op contract). */
function mergeStylePatch(existing, patch) {
  let next = existing ? { ...existing } : {};
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (k === "border") {
      const nextBorder = next.border ? { ...next.border } : {};
      let borderChanged = false;
      for (const [edge, val] of Object.entries(v)) {
        if (val === null || val === undefined) { if (edge in nextBorder) { delete nextBorder[edge]; borderChanged = true; } }
        else if (nextBorder[edge] !== val) { nextBorder[edge] = val; borderChanged = true; }
      }
      if (borderChanged) {
        if (Object.keys(nextBorder).length) next.border = nextBorder; else delete next.border;
        changed = true;
      }
      continue;
    }
    if (v === null) { if (k in next) { delete next[k]; changed = true; } continue; }
    if (v === undefined) continue;
    if (next[k] !== v) { next[k] = v; changed = true; }
  }
  return { next, changed };
}

/** The one low-level per-cell style writer every mutator below (font/fill/alignment toggles,
 *  border, clear formatting, format painter) funnels through, so "how a style patch merges into
 *  an existing cell" is decided in exactly one place. `patchFor(r, c)` lets a caller vary the
 *  patch per cell (applyBorder needs a different edge set on a perimeter cell than an interior
 *  one) while still sharing the same range-walk/no-op/empty-object-cleanup plumbing. */
function walkAndPatchStyles(sheet, r1, r2, c1, c2, patchFor) {
  const rr1 = Math.max(0, Math.min(r1, r2)), rr2 = Math.max(r1, r2);
  const cc1 = Math.max(0, Math.min(c1, c2)), cc2 = Math.min(sheet.columns.length - 1, Math.max(c1, c2));
  let styles = sheet.styles;
  let changed = false;
  for (let c = cc1; c <= cc2; c++) {
    const col = sheet.columns[c];
    if (!col) continue;
    for (let r = rr1; r <= rr2; r++) {
      const patch = patchFor(r, c, rr1, rr2, cc1, cc2);
      if (!patch) continue;
      const key = cellKey(col.id, r);
      const { next, changed: cellChanged } = mergeStylePatch(styles[key], patch);
      if (cellChanged) {
        if (!changed) styles = { ...styles };
        if (Object.keys(next).length) styles[key] = next; else delete styles[key];
        changed = true;
      }
    }
  }
  return changed ? { ...sheet, styles } : sheet;
}

/** Apply a style patch (any mix of font/fill/alignment/wrap/indent/border — see the file header
 *  for the full field list) to every cell in a rectangular range. The ONE setter the ribbon's
 *  Font and Alignment groups both call — border has its own `applyBorder` below because its
 *  edges depend on WHERE a cell sits in the range (outline vs. every-cell), which a flat patch
 *  can't express. */
export function setCellStyle(sheet, r1, r2, c1, c2, patch) {
  return walkAndPatchStyles(sheet, r1, r2, c1, c2, () => patch);
}

/** Border — the Borders group. `edges` is the subset of top/right/bottom/left to touch;
 *  `style` is `"thin" | "double" | null` (null clears); `mode` is `"outline"` (only the
 *  PERIMETER of the range gets that edge — what "Top Border" / "Bottom Border (double)" / a
 *  single-edge toggle / the 4-edge "Outline" button all are) or `"all"` (every cell in the range
 *  gets every requested edge — the "All borders"/grid button; also how "No border" clears
 *  everything, since a border anywhere in the range needs removing regardless of position). */
export function applyBorder(sheet, r1, r2, c1, c2, { edges, style, mode }) {
  return walkAndPatchStyles(sheet, r1, r2, c1, c2, (r, c, rr1, rr2, cc1, cc2) => {
    const border = {};
    for (const edge of edges) {
      const onPerimeter = edge === "top" ? r === rr1 : edge === "bottom" ? r === rr2 : edge === "left" ? c === cc1 : c === cc2;
      if (mode === "all" || onPerimeter) border[edge] = style;
    }
    return Object.keys(border).length ? { border } : null;
  });
}

/** Clear Formatting — wipes both the per-cell STYLE and the number FORMAT for a range, leaving
 *  every cell's actual VALUE (and any merge framing it) untouched — Excel's own Clear > Formats
 *  scope exactly: contents and merges are separate concerns from how a cell is drawn. */
export function clearFormatting(sheet, r1, r2, c1, c2) {
  const rr1 = Math.max(0, Math.min(r1, r2)), rr2 = Math.max(r1, r2);
  const cc1 = Math.max(0, Math.min(c1, c2)), cc2 = Math.min(sheet.columns.length - 1, Math.max(c1, c2));
  let styles = sheet.styles, formats = sheet.formats, changed = false;
  for (let c = cc1; c <= cc2; c++) {
    const col = sheet.columns[c];
    if (!col) continue;
    for (let r = rr1; r <= rr2; r++) {
      const key = cellKey(col.id, r);
      if (Object.prototype.hasOwnProperty.call(styles, key)) { if (styles === sheet.styles) styles = { ...styles }; delete styles[key]; changed = true; }
      if (Object.prototype.hasOwnProperty.call(formats, key)) { if (formats === sheet.formats) formats = { ...formats }; delete formats[key]; changed = true; }
    }
  }
  return changed ? { ...sheet, styles, formats } : sheet;
}

/** Format Painter — capture (item: the number format + the full style, never the cell's VALUE)
 *  and apply. Applying REPLACES the target's whole look (clearing anything the source didn't
 *  carry, border edges included) rather than layering on top — "paint this cell's look onto
 *  that one" means the target ends up looking like the source, not like a merge of the two. */
export function paintedStyleAt(sheet, rowIndex, colIndex) {
  return { format: formatAt(sheet, rowIndex, colIndex), style: styleAt(sheet, rowIndex, colIndex) };
}
export function applyPaintedStyle(sheet, r1, r2, c1, c2, painted) {
  if (!painted) return sheet;
  let next = setNumberFormat(sheet, r1, r2, c1, c2, painted.format);
  const clearAll = {};
  for (const k of STYLE_KEYS) clearAll[k] = null;
  const border = { top: null, right: null, bottom: null, left: null, ...(painted.style.border || {}) };
  next = setCellStyle(next, r1, r2, c1, c2, { ...clearAll, ...painted.style, border });
  return next;
}

/** The horizontal span (see file header) containing (rowIndex, colIndex), resolved to CURRENT
 *  column positions — `{r, c1, c2}` (indices, not ids) — or `null`. Every merge-aware caller
 *  (click resolution, arrow-key nav, rendering) goes through this rather than reading `merges`
 *  directly, so "which columns a merge covers right now" is decided in exactly one place. */
export function mergeAt(sheet, rowIndex, colIndex) {
  const col = colAt(sheet, colIndex);
  if (!col) return null;
  for (const m of sheet.merges || []) {
    if (m.r !== rowIndex) continue;
    const i1 = sheet.columns.findIndex((cc) => cc.id === m.c1Id);
    const i2 = sheet.columns.findIndex((cc) => cc.id === m.c2Id);
    if (i1 < 0 || i2 < 0) continue; // a dangling reference (shouldn't happen — defensive)
    if (colIndex >= i1 && colIndex <= i2) return { r: m.r, c1: i1, c2: i2 };
  }
  return null;
}

/** Merge every cell in one ROW across c1..c2 into a single visual block, anchored at the
 *  leftmost cell (its value/format/style are what render for the whole span — the OTHER cells'
 *  own content is left completely untouched in storage, deliberately: unmerging restores exactly
 *  what was there before, no Excel-style "merging discards every value but the first" data loss,
 *  and no confirmation dialog is needed for something that loses nothing). A no-op unless the
 *  range is exactly one row and at least two columns — vertical merge isn't supported (file
 *  header) and a single column can't "merge" with itself. */
export function mergeRange(sheet, r1, r2, c1, c2) {
  if (r1 !== r2) return sheet;
  const row = r1;
  const cc1 = Math.min(c1, c2), cc2 = Math.max(c1, c2);
  if (cc2 <= cc1) return sheet;
  const c1Id = sheet.columns[cc1]?.id, c2Id = sheet.columns[cc2]?.id;
  if (!c1Id || !c2Id) return sheet;
  // Replace any existing merge(s) the new range overlaps on this row — a cell never belongs to
  // two merges at once.
  const merges = (sheet.merges || []).filter((m) => {
    if (m.r !== row) return true;
    const i1 = sheet.columns.findIndex((cc) => cc.id === m.c1Id);
    const i2 = sheet.columns.findIndex((cc) => cc.id === m.c2Id);
    return i2 < cc1 || i1 > cc2;
  });
  merges.push({ r: row, c1Id, c2Id });
  return { ...sheet, merges };
}

/** Unmerge the span (if any) containing (rowIndex, colIndex) — every other cell's own stored
 *  content (preserved untouched by mergeRange above) simply becomes visible again. */
export function unmergeAt(sheet, rowIndex, colIndex) {
  const found = mergeAt(sheet, rowIndex, colIndex);
  if (!found) return sheet;
  const dropC1Id = sheet.columns[found.c1]?.id, dropC2Id = sheet.columns[found.c2]?.id;
  const merges = (sheet.merges || []).filter((m) => !(m.r === found.r && m.c1Id === dropC1Id && m.c2Id === dropC2Id));
  return { ...sheet, merges };
}

/** How `merges` reacts to a column being deleted (called from deleteColumn below, on the
 *  columns array as it stood BEFORE removal). A merge entirely outside the deleted column is
 *  untouched (ids are stable). A merge whose ANCHOR (c1Id) or far edge (c2Id) IS the deleted
 *  column shrinks in from that side — collapsing to (or past) a single column drops the merge
 *  entirely, since a one-column "merge" is meaningless. A merge with the deleted column merely
 *  INTERIOR to its span needs no id change at all — its rendered width just shrinks by one
 *  column next paint, exactly like any other column delete inside a wide span. */
function mergesAfterColumnDelete(sheet, colIndex) {
  const columns = sheet.columns;
  const out = [];
  for (const m of sheet.merges || []) {
    const i1 = columns.findIndex((cc) => cc.id === m.c1Id);
    const i2 = columns.findIndex((cc) => cc.id === m.c2Id);
    if (i1 < 0 || i2 < 0) continue;
    if (colIndex < i1 || colIndex > i2) { out.push(m); continue; }
    let nc1Id = m.c1Id, nc2Id = m.c2Id;
    if (colIndex === i1) {
      const next2 = columns[i1 + 1];
      if (!next2 || i1 + 1 >= i2) continue; // collapses to <=1 column — drop the merge
      nc1Id = next2.id;
    } else if (colIndex === i2) {
      const prev = columns[i2 - 1];
      if (!prev || i2 - 1 <= i1) continue;
      nc2Id = prev.id;
    }
    out.push({ r: m.r, c1Id: nc1Id, c2Id: nc2Id });
  }
  return out;
}

/** How `merges` reacts to a row being inserted/deleted (called from insertRowAt/deleteRowAt
 *  below) — the exact same relocation `rowHeights` already gets via `relocateRowMap`, just over
 *  an array of `{r, ...}` objects instead of a `rowIndex -> value` map. A merge ON the deleted
 *  row is dropped (its anchor row is gone); every merge below it shifts by `delta`. */
function relocateMergeRows(merges, at, delta) {
  const out = [];
  for (const m of merges || []) {
    if (delta < 0 && m.r === at) continue;
    out.push({ ...m, r: m.r >= at ? m.r + delta : m.r });
  }
  return out;
}

/** Sort — the Sort & Filter group. Reorders ROWS r1..r2 by the value in `colIndex`, moving each
 *  row's FULL content (every column's cell text/format/style, plus its own row height) together
 *  as one unit, matching Excel. Blanks always sort to the bottom regardless of direction (Excel's
 *  own rule — so toggling A→Z/Z→A doesn't fling every gap to the top). Numbers sort before text.
 *  ⛔ Sorts on each cell's RAW text, never a formula's computed result — sheetModel is
 *  deliberately evaluator-free (it has no dependency on sheetEngine.js, by design, the same
 *  layering `usedRangeEnd`/every other pure query here already respects), so a column of
 *  FORMULAS sorts by formula TEXT, not value — a real, known limitation shared with Excel itself
 *  (which also doesn't rewrite/re-resolve formula references on a plain sort). Refuses (no-op)
 *  if any merge touches the range — sorting rows out from under a horizontal merge would detach
 *  it from the content it was framing (NO-ONE-OWNS-A-COMPOSITE: a merge is a composite surface a
 *  per-row move can corrupt without any single per-cell check noticing). */
export function sortRange(sheet, r1, r2, colIndex, direction) {
  const rr1 = Math.max(0, Math.min(r1, r2)), rr2 = Math.max(r1, r2);
  if (rr2 <= rr1) return sheet;
  for (const m of sheet.merges || []) if (m.r >= rr1 && m.r <= rr2) return sheet;
  const col = sheet.columns[colIndex];
  if (!col) return sheet;

  const rows = [];
  for (let r = rr1; r <= rr2; r++) {
    const rowCells = {}, rowFormats = {}, rowStyles = {};
    for (const c of sheet.columns) {
      const key = cellKey(c.id, r);
      if (Object.prototype.hasOwnProperty.call(sheet.cells, key)) rowCells[c.id] = sheet.cells[key];
      if (Object.prototype.hasOwnProperty.call(sheet.formats, key)) rowFormats[c.id] = sheet.formats[key];
      if (Object.prototype.hasOwnProperty.call(sheet.styles, key)) rowStyles[c.id] = sheet.styles[key];
    }
    rows.push({ cells: rowCells, formats: rowFormats, styles: rowStyles, height: sheet.rowHeights[r], sortKey: sortKeyFor(sheet.cells[cellKey(col.id, r)]) });
  }
  const dir = direction === "desc" ? -1 : 1;
  // Blank-last is a property of the DATA, not the direction — it must NOT be inside the part of
  // the comparator that gets sign-flipped for descending, or "descending" would fling every
  // blank to the top instead of keeping it at the bottom (measured: it did, before this split).
  const sorted = [...rows].sort((a, b) => {
    if (a.sortKey.kind === "blank" && b.sortKey.kind === "blank") return 0;
    if (a.sortKey.kind === "blank") return 1;
    if (b.sortKey.kind === "blank") return -1;
    return compareSortKeys(a.sortKey, b.sortKey) * dir;
  });

  const cells = { ...sheet.cells }, formats = { ...sheet.formats }, styles = { ...sheet.styles }, rowHeights = { ...sheet.rowHeights };
  for (let i = 0; i < sorted.length; i++) {
    const r = rr1 + i, row = sorted[i];
    for (const c of sheet.columns) {
      const key = cellKey(c.id, r);
      if (Object.prototype.hasOwnProperty.call(row.cells, c.id)) cells[key] = row.cells[c.id]; else delete cells[key];
      if (Object.prototype.hasOwnProperty.call(row.formats, c.id)) formats[key] = row.formats[c.id]; else delete formats[key];
      if (Object.prototype.hasOwnProperty.call(row.styles, c.id)) styles[key] = row.styles[c.id]; else delete styles[key];
    }
    if (row.height != null) rowHeights[r] = row.height; else delete rowHeights[r];
  }
  return { ...sheet, cells, formats, styles, rowHeights };
}
function sortKeyFor(raw) {
  if (raw == null || raw === "") return { kind: "blank", v: null };
  const s = String(raw);
  const n = Number(s);
  if (s.trim() !== "" && !Number.isNaN(n)) return { kind: "num", v: n };
  return { kind: "text", v: s.toLowerCase() };
}
// Only ever called with two NON-blank keys — blank ordering is decided by the caller above,
// outside the part of the comparator direction flips.
function compareSortKeys(a, b) {
  if (a.kind === "num" && b.kind === "num") return a.v - b.v;
  if (a.kind === "num") return -1; // numbers before text — Excel's own rule
  if (b.kind === "num") return 1;
  return a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
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

/** Rewrite every formula cell's raw text for a structural shift on ONE axis, leaving every
 *  literal cell untouched. Shared by insertRowAt/deleteRowAt/insertColumnAt/deleteColumn — the
 *  ONLY thing that differs between them is which axis/at/delta to pass. */
function shiftAllFormulas(cells, axis, at, delta) {
  const next = {};
  let changed = false;
  for (const [k, v] of Object.entries(cells)) {
    if (isFormulaText(v)) {
      const shifted = rewriteFormulaForStructuralShift(v, axis, at, delta);
      if (shifted !== v) changed = true;
      next[k] = shifted;
    } else {
      next[k] = v;
    }
  }
  return changed ? next : cells;
}

/** STAGE 1 — insert a new blank COLUMN before `colIndex`. Columns are identity-keyed by `id`
 *  (see the file header), so no cell/format DATA ever moves — only the `columns` array grows
 *  and every formula in the sheet gets its column references shifted (a reference at/after the
 *  insertion point moves right; nothing before it is touched — see
 *  rewriteFormulaForStructuralShift for the exact rule, including why it shifts $-anchored
 *  references too). */
export function insertColumnAt(sheet, colIndex) {
  const at = Math.max(0, Math.min(sheet.columns.length, colIndex));
  const id = `c${sheet.nextColId}`;
  const columns = [...sheet.columns];
  columns.splice(at, 0, makeColumn(id, colLetterName(at)));
  const cells = shiftAllFormulas(sheet.cells, "col", at + 1, 1);
  return { ...sheet, columns, cells, nextColId: sheet.nextColId + 1 };
}

/** Delete a column entirely (and every cell/format stored under it), then shift every
 *  remaining formula's column references — a reference to the deleted column becomes #REF!, a
 *  reference after it shifts left. There is no undo affordance beyond the workspace's own
 *  Ctrl+Z, which already snapshots the whole sheet. */
export function deleteColumn(sheet, colIndex) {
  const col = colAt(sheet, colIndex);
  if (!col || sheet.columns.length <= 1) return sheet; // never leave a sheet with zero columns
  const columns = sheet.columns.filter((_, i) => i !== colIndex);
  const prefix = `${col.id}:`;
  const survivingCells = {};
  for (const [k, v] of Object.entries(sheet.cells)) if (!k.startsWith(prefix)) survivingCells[k] = v;
  const cells = shiftAllFormulas(survivingCells, "col", colIndex + 1, -1);
  // Full cascade: a deleted column's per-cell FORMATS are gone too, not just its values —
  // leaving them behind would resurrect a stale format the moment a new column happened to
  // reuse the same id (TOMBSTONE-DELETES).
  const formats = {};
  for (const [k, v] of Object.entries(sheet.formats)) if (!k.startsWith(prefix)) formats[k] = v;
  // Same TOMBSTONE-DELETES cascade for the STAGE 2 per-cell style map.
  const styles = {};
  for (const [k, v] of Object.entries(sheet.styles || {})) if (!k.startsWith(prefix)) styles[k] = v;
  const merges = mergesAfterColumnDelete(sheet, colIndex);
  return { ...sheet, columns, cells, formats, styles, merges };
}

// Relocate a rowIndex-keyed map's entries (rowHeights) by the same rule cells/formats use
// below — everything at/after the affected row shifts, the deleted row's own entry (if any)
// is dropped. Shared so insertRowAt/deleteRowAt can't drift from each other's row math.
function relocateRowMap(map, rowIndex, delta) {
  const next = {};
  for (const [k, v] of Object.entries(map)) {
    const r = Number(k);
    if (delta < 0 && r === rowIndex) continue; // the deleted row's own override is gone
    next[r >= rowIndex ? r + delta : r] = v;
  }
  return next;
}

/** STAGE 1 — insert a new blank ROW before `rowIndex`. Unlike a column, a row has no stable id
 *  (`cellKey` embeds the raw row INDEX — see the file header), so every cell/format/row-height
 *  entry at or after `rowIndex` has to actually relocate its storage key, on top of the same
 *  formula-reference shift columns get. */
export function insertRowAt(sheet, rowIndex) {
  const at = Math.max(0, Math.min(sheet.rowCount, rowIndex));
  const shifted = shiftAllFormulas(sheet.cells, "row", at + 1, 1);
  const cells = {};
  for (const [k, v] of Object.entries(shifted)) {
    const sep = k.lastIndexOf(":");
    const colId = k.slice(0, sep), r = Number(k.slice(sep + 1));
    cells[cellKey(colId, r >= at ? r + 1 : r)] = v;
  }
  const formats = {};
  for (const [k, v] of Object.entries(sheet.formats)) {
    const sep = k.lastIndexOf(":");
    const colId = k.slice(0, sep), r = Number(k.slice(sep + 1));
    formats[cellKey(colId, r >= at ? r + 1 : r)] = v;
  }
  const styles = {};
  for (const [k, v] of Object.entries(sheet.styles || {})) {
    const sep = k.lastIndexOf(":");
    const colId = k.slice(0, sep), r = Number(k.slice(sep + 1));
    styles[cellKey(colId, r >= at ? r + 1 : r)] = v;
  }
  const rowHeights = relocateRowMap(sheet.rowHeights, at, 1);
  const merges = relocateMergeRows(sheet.merges, at, 1);
  return { ...sheet, cells, formats, styles, rowHeights, merges, rowCount: sheet.rowCount + 1 };
}

/** STAGE 1 — delete the row at `rowIndex` entirely (every cell/format stored on it), then
 *  relocate everything below it up by one and shift every remaining formula's row references —
 *  a reference to the deleted row becomes #REF!, a reference after it shifts up. */
export function deleteRowAt(sheet, rowIndex) {
  const at = Math.max(0, Math.min(sheet.rowCount - 1, rowIndex));
  const survivingCells = {};
  for (const [k, v] of Object.entries(sheet.cells)) {
    const sep = k.lastIndexOf(":");
    const r = Number(k.slice(sep + 1));
    if (r === at) continue; // the deleted row's own cells vanish
    survivingCells[k] = v;
  }
  const shifted = shiftAllFormulas(survivingCells, "row", at + 1, -1);
  const cells = {};
  for (const [k, v] of Object.entries(shifted)) {
    const sep = k.lastIndexOf(":");
    const colId = k.slice(0, sep), r = Number(k.slice(sep + 1));
    cells[cellKey(colId, r > at ? r - 1 : r)] = v;
  }
  const formats = {};
  for (const [k, v] of Object.entries(sheet.formats)) {
    const sep = k.lastIndexOf(":");
    const colId = k.slice(0, sep), r = Number(k.slice(sep + 1));
    if (r === at) continue;
    formats[cellKey(colId, r > at ? r - 1 : r)] = v;
  }
  const styles = {};
  for (const [k, v] of Object.entries(sheet.styles || {})) {
    const sep = k.lastIndexOf(":");
    const colId = k.slice(0, sep), r = Number(k.slice(sep + 1));
    if (r === at) continue;
    styles[cellKey(colId, r > at ? r - 1 : r)] = v;
  }
  const rowHeights = relocateRowMap(sheet.rowHeights, at, -1);
  const merges = relocateMergeRows(sheet.merges, at, -1);
  return { ...sheet, cells, formats, styles, rowHeights, merges, rowCount: Math.max(1, sheet.rowCount - 1) };
}

/** How many rows the view should render past the real data, so typing never has to "add a
 *  row" first — the Schedule GridView's emptyPad pattern (public/sequence/index.html:9706),
 *  sized to always fill at least one screen's worth AND leave real spreadsheet-sized room
 *  (DEFAULT_ROW_COUNT) rather than stopping a few rows past whatever's typed. */
export function padRowCount(sheet, viewportRows) {
  return Math.max(DEFAULT_ROW_COUNT, (viewportRows || 0) + 10);
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
