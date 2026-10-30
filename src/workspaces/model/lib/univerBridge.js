/* Model workspace — the Univer bridge (spike, owner-only; docs/SPREADSHEET-UNIVER-SPIKE.md).
 *
 * Pure and DOM-free: converts Planyr's workbook blob (sheetModel.js `migrateWorkbook` shape) to Univer's
 * IWorkbookData and back. It imports NOTHING from @univerjs — the numeric codes below (alignment, border
 * style, wrap) are Univer's enum values copied as plain numbers, so this file loads in the unit tests and
 * never pulls the Univer chunk into any bundle.
 *
 * ⛔ THE CONTRACT, in one line: `univerToWorkbook(workbookToUniver(wb))` deep-equals `migrateWorkbook(wb)`
 * for every field the model stores (test/modelUniverBridge.test.js, against the real fixtures). Anything
 * Univer cannot express is not hidden — it rides in a SIDECAR (below) and, where the sidecar cannot keep
 * it either, is returned in `notes` so the caller can say so out loud (LOUD-FAILURE).
 *
 * THE SIDECAR. Univer has no place for several things Planyr stores, and `workbook.save()` only keeps data
 * a registered Univer plugin owns. So the host (UniverSheet.jsx) holds a `sidecar` next to the Univer
 * instance and hands it back on conversion:
 *   · per sheet `columns`   — the ordered column objects (stable ids, names, extra fields). Univer columns
 *                             are positions only; the id at position i is how `cells["c7:3"]` keeps meaning.
 *   · per sheet `nextColId`, `indent`, `rawText`, `synth`, `dismissedInconsistencies`, `unsupportedFormulas`.
 *   · workbook `nextSheetId` / `version`.
 * Every sidecar entry that is keyed by a cell is SELF-VALIDATING: it is applied on the way back only if
 * Univer's cell still means what the entry assumed (a literal's canonical text matches, a synthesised
 * pattern is still the pattern), so a sort or a drag that moved cells cannot make a stale entry lie.
 *
 * ⛔ WHAT IS GENUINELY LOSSY (listed in docs/SPREADSHEET-UNIVER-SPIKE.md, never silently dropped):
 *   · indent — Univer's cell model has no indent; Planyr's value is carried in the sidecar but not drawn.
 *   · vertical merges and any Univer-only feature (data validation, conditional formats, notes) — Planyr
 *     stores horizontal merges only, so a vertical merge is reported in `notes`, not saved.
 *   · `[Column]` same-row formulas and any Planyr-only function — Univer cannot evaluate them.
 *   · typed date TEXT ("1/15/2027") is text to Univer (Planyr types it as a date).
 *   · rich text inside a cell collapses to its plain text. */
import { colLetterName, DEFAULT_ROW_H, migrateWorkbook } from "./sheetModel.js";

export const BRIDGE_VERSION = 1;
/** Resource-id prefix of the defined names the bridge adds for Site.* / Plan.* / Comp.* — never saved back. */
export const PROJECT_NAME_ID_PREFIX = "planyr-proj:";
export const PLANYR_NAME_ID_PREFIX = "planyr-name:";
const DEFINED_NAME_RESOURCE = "SHEET_DEFINED_NAME_PLUGIN";

// Univer enum values (core/types/enum), as plain numbers.
const HT = { left: 1, center: 2, right: 3 };
const VT = { top: 1, middle: 2, bottom: 3 };
const WRAP_ON = 3;
const BORDER = { thin: 1, double: 7 };
const BORDER_BACK = { 1: "thin", 7: "double" };
const T_STRING = 1, T_NUMBER = 2, T_BOOL = 3;
const BORDER_COLOR = "#000000";

const MAPPED_STYLE_KEYS = new Set(["bold", "italic", "underline", "strike", "fontFamily", "fontSize", "color", "fill", "align", "valign", "wrap", "border"]);
/** Does the remembered raw text still mean what Univer's cell holds? (A stale sidecar entry must never win.) */
function sameLiteral(kept, cell, canon) {
  const typed = typeLiteral(kept);
  if (typed.kind === "number") return typeof cell.v === "number" && cell.v === typed.value;
  if (typed.kind === "bool") return canon === (typed.value ? "TRUE" : "FALSE") && (cell.t === T_BOOL || typeof cell.v === "boolean");
  return kept === canon;
}

