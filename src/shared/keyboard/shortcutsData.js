/* shortcutsData — THE ONE LIST OF EVERY KEYBOARD SHORTCUT THIS APP REGISTERS, and the source the
 * Keyboard Shortcuts page (src/app/ShortcutsPage.jsx) reads.
 *
 * Built from a real sweep of the codebase (NEW-1, owner ask 2026-09-12: "there should be a page
 * for keyboard shortcuts so that this knowledge isn't hidden ... a shortcuts page that is wrong
 * is worse than none"), not from memory or guesswork. Every item below either:
 *
 *   (a) is DERIVED from a real declared contract this app already keeps for its own dispatch
 *       (the Site Planner's `lib/keyContract.js` KEY_CONTRACT — see `siteItems()` below), so it
 *       can never silently drift from what the handler actually does, or
 *   (b) is hand-entered from a module with no such contract, carrying an `evidence` pointer
 *       (file + an exact literal that must still appear in that file) that
 *       `test/shortcutsPage.test.js` asserts on every run — so if the cited code changes shape,
 *       the build fails LOUDLY instead of this page quietly going stale.
 *
 * ⛔ KEEPING IT TRUE, going forward: adding, changing or removing a keyboard shortcut anywhere in
 * this app should update the matching entry here IN THE SAME COMMIT (the same discipline as a
 * folder's `CLAUDE.md` pointer, or `MAP.md` for symbols) — do not leave a fresh shortcut to be
 * rediscovered by the next sweep. The `evidence` guard catches drift/removal; it cannot catch an
 * addition nobody told this file about.
 */
import { KEY_CONTRACT } from "../../workspaces/site-planner/lib/keyContract.js";

/** One shortcut. `combo` is an array of tokens `formatCombo` (./platform.js) renders for the
 *  current platform ("mod" = Ctrl on Windows/Linux, ⌘ on Mac). `keysText` is a pre-composed,
 *  platform-neutral string for a gesture that isn't a plain modifier+key chord (a mouse click,
 *  a held key with no terminal keystroke). Exactly one of the two is set. */
function item({ id, label, combo, keysText, note, evidence, group }) {
  return { id, label, combo: combo || null, keysText: keysText || null, note: note || null, evidence: evidence || [], group: group || null };
}

/** Split a flat item list into `{label, items}` groups, in the given label order — skipping any
 *  group nobody used and putting an ungrouped item's remainder under `fallback`. */
function groupItems(items, order, fallback) {
  const byLabel = new Map(order.map((l) => [l, []]));
  for (const it of items) {
    const label = it.group && byLabel.has(it.group) ? it.group : fallback;
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(it);
  }
  return [...byLabel.entries()].filter(([, list]) => list.length > 0).map(([label, list]) => ({ label, items: list }));
}

/* ── Site Planner: derived from the real dispatch table, not hand-copied ─────────────────────── */

const SITE_GROUP_OF = {
  "tool-select": "Tools", "tool-marquee": "Tools", "toggle-snap": "Tools", "tool-callout": "Tools",
  "tool-text": "Tools", "tool-mline": "Tools", "tool-mrect": "Tools", "tool-mellipse": "Tools",
  "tool-mpolygon": "Tools", "tool-mpolyline": "Tools", "tool-mcloud": "Tools", "hand-pan": "Tools",
  copy: "Editing", cut: "Editing", paste: "Editing", duplicate: "Editing", group: "Editing",
  "autosize-text": "Editing", commit: "Editing", nudge: "Editing", delete: "Editing",
  undo: "Editing", redo: "Editing", "arrange-forward": "Editing", "arrange-backward": "Editing",
  escape: "General",
};

/* A handful of ids need a friendlier label/note than the bare contract entry, or expand into
 * more than one row (the bracket "arrange" chord is really two chords crossed with Shift). Never
 * override the KEYS themselves here — those always come straight from KEY_CONTRACT, so the combo
 * shown can't disagree with what the handler tests. */
