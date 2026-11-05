/* Model workspace — the REAL clipboard (Ctrl+C / Ctrl+X / Ctrl+V), pure and DOM-free.
 *
 * ⛔ WHY THIS REPLACES THE INTERNAL CLIPBOARD (owner, 2026-10-29: "Ctrl C, V, and X don't really work
 * that well"). The first version kept a React ref and never touched the OS clipboard, on the theory
 * that the async Clipboard API needs permission prompts. That theory only holds for the async API:
 * the native copy / cut / paste EVENTS hand you `event.clipboardData` with no prompt at all. The ref
 * meant: paste from Excel did nothing (silently), copy never reached Excel/email/Notes, the copy
 * died on reload, only raw text travelled and not the look. This module is what the events carry.
 *
 * WHAT TRAVELS (all three written on copy/cut, in this order of fidelity on paste):
 *   1. text/html — a <table> with inline styles (bold, italic, underline, strike, colours, fill,
 *      alignment, borders, mso-number-format) so Excel/Outlook/Docs keep the look, AND a Planyr marker
 *      attribute carrying the JSON of raw text (formulas), styles, number formats, merges and the
 *      source row/column of every cell. Pasting our own HTML back reads the marker: formulas are
 *      relocated exactly as the old Ctrl+V did, and the look comes along.
 *   2. text/plain — tab-separated values, rows by newline, DISPLAYED values (what Excel writes).
 *   3. on paste only: an external HTML table (Excel, Google Sheets, Outlook, a web page) parsed here
 *      with a tiny tag tokenizer — no DOM, so it runs in the unit tests and in a worker alike.
 *
 * Every clip, whatever its source, becomes ONE shape — `{ cells: [[{ raw, style, format }]], merges,
 * srcRows?, srcCols?, hasLooks }` — and ONE function (`applyClip`) writes it, so "paste from Excel",
 * "paste from this sheet" and "paste a line of text" cannot disagree about tiling, fill-the-selection
 * or running past the last column.
 *
 * CUT is a MOVE (`pasteMove`): the source is emptied (contents, look, merges), and every formula
 * anywhere in the workbook that pointed INTO the block follows it (lib/formulaMove.js).
 */
import { rawAt, styleAt, formatAt, cellKey, ensureColumnCount, setCellLooks, removeMergesIn, clearCellRange, mergeRange, isFormulaText } from "./sheetModel.js";
import { relocateText } from "./sheetOps.js";
import { rewriteFormulaForMove } from "./formulaMove.js";

export const CLIP_MARK = "data-planyr-clip";

const nonEmptyStyle = (s) => (s && Object.keys(s).length ? JSON.parse(JSON.stringify(s)) : null);
let clipSeq = 0;
const newClipId = () => `clip-${Date.now().toString(36)}-${(clipSeq++).toString(36)}`;

// ───────────────────────────── build (copy / cut) ─────────────────────────────

/** Snapshot the selection. Hidden rows (manual or filtered) and hidden columns are SKIPPED — Excel
 *  copies visible cells only — so the clip's rows are `srcRows`, not necessarily contiguous. */
export function buildClip(sheet, sel, { hiddenRows = null } = {}) {
  const r1 = Math.min(sel.r1, sel.r2), r2 = Math.max(sel.r1, sel.r2);
  const c1 = Math.min(sel.c1, sel.c2), c2 = Math.max(sel.c1, sel.c2);
  const srcRows = [], srcCols = [];
  for (let r = r1; r <= r2; r++) if (!(hiddenRows && hiddenRows.has(r)) && !(sheet.hiddenRows && sheet.hiddenRows[r])) srcRows.push(r);
  for (let c = c1; c <= Math.min(c2, sheet.columns.length - 1); c++) if (!sheet.columns[c].hidden) srcCols.push(c);
  const cells = srcRows.map((r) => srcCols.map((c) => ({
    raw: rawAt(sheet, r, c),
    style: nonEmptyStyle(styleAt(sheet, r, c)),
    format: formatAt(sheet, r, c) || null,
  })));
  const merges = [];
  for (const m of sheet.merges || []) {
    const ri = srcRows.indexOf(m.r);
    if (ri < 0) continue;
    const i1 = sheet.columns.findIndex((cc) => cc.id === m.c1Id), i2 = sheet.columns.findIndex((cc) => cc.id === m.c2Id);
    const ci1 = srcCols.indexOf(i1), ci2 = srcCols.indexOf(i2);
    if (ci1 >= 0 && ci2 > ci1) merges.push({ ri, ci1, ci2 });
  }
  return { v: 1, id: newClipId(), kind: "planyr", srcRows, srcCols, cells, merges, hasLooks: true };
}

