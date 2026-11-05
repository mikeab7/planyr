/* Model workspace (user-facing "Spreadsheet") — Excel for Windows' keyboard shortcuts, as DATA.
 *
 * ⛔ THE SPEC IS EXCEL FOR WINDOWS (owner, 2026-10-29: "The keyboard shortcuts that work in Excel
 * should work on the spreadsheet … muscle memory is the spec"). Benchmark = Microsoft's published
 * "Keyboard shortcuts in Excel" list. Ctrl and Cmd are interchangeable, exactly as the existing
 * handlers already treat them.
 *
 * Two pure tables, no DOM and no React so the key → command mapping is unit-tested without a page:
 *   (Ctrl+C / Ctrl+X / Ctrl+V are NOT in this table on purpose: they are native clipboard EVENTS,
 *   handled by ModelApp's copy / cut / paste listeners — see lib/clipboardIO.js.)
 *   • `chordCommand(e, { editing })` — a keystroke -> a command id from lib/commandRegistry.js, or
 *     null. ModelApp runs the id through the SAME registry the palette and the ribbon use
 *     (`COMMANDS[…].run(ctx)`), so a shortcut can never compute a second answer for "bold" /
 *     "currency" / "insert row". While a cell is being EDITED only the four font-style chords fire
 *     (Ctrl+B/I/U/5 format the whole cell, as in Excel); every other chord belongs to the text box.
 *   • `navAction(e)` — selection / cursor-movement keys that need the grid's own state (the active
 *     cell, the viewport, the used range). SheetView applies them.
 *
 * Characters are matched by `e.key` ONLY (the character the key PRODUCES) — a US Ctrl+Shift+4 is
 * "$", a numpad "+" and a Ctrl+Shift+= are both "+" — never by `e.code`, so a chord cannot fire by
 * accident on a layout where the same physical key types something else.
 */

const isMod = (e) => !!(e.ctrlKey || e.metaKey);

/** [id, combo shown in the help list/palette, predicate]. Order matters only where two rows could
 *  match the same event (none do). `shortcutsData.js` lists every entry here. */
export const CHORDS = [
  // ---- Format ----
  ["bold", "Ctrl+B", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b"],
  ["italic", "Ctrl+I", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "i"],
  ["underline", "Ctrl+U", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "u"],
  ["strikethrough", "Ctrl+5", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key === "5"],
  ["number-format-dialog", "Ctrl+1", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key === "1"],
  ["currency-style", "Ctrl+Shift+$", (e) => isMod(e) && !e.altKey && e.shiftKey && (e.key === "$")],
  ["percent-style", "Ctrl+Shift+%", (e) => isMod(e) && !e.altKey && e.shiftKey && (e.key === "%")],
  ["number-comma-style", "Ctrl+Shift+!", (e) => isMod(e) && !e.altKey && e.shiftKey && (e.key === "!")],
  ["numfmt-general", "Ctrl+Shift+~", (e) => isMod(e) && !e.altKey && e.shiftKey && e.key === "~"],
  ["numfmt-date", "Ctrl+Shift+#", (e) => isMod(e) && !e.altKey && e.shiftKey && (e.key === "#")],
  ["border-outline", "Ctrl+Shift+&", (e) => isMod(e) && !e.altKey && e.shiftKey && (e.key === "&")],
  ["border-none", "Ctrl+Shift+_", (e) => isMod(e) && !e.altKey && e.shiftKey && (e.key === "_")],
  // ---- Edit ----
  ["fill-right", "Ctrl+R", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "r"],
  ["insert-date", "Ctrl+;", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key === ";"],
  ["insert-time", "Ctrl+Shift+;", (e) => isMod(e) && !e.altKey && e.shiftKey && (e.key === ":" || e.key === ";")],
  ["copy-above-formula", "Ctrl+'", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key === "'"],
  ["copy-above-value", "Ctrl+Shift+\"", (e) => isMod(e) && !e.altKey && e.shiftKey && (e.key === "\"" || e.key === "'")],
  ["autosum", "Alt+=", (e) => e.altKey && !isMod(e) && (e.key === "=" || e.key === "+")],
  ["repeat-last", "F4", (e) => e.key === "F4" && !e.altKey && !isMod(e) && !e.shiftKey],
  // ---- Structure ----
  ["insert-cells", "Ctrl+Shift+=", (e) => isMod(e) && !e.altKey && ((e.shiftKey && (e.key === "+" || e.key === "=")) || e.key === "+")],
  ["delete-cells", "Ctrl+-", (e) => isMod(e) && !e.altKey && !e.shiftKey && (e.key === "-" || e.key === "Subtract")],
  ["hide-rows", "Ctrl+9", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key === "9"],
  ["unhide-rows", "Ctrl+Shift+9", (e) => isMod(e) && !e.altKey && e.shiftKey && (e.key === "(")],
  ["hide-columns", "Ctrl+0", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key === "0"],
  ["unhide-columns", "Ctrl+Shift+0", (e) => isMod(e) && !e.altKey && e.shiftKey && (e.key === ")")],
  ["sheet-add", "Shift+F11", (e) => e.key === "F11" && e.shiftKey && !isMod(e) && !e.altKey],
  ["sheet-prev", "Ctrl+PgUp", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key === "PageUp"],
  ["sheet-next", "Ctrl+PgDn", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key === "PageDown"],
  // ---- File ----
  ["save-now", "Ctrl+S", (e) => isMod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s"],
];

/** The four chords that also fire while a cell is open for editing (they format the whole cell). */
export const EDIT_MODE_CHORDS = new Set(["bold", "italic", "underline", "strikethrough"]);

/** keystroke -> command id (or null). `editing` = the key came from the in-cell editor. */
export function chordCommand(e, { editing = false } = {}) {
  if (!e || typeof e.key !== "string") return null;
  for (const [id, , match] of CHORDS) {
    if (!match(e)) continue;
    if (editing && !EDIT_MODE_CHORDS.has(id)) return null;
    return id;
  }
  return null;
}

/** Selection / movement keys that need the grid's own state. Returns a descriptor or null; SheetView
 *  turns it into a `setSelRange`. Edit mode never reaches this (the editor owns those keys). */
export function navAction(e) {
  if (!e || typeof e.key !== "string") return null;
  const mod = isMod(e), shift = !!e.shiftKey, alt = !!e.altKey;
  if (mod && !alt && !shift && e.key.toLowerCase() === "a") return { type: "select-all" };
  if (e.key === " " || e.code === "Space") {
    if (mod && !alt && !shift) return { type: "select-column" };
    if (shift && !mod && !alt) return { type: "select-row" };
    return null;
  }
  if (e.key === "Home" && !alt) {
    if (mod && shift) return { type: "extend-to-start" };
    if (mod) return null; // Ctrl+Home keeps its existing handler (jump to A1)
    return shift ? { type: "extend-to-row-start" } : { type: "row-start" };
  }
  if (e.key === "End" && mod && shift && !alt) return { type: "extend-to-used-end" };
  if ((e.key === "PageDown" || e.key === "PageUp") && !mod) {
    const dir = e.key === "PageDown" ? 1 : -1;
    return alt ? { type: "page-across", dir, shift } : { type: "page-down", dir, shift };
  }
  return null;
}