const SITE_OVERRIDES = {
  copy: { note: "Copies the selection, or a selected reference image." },
  paste: { note: "Pastes at the cursor; works across two plans of the same project." },
  "tool-mcloud": { note: "A bare C — different from Ctrl/⌘+C (Copy)." },
  nudge: { note: "Hold Shift for a bigger step." },
  commit: { label: "Finish drawing, merge selected parcels, or open the selected pond's inspector" },
  escape: { label: "Cancel the active tool / close the open inspector or menu" },
};

function tokensFor(entry) {
  const mods = [];
  if (entry.mod === "mod") mods.push("mod");
  if (entry.mod === "shift") mods.push("shift");
  if (entry.mod === "alt") mods.push("alt");
  let key = (entry.keys && entry.keys[0]) || (entry.codes && entry.codes[0]) || "";
  if (key === " ") key = "space";
  if (key === "KeyZ") key = "z";
  return [...mods, key];
}

function siteItems() {
  const items = [];
  for (const entry of KEY_CONTRACT) {
    if (entry.id === "arrange") continue; // handled explicitly below — one entry, two chords
    const over = SITE_OVERRIDES[entry.id] || {};
    items.push(item({
      id: `site.${entry.id}`,
      label: over.label || entry.label,
      combo: tokensFor(entry),
      note: over.note,
      group: SITE_GROUP_OF[entry.id] || "Editing",
      evidence: [{ file: "src/workspaces/site-planner/lib/keyContract.js", pattern: `id: "${entry.id}"` }],
    }));
  }
  items.push(item({
    id: "site.arrange-forward", label: "Bring forward one step (Shift = bring to front)",
    combo: ["mod", "]"], group: SITE_GROUP_OF["arrange-forward"],
    note: "Shift+] brings the selection all the way to the front.",
    evidence: [{ file: "src/workspaces/site-planner/SitePlanner.jsx", pattern: 'e.code === "BracketRight" || e.code === "BracketLeft"' }],
  }));
  items.push(item({
    id: "site.arrange-backward", label: "Send backward one step (Shift = send to back)",
    combo: ["mod", "["], group: SITE_GROUP_OF["arrange-backward"],
    note: "Shift+[ sends the selection all the way to the back.",
    evidence: [{ file: "src/workspaces/site-planner/SitePlanner.jsx", pattern: 'e.code === "BracketRight" || e.code === "BracketLeft"' }],
  }));
  return items;
}

const SITE_GESTURES = [
  item({ id: "site.g-constrain", label: "Constrain a drag while drawing (square / circle / 45°)", keysText: "Shift + drag" }),
  item({ id: "site.g-finish", label: "Finish a polygon or polyline", keysText: "Double-click, or Enter" }),
  item({ id: "site.g-close", label: "Close a shape back to its own start", keysText: "Click the first dot" }),
  item({ id: "site.g-vertex-add", label: "Add a vertex on an edge", keysText: "Click the + on the edge" }),
  item({ id: "site.g-vertex-del", label: "Delete a vertex", keysText: "Shift + click the vertex" }),
  item({ id: "site.g-menu", label: "Open a feature's actions menu", keysText: "Right-click" }),
  item({ id: "site.g-edit-in-group", label: "Edit one member of a group in place", keysText: "Double-click inside the group" }),
  item({ id: "site.g-bypass-snap", label: "Place or drag freely, ignoring snap for one move", keysText: "Alt + drag" }),
  item({
    id: "site.g-pick-stack", label: "Choose which overlapping feature to act on",
    keysText: "Hold Alt", note: "Over a stack of overlapping objects; then ↑/↓ to highlight one, Enter to pick it, Escape to dismiss.",
    evidence: [{ file: "src/workspaces/site-planner/SitePlanner.jsx", pattern: 'if (e.key !== "Alt" || e.repeat) return;' }],
  }),
];

