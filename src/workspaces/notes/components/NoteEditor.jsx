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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { noteExtensions, EMPTY_DOC } from "../lib/notesExtensions.js";
import { anchorExtent, anchorPosAtSelection, placeAnchor } from "../lib/notesAnchorNode.js";
import {
  normalizeZoom, scrollTopAfterZoom, zoomForKey, zoomForWheel, zoomLabel, ZOOM_DEFAULT,
} from "../lib/notesZoom.js";
import { PASTE_MODES } from "../lib/notesPastePlain.js";
import {
  readNoteFiles, readNoteImages, readPage, readPageVersions, registerOpenNoteDoc,
  restorePageVersion, snapshotPage, writePage,
  readNotesZoom, writeNotesZoom,
} from "../lib/notesStore.js";
import {
  attachmentIdsInDoc, docToMarkdown, imageIdsInDoc, safeFileName, MD_INLINE_ATTACHMENT_MAX,
} from "../lib/notesMarkdown.js";
import { docToHtml } from "../lib/notesDocHtml.js";
import { buildPrintDocument, printHtmlDocument } from "../lib/notesPrint.js";
import { absoluteStamp, editedLabel } from "../lib/notesTime.js";
import { activeOutlineIndex, outlineFromDoc } from "../lib/notesOutline.js";
import { setTaskCheckedInDoc } from "../lib/notesTasks.js";
import { applySlashCommand } from "../lib/notesSlashMenu.js";
import NoteToolbar from "./NoteToolbar.jsx";
import NoteSlashMenu from "./NoteSlashMenu.jsx";
import NoteOutline from "./NoteOutline.jsx";
import NoteHistory from "./NoteHistory.jsx";

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

/* ⛔ A BLOCK THAT STAYS WHERE YOU PUT IT (NEW-2). Out of flow, so the rest of the document
   does not know it exists — no padding paragraphs, no reflow, nothing to backspace through.
   The position rule on .ProseMirror is what it anchors to; the margin reset matters because
   the sibling-margin rule above would otherwise ADD to the top offset of an absolutely
   positioned child. */
.planyr-note .ProseMirror { position: relative; }
/* ⛔ NO min-width FLOOR HERE. There was one — 120px — and it silently defeated the whole of
   NEW-1: placeAnchor narrows a block so its LEFT EDGE can be kept, and a stylesheet floor under
   the narrowed width just pushed it back out over the right margin. The width is written
   explicitly by renderHTML AND by the node view, so nothing here needs a floor; the only floor
   is ANCHOR_MIN_WIDTH, in the one file that decides placement. */
.planyr-note .ProseMirror .planyr-anchor { position: absolute; margin: 0 !important; box-sizing: border-box; padding: 3px 6px 3px 16px; border: 1px dashed transparent; border-radius: 5px; }
.planyr-note .ProseMirror .planyr-anchor:hover, .planyr-note .ProseMirror .planyr-anchor:focus-within { border-color: var(--border-strong); }
/* ⛔ AN EMPTY BLOCK IS NEVER INVISIBLE, AND THAT IS THE WHOLE OF THE "INTERMITTENT" BUG. One
   that draws nothing still occupies its box and still takes the press, so a second attempt at
   the same spot landed inside the first attempt's leftover and appeared to do nothing at all.
   It is outlined whenever it is empty, and while the caret is in it, it says what to do. The
   words are content, not a node — nothing here reaches the document, the Markdown or the PDF. */
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"] { border-color: var(--border-default); border-style: dashed; }
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"]:focus-within { border-color: var(--accent-notes); }
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"]:focus-within .planyr-anchor-content::after { content: "Type here"; position: absolute; left: 16px; top: 3px; pointer-events: none; color: var(--text-tertiary); font-style: italic; }
.planyr-note .ProseMirror .planyr-anchor-content { position: relative; }
.planyr-note .ProseMirror .planyr-anchor-grip { position: absolute; left: 3px; top: 5px; width: 9px; height: 14px; cursor: grab; border-radius: 2px; opacity: 0; background: repeating-linear-gradient(to bottom, var(--text-tertiary) 0 2px, transparent 2px 4px); }
.planyr-note .ProseMirror .planyr-anchor:hover .planyr-anchor-grip, .planyr-note .ProseMirror .planyr-anchor:focus-within .planyr-anchor-grip { opacity: 1; }
.planyr-note .ProseMirror .planyr-anchor-grip:active { cursor: grabbing; }
/* ⛔ A DELETE AND A WIDTH HANDLE, on the box itself. Both appear on hover or while the caret is
   in the box — the same rule the grab handle already followed, so a page of boxes is not a page
   of chrome. Neither prints: notesPrint.js hides every one of them. */
.planyr-note .ProseMirror .planyr-anchor-del { position: absolute; right: 2px; top: 2px; width: 16px; height: 16px; padding: 0; line-height: 14px; border: 1px solid var(--border-default); border-radius: 4px; background: var(--surface-raised); color: var(--text-secondary); font: inherit; font-size: 12px; cursor: pointer; opacity: 0; }
.planyr-note .ProseMirror .planyr-anchor:hover .planyr-anchor-del, .planyr-note .ProseMirror .planyr-anchor:focus-within .planyr-anchor-del { opacity: 1; }
.planyr-note .ProseMirror .planyr-anchor-del:hover { border-color: var(--danger); color: var(--danger); }
.planyr-note .ProseMirror .planyr-anchor-size { position: absolute; right: -3px; bottom: -3px; width: 12px; height: 12px; cursor: ew-resize; border-right: 2px solid var(--border-strong); border-bottom: 2px solid var(--border-strong); border-bottom-right-radius: 4px; opacity: 0; }
.planyr-note .ProseMirror .planyr-anchor:hover .planyr-anchor-size, .planyr-note .ProseMirror .planyr-anchor:focus-within .planyr-anchor-size { opacity: 1; }

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

/* A CALLOUT (NEW-7). The node stores a NAME — info / tip / important / warning / danger —
   and never a colour, so the ink is entirely here and the same block prints black-on-white
   and exports as GitHub's own "> [!NOTE]" syntax. The icon is a ::before rather than
   content: an icon inserted as text would be selectable, deletable and would ride into the
   Markdown on top of the marker that already says the same thing.
   PDF-PARITY: lib/notesPrint.js mirrors every rule below at paper weight. */
.planyr-note .planyr-callout { position: relative; border: 1px solid var(--border-default); border-left: 3px solid var(--text-tertiary); border-radius: ${RADIUS.control}px; background: var(--surface-page); padding: 10px 12px 10px 34px; }
.planyr-note .planyr-callout > * + * { margin-top: 0.5em; }
.planyr-note .planyr-callout::before { position: absolute; left: 11px; top: 9px; font-size: 13px; line-height: 1.25; content: "ℹ"; color: var(--text-tertiary); font-weight: 700; }
.planyr-note .planyr-callout[data-callout="info"] { border-left-color: var(--accent-notes); }
.planyr-note .planyr-callout[data-callout="info"]::before { content: "ℹ"; color: var(--accent-notes-text); }
.planyr-note .planyr-callout[data-callout="tip"] { border-left-color: var(--save-badge); }
.planyr-note .planyr-callout[data-callout="tip"]::before { content: "✦"; color: var(--save-badge); }
.planyr-note .planyr-callout[data-callout="important"] { border-left-color: var(--accent-review); }
/* The glyph takes the AA-SAFE "-text" variant of the hue, never the fill token: amber on a
   white sheet is about 2:1 and would be the low-contrast trap the theming rule forbids. */
