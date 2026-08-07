/* notesPastePlain — PASTE JUST THE TEXT (B36051), Word's and Outlook's "Keep Text Only".
 *
 * The owner: *"I'd like to be able to paste just text, like, you know, how Word gives you the
 * option or maybe Outlook. Just paste text."* Pasting from a browser, an email or a PDF drags
 * the source's fonts, sizes, colours and highlights into a note that then looks like a ransom
 * letter, and cleaning it up by hand is worse than retyping it.
 *
 * ⛔ THE DEFAULT PASTE IS UNCHANGED, DELIBERATELY. He asked for an OPTION, not a new default —
 * "gives you the option" is the whole phrase — and a formatted paste is genuinely what you
 * want when you are moving text within the note. Ctrl+V does exactly what it did before this
 * file existed. Two ways to the plain one, because one of them has to be discoverable:
 *
 *   1. **Ctrl/Cmd+Shift+V** — the shortcut every other editor uses, so it needs no teaching.
 *   2. **The paste-options chip** — after a paste that ACTUALLY CARRIED FORMATTING, a small
 *      "Keep text only" appears at the paste point, exactly the way Word's does. It is not a
 *      dialog (house rule) and it never blocks: keep typing and it goes away.
 *      (Plus the same choice on the document's right-click menu — see NoteEditor.jsx.)
 *
 * ⛔ AND PLAIN MEANS PLAIN. Stripping the marks is not enough: a paste can carry its styling
 * in a `textStyle` mark's attributes (font, size, colour), in a `highlight`, or in a heading /
 * blockquote / table wrapper. `toPlainDoc` throws away EVERY mark and reduces every block to a
 * paragraph — while **keeping the paragraph breaks**, so a multi-line paste does not collapse
 * into one run-on line. That last part is the half that is easy to get wrong and impossible
 * not to notice.
 *
 * PURE, and unit-tested as such: nothing here touches the DOM, the clipboard or the editor.
 * The wiring lives in the extension at the bottom and in NoteEditor.jsx.
 */
import { Extension } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

export const pastePlainKey = new PluginKey("notePastePlain");

/** Text of a ProseMirror slice/fragment/node, with ONE newline per block boundary. */
export function textOfNode(node) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.isText) { out.push(n.text || ""); return; }
    if (n.type?.name === "hardBreak") { out.push("\n"); return; }
    const block = n.isBlock && n.type?.name !== "doc";
    if (block && out.length && out[out.length - 1] !== "\n") out.push("\n");
    n.forEach?.((child) => walk(child));
    if (block) out.push("\n");
  };
  walk(node);
  return out.join("").replace(/\n{3,}/g, "\n\n");
}

/** Plain text → the document content to insert: one paragraph per line, blanks dropped.
 *  Exported and pure so the "did the breaks survive?" property is unit-testable. */
export function plainTextToContent(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const paras = lines.map((line) => (line.trim()
    ? { type: "paragraph", content: [{ type: "text", text: line }] }
    : { type: "paragraph" }));
  // A trailing blank line from a copied block is noise, not a paragraph the user typed.
  while (paras.length > 1 && !paras[paras.length - 1].content) paras.pop();
  return paras.length ? paras : [{ type: "paragraph" }];
}

/** Did this slice actually carry any formatting worth offering to strip? A paste of plain
 *  text should NOT raise the chip — an affordance that appears when it can do nothing is
 *  noise, and it would appear on every paste. */
