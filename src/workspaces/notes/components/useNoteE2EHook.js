/* useNoteE2EHook — the `window.__noteEditor` read/seed instrument, moved verbatim out of NoteEditor.jsx (audit batch L1).
 * E2E-gated (`window.__PLANYR_E2E`): not a byte of it is reachable in a shipped session. `pageId` is now in the deps
 * (the hook closes over it in `applyExternal`). */
import { useEffect } from "react";
import { undoDepth } from "@tiptap/pm/history";
import { applyExternalToOpenNote } from "../lib/notesStore.js";

export function useNoteE2EHook(editor, pageId, setViewForE2ERef) {
  /* ⛔ THE INSTRUMENT NEW-2 NEEDED, and the reason it is committed rather than improvised.
   * "Backspace at the start of a block" is a rule about the DOCUMENT TREE, and a harness that
   * can only reach the document through clicks and key presses cannot state the case it is
   * testing — it has to type its way into a shape and hope. Every case in
   * ui-audit/verify-notes-backspace.mjs therefore SEEDS an exact tree and reads the exact tree
   * back; the keypress under test is still a real one through the browser. Read/seed only, and
   * behind the same `__PLANYR_E2E` gate every other self-audit hook in this repo uses, so not a
   * byte of it is reachable in a shipped session. */
  useEffect(() => {
    if (typeof window === "undefined" || !window.__PLANYR_E2E || !editor) return undefined;
    const hook = {
      json: () => (editor.isDestroyed ? null : editor.getJSON()),
      /* ⛔ A TRANSACTION, NOT `setContent` — and that is not a style choice. This file's
       * standing guard is that the string `setContent(` never appears in it, because the
       * crash it removed (`Cannot read properties of null (reading 'commands')`) came from an
       * effect calling it against a torn-down instance. A seeding hook has no business
       * weakening that guard, so it replaces the document the plain way. */
      setDoc: (json) => {
        if (editor.isDestroyed) return;
        const { state, view } = editor;
        const next = state.schema.nodeFromJSON(json);
        view.dispatch(state.tr.replaceWith(0, state.doc.content.size, next.content));
      },
      /** NEW-7: hand the open editor a body "the sync wrote to storage" — the exact path an adopted
       *  server copy takes. Returns whether the editor took it in place. */
      applyExternal: (json) => applyExternalToOpenNote(pageId, json),
      /** B2078593 — put the canvas at an exact view ({x, y, z}), as a pan/pinch would. A saved view no
       *  longer exists to seed through storage (the opening is always full width), so a harness that
       *  needs "zoomed in 200%" or "panned" states it here. Read-only to shipped sessions: E2E-gated. */
      setView: (v) => setViewForE2ERef.current?.(v, { persist: false, byUser: true }),
      /** Put the caret at an absolute document position — the only way to state "the very
       *  start of THAT block" without depending on where a click happens to land. */
      caretAt: (pos) => { if (!editor.isDestroyed) editor.chain().focus().setTextSelection(pos).run(); },
      /** The absolute position just inside the nth node on a path of child indexes. */
      startOf: (path) => {
        if (editor.isDestroyed) return null;
        let node = editor.state.doc;
        let pos = 0;
        for (const i of path) {
          if (!node.child || i >= node.childCount) return null;
          for (let k = 0; k < i; k += 1) pos += node.child(k).nodeSize;
          node = node.child(i);
          pos += 1;                      // step inside this node
        }
        return pos;
      },
      /** Every textblock's first position, so a sweep can press Backspace at the start of
       *  EVERY block in a document instead of at the ones somebody thought to list. */
      eachTextblockStart: (fn) => {
        if (editor.isDestroyed) return;
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock) fn(pos + 1, node.textContent || `(empty ${node.type.name})`);
          return true;
        });
      },
      /** NEW-2: the live document and how many undo steps exist — the two facts a "the preview left no trace" check needs. E2E-gated like the rest. */
      doc: () => (editor.isDestroyed ? null : editor.getJSON()),
      undoDepth: () => (editor.isDestroyed ? null : undoDepth(editor.state)),
      selection: () => (editor.isDestroyed ? null : { from: editor.state.selection.from, to: editor.state.selection.to, empty: editor.state.selection.empty }),
      /** Run a named editor command through the ordinary command system (so it obeys every
       *  schema rule a click would) — for a harness that needs to state "run X" precisely
       *  rather than reconstruct the exact click/keypress that reaches it. */
      runCommand: (name, ...args) => (editor.isDestroyed ? false : !!editor.commands[name]?.(...args)),
      /** ⛔ B1260000 — the `beforeinput` path a `keydown`-only test can never reach on its own.
       *  A real keypress in Chromium always fires a `keydown` first, so a harness driving the
       *  keyboard can never independently prove the `beforeinput` backstop in `notesBlockKeys.js`
       *  is what actually ran — it could just as easily be `keydown` doing the work with the
       *  backstop sitting dead. This dispatches a SYNTHETIC `beforeinput` directly on the
       *  editor's DOM node — untrusted, so the browser performs no native edit of its own for
       *  it — which exercises ONLY the plugin's `handleDOMEvents.beforeinput`, exactly the event
       *  class his platform is documented to deliver without a usable `keydown`. */
      /** NEW-1 (B2142464 x4) — drive the paste SAFETY NET on purpose. No clipboard we know of makes the parse drop a table, so
       *  the net could never be seen working: this runs the pipeline's `transformPastedHTML` on `html` (filling its slot with
       *  the tables the html held) and then `transformPasted` on a slice that holds a paragraph and NO table, and returns the
       *  resulting slice as JSON. A healthy net hands the tables back. */
      pasteSafetyNetProbe: (html) => {
        if (editor.isDestroyed) return null;
        const v = editor.view;
        const para = v.state.schema.nodes.paragraph.create(null, v.state.schema.text("lost-table probe"));
        const Frag = para.content.constructor;
        const Slice = v.state.doc.slice(0, 0).constructor;
        /* ProseMirror CHAINS every plugin's transform (the callback returns nothing, so `someProp` keeps going) — a probe that
         * returned the first plugin's answer would stop at whichever one registered first and never reach ours. */
        let h = html;
        v.someProp("transformPastedHTML", (f) => { h = f(h, v); });
        let out = new Slice(Frag.from(para), 0, 0);
        v.someProp("transformPasted", (f) => { out = f(out, v); });
        return out.content.toJSON();
      },
      dispatchBeforeInput: (inputType = "deleteContentBackward") => {
        if (editor.isDestroyed) return;
        const event = new InputEvent("beforeinput", { inputType, cancelable: true, bubbles: true });
        editor.view.dom.dispatchEvent(event);
      },
    };
    window.__noteEditor = hook;
    return () => { if (window.__noteEditor === hook) window.__noteEditor = null; };
  }, [editor, pageId, setViewForE2ERef]);
}
