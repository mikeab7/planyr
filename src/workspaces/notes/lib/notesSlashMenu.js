/* notesSlashMenu — type `/` and the block turns into whatever you name (NEW-1).
 *
 * ⛔ THE WHOLE FEATURE IS ONE RULE, AND IT IS A RULE ABOUT WHEN **NOT** TO FIRE.
 * A slash is an ordinary character in ordinary writing — `and/or`, `24/7`, `w/`, and every
 * URL anyone ever pastes. A command menu that opens on any `/` is not a feature, it is a
 * thing that interrupts you while you type a date. So the trigger is deliberately narrow
 * and it is stated once, here:
 *
 *   the `/` must be the FIRST character of the block, or be preceded by WHITESPACE,
 *   and what follows it must contain no whitespace and stay short.
 *
 * That single test is what makes `and/or` inert (preceded by `d`), a pasted
 * `https://planyr.io/notes` inert (preceded by `:` and by `o`), and `w/o` inert. It is
 * `slashQueryFromText` below — a PURE function of the text before the caret, which is why
 * it can be unit-tested exhaustively against those exact strings with no browser anywhere
 * near it (test/notesSlashMenu.test.js).
 *
 * ⛔ AND THE SECOND RULE: BACKSPACING PAST THE `/` LEAVES THE `/` AS ORDINARY TEXT.
 * Nothing here consumes the slash while the menu is open. The menu is a READING of the
 * document, recomputed on every transaction — so deleting back through the query simply
 * makes the reading stop matching, and the character the user typed is still where they
 * typed it. There is no "insert a marker node" step to undo, which is the shape that makes
 * a slash menu leave litter behind in other editors.
 *
 * WHAT IS PURE AND WHAT IS NOT. `SLASH_COMMANDS`, `slashQueryFromText`, `filterSlashCommands`
 * and `stepIndex` are pure and carry the whole of the decision. The Tiptap extension below
 * is a thin shell: it reads the document, publishes `{ open, query, items, index, from, to }`
 * to React through one callback, and owns the four keys (↑ ↓ Enter Esc) at a priority ABOVE
 * the default keymap so Enter picks an item instead of splitting the paragraph.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/** How long a `/query` may get before we conclude this is prose, not a command. Nobody
 *  types a twenty-character command name; a URL path segment easily runs longer. */
export const SLASH_MAX_QUERY = 20;

/* THE CATALOGUE. `keywords` is what the filter matches on beyond the label, so "bullet"
 * finds the bulleted list and "todo"/"task" both find the checklist — the words someone
 * reaches for are not always the words on the button. Order is the order shown. */
export const SLASH_COMMANDS = [
  { id: "h1", label: "Heading 1", hint: "Big section title", keywords: ["h1", "title", "heading"] },
  { id: "h2", label: "Heading 2", hint: "Section title", keywords: ["h2", "heading"] },
  { id: "h3", label: "Heading 3", hint: "Sub-section", keywords: ["h3", "heading"] },
  { id: "h4", label: "Heading 4", hint: "Small heading", keywords: ["h4", "heading"] },
  { id: "paragraph", label: "Body text", hint: "Plain paragraph", keywords: ["body", "text", "paragraph", "normal"] },
  { id: "bulletList", label: "Bulleted list", hint: "A list of points", keywords: ["bullet", "list", "unordered", "ul"] },
  { id: "orderedList", label: "Numbered list", hint: "A list in order", keywords: ["number", "ordered", "list", "ol"] },
  { id: "taskList", label: "Checklist", hint: "Things to tick off", keywords: ["task", "todo", "check", "checkbox"] },
  { id: "table", label: "Table", hint: "Rows and columns", keywords: ["table", "grid"] },
  { id: "image", label: "Image", hint: "Pick a picture", keywords: ["image", "picture", "photo"] },
  { id: "attachment", label: "Attachment", hint: "Any file — PDF, XLSX, DWG", keywords: ["file", "attach", "pdf", "xlsx", "dwg", "upload"] },
  { id: "sketch", label: "Sketch", hint: "Boxes and arrows", keywords: ["sketch", "diagram", "box", "chart", "flow"] },
  { id: "divider", label: "Divider", hint: "A horizontal rule", keywords: ["divider", "rule", "hr", "line", "separator"] },
  { id: "callout", label: "Callout", hint: "A coloured note block", keywords: ["callout", "note", "info", "warning", "admonition"] },
  { id: "toggle", label: "Toggle", hint: "A section that folds away", keywords: ["toggle", "collapse", "fold", "details", "accordion"] },
];

