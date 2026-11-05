/* Model workspace — the text-editing half of the Excel shortcuts: the keys that act INSIDE the
 * in-cell editor (Alt+Enter new line, F4 reference cycling, Ctrl+; / Ctrl+Shift+; / Ctrl+' inserting
 * text). Pure string functions over `(value, selectionStart, selectionEnd)` so they are unit-tested
 * without a DOM; SheetView applies the result to its editor state and caret.
 */

export function insertAtCaret(value, start, end, text) {
  const s = Math.min(start, end), e = Math.max(start, end);
  return { value: value.slice(0, s) + text + value.slice(e), caret: s + text.length };
}

// A1-style reference: optional sheet prefix is left alone; $ markers are cycled on the column/row.
const REF_RE = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\d(A-Za-z_])/g;

/** F4 while editing a formula: cycle the reference at (or touching) the caret
 *  $A$1 -> A$1 -> $A1 -> A1 -> $A$1. Returns null when the caret is not on a reference. */
export function cycleReferenceAtCaret(value, caret) {
  if (!String(value).startsWith("=")) return null;
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(value))) {
    const before = value[m.index - 1];
    if (before && /[A-Za-z0-9_.]/.test(before)) continue; // part of a longer word, not a cell reference
    const start = m.index, end = m.index + m[0].length;
    if (caret < start || caret > end) continue;
    const absCol = m[1] === "$", absRow = m[3] === "$";
    // $A$1 -> A$1 -> $A1 -> A1 -> $A$1
    const next = absCol && absRow ? [false, true] : !absCol && absRow ? [true, false] : absCol && !absRow ? [false, false] : [true, true];
    const text = `${next[0] ? "$" : ""}${m[2]}${next[1] ? "$" : ""}${m[4]}`;
    return { value: value.slice(0, start) + text + value.slice(end), caret: start + text.length, start, end: start + text.length };
  }
  return null;
}

const pad2 = (n) => String(n).padStart(2, "0");
/** Today as an ISO date the engine's loose-date reader accepts. */
export const todayIso = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** The current time, 12-hour, as Excel's Ctrl+Shift+; shows it ("3:45 PM"). */
export function timeText(d = new Date()) {
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(d.getMinutes())} ${h < 12 ? "AM" : "PM"}`;
}
