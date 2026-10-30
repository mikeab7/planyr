/* Model workspace — the Excel keys the free Univer build lacks (NEW-1, 2026-10-30), as DATA.
 *
 * PURE: no Univer import, no DOM, so `test/modelUniverExcelKeys.test.js` can prove the table without a browser.
 * The browser half is `./index.js` (registers the commands + shortcuts through Univer's own services), `./actions.js`
 * (what each key DOES to the sheet) and `./keyTipsController.js` (the Alt sequence).
 *
 * ONE KEY TABLE: *which* keystroke is *which* chord is decided by `lib/keymap.js` (`CHORDS`, `navAction`) and *which* Alt
 * path is which command by `lib/keyTips.js` — the old grid and this plugin read the SAME tables, so the Keyboard Shortcuts
 * page (`shared/keyboard/shortcutsData.js`, derived from them) is true for both grids. This file adds only what Univer
 * needs on top: the KEY CODE its shortcut service indexes by, and the context the key may fire in.
 *
 * Univer binds by `keyCode | modifier bits` and then asks the shortcut's `eventPreconditions`; we bind by the code and
 * confirm with the keymap predicate on `e.key` (the character the key PRODUCES), exactly as the old grid does, so a
 * layout where the same physical key types something else never fires a chord by accident.
 */
import { CHORDS, navAction } from "../keymap.js";

/** Univer's modifier bits (`MetaKeys` in @univerjs/ui). CTRL_COMMAND is Ctrl on Windows/Linux and Cmd on macOS. */
export const META = Object.freeze({ SHIFT: 1024, ALT: 2048, MOD: 4096 });

/** Browser `keyCode`s (Chromium/Edge/Safari; Firefox's differing punctuation codes are listed as alternates). */
const KC = Object.freeze({
  SPACE: 32, D0: 48, D1: 49, D3: 51, D4: 52, D5: 53, D7: 55, D9: 57,
  SEMICOLON: 186, SEMICOLON_FF: 59, EQUAL: 187, EQUAL_FF: 61, MINUS: 189, MINUS_FF: 173, QUOTE: 222, BACKTICK: 192,
  NUM_ADD: 107, NUM_SUBTRACT: 109,
});

/** The contexts a chord may fire in (resolved against Univer's focus flags in `./index.js`).
 *  - `ready`  : a sheet cell is selected and NO editor (cell editor, formula bar) is open — the default for every chord.
 *  - `inline` : as `ready`, and ALSO while the cell is open for editing (Ctrl+5 formats the whole cell, as Ctrl+B/I/U do). */
export const SCOPE = Object.freeze({ READY: "ready", INLINE: "inline" });

/** [chord id, Univer-side action id, scope, key combos]. `key` is a `{ code, shift?, mod? }` — `mod` defaults to true. */
const k = (code, shift = false, mod = true) => ({ code, shift, mod });
export const CHORD_BINDINGS = Object.freeze([
  // Format
  { chord: "strikethrough", action: "strikethrough", scope: SCOPE.INLINE, keys: [k(KC.D5)] },
  { chord: "number-format-dialog", action: "number-format-dialog", scope: SCOPE.READY, keys: [k(KC.D1)] },
  { chord: "currency-style", action: "currency-style", scope: SCOPE.READY, keys: [k(KC.D4, true)] },
  { chord: "percent-style", action: "percent-style", scope: SCOPE.READY, keys: [k(KC.D5, true)] },
  { chord: "number-comma-style", action: "number-comma-style", scope: SCOPE.READY, keys: [k(KC.D1, true)] },
  { chord: "numfmt-general", action: "numfmt-general", scope: SCOPE.READY, keys: [k(KC.BACKTICK, true)] },
  { chord: "numfmt-date", action: "numfmt-date", scope: SCOPE.READY, keys: [k(KC.D3, true)] },
  { chord: "border-outline", action: "border-outline", scope: SCOPE.READY, keys: [k(KC.D7, true)] },
  { chord: "border-none", action: "border-none", scope: SCOPE.READY, keys: [k(KC.MINUS, true), k(KC.MINUS_FF, true)] },
  // Edit
  { chord: "insert-date", action: "insert-date", scope: SCOPE.READY, keys: [k(KC.SEMICOLON), k(KC.SEMICOLON_FF)] },
  { chord: "insert-time", action: "insert-time", scope: SCOPE.READY, keys: [k(KC.SEMICOLON, true), k(KC.SEMICOLON_FF, true)] },
  { chord: "copy-above-formula", action: "copy-above-formula", scope: SCOPE.READY, keys: [k(KC.QUOTE)] },
  { chord: "copy-above-value", action: "copy-above-value", scope: SCOPE.READY, keys: [k(KC.QUOTE, true)] },
  // Structure
  { chord: "insert-cells", action: "insert-cells", scope: SCOPE.READY, keys: [k(KC.EQUAL, true), k(KC.EQUAL_FF, true), k(KC.NUM_ADD)] },
  { chord: "delete-cells", action: "delete-cells", scope: SCOPE.READY, keys: [k(KC.MINUS), k(KC.MINUS_FF), k(KC.NUM_SUBTRACT)] },
  { chord: "hide-rows", action: "hide-rows", scope: SCOPE.READY, keys: [k(KC.D9)] },
  { chord: "unhide-rows", action: "unhide-rows", scope: SCOPE.READY, keys: [k(KC.D9, true)] },
  { chord: "hide-columns", action: "hide-columns", scope: SCOPE.READY, keys: [k(KC.D0)] },
  { chord: "unhide-columns", action: "unhide-columns", scope: SCOPE.READY, keys: [k(KC.D0, true)] },
  // Selection (keymap.js `navAction` types, not CHORDS entries)
  { chord: "select-row", nav: "select-row", action: "select-row", scope: SCOPE.READY, keys: [k(KC.SPACE, true, false)] },
  { chord: "select-column", nav: "select-column", action: "select-column", scope: SCOPE.READY, keys: [k(KC.SPACE, false, true)] },
]);

