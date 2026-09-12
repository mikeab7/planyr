/* platform — the ONE place that answers "is this machine a Mac", and the ONE formatter that
 * turns a chord's tokens into the string this machine's user actually expects to see.
 *
 * The precedent is `notes/lib/notesQuickOpen.js`'s `isApple()`/`QUICK_OPEN_KEY` — same test,
 * same reasoning (Mac users read ⌘, everyone else reads "Ctrl"). That one stays where it is
 * (it is a tiny leaf inside the Notes lazy chunk and has its own guarded contract); this is the
 * shared copy for every OTHER caller — the shortcuts page, and any future one — so a second
 * chord formatter doesn't get hand-rolled at the next call site.
 */

export function isApplePlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
}

/* Mac shows the real modifier glyphs, in the order macOS itself uses in its own menus
 * (⌃ control · ⌥ option · ⇧ shift · ⌘ command), with no separator. Everywhere else shows the
 * words, joined with "+" — the convention every one of this app's own title=/aria-label hints
 * and placeholders already use ("Ctrl/⌘+Shift+F", "Ctrl+K"). */
const MAC_MOD_ORDER = ["ctrl", "alt", "shift", "mod"];
const MAC_SYMBOL = { ctrl: "⌃", alt: "⌥", shift: "⇧", mod: "⌘" };
const WORD = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", mod: "Ctrl" };
const MAC_WORD_MOD = { ctrl: "Ctrl", alt: "Option", shift: "Shift", mod: "Cmd" };

const KEY_LABELS = {
  esc: "Esc", escape: "Esc", enter: "Enter", return: "Enter", tab: "Tab", space: "Space",
  delete: "Delete", del: "Delete", backspace: "Backspace",
  arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→",
  up: "↑", down: "↓", left: "←", right: "→",
  pageup: "Page Up", pagedown: "Page Down", home: "Home", end: "End",
  insert: "Insert", contextmenu: "Menu", wheel: "Scroll",
};

function keyLabel(token) {
  const low = String(token).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(KEY_LABELS, low)) return KEY_LABELS[low];
  if (token.length === 1) return token.toUpperCase();
  return token;
}

/**
 * Render a chord for display. `tokens` is an array of modifier names ("mod"/"ctrl"/"shift"/"alt"
 * — "mod" is the platform's own primary modifier, Ctrl on Windows/Linux and ⌘ on Mac) followed
 * by exactly one terminal key token (a literal character, or a name from KEY_LABELS above).
 *
 * One function, so the page and any future tooltip can never spell the same chord two ways.
 */
export function formatCombo(tokens, { mac = isApplePlatform() } = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) return "";
  const mods = tokens.slice(0, -1);
  const key = keyLabel(tokens[tokens.length - 1]);
  if (mac) {
    const parts = MAC_MOD_ORDER.filter((m) => mods.includes(m)).map((m) => MAC_SYMBOL[m]);
    return [...parts, key].join("");
  }
  const parts = mods.map((m) => WORD[m] || m);
  return [...parts, key].join("+");
}

/** The same chord, spelled out in words on every platform (Mac included) — for a spoken/
 *  screen-reader label, where a glyph like ⌘ has no guaranteed pronunciation. */
export function comboAriaLabel(tokens, { mac = isApplePlatform() } = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) return "";
  const mods = tokens.slice(0, -1);
  const key = keyLabel(tokens[tokens.length - 1]);
  const wordFor = mac ? MAC_WORD_MOD : WORD;
  const parts = (mac ? MAC_MOD_ORDER.filter((m) => mods.includes(m)) : mods).map((m) => wordFor[m] || m);
  return [...parts, key].join(" + ");
}
