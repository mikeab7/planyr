/* notesFormatPalette — WHAT THE FORMATTING CONTROLS OFFER, DECLARED ONCE (NEW-MINI-TOOLBAR).
 *
 * ⛔ THESE ARE THE ONLY LITERAL COLOURS IN THE NOTES MODULE, AND THEY ARE CONTENT, NOT CHROME. A
 * text colour somebody picks is a value written into their document: it has to mean the same
 * thing on every device, in every theme, and in every export. Theme tokens would make a note's
 * own words change colour when the app theme flips, which is wrong. Everything else in this
 * module is a theme token, and that rule is machine-enforced elsewhere — this file is the
 * deliberate, single exception.
 *
 * ⛔ WHY THEY MOVED HERE. They used to live inside `components/NoteToolbar.jsx`, which was right
 * while the formatting bar was the only thing that offered them. The right-click mini-toolbar
 * (his *"another menu that kind of goes horizontal that has text size, text colour, bold italic
 * underline strikethrough"*) offers the same choices, and two copies of a palette is how the
 * toolbar and the menu come to disagree about what "Teal" is — a difference nobody notices until
 * two paragraphs of the same note are subtly different colours. One list, two consumers.
 */

/** Text colours. `null` is DEFAULT, i.e. remove the mark — not a colour, and the distinction
 *  matters: a harness that treats the first swatch as "a colour" is testing removal. */
export const TEXT_COLORS = [
  { name: "Default", value: null },
  { name: "Black", value: "#1B1E26" }, { name: "Gray", value: "#5B6270" },
  { name: "Red", value: "#C0392B" }, { name: "Orange", value: "#C2410C" },
  { name: "Green", value: "#15803D" }, { name: "Teal", value: "#0E7490" },
  { name: "Blue", value: "#1D4ED8" }, { name: "Purple", value: "#6D28D9" },
];

/** Highlights. Pale on purpose — a highlight has to leave the text on top of it readable, which
 *  is the same WCAG reasoning the chrome tokens follow, applied to content. */
export const HIGHLIGHT_COLORS = [
  { name: "None", value: null },
  { name: "Yellow", value: "#FEF08A" }, { name: "Green", value: "#BBF7D0" },
  { name: "Blue", value: "#BFDBFE" }, { name: "Pink", value: "#FBCFE8" },
  { name: "Orange", value: "#FED7AA" }, { name: "Purple", value: "#DDD6FE" },
];

export const FONTS = [
  { label: "Default", value: null }, { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" }, { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Calibri", value: "Calibri, Candara, sans-serif" }, { label: "Courier New", value: "'Courier New', Courier, monospace" },
];

/** ⛔ THE PRESET LADDER (NEW-4, toolbar redesign, 2026-09-24) — no leading `null`/floor any more.
 *  A size box that shows "Default" or bottoms out at 9 both read as "there is no real answer
 *  below this" — the toolbar's size control now carries its own typed stepper (4–400, any
 *  integer) beside this list, so `null` is never needed as a pickable row; the caret's real,
 *  resolved size is what the closed box shows instead (see notesResolvedValue.js). */
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 36, 48, 72];

/** The size a brand-new note (or any run with no explicit size) renders at. Matches
 *  `NOTE_BODY_FONT_PX` in NoteEditor.jsx — the two cannot drift, since both are read at the
 *  same 2026-09-24 redesign that moved the body default down from 15px. */
export const DEFAULT_SIZE = 11;

/** A typed size must land somewhere real: not so small it disappears, not so large a single
 *  run could blow out a page's layout beyond recovery. */
export const SIZE_MIN = 4;
export const SIZE_MAX = 400;