.planyr-note .planyr-callout[data-callout="important"]::before { content: "★"; color: var(--accent-review-text); }
.planyr-note .planyr-callout[data-callout="warning"] { border-left-color: var(--warn-text); background: var(--warn-bg); }
.planyr-note .planyr-callout[data-callout="warning"]::before { content: "▲"; color: var(--warn-text); }
.planyr-note .planyr-callout[data-callout="danger"] { border-left-color: var(--danger-text); background: var(--danger-bg); }
.planyr-note .planyr-callout[data-callout="danger"]::before { content: "!"; color: var(--danger-text); }

/* A TOGGLE (NEW-7) - the browser's own details element, so folding needs no measuring, no
   animation frame and no height cache, and paper inherits the same element. The document
   owns the open/closed state as an attribute (lib/notesToggleNode.js); the marker area is
   the only part that folds, because a press on the WORDS has to place the caret or the
   title would be the one line in the document you cannot edit. */
.planyr-note .planyr-toggle { border: 1px solid var(--border-default); border-radius: ${RADIUS.control}px; background: var(--surface-page); padding: 7px 11px; }
.planyr-note .planyr-toggle > * + * { margin-top: 0.5em; }
.planyr-note .planyr-toggle-title { cursor: text; font-weight: 650; color: var(--text-primary); list-style: none; }
.planyr-note .planyr-toggle-title::-webkit-details-marker { display: none; }
.planyr-note .planyr-toggle-title::before { display: inline-block; width: 14px; margin-left: -3px; content: "▶"; font-size: 9px; color: var(--text-tertiary); cursor: pointer; }
.planyr-note .planyr-toggle[open] > .planyr-toggle-title::before { content: "▼"; }

/* AN ATTACHED FILE (NEW-5). Same discipline as a picture: the document holds an id, the
   bytes are behind the storage seam, and a chip whose bytes are GONE says so in as many
   words rather than downloading nothing. */
.planyr-note .planyr-note-file { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--border-default); border-radius: ${RADIUS.control}px; background: var(--surface-page); text-decoration: none; }
.planyr-note .planyr-note-file.ProseMirror-selectednode { outline: 2px solid var(--accent-notes); outline-offset: 1px; }
.planyr-note .planyr-note-file[data-missing] { border: 1px dashed var(--danger-text); }
.planyr-note .planyr-note-file-badge { flex: 0 0 auto; font-size: 9.5px; font-weight: 800; letter-spacing: 0.06em; padding: 2px 6px; border-radius: ${RADIUS.pill}px; border: 1px solid var(--border-strong); color: var(--text-secondary); }
.planyr-note .planyr-note-file-name { flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 650; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.planyr-note .planyr-note-file-size { flex: 0 0 auto; font-size: 11.5px; font-weight: 600; color: var(--text-tertiary); }
.planyr-note .planyr-note-file-get { flex: 0 0 auto; height: 22px; padding: 0 10px; border-radius: ${RADIUS.pill}px; border: 1px solid var(--accent-notes); background: transparent; color: var(--accent-notes-text); font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; }
.planyr-note .planyr-note-file-get:disabled { border-color: var(--danger-text); color: var(--danger-text); cursor: default; }

/* SKETCH MODE (lib/notesSketchNode.js). The drawing carries CLASS NAMES and no colours at
   all, so the ink is entirely here — which is what lets the same drawing theme with the app
   on screen and print black-on-white on paper. PDF-PARITY: lib/notesPrint.js mirrors every
   rule below at paper weight; change one, change both. */
.planyr-note .planyr-sketch-host { position: relative; border: 1px solid var(--border-default); border-radius: ${RADIUS.control}px; background: var(--surface-raised); padding: 8px; }
.planyr-note .planyr-sketch-host.ProseMirror-selectednode { outline: 2px solid var(--accent-notes); outline-offset: 1px; }
/* ⛔ THE PANEL NEVER SPILLS OUT OF ITS OWN CONTAINER, however narrow that container is. Its
   three buttons are ~190px of content, so in anything narrower they used to overflow to the
   LEFT and paint on top of whatever was beside them — his "the labels overlap their own
   buttons". A zero min-width lets the flex row shrink instead of pushing, and the row scrolls
   sideways at the point where wrapping stops helping. Belt to the brace of not putting a
   sketch inside a text box in the first place (see boxSelection). */
.planyr-note .planyr-sketch-host { min-width: 0; overflow: hidden; }
.planyr-note .planyr-sketch-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 7px; min-width: 0; max-width: 100%; overflow-x: auto; }
.planyr-note .planyr-sketch-btn { flex: 0 0 auto; }
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

/**
 * ⛔ WAS THIS PRESS BESIDE A LINE OF WRITING, OR IN OPEN PAGE?
 *
 * This is the whole of the "single click flings the caret across the page" fix, and it is a
 * MEASUREMENT rather than a threshold pulled out of the air. ProseMirror will always hand back
 * SOME nearest text position for a press — that is its job — and on a mostly-empty page the
 * nearest position to a press low on the sheet is the end of a paragraph far above, or the end
 * of the document. Taking it produces exactly what he reported: *"it goes still goes all the
 * way to the left."*
 *
 * So the answer is checked against the page: ask where that position actually IS, and accept
 * it only if the press landed within one line of it vertically. A press in the white space to
 * the right of a short line is beside that line and still puts the caret at its end, which is
 * what every editor does and what B1368 was for. A press two inches below the writing is not
 * beside anything, and is open page.
 *
 * The tolerance is the LINE'S OWN HEIGHT, read from the browser, so it is right at any zoom
 * and at any font size without a number to keep in step.
 */
function pressIsBesideLine(editor, pos, clientY) {
  try {
    const c = editor.view.coordsAtPos(pos);
    if (!c || !Number.isFinite(c.top)) return false;
    const line = Math.max(12, c.bottom - c.top);
    return clientY > c.top - line && clientY < c.bottom + line;
  } catch (_) {
    // An unresolvable position is not evidence of a nearby line — treat it as open page.
    return false;
  }
}

/* ⛔ OUR OWN GLYPHS, WORD'S SILHOUETTE LANGUAGE (B36051, amendment 3). The owner asked for
 * "the same little insignias… it doesn't have to be the exact same one if that's a copyright
 * issue, but something that shows the exact same thing almost." So these are drawn here, from
 * scratch — no Microsoft asset is copied — while keeping the shape anyone who has used Word
 * reads instantly: a clipboard, plus the one mark that says which mode it is.
 *   Keep source formatting  clipboard + PAINTBRUSH
 *   Merge formatting        clipboard + two CHEVRONS meeting
 *   Keep text only          clipboard + a plain letter A
 * Inline SVG on `currentColor`, at the same 16-box and 1.7 stroke as the toolbar's own. */
const CLIPBOARD_BODY = (
  <>
    <rect x="3.2" y="2.6" width="7.6" height="10.6" rx="1.4" />
    <path d="M5.6 2.6V2a1 1 0 0 1 1-1h0.8a1 1 0 0 1 1 1v0.6" />
  </>
);

const PASTE_ICONS = {
  source: (
    <>
      {CLIPBOARD_BODY}
      <path d="M11.4 8.6c1.3-1.3 2.4-0.6 2.4-0.6s0.7 1.1-0.6 2.4l-1.9 1.9-1.8-1.8z" />
      <path d="M11.3 12.3l-1.6 2.2 2.2-1.6" />
    </>
  ),
  merge: (
    <>
      {CLIPBOARD_BODY}
      <path d="M10.2 8.2l2 2-2 2" />
      <path d="M15 8.2l-2 2 2 2" />
    </>
  ),
  text: (
    <>
      {CLIPBOARD_BODY}
      <path d="M10.1 13.4l2.1-5 2.1 5" />
      <path d="M10.9 11.7h2.6" />
    </>
  ),
};