/** Univer's numeric binding for a combo. */
export const bindingOf = ({ code, shift, mod }) => code | (shift ? META.SHIFT : 0) | (mod ? META.MOD : 0);

/** Does this keystroke mean `chord`? Delegates to the SAME predicates the old grid uses. */
export function chordMatches(chord, e) {
  const b = CHORD_BINDINGS.find((x) => x.chord === chord);
  if (!b || !e || typeof e.key !== "string") return false;
  if (b.nav) { const n = navAction(e); return !!n && n.type === b.nav; }
  const row = CHORDS.find(([id]) => id === chord);
  return !!row && !!row[2](e);
}

/** CHORDS ids the Univer grid already does natively (its own shortcut), by plugin, or NOT AT ALL yet — named, never silent. */
export const UNIVER_NATIVE_CHORDS = Object.freeze(["bold", "italic", "underline", "fill-right"]);
export const UNIVER_UNSUPPORTED_CHORDS = Object.freeze({
  autosum: "Alt+= (AutoSum) is not wired to a Univer command yet",
  "repeat-last": "F4 outside the editor (repeat last action) has no Univer equivalent",
  "sheet-add": "Shift+F11 (new sheet) is the sheet-tab '+' button on the Univer grid",
  "sheet-prev": "Ctrl+PgUp (previous sheet) is owned by the host's tab switching",
  "sheet-next": "Ctrl+PgDn (next sheet) is owned by the host's tab switching",
  "save-now": "Ctrl+S is the host save path (UniverSheet's debounced flush), not a grid key",
});
/** Every CHORDS id must be accounted for exactly once: native, plugin, or a named gap. Used by the unit test. */
export const chordCoverage = () => {
  const plugin = new Set(CHORD_BINDINGS.filter((b) => !b.nav).map((b) => b.chord));
  return CHORDS.map(([id]) => ({
    id,
    how: UNIVER_NATIVE_CHORDS.includes(id) ? "native" : plugin.has(id) ? "plugin" : UNIVER_UNSUPPORTED_CHORDS[id] ? "gap" : "unaccounted",
  }));
};

// ---- number formats (Excel's own patterns for the Ctrl+Shift keys) --------------------------------------------------
/** Ctrl+Shift+$ currency · % percent (no decimals) · ! number with commas, two decimals · # date (d-mmm-yy) · ~ General. */
export const NUMFMT_FOR = Object.freeze({
  "currency-style": "$#,##0.00",
  "percent-style": "0%",
  "number-comma-style": "#,##0.00",
  "numfmt-date": "d-mmm-yy",
  "numfmt-general": "General",
});
export const TODAY_PATTERN = "m/d/yyyy";
export const TIME_PATTERN = "h:mm AM/PM";

/** Excel's date serial (days since 1899-12-30) for a LOCAL date — Ctrl+; stores a real date, not text. */
export const dateSerial = (d = new Date()) => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
/** Excel's time-of-day fraction, to the minute (Ctrl+Shift+; shows no seconds). */
export const timeFraction = (d = new Date()) => (d.getHours() * 60 + d.getMinutes()) / 1440;

// ---- the Insert / Delete prompts (Excel's wording; a whole-row / whole-column selection skips them) ------------------
export const INSERT_CHOICES = Object.freeze([
  { value: "shift-right", label: "Shift cells right", key: "i" },
  { value: "shift-down", label: "Shift cells down", key: "d" },
  { value: "row", label: "Entire row", key: "r" },
  { value: "column", label: "Entire column", key: "c" },
]);
export const DELETE_CHOICES = Object.freeze([
  { value: "shift-left", label: "Shift cells left", key: "l" },
  { value: "shift-up", label: "Shift cells up", key: "u" },
  { value: "row", label: "Entire row", key: "r" },
  { value: "column", label: "Entire column", key: "c" },
]);

/** What an Insert / Delete with this selection does: whole lines skip the prompt, cells ask, several ranges are refused. */
export function structureKind(ranges, maxRows, maxCols) {
  if (!ranges || ranges.length === 0) return "none";
  if (ranges.length > 1) return "multi";
  const r = ranges[0];
  const wholeRows = r.startColumn <= 0 && r.endColumn >= maxCols - 1;
  const wholeCols = r.startRow <= 0 && r.endRow >= maxRows - 1;
  if (wholeRows && wholeCols) return "sheet";
  if (wholeRows) return "rows";
  if (wholeCols) return "columns";
  return "cells";
}

/** Excel's Shift+Space / Ctrl+Space: the whole rows / columns the selection spans (one per range, in order). */
export function wholeLineRanges(ranges, axis, maxRows, maxCols) {
  return ranges.map((r) => (axis === "row"
    ? { startRow: r.startRow, endRow: r.endRow, startColumn: 0, endColumn: maxCols - 1 }
    : { startRow: 0, endRow: maxRows - 1, startColumn: r.startColumn, endColumn: r.endColumn }));
}
