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

/** Does this HTML hold a table? Cheap and deliberately loose — it only decides who owns the paste. */
export function htmlHasTable(html) {
  return typeof html === "string" && /<table[\s>]/i.test(html);
}

/** A clipboard (DataTransfer-like) whose HTML carries a table. Never throws on a hostile one. */
export function clipboardHasTable(dt) {
  try { return htmlHasTable(dt?.getData?.("text/html") || ""); } catch (_) { return false; }
}

/** ⛔ Should the picture/file paste handlers STAND DOWN for this clipboard? Yes when it is a table:
 *  the picture beside it is just Excel's/OneNote's rendering of the same cells. */
export const tableOwnsClipboard = clipboardHasTable;

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

/** The grid in a clipboard that has NO html table but a tab-separated `text/plain`, else null. */
export function tabularFromClipboard(dt) {
  try {
    if (clipboardHasTable(dt)) return null;
    return parseTabular(dt?.getData?.("text/plain") || "");
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

/** How wide a box that has just been made FOR a pasted table should be — wide enough that three
 *  ordinary columns do not collapse to slivers, never wider than the page's writing column. */
export function tableBoxWidth({ cols, current, column = 160, max = 560 }) {
  const want = Math.max(1, Number(cols) || 1) * column;
  return Math.round(Math.min(max, Math.max(Number(current) || 0, want)));
}
