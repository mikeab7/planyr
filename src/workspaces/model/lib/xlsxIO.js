/* Model workspace — Excel round-trip (NEW-1, owner chat block). Real .xlsx export and import
 * for the whole workbook, built on ExcelJS (pinned exact `4.4.0` — see package.json; chosen over
 * SheetJS/`xlsx`, already a dependency here for an unrelated server-side read-only CSV-ish use in
 * functions/api/taxrates.js, because SheetJS's free "Community Edition" build does not WRITE cell
 * styles — no bold/italic/underline/fills/borders survive its own round trip without the paid
 * Pro tier — while ExcelJS writes and reads the full set natively: formulas as live formulas,
 * number formats, fonts, fills, borders, alignment, merged cells, column widths, row heights,
 * freeze panes, and workbook-level named ranges).
 *
 * This module is dynamically imported (see FileMenu.jsx / ModelApp.jsx) — ExcelJS never rides
 * the Model workspace's own eager chunk, so opening the Model tab never gets slower for someone
 * who never exports or imports.
 *
 * ⛔ SCOPE GUARD (owner, verbatim): no preset columns, no starting template, no scaffolded rows,
 * no real-estate opinion. This file moves the user's OWN cells/formulas/formatting in both
 * directions and invents no content of its own.
 *
 * FORMULA SUPPORT ON IMPORT — the whole point of `checkFormulaSupport`. This engine's formula
 * language (src/shared/formula/formula.js) is deliberately Excel-syntax-compatible for A1/range/
 * name/cross-sheet references, so an Excel formula transfers VERBATIM whenever every function it
 * calls is one this engine implements (`FUNCTION_NAMES`). A function this engine has never built
 * (INDIRECT is the standing example — genuinely common in real Excel models, and structurally
 * unlikely to ever be added here: this engine's dependency graph is built by statically walking a
 * formula's AST before evaluation, sheetEngine.js's `collectCellDeps` — a reference INDIRECT/
 * OFFSET compute at runtime from a STRING can't be seen by that walk, so it isn't merely
 * unimplemented today the way VLOOKUP/HLOOKUP briefly were before a concurrent session added them
 * mid-development — it can't be supported without a different dependency model entirely)
 * would otherwise silently become "=INDIRECT(...)" text that evaluates to a confident #NAME? — a
 * WRONG NUMBER THAT LOOKS RIGHT once the sheet recalculates, exactly the class this repo's rules
 * exist to prevent. So an unsupported cell keeps the FILE'S OWN CACHED VALUE as a plain literal
 * (nothing is silently dropped) and the original formula text is recorded in
 * `sheet.unsupportedFormulas` (sheetModel.js) so SheetView can mark the cell and a user can read
 * the original text on hover — never a silent flatten, never a crash on the whole import.
 */
import ExcelJS from "exceljs";
import {
  SHEET_VERSION, migrateWorkbook, migrateSheet, colLetterName, isFormulaText,
  formatAt, styleAt, cellKey,
} from "./sheetModel.js";
import { evaluateWorkbook, formulaSource, literalTypedValue } from "./sheetEngine.js";
import {
  parseFormula, FUNCTION_NAMES, parseRefText, colNumToLetters, isDate, isErrVal, serialToYMD,
} from "../../../shared/formula/formula.js";

const FUNCTION_NAME_SET = new Set(FUNCTION_NAMES);

/** Does this formula's AST call ONLY functions this engine implements? A "call" node's own
 *  `.name` is already upper-cased by the tokenizer/parser (formula.js), matching `FUNCTION_NAMES`
 *  verbatim. Mirrors the shape of namedRanges.js's `astHasCrossSheetRef` — one small recursive
 *  walk per concern, not a generic AST visitor this codebase doesn't otherwise have. */
function astUsesOnlyKnownFunctions(node) {
  if (!node || typeof node !== "object") return true;
  switch (node.type) {
    case "call":
      if (!FUNCTION_NAME_SET.has(node.name)) return false;
      return node.args.every(astUsesOnlyKnownFunctions);
    case "unary":
    case "percent":
      return astUsesOnlyKnownFunctions(node.arg);
    case "binary":
      return astUsesOnlyKnownFunctions(node.left) && astUsesOnlyKnownFunctions(node.right);
    default:
      return true; // num, str, bool, blankLiteral, errLiteral, ref, range, name, col — no call to check
  }
}

