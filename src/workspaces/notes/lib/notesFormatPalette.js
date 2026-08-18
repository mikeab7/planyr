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

/** Point sizes, with `null` meaning "whatever the block already is". */
export const SIZES = [null, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];