/** THE TRIGGER TEST, and the whole of it. `before` is the plain text of the current block
 *  from its start up to the caret.
 *
 *  Returns `{ query, slashOffset }` when a slash menu should be open — `slashOffset` being
 *  how many characters back from the caret the `/` sits, so the caller can turn it into a
 *  document range without this function knowing what a document is. Returns null otherwise,
 *  which is the answer for the overwhelming majority of typing. */
export function slashQueryFromText(before) {
  const text = String(before == null ? "" : before);
  const at = text.lastIndexOf("/");
  if (at < 0) return null;

  // Mid-word is the case this whole function exists to refuse: `and/or`, `w/o`, `24/7`,
  // and every `://` and `/` inside a pasted URL.
  const prev = at > 0 ? text[at - 1] : "";
  if (prev && !/\s/.test(prev)) return null;

  const query = text.slice(at + 1);
  if (/\s/.test(query)) return null;              // a space ends the command, always
  if (query.length > SLASH_MAX_QUERY) return null; // this is prose with a slash in it
  return { query, slashOffset: text.length - at };
}

/** Filter the catalogue. An empty query shows everything, which is what makes a bare `/`
 *  a browsable menu rather than a thing you have to already know the name of. */
export function filterSlashCommands(query, commands = SLASH_COMMANDS) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return commands.slice();
  return commands.filter((c) => {
    if (c.label.toLowerCase().includes(q)) return true;
    return (c.keywords || []).some((k) => k.includes(q));
  });
}

/** Arrow-key movement, wrapping at both ends. Pure so the wrap-around is testable without
 *  a keyboard: pressing ↑ on the first item lands on the last, which is what every command
 *  palette does and what nobody notices until it is missing. */
export function stepIndex(index, delta, count) {
  if (!count) return 0;
  return ((index + delta) % count + count) % count;
}

export const slashPluginKey = new PluginKey("noteSlashMenu");

/* A block where `/` is just a character and a menu would be an intrusion. Code is the
 * obvious one — half of what anyone pastes into a code block is a path. */
const INERT_BLOCKS = new Set(["codeBlock"]);

/** Read the menu's state out of a document. This is the ONE reader; the plugin calls it on
 *  every transaction, which is what makes the menu a view of the document rather than a
 *  mode the editor can get stuck in. */
export function readSlashState(state) {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  const parent = $from.parent;
  if (!parent.isTextblock || INERT_BLOCKS.has(parent.type.name)) return null;

  const blockStart = $from.start();
  const before = state.doc.textBetween(blockStart, $from.pos, "\n", "\n");
  const hit = slashQueryFromText(before);
  if (!hit) return null;
  return { from: $from.pos - hit.slashOffset, to: $from.pos, query: hit.query };
}

/** Apply one command, having first removed the `/query` the user typed to summon it.
 *
 *  ⛔ THE DELETE AND THE INSERT ARE ONE CHAIN, so the whole thing is a single undo step:
 *  one Ctrl+Z after picking "Heading 2" must put back the paragraph AND the `/h2` you
 *  typed, not walk you backwards through the machinery.
 *
 *  `onPickFile` is how the two commands that need a real file dialog get one — the editor
 *  cannot open a file picker from a keymap, so those two hand back to React. */