const MAP_FINDER_ITEMS = [
  item({
    id: "site.map-enter", label: "Confirm the map's current suggestion (place a comp, decide on a parcel)",
    combo: ["enter"],
    evidence: [{ file: "src/workspaces/site-planner/MapFinder.jsx", pattern: "runDecideVerb(orderedVerbs[0], decideTarget)" }],
  }),
  item({
    id: "site.map-escape", label: "Close the open map menu or popover",
    combo: ["esc"],
    evidence: [{ file: "src/workspaces/site-planner/MapFinder.jsx", pattern: 'e.key === "Escape") setStatusMenu(null)' }],
  }),
  item({
    id: "site.map-reorder", label: "Reorder a group's row in the Sites list",
    combo: ["arrowup"],
    note: "↑ or ↓.",
    evidence: [{ file: "src/workspaces/site-planner/MapFinder.jsx", pattern: 'e.key === "ArrowUp") { e.preventDefault(); moveGroup(st, -1)' }],
  }),
];

const COMPS_GRID_ITEMS = [
  item({ id: "comps.nav", label: "Move the active cell", combo: ["arrowup"], note: "Arrow keys; Shift+↑/↓ extends the row range.",
    evidence: [{ file: "src/shared/comps/components/CompEntryGrid.jsx", pattern: 'e.key === "ArrowDown"' }] }),
  item({ id: "comps.tab", label: "Move to the next / previous cell", combo: ["tab"], note: "Shift+Tab moves back.",
    evidence: [{ file: "src/shared/comps/components/CompEntryGrid.jsx", pattern: 'e.key === "Tab" && e.shiftKey' }] }),
  item({ id: "comps.edit", label: "Edit the selected cell", combo: ["f2"],
    evidence: [{ file: "src/shared/comps/components/CompEntryGrid.jsx", pattern: 'e.key === "F2"' }] }),
  item({ id: "comps.clear", label: "Clear the selected cell(s)", combo: ["del"],
    evidence: [{ file: "src/shared/comps/components/CompEntryGrid.jsx", pattern: 'e.key === "Delete" || e.key === "Backspace"' }] }),
  item({ id: "comps.remove-row", label: "Remove the selected row(s)", combo: ["shift", "del"],
    evidence: [{ file: "src/shared/comps/components/CompEntryGrid.jsx", pattern: 'e.key === "Delete" && e.shiftKey' }] }),
  item({ id: "comps.undo", label: "Undo", combo: ["mod", "z"],
    evidence: [{ file: "src/shared/comps/components/CompEntryGrid.jsx", pattern: 'e.key.toLowerCase() === "z"' }] }),
  item({ id: "comps.filldown", label: "Fill the top row of the selection down", combo: ["mod", "d"],
    evidence: [{ file: "src/shared/comps/components/CompEntryGrid.jsx", pattern: 'e.key.toLowerCase() === "d"' }] }),
];

/* ── Schedule (the embedded Gantt/grid at public/sequence/index.html) ────────────────────────── */

