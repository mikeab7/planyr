/* Model workspace — the command palette's action registry (NEW-1, owner chat block: "Command
 * palette for the Spreadsheet, and get the audit tools out of the overflow").
 *
 * ⛔ THE WHOLE POINT: this is the ONE list of every action the module can perform, and it is
 * consumed by the palette AND by Ribbon.jsx's own buttons for the handful of actions whose
 * result depends on current state (a style TOGGLE) — never a second hand-maintained copy that
 * can drift from what the toolbar actually does. A command's `run(ctx)` calls the exact same
 * `ctx.onXxx` handler a toolbar control calls, with the ctx object ModelApp.jsx builds ONCE and
 * hands to the Ribbon, the permanent audit toolbar (AppHeader row 1) and this palette alike — so
 * there is structurally only one place "what happens when you ask for X" can be decided.
 *
 * Pure, DOM-free (like ribbonLayout.js beside it): `run`/`label`/`disabled` are plain functions
 * of `ctx`, called at INVOKE time, not captured at build time — so the exported command list
 * itself is a static array, safe to unit-test with a plain object standing in for `ctx`.
 *
 * SCOPE GUARD (owner, verbatim): chrome and discoverability only — nothing here generates
 * content into cells. Every command below either toggles/reads existing chrome state or forwards
 * to a mutator ModelApp.jsx already wires to the ribbon/context-menu today.
 */
import { NUMBER_FORMATS } from "./numberFormats.js";
import { zoomStepButton, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM } from "./sheetZoom.js";
import { RIBBON_GROUPS } from "./ribbonLayout.js";
import { CHORDS } from "./keymap.js";

// ---- Shared style-patch helpers — the SAME toggle computation Ribbon.jsx's own FontStyleGroup/
// AlignmentGroup buttons use (imported there, not reimplemented) and the palette commands below
// call identically, so a bold toggle can never compute two different answers depending on which
// surface asked for it. ----
export function toggleBoldPatch(style) { return { bold: style?.bold ? null : true }; }
export function toggleItalicPatch(style) { return { italic: style?.italic ? null : true }; }
export function toggleUnderlinePatch(style) { return { underline: style?.underline ? null : true }; }
export function toggleStrikePatch(style) { return { strike: style?.strike ? null : true }; }
export function toggleWrapPatch(style) { return { wrap: style?.wrap ? null : true }; }

// Group labels for the palette's section headers. The six that still ride the Home ribbon reuse
// RIBBON_GROUPS' own label (one source); the rest (relocated to the palette/context menu/row-1,
// per the owner's "reduce the Home ribbon" ask) are named here.
const RIBBON_GROUP_LABELS = Object.fromEntries(RIBBON_GROUPS.map((g) => [g.key, g.label]));
export const COMMAND_GROUPS = {
  ...RIBBON_GROUP_LABELS,
  borders: "Borders",
  names: "Names",
  audit: "Formula Auditing",
  sortfilter: "Sort & Filter",
  find: "Find & Replace",
  sheet: "Sheet",
  file: "Import & Export",
  edit: "Edit",
  structure: "Rows & Columns",
  view: "View & Zoom",
};

const label = (v) => v; // identity — makes a plain string read as "this is the label slot" at call sites below
const kw = (s) => s; // identity — same, for the keywords slot

/** The full command list. Every entry: `{ id, label, group, shortcut?, keywords?, run, disabled? }`.
 *  `label`/`disabled` may be a plain value or a `(ctx) => value` function; `run` is always
 *  `(ctx) => void`. Ids are permanent — the live-verify checklist and any future deep link may
 *  name one. */
