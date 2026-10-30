/* notesTablePaste — A TABLE COPIED FROM ONENOTE / WORD / EXCEL / SHEETS / OUTLOOK ARRIVES AS A
 * REAL NOTES TABLE, WHEREVER THE PASTE LANDS (NEW-1, owner report 2026-10-05: "I tried copying a
 * table from OneNote earlier and it did not copy well at all. Or it didn't copy it at all.")
 *
 * ⛔ WHAT WAS ACTUALLY WRONG, measured by pasting the committed clipboard fixtures
 * (test/fixtures/clipboard-tables) into the real editor — five separate causes, none of them the
 * HTML parser, which handled OneNote/Word/Outlook/Sheets markup correctly once it was reached:
 *
 *   1. **A PICTURE BESIDE THE TABLE WON.** Excel (and some OneNote builds) put a PNG of the cells
 *      on the clipboard next to the HTML. The picture-paste and file-paste handlers claim ANY
 *      clipboard that holds an image file, so the table was replaced by a screenshot of itself.
 *      Rule now: a clipboard whose HTML carries a `<table>` is a table, whatever else rides along.
 *   2. **AN EMPTY CELL CRASHED THE PASTE.** Excel's `<td></td>` parsed to a cell with no content,
 *      which the schema forbids; the column-width repair pass then threw `Invalid content for node
 *      type tableCell` and the whole paste died silently. Every cell now gets at least one paragraph.
 *   3. **ARMED / NOTHING-FOCUSED / BOX-SELECTED PASTES NEVER REACHED THE EDITOR.** After a press on
 *      blank paper the first paste took only `text/plain` (rows jammed into one run-on line); with
 *      a box merely selected (desktop's first press only SELECTS) or nothing focused, Ctrl+V did
 *      nothing at all. They now go through the editor's own paste pipeline (`NoteEditor.jsx`).
 *   4. **A ONE-COLUMN BORDERED TABLE WAS FLATTENED AS AN OUTLOOK LAYOUT TABLE.** `isLayoutTable`
 *      (every row has one cell) exists to unwrap email-signature scaffolding; OneNote's one-column
 *      checklist has visible borders and is data. Bordered ones are now marked `keep`.
 *   5. **PLAIN TAB-SEPARATED TEXT STAYED TEXT.** What Excel/Sheets put in `text/plain` is a grid;
 *      with no HTML table beside it, it now becomes a table (Ctrl+Shift+V still gives the text).
 *
 * PURE and DOM-light: the functions that touch markup take an element/DOM passed in, so the unit
 * runner (node-only) exercises the string and ProseMirror-free halves and the browser harness
 * (ui-audit/verify-notes-table-paste.mjs) exercises the real parse.
 */

import { Fragment } from "@tiptap/pm/model";
import { ANCHOR_BOX_PAD_X } from "./notesBoxResize.js";
import { normalizeFill } from "./notesTableFill.js";

/** Does this HTML hold a table? Cheap and deliberately loose — it only decides who owns the paste. */
export function htmlHasTable(html) {
  /* ⛔ ROWS OR CELLS COUNT, NOT ONLY `<table>` (B2142464 ×2). A clipboard fragment can be cut INSIDE a
   * table — rows and cells present, the opening `<table>` tag outside the fragment — and that is still
   * a table clipboard (the picture beside it must still lose, the repair below must still run). */
  return typeof html === "string" && /<(table|tr|td|th)[\s>]/i.test(html);
}

/** ⛔ A ROW-FRAGMENT WITH NO `<table>` ELEMENT BECOMES A TABLE AGAIN, BEFORE THE PARSE.
 *  The browser's HTML parser, handed `<tr><td>…` outside a table, DISCARDS `tr`/`td` and keeps what was
 *  inside the cells. OneNote cells hold a `<p>` each, so the result is exactly what the owner reported
 *  from his own machine: every non-empty cell its own paragraph in reading order, the empty cells (a
 *  `<p>&nbsp;</p>` each — "spacers") trimmed away, and no table. So: if the html has rows or cells and
 *  no `<table`, wrap the run of rows in `<table><tbody>` (and a bare run of cells in a `<tr>` first).
 *  A no-op for anything that already has a table element. Pure string work. */