const SCHEDULE_GRID_ITEMS = [
  item({ id: "sched.insert", label: "Add a task", combo: ["insert"],
    evidence: [{ file: "public/sequence/index.html", pattern: 'e.key === "Insert" && !typing' }] }),
  item({ id: "sched.delete", label: "Delete the selected task(s), or clear the selected cell/range", combo: ["del"],
    evidence: [{ file: "public/sequence/index.html", pattern: 'e.key === "Delete" && !typing' }] }),
  item({ id: "sched.undo", label: "Undo", combo: ["mod", "z"],
    evidence: [{ file: "public/sequence/index.html", pattern: 'Fix #8: Ctrl/Cmd+Z' }] }),
  item({ id: "sched.redo", label: "Redo", combo: ["mod", "y"], note: "Ctrl/⌘+Y or Ctrl/⌘+Shift+Z.",
    evidence: [{ file: "public/sequence/index.html", pattern: 'k === "y" || (k === "z" && e.shiftKey)' }] }),
  item({ id: "sched.copy", label: "Copy the selected task and its subtree", combo: ["mod", "c"],
    evidence: [{ file: "public/sequence/index.html", pattern: 'k === "c" && !e.shiftKey && selectedId !== null' }] }),
  item({ id: "sched.cut", label: "Cut the selected task", combo: ["mod", "x"],
    evidence: [{ file: "public/sequence/index.html", pattern: 'k === "x" && !e.shiftKey && selectedId !== null' }] }),
  item({ id: "sched.paste", label: "Paste as a sibling after the selected task", combo: ["mod", "v"],
    evidence: [{ file: "public/sequence/index.html", pattern: "pasteTaskAfter(selectedId)" }] }),
  item({ id: "sched.indent", label: "Indent (make a subtask of the row above)", combo: ["alt", "shift", "arrowright"],
    evidence: [{ file: "public/sequence/index.html", pattern: 'e.altKey && e.shiftKey && e.key === "ArrowRight"' }] }),
  item({ id: "sched.outdent", label: "Outdent (promote one level up)", combo: ["alt", "shift", "arrowleft"],
    evidence: [{ file: "public/sequence/index.html", pattern: 'e.altKey && e.shiftKey && e.key === "ArrowLeft"' }] }),
  item({ id: "sched.tab", label: "Move to the next / previous column", combo: ["tab"], note: "Shift+Tab moves back.",
    evidence: [{ file: "public/sequence/index.html", pattern: 'Fix #2: Tab / Shift+Tab' }] }),
  item({ id: "sched.extend", label: "Extend the selection", combo: ["shift", "arrowdown"], note: "Shift + any arrow key.",
    evidence: [{ file: "public/sequence/index.html", pattern: "Fix #9: Shift+Arrow" }] }),
  item({ id: "sched.select-row", label: "Select the entire current row", combo: ["shift", "space"],
    evidence: [{ file: "public/sequence/index.html", pattern: 'Shift+Space — select entire current row' }] }),
  item({ id: "sched.edit", label: "Edit the selected cell (or open its picker)", combo: ["enter"], note: "Enter or F2.",
    evidence: [{ file: "public/sequence/index.html", pattern: 'e.key === "Enter" || e.key === "F2"' }] }),
  item({ id: "sched.picker", label: "Open the Health / Status picker", combo: ["alt", "arrowdown"],
    evidence: [{ file: "public/sequence/index.html", pattern: "Alt+Down — open picker for health and status columns" }] }),
  item({ id: "sched.nav", label: "Move the active cell", combo: ["arrowdown"], note: "Plain arrow keys.",
    evidence: [{ file: "public/sequence/index.html", pattern: "Plain arrow keys — cell navigation" }] }),
];

const SCHEDULE_SUGGESTIONS_ITEMS = [
  item({ id: "sched.sug-next", label: "Next suggested task", combo: ["j"], note: "J or →.",
    evidence: [{ file: "public/sequence/index.html", pattern: "k === 'j' || e.key === 'ArrowRight'" }] }),
  item({ id: "sched.sug-prev", label: "Previous suggested task", combo: ["k"], note: "K or ←.",
    evidence: [{ file: "public/sequence/index.html", pattern: "k === 'k' || e.key === 'ArrowLeft'" }] }),
  item({ id: "sched.sug-approve", label: "Approve the current suggestion", combo: ["a"], note: "A or Enter.",
    evidence: [{ file: "public/sequence/index.html", pattern: "k === 'a' || e.key === 'Enter'" }] }),
  item({ id: "sched.sug-dismiss", label: "Dismiss the current suggestion", combo: ["x"], note: "X, Backspace, or Delete.",
    evidence: [{ file: "public/sequence/index.html", pattern: "k === 'x' || e.key === 'Backspace' || e.key === 'Delete'" }] }),
  item({ id: "sched.sug-view", label: "Switch between Grid and Gantt view", combo: ["g"],
    evidence: [{ file: "public/sequence/index.html", pattern: "setView(v => v === 'grid' ? 'gantt' : 'grid')" }] }),
  item({ id: "sched.sug-undo", label: "Undo the last approve/dismiss", combo: ["u"],
    evidence: [{ file: "public/sequence/index.html", pattern: "k === 'u') { e.preventDefault(); doUndo()" }] }),
];