/** Whether an Excel-syntax formula (the text ExcelJS's `cell.formula` returns — no leading "=")
 *  can live as a real formula in this engine: it parses AND every function it calls is
 *  implemented. `_xlfn.`/`_xlws.` are Excel's own compatibility prefixes for functions newer than
 *  the legacy .xlsx function-name table (IFS, TEXTJOIN, MAXIFS, …) — stripped before parsing so a
 *  function THIS engine already supports isn't misjudged as unsupported over a prefix, not a
 *  syntax choice, this engine's own syntax carries no such prefix. Exported for the round-trip
 *  unit test to probe directly against a known-unimplemented function (INDIRECT). */
export function checkFormulaSupport(excelFormulaText) {
  const stripped = String(excelFormulaText || "").replace(/_xlfn\./gi, "").replace(/_xlws\./gi, "");
  const { ast, error } = parseFormula(stripped);
  return { supported: !error && astUsesOnlyKnownFunctions(ast), stripped };
}

/* ---- shared small helpers -------------------------------------------------------------- */

// Excel column width ≈ characters of the default font that fit; the common, good-enough
// conversion every spreadsheet tool uses absent the exact font metrics Excel itself has.
function pxToExcelWidth(px) { return Math.max(2, Math.round(((Number(px) || 120) - 5) / 7 * 100) / 100); }
function excelWidthToPx(w) { return Math.max(24, Math.round((Number(w) || 8.43) * 7 + 5)); }
// Row height: Excel stores POINTS, this app stores CSS px (96dpi) — 1pt = 4/3px.
function pxToPt(px) { return Math.round(Number(px) * 0.75 * 100) / 100; }
function ptToPx(pt) { return Math.max(14, Math.round(Number(pt) / 0.75)); }