const HT_BACK = { 1: "left", 2: "center", 3: "right" };
const VT_BACK = { 1: "top", 2: "middle", 3: "bottom" };

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const isFormulaText = (t) => String(t ?? "").trim().startsWith("=");
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** The text a Univer number/bool/string cell reads back as, in Planyr's raw-text storage. */
export function canonicalRaw(v, t) {
  if (t === T_BOOL || typeof v === "boolean") return (v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true") ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return v == null ? "" : String(v);
}

/** What Planyr's own `literalTypedValue` makes of a raw literal, without importing the engine:
 *  { kind: "number"|"bool"|"text", value }. Mirrors it for numbers (`$`, `,`, `%`) and booleans. */
export function typeLiteral(raw) {
  const s = String(raw ?? "").trim();
  if (/^(true|false)$/i.test(s)) return { kind: "bool", value: s.toLowerCase() === "true" };
  let t = s, pct = false;
  if (t.endsWith("%")) { pct = true; t = t.slice(0, -1).trim(); }
  t = t.replace(/^\$\s*/, "").replace(/,/g, "");
  if (t !== "" && /^-?(\d+(\.\d+)?|\.\d+)$/.test(t) && Number.isFinite(Number(t))) {
    const n = Number(t);
    return { kind: "number", value: pct ? n / 100 : n };
  }
  return { kind: "text", value: String(raw) };
}

/** The display pattern that makes Univer SHOW a typed literal the way Planyr shows it ("25%", "$1,200",
 *  "1,200"). Planyr keeps the typed text and formats on read; Univer keeps a number and formats by pattern, so
 *  the bridge synthesises the pattern and remembers it (`synth`) so it is never saved back as a user format. */
export function inferLiteralPattern(raw) {
  const s = String(raw ?? "").trim();
  const dec = (t) => { const m = /\.(\d+)/.exec(t); return m ? m[1].length : 0; };
  if (/^-?[\d,]*\.?\d*\s*%$/.test(s) && /\d/.test(s)) { const d = dec(s); return d ? `0.${"0".repeat(d)}%` : "0%"; }
  if (/^-?\$\s*[\d,]*\.?\d*$/.test(s) && /\d/.test(s)) { const d = dec(s); return d ? `$#,##0.${"0".repeat(d)}` : "$#,##0"; }
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) { const d = dec(s); return d ? `#,##0.${"0".repeat(d)}` : "#,##0"; }
  return null;
}