/* ── Review (Document Review + the Stitcher) ─────────────────────────────────────────────────── */

const REVIEW_ITEMS = [
  item({ id: "review.undo", label: "Undo (peels a mid-draft vertex first)", combo: ["mod", "z"],
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: 'mod && (e.key === "z" || e.key === "Z")' }] }),
  item({ id: "review.redo", label: "Redo", combo: ["mod", "y"], note: "Ctrl/⌘+Y or Ctrl/⌘+Shift+Z.",
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: 'mod && (e.key === "y" || e.key === "Y")' }] }),
  item({ id: "review.copy", label: "Copy the selected markup", combo: ["mod", "c"],
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: "copyMarkup()) e.preventDefault()" }] }),
  item({ id: "review.cut", label: "Cut the selected markup", combo: ["mod", "x"],
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: "cutMarkup()) e.preventDefault()" }] }),
  item({ id: "review.paste", label: "Paste at the cursor", combo: ["mod", "v"],
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: "pasteMarkup()) e.preventDefault()" }] }),
  item({ id: "review.forward", label: "Bring forward one step (Shift = to front)", combo: ["mod", "]"],
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: 'e.code === "BracketRight" || e.code === "BracketLeft"' }] }),
  item({ id: "review.backward", label: "Send backward one step (Shift = to back)", combo: ["mod", "["],
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: 'e.code === "BracketRight" || e.code === "BracketLeft"' }] }),
  item({ id: "review.pan", label: "Temporary pan", combo: ["space"], note: "Hold Space, then drag.",
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: 'hold-Space = pan' }] }),
  item({ id: "review.finish", label: "Finish the current markup draft", combo: ["enter"],
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: 'e.key === "Enter") { e.preventDefault(); finishDraft()' }] }),
  item({ id: "review.escape", label: "Close the open menu/panel, or cancel the current draft", combo: ["esc"],
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: 'else if (e.key === "Escape") {' }] }),
  item({ id: "review.delete", label: "Delete the selected markup(s)", combo: ["del"],
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: 'e.key === "Delete" || e.key === "Backspace"' }] }),
  item({ id: "review.prev-page", label: "Previous sheet", combo: ["arrowleft"], note: "← or Page Up.",
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: 'e.key === "ArrowLeft" || e.key === "PageUp"' }] }),
  item({ id: "review.next-page", label: "Next sheet", combo: ["arrowright"], note: "→ or Page Down.",
    evidence: [{ file: "src/workspaces/doc-review/DocReview.jsx", pattern: 'e.key === "ArrowRight" || e.key === "PageDown"' }] }),
];

/* ── Library ──────────────────────────────────────────────────────────────────────────────────── */

const LIBRARY_ITEMS = [
  item({ id: "library.search-clear", label: "Clear the search box", combo: ["esc"],
    evidence: [{ file: "src/workspaces/library/components/FileBrowser.jsx", pattern: 'e.key === "Escape") setSearchQ("")' }] }),
  item({ id: "library.menu-close", label: "Close the open folder menu", combo: ["esc"],
    evidence: [{ file: "src/workspaces/library/components/FolderTree.jsx", pattern: 'e.key === "Escape") setMenu(null)' }] }),
  item({ id: "library.rename", label: "Commit / cancel a folder rename", combo: ["enter"], note: "Enter commits, Escape cancels.",
    evidence: [{ file: "src/workspaces/library/components/FolderTree.jsx", pattern: "commitRename()" }] }),
];

/* ── Notes ────────────────────────────────────────────────────────────────────────────────────── */