export function repairTableFragment(html) {
  if (typeof html !== "string" || /<table[\s>]/i.test(html)) return html;
  const firstRow = html.search(/<tr[\s>]/i);
  if (firstRow >= 0) {
    const lastClose = html.toLowerCase().lastIndexOf("</tr>");
    if (lastClose < 0) return html;
    const end = lastClose + "</tr>".length;
    return `${html.slice(0, firstRow)}<table><tbody>${html.slice(firstRow, end)}</tbody></table>${html.slice(end)}`;
  }
  const firstCell = html.search(/<t[dh][\s>]/i);
  if (firstCell >= 0) {
    const m = [...html.matchAll(/<\/t[dh]>/gi)].pop();
    if (!m) return html;
    const end = m.index + m[0].length;
    return `${html.slice(0, firstCell)}<table><tbody><tr>${html.slice(firstCell, end)}</tr></tbody></table>${html.slice(end)}`;
  }
  return html;
}

/** A clipboard (DataTransfer-like) whose HTML carries a table. Never throws on a hostile one. */
export function clipboardHasTable(dt) {
  try { return htmlHasTable(dt?.getData?.("text/html") || ""); } catch (_) { return false; }
}

/** ⛔ Should the picture/file paste handlers STAND DOWN for this clipboard? Yes when it is a table:
 *  the picture beside it is just Excel's/OneNote's rendering of the same cells. */
export function tableOwnsClipboard(dt) {
  if (clipboardHasTable(dt)) return true;
  /* A tab-separated GRID in `text/plain` is a spreadsheet copy even when the html carries no table: a
   * picture of the cells beside it is the spreadsheet's own rendering, not a picture the person copied.
   * (A picture copied from a web page has no such grid in its text.) */
  try { return !!parseTabular(dt?.getData?.("text/plain") || ""); } catch (_) { return false; }
}

/* ── plain tab-separated text → rows ──────────────────────────────────────────────────── */

/** Parse Excel/Sheets-style tab-separated text: records end at a newline, fields at a tab, and a
 *  field that STARTS with a quote runs to its closing quote (`""` is a literal quote) so a cell
 *  holding a line break survives as one cell. A quote in the middle of a field is literal.
 *  Returns `string[][]` or null when the text is not a grid. A grid needs at least two records, at
 *  least two columns, and every record the same number of fields — anything ragged is prose that
 *  happens to contain tabs, and stays text. */