export const COMMANDS = [
  // ---- Actions ----
  { id: "undo", label: label("Undo"), group: "actions", shortcut: "Ctrl+Z", keywords: kw("revert step back"), run: (ctx) => ctx.onUndo(), disabled: (ctx) => !ctx.canUndo },
  { id: "redo", label: label("Redo"), group: "actions", shortcut: "Ctrl+Shift+Z", keywords: kw("repeat step forward"), run: (ctx) => ctx.onRedo(), disabled: (ctx) => !ctx.canRedo },
  { id: "format-painter", label: (ctx) => (ctx.painterArmed ? "Format Painter (armed — click a cell)" : "Format Painter"), group: "actions", keywords: kw("copy formatting paint style"), run: (ctx) => ctx.onFormatPainterToggle() },
  { id: "clear-formatting", label: label("Clear Formatting"), group: "actions", keywords: kw("reset remove style"), run: (ctx) => ctx.onClearFormatting() },

  // ---- Font style ----
  { id: "bold", label: label("Bold"), group: "fontstyle", keywords: kw("text weight strong"), run: (ctx) => ctx.onSetCellStyle(toggleBoldPatch(ctx.activeStyle)) },
  { id: "italic", label: label("Italic"), group: "fontstyle", keywords: kw("text slant"), run: (ctx) => ctx.onSetCellStyle(toggleItalicPatch(ctx.activeStyle)) },
  { id: "underline", label: label("Underline"), group: "fontstyle", keywords: kw("text"), run: (ctx) => ctx.onSetCellStyle(toggleUnderlinePatch(ctx.activeStyle)) },
  { id: "strikethrough", label: label("Strikethrough"), group: "fontstyle", keywords: kw("text strike"), run: (ctx) => ctx.onSetCellStyle(toggleStrikePatch(ctx.activeStyle)) },

  // ---- Colour ----
  { id: "autocolor-toggle", label: (ctx) => (ctx.autoColor ? "Turn Off Automatic Cell Coloring" : "Turn On Automatic Cell Coloring"), group: "color", keywords: kw("color coding input formula link blue black green"), run: (ctx) => ctx.onAutoColorToggle() },

  // ---- Alignment ----
  { id: "align-left", label: label("Align Left"), group: "alignment", run: (ctx) => ctx.onSetCellStyle({ align: "left" }) },
  { id: "align-center", label: label("Align Center"), group: "alignment", run: (ctx) => ctx.onSetCellStyle({ align: "center" }) },
  { id: "align-right", label: label("Align Right"), group: "alignment", run: (ctx) => ctx.onSetCellStyle({ align: "right" }) },
  { id: "valign-top", label: label("Vertical Align Top"), group: "alignment", run: (ctx) => ctx.onSetCellStyle({ valign: "top" }) },
  { id: "valign-middle", label: label("Vertical Align Middle"), group: "alignment", run: (ctx) => ctx.onSetCellStyle({ valign: null }) },
  { id: "valign-bottom", label: label("Vertical Align Bottom"), group: "alignment", run: (ctx) => ctx.onSetCellStyle({ valign: "bottom" }) },
  { id: "wrap-text", label: label("Wrap Text"), group: "alignment", run: (ctx) => ctx.onSetCellStyle(toggleWrapPatch(ctx.activeStyle)) },
  { id: "indent-increase", label: label("Increase Indent"), group: "alignment", run: (ctx) => ctx.onAdjustIndent(1) },
  { id: "indent-decrease", label: label("Decrease Indent"), group: "alignment", run: (ctx) => ctx.onAdjustIndent(-1) },
  { id: "merge-toggle", label: (ctx) => (ctx.mergedHere ? "Unmerge Cells" : "Merge Cells"), group: "alignment", keywords: kw("combine cells"), run: (ctx) => ctx.onMergeToggle() },

  // ---- Number format ----
  ...NUMBER_FORMATS.map((f) => ({
    id: `numfmt-${f.id}`, label: `Number Format: ${f.label}`, group: "number", keywords: "format",
    run: (ctx) => ctx.onApplyFormat(f.token),
  })),
  { id: "percent-style", label: label("Percent Style"), group: "number", keywords: kw("% percentage"), run: (ctx) => ctx.onApplyFormat("0.0%") },
  { id: "currency-style", label: label("Currency Style"), group: "number", keywords: kw("$ dollar money"), run: (ctx) => ctx.onApplyFormat("$#,##0.00") },
  { id: "thousands-toggle", label: label("Toggle Thousands Separator"), group: "number", keywords: kw("comma"), run: (ctx) => ctx.onNumberFormatOp("toggleThousands") },
  { id: "decimal-increase", label: label("Increase Decimal"), group: "number", run: (ctx) => ctx.onNumberFormatOp("increaseDecimals") },
  { id: "decimal-decrease", label: label("Decrease Decimal"), group: "number", run: (ctx) => ctx.onNumberFormatOp("decreaseDecimals") },

  // ---- Borders (moved off the Home ribbon — reachable here and from the cell right-click menu) ----
  { id: "border-top", label: label("Top Border (subtotal row)"), group: "borders", run: (ctx) => ctx.onApplyBorder({ edges: ["top"], style: "thin", mode: "outline" }) },
  { id: "border-bottom-double", label: label("Bottom Border, double (total row)"), group: "borders", run: (ctx) => ctx.onApplyBorder({ edges: ["bottom"], style: "double", mode: "outline" }) },
  { id: "border-outline", label: label("Outline Border"), group: "borders", run: (ctx) => ctx.onApplyBorder({ edges: ["top", "right", "bottom", "left"], style: "thin", mode: "outline" }) },
  { id: "border-all", label: label("All Borders"), group: "borders", run: (ctx) => ctx.onApplyBorder({ edges: ["top", "right", "bottom", "left"], style: "thin", mode: "all" }) },
  { id: "border-none", label: label("No Border"), group: "borders", run: (ctx) => ctx.onApplyBorder({ edges: ["top", "right", "bottom", "left"], style: null, mode: "all" }) },

  // ---- Cells ----
  { id: "insert-row", label: label("Insert Row Above"), group: "cells", run: (ctx) => ctx.onInsertRow() },
  { id: "insert-column", label: label("Insert Column Left"), group: "cells", run: (ctx) => ctx.onInsertColumn() },
  { id: "delete-row", label: label("Delete Row"), group: "cells", run: (ctx) => ctx.onDeleteRow() },
  { id: "delete-column", label: label("Delete Column"), group: "cells", disabled: (ctx) => !ctx.canDeleteColumn, run: (ctx) => ctx.onDeleteColumn() },
  { id: "freeze-top-row", label: label("Freeze Top Row"), group: "cells", keywords: kw("pin lock panes"), run: (ctx) => ctx.onSetFreezeTopRow() },
  { id: "freeze-first-column", label: label("Freeze First Column"), group: "cells", keywords: kw("pin lock panes"), run: (ctx) => ctx.onSetFreezeFirstColumn() },
  { id: "freeze-at-selection", label: label("Freeze Panes (at selection)"), group: "cells", keywords: kw("pin lock"), run: (ctx) => ctx.onSetFreezeAtSelection() },
  { id: "unfreeze", label: label("Unfreeze Panes"), group: "cells", disabled: (ctx) => !(ctx.freezeRows > 0 || ctx.freezeCols > 0), run: (ctx) => ctx.onUnfreeze() },

  // ---- Names ----
  { id: "name-manager", label: label("Name Manager"), group: "names", keywords: kw("named range define rename jump"), run: (ctx) => ctx.onToggleNameManager() },

  // ---- Formula Auditing (the module's own differentiators — permanently visible in row 1,
  // never buried behind an overflow, AND reachable here) ----
  { id: "trace-precedents", label: label("Trace Precedents"), group: "audit", keywords: kw("formula dependency audit feeds"), run: (ctx) => ctx.onTracePrecedents() },
  { id: "trace-dependents", label: label("Trace Dependents"), group: "audit", keywords: kw("formula dependency audit"), run: (ctx) => ctx.onTraceDependents() },
  { id: "trace-remove-arrows", label: label("Remove Arrows"), group: "audit", disabled: (ctx) => !ctx.traceMode, run: (ctx) => ctx.onClearTrace() },
  { id: "show-inconsistencies", label: label("Show Inconsistent Formulas"), group: "audit", keywords: kw("flag warning audit"), run: (ctx) => ctx.onToggleInconsistencyPanel() },

  // ---- Sort & Filter ----
  { id: "sort-asc", label: label("Sort A to Z"), group: "sortfilter", run: (ctx) => ctx.onSort("asc") },
  { id: "sort-desc", label: label("Sort Z to A"), group: "sortfilter", run: (ctx) => ctx.onSort("desc") },
  { id: "filter-toggle", label: (ctx) => (ctx.filterOn ? "Turn Off AutoFilter" : "Turn On AutoFilter"), group: "sortfilter", run: (ctx) => ctx.onFilterToggle() },

  // ---- Find & Replace (opens the SAME bar Ctrl+F/Ctrl+H already open — never a second search) ----
  { id: "find", label: label("Find"), group: "find", shortcut: "Ctrl+F", run: (ctx) => ctx.onOpenFind() },
  { id: "replace", label: label("Replace"), group: "find", shortcut: "Ctrl+H", run: (ctx) => ctx.onOpenReplace() },

  // ---- Sheet ----
  { id: "sheet-add", label: label("Add Sheet"), group: "sheet", run: (ctx) => ctx.onAddSheetTab() },
  { id: "sheet-duplicate", label: label("Duplicate Sheet"), group: "sheet", run: (ctx) => ctx.onDuplicateSheetCurrent() },
  { id: "sheet-rename", label: label("Rename Sheet"), group: "sheet", run: (ctx) => ctx.onRenameSheetCurrent() },
  { id: "sheet-delete", label: label("Delete Sheet"), group: "sheet", disabled: (ctx) => ctx.sheetCount <= 1, run: (ctx) => ctx.onDeleteSheetCurrent() },

  // ---- Import & Export ----
  { id: "export-xlsx", label: label("Export to Excel (.xlsx)"), group: "file", keywords: kw("download save"), run: (ctx) => ctx.onExportXlsx() },
  { id: "export-csv", label: label("Export Active Sheet to CSV"), group: "file", keywords: kw("download save"), run: (ctx) => ctx.onExportCsv() },
  { id: "import-xlsx", label: label("Import Excel File"), group: "file", keywords: kw("upload open xlsx"), run: (ctx) => ctx.onOpenImportXlsx() },
  { id: "import-csv", label: label("Import CSV File"), group: "file", keywords: kw("upload open"), run: (ctx) => ctx.onOpenImportCsv() },

  // ---- Excel shortcuts block (2026-10-29): every chord in lib/keymap.js and every leaf in
  // lib/keyTips.js names one of these ids, so a key, a key-tip sequence, the palette and the ribbon
  // all call the SAME ctx handler. ----
  { id: "number-comma-style", label: label("Number with Commas"), group: "number", keywords: kw("thousands 1,000.00"), run: (ctx) => ctx.onApplyFormat("#,##0.00") },
  { id: "number-format-dialog", label: label("Number Format…"), group: "number", keywords: kw("format cells dialog custom"), run: (ctx) => ctx.onOpenDialog("number-format") },
  { id: "border-thick-box", label: label("Thick Box Border"), group: "borders", run: (ctx) => ctx.onApplyBorder({ edges: ["top", "right", "bottom", "left"], style: "thick", mode: "outline" }) },
  { id: "fill-color-menu", label: label("Fill Colour…"), group: "color", keywords: kw("background paint"), run: (ctx) => ctx.onOpenColorMenu("fill") },
  { id: "font-color-menu", label: label("Font Colour…"), group: "color", keywords: kw("text"), run: (ctx) => ctx.onOpenColorMenu("font") },
  { id: "merge-cells", label: label("Merge Cells"), group: "alignment", disabled: (ctx) => !!ctx.mergedHere, run: (ctx) => ctx.onMergeToggle() },
  { id: "merge-center", label: label("Merge & Center"), group: "alignment", run: (ctx) => ctx.onMergeCenter() },
  { id: "unmerge-cells", label: label("Unmerge Cells"), group: "alignment", disabled: (ctx) => !ctx.mergedHere, run: (ctx) => ctx.onMergeToggle() },
  { id: "freeze-toggle", label: (ctx) => ((ctx.freezeRows > 0 || ctx.freezeCols > 0) ? "Unfreeze Panes" : "Freeze Panes"), group: "cells", keywords: kw("pin lock"), run: (ctx) => ((ctx.freezeRows > 0 || ctx.freezeCols > 0) ? ctx.onUnfreeze() : ctx.onSetFreezeAtSelection()) },
  { id: "copy", label: label("Copy"), group: "edit", shortcut: "Ctrl+C", run: (ctx) => ctx.onClipboardCommand("copy") },
  { id: "cut", label: label("Cut"), group: "edit", shortcut: "Ctrl+X", keywords: kw("move"), run: (ctx) => ctx.onClipboardCommand("cut") },
  { id: "paste", label: label("Paste"), group: "edit", shortcut: "Ctrl+V", run: (ctx) => ctx.onClipboardCommand("paste") },
  { id: "cancel-cut", label: label("Cancel Cut"), group: "edit", run: (ctx) => ctx.onCancelCut() },
  { id: "fill-right", label: label("Fill Right"), group: "edit", keywords: kw("copy left cell across"), run: (ctx) => ctx.onFillRight() },
  { id: "insert-date", label: label("Insert Current Date"), group: "edit", run: (ctx) => ctx.onInsertDate() },
  { id: "insert-time", label: label("Insert Current Time"), group: "edit", run: (ctx) => ctx.onInsertTime() },
  { id: "copy-above-formula", label: label("Copy Formula from Cell Above"), group: "edit", run: (ctx) => ctx.onCopyAbove("formula") },
  { id: "copy-above-value", label: label("Copy Value from Cell Above"), group: "edit", run: (ctx) => ctx.onCopyAbove("value") },
  { id: "autosum", label: label("AutoSum"), group: "edit", keywords: kw("total add sum"), run: (ctx) => ctx.onAutoSum() },
  { id: "repeat-last", label: label("Repeat Last Action"), group: "edit", run: (ctx) => ctx.onRepeatLast() },
  { id: "clear-all", label: label("Clear All"), group: "edit", keywords: kw("contents formats"), run: (ctx) => ctx.onClearAll() },
  { id: "clear-contents", label: label("Clear Contents"), group: "edit", keywords: kw("delete blank"), run: (ctx) => ctx.onClearContents() },
  { id: "insert-cells", label: label("Insert…"), group: "structure", keywords: kw("row column cells"), run: (ctx) => ctx.onInsertCells() },
  { id: "delete-cells", label: label("Delete…"), group: "structure", keywords: kw("row column cells"), run: (ctx) => ctx.onDeleteCells() },
  { id: "hide-rows", label: label("Hide Rows"), group: "structure", run: (ctx) => ctx.onHide("rows") },
  { id: "unhide-rows", label: label("Unhide Rows"), group: "structure", run: (ctx) => ctx.onUnhide("rows") },
  { id: "hide-columns", label: label("Hide Columns"), group: "structure", run: (ctx) => ctx.onHide("columns") },
  { id: "unhide-columns", label: label("Unhide Columns"), group: "structure", run: (ctx) => ctx.onUnhide("columns") },
  { id: "autofit-column", label: label("Autofit Column Width"), group: "structure", keywords: kw("fit widest"), run: (ctx) => ctx.onAutofit("columns") },
  { id: "autofit-row", label: label("Autofit Row Height"), group: "structure", keywords: kw("fit wrap"), run: (ctx) => ctx.onAutofit("rows") },
  { id: "column-width", label: label("Column Width…"), group: "structure", run: (ctx) => ctx.onOpenDialog("column-width") },
  { id: "row-height", label: label("Row Height…"), group: "structure", run: (ctx) => ctx.onOpenDialog("row-height") },
  { id: "sheet-prev", label: label("Previous Sheet"), group: "sheet", keywords: kw("tab"), disabled: (ctx) => ctx.sheetCount <= 1, run: (ctx) => ctx.onSheetStep(-1) },
  { id: "sheet-next", label: label("Next Sheet"), group: "sheet", keywords: kw("tab"), disabled: (ctx) => ctx.sheetCount <= 1, run: (ctx) => ctx.onSheetStep(1) },
  { id: "save-now", label: label("Save Now"), group: "file", keywords: kw("saved state"), run: (ctx) => ctx.onSaveNow() },

  // ---- View & Zoom ----
  { id: "zoom-in", label: label("Zoom In"), group: "view", keywords: kw("magnify bigger"), disabled: (ctx) => ctx.zoom >= MAX_ZOOM, run: (ctx) => ctx.onZoomChange(zoomStepButton(ctx.zoom, 1)) },
  { id: "zoom-out", label: label("Zoom Out"), group: "view", keywords: kw("magnify smaller"), disabled: (ctx) => ctx.zoom <= MIN_ZOOM, run: (ctx) => ctx.onZoomChange(zoomStepButton(ctx.zoom, -1)) },
  { id: "zoom-reset", label: label("Reset Zoom to 100%"), group: "view", run: (ctx) => ctx.onZoomChange(DEFAULT_ZOOM) },
];