function toARGB(hex) {
  const h = String(hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return "FF" + full.toUpperCase().padStart(6, "0").slice(-6);
}
function fromARGB(argb) {
  if (!argb || argb.length < 6) return null;
  return "#" + argb.slice(-6).toLowerCase();
}

function isoFromJsDateUTC(d) {
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const INVALID_SHEET_CHARS = /[:\\/?*[\]]/g;
/** A real .xlsx sheet name: <=31 chars, none of `: \ / ? * [ ]`, unique in the workbook
 *  (case-insensitive) — Excel's own three rules. `used` tracks lower-cased names already
 *  claimed in THIS export so a collision (rare — Planyr's own uniqueSheetName already keeps
 *  names distinct, but two names differing only past 31 chars, or only by a character Excel
 *  forbids, could still collide here) gets an Excel-style " (2)" suffix rather than a write
 *  error. */
function sanitizeExcelSheetName(name, used) {
  let base = String(name || "Sheet").replace(INVALID_SHEET_CHARS, " ").trim() || "Sheet";
  if (base.length > 31) base = base.slice(0, 31);
  let candidate = base, n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, Math.max(1, 31 - suffix.length)) + suffix;
    n++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/* ---- EXPORT ----------------------------------------------------------------------------- */

function toExcelScalar(v) {
  if (v == null || (typeof v === "object" && v.k === "blank")) return undefined;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (isDate(v)) { const { y, m, d } = serialToYMD(v.s); return new Date(Date.UTC(y, m - 1, d)); }
  if (isErrVal(v)) return { error: v.code };
  return String(v);
}

function firstFontFamily(stack) {
  const first = String(stack || "").split(",")[0].trim().replace(/^['"]|['"]$/g, "");
  return first || null;
}

/** Every field `styleAt` can carry (sheetModel.js's file header) mapped onto ExcelJS's own
 *  font/fill/alignment/border cell properties. An absent field is simply never set — ExcelJS
 *  (like this app) treats an unset property as "inherit the plain default." */
function applyCellStyle(cell, style) {
  if (!style) return;
  const font = {};
  if (style.bold) font.bold = true;
  if (style.italic) font.italic = true;
  if (style.underline) font.underline = true;
  if (style.strike) font.strike = true;
  if (style.fontFamily) { const fam = firstFontFamily(style.fontFamily); if (fam) font.name = fam; }
  if (style.fontSize) font.size = style.fontSize;
  if (style.color) font.color = { argb: toARGB(style.color) };
  if (Object.keys(font).length) cell.font = font;

  if (style.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: toARGB(style.fill) } };

  const alignment = {};
  if (style.align) alignment.horizontal = style.align;
  if (style.valign) alignment.vertical = style.valign;
  if (style.wrap) alignment.wrapText = true;
  if (style.indent) alignment.indent = style.indent;
  if (Object.keys(alignment).length) cell.alignment = alignment;

  if (style.border) {
    const border = {};
    for (const edge of ["top", "right", "bottom", "left"]) {
      const token = style.border[edge];
      if (token) border[edge] = { style: token === "double" ? "double" : "thin" };
    }
    if (Object.keys(border).length) cell.border = border;
  }
}

function rectToExcelRef(excelSheetName, rect) {
  const needsQuote = /[^A-Za-z0-9_]/.test(excelSheetName);
  const sheetPart = needsQuote ? `'${excelSheetName.replace(/'/g, "''")}'` : excelSheetName;
  const a1 = `$${colNumToLetters(rect.c1)}$${rect.r1}`;
  if (rect.r1 === rect.r2 && rect.c1 === rect.c2) return `${sheetPart}!${a1}`;
  return `${sheetPart}!${a1}:$${colNumToLetters(rect.c2)}$${rect.r2}`;
}

/** Every distinct "colId:rowIndex" key touched by content, a number format, or a style — the
 *  set this export actually WRITES, so a mostly-blank 1000×26 canvas doesn't cost 26,000
 *  ExcelJS cell objects. Merge-covered non-anchor cells are dropped separately (see below):
 *  Planyr never renders their own content once merged (sheetModel.js's `mergeRange` header),
 *  so exporting it would introduce data into the .xlsx that never appeared on screen. */
function collectWritableKeys(sheet) {
  const keys = new Set();
  for (const k of Object.keys(sheet.cells)) keys.add(k);
  for (const k of Object.keys(sheet.formats)) keys.add(k);
  for (const k of Object.keys(sheet.styles || {})) keys.add(k);
  const covered = new Set();
  for (const m of sheet.merges || []) {
    const i1 = sheet.columns.findIndex((c) => c.id === m.c1Id);
    const i2 = sheet.columns.findIndex((c) => c.id === m.c2Id);
    if (i1 < 0 || i2 < 0) continue;
    for (let i = i1 + 1; i <= i2; i++) covered.add(cellKey(sheet.columns[i].id, m.r));
  }
  for (const k of covered) keys.delete(k);
  return keys;
}

/** Export the whole workbook to a real .xlsx file — every sheet, formulas written as formulas
 *  (with the live-evaluated result cached alongside, so the file shows a real number even
 *  before Excel's own recalculation), number formats, styles, merges, column widths, row
 *  heights, freeze panes, and named ranges. Returns a Blob ready to hand to a download link. */
export async function exportWorkbookToXlsxBlob(workbook) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Planyr";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true; // a Planyr-computed cached value must never look stale

  const evalResult = evaluateWorkbook(workbook);
  const usedSheetNames = new Set();
  const excelNameById = new Map();
  for (const entry of workbook.sheets) excelNameById.set(entry.id, sanitizeExcelSheetName(entry.name, usedSheetNames));

  for (const entry of workbook.sheets) {
    const sheet = entry.sheet;
    const excelName = excelNameById.get(entry.id);
    const ws = wb.addWorksheet(excelName);
    const colIndexById = new Map(sheet.columns.map((c, i) => [c.id, i]));
    const evalForSheet = evalResult.get(entry.id);

    ws.columns = sheet.columns.map((c) => ({ width: pxToExcelWidth(c.width) }));
    for (let r = 0; r < sheet.rowCount; r++) {
      const h = sheet.rowHeights[r];
      if (h != null) ws.getRow(r + 1).height = pxToPt(h);
    }

    for (const key of collectWritableKeys(sheet)) {
      const sep = key.lastIndexOf(":");
      const colId = key.slice(0, sep), rowIndex = Number(key.slice(sep + 1));
      const colIndex = colIndexById.get(colId);
      if (colIndex == null) continue;
      const raw = sheet.cells[key];
      const wsCell = ws.getCell(rowIndex + 1, colIndex + 1);
      let valueIsDate = false;

      if (raw != null && isFormulaText(raw)) {
        const src = formulaSource(raw);
        const res = evalForSheet.get(rowIndex, colIndex);
        if (res && res.ok) {
          const result = toExcelScalar(res.value);
          wsCell.value = result === undefined ? { formula: src } : { formula: src, result };
          valueIsDate = isDate(res.value);
        } else {
          wsCell.value = { formula: src, result: { error: (res && res.error) || "#ERROR!" } };
        }
      } else if (raw != null && raw !== "") {
        const v = literalTypedValue(raw);
        const scalar = toExcelScalar(v);
        if (scalar !== undefined) wsCell.value = scalar;
        valueIsDate = isDate(v);
      }

      const format = formatAt(sheet, rowIndex, colIndex);
      if (format) wsCell.numFmt = format;
      else if (valueIsDate) wsCell.numFmt = "yyyy-mm-dd"; // matches this app's own no-format date display (serialToISO)

      applyCellStyle(wsCell, styleAt(sheet, rowIndex, colIndex));
    }

    for (const m of sheet.merges || []) {
      const c1 = colIndexById.get(m.c1Id), c2 = colIndexById.get(m.c2Id);
      if (c1 == null || c2 == null) continue;
      ws.mergeCells(m.r + 1, c1 + 1, m.r + 1, c2 + 1);
    }

    if (sheet.freezeRows > 0 || sheet.freezeCols > 0) {
      ws.views = [{ state: "frozen", xSplit: sheet.freezeCols, ySplit: sheet.freezeRows }];
    }

    // Named ranges — sheet.names is stored per-sheet (sheetModel.js's own header: conceptually
    // workbook-scoped, stored where the engine actually resolves it) but ExcelJS's defined-name
    // table is workbook-global; a name text collision across two DIFFERENT sheets (rare — the
    // Name Manager only guards uniqueness within one sheet's own table) means the LAST one
    // written wins in the file. A known, accepted limitation, not a data loss: every name still
    // resolves correctly INSIDE Planyr regardless.
    for (const nameEntry of Object.values(sheet.names || {})) {
      try { wb.definedNames.add(rectToExcelRef(excelName, nameEntry), nameEntry.name); } catch (_) { /* duplicate/invalid text — skip, not fatal */ }
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/* ---- IMPORT ----------------------------------------------------------------------------- */

function excelResultToLiteralText(result) {
  if (result == null) return null;
  if (result instanceof Date) return isoFromJsDateUTC(result);
  if (typeof result === "object" && "error" in result) return String(result.error);
  if (typeof result === "number") return String(result);
  if (typeof result === "boolean") return result ? "TRUE" : "FALSE";
  return String(result);
}

function excelPlainValueToLiteralText(value) {
  if (value == null) return null;
  if (value instanceof Date) return isoFromJsDateUTC(value);
  if (typeof value === "object") {
    if ("error" in value) return String(value.error);
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text || "").join("");
    if ("text" in value) return value.text == null ? null : String(value.text); // a hyperlink cell {text, hyperlink} — the link itself isn't modelled
    return null;
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

/** `cell.font`/`.fill`/`.alignment`/`.border` back into `styleAt`'s own shape (sheetModel.js's
 *  file header). ExcelJS reports a FULL default font object `{name:"Calibri", size:11,
 *  color:{theme:1}, …}` for a cell that was never explicitly styled at all (measured — see this
 *  module's own probe notes), so bold/italic/underline/strike are read by PRESENCE (absent on an
 *  unstyled cell), name/size only when they differ from that Calibri-11 default, and colour only
 *  when it carries an explicit `.argb` (a THEME colour — `.theme`, no `.argb` — is exactly what
 *  an unstyled cell's inherited default looks like, so it is never imported as an override). */
function excelStyleToPlanyrStyle(cell) {
  const style = {};
  const font = cell.font;
  if (font) {
    if (font.bold) style.bold = true;
    if (font.italic) style.italic = true;
    if (font.underline) style.underline = true;
    if (font.strike) style.strike = true;
    if (font.name && font.name !== "Calibri") style.fontFamily = font.name;
    if (font.size && font.size !== 11) style.fontSize = font.size;
    if (font.color && font.color.argb) { const c = fromARGB(font.color.argb); if (c) style.color = c; }
  }
  const fill = cell.fill;
  if (fill && fill.pattern === "solid" && fill.fgColor && fill.fgColor.argb) {
    const c = fromARGB(fill.fgColor.argb);
    if (c) style.fill = c;
  }
  const alignment = cell.alignment;
  if (alignment) {
    if (alignment.horizontal === "left" || alignment.horizontal === "center" || alignment.horizontal === "right") style.align = alignment.horizontal;
    if (alignment.vertical === "top" || alignment.vertical === "bottom") style.valign = alignment.vertical;
    if (alignment.wrapText) style.wrap = true;
    if (alignment.indent) style.indent = alignment.indent;
  }
  const border = cell.border;
  if (border) {
    const b = {};
    for (const edge of ["top", "right", "bottom", "left"]) {
      const e = border[edge];
      if (e && e.style) b[edge] = e.style === "double" ? "double" : "thin";
    }
    if (Object.keys(b).length) style.border = b;
  }
  return Object.keys(style).length ? style : null;
}

function parseA1Range(text) {
  const parts = String(text || "").split(":");
  const a1 = parseRefText(parts[0].replace(/\$/g, ""));
  if (!a1) return null;
  if (parts.length === 1) return { r1: a1.row, c1: a1.col, r2: a1.row, c2: a1.col };
  const a2 = parseRefText(parts[1].replace(/\$/g, ""));
  if (!a2) return null;
  return { r1: a1.row, c1: a1.col, r2: a2.row, c2: a2.col };
}

function parseSheetQualifiedRef(text) {
  const m = /^(?:'([^']+)'|([^'!]+))!(.+)$/.exec(String(text || "").trim());
  if (!m) return null;
  const range = parseA1Range(m[3]);
  if (!range) return null;
  return { sheetName: m[1] || m[2], ...range };
}

const NAME_SHAPE_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;
/** The same naming rules lib/namedRanges.js's `validateNameText` enforces at the UI boundary,
 *  applied here so an import can never write a name this engine's OWN formula parser would
 *  refuse to resolve as a name (a cell address, a function name, TRUE/FALSE, illegal characters)
 *  — an Excel workbook's `_xlnm.`-prefixed internal names (Print_Area, …) are filtered by the
 *  caller before this is even reached. */
function isValidPlanyrName(name) {
  const text = String(name || "").trim();
  if (!text || /^[0-9]/.test(text) || /\s/.test(text) || !NAME_SHAPE_RE.test(text)) return false;
  if (parseRefText(text)) return false;
  const upper = text.toUpperCase();
  return upper !== "TRUE" && upper !== "FALSE" && !FUNCTION_NAME_SET.has(upper);
}

/** A marker so the outer catch below can tell a message THIS module already wrote in plain
 *  English (safe to show verbatim) apart from whatever a dependency (ExcelJS, and beneath it
 *  JSZip) threw on its own — see `importXlsxToWorkbook`'s header for why that distinction matters. */
class XlsxImportError extends Error {}

async function readWorkbookFile(arrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  if (!wb.worksheets.length) throw new XlsxImportError("This Excel file has no worksheets.");

  const sheetNameToId = new Map();
  wb.worksheets.forEach((ws, i) => sheetNameToId.set(ws.name.trim().toLowerCase(), `sheet${i + 1}`));

  let unsupportedCount = 0;
  const rawSheets = wb.worksheets.map((ws, i) => {
    const id = `sheet${i + 1}`;
    const colCount = Math.max(1, ws.columnCount || 1);
    const columns = Array.from({ length: colCount }, (_, c) => ({ id: `c${c + 1}`, name: colLetterName(c), width: 120 }));
    const cells = {}, formats = {}, styles = {}, unsupportedFormulas = {};
    let maxRow = 0;

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.type === ExcelJS.ValueType.Merge) return; // a merge FOLLOWER — the anchor carries the real content
        const rIdx = rowNumber - 1, cIdx = colNumber - 1;
        if (cIdx >= columns.length) return;
        maxRow = Math.max(maxRow, rowNumber);
        const key = `${columns[cIdx].id}:${rIdx}`;

        if (cell.type === ExcelJS.ValueType.Formula) {
          const { supported, stripped } = checkFormulaSupport(cell.formula || "");
          if (supported) {
            cells[key] = "=" + stripped;
          } else {
            unsupportedCount++;
            unsupportedFormulas[key] = "=" + stripped;
            const text = excelResultToLiteralText(cell.result);
            if (text != null) cells[key] = text;
          }
        } else {
          const text = excelPlainValueToLiteralText(cell.value);
          if (text != null) cells[key] = text;
        }

        if (cell.numFmt) formats[key] = cell.numFmt;
        const style = excelStyleToPlanyrStyle(cell);
        if (style) styles[key] = style;
      });
    });

    const merges = [];
    for (const range of (ws.model && ws.model.merges) || []) {
      const parsed = parseA1Range(range);
      if (!parsed || parsed.r1 !== parsed.r2) continue; // vertical/block merges: content kept, visual merge dropped (sheetModel.js file header — B1007283)
      const c1 = parsed.c1 - 1, c2 = parsed.c2 - 1;
      if (c2 <= c1 || c1 >= columns.length || c2 >= columns.length) continue;
      merges.push({ r: parsed.r1 - 1, c1Id: columns[c1].id, c2Id: columns[c2].id });
    }

    for (let c = 0; c < columns.length; c++) {
      const w = ws.getColumn(c + 1).width;
      if (w != null) columns[c].width = excelWidthToPx(w);
    }
    const rowHeights = {};
    for (let r = 1; r <= maxRow; r++) {
      const h = ws.getRow(r).height;
      if (h != null) rowHeights[r - 1] = ptToPx(h);
    }

    let freezeRows = 0, freezeCols = 0;
    const view = Array.isArray(ws.views) ? ws.views.find((v) => v.state === "frozen") : null;
    if (view) { freezeRows = view.ySplit || 0; freezeCols = view.xSplit || 0; }

    const rawSheet = {
      version: SHEET_VERSION, nextColId: columns.length + 1, columns, rowCount: maxRow,
      cells, formats, styles, rowHeights, freezeRows, freezeCols, merges,
      names: {}, dismissedInconsistencies: {}, unsupportedFormulas,
    };
    return { id, name: ws.name || `Sheet${i + 1}`, sheet: migrateSheet(rawSheet) };
  });

  // Defined names — a second pass, once every sheet's id is known, so a name's own sheet
  // qualifier can resolve regardless of declaration order in the source file.
  const definedNames = (wb.definedNames && wb.definedNames.model) || [];
  for (const dn of definedNames) {
    if (!dn.name || /^_xlnm\./i.test(dn.name) || !isValidPlanyrName(dn.name)) continue;
    for (const rangeText of dn.ranges || []) {
      const parsed = parseSheetQualifiedRef(rangeText);
      if (!parsed) continue;
      const targetId = sheetNameToId.get(parsed.sheetName.trim().toLowerCase());
      const target = targetId && rawSheets.find((s) => s.id === targetId);
      if (!target) continue;
      const key = dn.name.trim().toLowerCase();
      target.sheet.names[key] = {
        name: dn.name.trim(),
        r1: Math.min(parsed.r1, parsed.r2), r2: Math.max(parsed.r1, parsed.r2),
        c1: Math.min(parsed.c1, parsed.c2), c2: Math.max(parsed.c1, parsed.c2),
      };
      break; // only the first area of a (rare) multi-area defined name
    }
  }

  const workbook = migrateWorkbook({ sheets: rawSheets, activeSheetId: rawSheets[0].id });
  return { workbook, unsupportedCount };
}

