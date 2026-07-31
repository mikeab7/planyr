/* NoteEditor — ONE note page: its title, its toolbar, its document.
 *
 * ⛔ THIS COMPONENT IS THE LAZY BOUNDARY. It is the only module on the Notes route that
 * imports the editor engine, and the workspace root loads it behind React.lazy inside a
 * Suspense — so the notebook tree paints immediately and the engine (~460 KB) downloads
 * behind it. Never import this file statically from Notes.jsx.
 *
 * ═══ THE COMPONENT SHAPE IS TWO BUG FIXES, NOT A STYLE CHOICE ═══════════════════════════
 *
 * (1) SWITCHING PAGES INSIDE THE SAVE DEBOUNCE USED TO LOSE THE LAST THING TYPED.
 *     The obvious flush — "on the way out, ask the editor for its document and write it" —
 *     is a bet on React hook-cleanup ORDER, and it is a bet you lose: the editor's own
 *     cleanup can run first, and the flush then queries a destroyed instance and writes
 *     nothing. So the document is snapshotted as PLAIN JSON at EDIT time: `onUpdate` puts
 *     `{ id, doc }` into `pendingRef`, and the flush writes that OBJECT. By the time the
 *     flush runs there is nothing left to ask anybody for. The parent additionally keys
 *     this component by page id, so switching pages UNMOUNTS this instance and its cleanup
 *     flushes the pending snapshot before the next page mounts. `beforeunload` runs the
 *     same flush, for the same reason.
 *
 * (2) REOPENING A NOTE CONTAINING A TABLE CRASHED THE WORKSPACE.
 *     `TypeError: Cannot read properties of null (reading 'commands')` — from an effect
 *     calling `editor.commands.setContent(...)` against an instance whose command manager
 *     had already been torn down. The keyed remount removes that effect ENTIRELY, and with
 *     it the whole class: each page gets its own editor instance and reads its initial
 *     content ONCE, in a `useState` initialiser. There is deliberately no "sync content on
 *     pageId change" effect in this file, and there must never be one.
 *     It also kills a third bug for free — a shared instance carries a shared undo history,
 *     so undo used to walk the user into another page's text. Per-instance history can't.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { NOTE_EXTENSIONS, EMPTY_DOC } from "../lib/notesExtensions.js";
import { readPage, writePage } from "../lib/notesStore.js";
import { docToMarkdown, safeFileName } from "../lib/notesMarkdown.js";
import NoteToolbar from "./NoteToolbar.jsx";

const SAVE_DEBOUNCE_MS = 600;
const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

/* Editor surface styling. It lives here (rather than in src/index.css) so it rides the lazy
 * editor chunk instead of the app's first-paint stylesheet, and it is written entirely
 * against theme tokens so the document themes with the app. */
const EDITOR_CSS = `
.planyr-note .ProseMirror { outline: none; min-height: 46vh; color: var(--text-primary); line-height: 1.65; font-size: 15px; }
.planyr-note .ProseMirror > * + * { margin-top: 0.7em; }
.planyr-note .ProseMirror p { margin: 0; }
.planyr-note .ProseMirror h1 { font-size: 1.9em; font-weight: 700; line-height: 1.25; margin: 0; }
.planyr-note .ProseMirror h2 { font-size: 1.5em; font-weight: 700; line-height: 1.3; margin: 0; }
.planyr-note .ProseMirror h3 { font-size: 1.22em; font-weight: 650; margin: 0; }
.planyr-note .ProseMirror h4 { font-size: 1.06em; font-weight: 650; margin: 0; }
.planyr-note .ProseMirror ul, .planyr-note .ProseMirror ol { padding-left: 1.5em; margin: 0; }
.planyr-note .ProseMirror li { margin: 0.15em 0; }
.planyr-note .ProseMirror li p { margin: 0; }
.planyr-note .ProseMirror blockquote { border-left: 3px solid var(--accent-notes); padding-left: 0.9em; color: var(--text-secondary); margin: 0; }
.planyr-note .ProseMirror code { background: var(--surface-page); border: 1px solid var(--border-default); border-radius: 4px; padding: 0.1em 0.32em; font-family: ui-monospace, "Courier New", monospace; font-size: 0.9em; }
.planyr-note .ProseMirror pre { background: var(--surface-page); border: 1px solid var(--border-default); border-radius: ${RADIUS.control}px; padding: 0.75em 0.9em; overflow-x: auto; }
.planyr-note .ProseMirror pre code { background: none; border: none; padding: 0; }
.planyr-note .ProseMirror hr { border: none; border-top: 1px solid var(--border-strong); margin: 1.1em 0; }
.planyr-note .ProseMirror a { color: var(--accent-notes-text); text-decoration: underline; }
.planyr-note .ProseMirror ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
.planyr-note .ProseMirror ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; }
.planyr-note .ProseMirror ul[data-type="taskList"] li > label { margin-top: 0.15em; user-select: none; }
.planyr-note .ProseMirror ul[data-type="taskList"] li > div { flex: 1 1 auto; min-width: 0; }
.planyr-note .ProseMirror input[type="checkbox"] { accent-color: var(--accent-notes); width: 15px; height: 15px; cursor: pointer; }
.planyr-note .ProseMirror table { border-collapse: collapse; table-layout: fixed; width: 100%; overflow: hidden; margin: 0; }
.planyr-note .ProseMirror table td, .planyr-note .ProseMirror table th { border: 1px solid var(--border-strong); padding: 6px 9px; vertical-align: top; position: relative; min-width: 2em; }
.planyr-note .ProseMirror table th { background: var(--surface-page); font-weight: 650; text-align: left; }
.planyr-note .ProseMirror table .selectedCell:after { content: ""; position: absolute; inset: 0; background: var(--accent-notes); opacity: 0.16; pointer-events: none; }
.planyr-note .ProseMirror .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: 0; width: 4px; background: var(--accent-notes); cursor: col-resize; }
.planyr-note .ProseMirror .tableWrapper { overflow-x: auto; }
.planyr-note .ProseMirror .ProseMirror-gapcursor:after { border-top-color: var(--text-primary); }
.planyr-note .ProseMirror ::selection { background: var(--accent-notes); color: var(--on-accent-notes); }
`;

