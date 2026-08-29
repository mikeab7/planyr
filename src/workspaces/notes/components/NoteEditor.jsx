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
import { anchorExtent, anchorExtentX, anchorPosAtSelection, fitAnchorBox, placeAnchor } from "../lib/notesAnchorNode.js";
import {
  applyMarquee, boxesInMarquee, gestureOutcome, marqueeRect, moveSelection, nudgeDelta, toggleSelection,
} from "../lib/notesMarquee.js";
import {
  normalizeZoom, scrollTopAfterZoom, zoomForKey, zoomForWheel, zoomLabel, ZOOM_DEFAULT,
} from "../lib/notesZoom.js";
import { HIGHLIGHT_COLORS, SIZES, TEXT_COLORS } from "../lib/notesFormatPalette.js";
import { PASTE_MODES } from "../lib/notesPastePlain.js";
import { bindingShouldDecline } from "../lib/notesKeyScope.js";
import { DEFAULT_DENSITY, densityFor } from "../lib/notesSpacing.js";
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
import { isToolbarDiagArmed, latchToolbarDiag, recordToolbarDiag } from "../lib/notesToolbarDiag.js";
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
/* ⛔ THE NOTE'S DENSITY, AND IT IS THE ONE PLACE THE NUMBER LIVES (NEW-SPACING-1/3).
   It was a hard-coded 1.65 here — which measured as 15px text in a 24.75px line box, while
   Word and OneNote call ~1.15 single. So the loosest setting in the spacing control's own
   list was also its default, and picking "Single" changed nothing. The value now comes from
   lib/notesSpacing.js through a custom property, so the editor, the Compact control and the
   print sheet cannot drift. */
.planyr-note .ProseMirror { outline: none; min-height: 46vh; color: var(--text-primary); line-height: var(--note-line, 1.15); font-size: 15px; tab-size: 4; }
.planyr-note .ProseMirror > * + * { margin-top: 0.7em; }
.planyr-note .ProseMirror p { margin: 0; }
.planyr-note .ProseMirror h1 { font-size: 1.9em; font-weight: 700; line-height: 1.25; margin: 0; }
.planyr-note .ProseMirror h2 { font-size: 1.5em; font-weight: 700; line-height: 1.3; margin: 0; }
.planyr-note .ProseMirror h3 { font-size: 1.22em; font-weight: 650; margin: 0; }
.planyr-note .ProseMirror h4 { font-size: 1.06em; font-weight: 650; margin: 0; }
.planyr-note .ProseMirror ul, .planyr-note .ProseMirror ol { padding-left: 1.5em; margin: 0; }
.planyr-note .ProseMirror li { margin: var(--note-list-gap, 2px) 0; }
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
/* ⛔ A BOX AND ITS CONTROLS STAY REACHABLE EVEN WHEN THE BOX OVERHANGS THE SHEET (B421490 ×3).
   The left edge somebody chose is never moved — that is B350000's rule and its acceptance test
   guards it — so narrowing the window far enough leaves a box hanging past the sheet, where the
   outline and history panels are. Those panels come later in the document and would otherwise
   take its presses, which is how a box's delete and width handles became unclickable. Stacking is
   the right lever here: it keeps the box usable without moving anything the owner placed. */
.planyr-note .ProseMirror .planyr-anchor { position: absolute; z-index: 2; margin: 0 !important; box-sizing: border-box; padding: 3px 6px 3px 16px; border: 1px dashed transparent; border-radius: 5px; }
/* ⛔ NOTHING APPEARS BECAUSE THE POINTER PASSED OVER A BOX (B434418). Every affordance used to
   sit at zero opacity and be revealed by hover, which the owner asked for the removal of in as
   many words: *"I don't need it to leave visible every time I hover over something. I should have
   to click on the box and then press delete."* Hover reveal is also what made the controls
   unfindable — you had to already know they were there to put the pointer in the right few
   pixels. They now belong to the SELECTED state, which is a thing you chose.
   (No backticks in this block: it is inside a template literal, and that trap has broken this
   build five times now — see the guard in the notesModule suite.) */
.planyr-note .ProseMirror .planyr-anchor:focus-within { border-color: var(--border-strong); }
/* ⛔ AN EMPTY BLOCK IS NEVER INVISIBLE, AND THAT IS THE WHOLE OF THE "INTERMITTENT" BUG. One
   that draws nothing still occupies its box and still takes the press, so a second attempt at
   the same spot landed inside the first attempt's leftover and appeared to do nothing at all.
   It is outlined whenever it is empty, and while the caret is in it, it says what to do. The
   words are content, not a node — nothing here reaches the document, the Markdown or the PDF. */
/* ⛔ SELECTED IS OBVIOUS AT A GLANCE (B421494) — a solid accent ring and a faint wash, so a set
   of nine reads as one thing. It is a BORDER COLOUR on the existing border rather than an outline
   or a box-shadow: both of those paint outside the element's box, which would put chrome over the
   neighbouring box's controls and re-create the press-swallowing defect this module keeps hitting. */
.planyr-note .ProseMirror .planyr-anchor[data-selected="1"] { border-color: var(--accent-notes); border-style: solid; background: color-mix(in srgb, var(--accent-notes) 8%, transparent); }
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"] { border-color: var(--border-default); border-style: dashed; }
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"]:focus-within { border-color: var(--accent-notes); }
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"]:focus-within .planyr-anchor-content::after { content: "Type here"; position: absolute; left: 16px; top: 3px; pointer-events: none; color: var(--text-tertiary); font-style: italic; }
.planyr-note .ProseMirror .planyr-anchor-content { position: relative; }
.planyr-note .ProseMirror .planyr-anchor-grip { position: absolute; left: 3px; top: 5px; width: 9px; height: 14px; cursor: grab; border-radius: 2px; opacity: 0; background: repeating-linear-gradient(to bottom, var(--text-tertiary) 0 2px, transparent 2px 4px); }
.planyr-note .ProseMirror .planyr-anchor[data-selected="1"] .planyr-anchor-grip { opacity: 1; }
.planyr-note .ProseMirror .planyr-anchor-grip:active { cursor: grabbing; }
/* ⛔ THE BOX'S OWN CHROME SITS ABOVE THE BOX'S OWN TEXT, AND THAT z-index IS THE WHOLE FIX
   (B421488). A control inside the box's padding box overlaps the first line of text; the content
   wrapper below is position:relative (it has to be, for the empty box's "Type here" hint) and is
   appended LAST, so with both at z-index:auto the CONTENT painted on top. Paint order is hit-test
   order, so a press at a control's own centre landed on the paragraph: the control was visible,
   enabled, correctly labelled, and impossible to click. This is CHROME-NEVER-EATS-A-PRESS with the
   sides reversed — the content ate the chrome. The rule the z-index encodes: a control drawn ON the
   box belongs to the box's chrome layer. */
.planyr-note .ProseMirror .planyr-anchor-grip, .planyr-note .ProseMirror .planyr-anchor-h { z-index: 1; }
/* ⛔ EIGHT HANDLES, PAINTED FROM ONE RULE PLUS EIGHT POSITIONS (NEW-PICTURE-CANVAS / NEW-2).
   Bluebeam's and Office's convention: small square grips on every corner and every edge, visible
   only while the box is SELECTED — never on hover, which B434418 removed for good reasons. The
   cursor is set in the node view from HANDLE_CURSOR rather than here, so the loop that builds them
   and the shape they wear cannot drift apart the way a parallel list of selectors does.
   ⛔ A text box only gets east and west; its height is its words. That is decided in
   notesBoxResize.js handlesFor(), not by hiding handles here — a handle hidden in CSS still takes
   the press, which is this module's most-repeated defect. */
.planyr-note .ProseMirror .planyr-anchor-h { position: absolute; width: 10px; height: 10px; box-sizing: border-box; border: 1px solid var(--accent-notes); border-radius: 2px; background: var(--surface-raised); opacity: 0; pointer-events: none; }
.planyr-note .ProseMirror .planyr-anchor[data-selected="1"] .planyr-anchor-h { opacity: 1; pointer-events: auto; }
.planyr-note .ProseMirror .planyr-anchor-h-nw { left: -6px; top: -6px; }
.planyr-note .ProseMirror .planyr-anchor-h-ne { right: -6px; top: -6px; }
.planyr-note .ProseMirror .planyr-anchor-h-sw { left: -6px; bottom: -6px; }
.planyr-note .ProseMirror .planyr-anchor-h-se { right: -6px; bottom: -6px; }
.planyr-note .ProseMirror .planyr-anchor-h-n { left: 50%; top: -6px; margin-left: -5px; }
.planyr-note .ProseMirror .planyr-anchor-h-s { left: 50%; bottom: -6px; margin-left: -5px; }
.planyr-note .ProseMirror .planyr-anchor-h-w { left: -6px; top: 50%; margin-top: -5px; }
.planyr-note .ProseMirror .planyr-anchor-h-e { right: -6px; top: 50%; margin-top: -5px; }