export function sliceCarriesFormatting(slice) {
  let formatted = false;
  const walk = (n) => {
    if (formatted || !n) return;
    if (n.marks && n.marks.length) { formatted = true; return; }
    const name = n.type?.name;
    if (name && !["doc", "paragraph", "text", "hardBreak"].includes(name)) { formatted = true; return; }
    n.forEach?.((child) => walk(child));
  };
  slice?.content?.forEach?.((n) => walk(n));
  return formatted;
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * WHAT AN OUTLOOK SIGNATURE ACTUALLY ARRIVES AS (B36051, amendment 2) — read from the owner's
 * own note (project Silvestri, page "Utility"), not imagined.
 *
 * Two whole email signatures had landed FOUR LEVELS DEEP inside a list item, because the
 * caret was in a bullet when he pasted. Inside that one `<li>`, in order: two paragraphs
 * holding nothing but `&nbsp;`, a right-aligned name in 16pt Arial with a hard `rgb()`
 * colour, six more paragraphs (CEO / O: / M: / E: / street / website), and then a
 * `<table>` of FIVE single-cell rows carrying a second person's signature. Every block
 * carried Calibri or Arial and point sizes from 9pt to 16pt.
 *
 * Three separate defects, and they are fixed in three separate places on purpose:
 *   B — the NESTING is fixed in `handlePaste` (below): multi-block content pasted into a
 *       list goes AFTER the list, never inside the item.
 *   C — the SPACERS and the LAYOUT TABLE are fixed in `transformPasted`, which runs on the
 *       ORDINARY paste as well, because he should not have to know to use a special one.
 *   A — the BACKSPACE that moved a whole chunk is not a paste bug at all and lives in
 *       lib/notesTabKey.js's sibling, `notesBlockKeys.js`.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/** A paragraph holding nothing but whitespace or non-breaking spaces. Outlook emits runs of
 *  these as vertical spacing; in a document they are just empty lines nobody typed. */
export function isSpacerParagraph(node) {
  return node?.type?.name === "paragraph"
    && (node.textContent || "").replace(/[\s\u00a0]/g, "") === "";
}

/** A table used purely for LAYOUT: every row has exactly one cell. A real table has at least
 *  one row with more than one column, so this cannot swallow data the user meant to keep. */
export function isLayoutTable(node) {
  if (node?.type?.name !== "table" || node.childCount === 0) return false;
  let single = true;
  node.forEach((row) => { if (row.childCount !== 1) single = false; });
  return single;
}

/** Collapse runs of spacer paragraphs to ONE empty paragraph, and unwrap a single-column
 *  layout table into the blocks it was holding. Recurses into list items and blockquotes,
 *  because that is exactly where his signature ended up. Pure: returns a new Fragment. */
export function tidyPastedFragment(fragment, schema, depth = 0) {
  const out = [];
  let lastWasSpacer = false;
  const push = (node) => {
    if (isSpacerParagraph(node)) {
      if (lastWasSpacer) return;                       // the run collapses
      lastWasSpacer = true;
      out.push(schema.nodes.paragraph.create());       // one EMPTY line, the nbsp dropped
      return;
    }
    lastWasSpacer = false;
    out.push(node);
  };

  fragment.forEach((node) => {
    if (isLayoutTable(node)) {
      node.forEach((row) => row.forEach((cell) => {
        tidyPastedFragment(cell.content, schema, depth + 1).forEach((block) => push(block));
      }));
      return;
    }
    if (depth < 4 && node.isBlock && node.childCount && !node.isTextblock) {
      push(node.copy(tidyPastedFragment(node.content, schema, depth + 1)));
      return;
    }
    push(node);
  });

  // A leading or trailing blank line from a copied block is noise, not content.
  while (out.length && isSpacerParagraph(out[0])) out.shift();
  while (out.length && isSpacerParagraph(out[out.length - 1])) out.pop();
  return Fragment.fromArray(out);
}

/** The list the caret is inside, outermost first — or -1. */
function enclosingListDepth($from) {
  for (let d = 1; d <= $from.depth; d += 1) {
    const name = $from.node(d).type.name;
    if (name === "bulletList" || name === "orderedList" || name === "taskList") return d;
  }
  return -1;
}

/** Is this slice itself a list? Pasting a list INTO a list should still nest — that is a
 *  real thing people mean. Only non-list, multi-block payloads are lifted out. */
function sliceIsList(slice) {
  const first = slice?.content?.firstChild;
  return !!first && /List$/.test(first.type.name);
}

/* ⛔ THE THREE PASTE MODES (B36051, amendment 3) — Word's, by name and by behaviour.
 *
 * The owner: *"I wanted to mimic how Word works — paste removed formatting, with formatting,
 * merge formatting. I want the same little signs too, the little insignias."*
 *
 *   source  KEEP SOURCE FORMATTING — the DEFAULT, and unchanged. What Ctrl+V already does.
 *   merge   MERGE FORMATTING — NEW. The source's fonts, point sizes, colours, highlights and
 *           alignment go; its bold, italic, underline, links, lists and headings stay. The
 *           text adopts the note's own body style while staying structured.
 *   text    KEEP TEXT ONLY — plain, with the paragraph and line breaks kept. Ctrl+Shift+V.
 *
 * ⛔ AND THE ONE CLARIFICATION THAT KEEPS THIS COHERENT: collapsing spacer paragraphs and
 * unwrapping single-column layout tables is STRUCTURAL SANITISATION, not formatting, so it
 * applies in ALL THREE modes — including Keep Source Formatting. That structure is broken
 * input, not a style choice anyone made. It happens in `transformPasted`, before a mode is
 * ever chosen, which is why it cannot get out of step with one. */
export const PASTE_MODES = ["source", "merge", "text"];

/** The marks that carry SOURCE APPEARANCE rather than meaning. `textStyle` is the one that
 *  holds font family, point size and colour; `highlight` is the background. Bold, italic,
 *  underline, strike, code and link are all MEANING and are deliberately absent. */
export const STYLE_MARKS = ["textStyle", "highlight"];

/** An alignment worth clearing. `null` / `"left"` is the body default already. */
export const MEANINGFUL_ALIGN = new Set(["center", "right", "justify"]);

/* ---- the extension ------------------------------------------------------------------- */

/** `onPasted({ from, to, text })` fires after a paste that CARRIED FORMATTING, so the host
 *  can offer the chip. Positions are read after the paste has landed. */
const NotePastePlain = Extension.create({
  name: "notePastePlain",

  addOptions() {
    return { onPasted: null };
  },

  addCommands() {
    return {
      /** Replace a range with its own text, stripped. */
      keepTextOnly: ({ from, to }) => ({ editor, chain }) => {
        const slice = editor.state.doc.slice(from, to);
        const text = textOfNode(slice.content);
        return chain().focus().insertContentAt({ from, to }, plainTextToContent(text)).run();
      },

      /** ⛔ MERGE FORMATTING — Word's middle option, and the one people actually want most.
       *  The pasted text adopts the NOTE's body style (fonts, point sizes, colours,
       *  highlights and alignment all go) while staying recognisably STRUCTURED: bold,
       *  italic, underline, hyperlinks, lists and headings all survive. One transaction, so
       *  it is one press of undo. */
      mergeFormatting: ({ from, to }) => ({ editor, state, tr, dispatch }) => {
        const { schema } = state;
        for (const name of STYLE_MARKS) {
          const type = schema.marks[name];
          if (type) tr.removeMark(from, to, type);
        }
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isTextblock) return true;
          if (MEANINGFUL_ALIGN.has(node.attrs?.textAlign)) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign: null });
          }
          return true;
        });
        if (dispatch) dispatch(tr.scrollIntoView());
        editor.commands.focus();
        return true;
      },

      /** Insert clipboard text as plain paragraphs at the caret (Ctrl+Shift+V's payload). */
      insertPlainText: (text) => ({ chain }) => chain().focus().insertContent(plainTextToContent(text)).run(),
    };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin({
        key: pastePlainKey,
        props: {
          /* ⛔ C — RUNS ON THE ORDINARY PASTE TOO. He should not have to know about a special
           * paste to avoid inheriting Outlook's spacer paragraphs and layout tables. This is
           * a CLEAN-UP, not a strip: fonts, sizes and colours all still arrive, because the
           * default paste is deliberately unchanged. */
          transformPasted(slice, view) {
            try {
              const tidied = tidyPastedFragment(slice.content, view.state.schema);
              return new slice.constructor(tidied, slice.openStart, slice.openEnd);
            } catch (_) {
              return slice;               // a tidy that fails must never lose the paste
            }
          },

          /* ⛔ RETURNS FALSE for the ordinary case — the default paste is NOT intercepted.
           * The ONE exception is B: a multi-block payload pasted into a list item, which the
           * default nests INSIDE the item (four levels deep, in his note). */
          handlePaste(view, _event, slice) {
            const { state } = view;
            const listDepth = enclosingListDepth(state.selection.$from);
            if (listDepth > 0 && slice.content.childCount > 1 && !sliceIsList(slice)) {
              const after = state.selection.$from.after(listDepth);
              const tr = state.tr.insert(after, slice.content);
              try { tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after + 1, tr.doc.content.size)))); } catch (_) { /* the near() is a nicety */ }
              view.dispatch(tr.scrollIntoView());
              if (sliceCarriesFormatting(slice)) {
                const text = textOfNode(slice.content);
                setTimeout(() => {
                  try { opts.onPasted?.({ from: after, to: view.state.selection.from, text }); } catch (_) { /* no chip is not an error */ }
                }, 0);
              }
              return true;                // handled: it went AFTER the list, not inside it
            }
            if (!sliceCarriesFormatting(slice)) return false;
            const from = view.state.selection.from;
            const text = textOfNode(slice.content);
            // The end position is only knowable once the paste has been applied.
            setTimeout(() => {
              try {
                const to = view.state.selection.from;
                if (to > from) opts.onPasted?.({ from, to, text });
              } catch (_) { /* the view can be gone by now; a missed chip is not an error */ }
            }, 0);
            return false;
          },
        },
      }),
    ];
  },
});

export default NotePastePlain;