export function applySlashCommand(editor, id, range, { onPickFile } = {}) {
  if (!editor || editor.isDestroyed) return false;
  const chain = () => editor.chain().focus().deleteRange(range);

  switch (id) {
    case "h1": case "h2": case "h3": case "h4":
      return chain().setNode("heading", { level: Number(id.slice(1)) }).run();
    case "paragraph": return chain().setParagraph().run();
    case "bulletList": return chain().toggleBulletList().run();
    case "orderedList": return chain().toggleOrderedList().run();
    case "taskList": return chain().toggleTaskList().run();
    case "table": return chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    case "divider": return chain().setHorizontalRule().run();
    case "sketch": return chain().boxSelection().run();
    case "callout": return chain().setNoteCallout().run();
    case "toggle": return chain().setNoteToggle().run();
    case "image": case "attachment":
      // Clear the typed command first so the `/img` is gone whether or not a file is picked
      // — an abandoned dialog must not leave the text it was summoned with on the page.
      editor.chain().focus().deleteRange(range).run();
      onPickFile?.(id);
      return true;
    default:
      return false;
  }
}

/** The extension. It owns state and keys; it renders nothing (React does that), which is
 *  what keeps the menu on Planyr theme tokens like every other surface in this module. */
export const NoteSlashMenu = Extension.create({
  name: "noteSlashMenu",

  // ABOVE the default keymap: Enter has to pick an item before the paragraph splits.
  priority: 200,

  addOptions() {
    // `onRun` exists so the two file-dialog commands can be handled by React; when it is
    // absent the extension applies the command itself, which is what the unit tests drive.
    return { onChange: null, onRun: null };
  },

  addProseMirrorPlugins() {
    const ext = this;
    return [new Plugin({
      key: slashPluginKey,

      state: {
        init() { return { open: null, index: 0, dismissedAt: null }; },
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(slashPluginKey);
          const open = readSlashState(state);

          if (meta?.dismiss) return { open: null, index: 0, dismissedAt: open ? open.from : null };
          // A dismissal lasts only as long as THAT trigger. Type a fresh `/` somewhere else
          // and the menu comes back — Escape closes this menu, it does not turn the feature off.
          const dismissed = prev.dismissedAt != null && open && open.from === prev.dismissedAt;
          if (!open || dismissed) return { open: null, index: 0, dismissedAt: open ? prev.dismissedAt : null };

          if (meta?.step != null) {
            const count = filterSlashCommands(open.query).length;
            return { open, index: stepIndex(prev.index, meta.step, count), dismissedAt: prev.dismissedAt };
          }
          // Retyping the query re-sorts what is on offer, so the highlight goes back to the
          // top rather than pointing at whatever happens to be third in the new list.
          const sameQuery = prev.open && prev.open.query === open.query && prev.open.from === open.from;
          return { open, index: sameQuery ? prev.index : 0, dismissedAt: prev.dismissedAt };
        },
      },

      view() {
        return {
          update(view, prevState) {
            const now = slashPluginKey.getState(view.state);
            const was = slashPluginKey.getState(prevState);
            if (now === was) return;
            const items = now.open ? filterSlashCommands(now.open.query) : [];
            ext.options.onChange?.(now.open
              ? { open: true, query: now.open.query, from: now.open.from, to: now.open.to, items, index: now.index }
              : { open: false, query: "", from: 0, to: 0, items: [], index: 0 });
          },
          destroy() { ext.options.onChange?.({ open: false, query: "", from: 0, to: 0, items: [], index: 0 }); },
        };
      },

      props: {
        handleKeyDown(view, event) {
          const st = slashPluginKey.getState(view.state);
          if (!st?.open) return false;
          const items = filterSlashCommands(st.open.query);

          if (event.key === "Escape") {
            view.dispatch(view.state.tr.setMeta(slashPluginKey, { dismiss: true }));
            return true;
          }
          // Nothing matched — the menu is closed on screen, so its keys must be inert too,
          // or Enter would swallow a paragraph break for a menu the user cannot see.
          if (!items.length) return false;

          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            view.dispatch(view.state.tr.setMeta(slashPluginKey, { step: event.key === "ArrowDown" ? 1 : -1 }));
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            const pick = items[Math.min(st.index, items.length - 1)];
            if (!pick) return false;
            ext.options.onRun
              ? ext.options.onRun(pick.id, { from: st.open.from, to: st.open.to })
              : applySlashCommand(ext.editor, pick.id, { from: st.open.from, to: st.open.to });
            return true;
          }
          return false;
        },
      },
    })];
  },
});

export default NoteSlashMenu;