/* ⛔ A BOX HOLDING A PICTURE IS THE PICTURE — no padding, and the image fills it exactly
   (NEW-PICTURE-CANVAS). The owner asked for pictures to behave like the positioned text boxes:
   *"dropped where he drops it, moved wherever he wants, resized, deleted, the same as everything
   else on the page."* A text box's padding buys a readable column; on a picture it is a border of
   dead space that makes the drawn box and the visible image disagree about where the edges are,
   which makes a corner drag feel wrong.
   ⛔ object-fit: fill, deliberately — an EDGE drag is meant to stretch, which is exactly what the
   owner asked for ("corners keep the aspect ratio, edges stretch"). Anything that preserves the
   ratio here would silently overrule the gesture and leave the picture floating inside a box the
   right size, which reads as the drag not having worked. */
/* ⛔ THE CLIP GOES ON THE CONTENT, NEVER ON THE BOX — AND THAT ONE WORD COST THE WHOLE FEATURE
   ONCE ALREADY. Every resize handle is positioned OUTSIDE the border box (they straddle the edge,
   which is what makes them grabbable), so an overflow:hidden on the anchor clips all eight of them
   away. They still lay out, so getBoundingClientRect returns a perfectly sensible 10px square in a
   perfectly sensible place, and every DOM reading says the control is present and correct — but a
   clipped element is not hit-testable, so elementFromPoint at the handle's own centre answers the
   EDITOR, and a real press does nothing at all. That is CHROME-NEVER-EATS-A-PRESS inverted: not
   chrome swallowing a press, but the box swallowing its own chrome, invisibly to anything short of
   an actual mouse. Clip the picture; never clip the frame. */
.planyr-note .ProseMirror .planyr-anchor[data-anchor-kind="image"] { padding: 0; }
.planyr-note .ProseMirror .planyr-anchor[data-anchor-kind="image"] .planyr-anchor-content { height: 100%; overflow: hidden; }
.planyr-note .ProseMirror .planyr-anchor[data-anchor-kind="image"] .planyr-note-image { margin: 0; height: 100%; }
.planyr-note .ProseMirror .planyr-anchor[data-anchor-kind="image"] .planyr-note-image img,
.planyr-note .ProseMirror .planyr-anchor[data-anchor-kind="image"] > img.planyr-note-img { display: block; width: 100%; height: 100%; object-fit: fill; max-width: none; }
/* The grip has to read over any picture, so on an image box it carries its own backdrop rather
   than relying on the page behind it. */
.planyr-note .ProseMirror .planyr-anchor[data-anchor-kind="image"] .planyr-anchor-grip { left: 2px; top: 2px; padding: 0 1px; border-radius: 3px; background-color: color-mix(in srgb, var(--surface-raised) 82%, transparent); }

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
/* ⛔ THE RIGHT-CLICK MENU IS WORD'S, NOT AN INVENTION (B539651, owner instruction 2026-08-14).
 *
 * HIS WORDS: *"the right click should have the normal formatting option, like it's a Word
 * document or an email where I can change text, I can underline, make it the exact same format.
 * Just copy Word."* And, in the same breath, the thing that must NOT be on screen: *"the delete
 * option shouldn't just be shown, like, anytime I click on the box… I should only be able to use
 * the keystroke to delete or a right click and then delete option."*
 *
 * ⛔ THE ITEMS ARE A TABLE, NOT MARKUP, and that is what lets the DOCUMENT menu and the BOX menu
 * be the same component with different rows rather than two menus that drift apart. A box's menu
 * is the document's plus its own actions — because right-clicking a box is still right-clicking
 * inside text, and everything that applied to the words still applies.
 *
 * ⛔ EVERY ITEM CANCELS `mousedown`. A menu that steals the selection cannot act on it, and the
 * failure is silent: the command runs against an empty range and appears to do nothing. This is
 * the same rule the toolbar has had since B1370.
 */

/** One separator row. A named constant so the table below reads as a menu rather than as a list
 *  with holes in it. */
const SEP = { sep: true };

/** ⛔ THE FORMATTING LIVES ON A HORIZONTAL MINI-TOOLBAR, NOT IN THE VERTICAL LIST
 *  (NEW-MINI-TOOLBAR, owner instruction 2026-08-17).
 *
 *  HIS WORDS: *"there's too many things — bold, italic, underline, strike, bullets, numbering.
 *  That should be in the Microsoft Word format or OneNote format where you right click something
 *  and there's one menu that's the typical menu with cut, copy, paste, whatever. And then there's
 *  another menu that kind of goes horizontal that has text size, text colour, bold italic
 *  underline strikethrough, all that good stuff."*
 *
 *  That is Office's floating mini-toolbar, exactly: a compact strip of ICONS above a short
 *  vertical menu of COMMANDS. The split is not cosmetic — it took the vertical list from fourteen
 *  rows to six, which is most of why `Delete this box` was disappearing behind his taskbar.
 *
 *  ⛔ NO SHORTCUT LABELS ON THE STRIP. Every one of these keys still works; they simply stop
 *  being printed twice, which is what let the list grow past the screen in the first place. The
 *  accessible name carries the shortcut instead, so the keyboard route is announced rather than
 *  drawn. */
const MINI_GLYPHS = {
  bold: <text x="8" y="12" textAnchor="middle" fontSize="12" fontWeight="800" fill="currentColor" stroke="none">B</text>,
  italic: <text x="8" y="12" textAnchor="middle" fontSize="12" fontStyle="italic" fontWeight="600" fill="currentColor" stroke="none">I</text>,
  underline: <><text x="8" y="11" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" stroke="none">U</text><path d="M4 13.6h8" /></>,
  strike: <><text x="8" y="12" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" stroke="none">S</text><path d="M3.4 8h9.2" /></>,
  bullets: <><circle cx="3.6" cy="4.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="3.6" cy="8" r="1.1" fill="currentColor" stroke="none" /><circle cx="3.6" cy="11.5" r="1.1" fill="currentColor" stroke="none" /><path d="M6.6 4.5h6.6M6.6 8h6.6M6.6 11.5h6.6" /></>,
  numbering: <><text x="3" y="6" fontSize="5.5" fill="currentColor" stroke="none">1</text><text x="3" y="10" fontSize="5.5" fill="currentColor" stroke="none">2</text><text x="3" y="14" fontSize="5.5" fill="currentColor" stroke="none">3</text><path d="M7 4.5h6.4M7 8.6h6.4M7 12.7h6.4" /></>,
  indent: <><path d="M6.4 4h7M6.4 8h7M6.4 12h7" /><path d="M2.4 5.6 4.6 8l-2.2 2.4z" fill="currentColor" stroke="none" /></>,
  outdent: <><path d="M6.4 4h7M6.4 8h7M6.4 12h7" /><path d="M4.6 5.6 2.4 8l2.2 2.4z" fill="currentColor" stroke="none" /></>,
};

/** One icon button on the strip. */
function MiniButton({ id, title, active, disabled, onRun, children }) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={`note-menu-${id}`}
      title={title}
      aria-label={title}
      aria-pressed={active ? "true" : undefined}
      disabled={disabled}
      /* ⛔ THE SELECTION SURVIVES THE PRESS, or the command acts on nothing and does so SILENTLY. */
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, padding: 0, flex: "0 0 auto",
        border: "1px solid transparent", borderRadius: RADIUS.control,
        background: active ? "color-mix(in srgb, var(--accent-notes) 16%, transparent)" : "transparent",
        color: active ? "var(--accent-notes)" : "var(--text-primary)",
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

const miniIcon = (id) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
    {MINI_GLYPHS[id]}
  </svg>
);

