/* bareLetterGate — WHEN IS A BARE LETTER A GLOBAL COMMAND? (NEW-1, 2026-10-29)
 *
 * The only bare-letter command the app shell owns is `f` → fullscreen (AppHeader's window keydown).
 * It used to stand down for exactly two things: a focused text control, and a painted contenteditable
 * (B291538). Neither describes a type-to-edit GRID: the Spreadsheet sheet, the comp entry sheet and
 * every future cell grid is a focusable <div>/<td> that turns a printable key into "start editing
 * with that character" — so a selected-but-not-editing cell let `f` through to fullscreen and the
 * typed letter was lost. (Owner, on the Spreadsheet: "press F to start typing — the whole app goes
 * fullscreen instead of the cell starting an edit with 'f'".)
 *
 * THREE independent reasons for the letter to stay a letter, any one is enough, so a new grid
 * cannot be missed by forgetting a list:
 *   1. the key was ALREADY CONSUMED — a surface that handled it called preventDefault (React's
 *      root-delegated onKeyDown runs before a `window` listener, so the flag is set by the time
 *      the shell sees it). This protects every grid that starts an edit, today and tomorrow.
 *   2. the press landed inside an element marked `data-letters-are-text` — the declarative opt-in
 *      for a surface that owns the keyboard but may not consume a particular key.
 *   3. the active module is a document-like workspace where letters are always text, even with
 *      focus parked on <body> after a toolbar click (the Spreadsheet).
 * Fullscreen keeps two homes no typing can reach: the row-1 button and Ctrl/Cmd+Shift+F.
 */

export const LETTERS_ARE_TEXT_ATTR = "data-letters-are-text";

/** Workspaces (AppHeader `module` ids) where a bare letter is never a shell command. */
export const LETTERS_ARE_TEXT_MODULES = Object.freeze(["model"]);

/** True when `el` sits inside a surface that opted in with `data-letters-are-text`. */
export function insideLettersAreText(el) {
  return !!(el && typeof el.closest === "function" && el.closest(`[${LETTERS_ARE_TEXT_ATTR}]`));
}

/**
 * Pure verdict: may a bare `f` / `F` keydown toggle fullscreen?
 * @param {{module?:string, key:string, altKey?:boolean, defaultPrevented?:boolean,
 *          inLettersAreText?:boolean, writeableDocumentOnScreen?:boolean}} p
 */
export function bareFullscreenAllowed(p) {
  if (p.key !== "f" && p.key !== "F") return false;
  if (p.altKey) return false;
  if (p.defaultPrevented) return false;
  if (p.inLettersAreText) return false;
  if (LETTERS_ARE_TEXT_MODULES.includes(p.module)) return false;
  if (p.writeableDocumentOnScreen) return false;
  return true;
}