/** Name + access key, exactly the way Word labels them. */
export const PASTE_MODE_META = {
  source: { label: "Keep source formatting", key: "K" },
  merge: { label: "Merge formatting", key: "M" },
  text: { label: "Keep text only", key: "T" },
};

function PasteIcon({ mode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      {PASTE_ICONS[mode]}
    </svg>
  );
}

/** ⛔ WORD'S PASTE-OPTIONS CONTROL, and it is NOT a dialog (house rule) — B36051.
 *
 *  A small clipboard BADGE appears at the end of a paste that carried formatting. Clicking it
 *  — or pressing Ctrl once, which is what Word does — expands the three icon buttons. Picking
 *  one RE-TRANSFORMS THE JUST-PASTED RANGE IN PLACE, as a single undo step: nothing is
 *  re-pasted from the clipboard and nothing outside that range is touched.
 *
 *  Module scope (MODULE-SCOPE-COMPONENTS): a component declared inside a render body is a new
 *  type every render, so React would remount it out from under its own click. */
function PasteOptions({ offer, expanded, onExpand, onPick, onDismiss }) {
  if (!offer) return null;
  const box = {
    position: "absolute", left: Math.max(6, offer.x), top: offer.y + 4, zIndex: 40,
    display: "flex", alignItems: "center", gap: 3, padding: 3,
    borderRadius: RADIUS.control, border: "1px solid var(--border-default)",
    background: "var(--surface-raised)", boxShadow: "0 8px 22px rgba(0,0,0,0.18)",
  };
  if (!expanded) {
    return (
      <div data-testid="note-paste-options" style={box}>
        <button
          type="button"
          data-testid="note-paste-badge"
          title="Paste options (Ctrl)"
          aria-label="Paste options"
          aria-expanded={false}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onExpand}
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "2px 6px",
            border: "none", borderRadius: RADIUS.control, background: "transparent",
            color: "var(--text-secondary)", font: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer",
          }}
        >
          <PasteIcon mode="source" />
          <span style={{ opacity: 0.7 }}>▾</span>
        </button>
      </div>
    );
  }
  return (
    <div data-testid="note-paste-options" role="group" aria-label="Paste options" style={box}>
      {PASTE_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          data-testid={`note-paste-${mode}`}
          title={`${PASTE_MODE_META[mode].label} (${PASTE_MODE_META[mode].key})`}
          aria-label={PASTE_MODE_META[mode].label}
          aria-keyshortcuts={PASTE_MODE_META[mode].key}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(mode)}
          style={{
            display: "grid", placeItems: "center", width: 26, height: 24,
            border: "1px solid transparent", borderRadius: RADIUS.control,
            background: "transparent", color: "var(--text-primary)", cursor: "pointer",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-page)"; e.currentTarget.style.borderColor = "var(--border-default)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
        >
          <PasteIcon mode={mode} />
        </button>
      ))}
      <button
        type="button"
        data-testid="note-paste-options-dismiss"
        aria-label="Dismiss"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDismiss}
        style={{
          border: "none", background: "transparent", color: "var(--text-tertiary)",
          font: "inherit", fontSize: 12, padding: "0 4px", cursor: "pointer",
        }}
      >✕</button>
    </div>
  );
}

/** The document's own right-click menu — one item, because there is exactly one thing here
 *  that the keyboard route hides (B36051). Not a dialog, closes on Escape and on an outside
 *  press, and reachable from the keyboard through the context-menu key like every other
 *  menu in this module. */