const NOTES_ITEMS = [
  item({ id: "notes.quickopen", label: "Jump to any note by name", combo: ["mod", "k"],
    evidence: [{ file: "src/workspaces/notes/lib/notesQuickOpen.js", pattern: "QUICK_OPEN_KEY" }] }),
  item({ id: "notes.paste-plain", label: "Paste as plain text", combo: ["mod", "shift", "v"],
    evidence: [{ file: "src/workspaces/notes/components/NoteEditor.jsx", pattern: '!(e.key === "V" || e.key === "v") || !e.shiftKey || !(e.ctrlKey || e.metaKey)' }] }),
  item({ id: "notes.zoom-in", label: "Zoom in", combo: ["mod", "+"], note: "Or Ctrl/⌘ + scroll wheel.",
    evidence: [{ file: "src/workspaces/notes/lib/notesZoom.js", pattern: 'key === "=" || key === "+" || key === "Add"' }] }),
  item({ id: "notes.zoom-out", label: "Zoom out", combo: ["mod", "-"],
    evidence: [{ file: "src/workspaces/notes/lib/notesZoom.js", pattern: 'key === "-" || key === "_" || key === "Subtract"' }] }),
  item({ id: "notes.zoom-reset", label: "Reset zoom to 100%", combo: ["mod", "0"],
    evidence: [{ file: "src/workspaces/notes/lib/notesZoom.js", pattern: 'key === "0") return ZOOM_DEFAULT' }] }),
  item({ id: "notes.bold", label: "Bold", combo: ["mod", "b"], evidence: [{ file: "package.json", pattern: '"@tiptap/starter-kit"' }] }),
  item({ id: "notes.italic", label: "Italic", combo: ["mod", "i"], evidence: [{ file: "package.json", pattern: '"@tiptap/starter-kit"' }] }),
  item({ id: "notes.underline", label: "Underline", combo: ["mod", "u"], evidence: [{ file: "package.json", pattern: '"@tiptap/starter-kit"' }] }),
  item({ id: "notes.strike", label: "Strikethrough", combo: ["mod", "shift", "s"], evidence: [{ file: "package.json", pattern: '"@tiptap/starter-kit"' }] }),
  item({ id: "notes.bullets", label: "Bulleted list", combo: ["mod", "shift", "8"], evidence: [{ file: "package.json", pattern: '"@tiptap/extension-list"' }] }),
  item({ id: "notes.numbers", label: "Numbered list", combo: ["mod", "shift", "7"], evidence: [{ file: "package.json", pattern: '"@tiptap/extension-list"' }] }),
  item({ id: "notes.checklist", label: "Checklist", combo: ["mod", "shift", "9"], evidence: [{ file: "package.json", pattern: '"@tiptap/extension-list"' }] }),
  item({ id: "notes.highlight", label: "Highlight", combo: ["mod", "shift", "h"], evidence: [{ file: "package.json", pattern: '"@tiptap/extension-highlight"' }] }),
  item({ id: "notes.align", label: "Align left / center / right / justify", combo: ["mod", "shift", "l"], note: "…⇧E center, ⇧R right, ⇧J justify.",
    evidence: [{ file: "package.json", pattern: '"@tiptap/extension-text-align"' }] }),
  item({ id: "notes.slash", label: "Open the block-type menu", combo: ["/"], note: "At the start of a line, or after a space.",
    evidence: [{ file: "src/workspaces/notes/lib/notesSlashMenu.js", pattern: "↑ ↓ Enter Esc) at a priority ABOVE" }] }),
  item({ id: "notes.indent", label: "Indent / outdent the current list item", combo: ["tab"], note: "Tab / Shift+Tab.",
    evidence: [{ file: "src/workspaces/notes/lib/notesListIndent.js", pattern: "Tab changes the LEVEL of" }] }),
  item({ id: "notes.box-nudge", label: "Nudge a selected box or picture", combo: ["arrowup"], note: "Arrow keys, while a box is selected.",
    evidence: [{ file: "src/workspaces/notes/CLAUDE.md", pattern: "The box-nudge binding (B421494) is on the" }] }),
  item({ id: "notes.box-delete", label: "Delete a selected box or picture", combo: ["del"],
    evidence: [{ file: "src/workspaces/notes/CLAUDE.md", pattern: "arrows nudge; Delete removes all of it as one undo" }] }),
  item({ id: "notes.row-open", label: "Open the focused page", combo: ["enter"], note: "Enter or Space.",
    evidence: [{ file: "src/workspaces/notes/components/NotesTree.jsx", pattern: 'e.key === "Enter" || e.key === " "' }] }),
  item({ id: "notes.row-expand", label: "Expand / collapse the focused page's children", combo: ["arrowright"], note: "→ expands, ← collapses.",
    evidence: [{ file: "src/workspaces/notes/components/NotesTree.jsx", pattern: 'e.key === "ArrowRight" && hasChildren && !expanded' }] }),
  item({ id: "notes.row-menu", label: "Open the focused page's right-click menu", keysText: "Menu key, or Shift+F10",
    evidence: [{ file: "src/workspaces/notes/components/NotesTree.jsx", pattern: 'e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")' }] }),
];