const quoteSheet = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${String(name).replace(/'/g, "''")}'`);
const abs = (r, c) => `$${colLetterName(c)}$${r}`;
/** 1-based rect → "'Sheet 1'!$A$1:$B$2" (a single cell collapses to "$A$1"). */
export function rectToRefString(sheetName, rect) {
  const a = abs(rect.r1, rect.c1 - 1), b = abs(rect.r2, rect.c2 - 1);
  return `${quoteSheet(sheetName)}!${a === b ? a : `${a}:${b}`}`;
}
function colIndexFromLetters(s) { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
/** "Sheet1!$A$1:$B$2" / "'My Sheet'!A1" → 1-based rect, or null when it is not a plain rectangle reference. */
export function refStringToRect(ref) {
  const m = /^(?:'(?:[^']|'')+'|[^!]+)!\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(String(ref).trim());
  if (!m) return null;
  const c1 = colIndexFromLetters(m[1]), r1 = Number(m[2]);
  const c2 = m[3] ? colIndexFromLetters(m[3]) : c1, r2 = m[4] ? Number(m[4]) : r1;
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}

function styleToUniver(style) {
  const s = {};
  if (style.bold) s.bl = 1;
  if (style.italic) s.it = 1;
  if (style.underline) s.ul = { s: 1 };
  if (style.strike) s.st = { s: 1 };
  if (style.fontFamily) s.ff = style.fontFamily;
  if (style.fontSize != null) s.fs = style.fontSize;
  if (style.color) s.cl = { rgb: style.color };
  if (style.fill) s.bg = { rgb: style.fill };
  if (style.align && HT[style.align]) s.ht = HT[style.align];
  if (style.valign && VT[style.valign]) s.vt = VT[style.valign];
  if (style.wrap) s.tb = WRAP_ON;
  if (isObj(style.border)) {
    const bd = {};
    for (const [edge, k] of [["top", "t"], ["right", "r"], ["bottom", "b"], ["left", "l"]]) {
      const kind = style.border[edge];
      if (kind && BORDER[kind]) bd[k] = { s: BORDER[kind], cl: { rgb: BORDER_COLOR } };
    }
    if (Object.keys(bd).length) s.bd = bd;
  }
  return s;
}

/** Univer style → the Planyr fields it expresses (`indent` and unknown fields are re-attached from the sidecar). */
function styleFromUniver(s) {
  const out = {};
  if (!s) return out;
  if (s.bl === 1) out.bold = true;
  if (s.it === 1) out.italic = true;
  if (s.ul && s.ul.s === 1) out.underline = true;
  if (s.st && s.st.s === 1) out.strike = true;
  if (s.ff) out.fontFamily = s.ff;
  if (s.fs != null) out.fontSize = s.fs;
  if (s.cl && s.cl.rgb) out.color = s.cl.rgb;
  if (s.bg && s.bg.rgb) out.fill = s.bg.rgb;
  if (HT_BACK[s.ht]) out.align = HT_BACK[s.ht];
  if (VT_BACK[s.vt]) out.valign = VT_BACK[s.vt];
  if (s.tb === WRAP_ON) out.wrap = true;
  if (isObj(s.bd)) {
    const border = {};
    for (const [edge, k] of [["top", "t"], ["right", "r"], ["bottom", "b"], ["left", "l"]]) {
      const b = s.bd[k];
      if (b && BORDER_BACK[b.s]) border[edge] = BORDER_BACK[b.s];
    }
    if (Object.keys(border).length) out.border = border;
  }
  return out;
}

/** A cell's text-value as Univer wants it, plus the synthesised display pattern (or null). */
function literalToUniverCell(raw) {
  const typed = typeLiteral(raw);
  if (typed.kind === "number") return { cell: { v: typed.value, t: T_NUMBER }, pattern: inferLiteralPattern(raw) };
  if (typed.kind === "bool") return { cell: { v: typed.value ? 1 : 0, t: T_BOOL }, pattern: null };
  return { cell: { v: String(raw), t: T_STRING }, pattern: null };
}

/**
 * Planyr workbook → { data, sidecar }. `data` is a Univer IWorkbookData; `sidecar` is what the host keeps and
 * passes back to `univerToWorkbook`.
 */
export function workbookToUniver(workbookIn, { name = "Planyr workbook", id = "planyr-wb" } = {}) {
  const workbook = migrateWorkbook(workbookIn);
  const styles = {};
  const styleIds = new Map();
  const styleId = (u) => {
    const k = JSON.stringify(u);
    if (!styleIds.has(k)) { const sid = `s${styleIds.size + 1}`; styleIds.set(k, sid); styles[sid] = u; }
    return styleIds.get(k);
  };
  const sheets = {};
  const sheetOrder = [];
  const definedNames = {};
  const sidecar = { v: BRIDGE_VERSION, nextSheetId: workbook.nextSheetId, sheets: {} };

  for (const entry of workbook.sheets) {
    const sh = entry.sheet;
    sheetOrder.push(entry.id);
    const colIndexById = new Map(sh.columns.map((c, i) => [c.id, i]));
    const sc = {
      columns: clone(sh.columns), nextColId: sh.nextColId, indent: {}, rawText: {}, synth: {},
      dismissedInconsistencies: clone(sh.dismissedInconsistencies), unsupportedFormulas: clone(sh.unsupportedFormulas),
      rowHeights: clone(sh.rowHeights), styleExtra: {},
    };
    const cellData = {};
    const put = (r, c) => { (cellData[r] || (cellData[r] = {}))[c] = cellData[r][c] || {}; return cellData[r][c]; };
    const keyRC = (key) => { const i = key.lastIndexOf(":"); return [Number(key.slice(i + 1)), colIndexById.get(key.slice(0, i))]; };

    for (const [key, raw] of Object.entries(sh.cells)) {
      const [r, c] = keyRC(key);
      if (c == null || raw == null || String(raw) === "") continue;
      const cell = put(r, c);
      if (isFormulaText(raw)) { cell.f = String(raw).trim(); if (String(raw).trim() !== String(raw)) sc.rawText[key] = String(raw); continue; }
      const { cell: lit, pattern } = literalToUniverCell(raw);
      Object.assign(cell, lit);
      if (canonicalRaw(lit.v, lit.t) !== String(raw)) sc.rawText[key] = String(raw);
      if (pattern && !sh.formats[key]) { cell._pattern = pattern; sc.synth[key] = pattern; }
    }
    // styles + number formats share one per-cell Univer style object
    const keys = new Set([...Object.keys(sh.styles), ...Object.keys(sh.formats)]);
    for (const key of keys) {
      const [r, c] = keyRC(key);
      if (c == null) continue;
      const cell = put(r, c);
      const u = sh.styles[key] ? styleToUniver(sh.styles[key]) : {};
      if (sh.styles[key]) {
        sc.styleExtra[key] = clone(sh.styles[key]);
        if (sh.styles[key].indent != null) sc.indent[key] = sh.styles[key].indent;
      }
      if (sh.formats[key]) u.n = { pattern: sh.formats[key] };
      else if (cell._pattern) u.n = { pattern: cell._pattern };
      if (Object.keys(u).length) cell.s = styleId(u);
      delete cell._pattern;
    }
    // synthesised patterns on cells with no explicit style/format
    for (const r of Object.keys(cellData)) for (const c of Object.keys(cellData[r])) {
      const cell = cellData[r][c];
      if (cell._pattern) { cell.s = styleId({ n: { pattern: cell._pattern } }); delete cell._pattern; }
    }

    const rowData = {};
    for (const [r, h] of Object.entries(sh.rowHeights)) rowData[r] = { ...(rowData[r] || {}), h, ia: 0 };
    for (const r of Object.keys(sh.hiddenRows)) if (sh.hiddenRows[r]) rowData[r] = { ...(rowData[r] || {}), hd: 1 };
    const columnData = {};
    sh.columns.forEach((col, i) => {
      const d = {};
      if (col.width != null && col.width !== 120) d.w = col.width;
      if (col.hidden) d.hd = 1;
      if (Object.keys(d).length) columnData[i] = d;
    });
    const mergeData = [];
    for (const m of sh.merges) {
      const a = colIndexById.get(m.c1Id), b = colIndexById.get(m.c2Id);
      if (a == null || b == null) continue;
      mergeData.push({ startRow: m.r, endRow: m.r, startColumn: Math.min(a, b), endColumn: Math.max(a, b) });
    }
    sheets[entry.id] = {
      id: entry.id, name: entry.name, tabColor: "", hidden: 0,
      freeze: { xSplit: sh.freezeCols, ySplit: sh.freezeRows, startRow: sh.freezeRows, startColumn: sh.freezeCols },
      rowCount: sh.rowCount, columnCount: sh.columns.length, zoomRatio: 1, scrollTop: 0, scrollLeft: 0,
      defaultColumnWidth: 120, defaultRowHeight: DEFAULT_ROW_H, mergeData, cellData, rowData, columnData,
      showGridlines: 1, rowHeader: { width: 46 }, columnHeader: { height: 20 }, rightToLeft: 0,
    };
    sidecar.sheets[entry.id] = sc;
    for (const nm of Object.values(sh.names || {})) {
      const nid = `${PLANYR_NAME_ID_PREFIX}${entry.id}:${nm.name.toLowerCase()}`;
      definedNames[nid] = { id: nid, name: nm.name, formulaOrRefString: rectToRefString(entry.name, nm), localSheetId: entry.id };
    }
  }
  const data = {
    id, name, appVersion: "1.3.1", locale: "enUS", styles, sheetOrder, sheets,
    resources: Object.keys(definedNames).length ? [{ name: DEFINED_NAME_RESOURCE, data: JSON.stringify(definedNames) }] : [],
  };
  return { data, sidecar };
}

/** Does a rich-text cell carry formatting that plain text cannot hold? Univer turns an ordinary edit of an existing cell
 *  into a one-paragraph rich-text cell whose only run is the default text colour — that is NOT rich text to a person. */
export function hasRichFormatting(p) {
  const body = (p && p.body) || {};
  const runs = Array.isArray(body.textRuns) ? body.textRuns : [];
  const styled = runs.some((r) => r && r.ts && Object.keys(r.ts).some((k) => !["cl", "bg"].includes(k)));
  const extras = ["customBlocks", "customDecorations", "customRanges", "tables"].some((k) => Array.isArray(body[k]) && body[k].length);
  return styled || extras;
}

/** Plain text of a rich-text cell (`p`). */
function richText(p) {
  const ds = p && p.body && typeof p.body.dataStream === "string" ? p.body.dataStream : "";
  return ds.replace(/\r\n?$/, "").replace(/\r\n|\r/g, "\n").replace(/\u0000/g, "");
}

/**
 * Univer IWorkbookData → { workbook, notes }.
 *   sidecar        — what `workbookToUniver` returned (kept current by the host across structural edits)
 *   activeSheetId  — Univer does not put the active tab in the snapshot; the host passes it
 *   formulaOf      — optional (sheetId, row, col) → formula text, for cells that carry only a shared-formula
 *                    id (`si`); the host answers from Univer's own formula model. Without it such a cell is
 *                    reported in `notes`.
 */
export function univerToWorkbook(data, { sidecar, activeSheetId, formulaOf } = {}) {
  const notes = [];
  const note = (n) => { if (!notes.includes(n)) notes.push(n); };
  const sc0 = sidecar || { sheets: {} };
  const resolveStyle = (s) => (typeof s === "string" ? (data.styles || {})[s] : s) || null;
  const sheets = [];

  for (const id of data.sheetOrder || Object.keys(data.sheets || {})) {
    const u = data.sheets[id];
    if (!u) continue;
    const sc = sc0.sheets[id] || { columns: [], nextColId: 0, indent: {}, rawText: {}, synth: {}, styleExtra: {}, rowHeights: {} };
    const colCount = Math.max(u.columnCount || 0, 1);
    // Column identity: position i keeps sidecar.columns[i]; a column the sidecar never saw gets the next id.
    let nextColId = sc.nextColId || (sc.columns.length + 1);
    const columns = [];
    for (let i = 0; i < colCount; i++) {
      const known = sc.columns[i];
      const base = known ? { ...known } : { id: `c${nextColId++}`, name: colLetterName(i), width: 120 };
      const cd = (u.columnData || {})[i] || {};
      base.width = cd.w != null ? cd.w : 120;
      if (cd.hd === 1) base.hidden = true; else delete base.hidden;
      columns.push(base);
    }
    const idAt = (i) => columns[i] && columns[i].id;

    const cells = {}, formats = {}, styles = {};
    for (const [rStr, rowObj] of Object.entries(u.cellData || {})) {
      const r = Number(rStr);
      for (const [cStr, cell] of Object.entries(rowObj || {})) {
        const c = Number(cStr);
        if (c >= colCount || !cell) continue;
        const key = `${idAt(c)}:${r}`;
        let formula = cell.f || null;
        if (!formula && cell.si && formulaOf) formula = formulaOf(id, r, c) || null;
        if (!formula && cell.si && !formulaOf) note("a copied formula (shared formula) was saved as its cached value");
        const kept = sc.rawText && sc.rawText[key];
        if (formula) {
          const norm = formula.startsWith("=") ? formula : `=${formula}`;
          cells[key] = kept != null && kept.trim() === norm ? kept : norm;
        } else if (cell.p && !(cell.v != null && cell.v !== "")) {
          const txt = richText(cell.p);
          if (txt !== "") { cells[key] = txt; if (hasRichFormatting(cell.p)) note("rich text inside a cell was saved as plain text"); }
        } else if (cell.v != null && cell.v !== "") {
          const canon = canonicalRaw(cell.v, cell.t);
          if (kept != null && sameLiteral(kept, cell, canon)) cells[key] = kept;
          else {
            cells[key] = canon;
            if (typeof cell.v === "string") {
              if (typeLiteral(canon).kind !== "text") note("text that looks like a number or TRUE/FALSE becomes a number in Planyr");
              else if (canon.trim().startsWith("=")) note("text beginning with = would be read as a formula by Planyr");
            }
          }
        }
        const us = resolveStyle(cell.s);
        if (us) {
          const st = styleFromUniver(us);
          const original = sc.styleExtra && sc.styleExtra[key];
          if (original) for (const k of Object.keys(original)) if (!MAPPED_STYLE_KEYS.has(k)) st[k] = original[k];
          if (Object.keys(st).length) styles[key] = st;
          const pat = us.n && us.n.pattern;
          if (pat && pat !== "General" && !(sc.synth && sc.synth[key] === pat)) formats[key] = pat;
        }
      }
    }
    // A cell whose whole style was fields Univer cannot draw (indent only) has no style in the snapshot.
    for (const [key, original] of Object.entries(sc.styleExtra || {})) {
      if (styles[key] || !Object.keys(original).every((k) => !MAPPED_STYLE_KEYS.has(k))) continue;
      if (columns.some((c) => c.id === key.slice(0, key.lastIndexOf(":")))) styles[key] = clone(original);
    }

    const rowHeights = {}, hiddenRows = {};
    for (const [rStr, rd] of Object.entries(u.rowData || {})) {
      if (rd.hd === 1) hiddenRows[rStr] = true;
      if (rd.h != null && rd.ia !== 1 && !(rd.h === u.defaultRowHeight && !(sc.rowHeights && rStr in sc.rowHeights))) rowHeights[rStr] = rd.h;
    }
    const merges = [];
    for (const m of u.mergeData || []) {
      if (m.startRow !== m.endRow) { note("a merge across several rows was not saved (Planyr stores horizontal merges only)"); continue; }
      if (m.startColumn === m.endColumn) continue;
      merges.push({ r: m.startRow, c1Id: idAt(m.startColumn), c2Id: idAt(m.endColumn) });
    }
    const names = {};
    const res = (data.resources || []).find((x) => x.name === DEFINED_NAME_RESOURCE);
    if (res) {
      let map = {};
      try { map = JSON.parse(res.data) || {}; } catch (_) { note("the defined-name table could not be read"); }
      for (const dn of Object.values(map)) {
        if (!dn || String(dn.id || "").startsWith(PROJECT_NAME_ID_PREFIX) || dn.localSheetId !== id) continue;
        const rect = refStringToRect(dn.formulaOrRefString);
        if (rect) names[dn.name.toLowerCase()] = { name: dn.name, ...rect };
        else note(`name "${dn.name}" is not a plain cell range, so it was not saved`);
      }
    }
    const keepIfSame = (map) => {
      const out = {};
      for (const key of Object.keys(map || {})) if (cells[key] !== undefined) out[key] = map[key];
      return out;
    };
    const dismissed = keepIfSame(sc.dismissedInconsistencies);
    const unsupported = {};
    for (const [key, txt] of Object.entries(sc.unsupportedFormulas || {})) if (cells[key] !== undefined) unsupported[key] = txt;
    const frz = u.freeze || {};
    sheets.push({
      id, name: u.name,
      sheet: {
        version: 1, nextColId, columns, rowCount: u.rowCount, cells, formats, styles, rowHeights, hiddenRows,
        freezeRows: frz.ySplit > 0 ? frz.ySplit : 0, freezeCols: frz.xSplit > 0 ? frz.xSplit : 0,
        merges, names, dismissedInconsistencies: dismissed, unsupportedFormulas: unsupported,
      },
    });
  }
  const active = sheets.some((s) => s.id === activeSheetId) ? activeSheetId : (sheets[0] && sheets[0].id);
  return {
    workbook: migrateWorkbook({ version: 1, nextSheetId: sc0.nextSheetId, sheets, activeSheetId: active }),
    notes,
  };
}

/** Keep the sidecar true to a structural edit made INSIDE Univer (column ids follow their column; row-keyed
 *  entries move with their row). `op` ∈ insert-col | remove-col | insert-row | remove-row. */
export function sidecarAfterStructure(sidecar, sheetId, { op, index, count = 1 }) {
  const sc = sidecar.sheets[sheetId];
  if (!sc) return sidecar;
  const next = { ...sc };
  if (op === "insert-col" || op === "remove-col") {
    const cols = [...sc.columns];
    if (op === "insert-col") {
      let n = sc.nextColId || cols.length + 1;
      const fresh = Array.from({ length: count }, (_, k) => ({ id: `c${n + k}`, name: colLetterName(index + k), width: 120 }));
      cols.splice(index, 0, ...fresh);
      next.nextColId = n + count;
    } else cols.splice(index, count);
    next.columns = cols;
  } else {
    const shiftKey = (k) => {
      const i = k.lastIndexOf(":"); const r = Number(k.slice(i + 1));
      if (op === "insert-row") return r >= index ? `${k.slice(0, i)}:${r + count}` : k;
      if (r >= index && r < index + count) return null;
      return r >= index + count ? `${k.slice(0, i)}:${r - count}` : k;
    };
    for (const f of ["indent", "rawText", "synth", "dismissedInconsistencies", "unsupportedFormulas", "styleExtra"]) {
      const out = {};
      for (const [k, v] of Object.entries(sc[f] || {})) { const nk = shiftKey(k); if (nk) out[nk] = v; }
      next[f] = out;
    }
    const rh = {};
    for (const [r, h] of Object.entries(sc.rowHeights || {})) {
      const n = Number(r);
      if (op === "insert-row") rh[n >= index ? n + count : n] = h;
      else if (n < index) rh[n] = h; else if (n >= index + count) rh[n - count] = h;
    }
    next.rowHeights = rh;
  }
  return { ...sidecar, sheets: { ...sidecar.sheets, [sheetId]: next } };
}

/** Site.* / Plan.* / Comp.* (lib/projectRefs.js `buildProjectNames`) → Univer defined names. A computed name
 *  is a constant formula; an error value becomes the matching error literal. `isDate` values carry a serial. */
export function projectNamesToDefinedNames(projectNames) {
  const out = {};
  for (const entry of Object.values(projectNames || {})) {
    if (!entry || !entry.name || !entry.computed) continue;
    const v = entry.value;
    let body;
    if (typeof v === "number" && Number.isFinite(v)) body = String(v);
    else if (typeof v === "boolean") body = v ? "TRUE" : "FALSE";
    else if (typeof v === "string") body = `"${v.replace(/"/g, '""')}"`;
    else if (v && v.k === "error") body = v.code || "#N/A";
    else if (v && typeof v === "object" && typeof v.serial === "number") body = String(v.serial);
    else body = "#N/A";
    const id = `${PROJECT_NAME_ID_PREFIX}${entry.name.toLowerCase()}`;
    out[id] = { id, name: entry.name, formulaOrRefString: `=${body}` };
  }
  return out;
}

/** True when two Planyr workbooks hold the same content (order-insensitive keys; see sheetModel.canonicalJson). */
export function sameWorkbook(a, b, canonicalJson) {
  return canonicalJson(migrateWorkbook(a)) === canonicalJson(migrateWorkbook(b));
}