/** Parse an ArrayBuffer holding a real .xlsx file into a Planyr workbook. Every worksheet, in
 *  order; formulas stay formulas where every function they call is implemented (see
 *  `checkFormulaSupport`), otherwise the cell keeps the file's own cached VALUE and its original
 *  text lands in `unsupportedFormulas` (never dropped, never a whole-import failure). Returns
 *  `{ workbook, unsupportedCount }` so the caller can tell the user how many cells were kept as
 *  values (LOUD-FAILURE — never silent). Throws on a file ExcelJS can't parse at all, or on a
 *  file with zero worksheets — the caller surfaces that as a visible error.
 *
 *  ⛔ NEW-2 (owner chat block, 2026-09-05) — a file that isn't really a .xlsx (any non-zip bytes,
 *  a text file renamed .xlsx) used to reach the user as ExcelJS/JSZip's own developer-facing
 *  error VERBATIM: "Can't find end of central directory : is this a zip file ? If it is, see
 *  https://stuk.github.io/jszip/documentation/howto/read_zip.html" — a real-estate developer has
 *  no use for a link to JSZip's own docs. `readWorkbookFile` does the actual parse; anything it
 *  throws that ISN'T one of this module's own `XlsxImportError`s (i.e. anything that bubbled up
 *  from ExcelJS/JSZip itself) is logged to the console for a developer to read later and replaced
 *  here with one plain sentence — never concatenated into the message shown to the user. */
export async function importXlsxToWorkbook(arrayBuffer) {
  try {
    return await readWorkbookFile(arrayBuffer);
  } catch (e) {
    if (e instanceof XlsxImportError) throw e;
    console.error("xlsxIO: could not parse this file as an Excel workbook", e);
    throw new XlsxImportError("This doesn't look like a valid Excel file. Make sure it opens correctly in Excel, then try importing it again.");
  }
}