// The chord text beside a command (palette + help) comes from the ONE key table, never typed twice.
{
  const chordLabel = Object.fromEntries(CHORDS.map(([id, combo]) => [id, combo]));
  for (const cmd of COMMANDS) if (!cmd.shortcut && chordLabel[cmd.id]) cmd.shortcut = chordLabel[cmd.id];
}

/** Run a command by id against `ctx`. Returns whether it ran (false: unknown id or disabled). */
export function runCommandById(id, ctx) {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd || isCommandDisabled(cmd, ctx)) return false;
  cmd.run(ctx);
  return true;
}

export function resolveLabel(cmd, ctx) {
  return typeof cmd.label === "function" ? cmd.label(ctx) : cmd.label;
}
export function isCommandDisabled(cmd, ctx) {
  return typeof cmd.disabled === "function" ? !!cmd.disabled(ctx) : !!cmd.disabled;
}

const WORD_BREAK = /[\s/\-_.,:;()[\]]/;

/** Fuzzy SUBSEQUENCE score (Notes' own `notesQuickOpen.js` establishes this shape in this repo —
 *  every query character must appear in order; where it lands decides the score). A word-start
 *  hit and a consecutive run both score far higher than a scatter, so `tp` reaches "Trace
 *  Precedents" ahead of anything merely containing a `t` and a `p`. `null` = no match at all —
 *  never a zero-scored row padding out the list. */