const needsQuote = (s) => /[\t\r\n"]/.test(s);
/** text/plain: TSV of the DISPLAYED values, Excel-style quoting for a cell holding a tab / newline / quote. */
export function clipToText(clip, displayAt) {
  return clip.cells.map((row, i) => row.map((_, j) => {
    const t = String(displayAt(clip.srcRows[i], clip.srcCols[j]) ?? "");
    return needsQuote(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }).join("\t")).join("\n");
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const escCell = (s) => esc(s).replace(/\r?\n/g, "<br>");
const BORDER_CSS = { thin: ".5pt solid #000000", double: "2.25pt double #000000", thick: "2pt solid #000000" }; // design-exempt: CSS colour interchange with Excel / Outlook (content colours, never app chrome)

function cssFor(style, format) {
  const css = [];
  if (style) {
    if (style.bold) css.push("font-weight:700");
    if (style.italic) css.push("font-style:italic");
    const deco = [style.underline && "underline", style.strike && "line-through"].filter(Boolean).join(" ");
    if (deco) css.push(`text-decoration:${deco}`);
    if (style.color) css.push(`color:${style.color}`);
    if (style.fill) css.push(`background:${style.fill}`, "mso-pattern:auto none");
    if (style.align) css.push(`text-align:${style.align}`);
    if (style.valign) css.push(`vertical-align:${style.valign}`);
    if (style.wrap) css.push("white-space:normal");
    if (style.fontFamily) css.push(`font-family:${style.fontFamily.replace(/"/g, "'")}`);
    if (style.fontSize) css.push(`font-size:${style.fontSize}px`);
    for (const edge of ["top", "right", "bottom", "left"]) {
      const tok = style.border && style.border[edge];
      if (tok && BORDER_CSS[tok]) css.push(`border-${edge}:${BORDER_CSS[tok]}`);
    }
  }
  if (format) css.push(`mso-number-format:"${format.replace(/\\/g, "\\\\").replace(/"/g, "\\0022")}"`);
  return css.join(";");
}

/** text/html: the styled <table> plus the Planyr marker (a URL-encoded JSON blob, so it survives any
 *  attribute-quoting). Wrapped in the StartFragment markers Windows clipboard HTML expects. */
export function clipToHtml(clip, displayAt) {
  const payload = encodeURIComponent(JSON.stringify({
    v: 1, id: clip.id, srcRows: clip.srcRows, srcCols: clip.srcCols, cells: clip.cells, merges: clip.merges,
  }));
  const spans = new Map(clip.merges.map((m) => [`${m.ri}:${m.ci1}`, m]));
  const covered = new Set();
  for (const m of clip.merges) for (let j = m.ci1 + 1; j <= m.ci2; j++) covered.add(`${m.ri}:${j}`);
  const rows = clip.cells.map((row, i) => {
    const tds = [];
    row.forEach((cell, j) => {
      if (covered.has(`${i}:${j}`)) return;
      const span = spans.get(`${i}:${j}`);
      const css = cssFor(cell.style, cell.format);
      tds.push(`<td${span ? ` colspan="${span.ci2 - span.ci1 + 1}"` : ""}${css ? ` style="${esc(css)}"` : ""}>${escCell(displayAt(clip.srcRows[i], clip.srcCols[j]) ?? "")}</td>`);
    });
    return `<tr>${tds.join("")}</tr>`;
  });
  return `<html><body><!--StartFragment--><table ${CLIP_MARK}="${payload}" border="0" cellspacing="0" cellpadding="0"><tbody>${rows.join("")}</tbody></table><!--EndFragment--></body></html>`;
}

// ───────────────────────────── parse (paste) ─────────────────────────────

/** Tab-separated text -> rows of strings. Honours Excel's quoting (a quoted field may hold tabs,
 *  newlines and doubled quotes); a final line break does not make an extra empty row. */
export function parseTsv(text) {
  const rows = [];
  let row = [], field = "", inQuote = false, fieldStart = true;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQuote = false; } else field += ch;
      continue;
    }
    if (ch === '"' && fieldStart) { inQuote = true; fieldStart = false; continue; }
    if (ch === "\t") { row.push(field); field = ""; fieldStart = true; continue; }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = ""; fieldStart = true; continue;
    }
    field += ch; fieldStart = false;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function clipFromText(text) {
  const rows = parseTsv(text);
  if (!rows.length) return null;
  const w = Math.max(...rows.map((r) => r.length));
  if (w === 0) return null;
  const cells = rows.map((r) => Array.from({ length: w }, (_, j) => ({ raw: r[j] ?? "", style: null, format: null })));
  return { v: 1, id: null, kind: "text", srcRows: null, srcCols: null, cells, merges: [], hasLooks: false };
}

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—" };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : m; }
  return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
});