/* ── Spreadsheet (the "model" workspace) ──────────────────────────────────────────────────────── */

const SPREADSHEET_ITEMS = [
  item({ id: "sheet.nav", label: "Move the active cell", combo: ["arrowup"], note: "Arrow keys; Shift extends the selection.",
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: 'e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight"' }] }),
  item({ id: "sheet.tab", label: "Move to the next / previous cell", combo: ["tab"], note: "Shift+Tab moves back.",
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: 'e.key === "Tab") { e.preventDefault(); const c = stepCol' }] }),
  item({ id: "sheet.enter", label: "Move down / up a row", combo: ["enter"], note: "Enter moves down, Shift+Enter moves up.",
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: 'e.key === "Enter") { e.preventDefault(); const r = Math.max' }] }),
  item({ id: "sheet.edit", label: "Edit the active cell", combo: ["f2"],
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: 'e.key === "F2") { e.preventDefault(); startEdit' }] }),
  item({ id: "sheet.clear", label: "Clear the selected range", combo: ["del"],
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: "onBlankRange(r1, r2, c1, c2)" }] }),
  item({ id: "sheet.home", label: "Jump to cell A1", combo: ["mod", "home"],
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: 'e.key === "Home") { e.preventDefault(); jumpTo(0, 0)' }] }),
  item({ id: "sheet.end", label: "Jump to the last used cell", combo: ["mod", "end"],
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: "usedRangeEnd(sheet)" }] }),
  item({ id: "sheet.block-jump", label: "Jump to the edge of the current block of data", combo: ["mod", "arrowdown"], note: "Ctrl/⌘ + any arrow key.",
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: "ctrlArrowTarget(hasContent" }] }),
  item({ id: "sheet.copy", label: "Copy", combo: ["mod", "c"],
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: 'k === "c") { e.preventDefault(); onCopy' }] }),
  item({ id: "sheet.paste", label: "Paste", combo: ["mod", "v"],
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: 'k === "v") { e.preventDefault(); onPaste' }] }),
  item({ id: "sheet.filldown", label: "Fill the top row of the selection down", combo: ["mod", "d"],
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: 'k === "d") { e.preventDefault(); onFillDown' }] }),
  item({ id: "sheet.zoom", label: "Zoom the sheet", keysText: "Ctrl/⌘ + scroll wheel",
    evidence: [{ file: "src/workspaces/model/components/SheetView.jsx", pattern: "zoomFromWheelDelta" }] }),
  item({ id: "sheet.undo", label: "Undo", combo: ["mod", "z"],
    evidence: [{ file: "src/workspaces/model/ModelApp.jsx", pattern: 'k === "z" && !e.shiftKey) { e.preventDefault(); undo()' }] }),
  item({ id: "sheet.redo", label: "Redo", combo: ["mod", "shift", "z"], note: "Ctrl/⌘+Shift+Z or Ctrl/⌘+Y.",
    evidence: [{ file: "src/workspaces/model/ModelApp.jsx", pattern: '(k === "z" && e.shiftKey) || k === "y"' }] }),
  item({ id: "sheet.namebox", label: "Jump to a named range (Name Box)", combo: ["mod", "g"],
    evidence: [{ file: "src/workspaces/model/ModelApp.jsx", pattern: 'k === "g") { e.preventDefault(); nameBoxRef' }] }),
  item({ id: "sheet.find", label: "Find", combo: ["mod", "f"],
    evidence: [{ file: "src/workspaces/model/lib/commandRegistry.js", pattern: 'shortcut: "Ctrl+F"' }] }),
  item({ id: "sheet.replace", label: "Replace", combo: ["mod", "h"],
    evidence: [{ file: "src/workspaces/model/lib/commandRegistry.js", pattern: 'shortcut: "Ctrl+H"' }] }),
  item({ id: "sheet.palette", label: "Open the command palette", combo: ["mod", "k"],
    evidence: [{ file: "src/workspaces/model/ModelApp.jsx", pattern: 'k === "k") { e.preventDefault(); setPaletteOpen(true)' }] }),
  item({ id: "sheet.trace-clear", label: "Clear a formula trace", combo: ["esc"],
    evidence: [{ file: "src/workspaces/model/ModelApp.jsx", pattern: 'e.key === "Escape" && !e.ctrlKey && !e.metaKey' }] }),
];