export function fuzzyScore(text, query) {
  const hay = String(text || "");
  const q = String(query || "").trim().toLowerCase();
  if (!q) return 0;
  if (!hay) return null;
  const lowHay = hay.toLowerCase();
  let score = 0, at = 0, run = 0;
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];
    if (ch === " ") { run = 0; continue; }
    const found = lowHay.indexOf(ch, at);
    if (found < 0) return null;
    const atStart = found === 0 || WORD_BREAK.test(hay[found - 1]);
    const consecutive = found === at && i > 0;
    run = consecutive ? run + 1 : 0;
    score += 1;
    if (atStart) score += 8;
    if (consecutive) score += 4 + run;
    score -= Math.min(6, found - at) * 0.5;
    at = found + 1;
  }
  return score;
}

/** Search the full command list. Empty query returns everything (group order, then label) — the
 *  "browse every action" case the brief asks for when the palette first opens. A non-empty query
 *  matches a command's LABEL, its `keywords`, or its GROUP name (so typing "audit" finds every
 *  Formula Auditing command), scored by the BEST of the three, sorted best first. Each result
 *  carries its resolved `label` (`resolveLabel` already applied) and `disabled` — the palette UI
 *  never has to know how either is computed. */
export function searchCommands(commands, query, ctx) {
  const q = String(query || "").trim();
  const rows = commands.map((cmd) => {
    const resolved = resolveLabel(cmd, ctx);
    const disabled = isCommandDisabled(cmd, ctx);
    if (!q) return { cmd, label: resolved, disabled, score: 0 };
    const scores = [fuzzyScore(resolved, q), fuzzyScore(cmd.keywords || "", q), fuzzyScore(COMMAND_GROUPS[cmd.group] || "", q)];
    const best = scores.filter((s) => s !== null);
    return { cmd, label: resolved, disabled, score: best.length ? Math.max(...best) : null };
  }).filter((r) => r.score !== null);
  rows.sort((a, b) => (b.score - a.score) || a.label.localeCompare(b.label));
  return rows.map((r) => ({ id: r.cmd.id, group: r.cmd.group, shortcut: r.cmd.shortcut, label: r.label, disabled: r.disabled, run: r.cmd.run }));
}