export function parseTabular(text, { maxCells = 20000 } = {}) {
  const src = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!src.includes("\t")) return null;
  const rows = [];
  let row = [];
  let i = 0;
  const n = src.length;
  while (i <= n) {
    let field = "";
    if (src[i] === '"') {
      // quoted field: find the closing quote, honouring doubled quotes
      let j = i + 1;
      let buf = "";
      let closed = false;
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { buf += '"'; j += 2; continue; }
          closed = true; j += 1; break;
        }
        buf += src[j]; j += 1;
      }
      if (closed && (j >= n || src[j] === "\t" || src[j] === "\n")) { field = buf; i = j; }
      else {
        // a quote that never closes, or is followed by more text, is just text
        let k = i;
        while (k < n && src[k] !== "\t" && src[k] !== "\n") k += 1;
        field = src.slice(i, k); i = k;
      }
    } else {
      let k = i;
      while (k < n && src[k] !== "\t" && src[k] !== "\n") k += 1;
      field = src.slice(i, k); i = k;
    }
    row.push(field);
    if (i >= n) { rows.push(row); break; }
    if (src[i] === "\t") { i += 1; continue; }
    rows.push(row); row = []; i += 1;                      // newline
    if (i >= n) break;                                      // a trailing newline ends the grid
  }
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  if (rows.length < 2) return null;
  const width = rows[0].length;
  if (width < 2 || rows.some((r) => r.length !== width)) return null;
  if (rows.length * width > maxCells) return null;
  return rows;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Rows → the same `<table>` HTML a spreadsheet would have put on the clipboard, so the one real
 *  paste pipeline (and prosemirror-tables' own cell paste, when the caret is inside a cell) does
 *  the rest. A cell's own line breaks become separate paragraphs. */
export function rowsToTableHtml(rows) {
  const body = rows.map((r) => `<tr>${r.map((c) => {
    const paras = String(c).split("\n").map((line) => `<p>${esc(line)}</p>`).join("");
    return `<td>${paras || "<p></p>"}</td>`;
  }).join("")}</tr>`).join("");
  return `<table><tbody>${body}</tbody></table>`;
}

/** ⛔ A WORD LIST'S `text/plain` IS A TWO-COLUMN GRID ("1.<tab>Entitlements", "·<tab>Soft costs"): every line is a
 *  list marker, a tab, then the item. As a grid it would turn a pasted numbered or bulleted list into a table of
 *  marker + text. A grid whose FIRST COLUMN is nothing but list markers is a list. */
export function isMarkerColumn(rows) {
  const marker = /^(?:[^\w\s]|o|\(?(?:\d{1,4}|[a-z]|[ivxlcdm]+)[.)])$/i;
  return rows.length > 0 && rows.every((r) => marker.test(String(r[0] ?? "").replace(/[\s\u00a0]+/g, "")));
}

/** The grid in a clipboard's tab-separated `text/plain`, else null. By default only when the clipboard has
 *  no html table (the html is then the better source). `ignoreHtml` is the FALLBACK ("tab-separated rows
 *  must always become a table, whenever the HTML route yields none" — owner, 2026-10-06): the caller has
 *  already seen the html produce no table, so the text is all that is left. */
export function tabularFromClipboard(dt, { ignoreHtml = false } = {}) {
  try {
    if (!ignoreHtml && clipboardHasTable(dt)) return null;
    const rows = parseTabular(dt?.getData?.("text/plain") || "");
    return rows && !isMarkerColumn(rows) ? rows : null;
  } catch (_) { return null; }
}

/** Plain text of a table, one ROW per line with the cells TAB-separated — the shape Excel and
 *  Word's own "Convert table to text" produce. The one text form of a table ("Keep text only"). */
export function tableRowsToText(rows) {
  return rows.map((r) => r.join("\t")).join("\n");
}

/* ── markup repair, before the parse ──────────────────────────────────────────────────── */

/** Is this `<table>` one a person would call a table — visible borders — rather than the borderless
 *  scaffolding an email signature is laid out in? OneNote/Word/Excel/Sheets write `border=1` and/or
 *  a solid cell border; Outlook layout tables are `border=0` with padding only. */
export function isBorderedTable(tableEl) {
  if (!tableEl) return false;
  const attr = parseFloat(tableEl.getAttribute?.("border") || "0");
  if (attr > 0) return true;
  const solid = /border[a-z-]*\s*:\s*[^;]*\b(solid|dashed|dotted|double|\d*\.?\d+(pt|px|in))\b/i;
  const cells = tableEl.querySelectorAll?.("td,th") || [];
  for (const c of cells) {
    const st = c.getAttribute("style") || "";
    if (solid.test(st) && !/border[a-z-]*\s*:\s*(none|0)/i.test(st)) return true;
  }
  return false;
}

/** Every row has exactly one cell. */
export function isSingleColumn(tableEl) {
  const rows = tableEl.querySelectorAll?.("tr") || [];
  if (!rows.length) return false;
  for (const r of rows) if (r.querySelectorAll(":scope > td, :scope > th").length !== 1) return false;
  return true;
}

/** Repair a pasted clipboard's DOM in place:
 *   · an empty cell gets `<p></p>` (the schema requires a block, and an empty one used to throw);
 *   · a bordered one-column table is stamped `data-planyr-keep-table` so it is not unwrapped as
 *     email scaffolding. Returns the element. */
export function normalizeTableMarkup(root) {
  if (!root?.querySelectorAll) return root;
  /* ⛔ HIDDEN ROWS AND CELLS ARE NOT CONTENT (B2142464 ×2, Excel). Excel writes a zero-height helper row —
   * `<tr height=0 style='display:none'>` of empty cells, inside `<![if supportMisalignedColumns]>` — to
   * keep its column widths honest. On screen it is invisible; parsed, it became a real blank row at the
   * bottom of every pasted table. */
  for (const el of root.querySelectorAll("tr,td,th")) {
    const st = (el.getAttribute("style") || "").replace(/\s+/g, "").toLowerCase();
    if (st.includes("display:none") || (el.tagName === "TR" && el.getAttribute("height") === "0")) el.remove();
  }
  for (const cell of root.querySelectorAll("td,th")) {
    const hasBlock = cell.querySelector("p,div,ul,ol,table,h1,h2,h3,h4,h5,h6,pre,blockquote,img");
    if (!hasBlock && !(cell.textContent || "").replace(/[\s ]/g, "")) {
      cell.innerHTML = "<p></p>";
    }
  }
  for (const table of root.querySelectorAll("table")) {
    if (isSingleColumn(table) && isBorderedTable(table)) table.setAttribute("data-planyr-keep-table", "1");
  }
  return root;
}

/** Slice-level safety net (after the parse): a cell/header with no children gets one empty
 *  paragraph. `Fragment`-in, `Fragment`-out, schema-aware; pure. */
export function fillEmptyCells(fragment, schema) {
  const fix = (frag) => {
    const out = [];
    frag.forEach((node) => {
      const name = node.type?.name;
      if ((name === "tableCell" || name === "tableHeader") && node.childCount === 0) {
        out.push(node.copy(Fragment.from(schema.nodes.paragraph.create())));
      } else if (node.childCount && !node.isTextblock) {
        out.push(node.copy(fix(node.content)));
      } else out.push(node);
    });
    return Fragment.fromArray(out);
  };
  return fix(fragment);
}

/** ⛔ A TABLE'S REAL SHAPE: ITS COLUMN COUNT IS THE WIDEST ROW *COUNTING MERGED CELLS* (NEW-1, owner report
 *  2026-10-11, a OneNote table with a merged "Cross Dock / Front Load / Rear Load" header, each spanning two
 *  columns). The box was sized from the FIRST ROW'S CELL COUNT — 3 — while the table has 6 columns, so the box
 *  came out half the width it needed and every column was squeezed to the floor.
 *  `rows` is plain data (one array of `{ colspan, colwidth }` per row; `colwidth` is Tiptap's number-array-or-null),
 *  so this stays engine-free. Returns `{ cols, widths }`: `widths[i]` is that column's stored width or `null`. */
export function tableShape(rows) {
  let cols = 0;
  const widths = [];
  for (const row of rows || []) {
    let at = 0;
    for (const cell of row || []) {
      const span = Math.max(1, Number(cell?.colspan) || 1);
      const cw = Array.isArray(cell?.colwidth) ? cell.colwidth : null;
      for (let k = 0; k < span; k += 1) {
        const w = cw && Number.isFinite(Number(cw[k])) && Number(cw[k]) > 0 ? Number(cw[k]) : null;
        if (w != null && widths[at + k] == null) widths[at + k] = w;
      }
      at += span;
    }
    cols = Math.max(cols, at);
  }
  return { cols, widths: Array.from({ length: cols }, (_, i) => widths[i] ?? null) };
}

/** `tableShape` over a ProseMirror `table` node. */
export function tableShapeOfNode(tableNode) {
  const rows = [];
  tableNode.forEach((row) => {
    const cells = [];
    row.forEach((cell) => cells.push({ colspan: cell.attrs?.colspan, colwidth: cell.attrs?.colwidth }));
    rows.push(cells);
  });
  return tableShape(rows);
}

/** The widest a TABLE's box is capped at when the page is narrower than this: a six-column table on the
 *  default narrow page would otherwise be forced to its floor. The page grows to hold it (anchorExtentX),
 *  exactly as it does for any box that overhangs. */
export const TABLE_BOX_CAP_MIN = 900;

/** How wide a box holding a table should be — wide enough that every column shows without squeezing
 *  (NEW-1). The table's NATURAL width, never the source's pixel widths (OneNote writes `width:0.9in` on every
 *  cell): a column with no stored width counts `column`, one with a stored width counts that. It is capped
 *  at the page's current width — or `TABLE_BOX_CAP_MIN` if the page is narrower — but never below what
 *  keeps every column at the readable floor (`minCol`). Never narrows a box that is already wider. */
export function tableBoxWidth({ cols, widths = null, current = 0, sheet = 0, column = 160, minCol = 100, cap = TABLE_BOX_CAP_MIN, pad = ANCHOR_BOX_PAD_X }) {
  const n = Math.max(1, Math.floor(Number(cols) || 1));
  const natural = (Array.isArray(widths) && widths.length === n
    ? widths.reduce((a, w) => a + (Number(w) > 0 ? Math.max(Number(w), minCol) : column), 0)
    : n * column) + pad;                       // the box's own padding + border sit OUTSIDE the table
  const ceiling = Math.max(Number(sheet) || 0, cap, n * minCol + pad);
  return Math.round(Math.max(Number(current) || 0, Math.min(natural, ceiling)));
}

/* ── the SOURCE table's look: column widths and cell shading (NEW-1, Office-style paste options) ─────────────
 *
 * The ordinary paste imports neither (see this file's header and notesTableFill.js): a table's box is sized from
 * its columns, and a foreign white-on-white fill would be wrong on a dark page. The paste options that ask for
 * "the source's widths" (W) or "the source's formatting" (E, R) need them, so they are READ here, from the
 * clipboard markup, and carried beside the paste. Pure over a DOM element — the unit runner has none, so the
 * length and colour parsing is exported and tested on its own, and the whole read is driven in a browser
 * (ui-audit/verify-notes-paste-options.mjs) against the committed Excel / OneNote / Word fixtures.
 */

const CSS_PX = { px: 1, pt: 96 / 72, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

/** `"64"`, `"48pt"`, `"0.9in"` → whole CSS pixels; percentages, `auto` and junk → null. */
export function cssLengthPx(value) {
  const m = /^\s*(\d*\.?\d+)\s*(px|pt|in|cm|mm)?\s*$/i.exec(String(value ?? ""));
  if (!m) return null;
  const n = parseFloat(m[1]) * CSS_PX[(m[2] || "px").toLowerCase()];
  return n > 0 ? Math.round(n) : null;
}

/** The fill a CSS declaration block names (a hex or an rgb triple after `background` / `background-color`), as lowercase hex, or null.
 *  White and "no fill" are not a look anyone chose. */
export function fillFromDeclarations(css) {
  const m = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(String(css || ""));
  const token = m && /#[0-9a-f]{3,6}\b|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/i.exec(m[1]);
  const hex = normalizeFill(token ? token[0] : "");
  return !hex || hex === "transparent" || /^#(?:f{6}|f{3})$/i.test(hex) ? null : hex;
}

/** `{ className: fill }` from the clipboard's own `<style>` text. ⛔ EXCEL (and Word) NAME A CELL'S SHADING BY CLASS —
 *  `<td class=xl65>` with a `.xl65` rule carrying the background in the head — not inline, so reading only `style=` misses
 *  every real spreadsheet fill (found by driving the committed Excel fixture, whose header row is shaded this way). */
export function fillsByClass(cssText) {
  const out = {};
  const css = String(cssText || "").replace(/<!--|-->/g, " ");
  for (const m of css.matchAll(/(?:^|[}\s,])(?:td|th)?\.([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g)) {
    const fill = fillFromDeclarations(m[2]);
    if (fill && !out[m[1]]) out[m[1]] = fill;
  }
  return out;
}

/** A source cell's shading as `#rrggbb`, or null: inline style first, then `bgcolor`, then its classes' rules. */
export function sourceFill(el, byClass = null) {
  if (!el?.getAttribute) return null;
  const inline = fillFromDeclarations(el.getAttribute("style") || "");
  if (inline) return inline;
  const attr = (el.getAttribute("bgcolor") || "").trim();
  const fromAttr = fillFromDeclarations(`background:${/^[0-9a-f]{6}$/i.test(attr) ? `#${attr}` : attr}`);
  if (fromAttr) return fromAttr;
  if (byClass) for (const c of String(el.getAttribute("class") || "").split(/\s+/)) if (c && byClass[c]) return byClass[c];
  return null;
}

function elementWidth(el) {
  const attr = el.getAttribute?.("width");
  const fromAttr = attr && !/%/.test(attr) ? cssLengthPx(attr) : null;
  if (fromAttr) return fromAttr;
  const m = /(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(el.getAttribute?.("style") || "");
  return m && !/%/.test(m[1]) ? cssLengthPx(m[1].trim()) : null;
}

const cellsOf = (tr) => Array.from(tr.children || []).filter((c) => /^t[dh]$/i.test(c.tagName || ""));

/** Tables worth reporting, in document order: not an email layout table (the paste unwraps those), not one cell
 *  (always pasted as text), and not nested inside a table that is itself kept. These are the tables the editor
 *  ends up holding, one for one. */
function realTables(root) {
  const isScaffold = (t) => (isSingleColumn(t) && !isBorderedTable(t)) || t.querySelectorAll("td,th").length < 2;
  return Array.from(root.querySelectorAll("table")).filter((t) => {
    if (isScaffold(t)) return false;
    const up = t.parentElement?.closest?.("table");
    return !up || isScaffold(up);
  });
}

/** The text grid of every real table in a clipboard document, in the same order `readSourceTables` reports them:
 *  one array of cell strings per row (a cell's paragraphs joined by a space). The SAFETY NET's copy of the data —
 *  if the parse ever drops a table the clipboard plainly held, these rebuild it (notesPastePlain.js). Never throws. */
export function tableGridsOf(root) {
  if (!root?.querySelectorAll) return [];
  const out = [];
  for (const table of realTables(root)) {
    try {
      const rows = Array.from(table.querySelectorAll("tr")).filter((tr) => tr.closest("table") === table);
      const grid = rows.map((tr) => cellsOf(tr).map((c) => (c.textContent || "").replace(/[\s\u00a0]+/g, " ").trim()));
      if (grid.length && grid.some((r) => r.length >= 2)) out.push(grid);
    } catch (_) { /* one unreadable table costs its rescue, never the paste */ }
  }
  return out;
}

/** `{ widths, fills }` per real table in a clipboard document. `widths[i]` is column i's source width in CSS pixels
 *  or null; `fills[r][c]` is the shading of the c-th cell of the r-th row (document order) or null. Never throws. */
export function readSourceTables(root, styleRoot = root) {
  if (!root?.querySelectorAll) return [];
  const out = [];
  const byClass = fillsByClass(Array.from(styleRoot?.querySelectorAll?.("style") || []).map((st) => st.textContent).join("\n"));
  for (const table of realTables(root)) {
    try {
      const widths = [];
      for (const col of Array.from(table.querySelectorAll(":scope > colgroup > col, :scope > col"))) {
        const span = Math.max(1, parseInt(col.getAttribute("span") || "1", 10) || 1);
        const w = elementWidth(col);
        for (let k = 0; k < span; k += 1) widths.push(w);
      }
      const rows = Array.from(table.querySelectorAll(":scope > tr, :scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr"));
      const fills = [];
      const fromCells = [];
      for (const tr of rows) {
        let at = 0;
        const rowFills = [];
        for (const cell of cellsOf(tr)) {
          const span = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10) || 1);
          rowFills.push(sourceFill(cell, byClass));
          const w = elementWidth(cell);
          if (w && span === 1 && fromCells[at] == null) fromCells[at] = w;
          at += span;
        }
        fills.push(rowFills);
      }
      const cols = Math.max(widths.length, fromCells.length);
      const merged = Array.from({ length: cols }, (_, i) => widths[i] ?? fromCells[i] ?? null);
      out.push({ widths: merged, fills });
    } catch (_) { /* one unreadable table costs its look, never the paste */ }
  }
  return out;
}
