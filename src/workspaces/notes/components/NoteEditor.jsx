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
 *
 *     ⚠ The search-term effect below is NOT that effect and must not grow into it. It
 *     touches DECORATIONS, never content, and it guards on `editor.isDestroyed` — which is
 *     the discipline any future effect in this file has to meet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { noteExtensions, EMPTY_DOC } from "../lib/notesExtensions.js";
import { readNoteImages, readPage, writePage } from "../lib/notesStore.js";
import { docToMarkdown, imageIdsInDoc, safeFileName } from "../lib/notesMarkdown.js";
import { docToHtml } from "../lib/notesDocHtml.js";
import { buildPrintDocument, printHtmlDocument } from "../lib/notesPrint.js";
import { absoluteStamp, editedLabel } from "../lib/notesTime.js";
import NoteToolbar from "./NoteToolbar.jsx";

const SAVE_DEBOUNCE_MS = 600;
const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

/* Editor surface styling. It lives here (rather than in src/index.css) so it rides the lazy
 * editor chunk instead of the app's first-paint stylesheet, and it is written entirely
 * against theme tokens so the document themes with the app.
 *
 * PDF-PARITY: lib/notesPrint.js mirrors this list construct for construct, on paper.
 * Add a construct here and add it there in the same commit. */
const EDITOR_CSS = `
.planyr-note .ProseMirror { outline: none; min-height: 46vh; color: var(--text-primary); line-height: 1.65; font-size: 15px; tab-size: 4; }
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

/* An empty page says what to do. Both halves — the extension and this rule — landed
   together; a rule with no extension matches nothing, which is what a blank page was. */
.planyr-note .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; height: 0; pointer-events: none; color: var(--text-tertiary); font-style: italic; }

/* A picture. The BROKEN state is styled as loudly as the good one on purpose: an image
   whose bytes are gone must read as a stated problem, never as a blank gap. */
.planyr-note .planyr-note-image { margin: 0; display: block; }
.planyr-note .planyr-note-image img { max-width: 100%; height: auto; display: block; border-radius: ${RADIUS.control}px; border: 1px solid var(--border-default); }
.planyr-note .planyr-note-image.ProseMirror-selectednode img { outline: 2px solid var(--accent-notes); outline-offset: 1px; }
.planyr-note .planyr-note-image[data-missing] { border: 1px dashed var(--danger-text); border-radius: ${RADIUS.control}px; padding: 14px; background: var(--surface-page); }
.planyr-note .planyr-note-image-missing { color: var(--danger-text); font-size: 12.5px; font-weight: 600; }

/* SKETCH MODE (lib/notesSketchNode.js). The drawing carries CLASS NAMES and no colours at
   all, so the ink is entirely here — which is what lets the same drawing theme with the app
   on screen and print black-on-white on paper. PDF-PARITY: lib/notesPrint.js mirrors every
   rule below at paper weight; change one, change both. */
.planyr-note .planyr-sketch-host { position: relative; border: 1px solid var(--border-default); border-radius: ${RADIUS.control}px; background: var(--surface-raised); padding: 8px; }
.planyr-note .planyr-sketch-host.ProseMirror-selectednode { outline: 2px solid var(--accent-notes); outline-offset: 1px; }
.planyr-note .planyr-sketch-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 7px; }
.planyr-note .planyr-sketch-kind { font-size: 10.5px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-tertiary); }
.planyr-note .planyr-sketch-btn { height: 24px; padding: 0 9px; border: 1px solid var(--border-default); border-radius: ${RADIUS.pill}px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 11.5px; font-weight: 650; cursor: pointer; }
.planyr-note .planyr-sketch-btn.is-on { background: var(--accent-notes); border-color: var(--accent-notes); color: var(--on-accent-notes); }
.planyr-note .planyr-sketch-btn:disabled { opacity: 0.45; cursor: default; }
.planyr-note .planyr-sketch-status { font-size: 11.5px; font-weight: 600; color: var(--text-secondary); }
.planyr-note .planyr-sketch-draw { overflow-x: auto; }
.planyr-note .planyr-sketch-draw.is-linking { cursor: crosshair; }
.planyr-note .planyr-sketch-canvas { display: block; max-width: 100%; height: auto; touch-action: none; }
.planyr-note .planyr-sketch-surface { fill: transparent; cursor: crosshair; }
.planyr-note .planyr-sketch-box { fill: var(--surface-page); stroke: var(--border-strong); stroke-width: 1.2; }
.planyr-note .planyr-sketch-node { cursor: grab; }
.planyr-note .planyr-sketch-node:focus { outline: none; }
.planyr-note .planyr-sketch-node:focus .planyr-sketch-box,
.planyr-note .planyr-sketch-node.is-selected .planyr-sketch-box { stroke: var(--accent-notes); stroke-width: 2.2; }
.planyr-note .planyr-sketch-label { fill: var(--text-primary); font-size: 12.5px; font-weight: 650; }
.planyr-note .planyr-sketch-body { fill: var(--text-secondary); font-size: 11px; font-weight: 500; }
.planyr-note .planyr-sketch-grip { cursor: crosshair; }
.planyr-note .planyr-sketch-grip-hit { fill: transparent; }
.planyr-note .planyr-sketch-grip-dot { fill: var(--surface-raised); stroke: var(--accent-notes); stroke-width: 1.6; }
.planyr-note .planyr-sketch-edge { stroke: var(--border-strong); stroke-width: 1.4; fill: none; }
.planyr-note .planyr-sketch-edge-hit { stroke: transparent; stroke-width: 12; fill: none; cursor: pointer; }
.planyr-note .planyr-sketch-edge-g.is-selected .planyr-sketch-edge { stroke: var(--accent-notes); stroke-width: 2.4; }
.planyr-note .planyr-sketch-edge-g.is-selected .planyr-sketch-head { fill: var(--accent-notes); }
.planyr-note .planyr-sketch-head { fill: var(--border-strong); stroke: none; }
.planyr-note .planyr-sketch-pending { stroke: var(--accent-notes); stroke-width: 1.6; stroke-dasharray: 5 3; fill: none; pointer-events: none; }
.planyr-note .planyr-sketch-empty { margin: 0; padding: 12px 2px; color: var(--text-tertiary); font-size: 12.5px; font-style: italic; }
.planyr-note .planyr-sketch-offline { margin: 6px 0 0; color: var(--danger-text); font-size: 12px; font-weight: 600; }
.planyr-note .planyr-sketch-hint { margin: 5px 0 0; color: var(--text-tertiary); font-size: 11.5px; }
/* The words are edited IN the box: two plain fields laid exactly over it (no dialog boxes —
   house rule). It is positioned against the host, which is why the host is relative. */
.planyr-note .planyr-sketch-edit { position: absolute; z-index: 3; box-sizing: border-box; display: flex; flex-direction: column; gap: 3px; padding: 5px; border: 2px solid var(--accent-notes); border-radius: 8px; background: var(--surface-page); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18); }
.planyr-note .planyr-sketch-edit-label,
.planyr-note .planyr-sketch-edit-body { width: 100%; box-sizing: border-box; border: none; background: transparent; color: var(--text-primary); font: inherit; padding: 1px 3px; }
.planyr-note .planyr-sketch-edit-label { font-size: 12.5px; font-weight: 650; }
.planyr-note .planyr-sketch-edit-body { font-size: 11px; font-weight: 500; color: var(--text-secondary); resize: vertical; line-height: 1.28; }
.planyr-note .planyr-sketch-edit-label:focus,
.planyr-note .planyr-sketch-edit-body:focus { outline: none; }

/* Search marking is a decoration, never a mark — it is not in the document. */
.planyr-note .note-search-hit { background: var(--warn-bg); box-shadow: 0 0 0 1px var(--warn-text) inset; border-radius: 2px; }
.planyr-note .note-search-hit-current { background: var(--accent-notes); color: var(--on-accent-notes); box-shadow: none; }
`;