const NAMED = { red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", gray: "#808080", grey: "#808080", silver: "#c0c0c0", lime: "#00ff00", aqua: "#00ffff", teal: "#008080", navy: "#000080", maroon: "#800000", olive: "#808000", fuchsia: "#ff00ff" }; // design-exempt: CSS colour interchange with Excel / Outlook (content colours, never app chrome)
/** CSS colour -> "#rrggbb", or null when it is a default / invisible-on-a-dark-theme choice (black
 *  text, white fill, windowtext, transparent): those would paint a fixed colour that fights the theme. */
export function cssColorToHex(v, { forFill = false } = {}) {
  let x = String(v || "").trim().toLowerCase().replace(/\s*!important$/, "");
  if (!x || ["auto", "transparent", "inherit", "initial", "none", "windowtext", "window", "currentcolor"].includes(x)) return null;
  let hex = null;
  let m = /^#([0-9a-f]{3})$/.exec(x);
  if (m) hex = "#" + m[1].split("").map((d) => d + d).join("");
  else if ((m = /^#([0-9a-f]{6})$/.exec(x))) hex = "#" + m[1];
  else if ((m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(x))) hex = "#" + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
  else if (x === "black") hex = "#000000"; // design-exempt: CSS colour interchange with Excel / Outlook (content colours, never app chrome)
  else if (x === "white") hex = "#ffffff"; // design-exempt: CSS colour interchange with Excel / Outlook (content colours, never app chrome)
  else if (NAMED[x]) hex = NAMED[x];
  if (!hex) return null;
  if (hex === "#000000" && !forFill) return null; // design-exempt: CSS colour interchange with Excel / Outlook (content colours, never app chrome)
  if (hex === "#ffffff" && forFill) return null; // design-exempt: CSS colour interchange with Excel / Outlook (content colours, never app chrome)
  return hex;
}

const DATEY = /(^|[^a-z])(y{2,4}|m{1,4}|d{1,4}|h{1,2}|s{1,2})([^a-z]|$)|date|time/i;
/** Excel's mso-number-format value -> a token this engine's formatter knows (or null = General). */
export function msoFormatToToken(v) {
  let x = String(v || "").trim();
  if (!x) return null;
  x = x.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");
  const named = { general: null, fixed: "0.00", standard: "#,##0.00", percent: "0.00%", currency: "$#,##0.00", "short date": "mm/dd/yyyy", "long date": "mm/dd/yyyy", "medium date": "mm/dd/yyyy" };
  if (Object.prototype.hasOwnProperty.call(named, x.toLowerCase())) return named[x.toLowerCase()];
  x = x.replace(/\\0022/g, '"').replace(/\\(.)/g, "$1");
  if (/^General/i.test(x)) return null;
  if (!/[0#%]|[ymdhs]/i.test(x)) return null;
  return x.length <= 80 ? x : null;
}

function parseDecls(text) {
  const out = {};
  for (const part of String(text || "").split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}
function parseCssRules(cssText) {
  const byClass = {}, byTag = {};
  const body = cssText.replace(/<\/?style[^>]*>/gi, "").replace(/<!--|-->/g, "");
  for (const rule of body.split("}")) {
    const i = rule.indexOf("{");
    if (i < 0) continue;
    const decls = parseDecls(rule.slice(i + 1));
    for (const sel of rule.slice(0, i).split(",")) {
      const t = sel.trim().toLowerCase();
      let m = /^(?:td|th)?\.([\w-]+)$/.exec(t);
      if (m) byClass[m[1]] = { ...(byClass[m[1]] || {}), ...decls };
      else if ((m = /^(td|th|tr|table)$/.exec(t))) byTag[m[1]] = { ...(byTag[m[1]] || {}), ...decls };
    }
  }
  return { byClass, byTag };
}

function borderTokenFrom(v) {
  const x = String(v || "").toLowerCase();
  if (!x || /\bnone\b|\bhidden\b/.test(x)) return null;
  if (/\bdouble\b/.test(x)) return "double";
  const w = /(\d*\.?\d+)\s*(pt|px)/.exec(x);
  const pts = w ? (w[2] === "px" ? Number(w[1]) * 0.75 : Number(w[1])) : 0.5;
  if (!/\b(solid|dotted|dashed|thin|medium|thick)\b/.test(x) && !w) return null;
  return pts >= 2 ? "thick" : "thin";
}

/** The Planyr look + number format from a cell's merged CSS declarations (+ legacy attributes). */
export function lookFromDecls(d, attrs = {}) {
  const style = {};
  const fw = d["font-weight"];
  if (fw && (/bold/i.test(fw) || Number(fw) >= 600)) style.bold = true;
  if (/italic|oblique/i.test(d["font-style"] || "")) style.italic = true;
  const deco = d["text-decoration"] || d["text-decoration-line"] || "";
  if (/underline/i.test(deco)) style.underline = true;
  if (/line-through/i.test(deco)) style.strike = true;
  const color = cssColorToHex(d.color);
  if (color) style.color = color;
  const fill = cssColorToHex(d["background-color"] || (d.background && d.background.split(/\s+/).find((p) => cssColorToHex(p, { forFill: true }))) || attrs.bgcolor, { forFill: true });
  if (fill) style.fill = fill;
  // Only an EXPLICIT text-align counts: Excel writes `align=right` on every number and `text-align:general`
  // as the default, neither of which is a choice the user made. Likewise Excel's default vertical-align is
  // "bottom"; only "top" is a choice (middle is this sheet's own default).
  const align = String(d["text-align"] || "").toLowerCase();
  if (align === "left" || align === "center" || align === "right") style.align = align;
  if (String(d["vertical-align"] || "").toLowerCase() === "top") style.valign = "top";
  if (/^(normal|pre-wrap|pre-line)$/i.test(d["white-space"] || "")) style.wrap = true;
  const border = {};
  const all = borderTokenFrom(d.border);
  for (const edge of ["top", "right", "bottom", "left"]) {
    const tok = d[`border-${edge}`] != null ? borderTokenFrom(d[`border-${edge}`]) : all;
    if (tok) border[edge] = tok;
  }
  if (Object.keys(border).length) style.border = border;
  const format = msoFormatToToken(d["mso-number-format"]);
  return { style: Object.keys(style).length ? style : null, format };
}

const attrsOf = (s) => {
  const out = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
};

/** First <table> of an HTML fragment -> a Clip, or null. Reads Excel's class-based styles, inline
 *  styles, <b>/<i>/<u>/<s>/<font color>, bgcolor/align attributes, colspan (a horizontal merge),
 *  rowspan (cells below stay empty), and Excel's `x:fmla` / `x:num` value attributes. */
export function clipFromHtml(html) {
  if (!/<table[\s>]/i.test(html)) return null;
  let cssText = "";
  const body = html
    .replace(/<style[\s\S]*?<\/style>/gi, (m) => { cssText += m; return ""; })
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<![^>]*>/g, "");
  const { byClass, byTag } = parseCssRules(cssText);
  const TOK = /<(\/?)([a-zA-Z][a-zA-Z0-9:_-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g;
  const grid = [];           // grid[r][c] = cell | "covered"
  const merges = [];
  let depth = 0, seenTable = false, tableDone = false;
  let r = -1, c = 0, cell = null;
  const occupied = (rr, cc) => grid[rr] && grid[rr][cc] !== undefined;
  const closeCell = () => {
    if (!cell) return;
    const decls = { ...(byTag.td || {}), ...(byTag.th || {}), ...(cell.cls ? cell.cls.split(/\s+/).reduce((a, k) => ({ ...a, ...(byClass[k] || {}) }), {}) : {}), ...parseDecls(cell.attrs.style) };
    const look = lookFromDecls(decls, cell.attrs);
    const style = { ...(look.style || {}) };
    if (cell.fmtB) style.bold = true;
    if (cell.fmtI) style.italic = true;
    if (cell.fmtU) style.underline = true;
    if (cell.fmtS) style.strike = true;
    if (cell.fmtColor && !style.color) { const col = cssColorToHex(cell.fmtColor); if (col) style.color = col; }
    const shown = decode(cell.text).replace(/[ \t\r\n]+/g, " ").replace(/ ?\u0001 ?/g, "\n").trim();
    let raw = shown;
    const a = cell.attrs;
    const dateLike = look.format && DATEY.test(look.format);
    if (a["x:fmla"] && a["x:fmla"].trim().startsWith("=")) raw = a["x:fmla"].trim();
    else if (a["x:num"] != null && a["x:num"] !== "" && !dateLike && Number.isFinite(Number(a["x:num"]))) raw = String(Number(a["x:num"]));
    const entry = { raw, style: Object.keys(style).length ? style : null, format: look.format };
    grid[cell.r][cell.c] = entry;
    const cs = Math.max(1, parseInt(a.colspan, 10) || 1), rs = Math.max(1, parseInt(a.rowspan, 10) || 1);
    for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
      if (dr === 0 && dc === 0) continue;
      grid[cell.r + dr] = grid[cell.r + dr] || [];
      grid[cell.r + dr][cell.c + dc] = "covered";
    }
    if (cs > 1 && rs === 1) merges.push({ ri: cell.r, ci1: cell.c, ci2: cell.c + cs - 1 });
    cell = null;
  };
  let m;
  while ((m = TOK.exec(body))) {
    if (m[4] !== undefined) { if (cell && depth === 1) cell.text += m[4]; continue; }
    const closing = m[1] === "/", tag = m[2].toLowerCase(), attrs = attrsOf(m[3] || "");
    if (tag === "table") {
      if (closing) { depth = Math.max(0, depth - 1); if (depth === 0 && seenTable) { closeCell(); tableDone = true; } }
      else { if (tableDone) break; depth++; seenTable = true; }
      continue;
    }
    if (depth === 0 || tableDone) continue;
    if (depth > 1) { if (cell && tag === "br" && !closing) cell.text += "\u0001"; continue; }
    if (tag === "tr") { closeCell(); if (!closing) { r++; c = 0; grid[r] = grid[r] || []; } continue; }
    if (tag === "td" || tag === "th") {
      closeCell();
      if (closing) continue;
      if (r < 0) { r = 0; grid[0] = grid[0] || []; }
      while (occupied(r, c)) c++;
      cell = { r, c, attrs, cls: attrs.class || "", text: "", fmtB: false, fmtI: false, fmtU: false, fmtS: false, fmtColor: null };
      c += 1;
      // colspan reserves its columns for the next cell on the row
      const cs = Math.max(1, parseInt(attrs.colspan, 10) || 1);
      c += cs - 1;
      continue;
    }
    if (!cell) continue;
    if (tag === "br") { if (!closing) cell.text += "\u0001"; continue; }
    // an inline-format tag around ANY of this cell's text marks the whole cell (Excel emits <b> per cell)
    if (closing) continue;
    if (tag === "b" || tag === "strong") cell.fmtB = true;
    else if (tag === "i" || tag === "em") cell.fmtI = true;
    else if (tag === "u") cell.fmtU = true;
    else if (tag === "s" || tag === "strike" || tag === "del") cell.fmtS = true;
    else if (tag === "font" && attrs.color && !cell.fmtColor) cell.fmtColor = attrs.color;
  }
  closeCell();
  const rows = grid.filter((row) => row && row.length);
  if (!rows.length) return null;
  const w = Math.max(...rows.map((row) => row.length));
  const cells = rows.map((row) => Array.from({ length: w }, (_, j) => {
    const v = row[j];
    return v && v !== "covered" ? v : { raw: "", style: null, format: null };
  }));
  const hasAny = cells.some((row) => row.some((x) => x.raw !== "" || x.style || x.format));
  if (!hasAny && cells.length === 1 && cells[0].length === 1) return null;
  return { v: 1, id: null, kind: "html", srcRows: null, srcCols: null, cells, merges, hasLooks: true };
}

/** A Planyr clip back out of its own marker, or null. */
export function clipFromPlanyrHtml(html) {
  const m = new RegExp(`${CLIP_MARK}="([^"]*)"`).exec(String(html || ""));
  if (!m) return null;
  try {
    const p = JSON.parse(decodeURIComponent(m[1]));
    if (!p || p.v !== 1 || !Array.isArray(p.cells) || !p.cells.length || !Array.isArray(p.cells[0])) return null;
    return { v: 1, id: p.id || null, kind: "planyr", srcRows: p.srcRows, srcCols: p.srcCols, cells: p.cells, merges: Array.isArray(p.merges) ? p.merges : [], hasLooks: true };
  } catch { return null; }
}

/** What arrived on the clipboard -> a Clip. Planyr marker first, then any HTML table, then plain text. */
export function parseClipboard({ html = "", text = "" } = {}) {
  return clipFromPlanyrHtml(html) || (html ? clipFromHtml(html) : null) || (text ? clipFromText(text) : null);
}

// ───────────────────────────── apply (paste) ─────────────────────────────

/** Write many cells in ONE pass (setRaw copies the cell map per call — quadratic for a whole-sheet fill). */
function writeRaw(sheet, entries) {
  const cells = { ...sheet.cells };
  let unsupported = sheet.unsupportedFormulas, uCopied = false, maxRow = sheet.rowCount;
  for (const { r, c, text } of entries) {
    const col = sheet.columns[c];
    if (!col) continue;
    const key = cellKey(col.id, r);
    if (text === "" || text == null) delete cells[key]; else { cells[key] = text; if (r + 1 > maxRow) maxRow = r + 1; }
    if (unsupported && key in unsupported) { if (!uCopied) { unsupported = { ...unsupported }; uCopied = true; } delete unsupported[key]; }
  }
  return { ...sheet, cells, rowCount: maxRow, unsupportedFormulas: unsupported };
}

/** Where a paste lands for a given selection: tiling per Excel (a selection that is a whole multiple of the
 *  clip repeats it; a single value fills the whole selection), otherwise one copy at the top-left. */
export function pasteGeometry(clip, sel) {
  const h = clip.cells.length, w = clip.cells[0].length;
  const r1 = Math.min(sel.r1, sel.r2), r2 = Math.max(sel.r1, sel.r2), c1 = Math.min(sel.c1, sel.c2), c2 = Math.max(sel.c1, sel.c2);
  const selH = r2 - r1 + 1, selW = c2 - c1 + 1;
  const tileRows = selH >= h && selH % h === 0 ? selH / h : 1;
  const tileCols = selW >= w && selW % w === 0 ? selW / w : 1;
  return { h, w, top: r1, left: c1, rows: h * tileRows, cols: w * tileCols };
}

/** Write a Clip into the sheet at the selection. Returns `{ sheet, dest }` (dest = the rectangle written). */
export function applyClip(sheet, clip, sel) {
  const g = pasteGeometry(clip, sel);
  let s = ensureColumnCount(sheet, g.left + g.cols);
  const raws = [], looks = [];
  for (let dr = 0; dr < g.rows; dr++) {
    for (let dc = 0; dc < g.cols; dc++) {
      const i = dr % g.h, j = dc % g.w, r = g.top + dr, c = g.left + dc;
      const cell = clip.cells[i][j];
      const text = clip.kind === "planyr" && clip.srcRows && clip.srcCols && isFormulaText(cell.raw)
        ? relocateText(cell.raw, clip.srcRows[i], clip.srcCols[j], r, c)
        : cell.raw;
      raws.push({ r, c, text });
      if (clip.hasLooks) looks.push({ r, c, style: cell.style, format: cell.format });
    }
  }
  s = writeRaw(s, raws);
  const dest = { r1: g.top, r2: g.top + g.rows - 1, c1: g.left, c2: g.left + g.cols - 1 };
  if (clip.hasLooks) {
    s = setCellLooks(s, looks);
    s = removeMergesIn(s, dest.r1, dest.r2, dest.c1, dest.c2);
    for (let tr = 0; tr < g.rows / g.h; tr++) for (let tc = 0; tc < g.cols / g.w; tc++) {
      for (const m of clip.merges || []) {
        const r = g.top + tr * g.h + m.ri, c1 = g.left + tc * g.w + m.ci1, c2 = g.left + tc * g.w + m.ci2;
        s = mergeRange(s, r, r, c1, c2);
      }
    }
  }
  return { sheet: s, dest };
}

const hasContentIn = (clip) => clip.cells.some((row) => row.some((x) => x.raw !== ""));
export const clipIsEmpty = (clip) => !clip || !hasContentIn(clip) && !clip.cells.some((row) => row.some((x) => x.style || x.format));

// ───────────────────────────── cut = move ─────────────────────────────

/** Paste of a CUT clip into the SAME sheet: empty the source (contents, look, merges), write the block at the
 *  destination with its formulas VERBATIM (a moved formula keeps pointing where it pointed), then re-point every
 *  formula in the whole workbook — and every named range — that referred into the block. Pure over the workbook;
 *  returns `{ workbook, dest }`. `src` = `{ sheetId, rect: {r1,r2,c1,c2} }` (0-based, as the selection). */
export function pasteMoveSameSheet(workbook, sheetId, clip, src, sel) {
  const entry = workbook.sheets.find((e) => e.id === sheetId);
  if (!entry) return { workbook, dest: null };
  const top = Math.min(sel.r1, sel.r2), left = Math.min(sel.c1, sel.c2);
  const rect = src.rect;
  const dRow = top - rect.r1, dCol = left - rect.c1;
  let s = clearCellRange(entry.sheet, rect.r1, rect.r2, rect.c1, rect.c2);
  // kind "move": applyClip relocates formulas only for kind "planyr", so a moved formula is written VERBATIM.
  const { sheet: written, dest } = applyClip(s, { ...clip, kind: "move" }, { r1: top, r2: top, c1: left, c2: left });
  s = written;
  const rect1 = { r1: rect.r1 + 1, r2: rect.r2 + 1, c1: rect.c1 + 1, c2: rect.c2 + 1 };
  const sheets = workbook.sheets.map((e) => {
    const sh = e.id === sheetId ? s : e.sheet;
    const cells = {};
    let changed = false;
    for (const [k, v] of Object.entries(sh.cells)) {
      if (isFormulaText(v)) { const nv = rewriteFormulaForMove(v, e.name, entry.name, rect1, dRow, dCol); if (nv !== v) changed = true; cells[k] = nv; } else cells[k] = v;
    }
    let names = sh.names;
    if (e.id === sheetId && names && Object.keys(names).length) {
      names = {};
      for (const [k, n] of Object.entries(sh.names)) {
        const inside = n.r1 >= rect.r1 && n.r2 <= rect.r2 && n.c1 >= rect.c1 && n.c2 <= rect.c2;
        names[k] = inside ? { ...n, r1: n.r1 + dRow, r2: n.r2 + dRow, c1: n.c1 + dCol, c2: n.c2 + dCol } : n;
        if (inside) changed = true;
      }
    }
    return changed ? { ...e, sheet: { ...sh, cells, names } } : (sh === e.sheet ? e : { ...e, sheet: sh });
  });
  return { workbook: { ...workbook, sheets }, dest };
}