function DocMenu({ at, onPlainPaste, onClose }) {
  const ref = useRef(null);
  /* ⛔ GATED ON `at`. Registered unconditionally, this effect put a CAPTURE-phase Escape
   * listener on the document that called preventDefault — while the menu was CLOSED. That
   * silently ate every Escape in the note, which killed the Escape-then-Tab keyboard escape
   * hatch (B1392) stone dead. The headless run caught it; a hook that fires while its own
   * component renders nothing is the shape to watch for. */
  useEffect(() => {
    if (!at) return undefined;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    ref.current?.querySelector("button")?.focus();
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }, [at, onClose]);
  if (!at) return null;
  return (
    <div
      ref={ref}
      role="menu"
      data-testid="note-doc-menu"
      style={{
        position: "fixed", left: Math.min(at.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 230),
        top: at.y, zIndex: 60, minWidth: 214, padding: "5px 0",
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.control, boxShadow: "0 14px 36px rgba(0,0,0,0.22)",
        display: "flex", flexDirection: "column",
      }}
    >
      {PASTE_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="menuitem"
          data-testid={mode === "text" ? "note-menu-paste-plain" : `note-menu-paste-${mode}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPlainPaste(mode)}
          style={{
            display: "flex", alignItems: "center", gap: 9,
            width: "100%", padding: "5px 12px", border: "none", background: "transparent",
            font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)",
            textAlign: "left", cursor: "pointer",
          }}
        >
          <PasteIcon mode={mode} />
          <span style={{ flex: 1 }}>{PASTE_MODE_META[mode].label}</span>
          <span style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>
            {mode === "text" ? "Ctrl+Shift+V" : PASTE_MODE_META[mode].key}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function NoteEditor({
  pageId, title, onTitleChange, onTitleCommit, onStatus, onExportMarkdown, onPrintNotice, onSaved,
  scopeLabel, status, updatedAt, searchTerm = "", onClearSearch, notebookPageIds, trail = [],
  projectLabel = null, readOnly = false, readOnlyNote = "",
}) {
  /* Initial content read ONCE, here. Not in an effect — see fix (2) in the header. */
  const [initialDoc] = useState(() => readPage(pageId) || EMPTY_DOC);
  const [find, setFind] = useState({ term: "", count: 0, index: 0 });

  /* The pending snapshot is PLAIN JSON captured at edit time, so the flush never has to
   * ask a possibly-destroyed editor for anything — see fix (1) in the header. */
  const pendingRef = useRef(null);
  /* The version snapshot's own copy of the document. Declared beside `pendingRef` because
   * they are written together and read apart — see the unmount effect further down for the
   * hook-cleanup-order bug that is the whole reason there are two of them. */
  const lastDocRef = useRef(null);
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

  /* PASTE JUST THE TEXT (B36051). `pasteOffer` is the last paste that actually CARRIED
   * formatting: `{ from, to, text, x, y }`, the range plus where to draw the chip. Null the
   * rest of the time, which is most of the time — an affordance that shows up on every paste
   * would be its own noise. The default Ctrl+V is untouched; this only watches. */
  const [pasteOffer, setPasteOffer] = useState(null);
  const pasteRef = useRef(null);
  pasteRef.current = pasteOffer;

  /* THE SLASH MENU (NEW-1). All of the decision — whether it is open, what is in it, which
   * row is highlighted — lives in the plugin (lib/notesSlashMenu.js) reading the document.
   * This state is a MIRROR for rendering, never the source: a second source of truth for
   * "is the menu open" is how a menu ends up open over a document that has moved on. */
  const [slash, setSlash] = useState({ open: false, items: [], index: 0, from: 0, to: 0, query: "" });
  const [slashAt, setSlashAt] = useState(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;

  /* The one place a real file dialog can be opened from — a ProseMirror keymap cannot open
   * one, so the two slash commands that need it hand back here. `pendingPick` says which
   * kind the open dialog is for, so one <input> serves both. */
  const pickRef = useRef(null);
  const pendingPick = useRef("image");

  const extensions = useMemo(
    () => noteExtensions({
      imageContext,
      onSearchMatches: (m) => setFind(m),
      onPasted: ({ from, to, text }) => setPasteOffer({ from, to, text, at: Date.now() }),
      onSlash: (s) => setSlash(s),
      onSlashRun: (id, range) => runSlashRef.current?.(id, range),
    }),
    [imageContext],
  );

  /* The command runner in a ref so the extension list stays stable — rebuilding extensions
   * would rebuild the whole editor, and an editor that rebuilds mid-keystroke loses the
   * keystroke. Same reasoning as the callback refs above. */
  const runSlashRef = useRef(null);

  const editor = useEditor({
    extensions,
    content: initialDoc,
    // The toolbar reads its active states straight off the editor, so it must re-render
    // as the caret moves — including selection-only transactions.
    shouldRerenderOnTransaction: true,
    immediatelyRender: false,
    /* ⛔ READ-ONLY IS A REAL MODE, NOT A DISABLED ONE (NEW-3). Reading a binned note must not
     * be able to change it — `editable: false` means no transaction is ever generated, so the
     * save path is not merely skipped, it is unreachable. */
    editable: !readOnly,
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
      const doc = ed.getJSON();
      // Two refs, deliberately: `pendingRef` is the SAVE's queue and is emptied by the
      // flush; `lastDocRef` is the version snapshot's and is never emptied. See the unmount
      // effect below for the cleanup-order bug that separating them fixes.
      lastDocRef.current = { id: pageId, doc };
      pendingRef.current = { id: pageId, doc };
      onStatusRef.current?.("unsaved");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    /* ⛔ THE PROVISIONAL BLOCK'S WHOLE LIFETIME, IN TWO LINES. A block you started and did not
     * type in goes the moment the caret leaves it, and every one of them goes when the note
     * loses focus altogether. `writePage` is the belt to this brace — nothing empty can reach
     * storage even if the tab is closed mid-gesture — and this is what stops one being left on
     * screen as an invisible obstacle in the meantime. */
    onSelectionUpdate: ({ editor: ed }) => {
      ed.commands.dropEmptyAnchors({ keep: anchorPosAtSelection(ed.state) });
    },
    onBlur: ({ editor: ed }) => {
      ed.commands.dropEmptyAnchors();
    },
  });

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
      selection: () => (editor.isDestroyed ? null : { from: editor.state.selection.from, to: editor.state.selection.to, empty: editor.state.selection.empty }),
    };
    window.__noteEditor = hook;
    return () => { if (window.__noteEditor === hook) window.__noteEditor = null; };
  }, [editor]);

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

  /* ---- THE SLASH MENU (NEW-1) ------------------------------------------------------------
   *
   * Running a command is deliberately routed through here rather than left to the plugin:
   * two of the fifteen (Image, Attachment) need a file dialog, which only a React surface
   * can open. Everything else goes straight to `applySlashCommand`, which deletes the typed
   * `/query` and applies the block IN ONE CHAIN — so a single Ctrl+Z puts back both. */
  const runSlash = useCallback((id, range) => {
    if (!editor || editor.isDestroyed) return;
    applySlashCommand(editor, id, range, {
      onPickFile: (kind) => { pendingPick.current = kind === "attachment" ? "attachment" : "image"; pickRef.current?.click(); },
    });
  }, [editor]);
  runSlashRef.current = runSlash;

  /* Where to draw it: the editor's own coordinates for the `/` itself, resolved at the
   * moment it is shown — the same technique the paste chip uses, and for the same reason
   * (a remembered mouse position is not where the caret is). */
  useEffect(() => {
    if (!slash.open || !editor || editor.isDestroyed) { setSlashAt(null); return; }
    try {
      const coords = editor.view.coordsAtPos(Math.min(slash.from, editor.state.doc.content.size));
      const host = editor.view.dom.closest("[data-testid='note-mat']")?.getBoundingClientRect();
      setSlashAt(host ? { x: coords.left - host.left, y: coords.bottom - host.top } : null);
    } catch (_) { setSlashAt(null); }
  }, [slash.open, slash.from, slash.query, editor]);

  const pickFiles = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !editor || editor.isDestroyed) return;
    if (pendingPick.current === "attachment") editor.commands.insertNoteFiles(files);
    else editor.commands.insertNoteImages(files);
  }, [editor]);

  /* ---- THE OUTLINE (NEW-6) ----------------------------------------------------------------
   *
   * Derived from the DOCUMENT, not from the DOM: `outlineFromDoc` is pure and its positions
   * are ProseMirror's own, which is what lets a row scroll the editor to a real place and
   * what lets the active row be decided by comparing the caret's position rather than by
   * measuring anything. Recomputed on every transaction because a heading typed a second
   * ago has to appear a second ago — this is cheap (a walk of the JSON), and it is exactly
   * the model-derived kind of work VIEW-INDEPENDENT-ONCE has no quarrel with: it depends on
   * the document and the selection, never on the viewport. */
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [foldedHeadings, setFoldedHeadings] = useState(() => new Set());
  const [docTick, setDocTick] = useState(0);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const bump = () => setDocTick((n) => n + 1);
    editor.on("update", bump);
    editor.on("selectionUpdate", bump);
    return () => { editor.off("update", bump); editor.off("selectionUpdate", bump); };
  }, [editor]);

  const outline = useMemo(() => {
    if (!editor || editor.isDestroyed) return [];
    return outlineFromDoc(editor.getJSON());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docTick]);

  const outlineActive = useMemo(() => {
    if (!editor || editor.isDestroyed) return -1;
    return activeOutlineIndex(outline, editor.state.selection.from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, outline, docTick]);

  const goToHeading = useCallback((entry) => {
    if (!editor || editor.isDestroyed) return;
    const pos = Math.min(entry.pos + 1, editor.state.doc.content.size);
    editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
  }, [editor]);

  /* ---- VERSION HISTORY (NEW-3) -------------------------------------------------------------
   *
   * ⛔ A SNAPSHOT IS NOT A SAVE, and it does not ride the save debounce. Saving happens every
   * 600 ms because losing 600 ms of typing is unacceptable; snapshotting that often would put
   * a row in the history for every sentence. The store decides whether one is DUE
   * (`shouldSnapshot`, ~90 s) and refuses a row identical to the last, so this effect can
   * simply offer the document after every edit and let the policy do the deciding — the
   * policy lives in ONE place (lib/notesVersions.js) rather than being spread across the two
   * callers below.
   *
   * The two moments that always deserve a row are LEAVING the page and either side of a
   * restore, and those pass `force`. */
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const refreshVersions = useCallback(async () => {
    setHistoryBusy(true);
    const rows = await readPageVersions(pageId);
    setVersions(rows);
    setHistoryBusy(false);
  }, [pageId]);

  useEffect(() => { if (historyOpen) refreshVersions(); }, [historyOpen, refreshVersions]);

  // Offer a snapshot as typing settles. Same debounce family as the save, one order of
  // magnitude out — see the note above for why the two cadences are different.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !docTick) return undefined;
    const t = setTimeout(() => {
      if (editor.isDestroyed) return;
      snapshotPage(pageId, editor.getJSON()).then((r) => { if (r.taken && historyOpen) refreshVersions(); });
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docTick, editor, pageId]);

  /* ⛔ LEAVING THE PAGE ALWAYS TAKES ONE — and it reads its OWN ref, not `pendingRef`.
   *
   * This is the same hook-cleanup-ORDER trap this file's header is about, one layer along,
   * and it cost a red harness row before it was seen: `pendingRef` is CLEARED by the save
   * flush, whose cleanup is registered EARLIER in this component and therefore runs FIRST.
   * A snapshot reading `pendingRef` on unmount reliably found null and took no version at
   * all — silently, because "no versions yet" is also what a page nobody edited looks like.
   * `lastDocRef` is written at edit time and never cleared by anybody, so leaving a page
   * that was typed into always leaves a row behind, and one that was not still leaves none. */
  useEffect(() => () => {
    const last = lastDocRef.current;
    if (last?.id === pageId && last.doc) snapshotPage(pageId, last.doc, { reason: "closed", force: true });
  }, [pageId]);

  const handleRestore = useCallback(async (v) => {
    setHistoryBusy(true);
    const r = await restorePageVersion(pageId, v.key);
    if (!r.ok) onPrintNotice?.(r.error || "That version could not be restored, so nothing was changed.");
    await refreshVersions();
    setHistoryBusy(false);
  }, [pageId, refreshVersions, onPrintNotice]);

  /* ---- WHAT THE ROLLUP AND THE RESTORE ARE ALLOWED TO DO TO THIS DOCUMENT (NEW-3 / NEW-4)
   *
   * ⛔ BOTH GO THROUGH THE EDITOR, NEVER ROUND THE BACK OF IT. Writing this page's JSON to
   * storage while this instance holds the document is a silent-loss bug by construction:
   * the editor's own next save — or its unmount flush — writes its stale copy back over the
   * change. Registered as real editor operations they become ordinary transactions: in the
   * document, in the undo history, saved by the one save path. */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    /* ⛔ A READ-ONLY VIEW NEVER CLAIMS THE PAGE. The claim exists so a task tick or a version
     * restore goes THROUGH the open editor rather than round the back of it — and a bin peek
     * can accept neither, so claiming would only let one of several peeked pages take a write
     * meant for the live note. */
    if (readOnly) return undefined;
    return registerOpenNoteDoc(pageId, {
      applyTaskToggle: (ref, checked) => {
        if (editor.isDestroyed) return { ok: false, changed: false };
        const r = setTaskCheckedInDoc(editor.getJSON(), ref, checked);
        if (!r.changed) return { ok: true, changed: false };
        const node = editor.schema.nodeFromJSON(r.doc);
        editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, node.content).setMeta("addToHistory", true));
        return { ok: true, changed: true };
      },
      applyDocument: (doc) => {
        if (editor.isDestroyed) return { ok: false, error: "the editor closed before the version could be applied" };
        try {
          const node = editor.schema.nodeFromJSON(doc);
          editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, node.content));
          return { ok: true };
        } catch (e) {
          return { ok: false, error: `that version could not be read back (${e?.message || e})` };
        }
      },
    });
  }, [editor, pageId, readOnly]);

  /* ⛔ THE CARET GOES WHERE YOU PRESSED — a real positioned node at the press point.
   *
   * Read `lib/notesAnchorNode.js`'s header for the three earlier rounds and why padding
   * paragraphs plus text-align was wrong in four distinct ways. The short version: the
   * position is two numbers ON THE NODE, so it cannot crawl as you type, cannot leak onto the
   * next paragraph, leaves nothing to backspace through, and rides the document into storage,
   * the cloud and the PDF.
   *
   * ⛔ THE COORDINATES ARE CONVERTED OUT OF SCREEN SPACE HERE. The stored point is in the
   * document's OWN frame — client position minus the editor's box, divided by the live zoom.
   * Storing what was on the screen would move every block the moment somebody zoomed, which is
   * the same class of mistake as storing a colour instead of a tone name.
   *
   * ⛔ AND IT DROPS ANY BLOCK THE LAST PRESS LEFT EMPTY, in the same gesture. Otherwise every
   * stray click would leave one behind and the page would fill with invisible dead zones —
   * which is the failure this whole round exists to close. */
  const placeBlockAt = useCallback((clientX, clientY) => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    const box = dom.getBoundingClientRect();
    /* The live scale, measured rather than assumed: `offsetWidth` is unzoomed CSS pixels and
     * the client rect is zoomed ones, so their ratio IS the zoom, whatever set it. */
    const scale = box.width / (dom.offsetWidth || 1) || 1;
    /* ⛔ NARROWED TO FIT, NEVER SLID SIDEWAYS, AND NEVER NUDGED UP. See `placeAnchor` for the
     * measurements that killed the old clamp: a click at x=1010 and a click at x=900 both
     * produced a block at x=884, and the clamped value was written to storage. */
    const point = placeAnchor({
      x: (clientX - box.left) / scale,
      y: (clientY - box.top) / scale,
      width: dom.offsetWidth,
    });
    editor.chain().dropEmptyAnchors().addNoteAnchorAt(point).run();
  }, [editor]);

  /* ⛔ ONE RULE FOR EVERY PRESS ON THE PAGE, AND IT IS ONE SENTENCE:
   *
   *      A PRESS BESIDE A LINE OF WRITING GOES INTO THAT LINE.
   *      A PRESS ANYWHERE ELSE PUTS THE CARET WHERE YOU PRESSED.
   *
   * THE HISTORY, kept because each step was wrong in a way worth not repeating.
   *   B1368    the mat forwarded a press to the nearest text position, so clicking beside or
   *            below the text stopped doing nothing.
   *   B1393    bound double-click to the mat. The caret took FOCUS but landed at the end of
   *            the TEXT, so typing appeared on line one. The check asserted focus, not
   *            placement, so it was green while the owner reported the failure twice.
   *   B1393 ×2 implemented Word's Click and Type: pad with empty paragraphs to reach the
   *            press, and take the paragraph's alignment from the horizontal position. The
   *            line then CRAWLED LEFT as he typed (each character re-centres a centred
   *            paragraph), the alignment was inherited on Enter, and the padding was permanent
   *            — in the document, the Markdown and the PDF.
   *   B1393 ×3 removed all of it: the caret goes to the nearest real text position and nothing
   *            else. Horizontal position deliberately not honoured.
   *   B342993  made the positioned block, on a DOUBLE-click, so horizontal position could be
   *            honoured without any of round 2's costs.
   *   ⛔ AND THIS ROUND, which is the one that collapses two gestures into one. His report:
   *            *"If I do a single click, it goes still goes all the way to the left, which is
   *            probably part of the error."* He is right and it is not cosmetic — B1393 ×3's
   *            "nearest real text position" is a LONG JUMP on a page that looks empty: click
   *            in open space low on the sheet and the caret flies to the end of a paragraph
   *            far above, or to the end of the document, which reads as the click having gone
   *            somewhere else entirely.
   *
   * ⛔ WHY THE SINGLE CLICK PLACES, RATHER THAN DOING NOTHING. Both were on the table. Doing
   * nothing is defensible and it loses the thing he has asked for five times — click where you
   * want to write, and write there. Placing on the FIRST press also makes the double-click
   * requirement moot: press two lands inside the block press one just made, so it is a press
   * on content and puts the caret in it. **One gesture, one rule, no invisible document state
   * deciding between them** — which is precisely what killed round 2.
   *
   * ⛔ AND IT COSTS NOTHING WHEN IT WAS NOT WHAT YOU MEANT, which is the only reason it can be
   * this aggressive: the block it makes is PROVISIONAL until you type in it (see
   * `notesAnchorPrune.js`). Click somewhere else and it is gone, with no undo frame and
   * nothing written.
   *
   * ⛔ "BESIDE A LINE" IS MEASURED, NOT GUESSED. The nearest text position is asked for, and
   * then CHECKED: if that position is not on the line the press actually landed next to, it
   * was a long jump and the press is treated as blank space. That is what stops the fling
   * while leaving the ordinary case — clicking in the white space to the right of a short line
   * to put the caret at its end — working exactly as it always has.
   *
   * ⛔ A PRESS ON TEXT IS UNTOUCHED, and the double-click-to-select-a-word it carries with it. */
  const focusFromMat = useCallback((e) => {
    if (!editor || editor.isDestroyed) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (el.closest("input, textarea, select, button, a")) return;

    /* ⛔ A PRESS INSIDE AN ANCHORED BLOCK IS A PRESS ON CONTENT. This was the owner's ORIGINAL
     * complaint — *"it keeps wanting to just go to wherever there is text on the left"* — and
     * it was live until B350004: the mat's blank-space test measures the last FLOW child, and
     * a block is out of flow, so every block below the text was, to the mat, empty page.
     *
     * ⛔ AND AN EMPTY BLOCK IS THE CASE THAT STILL FAILED. There is no text in it for the
     * browser to put a caret on, so the press did nothing at all — indistinguishable from a
     * broken feature, and the exact spot somebody had just tried to use. So we put the caret
     * in it ourselves rather than assume the browser will. */
    /* ⛔ A NODE THAT OWNS ITS OWN GESTURES KEEPS THEM. A sketch canvas has its own
     * double-click ("make a box right here"), and a picture and an attachment are objects you
     * select rather than page you write on. The mat claiming those presses would put an
     * anchored block ON TOP of a drawing — caught by the sketch rows of `verify-notes`, which
     * is why this list exists rather than being assumed. */
    if (el.closest(".planyr-sketch-host, .planyr-note-image, .planyr-note-file")) return;

    const inBlock = el.closest(".planyr-anchor");
    if (inBlock) {
      if (inBlock.getAttribute("data-empty") !== "1") return;   // it has words; the browser is right
      e.preventDefault();
      const pos = editor.view.posAtDOM(inBlock, 0);
      if (Number.isFinite(pos)) editor.chain().focus().setTextSelection(pos + 1).run();
      else editor.commands.focus();
      return;
    }

    const dom = editor.view.dom;
    const box = dom.getBoundingClientRect();
    const hit = editor.view.posAtCoords({
      left: Math.min(Math.max(e.clientX, box.left + 1), box.right - 1),
      top: Math.min(Math.max(e.clientY, box.top + 1), box.bottom - 1),
    });

    if (hit && Number.isFinite(hit.pos) && pressIsBesideLine(editor, hit.pos, e.clientY)) {
      // Beside real writing. Inside the document the browser is already right and must stay
      // right, or double-click-to-select-a-word dies; outside it (left of the column, above
      // the first line) the mat forwards the press, which is what B1368 was for.
      if (el.closest(".ProseMirror") || el.closest("[contenteditable]")) return;
      e.preventDefault();
      editor.chain().focus().setTextSelection(hit.pos).run();
      return;
    }

    // Blank space: the caret goes where the press went.
    e.preventDefault();
    e.stopPropagation();
    placeBlockAt(e.clientX, e.clientY);
  }, [editor, placeBlockAt]);

  /* ---- HOW BIG THE WRITING IS (NEW-3) ----------------------------------------------------
   *
   * ⛔ THE DOCUMENT ZOOMS, THE APP DOES NOT. The sheet scales; the rail, the toolbar and the
   * header do not. The browser already has a control that scales everything together — what
   * it does not have is "make the writing bigger and leave my navigation where it is", which
   * is the one being asked for. Every rule (the steps, the wheel curve, what each key means,
   * where the level is kept) is pure and unit-tested in lib/notesZoom.js; this is the wiring.
   *
   * ⛔ IT USES CSS `zoom`, NOT A TRANSFORM, AND THAT IS THE LOAD-BEARING CHOICE. A transform
   * paints the same layout larger — the line breaks stay put and the caret drifts out of the
   * glyphs. `zoom` RE-LAYS OUT at the new size, so text rewraps, the caret is the browser's
   * own, and the anchored blocks of NEW-2 keep their geometry. It is also why `placeBlockAt`
   * can recover the live scale by measuring rather than by being told. */
  const [zoom, setZoom] = useState(() => normalizeZoom(readNotesZoom()));
  const scrollerRef = useRef(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /* ⛔ THE SAME WRITING STAYS UNDER THE EYE ACROSS A STEP (VIEWPORT-STABLE). Left alone, a
   * zoom throws the reader somewhere else: the content above the viewport changes height, so
   * the same scrollTop points at a different paragraph. The anchor's offset is measured
   * BEFORE the change and the new scroll position is arithmetic, not a guess — and it is
   * applied in a layout effect, before paint, so nothing is ever seen in the wrong place. */
  const zoomFrom = useRef(zoom);
  const applyZoom = useCallback((next) => {
    const to = normalizeZoom(next);
    setZoom((cur) => {
      if (to === cur) return cur;
      const sc = scrollerRef.current;
      if (sc) zoomFrom.current = { from: cur, to, scrollTop: sc.scrollTop };
      writeNotesZoom(to);
      return to;
    });
  }, []);

  useLayoutEffect(() => {
    const rec = zoomFrom.current;
    const sc = scrollerRef.current;
    if (!rec || typeof rec !== "object" || !sc) return;
    zoomFrom.current = null;
    // The anchor is the top of the viewport, expressed in the document's OWN frame — which is
    // what makes it comparable across two different zoom levels.
    const anchorOffset = rec.scrollTop / rec.from;
    const nextTop = scrollTopAfterZoom({ anchorOffset, viewportOffset: 0, from: rec.from, to: rec.to });
    if (nextTop != null) sc.scrollTop = nextTop;
  }, [zoom]);

  /* Ctrl+wheel. Non-passive and `preventDefault`ed, because the whole point is that the
   * BROWSER's zoom does not also fire — two things scaling on one gesture is worse than
   * neither. Attached by hand for exactly that reason: React's onWheel is passive. */
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return undefined;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      applyZoom(zoomForWheel(zoomRef.current, e.deltaY, { deltaMode: e.deltaMode }));
    };
    sc.addEventListener("wheel", onWheel, { passive: false });
    return () => sc.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  /* Ctrl+= / Ctrl+- / Ctrl+0. On the WINDOW, because the caret is usually inside the document
   * and a listener on the pane would miss half of them — and gated on this editor being
   * mounted, which it only is on the Notes route. */
  useEffect(() => {
    const onKey = (e) => {
      const next = zoomForKey(zoomRef.current, e);
      if (next == null) return;
      e.preventDefault();
      applyZoom(next);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [applyZoom]);

  /* ⛔ THE PAGE GROWS TO HOLD THE BLOCKS — WHICH IS WHY THEY STOP MOVING (NEW-2, round 2).
   *
   * MEASURED ON HIS MACHINE: a block anchored at y=380 was at y=380 after one word and at
   * **y=343 once the text had wrapped to 156 px tall**. It moved 37 px UP, under the caret,
   * mid-sentence — and was fine again after a reload, which is exactly the "random" feeling
   * he described. The stored offset was correct the whole time.
   *
   * THE CAUSE IS NOT A LAYOUT CLAMP, IT IS THE SCROLLER. An absolutely positioned block adds
   * NOTHING to its container's height, so a block low on the page — or one that grows while
   * being typed into — hangs outside the scrollable area entirely. The browser then does the
   * only thing it can to keep the caret visible: it scrolls. Everything on screen slides up,
   * including the block, and no amount of "the position is an attribute" prevents it.
   *
   * So the editor is told how tall it actually needs to be. Heights come from the DOM because
   * a block's height IS its text and only the browser knows that; the arithmetic is pure
   * (`anchorExtent`). A `min-height` cannot feed back into the anchors' own heights — they are
   * out of flow and sized by their width — so there is no loop to guard against. */
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const dom = editor.view.dom;
    const measure = () => {
      const blocks = [...dom.querySelectorAll(".planyr-anchor")].map((el) => ({
        y: parseFloat(el.style.top) || 0,
        height: el.offsetHeight,
      }));
      const need = anchorExtent(blocks);
      dom.style.minHeight = need ? `max(46vh, ${need}px)` : "";
    };
    measure();
    /* Re-measured as the text inside a block reflows, which is the half that matters: the
     * block gets taller as you type and the page has to keep up in the same frame. */
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) for (const el of dom.querySelectorAll(".planyr-anchor")) ro.observe(el);
    return () => ro?.disconnect();
  }, [editor, docTick]);

  /* ---- PASTE JUST THE TEXT (B36051) ------------------------------------------------------
   *
   * Two routes in, and the DEFAULT PASTE IS UNCHANGED behind both of them. The chip's
   * position is resolved from the editor's own coordinates at the moment it is shown, so it
   * lands at the paste point rather than at a remembered mouse position. */
  const [docMenu, setDocMenu] = useState(null);
  const [pasteAt, setPasteAt] = useState(null);

  useEffect(() => {
    if (!pasteOffer || !editor || editor.isDestroyed) { setPasteAt(null); return undefined; }
    let live = true;
    try {
      const coords = editor.view.coordsAtPos(Math.min(pasteOffer.to, editor.state.doc.content.size));
      const host = editor.view.dom.closest("[data-testid='note-mat']")?.getBoundingClientRect();
      if (host) setPasteAt({ x: coords.left - host.left, y: coords.bottom - host.top });
      else setPasteAt(null);
    } catch (_) { setPasteAt(null); }
    // Word's chip goes away on its own rather than sitting there for the rest of the session.
    const t = setTimeout(() => { if (live) setPasteOffer(null); }, 12000);
    return () => { live = false; clearTimeout(t); };
  }, [pasteOffer, editor]);

  /* Any further editing retires the offer — its range would be stale, and an option that
   * would silently act on the wrong text is worse than no option. */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const retire = () => { if (pasteRef.current) setPasteOffer(null); };
    editor.on("update", retire);
    return () => { editor.off("update", retire); };
  }, [editor]);

  /* ⛔ PICKING A MODE RE-TRANSFORMS THE JUST-PASTED RANGE IN PLACE, as ONE undo step — it
   * never re-pastes from the clipboard and never touches anything outside that range. */
  const [pasteExpanded, setPasteExpanded] = useState(false);
  const applyPasteMode = useCallback((mode) => {
    const offer = pasteRef.current;
    setPasteOffer(null);
    setPasteExpanded(false);
    if (!offer || !editor || editor.isDestroyed) return;
    if (mode === "source") return;                       // already what is on the page
    const to = Math.min(offer.to, editor.state.doc.content.size);
    if (to <= offer.from) return;
    if (mode === "text") editor.commands.keepTextOnly({ from: offer.from, to });
    else editor.commands.mergeFormatting({ from: offer.from, to });
  }, [editor]);

  /* Ctrl on its own expands the badge — Word's shortcut, and the reason the badge can be a
   * badge rather than three buttons permanently in the way. */
  useEffect(() => {
    if (!pasteOffer) { setPasteExpanded(false); return undefined; }
    const onKey = (e) => {
      if (e.key === "Control") { setPasteExpanded(true); return; }
      if (e.key === "Escape") { setPasteOffer(null); return; }
      if (!pasteExpanded) return;
      const hit = PASTE_MODES.find((m) => PASTE_MODE_META[m].key.toLowerCase() === e.key.toLowerCase());
      if (hit) { e.preventDefault(); applyPasteMode(hit); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [pasteOffer, pasteExpanded, applyPasteMode]);

  /** Ctrl/Cmd+Shift+V, and the right-click menu's item, land here. LOUD-FAILURE: a browser
   *  that refuses clipboard access must SAY so and name the shortcut that always works,
   *  never fail silently and leave him pressing a dead menu item. */
  const pastePlainFromClipboard = useCallback(async (mode = "text") => {
    setDocMenu(null);
    if (!editor || editor.isDestroyed) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch (_) {
      onPrintNotice?.("Your browser wouldn't let Planyr read the clipboard from a menu. Press Ctrl+Shift+V (⌘+Shift+V on a Mac) to paste plain text.");
      return;
    }
    if (!text) return;
    /* From a MENU the clipboard is only readable as text, so "keep source" and "merge" have
     * nothing extra to keep — say so rather than pretend, and point at the gesture that does
     * carry the formatting (LOUD-FAILURE). The plain route is the one that works everywhere,
     * which is why it is the one bound to the shortcut. */
    if (mode !== "text") {
      onPrintNotice?.("A browser only hands a menu the plain text of the clipboard. Press Ctrl+V to paste with its formatting, then choose Keep source or Merge from the badge that appears.");
      return;
    }
    editor.commands.insertPlainText(text);
  }, [editor, onPrintNotice]);

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
    // Pictures always inline; attached FILES inline up to a size and are otherwise NAMED
    // and reported as lossy (NEW-5) — a 30 MB drawing base64'd into a `.md` produces a file
    // nothing will open, which is a worse answer than a stated one.
    const images = {
      ...await readNoteImages(imageIdsInDoc(json)),
      ...await readNoteFiles(attachmentIdsInDoc(json), { maxBytes: MD_INLINE_ATTACHMENT_MAX }),
    };
    const { markdown, lossy } = docToMarkdown(json, { title, images });
    onExportMarkdown?.({ markdown, lossy, filename: safeFileName(title) });
  }, [editor, title, onExportMarkdown]);

  const printPage = useCallback(async () => {
    if (!editor || editor.isDestroyed) return;
    const json = editor.getJSON();
    const images = await readNoteImages(imageIdsInDoc(json));
    const html = buildPrintDocument({
      title: title || "Untitled page",
      meta: (trail || []).filter(Boolean).join(" › "),
      pages: [{ title, html: docToHtml(json, images), updatedAt }],
    });
    const r = await printHtmlDocument(html);
    if (!r.ok) onPrintNotice?.(r.error);
  }, [editor, title, updatedAt, trail, onPrintNotice]);

  const badge = status === "error"
    ? { text: "Not saved", color: "var(--danger-text)" }
    : status === "unsaved"
      ? { text: "Unsaved", color: "var(--warn-text)" }
      : { text: "Saved", color: "var(--save-badge)" };

  const edited = editedLabel(updatedAt);

  return (
    <div className="planyr-note" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, background: "var(--surface-page)" }}>
      <EditorStyles />
      <NoteToolbar
        editor={editor}
        onExport={exportPage}
        onPrint={printPage}
        onAttach={() => { pendingPick.current = "attachment"; pickRef.current?.click(); }}
        onHistory={() => setHistoryOpen((v) => !v)}
        historyOpen={historyOpen}
      />
      <FindBar term={find.term} count={find.count} index={find.index} onStep={stepFind} onClear={onClearSearch} />

      {/* ONE file picker for both slash commands and the toolbar's attach button — which
          kind of insert it is for is decided when it is opened, not by having two of them. */}
      <input
        ref={pickRef}
        data-testid="note-file-input"
        type="file"
        multiple
        onChange={pickFiles}
        style={{ display: "none" }}
      />

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>

      {/* The mat. It is the WHOLE pane, and a press anywhere on it lands the caret — see
          focusFromMat for the one rule that governs every press. `data-testid` so the headless
          check can press the dead zone.

          ⛔ THERE IS NO SEPARATE DOUBLE-CLICK HANDLER ANY MORE, and that removal is the point.
          A click and a double-click meaning two different things is what let the same gesture
          behave differently depending on invisible document state, four rounds running. The
          first press places; the second press lands inside what the first one made, which is a
          press on content and puts the caret in it. One gesture, one rule. */}
      <div
        data-testid="note-mat"
        onMouseDown={focusFromMat}
        /* Ctrl/Cmd+Shift+V — the shortcut everyone already knows. Caught here rather than in
           the extension's keymap because the payload is the SYSTEM clipboard, which only the
           async clipboard API can read; a ProseMirror keybinding cannot await one. */
        onKeyDown={(e) => {
          /* ⛔ ESCAPE ABANDONS A BLOCK YOU HAVE NOT TYPED IN. The caret leaving takes one away
             on its own; this is the way out that does not require going somewhere else first,
             and it is the one somebody reaches for when they realise they pressed by mistake.
             It does NOT stop propagation: Escape's other job here — releasing the next Tab —
             still has to happen. */
          if (e.key === "Escape" && editor && !editor.isDestroyed) {
            editor.commands.dropEmptyAnchors();
            return;
          }
          if (!(e.key === "V" || e.key === "v") || !e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          e.stopPropagation();
          pastePlainFromClipboard();
        }}
        onContextMenu={(e) => {
          if (!(e.target instanceof Element) || !e.target.closest(".ProseMirror")) return;
          e.preventDefault();
          setDocMenu({ x: e.clientX, y: e.clientY });
        }}
        ref={scrollerRef}
        style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", position: "relative" }}
      >
        <PasteOptions
          offer={pasteAt && pasteOffer ? { ...pasteOffer, ...pasteAt } : null}
          expanded={pasteExpanded}
          onExpand={() => setPasteExpanded(true)}
          onPick={applyPasteMode}
          onDismiss={() => setPasteOffer(null)}
        />
        {/* THE SLASH MENU (NEW-1). Drawn over the mat at the `/` itself; every decision
            about it is the plugin's — see lib/notesSlashMenu.js. */}
        <NoteSlashMenu
          open={slash.open}
          items={slash.items}
          index={slash.index}
          at={slashAt}
          onPick={(id) => runSlash(id, { from: slashRef.current.from, to: slashRef.current.to })}
          onHover={() => {}}
        />
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
        {/* ⛔ THE ZOOM IS ON THE SHEET AND NOWHERE ELSE (NEW-3) — not on the pane, which would
            scale the paste chip and the slash menu with it, and not on the app. `zoom` rather
            than a transform so the text RE-WRAPS at the new size and the caret stays the
            browser's own. */}
        <div
          data-testid="note-sheet"
          data-zoom={zoom}
          style={{ maxWidth: 820, width: "100%", flex: "1 0 auto", margin: 0, padding: "22px 20px 96px 13px", zoom }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <input
              data-testid="note-title"
              value={title}
              placeholder="Untitled page"
              aria-label="Page title"
              onChange={(e) => onTitleChange?.(e.target.value)}
              /* ⛔ TAB OUT OF THE TITLE GOES INTO THE PAGE (B1392 ×2). The title is a plain
                 <input>, so Tab here was the browser's focus key and landed on whatever
                 control came next — which is exactly the "Chrome grabs it" complaint, on a
                 surface B1392 never covered. Forward means "start writing"; Shift+Tab is
                 left alone so the way BACK to the toolbar and the rail still exists. */
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); return; }
                if (e.key !== "Tab" || e.shiftKey) return;
                if (!editor || editor.isDestroyed) return;
                onTitleCommit?.();
                e.preventDefault();
                editor.commands.focus("start");
              }}
              style={{
                flex: 1, minWidth: 0, border: "none", borderBottom: "1px solid transparent",
                background: "transparent", color: "var(--text-primary)",
                font: "inherit", fontSize: 27, fontWeight: 700, letterSpacing: "-0.01em",
                padding: "2px 0", outline: "none",
              }}
              onFocus={(e) => { e.target.style.borderBottomColor = "var(--accent-notes)"; }}
              /* ⛔ THE DEFAULT NAME LANDS HERE, ON THE WAY OUT — never on a keystroke. See
                 renameNode's header for the measurement: coercing a blank name on every change
                 made the field impossible to clear, because the write came straight back into a
                 controlled input. Folded into the existing blur rather than added beside it —
                 two onBlur props on one element and the second silently wins. */
              onBlur={(e) => { e.target.style.borderBottomColor = "transparent"; onTitleCommit?.(); }}
            />
            {/* ⛔ WHICH PROJECT THIS NOTE BELONGS TO, WHILE YOU ARE READING IT (NEW-2).
                The owner could not see a note's filing anywhere near the note itself: the
                rail drops the per-row badge inside a project (everything there belongs where
                you are standing) and the Dashboard's grouping is a level up from the page. So
                a note copied into an unrelated pursuit looked exactly like a note in the
                right place. This is the one surface that is always on screen with the note.
                It is a LABEL, never a control — re-filing stays on the row's menu, one place,
                so there is no second way to change the fact. An id that no longer resolves
                wears the warning colour rather than being captioned as "no project": a failed
                lookup and a page that genuinely belongs nowhere are different states. */}
            {projectLabel ? (
              <span
                data-testid="note-project-badge"
                data-project-id={projectLabel.projectId ?? ""}
                data-resolved={projectLabel.resolved ? "1" : "0"}
                title={`This note is filed in ${projectLabel.name}`}
                style={{
                  flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                  color: projectLabel.resolved ? "var(--text-secondary)" : "var(--warn-text)",
                  border: `1px solid ${projectLabel.resolved ? "var(--border-default)" : "var(--warn-text)"}`,
                  borderRadius: RADIUS.pill, padding: "3px 9px",
                }}
              >{projectLabel.name}</span>
            ) : null}
            {/* The level, shown only when it is NOT 100% (PANEL-BREVITY: a chip that always
                reads "100%" is furniture). Clicking it goes back to 100%, which is the one
                thing anybody wants from a zoom indicator. */}
            {zoom !== ZOOM_DEFAULT ? (
              <button
                type="button"
                data-testid="note-zoom-level"
                title="Back to 100% (Ctrl+0)"
                onClick={() => applyZoom(ZOOM_DEFAULT)}
                style={{
                  flex: "0 0 auto", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em",
                  color: "var(--text-secondary)", border: "1px solid var(--border-default)",
                  borderRadius: RADIUS.pill, padding: "3px 9px", background: "transparent",
                  font: "inherit", cursor: "pointer",
                }}
              >{zoomLabel(zoom)}</button>
            ) : null}
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

        {/* ⛔ BOTH PANES SIT TO THE **RIGHT** OF THE SHEET, and that is what makes them free
            of VIEWPORT-STABLE's compensation problem: the document column is left-aligned
            (B1369), so opening or closing either one cannot move the text sideways. There
            is no delta to measure because there is no delta. */}
        <NoteOutline
          entries={outline}
          activeIndex={outlineActive}
          collapsed={foldedHeadings}
          open={outlineOpen}
          onToggleOpen={() => setOutlineOpen((v) => !v)}
          onGo={goToHeading}
          onToggleRow={(id) => setFoldedHeadings((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })}
        />
        <NoteHistory
          open={historyOpen}
          versions={versions}
          busy={historyBusy}
          onRestore={handleRestore}
          onClose={() => setHistoryOpen(false)}
        />
      </div>
      <DocMenu at={docMenu} onPlainPaste={pastePlainFromClipboard} onClose={() => setDocMenu(null)} />
    </div>
  );
}
