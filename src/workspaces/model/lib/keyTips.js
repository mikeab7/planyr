/* Model workspace — Excel's Alt "key-tip" sequences (press and release Alt, then letters).
 *
 * ⛔ SPEC (owner, 2026-10-29): Alt H O I = autofit column width · Alt H O A = autofit row height ·
 * plus the Home-tab paths below. Escape backs out ONE level, any unmatched key cancels, a click
 * cancels. A leaf names a command id from lib/commandRegistry.js — the key-tip never owns an action
 * of its own, so Alt H B A and the ribbon's "All borders" run literally the same function.
 *
 * Pure state machine (no DOM): ModelApp feeds it key names and runs whatever id comes back, which
 * is what the unit tests drive (Alt, H, O, I -> `autofit-column`; Escape backs out; an unknown
 * letter cancels).
 */

/** A leaf `{ run, label }` fires a command; a branch `{ label, keys }` opens the next level. */
const leaf = (run, label) => ({ run, label });
const branch = (label, keys) => ({ label, keys });

export const KEYTIP_TREE = {
  H: branch("Home", {
    "1": leaf("bold", "Bold"),
    "2": leaf("italic", "Italic"),
    "3": leaf("underline", "Underline"),
    "5": leaf("indent-decrease", "Decrease indent"),
    "6": leaf("indent-increase", "Increase indent"),
    "0": leaf("decimal-increase", "Increase decimal"),
    "9": leaf("decimal-decrease", "Decrease decimal"),
    K: leaf("thousands-toggle", "Comma style"),
    P: leaf("percent-style", "Percent style"),
    N: leaf("number-format-dialog", "Number format…"),
    W: leaf("wrap-text", "Wrap text"),
    H: leaf("fill-color-menu", "Fill colour…"),
    B: branch("Borders", {
      A: leaf("border-all", "All borders"),
      N: leaf("border-none", "No border"),
      T: leaf("border-thick-box", "Thick box border"),
      O: leaf("border-outline", "Outside borders"),
    }),
    F: branch("Font", {
      C: leaf("font-color-menu", "Font colour…"),
      P: leaf("format-painter", "Format painter"),
    }),
    A: branch("Alignment", {
      L: leaf("align-left", "Align left"),
      C: leaf("align-center", "Align centre"),
      R: leaf("align-right", "Align right"),
      T: leaf("valign-top", "Align top"),
      M: leaf("valign-middle", "Align middle"),
      B: leaf("valign-bottom", "Align bottom"),
    }),
    M: branch("Merge", {
      M: leaf("merge-cells", "Merge cells"),
      C: leaf("merge-center", "Merge & centre"),
      U: leaf("unmerge-cells", "Unmerge cells"),
    }),
    I: branch("Insert", {
      R: leaf("insert-row", "Insert row"),
      C: leaf("insert-column", "Insert column"),
    }),
    D: branch("Delete", {
      R: leaf("delete-row", "Delete row"),
      C: leaf("delete-column", "Delete column"),
    }),
    O: branch("Format", {
      I: leaf("autofit-column", "Autofit column width"),
      A: leaf("autofit-row", "Autofit row height"),
      W: leaf("column-width", "Column width…"),
      H: leaf("row-height", "Row height…"),
    }),
    E: branch("Clear", {
      A: leaf("clear-all", "Clear all"),
      F: leaf("clear-formatting", "Clear formats"),
      C: leaf("clear-contents", "Clear contents"),
    }),
    S: branch("Sort & filter", {
      S: leaf("sort-asc", "Sort A to Z"),
      O: leaf("sort-desc", "Sort Z to A"),
      F: leaf("filter-toggle", "Filter"),
    }),
  }),
  W: branch("View", {
    F: branch("Freeze panes", {
      F: leaf("freeze-toggle", "Freeze panes / unfreeze"),
      R: leaf("freeze-top-row", "Freeze top row"),
      C: leaf("freeze-first-column", "Freeze first column"),
    }),
  }),
};

export function nodeAt(path) {
  let node = { keys: KEYTIP_TREE };
  for (const ch of path) {
    node = node.keys && node.keys[ch];
    if (!node) return null;
  }
  return node;
}

/** Every leaf as `{ path, run, label }`, for tests and the help list. */
export function allKeyTips() {
  const out = [];
  const walk = (keys, prefix) => {
    for (const [k, node] of Object.entries(keys)) {
      if (node.run) out.push({ path: prefix + k, run: node.run, label: node.label });
      else walk(node.keys, prefix + k);
    }
  };
  walk(KEYTIP_TREE, "");
  return out;
}

/** The choices at the current level: `[{ key, label, leaf }]`. */
export function choicesAt(path) {
  const node = nodeAt(path);
  if (!node || !node.keys) return [];
  return Object.entries(node.keys).map(([key, n]) => ({ key, label: n.label, leaf: !!n.run }));
}

export const START = Object.freeze({ active: false, path: "" });
export const beginKeyTips = () => ({ active: true, path: "" });

/** Feed one keydown's `key` to the machine. Returns `{ state, run }`:
 *  - a letter/digit that names a branch -> deeper `state`;
 *  - one that names a leaf -> `run` = the command id and the sequence ends;
 *  - Escape / Backspace -> up one level (from the top: cancel);
 *  - Alt pressed again, or any other / unmatched key -> cancel;
 *  - a bare modifier (Shift/Control/Meta) is ignored. */
export function stepKeyTips(state, key) {
  if (!state.active) return { state, run: null };
  if (key === "Shift" || key === "Control" || key === "Meta" || key === "CapsLock") return { state, run: null };
  if (key === "Escape" || key === "Backspace") {
    return state.path.length === 0 ? { state: START, run: null } : { state: { active: true, path: state.path.slice(0, -1) }, run: null };
  }
  if (typeof key !== "string" || key.length !== 1) return { state: START, run: null };
  const ch = key.toUpperCase();
  const here = nodeAt(state.path);
  const next = here && here.keys && here.keys[ch];
  if (!next) return { state: START, run: null };
  if (next.run) return { state: START, run: next.run };
  return { state: { active: true, path: state.path + ch }, run: null };
}
