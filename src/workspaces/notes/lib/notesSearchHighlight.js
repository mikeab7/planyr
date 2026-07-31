/* notesSearchHighlight — the phrase you searched for, marked where it actually is.
 *
 * THE GAP THIS CLOSES (B1315). Body search already found the right page; opening a hit then
 * dropped you at the TOP of it with no indication of where the phrase was. On a page of any
 * length that is a second search, done by eye. So the term travels with the page that was
 * opened: every occurrence is marked, one of them is the CURRENT one, and stepping moves
 * the caret to it so the document scrolls itself.
 *
 * WHY A DECORATION AND NOT A MARK. A mark would be written into the user's document — it
 * would persist, export, and have to be cleaned up. A decoration is presentation only: it
 * exists in the view, never in the model, and vanishes when the term is cleared. Search
 * must never modify the thing being searched.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const noteSearchKey = new PluginKey("noteSearchHighlight");

/** Every occurrence of `term`, as document positions. Case-insensitive, and matched inside
 *  each TEXT node rather than across a flattened string, so a phrase can never be reported
 *  as spanning two paragraphs that merely read as adjacent. */
export function findSearchMatches(doc, term) {
  const q = String(term || "").toLowerCase();
  const out = [];
  if (!q) return out;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    let i = text.indexOf(q);
    while (i > -1) {
      out.push({ from: pos + i, to: pos + i + q.length });
      i = text.indexOf(q, i + q.length);
    }
  });
  return out;
}

const empty = { term: "", matches: [], active: 0 };

function decorate(state) {
  if (!state.matches.length) return DecorationSet.empty;
  return DecorationSet.create(
    state.doc,
    state.matches.map((m, i) => Decoration.inline(m.from, m.to, {
      class: i === state.active ? "note-search-hit note-search-hit-current" : "note-search-hit",
    })),
  );
}

export const NoteSearchHighlight = Extension.create({
  name: "noteSearchHighlight",

  addOptions() {
    // Reported on every change so the editor chrome can show "3 of 12" without keeping its
    // own copy of the match list (a second source of truth that would drift on every edit).
    return { onMatches: null };
  },

  addCommands() {
    return {
      /** Mark a term (or clear it with ""). Returns true so the chain reads normally. */
      setNoteSearch: (term) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(noteSearchKey, { term: String(term || "") }));
        return true;
      },
      /** Move to the next/previous occurrence and put the caret on it, which is what makes
       *  the document scroll there. Wraps at both ends. */
      stepNoteSearch: (delta = 1) => ({ state, tr, dispatch }) => {
        const s = noteSearchKey.getState(state);
        if (!s || !s.matches.length) return false;
        const n = s.matches.length;
        const next = ((s.active + delta) % n + n) % n;
        const m = s.matches[next];
        if (dispatch) {
          dispatch(tr
            .setMeta(noteSearchKey, { active: next })
            .setSelection(TextSelection.create(tr.doc, m.from, m.to))
            .scrollIntoView());
        }
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key: noteSearchKey,
      state: {
        init: (_c, state) => ({ ...empty, matches: [], decorations: DecorationSet.empty, doc: state.doc }),
        apply(tr, prev, _old, newState) {
          const meta = tr.getMeta(noteSearchKey);
          let term = prev.term;
          let active = prev.active;
          if (meta && typeof meta.term === "string") { term = meta.term; active = 0; }
          if (meta && Number.isFinite(meta.active)) active = meta.active;

          // Recompute on any document change: a decoration mapped through an edit drifts
          // off the text it was marking, and a stale highlight is worse than none.
          const recompute = !!meta || tr.docChanged || prev.term !== term;
          const matches = recompute ? findSearchMatches(newState.doc, term) : prev.matches;
          if (active >= matches.length) active = 0;
          const next = { term, matches, active, doc: newState.doc };
          next.decorations = recompute || tr.docChanged ? decorate(next) : prev.decorations;
          return next;
        },
      },
      props: {
        decorations(state) { return noteSearchKey.getState(state)?.decorations || DecorationSet.empty; },
      },
      view() {
        return {
          update(view, prevState) {
            const now = noteSearchKey.getState(view.state);
            const before = noteSearchKey.getState(prevState);
            if (!now) return;
            if (before && before.term === now.term && before.active === now.active && before.matches.length === now.matches.length) return;
            if (typeof opts.onMatches === "function") opts.onMatches({ term: now.term, count: now.matches.length, index: now.active });
          },
        };
      },
    })];
  },
});

export default NoteSearchHighlight;