/** A colour swatch button that opens its palette inline, so the strip stays one row high. */
function MiniColor({ id, title, colors, current, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", flex: "0 0 auto" }}>
      <MiniButton id={id} title={title} active={open} onRun={() => setOpen((v) => !v)}>
        <span style={{ display: "grid", placeItems: "center", width: 16, height: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1 }}>{id === "color" ? "A" : "▨"}</span>
          <span style={{ width: 13, height: 3, borderRadius: 1, background: current || "var(--border-strong)", marginTop: 1 }} />
        </span>
      </MiniButton>
      {open ? (
        <div
          role="menu"
          data-testid={`note-menu-${id}-swatches`}
          style={{
            position: "absolute", top: 30, left: 0, zIndex: 2, padding: 5,
            display: "grid", gridTemplateColumns: "repeat(5, 18px)", gap: 4,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: "0 10px 26px rgba(0,0,0,0.2)",
          }}
        >
          {colors.map((c) => (
            <button
              key={c.name}
              type="button"
              role="menuitem"
              title={c.name}
              aria-label={c.name}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onPick(c.value); setOpen(false); }}
              style={{
                width: 18, height: 18, padding: 0, cursor: "pointer",
                border: "1px solid var(--border-default)", borderRadius: 4,
                background: c.value || "transparent",
                color: "var(--text-tertiary)", fontSize: 10, lineHeight: 1,
              }}
            >{c.value ? "" : "✕"}</button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** ⛔ THE STRIP ITSELF. Font size first, then the character formats, then the list formats —
 *  Word's order, which is the order his hand already knows. */
function MiniBar({ editor }) {
  const chain = () => editor.chain().focus();
  const size = editor.getAttributes("textStyle")?.fontSize || "";
  const items = [
    { id: "bold", title: "Bold (Ctrl+B)", active: editor.isActive("bold"), run: () => chain().toggleBold().run() },
    { id: "italic", title: "Italic (Ctrl+I)", active: editor.isActive("italic"), run: () => chain().toggleItalic().run() },
    { id: "underline", title: "Underline (Ctrl+U)", active: editor.isActive("underline"), run: () => chain().toggleUnderline().run() },
    { id: "strike", title: "Strikethrough", active: editor.isActive("strike"), run: () => chain().toggleStrike().run() },
  ];
  const lists = [
    { id: "bullets", title: "Bullets", active: editor.isActive("bulletList"), run: () => chain().toggleBulletList().run() },
    { id: "numbering", title: "Numbering", active: editor.isActive("orderedList"), run: () => chain().toggleOrderedList().run() },
    { id: "indent", title: "Increase indent (Tab)", run: () => chain().sinkListItem(editor.isActive("taskItem") ? "taskItem" : "listItem").run() || chain().indentListItem().run() },
    { id: "outdent", title: "Decrease indent (Shift+Tab)", run: () => chain().outdentListItem().run() || chain().liftListItem(editor.isActive("taskItem") ? "taskItem" : "listItem").run() },
  ];
  const divider = <span style={{ width: 1, alignSelf: "stretch", margin: "3px 2px", background: "var(--border-default)", flex: "0 0 auto" }} />;
  return (
    <div
      role="menu"
      aria-label="Formatting"
      data-testid="note-menu-mini"
      style={{
        display: "flex", alignItems: "center", gap: 1, padding: "3px 5px", marginBottom: 4,
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.control, boxShadow: "0 10px 26px rgba(0,0,0,0.18)",
      }}
    >
      <select
        data-testid="note-menu-size"
        title="Text size"
        aria-label="Text size"
        value={size}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) chain().unsetFontSize?.().run();
          else chain().setFontSize(v).run();
        }}
        style={{
          height: 24, maxWidth: 62, border: "1px solid var(--border-default)", borderRadius: RADIUS.control,
          background: "var(--surface-base)", color: "var(--text-primary)", font: "inherit", fontSize: 12,
          padding: "0 2px", flex: "0 0 auto",
        }}
      >
        {SIZES.map((n) => <option key={String(n)} value={n == null ? "" : `${n}px`}>{n == null ? "Size" : n}</option>)}
      </select>
      {divider}
      {items.map((it) => <MiniButton key={it.id} {...it} onRun={it.run}>{miniIcon(it.id)}</MiniButton>)}
      <MiniColor
        id="color" title="Text colour" colors={TEXT_COLORS}
        current={editor.getAttributes("textStyle")?.color || null}
        onPick={(v) => (v ? chain().setColor(v).run() : chain().unsetColor().run())}
      />
      <MiniColor
        id="highlight" title="Highlight" colors={HIGHLIGHT_COLORS}
        current={editor.getAttributes("highlight")?.color || null}
        onPick={(v) => (v ? chain().setHighlight({ color: v }).run() : chain().unsetHighlight().run())}
      />
      {divider}
      {lists.map((it) => <MiniButton key={it.id} {...it} onRun={it.run}>{miniIcon(it.id)}</MiniButton>)}
    </div>
  );
}

function MenuRow({ item, onClose }) {
  const [openSub, setOpenSub] = useState(false);
  if (item.sep) {
    return <div style={{ height: 1, background: "var(--border-default)", margin: "4px 0" }} />;
  }
  /* ⛔ THE PASTE MODES ARE A SUBMENU, NOT THREE TOP-LEVEL ROWS — his instruction, and the reason
   * is the same one behind the whole split: three rows for one command is three quarters of the
   * space `Delete this box` needed to stay on screen. */
  if (item.sub) {
    return (
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setOpenSub(true)}
        onMouseLeave={() => setOpenSub(false)}
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openSub ? "true" : "false"}
          data-testid={`note-menu-${item.id}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpenSub((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "5px 12px",
            border: "none", background: "transparent", color: "var(--text-primary)",
            font: "inherit", fontSize: 13, fontWeight: 500, textAlign: "left", cursor: "pointer",
          }}
        >
          <span style={{ flex: 1 }}>{item.label}</span>
          <span style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>▸</span>
        </button>
        {openSub ? (
          <div
            role="menu"
            data-testid={`note-menu-${item.id}-sub`}
            style={{
              position: "absolute", left: "100%", top: -4, minWidth: 208, padding: "5px 0", zIndex: 1,
              background: "var(--surface-raised)", border: "1px solid var(--border-default)",
              borderRadius: RADIUS.control, boxShadow: "0 12px 30px rgba(0,0,0,0.22)",
            }}
          >
            {item.sub.map((s) => <MenuRow key={s.id} item={s} onClose={onClose} />)}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={`note-menu-${item.id}`}
      aria-pressed={item.active ? "true" : undefined}
      /* ⛔ THE SELECTION SURVIVES THE PRESS, or every command here acts on nothing. */
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { item.run(); onClose(); }}
      style={{
        display: "flex", alignItems: "center", gap: 9,
        width: "100%", padding: "5px 12px", border: "none", background: "transparent",
        color: item.danger ? "var(--danger-text)" : "var(--text-primary)",
        font: "inherit", fontSize: 13, fontWeight: item.active ? 700 : 500,
        textAlign: "left", cursor: "pointer",
      }}
    >
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.accel ? <span style={{ color: "var(--text-tertiary)", fontWeight: 600 }}>{item.accel}</span> : null}
    </button>
  );
}

/** ⛔ WHERE THE MENU GOES, MEASURED RATHER THAN GUESSED (NEW-MENU-OFFSCREEN).
 *
 *  HIS REPORT: *"you can't see everything on the menu because the delete part is hidden behind my
 *  start menu or task bar."* The old rule was `top: Math.min(at.y, window.innerHeight - 420)` — a
 *  HARD-CODED 420px guess at the menu's own height. Two things wrong with it, and the second is
 *  why it failed him: a menu taller than the guess still runs off the bottom, and the guess was
 *  never re-checked against what actually rendered.
 *
 *  ⛔ SO IT IS MEASURED, AFTER MOUNT, IN A LAYOUT EFFECT — before paint, so the menu is never seen
 *  in the wrong place and then corrected. The rule is Office's: prefer below-and-right of the
 *  pointer; FLIP above if the assembly does not fit below; then clamp into the viewport with a
 *  margin so it can never sit under an edge either way.
 *
 *  ⛔ `visualViewport` IS PREFERRED OVER `innerHeight`, deliberately: on a maximised window it
 *  already excludes the taskbar, which is the exact case he is hitting. It also follows a pinch
 *  zoom and an on-screen keyboard, neither of which `innerHeight` knows about. */
const MENU_MARGIN = 8;

export function placeMenu({ x, y, w, h, viewW, viewH, margin = MENU_MARGIN }) {
  const vw = Number.isFinite(viewW) ? viewW : 1200;
  const vh = Number.isFinite(viewH) ? viewH : 800;
  const width = Number.isFinite(w) ? w : 0;
  const height = Number.isFinite(h) ? h : 0;

  // Below the pointer if it fits; otherwise ABOVE it — a flip, not a nudge, so the pointer is
  // never left sitting on top of the first row.
  let top = y;
  const fitsBelow = y + height + margin <= vh;
  const fitsAbove = y - height - margin >= 0;
  if (!fitsBelow && fitsAbove) top = y - height;
  // Whichever branch ran, the result is clamped: a menu taller than the whole viewport still has
  // to start on screen, and `max` is what keeps the TOP visible rather than the bottom.
  top = Math.max(margin, Math.min(top, vh - height - margin));
  if (height + margin * 2 > vh) top = margin;

  let left = x;
  if (left + width + margin > vw) left = vw - width - margin;   // the right edge, same rule
  left = Math.max(margin, left);
  return { left: Math.round(left), top: Math.round(top), flipped: !fitsBelow && fitsAbove };
}

function DocMenu({ at, editor, onPlainPaste, onClose, onDeleteBox, onClipboardNote, onConvertTable }) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
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
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }, [at, onClose]);

  /* ⛔ MEASURED BEFORE PAINT (NEW-MENU-OFFSCREEN). The assembly — mini-toolbar AND list — is
   * measured as one thing, because measuring only the list is how `Delete this box` ended up
   * behind his taskbar: the strip above it is part of what has to fit. A layout effect runs
   * before the browser paints, so the menu is never seen in the wrong place and then corrected. */
  useLayoutEffect(() => {
    if (!at || !ref.current) { setBox(null); return; }
    const r = ref.current.getBoundingClientRect();
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    setBox(placeMenu({
      x: at.x, y: at.y, w: r.width, h: r.height,
      viewW: vv?.width ?? (typeof window !== "undefined" ? window.innerWidth : 1200),
      viewH: vv?.height ?? (typeof window !== "undefined" ? window.innerHeight : 800),
    }));
  }, [at]);

  useEffect(() => { if (box) ref.current?.querySelector("button")?.focus(); }, [box]);

  if (!at || !editor || editor.isDestroyed) return null;

  /* ⛔ CUT AND COPY GO THROUGH THE BROWSER'S OWN EDITING COMMAND, deliberately. The async
   * Clipboard API needs a permission this app has no way to ask for from a menu click, and a
   * refused permission is a SILENT no-op. `execCommand` acts on the live selection and REPORTS
   * whether it worked, so a refusal can be said out loud (LOUD-FAILURE) rather than looking like
   * the menu item is broken. */
  const clip = (kind) => {
    let ok = false;
    try { ok = document.execCommand(kind); } catch (_) { ok = false; }
    if (!ok) onClipboardNote?.(`Your browser would not let the menu ${kind} — Ctrl+${kind === "cut" ? "X" : "C"} always works.`);
  };

  /* ⛔ SIX ROWS, NOT FOURTEEN. Everything that formats moved to the strip above; what is left is
   * what Word leaves: the clipboard, the link, and the one destructive action, last and
   * separated so a slip cannot reach it. */
  const items = [
    { id: "cut", label: "Cut", accel: "Ctrl+X", run: () => clip("cut") },
    { id: "copy", label: "Copy", accel: "Ctrl+C", run: () => clip("copy") },
    {
      id: "paste",
      label: "Paste",
      sub: PASTE_MODES.map((mode) => ({
        id: mode === "text" ? "paste-plain" : `paste-${mode}`,
        label: PASTE_MODE_META[mode].label,
        accel: mode === "text" ? "Ctrl+Shift+V" : PASTE_MODE_META[mode].key,
        run: () => onPlainPaste(mode),
      })),
    },
    SEP,
    { id: "link", label: editor.isActive("link") ? "Remove link" : "Link…", accel: "Ctrl+K",
      run: () => (editor.isActive("link")
        ? editor.chain().focus().unsetLink().run()
        : editor.chain().focus().extendMarkRange("link").run()) },
    /* NEW-2 — pulls a table's rows out as plain lines (a sibling list item apiece, when the
       table is the only thing in its list item). Its own row, not lumped with `link`, because
       it restructures the document rather than formatting a selection. */
    ...(onConvertTable ? [SEP, { id: "convert-table-text", label: "Convert table to text", run: onConvertTable }] : []),
    ...(onDeleteBox ? [SEP, { id: "delete-box", label: "Delete this box", accel: "Del", danger: true, run: onDeleteBox }] : []),
  ];

  return (
    <div
      ref={ref}
      data-testid="note-doc-menu"
      data-menu-kind={onDeleteBox ? "box" : "document"}
      data-menu-flipped={box?.flipped ? "1" : undefined}
      style={{
        position: "fixed",
        left: box ? box.left : at.x,
        top: box ? box.top : at.y,
        /* Hidden for the one frame between mount and measurement, so it cannot be seen at the
         * unmeasured position — the flicker that a post-paint effect would produce. */
        visibility: box ? "visible" : "hidden",
        zIndex: 60, display: "flex", flexDirection: "column", alignItems: "flex-start",
      }}
    >
      <MiniBar editor={editor} />
      <div
        role="menu"
        data-testid="note-doc-menu-list"
        style={{
          minWidth: 224, padding: "5px 0", width: "100%",
          background: "var(--surface-raised)", border: "1px solid var(--border-default)",
          borderRadius: RADIUS.control, boxShadow: "0 14px 36px rgba(0,0,0,0.22)",
        }}
      >
        {items.map((item, i) => <MenuRow key={item.sep ? `sep${i}` : item.id} item={item} onClose={onClose} />)}
      </div>
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
        /* ⛔ THE WRITING SURFACE IS A TEXTBOX, AND SAYING SO IS AN ACCESSIBILITY FIX RATHER THAN
         * A TIDY-UP (NEW-CARET-BOUNDS). The owner runs Windows 11's **Text cursor indicator** —
         * the coloured markers the OS paints above and below the caret so it can be found — and
         * reported that on this module they land *"up and to the LEFT"* of the box he is typing
         * in. Windows takes that rectangle from the accessibility layer, never from what is
         * painted.
         *
         * ⛔ MEASURED, and the measurement is what makes this the fix rather than a guess. Dumped
         * from the real accessibility tree (`ui-audit/verify-notes-caret-a11y.mjs`):
         *     note-title  →  role=textbox   editable=plaintext   multiline=false   ✅
         *     note-body   →  role=GENERIC   editable=richtext    multiline=—       ⛔
         * The page title is a proper text control and the note body was not: a `generic` node
         * that merely happens to be editable. A generic node exposes no text pattern for a
         * platform client to read a caret rectangle out of, so the OS falls back to the bounds of
         * the editable REGION — whose top-left corner is up and to the left of any box placed on
         * the page. That is his screenshot, and it explains why the offset gets worse the further
         * into the page the box sits.
         *
         * ⛔ AND THE OBVIOUS SUSPECT WAS CHECKED FIRST AND REFUTED, so nobody re-opens it: the
         * boxes are NOT transform-positioned. `diagnose-notes-caret-bounds` prints `transform:
         * none` for every editing host and finds painted and layout-tree geometry identical to
         * the pixel at 80%, 100% and 200% zoom, scrolled and not. The geometry was never wrong —
         * the thing reading it had nothing to read.
         *
         * `aria-multiline` matters as much as the role: a textbox that does not say it is
         * multiline is treated as a single-line field, and a single-line field's caret rectangle
         * is computed from one line's geometry. */
        role: "textbox",
        "aria-multiline": "true",
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
      /** Run a named editor command through the ordinary command system (so it obeys every
       *  schema rule a click would) — for a harness that needs to state "run X" precisely
       *  rather than reconstruct the exact click/keypress that reaches it. */
      runCommand: (name, ...args) => (editor.isDestroyed ? false : !!editor.commands[name]?.(...args)),
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

  /* The note's own density, read off the document and recomputed with it — see the wrapper
   * below and lib/notesSpacing.js. `densityFor` falls back rather than throwing, so a document
   * carrying an unknown id still renders. */
  const density = useMemo(() => {
    if (!editor || editor.isDestroyed) return densityFor(DEFAULT_DENSITY);
    return densityFor(editor.state.doc.attrs?.density);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docTick]);

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

  /* ═══ SELECT SEVERAL BOXES AND MOVE THEM TOGETHER (B421494) ══════════════════════════════
   *
   * ⛔ THE WHOLE DIFFICULTY IS THAT THE PRESS IS ALREADY SPOKEN FOR. A press on blank page places
   * a box; a marquee wants the same press. The boundary is DISTANCE and it is decided at
   * mouse-UP — see `notesMarquee.js` for why deciding at mouse-down is impossible and deciding
   * at first-move is worse. Everything below is wiring; every decision is in that pure module,
   * where it is tested at zero pixels, one pixel, and either side of the threshold.
   *
   * ⛔ AND THE PLACEMENT PATH IS UNTOUCHED BELOW THE THRESHOLD. Four rounds of work went into
   * what a press on blank page does, with a soak harness that asserts an abandoned press leaves
   * storage BYTE-IDENTICAL. A press that does not travel still reaches exactly the same code. */
  const [selection, setSelection] = useState(() => new Set());
  /* ⛔ THE SECOND STAGE OF ONENOTE'S MODEL (B434416): which selected box the caret has been let
   * INTO. Selecting a box and editing its words are different states, and conflating them is why
   * "click the box and press Delete" could not work — every press went straight to the text, so
   * there was never a moment at which the BOX was the thing you had hold of. */
  const [editingId, setEditingId] = useState(null);
  const editingRef = useRef(null);
  editingRef.current = editingId;
  const [band, setBand] = useState(null);          // the rubber band, in DOCUMENT space
  const selRef = useRef(selection);
  selRef.current = selection;

  /** The editor's live frame: where it is on screen, and the zoom, measured rather than assumed. */
  const frame = useCallback(() => {
    if (!editor || editor.isDestroyed) return null;
    const dom = editor.view.dom;
    const box = dom.getBoundingClientRect();
    return { dom, box, scale: box.width / (dom.offsetWidth || 1) || 1 };
  }, [editor]);

  const toDoc = useCallback((clientX, clientY) => {
    const f = frame();
    if (!f) return null;
    return { x: (clientX - f.box.left) / f.scale, y: (clientY - f.box.top) / f.scale };
  }, [frame]);

  /** Every box on the page, in document space, by id. Read from the DOM because a box's HEIGHT
   *  is its words and only the browser knows that. */
  const boxesNow = useCallback(() => {
    if (!editor || editor.isDestroyed) return [];
    return [...editor.view.dom.querySelectorAll(".planyr-anchor")].map((el) => ({
      id: el.getAttribute("data-anchor-id"),
      x: parseFloat(el.getAttribute("data-anchor-x")) || 0,
      y: parseFloat(el.style.top) || 0,
      w: parseFloat(el.getAttribute("data-anchor-w")) || parseFloat(el.style.width) || 0,
      h: el.offsetHeight,
    })).filter((b) => b.id);
  }, [editor]);

  /* Every box needs an identity before a selection can refer to it; old documents have none.
   * It is stamped outside the undo history — see the command's own note. */
  useEffect(() => {
    if (!editor || editor.isDestroyed || readOnly) return;
    editor.commands.ensureNoteAnchorIds();
  }, [editor, readOnly, docTick]);

  /* ⛔ THE SELECTION IS VISIBLE, and it is painted onto the real elements rather than mirrored
   * into a second render tree. A selection you cannot see is a selection you will move by
   * accident — and re-rendering every box through React to show a ring would remount node views
   * the editor owns, which is a different and worse bug. */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const paint = () => {
      if (editor.isDestroyed) return;
      for (const el of editor.view.dom.querySelectorAll(".planyr-anchor")) {
        const on = selection.has(String(el.getAttribute("data-anchor-id")));
        if (on) el.setAttribute("data-selected", "1"); else el.removeAttribute("data-selected");
      }
    };
    paint();
    /* ⛔ AND REPAINTED ON EVERY TRANSACTION, because the attribute lives on an element the EDITOR
     * owns and can replace at any time. Measured: pressing Escape to leave a box blurred the
     * editor, the node view was rebuilt, and the ring vanished while the box was still selected —
     * so "Escape backs out to the box being selected" silently did not happen. An effect keyed on
     * React state alone cannot see a re-render the editor caused for its own reasons. */
    editor.on("transaction", paint);
    editor.on("focus", paint);
    editor.on("blur", paint);
    return () => { editor.off("transaction", paint); editor.off("focus", paint); editor.off("blur", paint); };
  }, [editor, selection, docTick]);

  const clearSelection = useCallback(() => {
    setSelection((s) => (s.size ? new Set() : s));
    setEditingId(null);
  }, []);

  /**
   * The blank-page gesture, from press to release.
   *
   * ⛔ IT IS ONE HANDLER FOR BOTH OUTCOMES, deliberately. Two handlers racing to decide what a
   * press meant is precisely the shape that made this gesture behave differently depending on
   * invisible state, four rounds running.
   */
  const beginBlankGesture = useCallback((e) => {
    const f = frame();
    const from = toDoc(e.clientX, e.clientY);
    if (!f || !from) return false;
    const startClient = { x: e.clientX, y: e.clientY };
    const additive = e.shiftKey;
    let moved = false;

    const onMove = (ev) => {
      const outcome = gestureOutcome(startClient, { x: ev.clientX, y: ev.clientY });
      if (outcome !== "select") return;              // still inside the slop — nothing has happened
      moved = true;
      const to = toDoc(ev.clientX, ev.clientY);
      if (!to) return;
      const rect = marqueeRect(from, to);
      setBand(rect);
      setSelection(applyMarquee(additive ? selRef.current : new Set(), boxesInMarquee(rect, boxesNow()), { additive }));
    };

    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setBand(null);
      const outcome = gestureOutcome(startClient, { x: ev.clientX, y: ev.clientY });
      if (outcome === "select") return;              // the selection is already set; place nothing
      /* ⛔ BELOW THE THRESHOLD THIS IS A PLACE, AND IT IS THE UNCHANGED PLACE. */
      if (!moved) {
        clearSelection();
        placeBlockAt(ev.clientX, ev.clientY);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return true;
  }, [frame, toDoc, boxesNow, placeBlockAt, clearSelection]);

  /** Dragging any SELECTED box moves the whole set, by one delta, as one undo step. */
  const beginGroupDrag = useCallback((e, id) => {
    const f = frame();
    if (!f) return false;
    const ids = new Set([...selRef.current].map(String));
    if (!ids.has(String(id)) || ids.size < 2) return false;
    const start = { x: e.clientX, y: e.clientY };
    const startBoxes = boxesNow().filter((b) => ids.has(String(b.id)));
    if (!startBoxes.length) return false;
    e.preventDefault();
    e.stopPropagation();

    const onMove = (ev) => {
      const dx = (ev.clientX - start.x) / f.scale;
      const dy = (ev.clientY - start.y) / f.scale;
      const moves = moveSelection(startBoxes, { dx, dy }, { maxX: f.dom.offsetWidth });
      for (const m of moves) {
        const el = f.dom.querySelector(`[data-anchor-id="${m.id}"]`);
        if (el) { el.style.left = `${m.x}px`; el.style.top = `${m.y}px`; }
      }
    };
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const dx = (ev.clientX - start.x) / f.scale;
      const dy = (ev.clientY - start.y) / f.scale;
      if (!dx && !dy) return;                        // a press that never moved writes NOTHING
      editor.commands.moveNoteAnchors(moveSelection(startBoxes, { dx, dy }, { maxX: f.dom.offsetWidth }));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return true;
  }, [frame, boxesNow, editor]);

  /** Arrow keys nudge the selection; Delete removes all of it, as one step. Escape clears. */
  const selectionKeyDown = useCallback((e) => {
    if (!editor || editor.isDestroyed || readOnly) return false;
    const ids = [...selRef.current];
    if (ids.length < 1) return false;
    /* ⛔ WHILE THE CARET IS INSIDE A BOX, THE KEYS BELONG TO THE TEXT. Escape is the one exception
     * — it is the way back OUT to the box — and getting this wrong would mean Delete eating a
     * whole box while somebody was editing a word in it. */
    if (editingRef.current) {
      if (e.key !== "Escape") return false;
      e.preventDefault();
      setEditingId(null);
      if (editor && !editor.isDestroyed) editor.commands.blur();
      return true;
    }
    if (e.key === "Escape") { clearSelection(); return true; }
    /* ⛔ UNDO IS FORWARDED, BECAUSE THE GESTURE THAT MADE THE SELECTION TOOK FOCUS AWAY. The
     * press that starts a marquee is `preventDefault`ed so it cannot move the caret, which leaves
     * `document.activeElement` on `<body>` — and Ctrl+Z on the body reaches nothing. Measured: a
     * group move and a group delete were both correct in the document and could not be undone,
     * which for a DESTRUCTIVE action is the worse half of the feature. Forwarding is deliberately
     * narrower than focusing the editor here: focusing would put a live caret back in the page
     * while boxes are still selected, so the next letter typed would land somewhere nobody asked
     * for. This changes what UNDO reaches and nothing else. */
    if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      const redo = e.key === "y" || e.key === "Y" || e.shiftKey;
      if (redo) editor.commands.redo(); else editor.commands.undo();
      clearSelection();
      return true;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      editor.commands.removeNoteAnchors(ids);
      clearSelection();
      /* ⛔ AND FOCUS GOES BACK TO THE DOCUMENT, WHICH IS WHAT MAKES THE DELETE UNDOABLE — the
       * same defect, and the same fix, as the single box's × (B421489). Clearing the selection
       * unbinds the window handler that forwarded Ctrl+Z, so without this the very next keypress
       * had nowhere to go and a group delete could not be taken back. There is no selection left
       * by this point, so a live caret is exactly right rather than a surprise. */
      editor.commands.focus();
      return true;
    }
    const d = nudgeDelta(e.key, { shift: e.shiftKey });
    if (!d) return false;
    e.preventDefault();
    const f = frame();
    const members = boxesNow().filter((b) => selRef.current.has(String(b.id)));
    editor.commands.moveNoteAnchors(moveSelection(members, d, { maxX: f ? f.dom.offsetWidth : Infinity }));
    return true;
  }, [editor, readOnly, clearSelection, frame, boxesNow]);

  /* ⛔ WHILE BOXES ARE SELECTED, THEIR KEYS ARE BOUND TO THE WINDOW — and that is a measured
   * necessity, not a convenience. A marquee is drawn on blank page, and the press that starts it
   * is `preventDefault`ed so it does not move the caret; the consequence is that when the band is
   * released `document.activeElement` is `<body>`. Every key handler on the mat is therefore
   * unreachable: measured after a real drag, Escape, the arrow keys and Delete all did nothing at
   * all while three boxes sat visibly selected. A feature whose keyboard half silently does not
   * exist is exactly the shape of defect this module keeps shipping.
   *
   * ⛔ IT IS BOUND ONLY WHILE A SELECTION EXISTS, and it declines while a FORM FIELD has focus, so
   * the page title can still be typed in and arrowed through. The editor itself is deliberately
   * NOT excluded: a live selection is the mode you are in, and clicking into the document clears
   * it on the way (see the mat's press rule), so the two can never both be live by accident. */
  useEffect(() => {
    if (!selection.size) return undefined;
    const onKey = (e) => {
      /* ⛔ THE CARET OWNS THE KEY WHENEVER THERE IS ONE (NEW-ARROWS). This used to decline only
       * for `input, textarea, select` — and the document is a CONTENTEDITABLE DIV, which is none
       * of those. It was excluded deliberately, on the argument that clicking into the document
       * clears the box selection on the way; measured, it does not, so with a box selected and
       * the caret in ordinary flow text every arrow moved the BOX and left the caret alone. That
       * is the owner's reported "direction keys aren't working", reachable in three clicks and
       * invisible once you have looked away from the selected box.
       *
       * The marquee case this binding exists for is UNAFFECTED: the press that starts a band is
       * `preventDefault`ed, so there is no caret and focus is on `<body>` — measured, not assumed.
       * See lib/notesKeyScope.js for both states and the property the guard asserts. */
      if (bindingShouldDecline(e)) return;
      selectionKeyDown(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, selectionKeyDown]);

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
    const inBlock = el.closest(".planyr-anchor");
    /* ⛔ …BUT NOT WHEN THAT OBJECT IS ITSELF INSIDE A POSITIONED BOX (NEW-PICTURE-CANVAS), AND
     * THIS IS THE PAIR OF LINES THAT MADE THE WHOLE FEATURE INERT. The rule above was written when a
     * picture could only ever be inline, where "a picture is an object you select rather than
     * page you write on" is exactly right. The moment a picture can BE the content of a box, the
     * early return fires on every press on that box — so the box was never selected, and because
     * every resize handle is gated on the selection (`pointer-events: none` until then), all
     * eight were painted, correctly positioned, and completely dead.
     *
     * ⛔ IT COST NOTHING TO FIND ONLY BECAUSE THE HARNESS DROVE A REAL MOUSE AND JUDGED THE
     * STORED DOCUMENT. Every unit test passed, the handles were present in the DOM with the right
     * ids and the right cursors, and `handlesFor` returned all eight — every static reading of
     * this feature said it worked. What said otherwise was eight rows of "400×200 → 400×200".
     * This is CHROME-NEVER-EATS-A-PRESS's mirror image: not chrome swallowing a press, but a
     * guard clause swallowing it before the chrome could ever be armed.
     *
     * The sketch keeps its unconditional bail — it owns its own double-click, and B391075 already
     * establishes that a sketch never goes inside a box, so the case cannot arise. */
    if (!inBlock && el.closest(".planyr-note-image, .planyr-note-file")) return;
    if (el.closest(".planyr-sketch-host")) return;

    if (inBlock) {
      /* ⛔ A PRESS ON A BOX THAT IS PART OF A SELECTION MOVES THE WHOLE SELECTION (B421494), and
       * a press on any other box CLEARS it — anything else leaves somebody dragging one box
       * while nine still look selected. Shift toggles that box in or out instead. */
      /* ⛔ THE TWO-STAGE MODEL, AND IT IS THE WHOLE OF B434416.
       *
       * His report, in his words: *"if I click on the box, I should be able to just press delete,
       * but it doesn't seem like I can ever even click on the box."* He was exactly right, and
       * measured: after a press the element carried the class `planyr-anchor` and NOTHING else.
       * There was no such thing as a selected box, so there was nothing for Delete to act on and
       * nothing for a control to hang off except the pointer happening to be over it.
       *
       *   press 1 on an unselected box  → SELECT IT. The caret does not enter; the box is now the
       *                                   thing you have hold of, and Delete removes it.
       *   press 2 on a selected box     → ENTER IT. The caret goes where you pressed and it is an
       *                                   ordinary text box again.
       *   Escape while editing          → back out to the box being selected.
       *   Escape while selected         → deselect.
       *
       * ⛔ SHIFT STILL TOGGLES, and a press on a box that is part of a MULTI-selection still drags
       * the whole set — those are checked first, because both are unambiguous. */
      const id = inBlock.getAttribute("data-anchor-id");
      if (id && e.shiftKey) {
        e.preventDefault();
        setEditingId(null);
        setSelection((prev) => toggleSelection(prev, id, { additive: true }));
        return;
      }
      if (id && selRef.current.has(String(id)) && selRef.current.size > 1) {
        if (beginGroupDrag(e, id)) return;
      }
      if (id) {
        const alreadySelected = selRef.current.has(String(id)) && selRef.current.size === 1;
        if (!alreadySelected) {
          /* Stage 1. Nothing is typed and no caret moves — this press is about the BOX. */
          e.preventDefault();
          setEditingId(null);
          setSelection(new Set([String(id)]));
          return;
        }
        /* ⛔ A BOX HOLDING A PICTURE HAS NO STAGE 2, because it has no words to enter (NEW-
         * PICTURE-CANVAS). Falling through would hand the press to the browser's ordinary text
         * behaviour, which on an atom means collapsing the box's selection to a caret beside it —
         * i.e. the second press would silently DESELECT the picture and take its handles away
         * again. Keeping it selected is also what Word and Bluebeam do: a picture stays picked up
         * until you click off it. */
        if (inBlock.getAttribute("data-anchor-kind") === "image") {
          e.preventDefault();
          return;
        }
        /* Stage 2: it was already selected, so this press is about its words. Fall through to the
         * ordinary text behaviour below, which is the browser's and must stay the browser's. */
        setEditingId(String(id));
      } else if (selRef.current.size) clearSelection();
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

    /* Blank space. ⛔ WHAT HAPPENS NEXT IS NOT DECIDED YET — a press that travels is a marquee
     * and a press that does not is the unchanged placement. `beginBlankGesture` owns both, and
     * the decision is made at mouse-UP against a measured distance. */
    e.preventDefault();
    e.stopPropagation();
    if (!beginBlankGesture(e)) placeBlockAt(e.clientX, e.clientY);
  }, [editor, placeBlockAt, beginBlankGesture, beginGroupDrag, clearSelection]);

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
  const noteRootRef = useRef(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  /* ⛔ VIEWPORT-STABLE — THE TABLE TOOLBAR GROUP MUST NOT JUMP THE SHEET UNDER THE POINTER
   * (NEW-1 / B649376, owner report: *"when I click and highlight stuff, it just jumps and
   * flashes"* on a table pasted from Outlook). Measured, real mouse: the toolbar is a SIBLING
   * of the mat in the same flex column, and `NoteToolbar`'s Table button group only renders
   * `{inTable && (...)}` — so the instant the caret enters a table the bar wraps to an extra
   * row (39px → 75px here). Because the mat is `flex: 1` in that same column, its own top edge
   * — and every pixel painted inside it, table included — slides down by exactly that delta.
   * A drag that starts inside the table has its target crawl out from under a STATIONARY
   * pointer on the very first frame: instrumented before this fix, the native selection never
   * extended across cells at all — it stayed collapsed and hopped between wrong text nodes
   * (some outside the table entirely) on every mousemove, because each move's screen
   * coordinates now resolved against content that had silently slid 36px since mousedown.
   * Leaving the table reverts the bar and the sheet snaps back, which is the "flash".
   *
   * ⛔ THE FIRST ATTEMPT COMPENSATED `scrollTop`, THE WAY THE ZOOM STEP BELOW DOES, AND IT WAS
   * WRONG FOR THIS CASE. Zoom changes the CONTENT's height, so there is always slack to scroll
   * into. This shift changes the MAT's own box height (it shrinks by the same delta the
   * toolbar grew), not the content's — so on a short note, exactly Michael's Silvestri
   * "Utility" page, `scrollHeight - clientHeight` was already 0 and stayed 0, and adding to
   * `scrollTop` was clamped straight back to zero. Measured: the table still moved by the full
   * 36px with that fix in place. A CSS transform has no such floor, so this folds the delta
   * into the mat's own `transform` instead — literally "the view transform" the rule names —
   * which cancels the container's own shift regardless of how much content it holds.
   *
   * ⛔ REOPENED (NEW-1, 2026-08-28): THE FIRST SHIPPED VERSION OF THIS FIX COMPENSATED ONE
   * FRAME TOO LATE, and that is a real, measured gap, not a guess. It relied on a
   * `ResizeObserver` alone — which is exactly the "passive (after-paint) useEffect" VIEWPORT-
   * STABLE warns against, because its callback is queued and is NOT guaranteed to land before
   * the browser paints the frame that already grew the toolbar. A `requestAnimationFrame`
   * sampler on this exact build (the guard's 45ms-apart samples never caught it) shows it
   * directly: the frame the toolbar first measures at its taller height still has the mat's
   * `transform` empty and the table already down by the full delta; only the NEXT frame
   * corrects it. That is the "jump and flash" happening again, on camera, with the old fix
   * installed — and on a slower machine, mid-drag, or under Chrome's own ResizeObserver
   * notification-loop budget, that one frame can stretch far longer, which is what reached
   * production (the owner's numbers show the shift landing at pointerup and NEVER correcting
   * — `docs/NOTES-CARRY-FORWARD.md` §5.4 has the fixture and the harness that proves this red
   * on the code above).
   *
   * The fix: measure and apply the compensation SYNCHRONOUSLY, in the SAME commit that grows
   * the toolbar, via a `useLayoutEffect` keyed on the exact boolean `NoteToolbar` uses to
   * decide whether to render the extra row. A layout effect runs after the DOM mutation is
   * committed but before the browser paints, so there is no frame in which the toolbar can be
   * tall and the compensation can be absent — the two are the same render. The
   * `ResizeObserver` stays, but only as the fallback for every OTHER cause of the toolbar
   * changing height (a window resize changing how many buttons fit per row, a webfont
   * finishing its load): both paths share one height baseline, so whichever fires second
   * always measures a delta of zero against what the other just recorded. */
  const toolbarShiftRef = useRef(0);
  const toolbarHeightRef = useRef(null); // null = not yet measured; the first read only sets the baseline
  /* ⛔ READ-ONLY DIAGNOSTIC for B831600 ×3 (`lib/notesToolbarDiag.js`) — OFF by default, no
   * behaviour change when unarmed. Records every call this function ever receives (which
   * mechanism called it, the heights it saw, and what it actually applied), because the owner's
   * production measurements and this sandbox's reproductions disagree about whether the FIRST
   * grow ever gets compensated at all, and inference from outside the page has run out of road.
   * See docs/NOTES-CARRY-FORWARD.md's B831600 ×3 entry for how to arm it and read the result. */
  const applyToolbarDelta = useCallback((nextHeight, trigger) => {
    const diagOn = isToolbarDiagArmed();
    if (diagOn) latchToolbarDiag();
    const prevHeight = toolbarHeightRef.current;
    toolbarHeightRef.current = nextHeight;
    if (prevHeight == null) {
      if (diagOn) {
        recordToolbarDiag({
          t: performance.now(), trigger, prevHeight, nextHeight,
          delta: null, bailedAt: "first-reading-sets-baseline", appliedOffset: toolbarShiftRef.current,
        });
      }
      return;
    }
    const delta = nextHeight - prevHeight;
    const scroller = scrollerRef.current;
    if (!delta || !scroller) {
      if (diagOn) {
        recordToolbarDiag({
          t: performance.now(), trigger, prevHeight, nextHeight, delta,
          bailedAt: !delta ? "zero-delta" : "no-scroller", appliedOffset: toolbarShiftRef.current,
        });
      }
      return;
    }
    toolbarShiftRef.current += delta;
    scroller.style.transform = toolbarShiftRef.current
      ? `translateY(${-toolbarShiftRef.current}px)` : "";
    if (diagOn) {
      recordToolbarDiag({
        t: performance.now(), trigger, prevHeight, nextHeight, delta,
        bailedAt: null, appliedOffset: toolbarShiftRef.current, transform: scroller.style.transform,
      });
    }
  }, []);

  const inTable = !!editor && !editor.isDestroyed && editor.isActive("table");
  useLayoutEffect(() => {
    const toolbarEl = noteRootRef.current?.querySelector('[data-testid="note-toolbar"]');
    if (toolbarEl) applyToolbarDelta(toolbarEl.getBoundingClientRect().height, "layout-effect");
  }, [inTable, applyToolbarDelta]);

  useEffect(() => {
    /* ⛔ `editor` IS A DEP, NOT `[]` — Tiptap's `useEditor` returns null on the first render
     * (immediatelyRender: false is the default, to stay SSR-safe) and the toolbar renders
     * nothing until it is truthy. An empty dep array would run this once, find no toolbar yet,
     * bail, and never observe anything for the note's whole lifetime. */
    const root = noteRootRef.current;
    const scroller = scrollerRef.current;
    if (!root || !scroller || typeof ResizeObserver === "undefined") return undefined;
    const toolbarEl = root.querySelector('[data-testid="note-toolbar"]');
    if (!toolbarEl) return undefined;
    const ro = new ResizeObserver(() => applyToolbarDelta(toolbarEl.getBoundingClientRect().height, "resize-observer"));
    ro.observe(toolbarEl);
    return () => {
      ro.disconnect();
      scroller.style.transform = "";
      toolbarShiftRef.current = 0;
      toolbarHeightRef.current = null;
    };
  }, [editor, applyToolbarDelta]);

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
      const nodes = [...dom.querySelectorAll(".planyr-anchor")];
      /* ⛔ AND THE HORIZONTAL HALF OF THE SAME QUESTION (B421490). The vertical rule grows the page
       * so a low block still has somewhere to be; there is no equivalent sideways, so a box wider
       * than the room left to it hangs off the sheet — under the outline panel, which paints later
       * and takes its presses. Same rule as placement: keep the left edge, spend the width. The
       * stored width is not touched, so widening the window gives it straight back. */
      /* ⛔ THE ROOM IS THE SCROLLER'S, NOT THE EDITOR'S OWN (NEW-RIGHT-EDGE). Reading
       * `dom.clientWidth` here creates a genuine FEEDBACK LOOP once the page can grow: the fit
       * narrows a box to the room, the extent widens `dom` to hold it, the next measure reads the
       * WIDER dom as "the room", re-fits the box wider, and round again. It happened to settle
       * rather than oscillate, which is worse than failing — a loop that settles at the wrong
       * number looks correct. The SCROLLER's width is the one thing in this chain that a box
       * cannot change, so it is the honest denominator, and the loop cannot form. */
      const hostWidth = scrollerRef.current?.clientWidth || dom.clientWidth;
      const blocks = nodes.map((el) => {
        const x = parseFloat(el.getAttribute("data-anchor-x")) || parseFloat(el.style.left) || 0;
        const w = parseFloat(el.getAttribute("data-anchor-w")) || parseFloat(el.style.width);
        const fit = fitAnchorBox({ x, w, hostWidth });
        if (Math.round(parseFloat(el.style.width)) !== fit.w) el.style.width = `${fit.w}px`;
        if (Math.round(parseFloat(el.style.left)) !== fit.x) el.style.left = `${fit.x}px`;
        return { x: fit.x, w: fit.w, y: parseFloat(el.style.top) || 0, height: el.offsetHeight };
      });
      const need = anchorExtent(blocks);
      dom.style.minHeight = need ? `max(46vh, ${need}px)` : "";
      /* ⛔ AND THE PAGE GROWS SIDEWAYS TOO (NEW-RIGHT-EDGE). This is the line that was missing,
       * and its absence is the whole of his *"there's a wall"*: vertically the sheet has always
       * stretched to hold a block that runs past the bottom, horizontally it did not, so the only
       * way to keep a block on the sheet was to crush it. Now the sheet widens and the scroller
       * takes over — the page grows, the content does not get squeezed. `minWidth` cannot feed
       * back into a block's own width (they are out of flow and positioned absolutely), so there
       * is no loop here, exactly as there is none on the vertical side. */
      const needX = anchorExtentX(blocks);
      dom.style.minWidth = needX > hostWidth ? `${needX}px` : "";
    };
    measure();
    /* Re-measured as the text inside a block reflows, which is the half that matters: the
     * block gets taller as you type and the page has to keep up in the same frame. */
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) for (const el of dom.querySelectorAll(".planyr-anchor")) ro.observe(el);
    /* ⛔ AND THE EDITOR ITSELF IS OBSERVED, not only the blocks inside it (B421490). The width fit
     * above is a function of the EDITOR's width, and nothing was watching that: a block only
     * re-measured when its own text reflowed, so narrowing the window left every box at the width
     * a wider window had allowed. That is the state in which a box's controls end up under the
     * outline panel. */
    if (ro) ro.observe(dom);
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
      density: json?.attrs?.density,          // PDF-PARITY: the sheet gets the note's own density
    });
    const r = await printHtmlDocument(html);
    if (!r.ok) onPrintNotice?.(r.error);
  }, [editor, title, updatedAt, trail, onPrintNotice]);

  const edited = editedLabel(updatedAt);

  return (
    /* ⛔ THE DENSITY IS SET AS TWO CUSTOM PROPERTIES ON THE WRAPPER (NEW-SPACING-3), so ONE
       document attribute drives the line height and the gap between list items together — which
       is what makes Compact one action rather than two controls. The values come from
       lib/notesSpacing.js, the same record the print sheet reads. */
    <div className="planyr-note" ref={noteRootRef} style={{
      display: "flex", flexDirection: "column", minHeight: 0, flex: 1, background: "var(--surface-page)",
      "--note-line": density.line,
      "--note-list-gap": `${density.listGap}px`,
    }}>
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
          /* ⛔ THE SELECTION'S KEYS ARE **NOT** HANDLED HERE, and that is deliberate (B434416).
             They were, briefly, and the result was that one Escape ran the rule TWICE — once from
             this handler and once from the window binding above — so a single press left editing
             AND cleared the selection in the same keystroke, which made the two-stage model
             impossible to use. The window binding already covers every focus state including this
             one, so this handler must not also claim them. */
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
          /* ⛔ RIGHT-CLICKING A BOX IS STILL RIGHT-CLICKING INSIDE TEXT (B539651), so the box menu
             is the document's plus the box's own action rather than a different menu. The id is
             what tells them apart, and it comes from the DOM the press actually landed on. */
          const box = e.target.closest(".planyr-anchor");
          /* ⛔ A RIGHT-CLICK MUST RESOLVE ITS OWN TARGET (found chasing NEW-2, B649377).
             ProseMirror only learns where the browser's native right-click actually put the
             caret through an async `selectionchange` event — measured arriving ~20ms AFTER
             `contextmenu` has already fired and this handler has already run — so reading
             `editor.state.selection` here, synchronously, sees wherever the caret was doing
             BEFORE this click, not where the user just clicked. Confirmed on a plain paragraph
             with no table involved at all: right-clicking the third line left PM's selection
             sitting at the document's very first position while the native DOM selection had
             already moved correctly. Left-click is unaffected (`focusFromMat` places it
             directly), which is why this went unnoticed until a command — "is the caret inside
             a table" — actually needed the answer to be right. Resolved and applied by hand
             here, the way a real editor does; a right-click INSIDE the current selection (e.g.
             Cut/Copy on a phrase you already selected) is left alone, matching every editor's
             convention, and a box is untouched (its own selection is separate React state, not
             PM's, so it was never exposed to this). */
          if (!box && editor && !editor.isDestroyed) {
            const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
            if (hit && Number.isFinite(hit.pos)) {
              const { from, to } = editor.state.selection;
              if (hit.pos < from || hit.pos > to) editor.commands.setTextSelection(hit.pos);
            }
          }
          /* NEW-2 — "Convert table to text" only makes sense when the right-click actually
             landed inside a table; reading it off the DOM the press hit (rather than off
             `editor.isActive("table")`) keeps it consistent with how the box id above is read. */
          const inTable = !!e.target.closest("table");
          setDocMenu({ x: e.clientX, y: e.clientY, boxId: box?.getAttribute("data-anchor-id") || null, inTable });
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
          /* ⛔ THE READING COLUMN HAS A FLOOR, AND THE PANELS BESIDE IT YIELD FIRST (B421492).
             Outline and History were each `flex: none` at a fixed width, so on a narrow window
             the SHEET absorbed the whole shortfall: opening History took the page from 424px to
             **156px** — the same sliver B391075 measured for a sketch inside a box — and the
             header's own status line then painted 96px outside it. A page narrower than a
             sentence is not a page. So the sheet may shrink but never below a readable column,
             and the two panels shrink before it does; if even that is not enough the ROW
             scrolls, which is honest, rather than the document quietly disappearing. */
          style={{ maxWidth: 820, width: "100%", flex: "1 1 auto", minWidth: 260, margin: 0, padding: "22px 20px 96px 13px", zoom }}
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
            {/* ⛔ THE SAVE INDICATOR IS NOT HERE ANY MORE (NEW-SAVE-BADGE). It used to be a pill
                in this row, which meant a note showed "SAVED" here AND the app-wide badge said
                "Saved on this device" in the header — two indicators, different words, one fact.
                The Site Planner, the Scheduler and Doc Review all retired their local chips for
                the shared `CloudSyncBadge` in AppHeader's Row-1 top-right; Notes was the one
                module that never did. It does now, via `notesSaveState`. Do not re-add a local
                one: the owner's instruction was "literally, all the modules should show that save
                icon in the exact same place." */}
          </div>

          {/* ⛔ THE BAND IS DRAWN IN THE EDITOR'S OWN FRAME, which is the frame its coordinates
              were measured in — anywhere else and the rectangle drifts from the boxes it is
              selecting the moment anything above it changes height. `pointerEvents: none` so it
              cannot take the presses of the gesture drawing it; chrome that eats its own gesture
              is this module's most-repeated defect. */}
          <div style={{ position: "relative" }}>
            <EditorContent editor={editor} />
            {band ? (
              <div
                data-testid="note-marquee"
                aria-hidden="true"
                style={{
                  position: "absolute", pointerEvents: "none", zIndex: 3,
                  left: band.x, top: band.y, width: band.w, height: band.h,
                  border: "1px solid var(--accent-notes)",
                  background: "color-mix(in srgb, var(--accent-notes) 12%, transparent)",
                  borderRadius: 3,
                }}
              />
            ) : null}
          </div>
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
      <DocMenu
        at={docMenu}
        editor={editor}
        onPlainPaste={pastePlainFromClipboard}
        onClose={() => setDocMenu(null)}
        onClipboardNote={(m) => onPrintNotice?.(m)}
        /* Only a box's menu carries Delete — which is the whole of "the delete option shouldn't
           just be shown anytime I click on the box". The keystroke is unchanged. */
        onDeleteBox={docMenu?.boxId ? () => {
          editor.commands.removeNoteAnchors([docMenu.boxId]);
          clearSelection();
          editor.commands.focus();          // …so Ctrl+Z can reach it (B421489)
        } : null}
        /* NEW-2 — "Convert table to text". Only offered when the right-click actually landed
           inside a table; the command itself also declines on its own if the caret has since
           moved out, so this can never silently act on the wrong table. Focus comes home after,
           same as the box delete above and for the same reason (B421489) — a menu click leaves
           focus on the button it clicked, and Ctrl+Z cannot reach a document that is not
           focused. */
        onConvertTable={docMenu?.inTable ? () => {
          editor.commands.convertTableToText();
          editor.commands.focus();
        } : null}
      />
    </div>
  );
}
