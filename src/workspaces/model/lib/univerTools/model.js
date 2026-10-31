/* Model workspace — the Planyr-only Spreadsheet tools on the Univer grid: the PURE half (NEW-1, cutover step 6 of
 * docs/SPREADSHEET-UNIVER-SPIKE.md). Imports nothing from @univerjs, so it loads in the unit tests.
 *
 * ONE SET OF RULES, TWO GRIDS. Nothing here re-implements a tool. The old grid's pure libraries — `findInconsistencies`
 * (formulaConsistency.js), `beginOrStepTrace` / `renderableTrace` (traceAudit.js), `cellColorKind` (sheetEngine.js),
 * `validateNameText` / `namesList` / `nameUsageCount` (namedRanges.js) — are run unchanged on the Planyr workbook the BRIDGE
 * builds from Univer's live state (lib/univerBridge.js `univerToWorkbook`). So a flag, an arrow, a colour or a name means exactly
 * what it means on the old grid, and the saved workbook format (names per sheet, `dismissedInconsistencies`) is untouched.
 *
 * What this file adds is only the translation to a canvas: which cells get a marker, where an arrow starts and ends in sheet
 * coordinates, which name edit is which Univer defined-name call, and the key a dismissal is stored under. */
import { findInconsistencies } from "../formulaConsistency.js";
import { isInconsistencyDismissed } from "../sheetModel.js";
import { cellColorKind } from "../sheetEngine.js";
import { beginOrStepTrace, renderableTrace } from "../traceAudit.js";

// ---------------------------------------------------------------------------------------------------------------------------
// Consistency flags
// ---------------------------------------------------------------------------------------------------------------------------

/** The sheet entry `{ id, name, sheet }` a workbook holds for `sheetId` (or the first sheet), or null. */
export function entryOf(workbook, sheetId) {
  if (!workbook || !Array.isArray(workbook.sheets) || !workbook.sheets.length) return null;
  return workbook.sheets.find((s) => s.id === sheetId) || workbook.sheets[0];
}

/** The flags a person should SEE on one sheet: every inconsistency minus the ones dismissed ("the tool flags, the modeller
 *  decides"). Exactly what ModelApp computes for the old grid (`activeInconsistencies`). */
export function activeFlagsOf(sheet) {
  if (!sheet) return [];
  return findInconsistencies(sheet).filter((f) => !isInconsistencyDismissed(sheet, f.row, f.col));
}

/** "row:col" → flag, for the render-time lookup (one Map read per painted cell). */
export function flagLookup(flags) {
  const m = new Map();
  for (const f of flags || []) m.set(`${f.row}:${f.col}`, f);
  return m;
}

/** Cell-corner marker the flag is drawn with: a small triangle in the top-left corner (Excel's green-triangle position). The two
 *  kinds get two colours, the same pair the old grid's panel uses (`--warn-*` for a different pattern, `--danger` for a hardcoded
 *  value among formulas). `size` is Univer's marker triangle leg in px. */
export const FLAG_MARKER = Object.freeze({ size: 6, hardcoded: "#C2410C", "shape-mismatch": "#B45309" }); // design-exempt: Univer's canvas takes a colour STRING (no CSS var() on a canvas); it inverts it itself in dark mode
export function markerFor(flag) {
  if (!flag) return null;
  return { tl: { color: FLAG_MARKER[flag.kind] || FLAG_MARKER["shape-mismatch"], size: FLAG_MARKER.size } };
}

/** The key a dismissal is stored under in the bridge sidecar (`sidecar.sheets[sheetId].dismissedInconsistencies`) — the cell's
 *  STABLE column id plus its row, exactly as `sheetModel.setInconsistencyDismissed` keys it, so the saved workbook is byte-compatible.
 *  null when the column is unknown (a stale index must never write a key that points at nothing). */
export function dismissKey(sidecar, sheetId, row, col) {
  const sc = sidecar && sidecar.sheets && sidecar.sheets[sheetId];
  const column = sc && sc.columns && sc.columns[col];
  return column && column.id != null ? `${column.id}:${row}` : null;
}