function EditorStyles() {
  return <style dangerouslySetInnerHTML={{ __html: EDITOR_CSS }} />;
}

export default function NoteEditor({ pageId, title, onTitleChange, onStatus, onExportMarkdown, scopeLabel, status }) {
  /* Initial content read ONCE, here. Not in an effect — see fix (2) in the header. */
  const [initialDoc] = useState(() => readPage(pageId) || EMPTY_DOC);

  /* The pending snapshot is PLAIN JSON captured at edit time, so the flush never has to
   * ask a possibly-destroyed editor for anything — see fix (1) in the header. */
  const pendingRef = useRef(null);
  const timerRef = useRef(0);

  /* Callbacks land in a ref so `flush` can be referentially stable: an unstable flush would
   * re-register the unmount cleanup and the beforeunload listener on every parent render,
   * which is exactly the kind of churn that made the original ordering bug intermittent. */
  const onStatusRef = useRef(onStatus);
  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = 0; }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const ok = writePage(pending.id, pending.doc);
    // LOUD-FAILURE: a write that did not land never reads as "Saved".
    onStatusRef.current?.(ok ? "saved" : "error");
  }, []);

  const editor = useEditor({
    extensions: NOTE_EXTENSIONS,
    content: initialDoc,
    // The toolbar reads its active states straight off the editor, so it must re-render
    // as the caret moves — including selection-only transactions.
    shouldRerenderOnTransaction: true,
    immediatelyRender: false,
    editorProps: { attributes: { "aria-label": "Note body", "data-testid": "note-body" } },
    onUpdate: ({ editor: ed }) => {
      pendingRef.current = { id: pageId, doc: ed.getJSON() };
      onStatusRef.current?.("unsaved");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
  });

  // Unmount (which a page switch causes, via the parent's key) flushes the snapshot.
  useEffect(() => flush, [flush]);

  // A closing tab is the same problem with a different trigger, so it takes the same flush.
  useEffect(() => {
    const onLeave = () => flush();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [flush]);

  const exportPage = useCallback(() => {
    if (!editor) return;
    const { markdown, lossy } = docToMarkdown(editor.getJSON(), { title });
    onExportMarkdown?.({ markdown, lossy, filename: safeFileName(title) });
  }, [editor, title, onExportMarkdown]);

  const badge = status === "error"
    ? { text: "Not saved", color: "var(--danger-text)" }
    : status === "unsaved"
      ? { text: "Unsaved", color: "var(--warn-text)" }
      : { text: "Saved", color: "var(--save-badge)" };

  return (
    <div className="planyr-note" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, background: "var(--surface-page)" }}>
      <EditorStyles />
      <NoteToolbar editor={editor} onExport={exportPage} />

      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {/* A DOCUMENT page (the owner's choice over a free-form canvas): a fixed-width
            sheet centred on the mat, so a note reads like a page rather than a wall. */}
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "22px 18px 96px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <input
              data-testid="note-title"
              value={title}
              placeholder="Untitled page"
              aria-label="Page title"
              onChange={(e) => onTitleChange?.(e.target.value)}
              style={{
                flex: 1, minWidth: 0, border: "none", borderBottom: "1px solid transparent",
                background: "transparent", color: "var(--text-primary)",
                font: "inherit", fontSize: 27, fontWeight: 700, letterSpacing: "-0.01em",
                padding: "2px 0", outline: "none",
              }}
              onFocus={(e) => { e.target.style.borderBottomColor = "var(--accent-notes)"; }}
              onBlur={(e) => { e.target.style.borderBottomColor = "transparent"; }}
            />
            <span
              data-testid="note-save-badge"
              title={scopeLabel}
              style={{
                flex: "0 0 auto", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                textTransform: "uppercase", color: badge.color,
                border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, padding: "3px 9px",
              }}
            >{badge.text}</span>
          </div>

          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