function EditorStyles() {
  return <style dangerouslySetInnerHTML={{ __html: EDITOR_CSS }} />;
}

/** The find bar — where the phrase you searched for actually is, and how to step through
 *  it. Shown only while a term is live, so it costs a page with no search nothing. */
function FindBar({ term, count, index, onStep, onClear }) {
  if (!term) return null;
  return (
    <div
      data-testid="note-find-bar"
      style={{
        flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "5px 14px",
        borderBottom: "1px solid var(--border-default)", background: "var(--surface-page)",
        color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 600,
      }}
    >
      <span data-testid="note-find-count" style={{ flex: 1, minWidth: 0 }}>
        {count ? `“${term}” — ${index + 1} of ${count}` : `“${term}” is not on this page`}
      </span>
      <button type="button" data-testid="note-find-prev" title="Previous match" disabled={!count}
        onMouseDown={(e) => e.preventDefault()} onClick={() => onStep(-1)}
        style={{ height: 22, minWidth: 26, borderRadius: RADIUS.control, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 12, cursor: count ? "pointer" : "default", opacity: count ? 1 : 0.45 }}
      >‹</button>
      <button type="button" data-testid="note-find-next" title="Next match" disabled={!count}
        onMouseDown={(e) => e.preventDefault()} onClick={() => onStep(1)}
        style={{ height: 22, minWidth: 26, borderRadius: RADIUS.control, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 12, cursor: count ? "pointer" : "default", opacity: count ? 1 : 0.45 }}
      >›</button>
      <button type="button" data-testid="note-find-clear" title="Clear the search (Esc)"
        onMouseDown={(e) => e.preventDefault()} onClick={onClear}
        style={{ height: 22, padding: "0 9px", borderRadius: RADIUS.pill, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
      >Clear</button>
    </div>
  );
}

export default function NoteEditor({
  pageId, title, onTitleChange, onStatus, onExportMarkdown, onPrintNotice, onSaved,
  scopeLabel, status, updatedAt, searchTerm = "", onClearSearch, notebookPageIds, notebookTitle, sectionTitle,
}) {
  /* Initial content read ONCE, here. Not in an effect — see fix (2) in the header. */
  const [initialDoc] = useState(() => readPage(pageId) || EMPTY_DOC);
  const [find, setFind] = useState({ term: "", count: 0, index: 0 });

  /* The pending snapshot is PLAIN JSON captured at edit time, so the flush never has to
   * ask a possibly-destroyed editor for anything — see fix (1) in the header. */
  const pendingRef = useRef(null);
  const timerRef = useRef(0);

  /* Callbacks land in a ref so `flush` can be referentially stable: an unstable flush would
   * re-register the unmount cleanup and the beforeunload listener on every parent render,
   * which is exactly the kind of churn that made the original ordering bug intermittent. */
  const onStatusRef = useRef(onStatus);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onStatusRef.current = onStatus; onSavedRef.current = onSaved; }, [onStatus, onSaved]);

  /* WHICH page a pasted picture belongs to, and which notebook it is charged against, read
   * at PASTE time through a ref — a value captured when the editor was created would be
   * stale the moment a page is added beside this one. */
  const imageCtxRef = useRef({ pageId, notebookPageIds });
  imageCtxRef.current = { pageId, notebookPageIds };
  const imageContext = useCallback(() => imageCtxRef.current, []);

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = 0; }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const ok = writePage(pending.id, pending.doc);
    // LOUD-FAILURE: a write that did not land never reads as "Saved".
    onStatusRef.current?.(ok ? "saved" : "error");
    // The edited stamp is hung on the write that ACTUALLY LANDED, never on a keystroke —
    // a page cannot claim it was edited at a moment storage refused to record.
    if (ok) onSavedRef.current?.(pending.id);
  }, []);

  const extensions = useMemo(
    () => noteExtensions({ imageContext, onSearchMatches: (m) => setFind(m) }),
    [imageContext],
  );

  const editor = useEditor({
    extensions,
    content: initialDoc,
    // The toolbar reads its active states straight off the editor, so it must re-render
    // as the caret moves — including selection-only transactions.
    shouldRerenderOnTransaction: true,
    immediatelyRender: false,
    /* The accessible name carries the KEYBOARD TRAP ESCAPE (B1392). Tab now indents inside
     * the note instead of jumping to the browser's toolbar, so the way OUT has to be
     * announced rather than known: Escape releases the next Tab. */
    editorProps: {
      attributes: {
        "aria-label": "Note body. Tab indents; press Escape then Tab to leave the note.",
        "aria-keyshortcuts": "Tab Shift+Tab Escape",
        "data-testid": "note-body",
      },
    },
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

  /* Mark the searched phrase. DECORATIONS ONLY — this writes nothing into the document, and
   * it checks `isDestroyed` because a command against a torn-down instance is the crash
   * class this file's header is about. */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setNoteSearch(searchTerm || "");
    if (searchTerm) editor.commands.stepNoteSearch(0);
  }, [editor, searchTerm]);

  /* CLICKING — OR DOUBLE-CLICKING — THE EMPTY PART OF THE PAGE PUTS THE CARET THERE
   * (B1368, extended by B1393).
   *
   * The document only claimed the box its own text filled, so on a short note most of the
   * sheet was dead: clicking below the last line, or out to the side of it, did nothing at
   * all — the owner's "I'm not sure that I can really edit anywhere on the page". A page you
   * can only click ON THE WORDS is not a page.
   *
   * The mat forwards the press instead: anything that is not already the document, a field
   * or a control lands the caret at the nearest real position — the same place the browser
   * would have put it if the document had filled the pane. `preventDefault` on mousedown is
   * what stops the press blurring the editor before the focus lands.
   *
   * B1393 BINDS THE SAME HANDLER TO DOUBLE-CLICK, and the reason is worth writing down
   * because the code looks redundant: a double-click DOES fire two mousedowns, so blank
   * space already worked by accident — driven in a real browser at desk width, all four
   * blank regions (right of the column, left of it, above the text and below the last line)
   * landed the caret and typed. Binding the second event makes it a STATED CONTRACT with a
   * guard on it rather than a side effect of the first, so a later change to the press path
   * cannot quietly take double-click away again.
   *
   * ⛔ IT MUST NOT REACH TEXT. Double-clicking a WORD still selects that word — the guard
   * at the top returns early for anything inside `.ProseMirror`, so only genuinely blank
   * space gets the caret-landing behaviour. */
  const focusFromMat = useCallback((e) => {
    if (!editor || editor.isDestroyed) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (el.closest(".ProseMirror") || el.closest("input, textarea, select, button, a, [contenteditable]")) return;
    e.preventDefault();
    const dom = editor.view.dom;
    const box = dom.getBoundingClientRect();
    // Clamp the press INTO the text column horizontally and keep its height: a click out to
    // the right of a short line should land at the end of THAT line, not at the end of the
    // document, which is what makes this feel like a page rather than a jump.
    const left = Math.min(Math.max(e.clientX, box.left + 1), box.right - 1);
    const top = Math.min(Math.max(e.clientY, box.top + 1), box.bottom - 1);
    const hit = e.clientY > box.bottom ? null : editor.view.posAtCoords({ left, top });
    if (hit && Number.isFinite(hit.pos)) editor.chain().focus().setTextSelection(hit.pos).run();
    else editor.commands.focus("end");
  }, [editor]);

  const stepFind = useCallback((d) => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.stepNoteSearch(d);
  }, [editor]);

  /* Both exports need the page's pictures, and pictures are async (they live in IndexedDB),
   * so both of these are async — the ONE place the module reaches across that boundary on
   * the way out. */
  const exportPage = useCallback(async () => {
    if (!editor || editor.isDestroyed) return;
    const json = editor.getJSON();
    const images = await readNoteImages(imageIdsInDoc(json));
    const { markdown, lossy } = docToMarkdown(json, { title, images });
    onExportMarkdown?.({ markdown, lossy, filename: safeFileName(title) });
  }, [editor, title, onExportMarkdown]);

  const printPage = useCallback(async () => {
    if (!editor || editor.isDestroyed) return;
    const json = editor.getJSON();
    const images = await readNoteImages(imageIdsInDoc(json));
    const html = buildPrintDocument({
      title: title || "Untitled page",
      meta: [notebookTitle, sectionTitle].filter(Boolean).join(" › "),
      pages: [{ title, html: docToHtml(json, images), updatedAt }],
    });
    const r = await printHtmlDocument(html);
    if (!r.ok) onPrintNotice?.(r.error);
  }, [editor, title, updatedAt, notebookTitle, sectionTitle, onPrintNotice]);

  const badge = status === "error"
    ? { text: "Not saved", color: "var(--danger-text)" }
    : status === "unsaved"
      ? { text: "Unsaved", color: "var(--warn-text)" }
      : { text: "Saved", color: "var(--save-badge)" };

  const edited = editedLabel(updatedAt);

  return (
    <div className="planyr-note" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, background: "var(--surface-page)" }}>
      <EditorStyles />
      <NoteToolbar editor={editor} onExport={exportPage} onPrint={printPage} />
      <FindBar term={find.term} count={find.count} index={find.index} onStep={stepFind} onClear={onClearSearch} />

      {/* The mat. It is the WHOLE pane, and a press — single OR double — anywhere on it lands
          the caret (B1368, B1393); see focusFromMat. `data-testid` so the headless check can
          press the dead zone. */}
      <div
        data-testid="note-mat"
        onMouseDown={focusFromMat}
        onDoubleClick={focusFromMat}
        style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}
      >
        {/* A DOCUMENT page (the owner's choice over a free-form canvas): a fixed-width sheet.
            ⛔ IT IS LEFT-ALIGNED, NOT CENTRED (B1369). Centring it read as "my stuff is
            aligned to the right" on a wide monitor: the toolbar spans the pane, the text
            column floated to the middle, and the gap between the two left edges grew with
            every extra inch of screen. A document's left edge does not move when you resize
            the window. `paddingLeft` matches the toolbar's own inset (its padding plus the
            first control's), so the two left edges line up and STAY lined up.
            AUDIT-FIRST: the alternative explanation — a right/centre TextAlign stuck on the
            paragraphs — was checked against the real stored documents and refuted; not one
            paragraph carries anything but the default. This is layout, not data. */}
        <div style={{ maxWidth: 820, width: "100%", flex: "1 0 auto", margin: 0, padding: "22px 20px 96px 13px" }}>
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
            {edited ? (
              <span
                data-testid="note-edited"
                title={absoluteStamp(updatedAt)}
                style={{ flex: "0 0 auto", fontSize: 11.5, fontWeight: 600, color: "var(--text-tertiary)" }}
              >{edited}</span>
            ) : null}
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