/** A new sidecar with one dismissal set / cleared (never mutates the input). */
export function withDismissal(sidecar, sheetId, key, dismissed) {
  const sc = sidecar && sidecar.sheets && sidecar.sheets[sheetId];
  if (!sc || !key) return sidecar;
  const had = !!(sc.dismissedInconsistencies && sc.dismissedInconsistencies[key]);
  if (had === !!dismissed) return sidecar;
  const map = { ...(sc.dismissedInconsistencies || {}) };
  if (dismissed) map[key] = true; else delete map[key];
  return { ...sidecar, sheets: { ...sidecar.sheets, [sheetId]: { ...sc, dismissedInconsistencies: map } } };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Input / formula colour convention
// ---------------------------------------------------------------------------------------------------------------------------

/** Blue for a typed input, green for a formula that links to another sheet, nothing for an ordinary formula (it keeps the grid's
 *  text colour) — the old grid's convention (`SheetView` AUTO_COLOR_TOKEN: `--info-text` / `--success-text`). Concrete colours,
 *  because Univer's canvas takes a colour string; its dark mode inverts them through its own colour service, as it does any colour. */
export const AUTO_COLORS = Object.freeze({ input: "#1D4ED8", "cross-sheet": "#15803D" }); // design-exempt: canvas text colour string = the old grid's --info-text / --success-text, resolved (no var() on a canvas)

const KIND_CACHE = new Map();
/** "input" | "formula" | "cross-sheet" | null (empty) for one cell's raw text. Runs the OLD grid's `cellColorKind` on a one-cell
 *  stand-in sheet, so the rule has a single implementation; cached because it runs for every painted cell. */
export function colorKindOfRaw(raw, sheetName) {
  const text = raw == null ? "" : String(raw);
  if (text === "") return null;
  const key = `${sheetName}\u0000${text}`;
  const hit = KIND_CACHE.get(key);
  if (hit !== undefined) return hit;
  const kind = cellColorKind({ columns: [{ id: "x" }], cells: { "x:0": text } }, sheetName, 0, 0);
  if (KIND_CACHE.size > 20000) KIND_CACHE.clear();
  KIND_CACHE.set(key, kind);
  return kind;
}

/** The text colour to DRAW a cell with, or null to leave it alone. A colour the person set (`style.cl`) always wins, as on the old
 *  grid; an error value keeps the error colour; only an input or a cross-sheet link is recoloured. `raw` is the cell's typed text
 *  (a formula as `=...`, a literal as typed) — what the bridge calls the raw text. */
export function autoColorFor({ raw, hasManualColor, isError, sheetName }) {
  if (hasManualColor || isError) return null;
  const kind = colorKindOfRaw(raw, sheetName);
  return (kind && AUTO_COLORS[kind]) || null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Trace arrows
// ---------------------------------------------------------------------------------------------------------------------------

/** Start (or step one level further, on the same origin and mode) a trace for the active cell. Wraps traceAudit's one entry point. */
export function traceFor(existing, mode, sheetId, row, col, graph) {
  return beginOrStepTrace(existing, mode, sheetId, row, col, graph);
}
/** What to draw for the sheet on screen (arrows within it, markers for the edges that leave it). */
export function renderTrace(trace, graph, sheetId) {
  return renderableTrace(trace, graph, sheetId);
}

/** Where a line from `from` (a point) toward the centre of `rect` first crosses `rect`'s border — the arrow stops at the target
 *  cell's edge instead of its middle. */
export function edgePoint(from, rect) {
  const cx = (rect.x1 + rect.x2) / 2, cy = (rect.y1 + rect.y2) / 2;
  const dx = cx - from.x, dy = cy - from.y;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = (rect.x2 - rect.x1) / 2, hh = (rect.y2 - rect.y1) / 2;
  const t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  const u = Math.min(1, t);
  return { x: cx - dx * u, y: cy - dy * u };
}

/** Turn the renderable trace into canvas primitives in SHEET coordinates. `rectOf(row, col)` answers a cell's `{x1,y1,x2,y2}`.
 *   · each arrow → a line from the precedent (the centre of its cell or range) to the edge of the dependent cell, a dot at the start,
 *     an arrowhead at the end; a range source also gets a dashed outline (Excel draws the precedent range boxed).
 *   · each marker (an edge that leaves the sheet, or a project value) → a small label beside the cell that holds the reference.
 * Pure, so the geometry is unit-tested without a canvas. */
export function traceShapes(rendered, rectOf) {
  const out = { lines: [], boxes: [], dots: [], heads: [], labels: [] };
  if (!rendered) return out;
  for (const a of rendered.arrows || []) {
    const r1 = rectOf(a.fromRect.r1, a.fromRect.c1), r2 = rectOf(a.fromRect.r2, a.fromRect.c2), to = rectOf(a.toCell.row, a.toCell.col);
    if (!r1 || !r2 || !to) continue;
    const box = { x1: Math.min(r1.x1, r2.x1), y1: Math.min(r1.y1, r2.y1), x2: Math.max(r1.x2, r2.x2), y2: Math.max(r1.y2, r2.y2) };
    const isRange = a.fromRect.r1 !== a.fromRect.r2 || a.fromRect.c1 !== a.fromRect.c2;
    const start = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
    const end = edgePoint(start, to);
    if (isRange) out.boxes.push(box);
    out.dots.push(start);
    out.lines.push({ from: start, to: end });
    out.heads.push({ at: end, angle: Math.atan2(end.y - start.y, end.x - start.x) });
  }
  for (const m of rendered.markers || []) {
    const at = rectOf(m.atCell.row, m.atCell.col);
    if (!at) continue;
    const prefix = m.direction === "out" ? "→ " : "← ";
    out.labels.push({ x: at.x2, y: at.y1, text: `${prefix}${m.sourceLabel ? `${m.label} · ${m.sourceLabel}` : m.label}` });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------------------------------------

/** A Planyr name rect (1-based `{r1,c1,r2,c2}`) as the A1 reference string Univer's defined name holds: `'Sheet 1'!$B$2:$D$9`. */
export function colLetters(n) {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
export function refStringFor(sheetName, rect) {
  const q = /^[A-Za-z_][A-Za-z0-9_]*$/.test(sheetName) ? sheetName : `'${String(sheetName).replace(/'/g, "''")}'`;
  const a = `$${colLetters(rect.c1)}$${rect.r1}`;
  const b = `$${colLetters(rect.c2)}$${rect.r2}`;
  return `${q}!${a}${a === b ? "" : `:${b}`}`;
}
/** Univer's id for a name this tool adds — the same shape the bridge gives a name it loads (`planyr-name:<sheetId>:<lower>`), so a
 *  name added here and the same name after a reload are one id. */
export const nameIdFor = (sheetId, name) => `planyr-name:${sheetId}:${String(name).trim().toLowerCase()}`;
/** The arguments of Univer's SetDefinedNameCommand for a name local to one sheet. */
export function definedNameParams(unitId, sheetId, sheetName, name, rect) {
  return { unitId, id: nameIdFor(sheetId, name), name: String(name).trim(), formulaOrRefString: refStringFor(sheetName, rect), localSheetId: sheetId };
}