/* ── Global (the app shell, and this page's own entry point) ─────────────────────────────────── */

const GLOBAL_ITEMS = [
  item({
    id: "global.shortcuts", label: "Open this Keyboard Shortcuts page", combo: ["?"],
    evidence: [{ file: "src/app/Shell.jsx", pattern: "openShortcutsPage" }],
  }),
  item({
    id: "global.fullscreen", label: "Toggle full screen", combo: ["mod", "shift", "f"],
    evidence: [{ file: "src/shared/ui/AppHeader.jsx", pattern: '(e.key === "F" || e.key === "f") && (e.ctrlKey || e.metaKey) && e.shiftKey' }],
  }),
  item({
    id: "global.fullscreen-bare", label: "Toggle full screen", combo: ["f"],
    note: "Only where nothing editable is on screen (the map, or a drawing).",
    evidence: [{ file: "src/shared/ui/AppHeader.jsx", pattern: '(e.key === "f" || e.key === "F") && !e.altKey && !writeableDocumentOnScreen()' }],
  }),
];

/** The page's own section order. `id` also names the search filter chip. */
export const SHORTCUT_SECTIONS = [
  { id: "global", label: "Global", groups: [{ label: null, items: GLOBAL_ITEMS }] },
  {
    id: "site", label: "Site", groups: [
      ...groupItems(siteItems(), ["Tools", "Editing", "General"], "Editing"),
      { label: "Mouse & drawing gestures", items: SITE_GESTURES },
      { label: "Map / site picker", items: MAP_FINDER_ITEMS },
      { label: "Comps grid", items: COMPS_GRID_ITEMS },
    ],
  },
  {
    id: "schedule", label: "Schedule", groups: [
      { label: null, items: SCHEDULE_GRID_ITEMS },
      { label: "Suggested-task review", items: SCHEDULE_SUGGESTIONS_ITEMS },
    ],
  },
  { id: "review", label: "Review", groups: [{ label: null, items: REVIEW_ITEMS }] },
  { id: "library", label: "Library", groups: [{ label: null, items: LIBRARY_ITEMS }] },
  { id: "notes", label: "Notes", groups: [{ label: null, items: NOTES_ITEMS }] },
  { id: "spreadsheet", label: "Spreadsheet", groups: [{ label: null, items: SPREADSHEET_ITEMS }] },
];

/** Flat list, for search and for the completeness/uniqueness guards in the test suite. */
export const ALL_SHORTCUT_ITEMS = SHORTCUT_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items));
