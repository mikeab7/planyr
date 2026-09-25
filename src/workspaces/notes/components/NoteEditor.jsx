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
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { noteExtensions, EMPTY_DOC } from "../lib/notesExtensions.js";
import { ANCHOR_MIN_HEIGHT, anchorExtent, anchorExtentLeft, anchorExtentTop, anchorExtentX, anchorPosAtSelection, fitAnchorBox, placeAnchor } from "../lib/notesAnchorNode.js";
import { edgePoint as arrowEdgePoint } from "../lib/notesArrows.js";
import { isBlankDoublePress } from "../lib/notesBlankPaper.js";
import { migrateFlowBody, migrateSketchesToBoxes } from "../lib/notesFlowMigration.js";
import {
  applyMarquee, boxesInMarquee, latchGesture, marqueeRect, moveSelection, nudgeDelta,
  toggleSelection,
} from "../lib/notesMarquee.js";
import {
  fitView, frameView, normalizeView, panBy, stepZoom, toWorkspace,
  VIEW_ZOOM_DEFAULT, zoomAbout, zoomForWheel, zoomKeyIntent, zoomLabel,
} from "../lib/notesViewport.js";
import { HIGHLIGHT_COLORS, SIZES, TEXT_COLORS } from "../lib/notesFormatPalette.js";
import { PASTE_MODES } from "../lib/notesPastePlain.js";
import { formFieldOwnsTheKey, UNGATED_KEYS } from "../lib/notesKeyScope.js";
import { DEFAULT_DENSITY, densityFor } from "../lib/notesSpacing.js";
import {
  PAGE_WIDTH_MIN, PAGE_WIDTH_PRESETS, leftEdgeDrag, normalizePageMargin, pageWidthLabel,
  resolvePinnedBaseWidth, rightEdgeDrag,
} from "../lib/notesPageWidth.js";
import {
  dragHeightFromDelta, pageHeightLabel, resolvePinnedBaseHeight, scrollToReach, topEdgeCompensation,
} from "../lib/notesPageHeight.js";
import { indentCssRules, listMarkerCssRules } from "../lib/notesIndentLevel.js";
import {
  readNoteFiles, readNoteImages, readPage, readPageVersions, registerOpenNoteDoc,
  restorePageVersion, snapshotPage, writePage,
  readNoteView, writeNoteView,
} from "../lib/notesStore.js";
import {
  attachmentIdsInDoc, docToMarkdown, imageIdsInDoc, safeFileName, MD_INLINE_ATTACHMENT_MAX,
} from "../lib/notesMarkdown.js";
import { docToHtml } from "../lib/notesDocHtml.js";
import { buildPrintDocument, printHtmlDocument } from "../lib/notesPrint.js";
import { absoluteStamp, editedLabel } from "../lib/notesTime.js";
import { activeOutlineIndex, outlineFromDoc } from "../lib/notesOutline.js";
import { applySlashCommand } from "../lib/notesSlashMenu.js";
import { isToolbarDiagArmed, latchToolbarDiag, recordToolbarDiag } from "../lib/notesToolbarDiag.js";
import NoteToolbar from "./NoteToolbar.jsx";
import NoteSlashMenu from "./NoteSlashMenu.jsx";
import NoteOutline from "./NoteOutline.jsx";
import NoteHistory from "./NoteHistory.jsx";

const SAVE_DEBOUNCE_MS = 600;
const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar
const SHEET_RADIUS = 12; // RADIUS.lg (shared/ui/radius.js) — a surface that CONTAINS other things (DESIGN.md's shape rule); not folded into the local RADIUS const above because test/notesModule.test.js regex-pins that object's exact two-key shape against controls.jsx's own scale.

/* ⛔ THE SHEET'S OWN LAYOUT NUMBERS, NAMED ONCE (NOTES-PAGE-GROWTH). They already governed the
 * `note-sheet` inline style below; they are pulled out here so the page-growth measurement
 * effect can compute the SAME "how wide is the page before anything grows it" answer the style
 * itself produces — one set of numbers, not a style object and a second guess of it that can
 * drift apart (the exact two-sources-of-truth shape that produced B539648). */
const SHEET_MAX_WIDTH = 580;
const SHEET_PAD_X = { narrow: 16, wide: 40 };   // left+right padding, per side
const SHEET_MARGIN_X = { narrow: 8, wide: 0 };  // left+right margin, per side
/* The sheet's own TOP padding, pulled out for the same reason and used by the same effect: it is
 * the first thing a box reaching above the body's origin gets to sit in before the card itself
 * has to grow upward (NOTES-FREE-PLACEMENT). */
const SHEET_PAD_TOP = { narrow: 18, wide: 30 };
/* The gap under the title band, before the body starts. */
const TITLE_BAND_GAP = 16;
/* ⛔ HOW MUCH CLEAR AIR THE TOP GRIP IS LEFT WITH AFTER A DRAG THAT SCROLLED IT OUT OF VIEW
 * (B1609184). The grip straddles the page's top edge (`top: -7px; height: 14px`), so putting the
 * edge itself level with the mat's first visible row would still leave the upper half of the grip
 * clipped and hard to grab. This is the grip's own overhang plus a little, so what you just
 * dragged is fully there to grab again. */
const TOP_EDGE_REACH_GAP = 10;

/* ⛔ THE STRIP OF GREY THAT MUST ALWAYS EXIST BESIDE THE PAGE (NOTES-FREE-PLACEMENT round 2).
 * A page that has outgrown the pane is left-aligned so its own left edge is reachable at scroll 0
 * — that part of B1273296's rule is right and is kept. What it must NOT do is put the page flush
 * against the pane, because the grey margin IS the surface you place a note on and drag one into;
 * at zero width the whole left half of "the page grows in four directions" becomes unreachable.
 * The number is chosen against the GESTURE, not against taste: it has to be comfortably wider
 * than a box's own grip and than the 4px slop that separates a press from a drag, and about the
 * width of the natural gutter on a small laptop, so a grown page still reads as a page on a desk
 * rather than as a different layout. */

/* ⛔ THE MAT MUST HAVE SOMEWHERE TO SCROLL TO, WHETHER ANYTHING IS PARKED THERE YET OR NOT
 * (B1550977/NEW-2, owner report 2026-09-11: *"I'm not able to really scroll up or down... that
 * kinda defeats the purpose of me being able to expand into gray area... if I can't even click
 * into the gray area."*).
 *
 * ⛔ THIS IS A DIFFERENT QUESTION FROM `anchorExtent`/`anchorExtentX` ABOVE, WHICH ONLY GROW THE
 * SHEET TO HOLD A BOX THAT ALREADY OVERHANGS IT. Before anything is placed, that math reports
 * zero need, so the mat's own scrollable content was exactly the sheet's size plus a sliver —
 * measured live: scrollHeight 452 vs a 330 clientHeight, sheet bottom at y=455 against a mat
 * bottom of y=465, ten pixels of grey at MAXIMUM scroll. There is nowhere to work.
 *
 * The fix is unconditional extra room on the mat itself, past whatever the sheet (grown or not)
 * already needs — a place to drag a floating box INTO, not just room to hold one already there.
 *
 * ⛔ THE BOTTOM HALF IS PADDING; THE RIGHT HALF IS NOT, AND NEITHER IS EVER PADDING-LEFT OR
 * PADDING-TOP. Padding-left/padding-top sit BEFORE the sheet in the mat's own flex flow
 * (`alignItems: "flex-start"`, `flexDirection: "column"`), so growing them would shift the sheet
 * away from where it already sits at rest — exactly the "permanent empty gap, page stranded"
 * look this item explicitly rules out. Padding-BOTTOM is safe the same way (it comes AFTER the
 * sheet, invisible until actually scrolled to) because `note-sheet` has no percentage-based
 * HEIGHT for it to disturb. Padding-RIGHT is NOT safe, because `note-sheet` sizes its WIDTH with
 * `width: "100%"` when ungrown — resolved against the mat's own content box — so more padding
 * there silently narrows the sheet itself (measured: a naturally-580px sheet rendered at its
 * 260px floor the instant this was tried as padding). The right-side reach is a normal-flow
 * SPACER SIBLING instead — see `matReachWidth`'s own comment, below, for the full mechanism.
 * (Growing left already has its own mechanism, `sheetPadLeft` + the scroll-compensation layout
 * effect below, which only spends real scroll room on a box that has actually earned it.) */
/* ⛔ CORRECTED (B1344625/B1344626, owner report 2026-09-15) — BOTH NUMBERS ABOVE WERE
 * UNCONDITIONAL, AND THAT WAS ITSELF THE NEXT BUG. B1550977 fixed "nowhere to scroll to" by
 * always reserving a flat 480/320 past the sheet, on every note, whether anything needed the
 * room or not — and a flat number that never adapts is exactly what turned into "every note can
 * be scrolled sideways into empty space" and "half a screen of dead grey under every short note."
 * Measured live: a 569px-wide Fit-to-content page carried 331px of horizontal dead scroll (the
 * sheet's own left edge sliding behind the Pages rail at max scroll), and the flat 480px bottom
 * pad was itself TALLER than the owner's own 465px-tall window, so scrolling down took a short
 * note completely off the top of the screen. Two different fixes, because the two reports asked
 * for two different things:
 *   BOTTOM — still unconditional (a short note has no "gesture" to key extra room off), but now
 *            PROPORTIONAL to the pane's own height (`matExtraBottomFor`) and capped at the old
 *            480 rather than a flat constant — a scale, not a switch, per NEW-3's own
 *            "clamp it / scale it to a fraction of the viewport" instruction.
 *   RIGHT  — genuinely a SWITCH, per NEW-2's own bar ("no horizontal scroll at all" for a page
 *            that fits): the flat 320 is now added ONLY while a real box gesture (a drag, a
 *            resize) is in flight — see `boxGestureActive`, below — because that is the one
 *            moment B1550977's own report is actually about ("I'm not able to... expand into
 *            gray area" was written mid-drag, dragging a box he could not yet see). A note with
 *            no box in flight has nothing that needs the reach, and the spacer now says so. */

/* ⛔ THE PAGE TITLE IS A RATIO OF THE BODY, NOT A PIXEL NUMBER (NOTES-FREE-PLACEMENT / NEW-6,
 * owner report 2026-09-08: *"42px against 15px body, 2.8x, on a 580px column… it is the one
 * element still shouting"*).
 *
 * ⛔ EXPRESSED AS A RATIO ON PURPOSE, and that is the half of his ask that outlives this commit:
 * the previous 42/34 were fixed numbers chosen against a 15px body, so the next time the body
 * size moves they become wrong silently. `NOTE_BODY_FONT_PX` is the same size the stylesheet sets
 * for `.ProseMirror`, declared once here and interpolated into it, so the two cannot drift.
 *
 * ⛔ THE WEIGHT KEEPS THE DISTINCTION, NOT THE SIZE — also his instruction. The title stays 700
 * against a heading scale that tops out at h1's 2em/700, and comes down to 2.05× (≈31px), inside
 * the 28–32px he named. It reads as the page's own name because it sits alone above the metadata
 * line in the title band, not because it is the loudest thing on screen. The phone keeps a
 * slightly tighter ratio for the same reason it always did — a real page name has to fit on a
 * 390px-class screen before the input's own scrolling takes over.
 *
 * ⛔ 15 → 11 (NEW-4, toolbar rebuild, 2026-09-24) — BODY ONLY, and that split is deliberate. The
 * size chip used to read "15 · std", a number nobody chose, inherited from this one constant;
 * every reference editor (Word, Google Docs) defaults a fresh document to 11, so the body moved
 * to match (`notesFormatPalette.js`'s `DEFAULT_SIZE` mirrors this exact number). The title's
 * default is now computed from the OLD body size instead of the live one — `TITLE_DEFAULT_PX`
 * below is exactly what this ratio produced at 15px — so a body-size change never silently
 * shrinks every page's title along with it; the two were tuned together once, at real owner
 * cost (B1203504's critique loop), and nothing about the body's default number is a reason to
 * retune the title. A title that wants the smaller, size-tracks-body look is free to say so
 * explicitly via its own size control (NEW-5, `titleStyle.fontSize`), which this redesign adds. */
const NOTE_BODY_FONT_PX = 11;
const TITLE_SCALE = { narrow: 1.75, wide: 2.05 };
const TITLE_TUNED_BODY_PX = 15;
const TITLE_DEFAULT_PX = {
  narrow: Math.round(TITLE_TUNED_BODY_PX * TITLE_SCALE.narrow),
  wide: Math.round(TITLE_TUNED_BODY_PX * TITLE_SCALE.wide),
};
export const noteTitleFontPx = (narrow) => (narrow ? TITLE_DEFAULT_PX.narrow : TITLE_DEFAULT_PX.wide);

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
   print sheet cannot drift.
   ⛔ B1203504 — the FALLBACK (the ", 1.15" in var(--note-line, 1.15)) is deliberately still
   Word's single, not the new Comfortable prose ratio: it only ever paints for the one instant
   before the wrapper's own "--note-line" custom property is set, and a stale fallback here can
   never be more than an unreachable number, never a second density to keep in step. */
/* ⛔ A WORD WITH NOWHERE TO BREAK MUST BREAK ANYWAY (NOTES-PAGE-GROWTH) — an unbroken run (a long
   URL, a hash, a run-on string with no spaces) is the one case anchorExtentX's "grow the page"
   rule cannot honestly answer: growing the page to fit ONE overlong word would make the page as
   wide as the word, on every reload, forever. overflow-wrap: anywhere is the same rule every
   other reading surface in the app already uses for exactly this (never letting one word dictate
   the whole column's width) — mirrored into PRINT_CSS in lib/notesPrint.js.
   ⛔ NO BACKTICKS IN A COMMENT INSIDE THIS TEMPLATE LITERAL — one backtick ends EDITOR_CSS and
   the module stops parsing. This file's own PRINT_CSS sibling in lib/notesPrint.js carries the
   identical warning, so this is a re-statement of a known trap, not a new discovery of one. */
/* ⛔ WHILE A PLACEMENT IS ARMED THE EDITOR HOLDS FOCUS BUT DRAWS NO CARET (NEW-8). It has to
   hold focus to receive the keystroke that makes the note; what it must not do is show a second
   caret somewhere else in the document, because the only caret on screen should be the one where
   the press landed. */
.planyr-note .ProseMirror[data-pending-place="1"] { caret-color: transparent; }
/* The armed caret itself: a plain text caret, blinking at the rate every editor uses. It is
   painted on the mat rather than in the document because there is nothing in the document to
   attach it to — that is precisely what has not happened yet. */
.planyr-note .planyr-pending-caret { position: absolute; z-index: 4; width: 2px; pointer-events: none; background: var(--text-primary); animation: planyr-caret-blink 1.06s steps(1) infinite; }
@keyframes planyr-caret-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
.planyr-note .ProseMirror { outline: none; min-height: 46vh; color: var(--text-primary); line-height: var(--note-line, 1.15); font-size: ${NOTE_BODY_FONT_PX}px; tab-size: 4; overflow-wrap: anywhere; }
/* ⛔ REAL VERTICAL RHYTHM (B1203504) — read this before touching a margin below.
   Before this, every block here — paragraphs, lists, all four heading levels, blockquote,
   table — carried an explicit "margin: 0", which is MORE specific than the catch-all sibling
   rule directly below and so silently cancelled it for every one of them. Measured live: a
   note was one undifferentiated slab with the only vertical space coming from line-height.
   That is the root cause the owner could feel and not name ("the field just feels off").
   Fixed by giving every block type that used to zero itself out a real, own, explicit margin
   instead of relying on the cascade to sort two competing rules — no more specificity race.
   The catch-all below is the FALLBACK for the block kinds that never had (and still don't
   need) a margin reset of their own — "pre", and every custom node view (a callout, a toggle,
   a picture, a file chip, a sketch, a positioned box) — so a construct added later inherits
   real rhythm by default rather than needing its own opt-in. Craft/Bear-generous, not the old
   0.7em: a paragraph gap you can see without hunting for it. */
.planyr-note .ProseMirror > * + * { margin-top: 1em; }
/* The very first block sits flush under the title/metadata row — nothing above it to space
   away from. Specificity beats every type rule below it regardless of source order (two
   classes + a pseudo-class outranks two classes + a type selector), so this always wins. */
.planyr-note .ProseMirror > *:first-child { margin-top: 0 !important; }
.planyr-note .ProseMirror p { margin: 1em 0 0 0; }
/* ⛔ THE HEADING SCALE IS OPENED UP, AND EVERY LEVEL GIVES MORE SPACE ABOVE THAN BELOW
   (B1203504). The old scale (1.9/1.5/1.22/1.06em) put only a 1.22× step between body and h3 —
   nearly invisible at these sizes, which is why a heading read as "an accident, not a level."
   The asymmetric margin is Notion's own device: a heading binds visually to the text it
   introduces by sitting CLOSE to what follows and FAR from what came before, so it reads as
   owning the paragraph beneath it rather than floating between two unrelated blocks. */
.planyr-note .ProseMirror h1 { font-size: 2em; font-weight: 700; line-height: 1.2; margin: 1.5em 0 0.5em 0; }
.planyr-note .ProseMirror h2 { font-size: 1.55em; font-weight: 700; line-height: 1.25; margin: 1.3em 0 0.45em 0; }
.planyr-note .ProseMirror h3 { font-size: 1.2em; font-weight: 650; margin: 1.1em 0 0.4em 0; }
.planyr-note .ProseMirror h4 { font-size: 1.05em; font-weight: 650; margin: 1em 0 0.35em 0; }
.planyr-note .ProseMirror ul, .planyr-note .ProseMirror ol { padding-left: 1.5em; margin: 1em 0 0 0; }
.planyr-note .ProseMirror li { margin: var(--note-list-gap, 2px) 0; }
.planyr-note .ProseMirror li p { margin: 0; }
/* ⛔ A NESTED LIST IS THE NEXT LINE OF THE SAME LIST, NOT A NEW BLOCK (Tab vertical-drop bug,
   owner report). The "ul, ol { margin: 1em 0 0 0 }" rule above spaces a list away from a
   paragraph that precedes it elsewhere in the document; a list nested INSIDE a list item — what
   Tab's real sinkListItem produces — is not that. It is the very next item, one level deeper, and
   Tab must change only its horizontal position (lib/notesListIndent.js's header). Left alone, the
   nested ol/ul's own 1em top margin lands between the parent item and its newly-sunk child, so an
   indented item sits measurably lower than an ordinary sibling would (measured: 6px normal gap →
   15px after one real Tab) — "it's literally at a different height." */
.planyr-note .ProseMirror li > ul, .planyr-note .ProseMirror li > ol { margin-top: var(--note-list-gap, 2px); }
/* ⛔ THE indent ATTRIBUTE'S ONE STYLESHEET TABLE (B842949) — a fixed step per level, looked up
   by data-indent, never an inline margin computed and stamped onto the element by hand. See
   lib/notesIndentLevel.js → indentAttrs / indentCssRules for why. PDF-PARITY: the print sheet
   (lib/notesPrint.js) carries the identical table for .note-body li. */
${indentCssRules(".planyr-note .ProseMirror li")}
/* ⛔ NESTED LIST MARKERS STEP THROUGH THE OUTLINE CONVENTION (NEW-2) — see
   lib/notesIndentLevel.js → listMarkerCssRules for the decision and the reasoning. PDF-PARITY:
   the print sheet (lib/notesPrint.js) carries the identical table for .note-body. */
${listMarkerCssRules(".planyr-note .ProseMirror")}
.planyr-note .ProseMirror blockquote { border-left: 3px solid var(--accent-notes); padding-left: 0.9em; color: var(--text-secondary); margin: 1em 0 0 0; }
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
/* ⛔ NO width: 100% HERE (NEW-1, owner report 2026-09-11) — that is what pinned a table's total
   width to the text column, so widening one column had nowhere to come from but its neighbours.
   table-layout: fixed is kept (it is what makes an explicit column width honoured exactly); the
   table's own width now comes only from the node view's own inline style, which it sets to the
   sum of its columns once notesTableColumns.js's NoteTableColumns has given every column an
   explicit one. An untouched table (nothing here yet) still divides the available width evenly —
   removing this rule changes nothing for it, since a table with no explicit width still fills its
   container by ordinary block-box rules.
   (No backticks in this block — that trap has broken this build six times now; see the guard in
   the notesModule suite.) */
.planyr-note .ProseMirror table { border-collapse: collapse; table-layout: fixed; margin: 1em 0 0 0; }
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
/* ⛔ SELECTED AND EDITING MUST NOT LOOK IDENTICAL (B1555152 part 1, owner report 2026-09-11:
   "sometimes it takes a double click, sometimes it takes a click, it's actually kinda odd").
   Measured: before this rule, selected-alone and selected-plus-editing painted the exact same
   border colour/style and the exact same background wash — the ONLY difference anywhere was the
   mouse cursor glyph (grab vs text), which needs the pointer hovering the box to see and says
   nothing once the mouse has moved on. A box picked up (stage 1, Delete removes it) and a box you
   are actively typing in (stage 2) are two different things to be IN, and a glance has to be able
   to tell them apart without touching anything. Editing gets a visibly heavier wash and border —
   never outline/box-shadow (see the note above: both paint outside the box and would swallow a
   neighbour's controls). */
.planyr-note .ProseMirror .planyr-anchor[data-editing="1"] { border-width: 2px; background: color-mix(in srgb, var(--accent-notes) 16%, transparent); }
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"] { border-color: var(--border-default); border-style: dashed; }
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"]:focus-within { border-color: var(--accent-notes); }
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"]:focus-within .planyr-anchor-content::after { content: "Type here"; position: absolute; left: 16px; top: 3px; pointer-events: none; color: var(--text-tertiary); font-style: italic; }
.planyr-note .ProseMirror .planyr-anchor-content { position: relative; }
/* ⛔ THE GRIP IS AN AFFORDANCE, NOT A TARGET (NOTES-FREE-PLACEMENT / NEW-2). It used to be the
   ONLY way to move a box — 9×14px, at opacity 0 until the box was selected, and dragging the box
   by its body did nothing at all and said nothing about it. The whole body drags now (see the
   node view), so this exists purely to SAY so: it appears on hover as well as on selection, at a
   size somebody can actually see. It stays a REAL target rather than becoming decoration for one
   reason: a box you have just typed into must still be movable without pressing Escape first, and
   the body's own drag deliberately stands down while the caret is inside (see the node view). It
   sits inside the box's own 16px left padding, so it covers no text — instrument trap #9's hazard
   was a harness aiming at a fixed offset from the corner, which is a harness rule, not a reason to
   remove the affordance. */
.planyr-note .ProseMirror .planyr-anchor-grip { position: absolute; left: 3px; top: 4px; width: 12px; height: 20px; cursor: grab; border-radius: 3px; opacity: 0; transition: opacity 90ms linear; background: repeating-linear-gradient(to bottom, var(--text-tertiary) 0 2px, transparent 2px 4px); }
.planyr-note .ProseMirror .planyr-anchor-grip:active { cursor: grabbing; }
.planyr-note .ProseMirror .planyr-anchor:hover .planyr-anchor-grip,
.planyr-note .ProseMirror .planyr-anchor[data-selected="1"] .planyr-anchor-grip { opacity: 1; }
/* ⛔ AND THE CURSOR READS grab OVER THE WHOLE DRAGGABLE AREA, not over a sliver of chrome —
   his third point on NEW-2. It flips to a text cursor for the one state where a press is about
   words rather than position: while the caret is inside this box. data-editing is painted from
   the editor's own two-stage state, beside data-selected. */
.planyr-note .ProseMirror .planyr-anchor { cursor: grab; }
.planyr-note .ProseMirror .planyr-anchor[data-editing="1"] { cursor: text; }
.planyr-note .ProseMirror .planyr-anchor[data-editing="1"] .planyr-anchor-content { cursor: text; }
/* ⛔ THE BOX'S OWN CHROME SITS ABOVE THE BOX'S OWN TEXT, AND THAT z-index IS THE WHOLE FIX
   (B421488). A control inside the box's padding box overlaps the first line of text; the content
   wrapper below is position:relative (it has to be, for the empty box's "Type here" hint) and is
   appended LAST, so with both at z-index:auto the CONTENT painted on top. Paint order is hit-test
   order, so a press at a control's own centre landed on the paragraph: the control was visible,
   enabled, correctly labelled, and impossible to click. This is CHROME-NEVER-EATS-A-PRESS with the
   sides reversed — the content ate the chrome. The rule the z-index encodes: a control drawn ON the
   box belongs to the box's chrome layer. */
.planyr-note .ProseMirror .planyr-anchor-grip, .planyr-note .ProseMirror .planyr-anchor-h { z-index: 1; }
/* ⛔ THE CONNECT DOT — DRAG-FROM-THE-DOT, ONE OF THE TWO WAYS TO DRAW AN ARROW (NEW-2). Visible
   only once selected (same rule as the resize handles above: an affordance shown on every box
   all the time is noise). A box marked as the live drop target while a connect-drag is in
   flight gets its own ring so the drop is unambiguous before release.
   ⛔ PARKED PAST THE SE CORNER, NOT ON THE RIGHT EDGE (CHROME-NEVER-EATS-A-PRESS) — its first
   position, right:-6px top:50%, was IDENTICAL to the east resize handle's own position below,
   and handles paint after this element, so on a text box (east+west handles) the resize handle
   silently won every press and the dot was unreachable by any pointer — caught only by a
   harness that actually drove the drag rather than asserting the element existed. Sitting
   further out than the se handle (right:-6px bottom:-6px) clears every one of the eight handle
   positions above, for a text box or a picture box alike. */
.planyr-note .ProseMirror .planyr-anchor-connect { position: absolute; right: -16px; bottom: -16px; width: 11px; height: 11px; border-radius: 50%; border: 2px solid var(--accent-notes); background: var(--surface-raised); cursor: crosshair; opacity: 0; pointer-events: none; z-index: 1; }
.planyr-note .ProseMirror .planyr-anchor[data-selected="1"] .planyr-anchor-connect { opacity: 1; pointer-events: auto; }
.planyr-note .ProseMirror .planyr-anchor[data-arrow-target="1"] { outline: 2px solid var(--accent-notes); outline-offset: 2px; }
/* Click-to-connect's own source highlight — a box waiting to be the arrow's start point. */
.planyr-note .ProseMirror .planyr-anchor[data-arrow-source="1"] { border-color: var(--accent-notes); border-style: dashed; }
.planyr-note [data-testid="note-mat"][data-arrow-mode="1"] { cursor: crosshair; }
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

/* ⛔ THE ONE STRUCTURAL TRAILING PARAGRAPH IS NEVER SHOWN (NEW-1, 2026-09-22). ProseMirror
   restores a real textblock at the end of the document whenever the last child would
   otherwise be isolating (a box or a sketch), so there is always one — see
   notesAnchorNode.js's own header on why addNoteAnchorAt inserts before it rather than
   after. It is infrastructure, not content: zero size, no pointer events, so it neither
   looks like a line of text nor swallows a press meant for the sheet under it. It is the
   ONLY direct-child <p> a migrated (or new, boxes-only) document ever has, which is what
   makes the last-child selector right rather than a special class to maintain. The old
   per-paragraph "Start typing" placeholder that used to live here is gone with it — the
   page-level empty state is rendered by NoteEditor.jsx itself now (search for the
   double-click placeholder text below). ⛔ NO BACKTICKS IN THIS COMMENT — EDITOR_CSS is a
   template literal and one backtick ends the string early (repeat offense, see PRINT_CSS's
   own header in notesPrint.js). */
.planyr-note .ProseMirror > p:last-child { height: 0; margin: 0 !important; padding: 0; overflow: hidden; pointer-events: none; }

/* A picture. The BROKEN state is styled as loudly as the good one on purpose: an image
   whose bytes are gone must read as a stated problem, never as a blank gap. */
.planyr-note .planyr-note-image { margin: 0; display: block; }
.planyr-note .planyr-note-image img { max-width: 100%; height: auto; display: block; border-radius: ${RADIUS.control}px; border: 1px solid var(--border-default); }
.planyr-note .planyr-note-image.ProseMirror-selectednode img { outline: 2px solid var(--accent-notes); outline-offset: 1px; }
.planyr-note .planyr-note-image[data-missing] { border: 1px dashed var(--danger-text); border-radius: ${RADIUS.control}px; padding: 14px; background: var(--surface-page); }
.planyr-note .planyr-note-image-missing { color: var(--danger-text); font-size: 12px; font-weight: 600; }

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
.planyr-note .planyr-toggle-title::before { display: inline-block; width: 14px; margin-left: -3px; content: "▶"; font-size: 10px; color: var(--text-tertiary); cursor: pointer; }
.planyr-note .planyr-toggle[open] > .planyr-toggle-title::before { content: "▼"; }

/* AN ATTACHED FILE (NEW-5). Same discipline as a picture: the document holds an id, the
   bytes are behind the storage seam, and a chip whose bytes are GONE says so in as many
   words rather than downloading nothing. */
.planyr-note .planyr-note-file { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--border-default); border-radius: ${RADIUS.control}px; background: var(--surface-page); text-decoration: none; }
.planyr-note .planyr-note-file.ProseMirror-selectednode { outline: 2px solid var(--accent-notes); outline-offset: 1px; }
.planyr-note .planyr-note-file[data-missing] { border: 1px dashed var(--danger-text); }
.planyr-note .planyr-note-file-badge { flex: 0 0 auto; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; padding: 2px 6px; border-radius: ${RADIUS.pill}px; border: 1px solid var(--border-strong); color: var(--text-secondary); }
.planyr-note .planyr-note-file-name { flex: 1 1 auto; min-width: 0; font-size: 13px; font-weight: 650; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.planyr-note .planyr-note-file-size { flex: 0 0 auto; font-size: 12px; font-weight: 600; color: var(--text-tertiary); }
.planyr-note .planyr-note-file-get { flex: 0 0 auto; height: 22px; padding: 0 10px; border-radius: ${RADIUS.pill}px; border: 1px solid var(--accent-notes); background: transparent; color: var(--accent-notes-text); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.planyr-note .planyr-note-file-get:disabled { border-color: var(--danger-text); color: var(--danger-text); cursor: default; }

/* Search marking is a decoration, never a mark — it is not in the document. */
.planyr-note .note-search-hit { background: var(--warn-bg); box-shadow: 0 0 0 1px var(--warn-text) inset; border-radius: 2px; }
.planyr-note .note-search-hit-current { background: var(--accent-notes); color: var(--on-accent-notes); box-shadow: none; }
/* ⛔ SET A PAGE'S OWN WIDTH BY HAND (NEW-1) — the sheet's own edge grips. PR 1508's own lesson,
   named in this item's brief: a 9×14px resize target that was invisible until hover shipped as
   "super buggy" because the obvious gesture found nothing there. This one is a full-height, 14px
   hit STRIP straddling the sheet's own border (so it never eats a press meant for the page's
   content — CHROME-NEVER-EATS-A-PRESS), painted with a visible bar only on hover so it never
   competes with the page for attention at rest, exactly the way the box grip above earns its
   opacity. No border-radius on the bar itself — at 2px wide, rounding would not be visible and
   is not worth adding a new off-scale radius for (design-drift-audit). */
.planyr-note .planyr-page-width-grip { position: absolute; top: 0; bottom: 0; width: 14px; cursor: col-resize; z-index: 2; touch-action: none; }
.planyr-note .planyr-page-width-grip::after { content: ""; position: absolute; top: 12px; bottom: 12px; left: 6px; width: 2px; background: var(--text-tertiary); opacity: 0; transition: opacity 90ms linear; }
.planyr-note .planyr-page-width-grip:hover::after,
.planyr-note .planyr-page-width-grip[data-dragging="1"]::after { opacity: 1; }
.planyr-note .planyr-page-width-grip[data-dragging="1"]::after { background: var(--accent-notes); }
.planyr-note .planyr-page-width-grip-left { left: -7px; }
.planyr-note .planyr-page-width-grip-right { right: -7px; }
/* ⛔ SET A PAGE'S OWN HEIGHT BY HAND (NEW-1) — the horizontal twin of the width grips just
   above: same hit-strip shape, same hover-only bar, same reasoning, transposed onto the
   top/bottom edges. row-resize cursor, matching the direction of travel. NO BACKTICKS IN THIS
   COMMENT (it lives inside the EDITOR_CSS template literal — one backtick ends the string). */
.planyr-note .planyr-page-height-grip { position: absolute; left: 0; right: 0; height: 14px; cursor: row-resize; z-index: 2; touch-action: none; }
.planyr-note .planyr-page-height-grip::after { content: ""; position: absolute; left: 12px; right: 12px; top: 6px; height: 2px; background: var(--text-tertiary); opacity: 0; transition: opacity 90ms linear; }
.planyr-note .planyr-page-height-grip:hover::after,
.planyr-note .planyr-page-height-grip[data-dragging="1"]::after { opacity: 1; }
.planyr-note .planyr-page-height-grip[data-dragging="1"]::after { background: var(--accent-notes); }
.planyr-note .planyr-page-height-grip-top { top: -7px; }
.planyr-note .planyr-page-height-grip-bottom { bottom: -7px; }
/* ⛔ THE GREY IS SOMETHING YOU CAN PICK UP (NEW-1). The owner asked for a map, and a map says so
   before you touch it: grab at rest, grabbing while it moves. The affordance is on the MAT only —
   the white sheet resets to auto, so paper still shows a text cursor and is still paper.

   ⛔ THESE TWO RULES LIVE LAST IN THIS STYLESHEET ON PURPOSE, AND MOVING THEM BREAKS THEM. The
   panning rule's descendant form scores the same specificity as the anchor's own cursor rule
   above, so source order is the whole of what makes the grabbing glyph survive a pan that travels
   across a box. Nothing here needs an important flag as long as it stays at the bottom.

   ⛔ AND THE DESCENDANT FORM IS NOT BELT AND BRACES — a pan that starts on grey routinely crosses
   the sheet, the boxes and the edge grips, every one of which sets its own cursor. Without it the
   glyph flickers through col-resize and grab mid-gesture, which reads as the gesture having
   changed into something else. */
.planyr-note [data-testid="note-mat"] { cursor: grab; }
.planyr-note [data-testid="note-sheet"] { cursor: auto; }
.planyr-note [data-testid="note-mat"][data-panning="1"],
.planyr-note [data-testid="note-mat"][data-panning="1"] * { cursor: grabbing; }
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
        color: "var(--text-secondary)", fontSize: 12, fontWeight: 600,
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
        style={{ height: 22, padding: "0 9px", borderRadius: RADIUS.pill, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
      >Clear</button>
    </div>
  );
}

/* Shared by the three NEW floating/docked panels below — the same shadow the toolbar's own
 * popovers use (NoteToolbar.jsx's `POPOVER_SHADOW`), so a control that floats over the canvas
 * reads as the same kind of surface as one that floats off the toolbar. */
const FLOAT_SHADOW = "0 12px 32px rgba(0,0,0,0.20)";

/** ⛔ NEW-3 — THE ZOOM PILL. Bottom-right of the canvas, floating, [−] [level ▾] [+]. Replaces
 *  the toolbar chip that used to hide itself at 100% (PANEL-BREVITY doesn't apply to a
 *  permanent floating control the way it did to a toolbar slot — see this file's own call
 *  site). The percentage opens a short menu of named levels plus "Fit width", mirroring what
 *  every other drawing surface in this app already offers. */
function ZoomPill({ pct, onZoomOut, onZoomIn, onPick, onReset, onFitWidth }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const btnStyle = {
    width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer",
    font: "inherit", fontSize: 14, fontWeight: 700, borderRadius: RADIUS.control,
  };
  const LEVELS = [0.5, 0.75, 1, 1.25, 1.5];
  return (
    <span
      ref={wrapRef}
      data-testid="note-zoom-pill"
      /* ⛔ NEW-3 — THE HELP/REPORT FAB SHARES THIS CORNER (`shared/ui/cornerClearance.js`,
         B966700-ish). That control reads `[data-canvas-corner]` and moves ITSELF up to clear
         whatever it finds there — `NoteOutline.jsx`'s own floating toggle already does exactly
         this in this same module ("without it the two FABs would sit on top of each other").
         Omitting this mark is what let the FAB intercept clicks on this pill in the first
         live check. */
      data-canvas-corner="notes-zoom"
      style={{
        position: "absolute", right: 18, bottom: 16, zIndex: 30,
        display: "inline-flex", alignItems: "center", gap: 1, padding: 3,
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.pill, boxShadow: FLOAT_SHADOW,
      }}
    >
      <button type="button" data-testid="note-zoom-out" aria-label="Zoom out" onClick={onZoomOut} style={btnStyle}>−</button>
      <button
        type="button"
        data-testid="note-zoom-level"
        aria-label="Zoom level"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ ...btnStyle, width: "auto", padding: "0 8px", fontSize: 12, fontWeight: 700 }}
      >{zoomLabel(pct)}</button>
      <button type="button" data-testid="note-zoom-in" aria-label="Zoom in" onClick={onZoomIn} style={btnStyle}>+</button>
      {open && (
        <div
          role="menu"
          data-testid="note-zoom-menu"
          style={{
            position: "absolute", right: 0, bottom: 34, zIndex: 31, padding: 4, minWidth: 120,
            display: "flex", flexDirection: "column", gap: 1,
            background: "var(--surface-raised)", border: "1px solid var(--border-default)",
            borderRadius: RADIUS.control, boxShadow: FLOAT_SHADOW,
          }}
        >
          {LEVELS.map((z) => (
            <button key={z} type="button" data-testid={`note-zoom-opt-${Math.round(z * 100)}`}
              onClick={() => { setOpen(false); if (z === 1) onReset(); else onPick(z); }}
              style={{ textAlign: "left", padding: "6px 8px", borderRadius: RADIUS.control, border: "none", background: "transparent", color: "var(--text-primary)", font: "inherit", fontSize: 12, fontWeight: 550, cursor: "pointer" }}
            >{Math.round(z * 100)}%</button>
          ))}
          <button type="button" data-testid="note-zoom-opt-fit-width"
            onClick={() => { setOpen(false); onFitWidth(); }}
            style={{ textAlign: "left", padding: "6px 8px", borderRadius: RADIUS.control, border: "none", background: "transparent", color: "var(--text-primary)", font: "inherit", fontSize: 12, fontWeight: 550, cursor: "pointer" }}
          >Fit width</button>
        </div>
      )}
    </span>
  );
}

/** ⛔ NEW-2 — PAGE SETUP. The width/height controls the OLD toolbar carried as two separate
 *  "W"/"H" chips, now a single popover reached from the module tab row. Floats over the
 *  canvas (this component's caller is the mat's own relative wrapper), not anchored to the
 *  header button that opened it — the same reasoning the History panel already relies on
 *  (a docked/floating panel, never popover-anchored to a trigger in a different DOM subtree). */
function PageSetupPopover({ editor, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  if (!editor || editor.isDestroyed) return null;
  const pageWidth = editor.state.doc.attrs?.pageWidth ?? null;
  const pageHeight = editor.state.doc.attrs?.pageHeight ?? null;
  const rowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px", borderRadius: RADIUS.control, cursor: "pointer", border: "none", font: "inherit", fontSize: 12, fontWeight: 550, textAlign: "left", width: "100%" };
  return (
    <div
      ref={ref}
      data-testid="note-page-setup"
      role="dialog"
      aria-label="Page setup"
      style={{
        position: "absolute", top: 12, right: 18, zIndex: 30, width: 220, padding: 10,
        display: "flex", flexDirection: "column", gap: 10,
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.control, boxShadow: FLOAT_SHADOW,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>Page setup</span>
        <button type="button" data-testid="note-page-setup-close" aria-label="Close" onClick={onClose}
          style={{ border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 3 }}>Width</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {[{ label: "Fit to content", value: "fit" }, ...PAGE_WIDTH_PRESETS.map((p) => ({ label: p.label, value: String(p.px) }))].map((o) => {
            const selected = (pageWidth == null ? "fit" : String(pageWidth)) === o.value;
            return (
              <button key={o.value} type="button" data-testid={`note-page-width-${o.value}`}
                onClick={() => {
                  if (o.value === "fit") editor.commands.setNotePageWidth(null);
                  else if (o.value === "full") editor.commands.setNotePageWidth("full");
                  else editor.commands.setNotePageWidth(Number(o.value));
                }}
                style={{ ...rowStyle, background: selected ? "var(--accent-notes)" : "transparent", color: selected ? "var(--on-accent-notes)" : "var(--text-primary)" }}
              >{o.label}</button>
            );
          })}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 3 }}>Height</div>
        <button type="button" data-testid="note-page-height-reset" disabled={pageHeight == null}
          onClick={() => editor.commands.setNotePageHeight(null)}
          style={{ ...rowStyle, opacity: pageHeight == null ? 0.5 : 1, background: "transparent", color: "var(--text-primary)", cursor: pageHeight == null ? "default" : "pointer" }}
        >{pageHeightLabel(pageHeight)}{pageHeight != null ? " — reset to Fit to content" : ""}</button>
      </div>
    </div>
  );
}

/** ⛔ NEW-2 — FIND AND REPLACE (Ctrl+H). A real replace, not just the sidebar's find-and-jump:
 *  `replaceNoteSearch`/`replaceAllNoteSearch` (lib/notesSearchHighlight.js) commit into the
 *  document, so both are real, undoable edits — Ctrl+Z reverses a Replace All exactly like any
 *  other typed change. Floats over the canvas; closing it clears the search term too, so a
 *  stray highlight doesn't linger once someone shuts this down. */
function FindReplaceBar({ editor, find, onClose }) {
  const [term, setTerm] = useState(find?.term || "");
  const [replacement, setReplacement] = useState("");
  const findRef = useRef(null);
  /* ⛔ COUNT/INDEX COME FROM THE PARENT'S `find` STATE, NEVER RE-DERIVED HERE. `find` is
   * already kept live by the real source of truth — the `NoteSearchHighlight` extension's own
   * `onMatches` callback (`onSearchMatches` in this file's `noteExtensions(...)` call) — so a
   * second read of plugin state here would be a second copy of the same fact, the exact trap
   * rule 1 at this file's own top warns against for every other toolbar-shaped control. */
  const count = find?.count || 0;
  const index = find?.index || 0;

  useEffect(() => { findRef.current?.focus(); }, []);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setNoteSearch(term);
  }, [editor, term]);
  useEffect(() => () => { if (editor && !editor.isDestroyed) editor.commands.setNoteSearch(""); }, [editor]);

  const step = (d) => editor?.commands.stepNoteSearch(d);
  const replaceOne = () => editor?.commands.replaceNoteSearch(replacement);
  const replaceAll = () => editor?.commands.replaceAllNoteSearch(replacement);

  const inputStyle = {
    height: 26, padding: "0 8px", borderRadius: RADIUS.control, border: "1px solid var(--border-default)",
    background: "var(--surface-page)", color: "var(--text-primary)", font: "inherit", fontSize: 12, width: 150,
  };
  const btnStyle = { height: 26, padding: "0 9px", borderRadius: RADIUS.control, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" };

  return (
    <div
      data-testid="note-find-replace-bar"
      role="dialog"
      aria-label="Find and replace"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      style={{
        flex: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "6px 14px",
        borderBottom: "1px solid var(--border-default)", background: "var(--surface-page)",
      }}
    >
      <input ref={findRef} data-testid="note-find-input" value={term} placeholder="Find"
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); } }}
        style={inputStyle} />
      <span data-testid="note-find-replace-count" style={{ fontSize: 12, color: "var(--text-tertiary)", minWidth: 60 }}>
        {term ? (count ? `${index + 1} of ${count}` : "No matches") : ""}
      </span>
      <button type="button" data-testid="note-find-replace-prev" title="Previous match" disabled={!count} onClick={() => step(-1)} style={{ ...btnStyle, opacity: count ? 1 : 0.45 }}>‹</button>
      <button type="button" data-testid="note-find-replace-next" title="Next match" disabled={!count} onClick={() => step(1)} style={{ ...btnStyle, opacity: count ? 1 : 0.45 }}>›</button>
      <input data-testid="note-replace-input" value={replacement} placeholder="Replace"
        onChange={(e) => setReplacement(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); replaceOne(); } }}
        style={inputStyle} />
      <button type="button" data-testid="note-replace-one" disabled={!count} onClick={replaceOne} style={{ ...btnStyle, opacity: count ? 1 : 0.45 }}>Replace</button>
      <button type="button" data-testid="note-replace-all" disabled={!count} onClick={replaceAll} style={{ ...btnStyle, opacity: count ? 1 : 0.45 }}>Replace all</button>
      <button type="button" data-testid="note-find-replace-close" aria-label="Close find and replace" onClick={onClose}
        style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
    </div>
  );
}

/* ⛔ `pressIsBesideLine` AND `lineRectsAt` ARE GONE (NEW-1, 2026-09-22) — DELETED RATHER THAN
 * ROUTED AROUND, on the owner's own instruction. Both existed to answer "is this press beside
 * a line of FLOW TEXT", and there is no flow text left on the page for a press to be beside:
 * the sheet holds nothing but positioned boxes. Six rounds (B1393 ×5, NEW-1) were spent making
 * that question answer correctly; the seventh round removes the question. See
 * `docs/NOTES-CARRY-FORWARD.md` §5 family 19 and trap 33 for the history — kept there as
 * a record, not as a design this file still has to honour. */

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
            color: "var(--text-secondary)", font: "inherit", fontSize: 10.5, fontWeight: 700, cursor: "pointer",
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
          <span style={{ fontSize: 10.5, fontWeight: 700, lineHeight: 1 }}>{id === "color" ? "A" : "▨"}</span>
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

/* ⛔ NEW-2 (toolbar rebuild) — `forwardRef` + `useImperativeHandle` expose `exportPage`/
 * `printPage` to Notes.jsx's header Export ▾ menu, which sits OUTSIDE this lazy component's
 * own subtree (the module tab row, not the editor pane). This is deliberately NOT the same
 * mechanism the row-context-menu's export/print use (`handleExportPageTree`/
 * `handlePrintPageTree` in Notes.jsx, which read the page back from STORAGE) — this file's
 * own `exportPage`/`printPage` read the LIVE, unsaved `editor` content directly, and
 * `verify-notes-page-growth.mjs` §6 specifically drives THIS toolbar's print path as a
 * separate case from the tree-wide one (a real page-growth bug was once caught only by
 * exercising the live-editor path). A ref through `React.lazy` + `Suspense` works exactly
 * like a ref to any other component, so Notes.jsx just needs to hold one. */
const NoteEditor = forwardRef(function NoteEditor({
  pageId, title, onTitleChange, onTitleCommit, onStatus, onExportMarkdown, onPrintNotice, onSaved,
  scopeLabel, status, updatedAt, searchTerm = "", onClearSearch, notebookPageIds, trail = [],
  projectLabel = null, readOnly = false, readOnlyNote = "",
  /* PHONE DRILL-IN (NEW-1/NEW-2, B849632/B849633) — read by the toolbar (one compact
   * scrollable row instead of wrapping into a column) and by the sheet padding below (clear
   * of the iOS home indicator). The caller (Notes.jsx) is the single source for this — see
   * its own note on reusing B113/B485's `useNarrow()` rather than a third breakpoint. */
  narrow = false,
  /* THE WAY BACK TO THE LIST (B935968) — forwarded straight to `NoteToolbar`, which pins it
   * at the left of its own primary row rather than this file spending a whole band on it
   * (see Notes.jsx's note on why that band is gone). `undefined` on desktop and wherever the
   * caller has nowhere to send it (e.g. it isn't asked for outside `narrow`). */
  onBack,
  /* ⛔ NEW-1 (templates) — the ONE hook that lets a caller other than a page use this exact
   * editor without a second implementation. Both optional; every existing caller (a real
   * page) omits them and gets the untouched `readPage`/`writePage(pageId, …)` behaviour.
   * "Manage templates" is the one caller that supplies them, pointing the same load/save
   * shape at a template record instead of a page's storage key — the editor itself neither
   * knows nor cares which. */
  loadDoc, saveDoc,
  /* ⛔ NEW-2 (toolbar rebuild) — History/Page setup/Find & replace are now TRIGGERED from the
   * module tab row (Notes.jsx's `AppHeader` `toolbarContent`, which sits outside this lazy
   * component entirely), so the open/closed state is LIFTED to the parent and handed in as a
   * plain controlled prop + close callback — the same shape `historyOpen` used to be, just
   * with the toggle button moved out. Panels that need `editor` (all three do) still RENDER
   * here; only the trigger moved. */
  historyOpen = false, onCloseHistory,
  pageSetupOpen = false, onClosePageSetup,
  findReplaceOpen = false, onCloseFindReplace,
}, ref) {
  /* Initial content read ONCE, here. Not in an effect — see fix (2) in the header.
   *
   * ⛔ MIGRATED ON THE WAY IN, NEVER ON THE WAY OUT (NEW-1, then NEW-2). `migrateSketchesToBoxes`
   * converts any retired sketch into real boxes + arrows FIRST, then `migrateFlowBody` bundles
   * any real flow content an old page still carries at its top level into one box — see that
   * file's own header for why the order is load-bearing. Because both run here, before
   * `useEditor`, the migrated shape is simply what the editor STARTS with; neither is a
   * transaction, so `hasUserInputRef` below still gates the first save on a real, trusted user
   * action. */
  const [initialDoc] = useState(() => migrateFlowBody(migrateSketchesToBoxes(
    (typeof loadDoc === "function" ? loadDoc() : readPage(pageId)) || EMPTY_DOC,
  )));
  const [find, setFind] = useState({ term: "", count: 0, index: 0 });
  /* ⛔ NEW-5 — whether DOM focus is currently in the title `<input>`, so the toolbar knows to
   * read/write `titleStyle` instead of the document selection. A plain boolean, not derived
   * from `document.activeElement` on every render: the title is a sibling of this component's
   * own root, so nothing here would re-render when focus moves into or out of it otherwise. */
  const [titleActive, setTitleActive] = useState(false);

  /* The pending snapshot is PLAIN JSON captured at edit time, so the flush never has to
   * ask a possibly-destroyed editor for anything — see fix (1) in the header. */
  const pendingRef = useRef(null);
  /* The version snapshot's own copy of the document. Declared beside `pendingRef` because
   * they are written together and read apart — see the unmount effect further down for the
   * hook-cleanup-order bug that is the whole reason there are two of them. */
  const lastDocRef = useRef(null);
  const timerRef = useRef(0);

  /* ⛔ NEW-1 (B1662464) — "OPENING A NOTE WRITES TO IT." Tiptap's own mount-time schema settle
   * (missing node attrs filled to their defaults, a trailing paragraph inserted by the
   * TrailingNode extension so the cursor has somewhere to land after a table/list) is a REAL
   * doc-changed transaction, and `onUpdate` below could not tell it apart from a keystroke — so
   * opening ANY note stamped `updatedAt` to "now", queued a write, and could mint a "While you
   * were typing" version row (the periodic snapshot effect further down, and the forced one on
   * close) for a page nobody touched. Measured directly with zero browser interaction, across
   * six documents with varied run/mark shapes: every one changed shape and got saved on the
   * very first open.
   *
   * The fix is not a special case for the settle — it is refusing to call ANY of it an edit
   * until something a person actually did says otherwise. `hasUserInputRef` starts false and
   * is set true ONLY by a genuine, browser-trusted DOM event, never by a command, an effect, or
   * anything this component's own code dispatches. `onUpdate` still tracks the live document on
   * every transaction (a real edit is never lost the instant it happens); it just does not
   * queue a write, a dirty status, or a version row until this flips. Listening on `window`
   * rather than this editor's own DOM node is deliberate — the toolbar and its menus render
   * outside the editable body, and a real click there must count too. */
  const hasUserInputRef = useRef(false);
  useEffect(() => {
    const mark = (e) => { if (e.isTrusted) hasUserInputRef.current = true; };
    const opts = { capture: true, passive: true };
    const kinds = ["pointerdown", "keydown", "paste", "drop", "cut"];
    for (const kind of kinds) window.addEventListener(kind, mark, opts);
    return () => { for (const kind of kinds) window.removeEventListener(kind, mark, opts); };
  }, []);

  /* Callbacks land in a ref so `flush` can be referentially stable: an unstable flush would
   * re-register the unmount cleanup and the beforeunload listener on every parent render,
   * which is exactly the kind of churn that made the original ordering bug intermittent. */
  const onStatusRef = useRef(onStatus);
  const onSavedRef = useRef(onSaved);
  const saveDocRef = useRef(saveDoc);
  useEffect(() => { onStatusRef.current = onStatus; onSavedRef.current = onSaved; saveDocRef.current = saveDoc; }, [onStatus, onSaved, saveDoc]);

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
    const ok = typeof saveDocRef.current === "function" ? saveDocRef.current(pending.doc) : writePage(pending.id, pending.doc);
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

  /* ⛔ THE "Empty note discarded" OFFER IS GONE (NEW-9, owner decision 2026-09-08, reversing his
   * own NEW-3 of the day before). It was a correct fix to the wrong problem — it announced the
   * discarding of a box that should never have been created. NEW-8 stops the press creating one,
   * so on that path there is nothing left to announce. `dropEmptyAnchors` keeps its `onDropped`
   * hook (it costs nothing and the command is the only place that knows), with no caller. */

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
      /* ⛔ THE VIEWPORT NO LONGER SCROLLS, SO PROSEMIRROR'S OWN "KEEP THE CARET VISIBLE" CANNOT
       * WORK — AND IF NOTHING REPLACED IT, TYPING PAST THE BOTTOM OF THE WINDOW WOULD WALK THE
       * CARET STRAIGHT OFF THE GLASS (NEW-1, 2026-09-21).
       *
       * ProseMirror finds the nearest scrollable ancestor and adjusts its `scrollTop`; with the
       * mat at `overflow: hidden` there isn't one, so it silently does nothing. This does the
       * same job against the view instead: work out where the caret is in the viewport, and if it
       * is outside the comfortable band, pan the LEAST amount that brings it back.
       *
       * ⛔ IT PANS, IT NEVER ZOOMS, AND IT ONLY EVER MOVES THE MINIMUM. The zoom is the person's
       * choice and nothing typed may change it. Returning `true` tells ProseMirror this was
       * handled so it does not also try. */
      handleScrollToSelection: (view) => {
        const sc = scrollerRef.current;
        if (!sc) return true;
        let caret;
        try { caret = view.coordsAtPos(view.state.selection.head); } catch { return true; }
        if (!caret) return true;
        const box = sc.getBoundingClientRect();
        const pad = 48;                                  // a comfortable band, not the bare edge
        let dx = 0; let dy = 0;
        if (caret.top < box.top + pad) dy = caret.top - (box.top + pad);
        else if (caret.bottom > box.bottom - pad) dy = caret.bottom - (box.bottom - pad);
        if (caret.left < box.left + pad) dx = caret.left - (box.left + pad);
        else if (caret.left > box.right - pad) dx = caret.left - (box.right - pad);
        if (dx || dy) setView({ x: viewRef.current.x + dx, y: viewRef.current.y + dy, z: viewRef.current.z });
        return true;
      },
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
      // ⛔ B1662464 — see `hasUserInputRef`'s own note above. A transaction nobody's keyboard
      // or pointer caused (the mount-time schema settle) updates `lastDocRef` so a REAL edit
      // right after it is never missing context, but it queues nothing: no dirty status, no
      // save timer. The next genuine `onUpdate` — the one a real keystroke causes — runs with
      // this already true and behaves exactly as before.
      if (!hasUserInputRef.current) return;
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
    /* ⛔ …AND IT IS NO LONGER SILENT (NOTES-FREE-PLACEMENT / NEW-3, owner report 2026-09-08:
     * *"it disappears with no animation, no toast, no undo. During review this repeatedly read as
     * 'the create gesture failed' when it had in fact succeeded and then self-destructed."*).
     * The prune is unchanged — it is the answer to four earlier rounds of his own reports — but
     * it now says what it took and offers to put it back exactly where it was. `onEmptyDropped`
     * is deliberately given the box's own coordinates rather than a boolean: an offer to undo
     * that re-created the box somewhere else would be a different bug wearing an apology. */
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
      /** ⛔ B1260000 — the `beforeinput` path a `keydown`-only test can never reach on its own.
       *  A real keypress in Chromium always fires a `keydown` first, so a harness driving the
       *  keyboard can never independently prove the `beforeinput` backstop in `notesBlockKeys.js`
       *  is what actually ran — it could just as easily be `keydown` doing the work with the
       *  backstop sitting dead. This dispatches a SYNTHETIC `beforeinput` directly on the
       *  editor's DOM node — untrusted, so the browser performs no native edit of its own for
       *  it — which exercises ONLY the plugin's `handleDOMEvents.beforeinput`, exactly the event
       *  class his platform is documented to deliver without a usable `keydown`. */
      dispatchBeforeInput: (inputType = "deleteContentBackward") => {
        if (editor.isDestroyed) return;
        const event = new InputEvent("beforeinput", { inputType, cancelable: true, bubbles: true });
        editor.view.dom.dispatchEvent(event);
      },
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
  /* ⛔ B1203505 — closed by default on a phone, so opening a note with headings never
   * launches a full-screen takeover unasked; open by default on a wide pane, unchanged. */
  const [outlineOpen, setOutlineOpen] = useState(() => !narrow);
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
      // ⛔ B1662464 — `docTick` bumps on `selectionUpdate` too (just moving the caret), and on
      // the mount-time schema settle `onUpdate` no longer treats as an edit. Neither is
      // "typing", so neither may mint a row labelled that way.
      if (editor.isDestroyed || !hasUserInputRef.current) return;
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
    // ⛔ B1662464 — `lastDocRef` is written by every `onUpdate`, including the mount-time
    // settle nobody asked for; only force a "when you left the page" row if a real edit ever
    // actually happened in this session.
    if (!hasUserInputRef.current) return;
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

  /* ---- WHAT A VERSION RESTORE IS ALLOWED TO DO TO THIS DOCUMENT (NEW-3)
   *
   * ⛔ IT GOES THROUGH THE EDITOR, NEVER ROUND THE BACK OF IT. Writing this page's JSON to
   * storage while this instance holds the document is a silent-loss bug by construction:
   * the editor's own next save — or its unmount flush — writes its stale copy back over the
   * change. Registered as a real editor operation it becomes an ordinary transaction: in the
   * document, in the undo history, saved by the one save path. */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    /* ⛔ A READ-ONLY VIEW NEVER CLAIMS THE PAGE. The claim exists so a version restore goes
     * THROUGH the open editor rather than round the back of it — and a bin peek can accept
     * neither, so claiming would only let one of several peeked pages take a write meant for
     * the live note. */
    if (readOnly) return undefined;
    return registerOpenNoteDoc(pageId, {
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

  /* ═══ A PRESS ARMS A CARET; THE FIRST KEYSTROKE MAKES THE NOTE (NEW-8) ═══════════════════
   *
   * ⛔ THE OWNER'S MODEL, IN HIS WORDS: *"just because I click outside of the page, it shouldn't
   * automatically open the page up to it. Only once I actually type something."* So a press in
   * the margin puts a CURSOR there and changes nothing else — no node, no page growth, no scroll,
   * and nothing to discard if you wander off. The note comes into existence, and the page grows to
   * contain it, on the first character.
   *
   * ⛔ IT IS OUR OWN CARET, DRAWN, because there is nothing in the document to put a real one in
   * — that is the entire point. The editor still holds FOCUS (it has to receive the keystroke),
   * so its own caret is hidden while this is armed (`data-pending-place` in EDITOR_CSS) and there
   * is exactly one caret on screen.
   *
   * ⛔ WHAT COMMITS AND WHAT CANCELS IS DECIDED BY WHETHER THERE IS CONTENT, not by a key list
   * that will rot. A character or a paste makes a note; anything that produces no content —
   * Escape, Enter, an arrow, Backspace, a click elsewhere — simply forgets the point, silently,
   * because nothing has happened yet and there is nothing to report. */
  const [pendingPlace, setPendingPlace] = useState(null);
  const pendingRef2 = useRef(null);
  pendingRef2.current = pendingPlace;

  const cancelPendingPlace = useCallback(() => {
    setPendingPlace((p) => (p ? null : p));
  }, []);

  /** Turn the armed point into a real box holding `text`. Returns false if nothing was armed. */
  const commitPendingPlace = useCallback((text) => {
    const at = pendingRef2.current;
    if (!at || !editor || editor.isDestroyed) return false;
    setPendingPlace(null);
    /* ⛔ TWO COMMANDS RATHER THAN ONE `content:` ARGUMENT, DELIBERATELY. `addNoteAnchorAt` only
     * puts the caret INSIDE the new box on its no-content path, and a box you have just started
     * typing into must hold the caret — otherwise the second character goes somewhere else. The
     * pair is dispatched synchronously, so ProseMirror's history groups them into ONE undo step;
     * that is asserted rather than assumed in `verify-notes-pending-caret`. */
    editor.commands.addNoteAnchorAt({ x: at.x, y: at.y, w: at.w });
    if (text) editor.commands.insertContent(text);
    return true;
  }, [editor]);

  /* ⛔ THE FIRST KEYSTROKE, CAUGHT BEFORE THE EDITOR SEES IT. Bound on `window` in CAPTURE, for
   * the same reason the rest of this module's global bindings are: the editor's DOM holds focus
   * while a placement is armed, so a keydown bound on the editor would arrive only after
   * ProseMirror had already inserted the character somewhere in the document. Capture on window
   * gets there first, and this handler exists only while something is armed — there is no
   * standing global key binding to leak into ordinary typing (the property
   * `test/notesKeyScope.test.js` sweeps for). */
  useEffect(() => {
    if (!pendingPlace || !editor || editor.isDestroyed) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      /* A shortcut is not typing. Ctrl/Cmd chords keep their ordinary meaning and leave the
       * armed point alone, so Ctrl+Z after an accidental press still undoes what came before. */
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      /* ⛔ A REAL FIELD OUTRANKS AN ARMED CARET. Nothing here is focused (see `placeBlockAt`), but
       * the page title IS a plain input a keystroke can legitimately be meant for — so if focus is
       * sitting in one, the armed point is forgotten and the key is left alone. Without this, the
       * one global binding this module adds would eat a character meant for the title, which is
       * the exact key-leaking family `test/notesKeyScope.test.js` sweeps for. */
      const active = document.activeElement;
      /* ⛔ THE EDITOR ITSELF IS NOT ONE OF THOSE FIELDS, AND EXCLUDING IT IS LOAD-BEARING. The
       * first version of this guard matched any `isContentEditable` element — which is what the
       * editor becomes the moment the FIRST note is committed, because the caret then lives inside
       * it. So every placement after the first one was silently cancelled: press, type, nothing.
       * Caught by the owner's own acceptance harness, whose 20px sweep produced one block instead
       * of sixteen. Only a field OUTSIDE the document outranks an armed caret. */
      const dom = editor.view.dom;
      const inEditor = active === dom || (active instanceof Node && dom.contains(active));
      if (active && !inEditor && (active.tagName === "INPUT" || active.tagName === "TEXTAREA"
        || active.tagName === "SELECT" || active.isContentEditable)) {
        cancelPendingPlace();
        return;
      }
      const printable = e.key.length === 1;
      if (printable) {
        e.preventDefault();
        e.stopPropagation();
        commitPendingPlace(e.key);
        return;
      }
      /* Anything that produces no content forgets the point. Silently: nothing was created, so
       * there is nothing to announce — which is the whole of NEW-9. */
      if (["Escape", "Enter", "Tab", "Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp",
        "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); }
        cancelPendingPlace();
      }
    };
    /* ⛔ A PICTURE PASTED ON THE EMPTY SHEET CREATES A BOX HOLDING IT, AT THE ARMED POINT
     * (NEW-1). Before this, "paste a picture straight in" meant pasting into flow text; with
     * no flow text left, the equivalent gesture is: double-click blank paper to arm a caret
     * (same as for typed text), then paste an image instead of typing. `insertNoteImages`
     * already builds exactly this shape for a DROP (`notesImageNode.js`'s `insertFiles`, given
     * a point) — this reuses it rather than writing a second image-placement path. */
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type?.startsWith("image/"));
      if (files.length) {
        const at = pendingRef2.current;
        setPendingPlace(null);
        e.preventDefault();
        e.stopPropagation();
        if (at) editor.commands.insertNoteImages(files, at);
        return;
      }
      const text = e.clipboardData?.getData("text/plain") || "";
      if (!text) { cancelPendingPlace(); return; }
      e.preventDefault();
      e.stopPropagation();
      commitPendingPlace(text);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("paste", onPaste, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("paste", onPaste, { capture: true });
    };
  }, [pendingPlace, editor, commitPendingPlace, cancelPendingPlace]);

  /* The attribute the stylesheet above keys the hidden native caret off. Written straight to the
   * editor's own element rather than through React, which does not own it. */
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    if (pendingPlace) dom.setAttribute("data-pending-place", "1");
    else dom.removeAttribute("data-pending-place");
  }, [editor, pendingPlace]);

  /* The armed caret is forgotten the moment the note loses focus — closing the tab, clicking the
   * rail, switching page. Nothing was created, so there is nothing to clean up but the drawing. */
  useEffect(() => {
    if (!pendingPlace || !editor || editor.isDestroyed) return undefined;
    const drop = () => cancelPendingPlace();
    editor.on("blur", drop);
    return () => { editor.off("blur", drop); };
  }, [pendingPlace, editor, cancelPendingPlace]);

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
    /* ⛔ A PRESS ARMS A CARET. IT DOES NOT CREATE ANYTHING (NEW-8, owner report 2026-09-08:
     * *"just because I click outside of the page, it shouldn't automatically open the page up to
     * it. Only once I actually type something. And also, if I click somewhere and then don't type
     * anything, I shouldn't get the notice."*).
     *
     * ⛔ THIS SUPERSEDES THE WHOLE PROVISIONAL-BLOCK MECHANISM FOR THIS PATH, and it is a simpler
     * rule than the one it replaces rather than another layer on top. Four earlier rounds fought
     * the consequences of committing a node on the press — an empty box that draws nothing and
     * still takes the press (B357008), a prune at the storage seam to stop one reaching a file
     * (`notesAnchorPrune.js`), and finally a toast to admit the prune had happened (B1370546).
     * Every one of those exists only because the node was created too early. Nothing is created
     * now until there is something to put in it, so: no empty box, nothing to prune on this path,
     * nothing to announce, and no page growth for a pointer that merely went somewhere.
     *
     * The point is remembered, a caret is drawn there, and `commitPendingPlace` below turns it
     * into a real box on the first character. A press that types nothing leaves the document
     * BYTE-IDENTICAL — which is the property `verify-notes-anchor-soak` has always asserted, now
     * true by construction instead of by cleanup. */
    /* The caret is drawn in the MAT's own frame, so its position is captured here — at the moment
     * of the press, from the press's own coordinates — rather than re-derived later from document
     * space. Nothing grows or reflows on a press any more (that is NEW-8's whole point), so this
     * reading cannot go stale between arming and the first keystroke. Its height is the editor's
     * real line height, read from the browser, so the caret matches the text it is about to make
     * at any zoom and any type size. */
    const mat = noteRootRef.current?.querySelector('[data-testid="note-mat"]');
    const matRect = mat?.getBoundingClientRect();
    const lineH = Math.round(parseFloat(getComputedStyle(dom).lineHeight) || 0)
      || Math.round(parseFloat(getComputedStyle(dom).fontSize) * 1.2) || 18;
    const caret = matRect
      ? { left: Math.round(clientX - matRect.left), top: Math.round(clientY - matRect.top - lineH / 2), height: lineH }
      : null;
    if (!caret) return;                       // unmeasured — never guess where to draw a caret
    setPendingPlace({ ...point, caret });
    /* ⛔ AND IT DELIBERATELY DOES NOT FOCUS THE EDITOR (NEW-10). The first version called
     * `dom.focus({ preventScroll: true })` here so the keystroke would reach ProseMirror — and
     * MEASURED, on a long scrolled note, that press moved the view from scrollTop 500 to 138 and
     * pulled the title back on screen. `preventScroll` is not honoured for this contenteditable in
     * Chromium, so focusing it scrolls it into view, which is precisely the defect being fixed.
     * Nothing needs focus: the keystroke is caught by a capture listener on `window` while a
     * placement is armed, and the commands that build the note do not require the editor to be
     * focused. The caret lands inside the new box at commit time — with scrolling declined there
     * too. */
  }, [editor]);

  /* ⛔ `focusEndOfSheet` IS GONE (NEW-1, 2026-09-22) — it answered "where does the flow
   * document end", and there is no flow document to end. Clicking below whatever is on the
   * sheet is now ordinary blank space, exactly like clicking beside it: see `focusFromMat`'s
   * blank-space branch below, which is the one path every such press now reaches. */

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

  /* ═══ CLICK-TO-CONNECT — THE OTHER WAY TO DRAW AN ARROW (NEW-2) ═══════════════════════════
   *
   * ⛔ THREE STATES, THE SAME SHAPE SKETCH MODE'S OWN `connecting` USED: `null` (off) ·
   * `{ from: null }` (armed — the "+ Arrow" button was pressed, waiting for the box the arrow
   * starts from) · `{ from: id }` (waiting for the box it points to). Kept as its OWN piece of
   * state rather than folded into `selection`/`editingId` — connecting two boxes is not the
   * same act as selecting one, and conflating them is exactly the mistake B434416 already
   * un-did once for select-vs-edit. */
  const [arrowConnect, setArrowConnect] = useState(null);
  const arrowConnectRef = useRef(null);
  arrowConnectRef.current = arrowConnect;

  const toggleArrowMode = useCallback(() => {
    setArrowConnect((prev) => (prev ? null : { from: null }));
  }, []);

  /* Escape cancels click-to-connect, from anywhere — the same standing exemption Escape
   * already has everywhere else in this module (`UNGATED_KEYS`, notesKeyScope.js). */
  useEffect(() => {
    if (!arrowConnect) return undefined;
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); setArrowConnect(null); } };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [arrowConnect]);

  /* ---- THE PAGE SITS ON A BLUEBEAM-STYLE WORKSPACE (NEW-1, owner report 2026-09-21) --------
   *
   * ⛔ THIS REPLACES THE CSS-`zoom` TEXT-SIZE CONTROL (B342994, `lib/notesZoom.js`, now deleted),
   * IT DOES NOT SIT BESIDE IT — and that is a deliberate product decision, not a refactor.
   *
   * The old control scaled the SHEET with CSS `zoom` while the sheet kept `width: 100%` of the
   * pane, so zooming in made the letters bigger and the page stayed the same width on screen:
   * the text RE-WRAPPED to fewer characters per line. That is a reading-size control, and it is
   * a genuinely useful one — but it is the opposite of what was asked for here. Bluebeam's zoom
   * makes the PAGE bigger and you move around it; line breaks never change, because the document
   * is a fixed thing you are looking at from closer up. Keeping both would mean two things
   * scaling on one gesture, which `notesZoom.js`'s own header already argued against for the
   * browser's zoom. So: replaced, and Ctrl+wheel / Ctrl+= / Ctrl+− / Ctrl+0 all keep working —
   * they now move the canvas rather than the type size, and Ctrl+9 fits the page.
   *
   * ⛔ THE VIEW IS A REF, NOT REACT STATE, AND THAT IS LOAD-BEARING TWICE OVER.
   * (a) A pan writes one `transform` string and nothing re-renders — no memo recomputes, no
   *     measurement effect runs, no reconciliation happens. That is VIEW-INDEPENDENT-ONCE
   *     satisfied by construction rather than by a memo key a later edit can poison.
   * (b) React never owns the workspace layer's `transform`, so a re-render from any other cause
   *     cannot silently throw the view away. `applyView()` is the ONE writer, and a layout effect
   *     re-asserts it after every render, before paint.
   *
   * ⛔ `view.x`/`view.y` ARE `scrollLeft`/`scrollTop` WITHOUT THE CLAMP — same sign, same units,
   * same meaning. Every computation below that used to reason in scroll terms keeps its
   * arithmetic; the only thing that disappears is the bound, which is exactly the bug family
   * NEW-2 has been fighting for three rounds. See `lib/notesViewport.js`'s header. */
  const viewRef = useRef(normalizeView({ x: 0, y: 0, z: VIEW_ZOOM_DEFAULT }));
  const workspaceRef = useRef(null);
  /* The level the indicator shows. The ONLY part of the view that is React state, so a pan
   * re-renders nothing at all and a zoom re-renders exactly one label. */
  const [zoomPct, setZoomPct] = useState(VIEW_ZOOM_DEFAULT);
  const scrollerRef = useRef(null);
  const noteRootRef = useRef(null);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;
  /* ---- THE ONE WRITER OF THE VIEW -----------------------------------------------------------
   *
   * ⛔ EVERY CHANGE TO THE VIEW GOES THROUGH `applyView`, and `applyView` is the only thing in
   * this file that writes the workspace layer's `transform`. That is what makes the view
   * impossible to lose: nothing else sets it, so nothing else can clear it, and the layout effect
   * below re-asserts the current value after every React render, before paint.
   *
   * ⛔ `transform-origin: 0 0` AND THE TRANSLATE BEFORE THE SCALE. Written in this order the
   * mapping is exactly `screen = workspace * z − view`, which is the one rule stated in
   * `notesViewport.js`'s header and the only one any caller has to know. Reversing them (or
   * moving the origin) silently changes what `view.x` means and every coordinate read in this
   * file would have to be re-derived. */
  const applyView = useCallback(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const v = viewRef.current;
    el.style.transform = `translate(${-v.x}px, ${-v.y}px) scale(${v.z})`;
  }, []);

  /* Re-assert after every render — a React re-render rebuilds the inline style object and would
   * otherwise drop a transform React does not know about. */
  useLayoutEffect(applyView);

  const viewPersistRef = useRef(null);
  /** Persist the view, coalesced. A pan writes on every frame and storage is not a per-frame
   *  resource; the view is a preference, so losing the last few pixels of it on a hard close
   *  costs nothing. */
  const persistView = useCallback(() => {
    if (viewPersistRef.current) clearTimeout(viewPersistRef.current);
    viewPersistRef.current = setTimeout(() => {
      viewPersistRef.current = null;
      if (pageIdRef.current) writeNoteView(pageIdRef.current, viewRef.current);
    }, 400);
  }, []);
  useEffect(() => () => { if (viewPersistRef.current) clearTimeout(viewPersistRef.current); }, []);

  /** Set the view. `next` is a whole view; the label state is updated only when the LEVEL
   *  actually changed, so a pan re-renders nothing. */
  /* ⛔ `byUser` IS WHAT STOPS THE OPENING FRAMING FIGHTING THE PERSON. Every route into this
   * function except the first framing itself is something they did, and the moment one of them
   * lands the page stops being re-framed for them — see `framedForRef` below. */
  const viewTouchedRef = useRef(false);
  const setView = useCallback((next, { persist = true, byUser = true } = {}) => {
    const v = normalizeView(next);
    const was = viewRef.current;
    viewRef.current = v;
    if (byUser) viewTouchedRef.current = true;
    applyView();
    if (v.z !== was.z) setZoomPct(v.z);
    if (persist) persistView();
  }, [applyView, persistView]);

  /** The viewport's own box — the element the view is expressed relative to. */
  const viewportRect = useCallback(() => scrollerRef.current?.getBoundingClientRect() || null, []);

  /* ⛔ THE FIRST FRAMING, AND THE ONE STORED VIEW IT DEFERS TO (NEW-1, 2026-09-21).
   *
   * An unbounded workspace has no natural rest position, so a page opened with the identity view
   * would sit flush in the viewport's top-left corner with no blank paper to its left — the exact
   * "there is nowhere to double-click and nowhere to drop a box" complaint the mat's gutter used
   * to exist to prevent (see B1385024's own history). The gutter is gone; this is what replaces
   * it, and it is strictly better: it is a starting POSITION, not a permanent reserved margin, so
   * the person can pan straight past it and it never has to be recomputed when the page's width
   * changes.
   *
   * ⛔ IT RUNS ONCE PER PAGE AND NEVER AGAIN, which is the whole point. Re-framing on a width
   * change (or on any later render) would be a view move the person did not ask for — and "the
   * view itself stays exactly where it is" is a third of the owner's own sentence about what a
   * width drag must not disturb. `framedForRef` holds the page id it has already framed. */
  const framedForRef = useRef(null);
  const framedSizeRef = useRef(null);
  useLayoutEffect(() => {
    const rect = viewportRect();
    const sheet = noteRootRef.current?.querySelector('[data-testid="note-sheet"]');
    if (!rect || !sheet || !rect.width) return;          // not measured yet — try again next render

    /* A different page always gets a fresh framing. */
    if (framedForRef.current !== pageId) {
      framedForRef.current = pageId;
      framedSizeRef.current = null;
      viewTouchedRef.current = false;
      /* A view this person already left on this page wins outright — including one panned far off
       * the page, which is a place they chose. */
      const stored = readNoteView(pageId);
      if (stored) {
        viewTouchedRef.current = true;                   // their view; never re-frame over it
        setView(stored, { persist: false, byUser: false });
        return;
      }
    }
    /* ⛔ AND IT KEEPS RE-FRAMING UNTIL THE PAGE STOPS CHANGING SIZE — but only while the person
     * has not touched the view. This is not belt-and-braces; the first render genuinely cannot
     * frame correctly. Measured: the very first layout pass reports the sheet at the UNPINNED 580
     * wide and 145 tall (the document has not laid out and the width pin has not been read yet),
     * so a once-only framing centres the page against numbers that are about to change, and it
     * opens visibly off-centre and too far down — 594 where 664 was correct.
     *
     * The moment they pan, zoom or type, `viewTouchedRef` latches and this never runs again: a
     * view that keeps re-centring itself under somebody who is reading is far worse than one that
     * opens a little late. */
    if (viewTouchedRef.current) return;
    /* ⛔ AND NEVER WHILE A GRIP DRAG IS IN FLIGHT. A width drag changes the sheet's size on every
     * frame, which is exactly the signal this effect follows — so without this guard the framing
     * re-centres the page under the pointer for the whole gesture. Measured before the guard
     * existed: every widen moved the content by EXACTLY HALF the drag (a 150px left widen moved
     * the body 75px), which is the unmistakable fingerprint of a re-centre rather than of any
     * compensation bug. That is the mechanism the `viewTouchedRef` latch below closes for good;
     * this is the belt to its braces, because a drag that somehow began before the latch would
     * otherwise reproduce the whole defect class from a completely new door. */
    if (widthDragRef.current || heightDragRef.current) return;
    const r = sheet.getBoundingClientRect();
    const z = viewRef.current.z || 1;
    /* ⛔ THE PAGE'S OWN WORKSPACE ORIGIN, NOT (0, 0) — and assuming zero was a real defect. A page
     * carrying a blank left margin sits at `sheetX = −margin`, so framing a box at the origin put
     * it exactly one margin too far left: measured, a reloaded 780px page (200 of it margin)
     * opened at screen x=294 where 494 was correct. Reading the sheet's real rect back through the
     * live view is what makes this impossible to get wrong again — it is the DOM's answer, not a
     * re-derivation of where the app meant to put it. */
    const origin = toWorkspace(viewRef.current, { x: r.left - rect.left, y: r.top - rect.top });
    const size = {
      x: Math.round(origin.x),
      y: Math.round(origin.y),
      width: Math.round(r.width / z),
      height: Math.round(r.height / z),
    };
    const last = framedSizeRef.current;
    if (last && last.width === size.width && last.height === size.height
      && last.x === size.x && last.y === size.y) {
      /* ⛔ SETTLED — AND THIS IS WHERE THE FRAMING LATCHES OFF FOR GOOD. Two consecutive passes
       * agreeing on the page's size means the document has laid out, so the opening framing has
       * done its job. Everything after this is the person's view, and a page that re-centres
       * itself later — on a width change, a preset pick, a box being placed — is the "the whole
       * page jumped" complaint this module has already paid for twice (B1203504, NOTES-PAGE-GROWTH).
       * Latching here is what makes "the view itself stays exactly where it is" true by
       * construction rather than by each caller remembering not to disturb it. */
      viewTouchedRef.current = true;
      return;
    }
    framedSizeRef.current = size;
    setView(frameView({ viewport: rect, page: size, zoom: VIEW_ZOOM_DEFAULT }),
      { persist: false, byUser: false });
  });

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
   * It is stamped outside the undo history — see the command's own note.
   *
   * ⛔ AND NOTHING IS "BROUGHT BACK ONTO THE PAGE" ANY MORE (NOTES-FREE-PLACEMENT). The
   * `repairOffPageAnchors` call that used to sit here dragged every negative coordinate back to
   * the page's top-left corner on every load; negative coordinates are now ordinary positions and
   * the SHEET grows to hold them, so repairing one would silently move a box off the spot the
   * owner put it on — through a transaction that saves. See the retired command's note in
   * `lib/notesAnchorNode.js`. The identity repair is untouched. */
  useEffect(() => {
    if (!editor || editor.isDestroyed || readOnly) return;
    editor.commands.ensureNoteAnchorIds();
  }, [editor, readOnly, docTick]);

  /* ⛔ THE RECOVERY PASS FOR AN ALREADY-SQUEEZED TABLE (NEW-2, owner report 2026-09-11).
   *
   * ⛔ ONCE ON MOUNT, DELIBERATELY NOT KEYED ON `docTick` — unlike `ensureNoteAnchorIds` just
   * above, which is idempotent bookkeeping that cannot conflict with anything the owner does.
   * This one edits width data a later undo can legitimately want to revert, so re-running it on
   * every doc change fought Ctrl+Z: reverting a drag left the OTHER columns explicit (from this
   * effect's own earlier, non-history pass), which reads as "touched, one column null" and
   * re-triggered the SAME repair, silently refilling the column the owner had just undone. Every
   * LIVE edit (including a resize) is instead covered by `NoteTableColumns`'s own
   * `appendTransaction` plugin, which rides the SAME undo step as its trigger — see
   * lib/notesTableColumns.js's header for the full reasoning. This effect's only remaining job is
   * the note nobody edits after opening: without it, a table that is merely looked at and never
   * touched would stay squeezed. */
  useEffect(() => {
    if (!editor || editor.isDestroyed || readOnly) return;
    editor.commands.normalizeTableColumnWidths();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, readOnly]);

  /* ⛔ THE SELECTION IS VISIBLE, and it is painted onto the real elements rather than mirrored
   * into a second render tree. A selection you cannot see is a selection you will move by
   * accident — and re-rendering every box through React to show a ring would remount node views
   * the editor owns, which is a different and worse bug. */
  /* ⛔ A REAL CARET MOVE AWAY FROM A SELECTED/EDITED BOX RELEASES IT (B1555152 part 2, owner
   * report 2026-09-11: "even the ASDS click isn't really working that well… sometimes it takes a
   * double click, sometimes it takes a click, it's actually kinda odd").
   *
   * Measured live: enter a box (stage 2), type a word, then click an ORDINARY paragraph elsewhere
   * on the page — the caret correctly moves there, but `selection`/`editingId` never cleared, so
   * the box stayed painted with its selected ring AND its `data-editing` attribute. Click that
   * same box again — since `alreadySelected` in `focusFromMat` reads straight off that stale
   * state, ONE click now lands directly in stage 2 and enters text, where an untouched box still
   * needs two. Same gesture, two different outcomes, purely from invisible history — which is
   * exactly his "sometimes a click, sometimes a double click."
   *
   * The fix lives HERE, in the transaction-driven paint pass, not in `focusFromMat`'s click
   * routing: whenever the LIVE caret position genuinely changes (a real transaction, not merely
   * this same effect re-running because `selection`/`editingId` changed) and lands somewhere that
   * is not inside a currently-selected box, the selection is released. `lastCaretPosRef` is the
   * ONLY state this needs — comparing consecutive readings of `editor.state.selection.from` tells
   * a genuine move (the user clicked/typed elsewhere) apart from this same paint firing again for
   * an unrelated reason (a resize, a group drag, a re-render) with the caret exactly where it was. */
  const lastCaretPosRef = useRef(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const paint = () => {
      if (editor.isDestroyed) return;
      for (const el of editor.view.dom.querySelectorAll(".planyr-anchor")) {
        const id = String(el.getAttribute("data-anchor-id"));
        const on = selection.has(id);
        if (on) el.setAttribute("data-selected", "1"); else el.removeAttribute("data-selected");
        /* ⛔ AND WHICH BOX THE CARET IS ACTUALLY IN (NOTES-FREE-PLACEMENT / NEW-2) — the second
         * stage of the same model, painted the same way and for the same reason. The stylesheet
         * needs it to show a text cursor rather than a grab cursor on the one box a press is
         * about words in. It is read from `editingRef` rather than `editingId` because this
         * paint also runs from the editor's own transaction handler, outside React's render. */
        if (String(editingRef.current || "") === id) el.setAttribute("data-editing", "1");
        else el.removeAttribute("data-editing");
        /* ⛔ THE ARROW'S SOURCE BOX, HIGHLIGHTED WHILE CLICK-TO-CONNECT IS WAITING FOR THE
         * SECOND CLICK (NEW-2) — the visual feedback the acceptance bar asks for, painted the
         * same way and for the same reason as `data-selected`/`data-editing` above. */
        if (arrowConnectRef.current?.from === id) el.setAttribute("data-arrow-source", "1");
        else el.removeAttribute("data-arrow-source");
      }
      const curPos = editor.state.selection.from;
      const moved = lastCaretPosRef.current !== null && curPos !== lastCaretPosRef.current;
      lastCaretPosRef.current = curPos;
      if (moved && (editingRef.current || selRef.current.size)) {
        const anchorPos = anchorPosAtSelection(editor.state);
        const node = anchorPos != null ? editor.state.doc.nodeAt(anchorPos) : null;
        const stillSelected = node && selRef.current.has(String(node.attrs.aid || ""));
        if (!stillSelected) {
          setEditingId(null);
          setSelection(new Set());
        }
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
  }, [editor, selection, editingId, docTick, arrowConnect]);

  const clearSelection = useCallback(() => {
    setSelection((s) => (s.size ? new Set() : s));
    setEditingId(null);
  }, []);

  /**
   * The blank-page gesture, from press to release.
   *
   * ⛔ IT IS ONE HANDLER FOR ALL THREE OUTCOMES, deliberately. Two handlers racing to decide what a
   * press meant is precisely the shape that made this gesture behave differently depending on
   * invisible state, four rounds running — and a pan is the third claimant on the same press, not
   * a separate feature that happens to live nearby.
   *
   * ⛔ THE THIRD MEANING (NEW-1, owner: *"Click and drag should move like you're on a map"*). A
   * press that travels with NO modifier now PANS; with Shift it still draws the rubber band
   * (NEW-2, *"shift click and drag should select multiple items"*). The press that does not travel
   * is untouched in every respect — same threshold, same `placeBlockAt`, same byte-identical
   * document when it is abandoned — which is the property `verify-notes-anchor-soak` has always
   * asserted and the one thing this change was most able to break.
   *
   * ⛔ THE PAN IS THE SCROLLER'S OWN OFFSETS, NOT A TRANSFORM. Three reasons, all of them things
   * that would otherwise have to be re-solved: it cannot fight the wheel (it IS the wheel's
   * mechanism), it cannot invent room past the ends (a scroll offset clamps), and it leaves the
   * sheet's own growth/centring measurements — every one of which reads `scrollLeft` — looking at
   * the same number they always did. A transform would have needed its own extents, its own
   * reconciliation with `beginWidthDrag`'s scroll compensation, and its own answer for what
   * `scrollLeft` means afterwards.
   *
   * ⛔ AND IT FOLLOWS THE POINTER FROM THE PRESS, not from where the slop was crossed. The 4px
   * deadzone delays the start; it does not offset the canvas from the hand for the rest of the
   * gesture. (Leaflet does the same, for the same reason.)
   */
  const beginBlankGesture = useCallback((e, { place = true } = {}) => {
    const f = frame();
    const from = toDoc(e.clientX, e.clientY);
    if (!f || !from) return false;
    const startClient = { x: e.clientX, y: e.clientY };
    /* ⛔ READ ONCE, AT THE PRESS. See `gestureOutcome`'s own note on why this is never re-read. */
    const shift = e.shiftKey;
    /* ⛔ THE PAN BASELINE IS THE VIEW, NOT A SCROLL POSITION (NEW-1). Same shape, same sign, and
     * the one difference is that it cannot run out: `panTarget`'s `maxLeft`/`maxTop` clamp is
     * gone because there is no edge to clamp to on an unbounded workspace, and the 0 floor with
     * it — panning to a NEGATIVE view is how you look at the blank paper above and to the left of
     * the page, which is exactly what Bluebeam does and what the owner asked for. */
    const startView = { ...viewRef.current };
    /* ⛔ THE SELECTION AS IT STOOD AT THE PRESS, frozen. Reading `selRef.current` on every move
     * instead — which is what the additive path used to do — makes the band STICKY: a box swept
     * up and then swept back out of a shrinking band stays selected, because the previous frame's
     * answer is the next frame's input. Against a frozen baseline the band is honest in both
     * directions, and a plain Shift-drag (nothing selected yet) is simply a replace. */
    const baseSelection = new Set([...selRef.current].map(String));
    /* What this gesture has committed to. `null` until it travels; never goes back. */
    let latched = null;

    const setPanning = (on) => {
      const mat = scrollerRef.current;
      if (mat) {
        if (on) mat.setAttribute("data-panning", "1");
        else mat.removeAttribute("data-panning");
      }
      /* The pointer can leave the mat mid-pan (over the toolbar, the rail, the window chrome).
       * `cursor` is an inherited property, so body carries the glyph everywhere the mat's own
       * rule does not reach. Same shape as `beginWidthDrag`'s col-resize. */
      document.body.style.cursor = on ? "grabbing" : "";
      document.body.style.userSelect = on ? "none" : "";
    };

    const onMove = (ev) => {
      const at = { x: ev.clientX, y: ev.clientY };
      const was = latched;
      latched = latchGesture(latched, startClient, at, { shift });
      if (!latched) return;                          // still inside the slop — nothing has happened
      if (latched === "pan") {
        if (!was) setPanning(true);
        setView({
          x: startView.x - (at.x - startClient.x),
          y: startView.y - (at.y - startClient.y),
          z: startView.z,
        });
        return;
      }
      const to = toDoc(at.x, at.y);
      if (!to) return;
      const rect = marqueeRect(from, to);
      setBand(rect);
      setSelection(applyMarquee(baseSelection, boxesInMarquee(rect, boxesNow()), { additive: true }));
    };

    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setBand(null);
      setPanning(false);
      /* ⛔ THE LATCH, NOT A FRESH READING AT MOUSE-UP. A pan returned to its own origin measures
       * zero travel, and asking the distance again here would call that a press and leave a note
       * behind at the end of every round trip. See `latchGesture`. */
      if (latched) return;                           // panned or selected; place nothing
      /* ⛔ BELOW THE THRESHOLD THIS IS A CLICK. It always clears the selection (NEW-1: "single
       * click on empty sheet deselects"); it places a box only when `place` says this stationary
       * press was the SECOND of a genuine double click — `focusFromMat` decides that from the
       * press itself, before the gesture even starts, since a travelling press never reaches
       * here at all. */
      clearSelection();
      if (place) placeBlockAt(ev.clientX, ev.clientY);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return true;
  }, [frame, toDoc, boxesNow, placeBlockAt, clearSelection, setView]);

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
   * the page title can still be typed in and arrowed through — nothing more (B1555152 ×3, see
   * `formFieldOwnsTheKey`'s own header in lib/notesKeyScope.js for the full reasoning and the
   * production failure that produced it). This used to also decline whenever ANY contenteditable
   * held focus (`bindingShouldDecline`, built for NEW-ARROWS below) — correct in the two states
   * that were measured for that fix, but it made this binding's correctness depend on
   * `editor.commands.blur()` reliably moving focus away the instant a box is selected. On the
   * owner's real signed-in Chrome that blur did not stick — `data-selected="1"` fired, but
   * `document.activeElement` stayed the editor and a STALE selection survived — and because
   * merely HAVING a contenteditable focused was enough on its own to decline, Backspace edited
   * the stale position instead of deleting the selected box. This binding no longer needs that
   * signal to be reliable: `NoteEditor.jsx`'s own transaction-driven `paint` effect (B1555152
   * part 2, above) already tracks the LIVE caret position directly and releases a box's
   * selection the instant it genuinely moves — which is exactly what a click into flow text
   * (NEW-ARROWS's own case) does, so the caret still correctly wins there; it just no longer
   * depends on blur() having worked to get that answer. */
  useEffect(() => {
    if (!selection.size) return undefined;
    const onKey = (e) => {
      if (UNGATED_KEYS.has(e.key)) { selectionKeyDown(e); return; }
      if (formFieldOwnsTheKey()) return;
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
  /* The previous press on blank paper inside the sheet, so the pair can be reconstructed when the
   * browser does not raise a native double-click of its own (see `isBlankDoublePress`). */
  const lastBlankPressRef = useRef(null);

  const focusFromMat = useCallback((e) => {
    if (!editor || editor.isDestroyed) return;
    const el = e.target;
    if (!(el instanceof Element)) return;
    /* ⛔ ANY PRESS FORGETS AN ARMED CARET (NEW-8), and that has to run BEFORE the
     * input/textarea/etc bail below — not after (B1683298, found chasing an unrelated
     * sketch-mode bug). A node view can embed its own real `<input>` inside the document (a
     * sketch box's label field, e.g.) — pressing it IS a press inside the mat, and this
     * function's own comment already says "ANY press forgets an armed caret," but the early
     * return used to skip that call whenever the target happened to be one of these embedded
     * controls, so a stray placement caret armed by an earlier, unrelated click on blank
     * note-body space survived untouched. The very next character typed into that box was then
     * hijacked by the window-level "first keystroke" handler above and created an unrelated
     * anchored block instead — measured directly, reproducing exactly that. `cancelPendingPlace`
     * is side-effect-free beyond clearing that one piece of state, so calling it unconditionally
     * changes nothing about how the input itself handles the press. */
    cancelPendingPlace();
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
    /* ⛔ A NODE THAT OWNS ITS OWN GESTURES KEEPS THEM. A picture and an attachment are objects
     * you select rather than page you write on. The mat claiming those presses would put an
     * anchored block ON TOP of one. ⛔ SKETCH MODE'S OWN VERSION OF THIS GUARD IS GONE (NEW-2,
     * 2026-09-22) — there is no longer a second kind of node with its own double-click to
     * protect; a box is the only thing on the page besides plain content now. */
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
     * guard clause swallowing it before the chrome could ever be armed. */
    if (!inBlock && el.closest(".planyr-note-image, .planyr-note-file")) return;

    if (inBlock) {
      /* ⛔ CLICK-TO-CONNECT TAKES THE PRESS FIRST, BEFORE ANY OF THE ORDINARY BOX LOGIC BELOW
       * (NEW-2). While armed, a press on a box is never about selecting or editing it — it is
       * naming an arrow endpoint. First box clicked becomes the source; a second, DIFFERENT box
       * completes the arrow and exits the mode; clicking the source again is a no-op reminder
       * (matching sketch mode's own "That is the box the arrow starts from" behaviour) rather
       * than a silent do-nothing. */
      if (arrowConnectRef.current) {
        e.preventDefault();
        e.stopPropagation();
        const id = inBlock.getAttribute("data-anchor-id");
        if (!id) return;
        if (arrowConnectRef.current.from == null) {
          setArrowConnect({ from: id });
        } else if (arrowConnectRef.current.from !== id) {
          editor.commands.addNoteArrow(arrowConnectRef.current.from, id);
          setArrowConnect(null);
        }
        return;
      }
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
        /* ⛔ SEE THE STAGE-1 COMMENT BELOW — the same stale-caret hazard applies to an additive
         * shift-click, so it gets the same blur. */
        if (editor && !editor.isDestroyed) editor.commands.blur();
        return;
      }
      if (id && selRef.current.has(String(id)) && selRef.current.size > 1) {
        if (beginGroupDrag(e, id)) return;
      }
      if (id) {
        const alreadySelected = selRef.current.has(String(id)) && selRef.current.size === 1;
        if (!alreadySelected) {
          /* Stage 1. Nothing is typed and no caret moves — this press is about the BOX.
           *
           * ⛔ AND THE EDITOR MUST BE BLURRED HERE, NOT LEFT AS IT WAS (B1555152, owner report
           * 2026-09-11: *"I clicked after 'Civil Engineer: ', then clicked one of his margin
           * boxes, then pressed Backspace, and it backspaced the Civil Engineer line."*).
           *
           * `e.preventDefault()` stops the browser's OWN click from moving the caret — which is
           * correct, stage 1 is about the box, not the words — but it does nothing about a caret
           * that was ALREADY sitting in ordinary flow text before this press. Left alone,
           * `document.activeElement` stays the ProseMirror div and `document.getSelection()`
           * stays anchored at that stale, pre-click position. `notesKeyScope.js`'s
           * `readCaretScope` cannot tell that apart from a live, current caret — both report
           * `activeEditable`/`caretInEditable` true — so `selectionKeyDown`'s own Delete/Backspace
           * handling below DECLINES (believing the caret owns the key), and the keystroke falls
           * through to the browser's native contenteditable handling, which edits wherever that
           * stale selection still is. Measured live: click into "Civil Engineer: …", click an
           * unselected box once, press Backspace — a letter vanished from "Civil Engineer",
           * never touching the box.
           *
           * Blurring here is the same move `selectionKeyDown`'s own Escape handler already makes
           * when backing OUT of a box to "selected" (`editor.commands.blur()`) — box-selected is
           * already treated as "not really in the document" everywhere else in this file; this
           * closes the one entry into that state that forgot to say so. Afterward
           * `document.activeElement` is no longer the editor, `readCaretScope` correctly reports
           * no live caret, and Delete/Backspace reach `selectionKeyDown`, which removes the
           * SELECTED BOX — exactly what B434416 asked for. A later, genuine click into flow text
           * still refocuses the editor and moves the selection for real, so NEW-ARROWS's own fix
           * (arrows belong to a freshly-placed caret) is unaffected. */
          e.preventDefault();
          setEditingId(null);
          setSelection(new Set([String(id)]));
          if (editor && !editor.isDestroyed) editor.commands.blur();
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
      /* ⛔ A PRESS NEVER SCROLLS THE VIEW (NEW-10, owner report 2026-09-08: *"when I do click
       * elsewhere, it moves the whole screen, and it shouldn't do that at all"* — he watched the
       * mat scroll the page title off the top after placing something). Tiptap's `focus()` calls
       * `tr.scrollIntoView()` by default, which drags the scroller to wherever the caret lands;
       * on a page with a box placed far outside the column that is a long way. The caret still
       * goes where it was put — only the scrolling is declined, on every press-driven path. */
      if (Number.isFinite(pos)) editor.chain().focus(null, { scrollIntoView: false }).setTextSelection(pos + 1).run();
      else editor.commands.focus(null, { scrollIntoView: false });
      return;
    }

    /* ⛔ BLANK SPACE — THE WHOLE SHEET AND THE WHOLE MAT ARE ONE PLACEMENT SURFACE NOW (NEW-1,
     * 2026-09-22, owner direction: "I just want the double-click thing. I don't need it to
     * tell me where to put my paragraph."). There is no flow text left to be "beside", so
     * there is nothing left to hit-test against and nowhere this press can mean anything but
     * "the box, if any, under it" (handled above) or "open page, right here".
     *
     * ⛔ A SINGLE CLICK DESELECTS; ONLY A GENUINE DOUBLE CLICK PLACES. A press that TRAVELS is
     * still a marquee or a pan — `beginBlankGesture` owns that, unchanged, and is not gated on
     * the double-click test below, because a rubber-band drag is a single, ordinary gesture in
     * every other canvas tool. A press that does NOT travel is a click, and only the SECOND
     * click of a pair — native (`e.detail >= 2`) or reconstructed (`isBlankDoublePress`, since
     * two real down/up pairs do not always raise a native `dblclick`; see carry-forward trap
     * 32) — creates anything. `beginBlankGesture` is told which of the two a stationary press
     * should become. */
    /* ⛔ A PRESS ON BARE CANVAS CANCELS CLICK-TO-CONNECT (NEW-2), matching sketch mode's own
     * rule. Armed-but-nothing-picked or source-already-picked, either way a press that is not
     * on a box means "never mind". */
    if (arrowConnectRef.current) {
      e.preventDefault();
      e.stopPropagation();
      setArrowConnect(null);
      return;
    }
    const press = { t: e.timeStamp || Date.now(), x: e.clientX, y: e.clientY };
    const doublePress = e.detail >= 2 || isBlankDoublePress(lastBlankPressRef.current, press);
    lastBlankPressRef.current = doublePress ? null : press;   // consumed, or the new "previous"
    e.preventDefault();
    e.stopPropagation();
    /* `beginBlankGesture` owns the travel-vs-click decision (unchanged, and independent of
     * `doublePress`); `place` tells its own click branch whether a stationary press should
     * place a box or merely clear the selection. A `false` return means the gesture's own
     * geometry could not be measured at all — the same defensive fallback the placement path
     * has always had, now equally gated on this being a genuine double click. */
    if (!beginBlankGesture(e, { place: doublePress }) && doublePress) placeBlockAt(e.clientX, e.clientY);
  }, [editor, placeBlockAt, beginBlankGesture, beginGroupDrag, clearSelection, cancelPendingPlace]);


  /* ⛔ `sheetGrowWidth` IS GONE (NEW-2, 2026-09-21) — `sheetWidth` replaces it outright. The old
   * name meant "an override for the sheet's `maxWidth`/`width`, or `null` for the unpinned 100%
   * default", which only made sense while the sheet was a flex child sized as a percentage of a
   * scroller's content box. A card absolutely positioned on a workspace always has one real
   * width, so there is no null case and no override to distinguish from a default. */
  /* ⛔ AND THE OTHER TWO DIRECTIONS (NOTES-FREE-PLACEMENT / NEW-1, owner report 2026-09-08).
   * Growth right and down shipped; left and up were CLAMPED, so a box dragged 434px past the
   * page's left edge landed at `left: 4px` with the page still 580 wide, while the identical
   * gesture rightward grew it 580 → 1212 and shrank it back. `sheetPadLeft` is extra padding on
   * the card's LEFT edge, so the page grows outward and the content inside it keeps its
   * coordinates rather than every box being rewritten.
   *
   * ⛔ `sheetGrowTop` IS GONE (B1433856, NOTES-TITLE-BAND-DEAD-ZONE) — replaced by
   * `sheetGrowGap`, extra space folded into the title band's own `marginBottom` rather than the
   * sheet's padding-top. See the measurement effect's comment on `growGap`, below, for why: padding
   * BEFORE the band moves the band and the body's origin down TOGETHER, so it can never open
   * distance between them, which is exactly how a box "above the body's origin" ended up rendering
   * behind the band's own `<input>` instead of clear of it. Growing the GAP AFTER the band is the
   * one distance that separates them. `0` is the ordinary state and costs nothing, same as before. */
  const [sheetGrowGap, setSheetGrowGap] = useState(0);
  /* ⛔ AND THE PAGE'S OWN TOP EDGE MOVES FOR A TOP-EDGE SHRINK (B1605664 ×2) — the render mirror of
   * `heightTopPadRef` below, which carries the full reasoning. It is STATE and not an imperative
   * write for the same reason `sheetGrowWidth` above is: `note-sheet` is React-owned, and writing
   * its style from outside React is a fight with the reconciler waiting to happen. The ref is the
   * authoritative live value (a drag reads it synchronously at press, where a `useCallback`
   * closure over state would be stale); this is what actually renders. `0` in every ordinary
   * state, costing nothing. */
  const [sheetTopPad, setSheetTopPad] = useState(0);
  /* ⛔ THE PAGE'S LEFT BOUNDARY, IN WORKSPACE COORDINATES (NEW-1/NEW-2, 2026-09-21). This
   * REPLACES `matPadX` (the mat's gutter), `matPaneWidth`, `matSidePads`, `matReachWidth` and
   * `matExtraBottom` — five pieces of state that between them existed to manufacture reachable
   * grey around a page inside a BOUNDED scroller, and to hold the words still while that grey
   * changed size. An unbounded workspace has grey in every direction by construction and never
   * moves the page to make more, so all five are gone rather than re-tuned.
   *
   * ⛔ THE INVARIANT, STATED ONCE: the BODY's workspace position is `sheetX + sheetPadLeft`, and
   * every path that changes the page's width holds that sum constant unless the user is
   * deliberately squeezing the column. That is why nothing needs a compensating scroll.
   *
   * `sheetX` starts at 0 and only a left-edge change moves it — negative once blank paper has
   * been opened, which is perfectly legal on a workspace with no origin. */
  const [sheetX, setSheetX] = useState(0);
  /* The page's rendered width: the blank left margin plus the writing column. */
  const [sheetWidth, setSheetWidth] = useState(SHEET_MAX_WIDTH);
  /* The blank paper between the page's own left edge and where the writing starts — the thing a
   * left-edge widen actually opens. Rendered as extra padding-left on the sheet. */
  const [sheetPadLeft, setSheetPadLeft] = useState(0);
  /* A ref mirror of `sheetWidth`, because a drag reads it SYNCHRONOUSLY at the moment of the
   * press and a `useCallback` closure over state would be one render stale — the same reasoning
   * `heightTopPadRef` already carries for its own render mirror. */
  /* The blank left margin as the measurement effect last saw it, so it can apply the CHANGE
   * rather than re-derive the page's position — see that effect for why the difference
   * matters. `null` until the first pass, which is what "place it" means. */
  const growLeftRef = useRef(null);
  const sheetWidthRef = useRef(SHEET_MAX_WIDTH);
  sheetWidthRef.current = sheetWidth;
  const sheetXRef = useRef(0);
  sheetXRef.current = sheetX;
  const sheetPadLeftRef = useRef(0);
  sheetPadLeftRef.current = sheetPadLeft;
  /* ⛔ `boxGestureActive` IS GONE (NEW-1, 2026-09-21), along with `MAT_EXTRA_RIGHT` which it
   * gated. Both existed so a bounded scroller had somewhere off the page's right edge to drag a
   * box TO — reach that had to be manufactured, and then manufactured only during a gesture
   * (B1344625) because a permanent version was its own bug. The workspace is unbounded: there is
   * reach in every direction, permanently, at no cost and with nothing to switch on and off. */
  /* ⛔ SET A PAGE'S OWN WIDTH BY HAND (NEW-1). `widthDragRef` is non-null only for the duration
   * of an edge-drag gesture — see `beginWidthDrag` below for the full mechanism, and the
   * measurement effect's own comment on `pinnedPageWidth` for why a pin is folded into
   * `sheetGrowWidth` rather than into `matPadX`'s own baseline. */
  const widthDragRef = useRef(null);
  /** The width the page would need with no pin at all — genuine box/table overflow only. Kept
   *  fresh by every real measurement run; see that effect's own comment for why a drag must
   *  floor against THIS, never against `sheetGrowWidth`. */
  const widthContentFloorRef = useRef(0);
  /* ⛔ `widthDragLeftPadRef` AND `widthPadOwnerRef` ARE GONE (NEW-2, 2026-09-21). The blank left
   * margin is a stored document attribute now (`pageMarginLeft`), not a React ref plus a
   * stamp recording which committed width the ref still belonged to. The ref did not survive a
   * reload — a margin a drag opened silently vanished on the next open — and the owner-stamp
   * existed only to notice when some OTHER route to a width (a preset, undo, a sync) had made the
   * ref stale, which an attribute cannot be. See `notesExtensions.js`'s `pageMarginLeft`. */
  /* ⛔ SET A PAGE'S OWN HEIGHT BY HAND (NEW-1) — the vertical twin of the two refs above.
   * `heightDragRef` is non-null only for the duration of an edge-drag gesture (see
   * `beginHeightDrag` below); `heightContentFloorRef` is `need` alone (genuine anchored-box
   * overflow, never the current pin — see `widthContentFloorRef`'s own comment for the bug that
   * reading a drag's floor from the value it is about to overwrite causes: narrowing an existing
   * pin silently doing nothing). The height pin feeds `dom.style.minHeight`, an element this
   * module already writes to imperatively for the unpinned case.
   *
   * ⛔ CORRECTED TWICE. READ BOTH ROUNDS BEFORE TOUCHING THE TOP GRIP.
   *
   * ROUND 1 (B1605664, 2026-09-12) — the ORIGINAL comment claimed the top edge could reuse
   * `beginWidthDrag`'s LEFT-edge trick verbatim: grow `minHeight` (always downward,
   * architecturally) and scroll `note-mat` to make the OTHER edge look fixed. That trick needs
   * `scroller.scrollTop` to move as far as the drag asks, in EITHER direction, and it silently
   * CANNOT: shrinking via the top edge needs `scrollTop` to go NEGATIVE, and a note page opens
   * scrolled to its own top (`scrollTop === 0`) essentially always. The browser clamps a negative
   * assignment to 0 without complaint (unlike the LEFT-edge width case, which only ever needs
   * `scrollLeft` to INCREASE — plenty of room, since the page just grew that much wider), so the
   * compensation never applied and a top-edge shrink looked exactly like a bottom-edge one. That
   * diagnosis was RIGHT and is unchanged; the clamp is still the thing to design around.
   *
   * ROUND 2 (B1605664 ×2, 2026-09-15) — round 1's FIX was a `translateY` on `dom`, and `dom` is the
   * WRONG ELEMENT. `dom` is the ProseMirror body, which lives INSIDE `note-sheet`; the page a
   * person sees, with the white surface, the border and the two grips on it, is the SHEET. A
   * transform is a paint-time offset that changes nothing about layout, so it slid the TEXT down
   * inside a page whose own top edge never moved while its bottom edge crept up — the exact
   * symptom round 1 set out to fix. Measured on the shipped build at the owner's own 1191x465
   * window, top grip dragged DOWN 40 on a fresh page:
   *     note-sheet (the page)   top 150 -> 150   bottom 578 -> 538    ✗ the grabbed edge is pinned
   *     note-body  (the text)   top 267 -> 307   bottom 481 -> 481    ✓ reads perfect
   * Both numbers are honest. They describe different boxes — and `ui-audit/verify-notes-page-
   * height.mjs` measured the second one, which is why it reported 46/46 green against a page that
   * was visibly broken (B1609185 fixes the harness; DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 — the
   * harness's own QUESTION produced the reading).
   *
   * THE FIX IS THEREFORE A LAYOUT OFFSET ON THE SHEET, NOT A PAINT OFFSET ON THE BODY:
   * `heightTopPadRef` (+ its `sheetTopPad` render mirror) is folded into `note-sheet`'s own
   * `margin-top`. The sheet's height still comes from `dom.style.minHeight`, so shrinking by `S`
   * and pushing the sheet down by `S` holds the bottom edge EXACTLY still — bottom = top + height,
   * (T + S) + (H - S) = T + H — while the top edge moves 1:1 with the pointer. ⛔ MARGIN IS SAFE
   * HERE AND WAS NOT ON `dom`: round 1 rejected `margin-top` because `dom`'s own top margin
   * COLLAPSES with the title band's `marginBottom` (measured 16px short every time). `note-sheet`
   * is a FLEX ITEM of `note-mat` (`display: flex; flexDirection: column`), and flex items never
   * margin-collapse with anything — so the margin moves the page by exactly what is asked. It is
   * also the one offset that works at any `zoom`: the sheet's own margin and the body's own
   * `minHeight` are scaled by the SAME zoom, so the two cancel at every zoom level.
   *
   * ⛔ WHY THE PAD IS KEPT AFTER RELEASE, NOT CLEARED. Clearing it on commit would yank the whole
   * page back up by `S` the instant the mouse comes up — which IS the reported bug, one frame
   * later. The gap it leaves above the page is the honest consequence of the owner's own stated
   * expectation ("the grabbed edge follows the pointer and the opposite edge holds"): with the mat
   * already at `scrollTop === 0` there is nothing above the page to scroll into, so the only way
   * the top edge can move DOWN is for real space to open above it. That space is ordinary
   * scrollable grey, and a reload (which restores neither scroll position nor this offset) settles
   * at the app's usual top-anchored rest position with the same stored height.
   *
   * `heightPadOwnerRef` is what stops the offset going stale: it records the committed
   * `pageHeight` the pad belongs to. Every height drag (either edge) re-stamps it, so a later
   * BOTTOM-edge drag composes with the offset rather than clearing it; any OTHER route to a
   * different height — undo/redo, a sync from another device, Fit to content — no longer matches,
   * and the measurement effect drops the pad so the page re-anchors at the top of the mat. */
  const heightDragRef = useRef(null);
  const heightContentFloorRef = useRef(0);
  const heightTopPadRef = useRef(0);
  const heightPadOwnerRef = useRef(null);
  /** The ONE way the page's top offset is ever written — ref (read synchronously by the next
   *  drag) and render mirror together, so the two can never disagree. */
  const writeTopPad = useCallback((px) => {
    const n = Math.max(0, px || 0);
    heightTopPadRef.current = n;
    setSheetTopPad(n);
  }, []);

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



  /** Zoom, anchored at a client point (the pointer). Falls back to the middle of the viewport
   *  when no point is given, which is what a keyboard step means. */
  const zoomTo = useCallback((nextZoom, clientPoint) => {
    const rect = viewportRect();
    if (!rect) return;
    const at = clientPoint
      ? { x: clientPoint.x - rect.left, y: clientPoint.y - rect.top }
      : { x: rect.width / 2, y: rect.height / 2 };
    setView(zoomAbout(viewRef.current, at, nextZoom));
  }, [setView, viewportRect]);

  /** The sheet's own workspace box, read off the DOM — never re-derived from the app's own
   *  formula, so a framing cannot silently agree with a wrong number (DRIVER-SCROLL §6). */
  const sheetWorkspaceBox = useCallback(() => {
    const sheet = noteRootRef.current?.querySelector('[data-testid="note-sheet"]');
    const rect = viewportRect();
    if (!sheet || !rect) return null;
    const r = sheet.getBoundingClientRect();
    const v = viewRef.current;
    const tl = toWorkspace(v, { x: r.left - rect.left, y: r.top - rect.top });
    return { x: tl.x, y: tl.y, width: r.width / v.z, height: r.height / v.z };
  }, [viewportRect]);

  /** Ctrl+0 — back to 100%, framed the way a freshly opened page is framed. */
  const resetView = useCallback(() => {
    const rect = viewportRect();
    const page = sheetWorkspaceBox();
    if (!rect || !page) return;
    setView(frameView({ viewport: rect, page, zoom: VIEW_ZOOM_DEFAULT }));
  }, [setView, viewportRect, sheetWorkspaceBox]);

  /** ⛔ "FULL WIDTH" IS THE ONE PRESET WHOSE DEFINITION IS ABOUT THE PANE, so it is the one place
   *  a width change is allowed to move the view (NEW-1, 2026-09-21).
   *
   *  Every other width change must leave the view exactly where it is — that is a third of the
   *  owner's own sentence and the width matrix asserts it on every preset transition. "Full width"
   *  is different in kind: it does not name a number, it names the PANE, and `resolvePresetPx`
   *  resolves it against the pane's current size. On an unbounded canvas a page can sit anywhere,
   *  so a page resolved to the pane's width and then left where it happened to be simply runs off
   *  the right-hand edge — measured, a 907px frame overhanging a 923px pane by 156px. Honouring
   *  the request means showing it, so picking it brings the page's full width into view.
   *  Deliberately width-only: the zoom the person chose is theirs, and the vertical position is
   *  where they were reading. */
  const fitWidth = useCallback(() => {
    const rect = viewportRect();
    const page = sheetWorkspaceBox();
    if (!rect || !page) return;
    const framed = frameView({ viewport: rect, page, zoom: viewRef.current.z });
    setView({ x: framed.x, y: viewRef.current.y, z: viewRef.current.z });
  }, [setView, viewportRect, sheetWorkspaceBox]);

  /* Fires only on the TRANSITION into "full", never on every render while it is active — a view
   * that re-framed itself on each pass would be the "the page keeps jumping" defect, and it would
   * also fight a deliberate pan. */
  const wasFullRef = useRef(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const isFull = editor.state.doc.attrs?.pageWidth === "full";
    const was = wasFullRef.current;
    wasFullRef.current = isFull;
    if (was === null || !isFull || was === isFull) return;
    const id = requestAnimationFrame(fitWidth);     // after the new width has laid out
    return () => cancelAnimationFrame(id);
  }, [editor, sheetWidth, fitWidth]);

  /** Ctrl+9 — show the whole page. */
  const fitPage = useCallback(() => {
    const rect = viewportRect();
    const page = sheetWorkspaceBox();
    if (!rect || !page) return;
    setView(fitView({ viewport: rect, page }));
  }, [setView, viewportRect, sheetWorkspaceBox]);

  /* ---- GESTURES ------------------------------------------------------------------------------
   *
   * ⛔ THE WHEEL DOES TWO THINGS AND THE BROWSER'S OWN ZOOM DOES NEITHER. Ctrl/⌘+wheel zooms at
   * the cursor; a plain wheel PANS, which is what the scroller used to do for free and now has to
   * be done by hand because the viewport no longer scrolls. A trackpad's horizontal swipe arrives
   * as `deltaX` on the same event, so two-finger panning in both axes falls out of it.
   *
   * ⛔ NON-PASSIVE AND `preventDefault`ED, deliberately — the whole point is that Chrome's own
   * page zoom does not ALSO fire on Ctrl+wheel. Attached by hand for exactly that reason: React's
   * `onWheel` is passive and cannot cancel. */
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomTo(zoomForWheel(viewRef.current.z, e.deltaY, { deltaMode: e.deltaMode }), { x: e.clientX, y: e.clientY });
        return;
      }
      /* A line/page delta is a different unit; normalise before spending it as pixels, the same
       * way the zoom curve does. */
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      setView(panBy(viewRef.current, { dx: -e.deltaX * k, dy: -e.deltaY * k }));
    };
    sc.addEventListener("wheel", onWheel, { passive: false });
    return () => sc.removeEventListener("wheel", onWheel);
  }, [zoomTo, setView]);

  /* Ctrl+= / Ctrl+− / Ctrl+0 / Ctrl+9. On the WINDOW, because the caret is usually inside the
   * document and a listener on the pane would miss half of them — and gated on this editor being
   * mounted, which it only is on the Notes route. */
  useEffect(() => {
    const onKey = (e) => {
      const intent = zoomKeyIntent(e);
      if (!intent) return;
      e.preventDefault();
      if (intent.kind === "reset") { resetView(); return; }
      if (intent.kind === "fit") { fitPage(); return; }
      zoomTo(stepZoom(viewRef.current.z, intent.direction));
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [zoomTo, resetView, fitPage]);

  /* ⛔ MIDDLE-MOUSE AND SPACE+DRAG PAN, matching Bluebeam and the Site planner so the two modules
   * feel the same. A plain left-drag on blank workspace already pans (the mat's own gesture model
   * — see docs/NOTES-CARRY-FORWARD.md §7); these two are the ones that pan from ANYWHERE,
   * including from on top of the page, which is what you want once you are zoomed in far enough
   * that there is no blank workspace on screen to grab. */
  const spaceHeldRef = useRef(false);
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return undefined;
    const onKeyDown = (e) => {
      if (e.code !== "Space" || spaceHeldRef.current) return;
      /* ⛔ NOT WHILE THE CARET IS IN TEXT — a space is a space when somebody is typing. This is
       * the module's own standing rule (NOTES-KEY-SCOPE) and the guard is the shared predicate,
       * never a bespoke copy. */
      if (formFieldOwnsTheKey(document.activeElement)) return;
      spaceHeldRef.current = true;
      sc.setAttribute("data-space-pan", "1");
    };
    const onKeyUp = (e) => {
      if (e.code !== "Space") return;
      spaceHeldRef.current = false;
      sc.removeAttribute("data-space-pan");
    };
    /* A window blur while the key is down would otherwise leave the mode latched on forever. */
    const onBlur = () => { spaceHeldRef.current = false; sc.removeAttribute("data-space-pan"); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const beginViewPan = useCallback((e) => {
    const start = { x: e.clientX, y: e.clientY };
    const from = { ...viewRef.current };
    const sc = scrollerRef.current;
    if (sc) sc.setAttribute("data-panning", "1");
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    const onMove = (ev) => {
      setView({ x: from.x - (ev.clientX - start.x), y: from.y - (ev.clientY - start.y), z: from.z });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (sc) sc.removeAttribute("data-panning");
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [setView]);

  /* ⛔ PINCH. A trackpad pinch arrives as a Ctrl+wheel (handled above); a real touch pinch is two
   * pointers, which nothing else here claims. Tracked on the viewport so it works over the page
   * as well as over blank workspace. */
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return undefined;
    const live = new Map();
    let pinch = null;
    const spread = () => {
      const [a, b] = [...live.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };
    const onDown = (e) => {
      if (e.pointerType !== "touch") return;
      live.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (live.size === 2) pinch = { ...spread(), z: viewRef.current.z };
    };
    const onMove = (e) => {
      if (!live.has(e.pointerId)) return;
      live.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (live.size !== 2 || !pinch || !pinch.dist) return;
      e.preventDefault();
      const now = spread();
      zoomTo(pinch.z * (now.dist / pinch.dist), now.mid);
    };
    const onUp = (e) => { live.delete(e.pointerId); if (live.size < 2) pinch = null; };
    sc.addEventListener("pointerdown", onDown);
    sc.addEventListener("pointermove", onMove, { passive: false });
    sc.addEventListener("pointerup", onUp);
    sc.addEventListener("pointercancel", onUp);
    return () => {
      sc.removeEventListener("pointerdown", onDown);
      sc.removeEventListener("pointermove", onMove);
      sc.removeEventListener("pointerup", onUp);
      sc.removeEventListener("pointercancel", onUp);
    };
  }, [zoomTo]);

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
  /* ⛔ CORRECTED (NOTES-PAGE-GROWTH, owner report 2026-09-06): "if I type outside of the note...
   * it would just expand the page" DID ship (B421490, above) — and then REGRESSED the moment
   * `note-sheet` became its own bounded, centred CARD (B1203504), narrower than the pane around
   * it. The horizontal grow decision below used to read the SCROLLER's width (`note-mat`, the
   * whole pane — nearly the full window) as "how much room does the page have", which was the
   * right denominator before B1203504 existed: back then the editor's own box WAS the pane, so
   * growing "past the scroller" and growing "past the visible page" were the same event.
   * B1203504 made them two different things and nobody re-pointed this measurement at the new
   * one: a box could overflow the narrow white CARD while sitting comfortably inside the wide
   * grey PANE around it, so the grow condition read false and nothing ever grew — measured on
   * the owner's own production note (a box needing 751px against a 923px pane that never once
   * triggers growth, while the 580px card it actually had to fit inside was 251px too narrow for
   * it). See `measure`'s own comment below for the full fix, including the second denominator
   * (`fitAnchorBox`'s own reachability question) that has to stay pointed at the pane rather
   * than follow the page narrower, or a deliberately widened box springs back the instant its
   * own drag commits. */
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const dom = editor.view.dom;
    const measure = () => {
      /* ⛔ A LIVE WIDTH DRAG OWNS `sheetGrowWidth`/`sheetPadLeft`/`sheetBaseWidth` FOR ITS OWN
       * DURATION (NEW-1). Growing the sheet's rendered width also grows `dom`'s own rendered
       * width (it fills the sheet's content box), which is exactly what the ResizeObserver a few
       * lines down this effect watches — so without this guard, every frame of a manual drag
       * would immediately be overwritten by a fresh, DOM-querying recompute of this same
       * function, fighting the drag with the STALE (pre-commit) `pageWidth` attribute and
       * producing a visible fight/flicker rather than a smooth drag. The drag handlers below set
       * this ref for exactly the frames this function must stand down; `setNotePageWidth`'s own
       * commit is what makes the next, real run of this function authoritative again. A live
       * HEIGHT drag (NEW-1) owns `dom.style.minHeight` the identical way, for the identical
       * reason — see `beginHeightDrag` below. */
      if (widthDragRef.current || heightDragRef.current) return;
      const nodes = [...dom.querySelectorAll(".planyr-anchor")];
      /* ⛔ TWO DIFFERENT QUESTIONS, TWO DIFFERENT DENOMINATORS — conflating them into one
       * `hostWidth` was the bug in this fix's own first draft, caught by re-measuring rather
       * than trusting the reasoning: `fitAnchorBox` answers "can this box's own HANDLES still be
       * reached" (B421490 — a box hanging off the visible PANE ends up under the Outline panel,
       * which paints later and steals its presses), which is genuinely a question about the
       * PANE, unchanged since before this fix. Pointing it at the narrower natural PAGE width
       * instead made it fire on ANY box past the ordinary page column — including one just
       * dragged wider by hand — clamping it right back down the instant the drag committed, a
       * spring-back this file's own tests caught (`measure-notes-right-edge.mjs`'s drag section:
       * stored width 180→660, and the very next measure re-clamped the RENDER to 256). The page
       * growing to hold a box and a box's own resize handles staying reachable are not the same
       * fact, and only the first of them is what NOTES-PAGE-GROWTH is about. */
      /* ⛔ THE PANE IS MEASURED ON ITS BORDER BOX (`offsetWidth`), NOT ITS CONTENT BOX
       * (`clientWidth`) — because this effect now writes PADDING onto that very element, and
       * `clientWidth` excludes padding. Reading it would make the pane appear to shrink by the
       * gutter this effect just added, which recomputes a smaller gutter, and so on: the exact
       * feedback loop `fitAnchorBox`'s header warns about, arriving through a new door. Measured
       * before it was fixed: a block rendered at x=1007, and after a reload the same block sat at
       * 959 — 48px adrift, from nothing but the loop settling differently on the two paths. */
      const paneWidth = scrollerRef.current?.offsetWidth || dom.clientWidth;
      /* ⛔ B1344624 ×2 (owner report 2026-09-15) — THE GUTTER MUST FIT INSIDE WHAT IS ACTUALLY
       * VISIBLE, NOT THE BORDER BOX `paneWidth` ABOVE. `note-mat` scrolls VERTICALLY
       * (`overflow: auto`) and its own bottom reach (`matExtraBottom`) keeps a scrollbar present
       * on nearly every note, which eats real horizontal space `offsetWidth` does not know
       * about — measured on the owner's own window: `offsetWidth` 923, `clientWidth` 913, a
       * 10px gap the gutter math below was blind to, so even an unpinned Fit-to-content page
       * carried a few pixels of dead horizontal scroll it never needed. `paneContentWidth` is
       * used ONLY for the gutter (`matPadX`) below — `paneWidth` above is untouched (anchored-box
       * fitting, table extents, the natural sheet cap, the reach spacer all still read it), both
       * because none of them reported this defect and because that measurement has its own
       * already-fixed feedback-loop history (this comment's neighbour, two lines up) that a
       * change here has no business disturbing. Safe to read fresh every pass: `note-mat` is
       * `box-sizing: border-box` (the app-wide reset), so its own `clientWidth` cannot be moved
       * by the padding this same effect writes onto it — only by the box's outer size (the flex
       * layout) or by the vertical scrollbar's own presence, neither of which this effect's
       * output feeds back into. */
      const paneContentWidth = scrollerRef.current?.clientWidth || paneWidth;
      const blocks = nodes.map((el) => {
        const x = parseFloat(el.getAttribute("data-anchor-x")) || parseFloat(el.style.left) || 0;
        const w = parseFloat(el.getAttribute("data-anchor-w")) || parseFloat(el.style.width);
        const fit = fitAnchorBox({ x, w, hostWidth: paneWidth });
        if (Math.round(parseFloat(el.style.width)) !== fit.w) el.style.width = `${fit.w}px`;
        if (Math.round(parseFloat(el.style.left)) !== fit.x) el.style.left = `${fit.x}px`;
        return { x: fit.x, w: fit.w, y: parseFloat(el.style.top) || 0, height: el.offsetHeight };
      });
      const need = anchorExtent(blocks);
      /* ⛔ SET A PAGE'S OWN HEIGHT BY HAND (NEW-1) — a pin is a FLOOR under the unpinned
       * `max(46vh, need)` default, exactly parallel to how a width pin overrides
       * `SHEET_MAX_WIDTH`: real content (an anchored box needing room) still wins via
       * `Math.max`, so a pin can never clip anything. `heightContentFloorRef` is `need` ALONE —
       * never the current pin — for the same reason `widthContentFloorRef` is: flooring a live
       * drag against the value it is about to overwrite makes narrowing an existing pin silently
       * do nothing (docs/NOTES-CARRY-FORWARD.md §5-1's addendum on the width feature's own first
       * draft of this exact mistake). */
      heightContentFloorRef.current = need;
      const pinnedHeight = resolvePinnedBaseHeight(editor.state.doc.attrs?.pageHeight);
      /* ⛔ THE PAGE'S TOP OFFSET BELONGS TO ONE COMMITTED HEIGHT, AND IS DROPPED THE MOMENT A
       * DIFFERENT ONE IS ON SCREEN (B1605664 ×2). Fit to content has no grow-from-top state to keep
       * at all; neither has a height that arrived by undo/redo or by a sync from another device,
       * which would otherwise render somebody else's page stranded below a gap this session
       * opened. A height drag on EITHER edge re-stamps `heightPadOwnerRef` as it commits, so the
       * ordinary "drag the top, then drag the bottom" sequence composes instead of jumping. */
      if (pinnedHeight == null || pinnedHeight !== heightPadOwnerRef.current) {
        heightPadOwnerRef.current = pinnedHeight;
        if (heightTopPadRef.current) writeTopPad(0);
      }
      dom.style.minHeight = pinnedHeight != null
        ? `${Math.max(pinnedHeight, need)}px`
        : (need ? `max(46vh, ${need}px)` : "");
      /* ⛔ AND THE PAGE GROWS SIDEWAYS TOO (NEW-RIGHT-EDGE) — restored against the right
       * denominator. `naturalPageWidth` is the page's OWN width before anything grows it —
       * computed from the pane's width and the sheet's fixed layout constants
       * (`SHEET_MAX_WIDTH`/`SHEET_PAD_X`/`SHEET_MARGIN_X`), never from the sheet's or the
       * editor's own rendered width, which keeps it immune to the feedback loop
       * `fitAnchorBox`'s own header warns about (grow → the grown width becomes "the room" →
       * grow again — a pane width and three constants cannot be moved by anything this effect
       * writes). Past this width a box no longer narrows; the SHEET widens instead, using the
       * PANE-fitted `blocks` above, so a box already fitted for reachability is never re-fitted
       * a second time against a second, smaller number. `sheetGrowWidth` is `null` — leaving the
       * sheet at its ordinary 580px card — the moment nothing needs it. */
      const padSide = narrow ? SHEET_PAD_X.narrow : SHEET_PAD_X.wide;
      const padX = padSide * 2;
      const marginX = (narrow ? SHEET_MARGIN_X.narrow : SHEET_MARGIN_X.wide) * 2;
      const naturalSheetWidth = Math.max(1, Math.min(SHEET_MAX_WIDTH, paneWidth - marginX));
      const naturalPageWidth = Math.max(1, naturalSheetWidth - padX);
      /* ⛔ SET A PAGE'S OWN WIDTH BY HAND (NEW-1) — READ THIS BEFORE TOUCHING EITHER NUMBER
       * ABOVE. The first draft of this feature fed the pin straight into `naturalSheetWidth`
       * itself, on the reasoning that everything downstream already treats that baseline as
       * ordinary. It does — which is exactly the bug: `matPadX` a few lines down is ALSO derived
       * from `naturalSheetWidth`, so a pin changed the GUTTER, and the moment a completed drag
       * or menu pick committed, `matPadX` recomputed and the page's own LEFT EDGE JUMPED —
       * measured live, 100px, the identical "centring splits the new width across both edges"
       * defect NOTES-PAGE-GROWTH's round 2a already named and rejected, arriving through a new
       * door. `naturalSheetWidth`/`naturalPageWidth` stay the TRUE, pin-independent baseline —
       * `matPadX` must never move because of a pin — and the pin instead gets its OWN baseline,
       * used only for how wide the SHEET renders, exactly parallel to how `sheetGrowWidth`
       * already overrides the sheet's width without ever touching `matPadX`.
       *
       * ⛔ AND IT RESOLVES AGAINST `paneContentWidth`, NOT `paneWidth` (B1344624 ×2) — the ONE
       * other place this effect deliberately departs from the border-box `paneWidth` documented
       * above, for the same reason the gutter does: "full" is the one pin whose entire point IS
       * the pane, and its resolved width is a PROMISE that the frame fits with only a small
       * margin — a promise `resolvePresetPx` cannot keep if it is handed a width that includes
       * room a vertical scrollbar has already claimed. Every numeric pin (Narrow/Normal/Wide, a
       * completed drag) is UNAFFECTED: `resolvePresetPx` ignores `paneWidth` entirely for those,
       * by design (its own header). Measured live: without this, "full" still resolved a few
       * pixels too wide on a note with a scrollbar and a closed Outline rail, and the gutter
       * fix above — correctly sized around an already-too-wide frame — could only ever shrink
       * to zero, never close the last few pixels. */
      const pinnedBase = resolvePinnedBaseWidth(editor.state.doc.attrs?.pageWidth, { paneWidth: paneContentWidth });
      /* ⛔ THE BLANK LEFT MARGIN IS A STORED DOC ATTRIBUTE NOW (NEW-2, 2026-09-21), NOT A REF.
       *
       * It used to be `widthDragLeftPadRef` — a React ref, plus `widthPadOwnerRef` to notice when
       * some OTHER route to a width (a preset, undo, a sync) had made it stale, plus a
       * subtraction here to stop the pad being counted twice inside `pinnedBase`. All three are
       * gone. `pageMarginLeft` is an ordinary document attribute, so:
       *   · it SURVIVES A RELOAD, which the ref did not — the blank paper a drag opened silently
       *     vanished on the next open and the page re-rendered narrower than it was left;
       *   · it rides storage, sync, print and export for free (`pageWidth`'s own reasoning);
       *   · it is independent of `pageWidth`, so there is no double-count to subtract and no
       *     owner-stamp to keep in step — a preset changes the column and leaves the margin alone,
       *     which is exactly what it should do. */
      const storedMarginLeft = normalizePageMargin(editor.state.doc.attrs?.pageMarginLeft);
      /* The COLUMN's pinned width. `pinnedBase` is the stored `pageWidth`, which has always meant
       * the writing column and still does — the margin is separate and is added on top in
       * `totalSheetWidth` below. */
      const pinnedPageWidth = pinnedBase != null ? Math.max(1, pinnedBase - padX) : null;
      /* ⛔ A WIDE TABLE GROWS THE SHEET THE SAME WAY A WIDE BOX DOES (NEW-1, owner report
       * 2026-09-11) — REUSING this path rather than building a second growth mechanism, per the
       * owner's own instruction. A table is in-flow content, not a positioned anchor, so it has
       * no stored `x`/`w` to read — its reach is measured live off the rendered element, the same
       * way an anchor's `height` already is a few lines up (`el.offsetHeight`). `rectScale`
       * corrects `getBoundingClientRect()` back into the SAME local/document pixel space
       * `dom.clientWidth`-style reads already use — the identical correction `beginSize`/
       * `beginDrag` apply to a box's own drag geometry a little further down this file, needed
       * because `getBoundingClientRect` reflects the real screen (which the native browser zoom
       * can inflate) while `offsetWidth` does not. */
      const domRect = dom.getBoundingClientRect();
      const rectScale = domRect.width / (dom.offsetWidth || 1) || 1;
      const tableBlocks = [...dom.querySelectorAll("table")].map((t) => {
        const r = t.getBoundingClientRect();
        return { x: (r.left - domRect.left) / rectScale, w: t.offsetWidth };
      });
      const needX = anchorExtentX([...blocks, ...tableBlocks]);
      /* ⛔ AND THE SAME QUESTION ASKED OF THE LEFT EDGE (NOTES-FREE-PLACEMENT / NEW-1).
       * `anchorExtentLeft` answers "how far past the page's LEFT origin does anything reach", in
       * the same positive-distance units as the two above. The sheet already has room for some of
       * that in its own padding — a box 20px left of the body's origin still sits on the white
       * card, because the card's side padding is wider than that — so only the SHORTFALL becomes
       * growth.
       *
       * ⛔ THE TOP EDGE IS NOT THE SAME QUESTION, AND TREATING IT AS ONE WAS THE BUG (B1433856,
       * NOTES-TITLE-BAND-DEAD-ZONE, 2026-09-09) — CORRECTING NEW-5's ORIGINAL REASONING, KEPT FOR
       * THE RECORD RATHER THAN DELETED. NEW-5 read "a box above the body's origin has the whole
       * title band to sit in first" as the same kind of saving as the LEFT edge's padding credit —
       * extra padding-TOP on the sheet, crediting the band's own height as part of it — and it
       * never asked what already occupies that space. The title band's height is not blank: the
       * `note-title` `<input>` spans it at `width: 100%`, always, regardless of what the title
       * says. Measured live on the owner's account (B1433856): the input's rect and a placed
       * note's rect painted the same pixels, the note's glyphs drew over the title's letters once
       * the title grew long enough to reach them, and a real click in the shared pixels focused
       * NEITHER element — `document.activeElement` stayed `BODY`. That is a permanent, reload-
       * surviving dead zone: the title becomes uneditable at that x, and the note never gets a
       * caret on a first press either (a box's own first press SELECTS it, per B434416's two-stage
       * model — correct everywhere else, but there is nothing on screen there to show a selection
       * happened, since it reads as more title).
       *
       * ⛔ AND EXTRA PADDING-TOP CANNOT FIX IT, WHICH IS WHY THE FIX IS A DIFFERENT MECHANISM
       * RATHER THAN A DIFFERENT NUMBER. Padding-top sits BEFORE the band, so growing it shifts the
       * band and the body's origin DOWN TOGETHER, by the same amount — it can never open distance
       * BETWEEN them, because both move by exactly the same padding-top delta. Proved by construction: for any
       * formula of the shape `padding-top += f(extentTop)`, a box's on-screen position reduces to
       * `dom.top − |y| = (base + f(extentTop)) − |y|`, and whenever `f` is linear in `extentTop`
       * (which `extentTop` itself is linear in `|y|`), the `|y|` terms cancel and the box lands at
       * the SAME pixel regardless of the constant subtracted inside `f` — which is exactly how the
       * shipped formula produced an overlapping "free" zone in the first place: crediting a bigger
       * constant only moved WHERE the collision sits, never whether one happens.
       *
       * The fix instead grows the GAP between the band and the body's origin (`sheetGrowGap`,
       * folded into the title band's own `marginBottom` below) — the one distance that is NOT
       * shared between the band and a box measured from the body's origin, so growing it is the
       * only lever that can put daylight between them. A box whose reach fits inside the band's
       * own footprint now pushes the body's origin down by exactly enough to clear it (with the
       * same breathing pad `anchorExtentTop` already gives every other edge); the band itself does
       * not move. "Something placed level with the title" (NEW-5 / V993809) still works, and still
       * needs no coordinate migration — it now renders in the space the gap opens up below the
       * band instead of behind it, which is what makes it reachable rather than merely present. */
      /* ⛔ THE BLANK LEFT MARGIN HAS TWO SOURCES AND THEY COMPOSE (NEW-2, 2026-09-21): the page's
       * OWN stored margin (`pageMarginLeft`, what a left-grip drag committed) and whatever a
       * free-placed box hanging past the left edge needs (`anchorExtentLeft`, NOTES-FREE-PLACEMENT).
       * `Math.max`, not a sum — they are two answers to the same question ("how much blank paper
       * is there to the left of the writing"), not two separate margins. */
      const growLeft = Math.max(0, anchorExtentLeft(blocks) - padSide, storedMarginLeft);
      const growGap = Math.max(0, anchorExtentTop(blocks) - TITLE_BAND_GAP);
      /* ⛔ THE PIN IS THE BASELINE THE COLUMN STARTS FROM, AND REAL CONTENT IS STILL A FLOOR ON
       * TOP OF IT (NEW-1) — `pinnedPageWidth ?? naturalPageWidth` is the ONLY change from the
       * pre-existing formula here; `Math.max` against `needX` is exactly the same "content wider
       * than it keeps growing the sheet" rule that already governed the unpinned 580 baseline,
       * so a table too wide for a Narrow-pinned page still grows the page, and a Wide-pinned page
       * with ordinary short content still renders at the pin rather than shrinking to fit it. */
      const effectivePageWidth = pinnedPageWidth ?? naturalPageWidth;
      const contentW = Math.max(effectivePageWidth, needX);
      const columnWidth = padX + contentW;
      const totalSheetWidth = growLeft + columnWidth;
      /* ⛔ THE ONE PLACE THE PAGE'S GEOMETRY IS COMMITTED, AND THE ONE INVARIANT IT KEEPS.
       *
       * `sheetX = -growLeft` and `sheetPadLeft = growLeft` move together, always, so the BODY's
       * workspace X — `sheetX + sheetPadLeft + SHEET_PAD_X` — is **identically `SHEET_PAD_X`, for
       * every page, at every width, forever.** It is not held there by a compensation; it is not
       * a function of the width at all. That is the whole of the NEW-2 fix, and it is why the
       * three shipped rounds of scroll compensation could be deleted instead of tuned:
       *   round 1 (B1740688) moved the content and had to hold it still with a scroll
       *   round 2 (B1775312) applied that scroll twice per frame           → judder
       *   round 3 (B1801040) applied it once but it clamped at zero        → creep
       * There is nothing here for any of those to be a bug in. */
      /* ⛔ `sheetX` MOVES BY A DELTA, IT IS NOT RE-DERIVED — and that is not a micro-optimisation,
       * it is what lets the two edges keep DIFFERENT anchors.
       *
       * A left-edge gesture holds the page's RIGHT edge still; a right-edge gesture holds its LEFT
       * edge still. Those are two different fixed points, so no single formula `sheetX = f(width)`
       * can be correct for both — re-deriving it as `-growLeft` (which the first version of this
       * did) silently makes the left edge the anchor for everything, and a left-grip NARROW then
       * pulls the RIGHT edge in instead of pushing the left one out. Measured on exactly that
       * version: a 160px left narrow held the body perfectly still and moved the right boundary
       * 160px in — the same "you grabbed one boundary and a different one moved" defect this round
       * found on `origin/main`, reintroduced through a new door.
       *
       * So this effect only ever applies the CHANGE in how much blank paper the page is carrying,
       * which holds the body still while a box grows the page leftward (NOTES-FREE-PLACEMENT's
       * own guarantee), and leaves the drags to move `sheetX` by their own rule. */
      const prevGrow = growLeftRef.current;
      growLeftRef.current = growLeft;
      if (prevGrow == null) setSheetX(-growLeft);                    // first pass: place it
      else if (prevGrow !== growLeft) setSheetX((x) => x - (growLeft - prevGrow));
      setSheetPadLeft(growLeft);
      setSheetWidth(totalSheetWidth);
      /* ⛔ AND THE DRAG'S OWN FLOOR IS THIS, NEVER `sheetGrowWidth` ITSELF (NEW-1). A live drag
       * (below) has to know how far it may narrow the page WITHOUT clipping real content — but
       * `sheetGrowWidth` already carries whatever PIN is currently active, so flooring a drag
       * against it would make the page's own CURRENT width an artificial minimum, and narrowing
       * from an existing pin would silently do nothing (measured: dragged to 780, tried to drag
       * back to 630, stayed at 780 — the drag's own starting width was quietly re-asserted as a
       * floor on itself). This is the answer with the pin subtracted back out: what the sheet
       * would need with NOTHING pinned, i.e. genuine box/table overflow only.
       *
       * ⛔ CORRECTED (NEW-2, 2026-09-21) — IT IS THE COLUMN'S FLOOR, NOT THE SHEET'S, AND THAT
       * ONE-WORD DIFFERENCE IS A DEFECT THE WIDTH MATRIX CAUGHT ON `origin/main`. It used to
       * include `growLeft` AND the natural page width, so grabbing either grip on a page pinned
       * NARROWER than the natural card snapped the page straight out to the natural width before
       * the pointer had moved: measured at 440 → 580, a 140px jump against 5px of pointer travel.
       * A drag's floor is what real CONTENT needs, which a deliberately narrow page is not
       * violating. */
      widthContentFloorRef.current = padX + needX;
      setSheetGrowGap(growGap);
    };
    measure();
    /* Re-measured as the text inside a block reflows, which is the half that matters: the
     * block gets taller as you type and the page has to keep up in the same frame. */
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) for (const el of dom.querySelectorAll(".planyr-anchor")) ro.observe(el);
    /* ⛔ AND EVERY TABLE IS OBSERVED TOO (NEW-1) — a live column drag mutates the table's DOM
     * width directly, outside any transaction (`@tiptap/pm/tables`' own drag preview), so nothing
     * else would notice until mouseup. Observing the element itself catches the sheet growing in
     * real time as the drag happens, the same way a typed-into anchor already does. */
    if (ro) for (const el of dom.querySelectorAll("table")) ro.observe(el);
    /* ⛔ AND THE EDITOR ITSELF IS OBSERVED, not only the blocks inside it (B421490). The width fit
     * above is a function of the EDITOR's width, and nothing was watching that: a block only
     * re-measured when its own text reflowed, so narrowing the window left every box at the width
     * a wider window had allowed. That is the state in which a box's controls end up under the
     * outline panel. */
    if (ro) ro.observe(dom);
    /* ⛔ AND THE SCROLLER (THE PANE ITSELF) IS OBSERVED TOO (B1344624, owner report 2026-09-15) —
     * a NUMERIC pin (Narrow/Normal/Wide/Full/a completed drag) renders `note-sheet` at a fixed
     * pixel `width`, which does NOT itself change when the surrounding PANE does — so watching
     * `dom` alone (the fix above, B421490) never notices the pane changing while a pin is active:
     * `dom`'s own rendered width only ever reacts, it never causes. Measured live: picking "Full
     * width" then closing the Outline panel (which hands `note-mat` ~208px more room) left the
     * sheet pinned at its stale, pre-close width with nothing to re-trigger `measure()` at all —
     * the "Full width" preset is SUPPOSED to track the pane's current size, not freeze the number
     * it happened to compute at the moment it was picked. `scrollerRef.current` IS `note-mat`, so
     * observing it directly catches every cause of the pane changing (the Outline panel opening
     * or closing, the Pages rail collapsing, a window resize) regardless of whether a pin happens
     * to be active. */
    if (ro && scrollerRef.current) ro.observe(scrollerRef.current);
    return () => ro?.disconnect();
    /* ⛔ `narrow` IS A REAL DEPENDENCY NOW (NOTES-PAGE-GROWTH) — `measure`'s padding/margin
     * numbers are read off it, so crossing the phone breakpoint has to re-run this closure with
     * the fresh value immediately rather than wait on the ResizeObserver to fire against a
     * still-stale `narrow` from the render this effect was last registered under. */
  }, [editor, docTick, narrow, writeTopPad]);

  /* ⛔ THE "HOLD THE WORDS STILL WHILE THE PAGE GROWS" LAYOUT EFFECT IS DELETED (NEW-2,
   * 2026-09-21), AND ITS DELETION IS THE FIX RATHER THAN A SIMPLIFICATION.
   *
   * It measured the body's own position inside the scroller before and after a growth and folded
   * the difference into `scrollLeft`/`scrollTop` in the same frame. That was a correct response to
   * a real problem — growing the sheet leftward genuinely moved the words — and it was the shared
   * mechanism behind all three reported rounds of this bug: round 2 double-applied it (judder),
   * round 3 found it silently clamped at zero on a page narrower than the pane (creep). Every fix
   * made it more elaborate and none of them could make a BOUNDED resource able to pay an
   * UNBOUNDED debt.
   *
   * There is no debt now. The page grows leftward by moving `sheetX` out and `sheetPadLeft` in by
   * the same amount, so the body's workspace position is unchanged by construction and the view
   * is never consulted. Nothing to measure, nothing to compensate, nothing to clamp. */

  /* ⛔ THE GRIP-DRAG AUTO-SCROLL (NEW-7, B1344630) IS GONE, AND ITS REMOVAL IS A FIX RATHER THAN
   * A LOSS (NEW-1, 2026-09-21).
   *
   * It existed because a bounded scroller ran out of room: the grip reached the pane's edge with
   * the page still wanting to grow, so the view had to be scrolled to let the drag continue, and
   * the owner's own report was that he could not tell "the app clamps the width" from "I ran out
   * of screen to move the mouse into." On an unbounded workspace the boundary simply keeps
   * moving — the page extends as far past the window as the pointer asks for — so the ambiguity
   * he reported cannot arise and there is nothing to auto-scroll for.
   *
   * ⛔ AND IT CLOSES A CLASS RATHER THAN AN INSTANCE: it was the one path that could move the
   * view mid-drag, and "the view itself stays exactly where it is" is a third of the owner's own
   * sentence about what a width gesture must not disturb. (This item's own history already
   * records the auto-scroll being REVERTED from the height grips for the same reason — it broke
   * "the opposite edge holds" there. It is now gone from both.) */

  /* ---- SET A PAGE'S OWN WIDTH BY HAND, THE DRAG HALF (NEW-1, rewritten NEW-2 2026-09-21) ----
   *
   * ⛔ READ `lib/notesViewport.js`'s HEADER BEFORE CHANGING ANYTHING HERE. This function has been
   * rewritten three times and every previous version was a variation on the same wrong idea:
   * hold the words still by SCROLLING the mat to cancel a layout shift the drag itself caused.
   *   round 1 (B1740688)  grow the sheet, scroll to compensate     → the words moved
   *   round 2 (B1775312)  scroll here AND in a layout effect       → double-applied, judder
   *   round 3 (B1801040)  spend the mat's gutter, top up the right → the scroll clamped, creep
   * None of them is here any more, because the mechanism they all depended on is gone.
   *
   * ⛔ WHAT IT DOES NOW, IN FULL — and it is short, which is the point:
   *   RIGHT edge — the writing COLUMN follows the pointer. The page's left boundary is `sheetX`
   *                and this does not touch it, so the left edge holds for free.
   *   LEFT edge  — the page's BLANK LEFT MARGIN follows the pointer. `sheetX` moves out by the
   *                same amount `sheetPadLeft` grows, so the body's workspace position does not
   *                change AT ALL and the right edge does not move either.
   * Neither branch reads or writes the view. There is no compensation, so there is nothing to
   * double-apply and nothing to clamp.
   *
   * ⛔ AND A LEFT-EDGE NARROW PAST THE BLANK PAPER IS A REAL, DELIBERATE CONTENT SHIFT. Once the
   * margin is spent the boundary has nowhere to go but into the column, so the column narrows and
   * the words come with it — what dragging a margin marker into your own text does in every word
   * processor. `leftEdgeDrag` returns that amount as `contentShift` rather than leaving a caller
   * to infer it. What it must NEVER do is what `origin/main` did: move the RIGHT edge instead
   * (measured — a 160px left-grip narrow on a 900 page moved the right boundary 160px in, and
   * left the boundary under the pointer exactly where it was).
   *
   * ⛔ THE LIVE DRAG OWNS THE GEOMETRY FOR ITS OWN DURATION. `widthDragRef` makes the measurement
   * effect stand down (see its own guard), because growing the sheet also grows the editor's own
   * rendered width, which that effect's ResizeObserver watches — without the guard every frame of
   * a manual drag is immediately overwritten by a recompute against the STILL-uncommitted
   * attributes. The commit on release is ONE `setDocAttribute` step, so the whole drag is one
   * undo entry however many pixels it covered, and a press that never moved commits nothing at
   * all (B391073).
   *
   * ⛔ AND THE DRAG'S FLOOR IS WHAT CONTENT NEEDS, NEVER THE NATURAL CARD WIDTH. That was a real
   * defect on `origin/main`, caught by the width matrix's "the page may not outrun the pointer"
   * row: `widthContentFloorRef` used to include the natural page width, so touching either grip
   * on a page pinned narrower than the card snapped it out to 580 before the pointer had moved —
   * 140px of page against 5px of finger. */
  const [widthDragEdge, setWidthDragEdge] = useState(null);
  const beginWidthDrag = useCallback((edge) => (e) => {
    if (!editor || editor.isDestroyed || e.button !== 0) return;
    e.preventDefault();
    /* ⛔ THE GEOMETRY IS READ IN WORKSPACE UNITS, NOT SCREEN UNITS. The pointer moves in screen
     * pixels and the page is measured in workspace pixels, and at any zoom but 100% those are
     * different quantities — dividing by the live scale is what makes a drag track the pointer
     * one-to-one at every zoom level instead of moving `z` times too far. `origin/main` did not
     * do this (there was no canvas zoom to do it for), which is why the matrix's zoom rows
     * measured the page outrunning the pointer by 410px at 150%. */
    const z = viewRef.current.z || 1;
    const drag = {
      edge,
      startClientX: e.clientX,
      lastClientX: e.clientX,
      /* ⛔ THE MARGIN THE PAGE IS ACTUALLY RENDERING, NEVER THE ONE IT HAS STORED — and the
       * difference is a defect the width matrix caught (row 7, a page with a box hanging off its
       * left edge). The rendered margin is `Math.max(stored, what a free-placed box needs)`, so on
       * a page whose margin comes entirely from a box the stored value is 0 while the page is
       * really carrying (measured) 96px of blank paper. Reading the stored value put that 96 into
       * `startColumn` instead, and the drag then moved the page's left edge by the margin AND the
       * column's phantom extra — the body slid 96px left on a gesture that must not move it at
       * all. `sheetPadLeft` is the number on screen, so it is the only honest starting point. */
      startMargin: sheetPadLeftRef.current,
      startColumn: Math.max(0, sheetWidthRef.current - sheetPadLeftRef.current),
      startSheetX: sheetXRef.current,
      startWidth: sheetWidthRef.current,
      scale: z,
    };
    widthDragRef.current = drag;
    viewTouchedRef.current = true;          // the page is theirs now; never re-frame over a drag
    setWidthDragEdge(edge);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    /** What the geometry should be for a pointer at `clientX`. Pure apart from the two library
     *  calls, so the live preview and the eventual commit cannot disagree about anything. */
    const geometryFor = (clientX) => {
      /* How far the grabbed BOUNDARY has moved OUTWARD, in workspace pixels. The left boundary
       * moves outward by going left; the right boundary by going right. */
      const delta = (edge === "left" ? drag.startClientX - clientX : clientX - drag.startClientX) / drag.scale;
      if (edge === "left") {
        const r = leftEdgeDrag({ marginLeft: drag.startMargin, colWidth: drag.startColumn, delta });
        return { marginLeft: r.marginLeft, colWidth: Math.max(r.colWidth, widthContentFloorRef.current || 0) };
      }
      const r = rightEdgeDrag({ colWidth: drag.startColumn, delta });
      return { marginLeft: drag.startMargin, colWidth: Math.max(r.colWidth, widthContentFloorRef.current || 0) };
    };

    const apply = () => {
      const g = geometryFor(drag.lastClientX);
      const width = g.marginLeft + g.colWidth;
      /* ⛔ THE EDGE YOU DID NOT GRAB DOES NOT MOVE, AND THIS ONE LINE IS THE WHOLE OF IT.
       * A LEFT-edge gesture holds the page's RIGHT edge: the right edge is `sheetX + width`, so
       * moving `sheetX` back by exactly the width gained keeps that sum constant, whether the
       * gesture is opening blank paper (the body holds still, because `sheetPadLeft` grows by the
       * same amount) or squeezing the column (the body moves right with the boundary, which is
       * what dragging a margin into your own text means).
       * A RIGHT-edge gesture holds the LEFT edge, which needs no arithmetic at all — `sheetX`
       * simply does not change. */
      if (edge === "left") setSheetX(drag.startSheetX - (width - drag.startWidth));
      setSheetPadLeft(g.marginLeft);
      setSheetWidth(width);
      /* Keep the ref the measurement effect compares against in step with what the drag rendered,
       * so the first pass after release applies a delta of zero instead of jerking the page by the
       * whole margin. */
      growLeftRef.current = g.marginLeft;
    };
    const onMove = (ev) => { drag.lastClientX = ev.clientX; apply(); };

    /* ⛔ NO AUTO-SCROLL ANY MORE, AND ITS REMOVAL IS A FIX RATHER THAN A LOSS (NEW-7/B1344630 is
     * retired by this). It existed because a bounded scroller ran out of room: the grip reached
     * the pane's edge with the page still wanting to grow, so the view had to be scrolled to let
     * the drag continue. On an unbounded workspace the boundary simply keeps moving — the page
     * can extend as far past the window as the pointer asks for, and the view stays exactly where
     * the person put it, which is what "the view itself does not move" in the owner's own
     * sentence asks for. It also removes the one path that could move the view mid-drag, which is
     * a class of judder rather than an instance of one. */
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      widthDragRef.current = null;
      setWidthDragEdge(null);
      if (!editor || editor.isDestroyed) return;
      /* ⛔ A RELEASE OUTSIDE THE WINDOW COMMITS WHAT WAS LAST SEEN. The browser stops reporting
       * positions past the glass, so `ev.clientX` on the release can be the clamped edge value
       * while `lastClientX` already holds the real one. Take whichever represents MORE travel in
       * this edge's own outward direction rather than flatly overwriting. */
      drag.lastClientX = edge === "left"
        ? Math.min(drag.lastClientX, ev.clientX)
        : Math.max(drag.lastClientX, ev.clientX);
      if (Math.abs(drag.lastClientX - drag.startClientX) < 1) return;   // a click that did not drag writes nothing
      const g = geometryFor(drag.lastClientX);
      /* ⛔ ONE TRANSACTION, BOTH ATTRIBUTES — so the whole drag is a single undo step whichever
       * edge it was, and an undo can never restore half the geometry. */
      editor.commands.setNotePageGeometry({
        pageWidth: Math.round(g.colWidth),
        pageMarginLeft: Math.round(g.marginLeft),
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [editor]);

  /* ---- SET A PAGE'S OWN HEIGHT BY HAND, THE DRAG HALF (NEW-1, 2026-09-12) --------------------
   *
   * The vertical twin of `beginWidthDrag` just above — growth only ever happens in ONE direction
   * at rest (DOWN, extending `dom.style.minHeight`, the same element the unpinned default
   * already writes to):
   *   BOTTOM edge — grow `dom.style.minHeight` toward the pointer. The top of the body never
   *                 moves for this (it never has), so "the opposite edge holds" is free — the
   *                 exact shape of the width feature's RIGHT edge.
   *   TOP edge    — GROWING (drag up): grow `dom.style.minHeight` (downward, same as above) and
   *                 scroll the mat by the exact same amount the height grew — `beginWidthDrag`'s
   *                 LEFT-edge trick, transposed, and it works for the identical reason: growing
   *                 only ever needs `scroller.scrollTop` to INCREASE, and there is always room to
   *                 scroll into (the page just grew that much taller).
   *               — SHRINKING (drag down): the SAME trick, run backward, needs `scrollTop` to
   *                 DECREASE below its own current value, and a note page opens scrolled to its
   *                 own top (`scrollTop === 0`) essentially always — there is nothing to scroll
   *                 UP into. `scroller.scrollTop = X` where X<0 silently clamps to 0 (browsers do
   *                 not throw), so the compensation never applies: `dom.style.minHeight` shrinks
   *                 correctly, but with the viewport pinned exactly where it was, the page keeps
   *                 its top and only its bottom recedes — indistinguishable from a bottom-edge
   *                 drag. So the shrink half moves the PAGE instead of the viewport:
   *                 `heightTopPadRef` (declared above, by the other height refs, with the full
   *                 reasoning and the measurements) opens exactly `shrank` of real space above
   *                 `note-sheet` via its own `margin-top`. The sheet's bottom edge is `minHeight`
   *                 below its top, so pushing the whole page down by exactly what `minHeight`
   *                 gave up holds the bottom still while the top moves 1:1 with the pointer.
   *                 ⛔ THE PAGE, NOT THE BODY — round 1 of this fix put a `translateY` on `dom`
   *                 (the ProseMirror body, INSIDE the sheet), which slid the text down inside a
   *                 page whose own edges did not move at all. See `heightTopPadRef`'s header for
   *                 the before/after numbers and for why the harness called that green.
   *
   * ⛔ AND THE EDGE YOU DRAGGED STAYS REACHABLE WHEN YOU LET GO (B1609184). Growing from the top
   * scrolls the mat, and a big enough grow scrolls the page's own top edge — with the grip that
   * lives on it — clean out of the mat's visible box: measured at the owner's 1191x465 window, a
   * 60px grow left the top edge at screen y 90 against a mat whose viewport starts at 126, so the
   * edge just dragged could not be grabbed again without scrolling back by hand. `settleTopEdge`
   * gives back the minimum scroll that brings the grip fully back inside, and only when it is
   * genuinely outside — a drag that ends with the grip in view scrolls nothing at all. It runs at
   * RELEASE, never mid-gesture: the drag itself must stay 1:1 with the pointer (the owner verified
   * that half as correct), and "reachable when the drag ends" is exactly the promise being kept.
   *
   * ⛔ WHY THIS DOES NOT FIGHT THE MEASUREMENT EFFECT ABOVE: `measure()` bails out immediately
   * while `heightDragRef.current` is set, so the ResizeObserver it owns cannot see this
   * function's live `dom.style.minHeight` writes and overwrite them mid-drag against the
   * STILL-uncommitted `pageHeight` attribute. The one real commit — `setNotePageHeight` on
   * release — is what hands authority back, one undoable `setDocAttribute` step regardless of
   * how many pixels the drag covered. A press with no real movement commits nothing, matching
   * this module's own standing rule (B391073) and `beginWidthDrag`'s identical guard.
   *
   * ⛔ THE PAGE'S OFFSET IS REACT STATE, THE BODY'S HEIGHT IS NOT, AND THAT SPLIT IS THE WHOLE
   * POINT. `dom` is the editor's own DOM node, which this module already writes to imperatively
   * for the unpinned case, so the live drag does too. `note-sheet` is React-owned — exactly why
   * `sheetGrowWidth` exists for the width feature — so its offset rides `writeTopPad` (ref +
   * `sheetTopPad` render mirror) rather than a style write React would fight over. The commit's
   * own re-render is what makes the NEXT real `measure()` run authoritative again. */
  const [heightDragEdge, setHeightDragEdge] = useState(null);
  const beginHeightDrag = useCallback((edge) => (e) => {
    if (!editor || editor.isDestroyed || e.button !== 0) return;
    const dom = editor.view.dom;
    const scroller = scrollerRef.current;
    if (!dom || !scroller) return;
    e.preventDefault();
    const startHeight = dom.getBoundingClientRect().height;
    const drag = {
      edge,
      startHeight,
      startClientY: e.clientY,
      // ⛔ THE VIEW'S `y`, WHICH IS `scrollTop` WITHOUT THE CLAMP (NEW-1). `topEdgeCompensation`
      // is unchanged and still pure — it is handed the same quantity it always was. What HAS
      // changed is that the quantity can now go negative, so the case that function exists to
      // work around (a browser silently clamping `scrollTop` at 0, which is why a top-edge
      // SHRINK had to open a margin instead of scrolling up) simply cannot arise any more.
      startScrollTop: viewRef.current.y,
      // Whatever margin-top the top edge has already grown, from an earlier gesture — this
      // drag ADDS to it (or gives it back) rather than starting over from 0, the same way a
      // width pin from one edge survives a later drag on the other (see `heightTopPadRef`'s own
      // header for why 0 is the only case that ever resets it).
      startTopPad: heightTopPadRef.current || 0,
      // Genuine content overflow only — NEVER the live minHeight, which already carries whatever
      // pin is active and would floor a shrinking drag against its own starting point (see the
      // measurement effect's own comment on `heightContentFloorRef`).
      baseGrowHeight: heightContentFloorRef.current || 0,
    };
    heightDragRef.current = drag;
    viewTouchedRef.current = true;          // as for the width grips — see `framedForRef`
    setHeightDragEdge(edge);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const liveHeightFor = (clientY) => {
      const rawDelta = edge === "bottom" ? clientY - drag.startClientY : drag.startClientY - clientY;
      return Math.max(dragHeightFromDelta(drag.startHeight, rawDelta), drag.baseGrowHeight);
    };
    /* The top edge's own "the other edge holds" illusion, for one live height — see this
     * function's header for why shrinking moves the PAGE (there is nothing above it to scroll
     * into) while growing rides the SCROLLER. The two are one continuous line, not two cases:
     * growing HANDS BACK any gap an earlier shrink opened before it spends any scroll, so the
     * ordinary shrink-then-grow-again round trip ends exactly where it started with no gap and no
     * leftover scroll. Only a grow past whatever gap was available needs the scroller at all. */
    const applyTopCompensation = (h) => {
      const next = topEdgeCompensation({
        startTopPad: drag.startTopPad,
        startScrollTop: drag.startScrollTop,
        delta: h - drag.startHeight,                               // + grew · − shrank
      });
      writeTopPad(next.topPad);
      setView({ ...viewRef.current, y: next.scrollTop });
    };
    /* B1609184 — give back the least scroll that puts the grip just dragged fully back inside the
     * mat's visible box, and nothing when it is already there. The visible box is the INTERSECTION
     * of the mat and the window: at a short window the mat's own element can extend past the
     * bottom of the screen (measured 480 tall in a 465 window), so the mat's rect alone is not
     * what a person can see. Scrolling UP moves content DOWN the screen, hence the subtraction. */
    const settleTopEdge = () => {
      const grip = noteRootRef.current?.querySelector('[data-testid="note-page-height-grip-top"]');
      if (!grip) return;
      const matRect = scroller.getBoundingClientRect();
      setView({ ...viewRef.current, y: scrollToReach({
        scrollTop: viewRef.current.y,
        gripTop: grip.getBoundingClientRect().top,
        visibleTop: Math.max(matRect.top, 0),
        gap: TOP_EDGE_REACH_GAP,
      }) });
    };
    /* ⛔ NEW-7 (B1344630) WAS SCOPED TO THIS TOO, AND REVERTED — READ BEFORE RE-ADDING IT. An
     * earlier draft auto-scrolled the mat as the BOTTOM edge grew, to keep the grip under the
     * pointer past the window's own bottom edge, the same trick `beginWidthDrag` uses on the
     * right. It broke the "opposite edge holds" invariant this whole feature is built on: unlike
     * the TOP edge (where the scroll and the `minHeight` grow by the SAME amount, so they cancel
     * for the top), a bottom-edge auto-scroll has nothing to cancel against — scrolling shifts
     * the WHOLE viewport, so the top edge visibly slid too. Measured in
     * `ui-audit/verify-notes-page-height.mjs` §16: a plain 60px bottom-edge drag at the owner's
     * own 1191×465 window (where the grip already rests within the auto-scroll margin of the
     * window's own bottom edge at REST) reported the top edge moving −171px on a drag that is
     * supposed to hold it. NEW-7's own report was about the WIDTH grips only ("I could NOT
     * distinguish 'the app clamps the width to the pane' from 'I ran out of screen'" — said of
     * dragging the page WIDER) — the height grips were never part of that report, so this stays
     * scoped to `beginWidthDrag` alone rather than partially reintroducing the same defect. */
    const onMove = (ev) => {
      const h = liveHeightFor(ev.clientY);
      dom.style.minHeight = `${h}px`;
      if (edge === "top") applyTopCompensation(h);
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      heightDragRef.current = null;
      setHeightDragEdge(null);
      if (!editor || editor.isDestroyed) return;
      const moved = Math.abs(ev.clientY - drag.startClientY) >= 1;
      if (!moved) return;                              // a click that did not drag writes nothing
      const h = liveHeightFor(ev.clientY);
      // Re-derive from the SAME `h` this commits, rather than trusting the last `onMove` call's
      // own read — `pointerup`'s own coordinates are the authoritative final position and can
      // differ from the last `pointermove` by a pixel, and a mismatch here is exactly the kind
      // of one-frame gap VIEWPORT-STABLE calls out.
      if (edge === "top") applyTopCompensation(h);
      const committed = Math.round(h);
      // The offset above now belongs to THIS height — see the measurement effect's own comment
      // on `heightPadOwnerRef`. Stamped for a BOTTOM-edge drag too, so dragging the bottom after
      // the top composes with the offset instead of dropping it and jumping the page.
      heightPadOwnerRef.current = committed;
      editor.commands.setNotePageHeight(committed);
      if (edge === "top") settleTopEdge();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [editor, writeTopPad, setView]);

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
      /* `doc: json` (NOTES-PAGE-GROWTH) — buildPrintDocument's own page-growth question needs the
         raw document, same as Notes.jsx's tree-print handler passes; this is the toolbar's
         single-page print button, a SEPARATE call site that was missed on the first pass and
         caught only by driving the real Print button rather than trusting the pure-function
         tests alone (`verify-notes-page-growth.mjs` §6). */
      pages: [{ title, html: docToHtml(json, images), updatedAt, doc: json }],
      density: json?.attrs?.density,          // PDF-PARITY: the sheet gets the note's own density
    });
    const r = await printHtmlDocument(html);
    if (!r.ok) onPrintNotice?.(r.error);
  }, [editor, title, updatedAt, trail, onPrintNotice]);

  /* ⛔ NEW-2 — see this component's own top-of-file note on why this is a ref rather than a
   * prop. Re-created only when the two functions themselves change, same discipline as any
   * other memoised value handed across a boundary. */
  useImperativeHandle(ref, () => ({ exportPage, printPage }), [exportPage, printPage]);

  /* ⛔ NEW-5 — read fresh every render (`shouldRerenderOnTransaction` already re-renders this
   * component on every editor transaction, `setNoteTitleStyle` included), never mirrored into
   * React state — the same "the editor is the one source of truth" rule the toolbar's own
   * active-state reads follow. */
  const titleStyleNow = (!editor || editor.isDestroyed) ? {} : (editor.state.doc.attrs?.titleStyle || {});

  const edited = editedLabel(updatedAt);

  /* ⛔ THE PAGE-LEVEL EMPTY STATE (NEW-1). True only while the document holds NOTHING that
   * paints — no box, no sketch. Computed inline off the live editor state rather than kept in
   * React state: `shouldRerenderOnTransaction: true` already re-renders this component on
   * every transaction, so a second piece of state here would just be a second thing that can
   * go stale. `doc.forEach` walks direct (TOP-LEVEL) children only, which is exactly what
   * matters — content nested inside a box is not "the page is empty" by definition. */
  const pageEmpty = !!editor && !editor.isDestroyed && (() => {
    let has = false;
    editor.state.doc.forEach((n) => { if (n.type.name === "noteAnchor") has = true; });
    return !has;
  })();

  /* ⛔ ARROWS BETWEEN BOXES (NEW-2) — the on-screen edges, recomputed at render time from the
   * live document rather than kept as a second piece of state. `shouldRerenderOnTransaction`
   * already re-renders this component on every transaction, including a box's move/resize
   * commit, so this stays current with no separate wiring — and it means an arrow tracks its
   * boxes once a drag COMMITS, not smoothly mid-drag (a stated, deliberate simplification: the
   * live-drag preview only ever mattered for the box being dragged, and it already moves). */
  const arrowEdges = !editor || editor.isDestroyed ? [] : (() => {
    const boxes = new Map();
    editor.state.doc.forEach((n) => {
      if (n.type.name === "noteAnchor" && n.attrs.aid) {
        boxes.set(String(n.attrs.aid), { x: n.attrs.x, y: n.attrs.y, w: n.attrs.w, h: n.attrs.h || ANCHOR_MIN_HEIGHT });
      }
    });
    const out = [];
    for (const a of editor.state.doc.attrs.arrows || []) {
      const from = boxes.get(String(a.from));
      const to = boxes.get(String(a.to));
      if (!from || !to) continue;
      const fromCentre = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
      const toCentre = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
      const p1 = arrowEdgePoint(from, toCentre.x, toCentre.y);
      const p2 = arrowEdgePoint(to, fromCentre.x, fromCentre.y);
      out.push({ key: `${a.from}→${a.to}`, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    }
    return out;
  })();

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
        onAttach={() => { pendingPick.current = "attachment"; pickRef.current?.click(); }}
        narrow={narrow}
        onBack={onBack}
        /* ⛔ NEW-6 — commits an armed block-placement before any toolbar command runs. See
           NoteToolbar.jsx's own top-of-file note for the defect this closes. */
        onBeforeAction={() => commitPendingPlace()}
        /* ⛔ NEW-5 — the title's own formatting lives on the DOCUMENT (`titleStyle`), but
           whether the BAR should currently be reading/writing it is a plain DOM-focus fact
           this component owns; the toolbar gets just the one boolean plus the size the title
           renders at when nothing has been set explicitly yet. */
        titleActive={titleActive}
        titleDefaultSize={noteTitleFontPx(narrow)}
        arrowMode={!!arrowConnect}
        onToggleArrow={toggleArrowMode}
      />
      {findReplaceOpen ? (
        <FindReplaceBar
          editor={editor}
          find={find}
          onClose={() => onCloseFindReplace?.()}
        />
      ) : (
        <FindBar term={find.term} count={find.count} index={find.index} onStep={stepFind} onClear={onClearSearch} />
      )}

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

      {/* ⛔ NEW-3 — a RELATIVE wrapper scoped to JUST the mat, so the floating zoom pill (and
          the page-setup popover) anchor to the CANVAS's own box rather than drifting when the
          Outline/History side panels (siblings of this wrapper, further down) open or close
          and change how much width is actually left for the mat. */}
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>

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
        /* ⛔ THE TWO PANS THAT WORK FROM ANYWHERE, INCLUDING ON TOP OF THE PAGE (NEW-1).
         * A plain left-drag on blank workspace already pans (the mat's own four-way gesture model
         * — docs/NOTES-CARRY-FORWARD.md §7, unchanged). These are the ones you need once you are
         * zoomed in far enough that there is no blank workspace on screen left to grab: MIDDLE
         * mouse, and SPACE held — Bluebeam's own two, and the Site planner's, so the two modules
         * feel the same. Claimed here on `pointerdown` and stopped, so the mat's own press rule
         * (which runs on the compat `mousedown`) never sees them and a pan can never place a
         * caret or start a marquee. */
        onPointerDown={(e) => {
          if (!(e.button === 1 || (e.button === 0 && spaceHeldRef.current))) return;
          e.preventDefault();
          e.stopPropagation();
          beginViewPan(e);
        }}
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
        data-arrow-mode={arrowConnect ? "1" : undefined}
        ref={scrollerRef}
        /* ⛔ B1203504 — `alignItems: "center"` is the WHOLE of how the sheet is centred: it is
           still `width: "100%"` capped by `maxWidth` below, so on a narrow pane it still fills
           the available width down to its own floor, and only once the pane is wider than the
           cap does centring have anything to do. See note-sheet's own comment for why this no
           longer reproduces B1369's "my stuff is aligned to the right" complaint.
           ⛔ NEVER ON NARROW — CAUGHT BY THE CRITIQUE LOOP'S OWN PHONE SCREENSHOT. The Outline
           panel (below) used to sit BESIDE the mat in the same row and not collapse on a
           phone, so the mat's own available width could end up narrower than the sheet's
           `minWidth` floor. Centring an item wider than its container overflows EQUALLY on both
           sides, and the scroller starts at its left edge, so the sheet's own left portion —
           the actual words — was the half that clipped off-screen: reproduced live, "No Density
           F[ield]" cut to "lo Density F". Left-aligning on narrow is the pre-existing, working
           shape (B1369's own layout), so this only changes behaviour on the wide panes centring
           was actually built for. ⛔ B1203505/B1215536 fixed both Outline and History — below
           the phone breakpoint neither one joins this row at all (Outline's own floating
           toggle, and History's existing toolbar button, each open a fixed overlay instead) —
           but this rule stays as the same defence against any OTHER future narrow-width
           sibling of the mat this row might grow.
           ⛔ AND A SECOND, SHARPER VERSION OF THE SAME TRAP SHOWS UP THE MOMENT THE PAGE GROWS AT
           ALL (NOTES-PAGE-GROWTH) — caught by re-measuring the actual gesture, not by reasoning
           about it: centring redistributes a GROWN sheet's extra width EQUALLY onto both its
           edges, so the sheet's own LEFT edge — everything already on the page, the title
           included — visibly slides left the instant a box near the margin makes the page grow,
           even though nothing about that content's OWN position changed. Measured live: placing
           one box shifted the whole page (and every word on it) 48px left in the same gesture
           that grew it 96px wider. That is "the page jumped," not "the page grew" — the exact
           class VIEWPORT-STABLE exists to forbid. So the sheet stops centring the MOMENT anything
           has grown it (`sheetGrowWidth != null`) rather than waiting until the grown page
           outgrows the whole pane: growing only ever adds room to the RIGHT of what was already
           there, and the pane-overflow case (this same rule, one door further) is already
           subsumed — a sheet wide enough to outgrow the pane was already wide enough to have
           grown at all. */
        /* ⛔ SUPERSEDED, AND THE COMMENT ABOVE IS KEPT BECAUSE IT NAMES A REAL DEFECT THIS MUST NOT
           REINTRODUCE (NOTES-FREE-PLACEMENT round 2, owner report 2026-09-08).
           The rule above — stop centring the MOMENT anything has grown the page — closed the jump
           it describes and opened a worse one: a grown sheet sits FLUSH against the pane's left
           edge, so the grey margin on the left becomes ZERO. Measured at every width, on the
           deployed build: ungrown, the sheet sits inside 276 of grey on each side; grown, the left
           gutter is 0 and `elementFromPoint` at the mat's own left edge answers `note-sheet`. With
           no left margin there is nothing to double-click in (the owner's "nothing is created at
           all") and nowhere to drag a box into (his "it lands at left: 18px"). The page could grow
           leftward in the model and you could not GET there.
           ⛔ THE JUMP IS NOW HANDLED BY MEASUREMENT RATHER THAN BY ABANDONING CENTRING — the
           layout effect above folds the body's own measured `offsetLeft` change into the scroller
           in the same frame, which did not exist when the rule above was written. So the sheet
           centres whenever it FITS (grown or not) and only left-aligns once it genuinely outgrows
           the pane, and even then it keeps a real gutter to work in. */
        style={{
          /* ⛔ THE VIEWPORT CLIPS; IT DOES NOT SCROLL (NEW-1). Everything inside it is placed by
             ONE transform on the workspace layer below, which is unbounded — so there is no
             `scrollWidth`, no `scrollLeft`, and nothing that can be clamped. That single fact is
             what retires `matPadX`, `matSidePads`, `matReachWidth` and `MAT_EXTRA_BOTTOM`: all
             four existed to manufacture reachable grey inside a bounded scroller, and an
             unbounded workspace has grey everywhere by construction. */
          flex: 1, minHeight: 0, overflow: "hidden", position: "relative",
          /* Nothing here may become a scroll container again — a nested scroller would reintroduce
             exactly the bounded resource this replaced. `overscrollBehavior` additionally stops a
             trackpad pan at the workspace's (non-existent) edge from turning into a browser
             back-swipe or a rubber-band on the page behind it. */
          overscrollBehavior: "none", touchAction: "none",
        }}
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
            ⛔ CENTRED, SUPERSEDING B1369 (B1203504 — see the critique-loop write-up on this
            item for the measured reasoning). B1369 centred a BARE, edgeless text column while
            a full-width toolbar sat above it — the only fixed reference point on screen was
            that toolbar, so a centred column with no visible boundary of its own read as
            "drifting right" as the window widened, because there was nothing ON the column
            itself to say "this is deliberately placed." The sheet is now a bounded CARD (a
            real border, radius and shadow — see its surface rules below): it carries its own
            visible edges, so centring it reads as "this is the page," exactly the way Craft,
            Bear, Notion and Google Docs all place a capped, centred document under a full-width
            chrome bar. The toolbar staying full-width above it is not a mismatch to fix; it is
            the same layout every one of those apps uses.
            AUDIT-FIRST: the alternative explanation — a right/centre TextAlign stuck on the
            paragraphs — was checked against the real stored documents and refuted; not one
            paragraph carries anything but the default. This is layout, not data. */}
        {/* ⛔ THE ZOOM IS ON THE SHEET AND NOWHERE ELSE (NEW-3) — not on the pane, which would
            scale the paste chip and the slash menu with it, and not on the app. `zoom` rather
            than a transform so the text RE-WRAPS at the new size and the caret stays the
            browser's own.
            ⛔ THE READING COLUMN HAS A FLOOR, AND THE PANELS BESIDE IT YIELD FIRST (B421492).
             Outline and History were each `flex: none` at a fixed width, so on a narrow window
             the SHEET absorbed the whole shortfall: opening History took the page from 424px to
             **156px** — the same sliver B391075 measured for a sketch inside a box — and the
             header's own status line then painted 96px outside it. A page narrower than a
             sentence is not a page. So the sheet may shrink but never below a readable column,
             and the two panels shrink before it does; if even that is not enough the ROW
             scrolls, which is honest, rather than the document quietly disappearing.
             ⛔ THE MEASURE CAP IS A MAX, NOT A WIDTH (B1203504) — `width: "100%"` still lets it
             shrink all the way to `minWidth` on a narrow pane or a phone; `maxWidth` is the only
             thing that changes, and it is what stops a line growing past a comfortable reading
             length no matter how wide the window gets (his own report: 87 characters on a
             1191px window, heading toward 200 on a 2382px one, with no ceiling at all before
             this). 580px MEASURED (not guessed) at this font-size and padding — a headless
             pass counting actual wrapped-line characters, not text-node length, which is its
             own trap: a paragraph's whole sentence is one text node regardless of how many
             visual lines it wraps across — holds a line safely under 75 characters (measured
             71–72), inside the 45–75 range and close to the 66 ideal, with the same discipline
             iA Writer is named for: the cap holds at ANY window width, it never grows past it. */}
        {/* ⛔ THE WORKSPACE LAYER — THE ONE THING THE VIEW TRANSFORM IS APPLIED TO (NEW-1).
            Everything the view moves lives inside it; everything that must NOT move with the view
            (the paste chip, the slash menu, the placement caret) is a sibling ABOVE it, in the
            viewport's own frame.
            ⛔ REACT DELIBERATELY DOES NOT SET `transform` HERE. `applyView()` owns that property
            outright and a layout effect re-asserts it after every render — see its own comment.
            Putting it in this style object would make a re-render the second writer, and two
            writers on one property is the exact shape of the judder round 2 shipped.
            ⛔ NO `willChange: transform`. It promotes the layer and makes Chrome rasterise ONCE and
            then STRETCH that bitmap for subsequent scales — which is precisely the "text goes
            blurry when you zoom" failure this design has to avoid. Without it the text is
            re-rastered at the composited scale and stays crisp at every level, which is the
            brief's own requirement (real vector scaling, never a scaled bitmap). */}
        <div
          ref={workspaceRef}
          data-testid="note-workspace"
          style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0" }}
        >
        <div
          data-testid="note-sheet"
          data-zoom={zoomPct}
          style={{
            /* ⛔ THE PAGE GROWS PAST THIS WHEN AN ANCHOR NEEDS MORE ROOM (NOTES-PAGE-GROWTH) — see
             * `sheetGrowWidth`, computed by the page-growth measurement effect below. `580` is
             * the page's own natural width; `sheetGrowWidth` OVERRIDES both `width` and
             * `maxWidth` together (a `width` alone would still be clipped by this `maxWidth`),
             * and is `null` — changing nothing here — the moment nothing needs the extra room.
             * A width PIN (NEW-1) also rides `sheetGrowWidth` — see the measurement effect's own
             * comment on `pinnedPageWidth` for why. */
            /* ⛔ THE SHEET IS PLACED IN WORKSPACE COORDINATES (NEW-1/NEW-2, 2026-09-21) — an
             * absolutely positioned card at (`sheetX`, 0) inside the workspace layer, NOT a flex
             * child of a scroller sized by `width: 100%` and a gutter.
             *
             * ⛔ AND THAT ONE CHANGE IS THE WHOLE OF THE NEW-2 FIX. `sheetX` is the page's LEFT
             * BOUNDARY and `sheetPadLeft` is the blank paper inside it, and the left grip moves
             * the two by the SAME amount in opposite directions — so the body's workspace
             * position, `sheetX + sheetPadLeft + SHEET_PAD_X`, is arithmetically unchanged while
             * the boundary visibly moves. The view is neither read nor written, so there is
             * nothing to compensate and nothing that can be clamped. Three rounds of scroll
             * compensation (B1740688, B1775312, B1801040) are deleted rather than tuned.
             *
             * ⛔ NO `zoom` HERE ANY MORE. The scale is the workspace layer's transform, applied
             * once to everything on the canvas. A second scale on this element would compound
             * with it and every coordinate read in this file would be measuring the product of
             * two numbers instead of one. */
            position: "absolute",
            left: sheetX,
            top: 0,
            width: `${sheetWidth}px`,
            minWidth: 260,
            /* ⛔ A REAL WRITING SURFACE, NOT A FIELD (B1203504) — his exact words, and defect #4
               of the review: the body painted transparent, sitting directly on the same grey
               the app chrome uses, so there was nothing on screen that said "this is a page."
               `--surface-raised` is the app's own established "white card over the grey desk"
               token pair (the same one the Model workspace's sheet uses, `SheetView.jsx`) — not
               a new color, the existing raised-card surface everywhere else in the app already
               uses, applied here for the first time. The border is a hairline; the shadow is
               deliberately soft (a whisper, not a modal) — Google Docs' and Craft's own weight,
               not a heavy drop shadow. */
            background: "var(--surface-raised)",
            border: "1px solid var(--border-default)",
            borderRadius: SHEET_RADIUS,
            boxShadow: "0 2px 6px rgba(0,0,0,0.10)", // design-exempt: no shadow-color token yet repo-wide (matches the Model workspace sheet card's own shadow, SheetView.jsx/TabStrip.jsx)
            /* The bottom pad already clears the browser's own chrome (96px); on a phone it
               must also clear the home indicator when this runs standalone (NEW-1, B849632) —
               `env()` reads 0 in an ordinary browser tab, so this changes nothing there.
               ⛔ PADDING IS NOW SYMMETRIC (B1203504) — the old 13px/20px left/right split
               existed only to line the sheet's left edge up with the toolbar's own inset, which
               centring (above) makes moot; a real page's margins read as a deliberate frame, not
               a leftover alignment hack. Widened on desktop to match the generosity the rest of
               this item gives the page — Craft/Bear both give a paragraph real room to breathe
               on every side, not just between lines. */
            /* ⛔ GROWING LEFT IS EXTRA PADDING ON THIS CARD (NOTES-FREE-PLACEMENT / NEW-1). The
               page reaches outward to contain a box; the document's own coordinates never move,
               so nothing is rewritten and nothing has to migrate. `0` in the ordinary case,
               shrinking straight back the moment nothing needs it, exactly as `sheetGrowWidth`
               already does on the right.
               ⛔ GROWING **UP** IS NO LONGER PADDING-TOP (B1433856, NOTES-TITLE-BAND-DEAD-ZONE) —
               it is `sheetGrowGap`, folded into the title band's own `marginBottom` below instead.
               Padding here sits BEFORE the band, so growing it used to shift the band and
               something placed level with the title (NEW-5) DOWN TOGETHER, never opening distance
               between them — which is how that box ended up rendering behind the band's own
               `<input>` instead of clear of it. See the measurement effect's comment on `growGap`
               for the full reasoning. */
            padding: narrow
              ? `${SHEET_PAD_TOP.narrow}px ${SHEET_PAD_X.narrow}px max(96px, calc(96px + env(safe-area-inset-bottom))) ${SHEET_PAD_X.narrow + sheetPadLeft}px`
              : `${SHEET_PAD_TOP.wide}px ${SHEET_PAD_X.wide}px 96px ${SHEET_PAD_X.wide + sheetPadLeft}px`,
            /* ⛔ AND THE TOP MARGIN IS WHERE A TOP-EDGE SHRINK MOVES THE PAGE (B1605664 ×2) —
               `sheetTopPad` is 0 in every ordinary state, so this renders exactly as it always
               has. It is a MARGIN and not a transform because the page's own bottom edge must
               stay put while its top moves: a transform would carry both edges down together.
               Flex items never margin-collapse, and `note-mat` is a column flex container, so
               this moves the page by exactly what was asked — see `heightTopPadRef`'s own header
               for the 16px-short measurement that rules margins out on the BODY but not here. */
            margin: narrow
              ? `${10 + sheetTopPad}px ${SHEET_MARGIN_X.narrow}px 0`
              : `${24 + sheetTopPad}px ${SHEET_MARGIN_X.wide}px 0`,
          }}
        >
          {/* ⛔ SET A PAGE'S OWN WIDTH BY HAND (NEW-1) — hidden on a phone: a phone page is
              already the width of the screen, and a 14px hit strip has no room to hide in
              beside real content there. `data-dragging` drives the CSS-only hover/active bar
              (see EDITOR_CSS) so no per-frame inline-style churn rides a drag. */}
          {!narrow && (
            <>
              <div
                className="planyr-page-width-grip planyr-page-width-grip-left"
                data-testid="note-page-width-grip-left"
                data-dragging={widthDragEdge === "left" ? "1" : "0"}
                role="separator"
                aria-orientation="vertical"
                aria-label="Drag to change the page's width"
                onPointerDown={beginWidthDrag("left")}
              />
              <div
                className="planyr-page-width-grip planyr-page-width-grip-right"
                data-testid="note-page-width-grip-right"
                data-dragging={widthDragEdge === "right" ? "1" : "0"}
                role="separator"
                aria-orientation="vertical"
                aria-label="Drag to change the page's width"
                onPointerDown={beginWidthDrag("right")}
              />
              {/* ⛔ SET A PAGE'S OWN HEIGHT BY HAND (NEW-1) — same reasoning as the two grips
                  just above, transposed onto the top/bottom edges. Hidden on a phone for the
                  identical reason: `!narrow` already gates this whole fragment. */}
              <div
                className="planyr-page-height-grip planyr-page-height-grip-top"
                data-testid="note-page-height-grip-top"
                data-dragging={heightDragEdge === "top" ? "1" : "0"}
                role="separator"
                aria-orientation="horizontal"
                aria-label="Drag to change the page's height"
                onPointerDown={beginHeightDrag("top")}
              />
              <div
                className="planyr-page-height-grip planyr-page-height-grip-bottom"
                data-testid="note-page-height-grip-bottom"
                data-dragging={heightDragEdge === "bottom" ? "1" : "0"}
                role="separator"
                aria-orientation="horizontal"
                aria-label="Drag to change the page's height"
                onPointerDown={beginHeightDrag("bottom")}
              />
            </>
          )}
          {/* ⛔ THE TITLE IS ITS OWN ROW, AND IT IS UNMISTAKABLY THE LARGEST TEXT ON THE PAGE
              (B1203504, defect #5). Before this, the title (27px) rendered SMALLER than an
              inline Heading 1 (28.5px) — the page's own name was outranked by a heading
              written inside it, backwards from every reference app. ⛔ FIRST DRAFT OF THIS
              FIX STILL FAILED THE CRITIQUE LOOP'S OWN QUESTION 5 — a screenshot at 36px title
              next to a 33px h1 (the scale's own first draft, 2.2em) read as "about the same
              size" at a glance, not "unmistakably." Two numbers moved together to fix it: h1
              came down to 2em (30px — still a full 2× jump over 15px body, and Bear's own H1
              is not much more than that either), and the title went up to 42px desktop / 34px
              phone — roughly 1.4× the biggest heading a document can contain, which is the
              ratio that actually reads as "this is the page, that is a heading in it" rather
              than two headings arguing. The metadata that used to share this row (which project,
              the zoom level, when it was last edited) now sits BELOW as its own quiet
              secondary line (defect #6) — every reference app named in this item's brief puts
              that information directly under the title, never floating far right on the same
              line with a large gap to the name. */}
          {/* ⛔ THE GAP BELOW THE BAND GROWS TO KEEP A BOX CLEAR OF IT (B1433856) — see the
              measurement effect's comment on `growGap`. `sheetGrowGap` is 0 in the ordinary case,
              so this is the same fixed `TITLE_BAND_GAP` it always was until something above the
              body's origin needs more room than that. */}
          <div style={{ marginBottom: TITLE_BAND_GAP + sheetGrowGap }}>
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
                display: "block", width: "100%", border: "none", borderBottom: "1px solid transparent",
                background: "transparent",
                /* ⛔ NEW-5 — the title's OWN formatting, read off the document attribute the
                   toolbar writes (`titleStyle`). A field left unset here keeps the module's
                   existing 700/-0.01em/ratio-based look exactly as it always rendered — this
                   only overrides what a person has explicitly picked. Superscript/subscript on
                   a single-line plain `<input>` can only ever be a WHOLE-FIELD effect (there is
                   no such thing as styling half the text in a native text input), which is the
                   same "whole title, never a sub-range" limit `setNoteTitleStyle`'s own header
                   states — `vertical-align` + a smaller size is the closest honest analogue. */
                color: titleStyleNow.color || "var(--text-primary)",
                backgroundColor: titleStyleNow.highlight || "transparent",
                fontWeight: titleStyleNow.bold ? 800 : 700,
                fontStyle: titleStyleNow.italic ? "italic" : "normal",
                textDecoration: [titleStyleNow.underline && "underline", titleStyleNow.strike && "line-through"].filter(Boolean).join(" ") || "none",
                verticalAlign: titleStyleNow.sup ? "super" : (titleStyleNow.sub ? "sub" : "baseline"),
                /* ⛔ THE TITLE MUST NOT CLIP (NEW-1, B849632). Reported off the owner's own
                   phone screenshot; measured, the cause wasn't the title's own size — it was
                   this whole pane being squeezed to ~40% of a 390px screen by the desktop
                   two-pane layout, which the drill-in above already fixes (the pane is now the
                   full width). This is the one further step: a smaller size on a phone gives a
                   real name more room to actually show on a 390px-class phone before the
                   input's own internal scroll takes over. */
                font: "inherit",
                fontSize: (titleStyleNow.sup || titleStyleNow.sub)
                  ? Math.round((titleStyleNow.fontSize || noteTitleFontPx(narrow)) * 0.7)
                  : (titleStyleNow.fontSize || noteTitleFontPx(narrow)),
                letterSpacing: "-0.01em",
                padding: "2px 0", outline: "none",
              }}
              onFocus={(e) => { e.target.style.borderBottomColor = "var(--accent-notes)"; setTitleActive(true); }}
              /* ⛔ THE DEFAULT NAME LANDS HERE, ON THE WAY OUT — never on a keystroke. See
                 renameNode's header for the measurement: coercing a blank name on every change
                 made the field impossible to clear, because the write came straight back into a
                 controlled input. Folded into the existing blur rather than added beside it —
                 two onBlur props on one element and the second silently wins. */
              onBlur={(e) => { e.target.style.borderBottomColor = "transparent"; setTitleActive(false); onTitleCommit?.(); }}
            />
            {/* ⛔ THE ZOOM LEVEL IS NOT SHOWN HERE ANY MORE (NEW-2, owner report 2026-09-06:
                "the zoom shouldn't be shown on the page"). It rendered as a real `<button>` inside
                `note-sheet` — the document itself, not chrome around it — which is a control
                sitting on the paper it is meant to control. It moved into `NoteToolbar` (below),
                beside History/Print/Export — "things you do TO the page" is that toolbar's own
                stated reason for that group, and this is exactly one more of those. Zoom itself
                is unchanged (Ctrl+wheel, Ctrl+=/-/0, and clicking the relocated pill still resets
                to 100%); only where its indicator sits moved. Same `data-testid="note-zoom-level"`
                on the relocated control, so nothing that already asks "is a level shown, and does
                it say what it is" had to change — only where it's rooted did. */}
            {(projectLabel || edited) ? (
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
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
                    // ⛔ THE NO-PROJECT CASE GETS ITS OWN SENTENCE (NEW-1, the banner-wording
                    // fix's audit of every project-name interpolation in this module) —
                    // projectLabel.name is "Not in a project" there, and "filed in Not in a
                    // project" is a phrase inside a phrase. Org scope is unaffected: its label
                    // ("Organization") reads fine in the same slot.
                    title={projectLabel.projectId == null && !projectLabel.org ? "This note has no project" : `This note is filed in ${projectLabel.name}`}
                    style={{
                      flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em",
                      color: projectLabel.resolved ? "var(--text-secondary)" : "var(--warn-text)",
                      border: `1px solid ${projectLabel.resolved ? "var(--border-default)" : "var(--warn-text)"}`,
                      borderRadius: RADIUS.pill, padding: "3px 9px",
                    }}
                  >{projectLabel.name}</span>
                ) : null}
                {edited ? (
                  <span
                    data-testid="note-edited"
                    title={absoluteStamp(updatedAt)}
                    style={{ flex: "0 0 auto", fontSize: 12, fontWeight: 600, color: "var(--text-tertiary)" }}
                  >{edited}</span>
                ) : null}
              </div>
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
            {/* ⛔ ARROWS BETWEEN BOXES (NEW-2) — same frame as `note-marquee` below ("the
                editor's own frame", i.e. document/note-body-relative pixels), so an arrow needs
                no coordinate conversion of its own: a box's stored `x`/`y`/`w`/`h` are already
                in this frame. `overflow: visible` because an arrow between two boxes can run
                past this element's own box on either axis; `pointerEvents: "none"` so it never
                steals a press meant for the page underneath it. Painted BELOW the boxes
                (lower z-index than `.planyr-anchor`'s 2) so a line never draws over a box's own
                words. */}
            {arrowEdges.length ? (
              <svg
                data-testid="note-arrows"
                aria-hidden="true"
                style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "visible", pointerEvents: "none", zIndex: 1 }}
              >
                <defs>
                  <marker id="planyr-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0L10 5L0 10z" fill="var(--accent-notes)" />
                  </marker>
                </defs>
                {arrowEdges.map((e) => (
                  <line
                    key={e.key}
                    x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                    stroke="var(--accent-notes)" strokeWidth={2}
                    markerEnd="url(#planyr-arrowhead)"
                  />
                ))}
              </svg>
            ) : null}
            {/* ⛔ "Double-click anywhere to start a note." (NEW-1) — the sheet's own empty
                state, replacing the per-paragraph placeholder that used to sit on the flow
                body's first line. `pointerEvents: "none"` is load-bearing: this sits ON TOP of
                the sheet, and a placeholder that ate the double-click meant to dismiss it
                would be the whole feature failing on its own first gesture. */}
            {pageEmpty ? (
              <div
                data-testid="note-empty-placeholder"
                aria-hidden="true"
                style={{
                  position: "absolute", left: 16, top: 3, pointerEvents: "none",
                  color: "var(--text-tertiary)", fontStyle: "italic", fontSize: "inherit",
                }}
              >
                Double-click anywhere to start a note.
              </div>
            ) : null}
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
        {/* ⛔ THE ARMED CARET (NEW-8). A press in the margin draws this and nothing else; the note
            itself does not exist until the first character. Positioned in the mat's own frame,
            which is why the mat is `position: relative`.
            ⛔ THE "Empty note discarded" TOAST THAT USED TO BE HERE IS GONE (NEW-9, owner
            decision 2026-09-08, reversing his own NEW-3 of the day before). It was a correct fix
            to the wrong problem: it announced the discarding of something that should never have
            been created. With the press no longer creating anything there is nothing to announce.
            ⛔ SAID PLAINLY, because he asked to be told rather than have the toast left in as
            insurance: one path can still produce an empty box — emptying an EXISTING note's text
            and clicking away. That box is one you made and then emptied yourself, it is visibly
            outlined the whole time, and the prune at the storage seam still takes it, silently, as
            it did before B1370546 existed. No toast covers that case any more. */}
        {pendingPlace ? (
          <div
            data-testid="note-pending-caret"
            className="planyr-pending-caret"
            style={{ left: pendingPlace.caret.left, top: pendingPlace.caret.top, height: pendingPlace.caret.height }}
          />
        ) : null}
        {/* ⛔ CLICK-TO-CONNECT'S OWN STATUS LINE (NEW-2) — the "visual feedback during the flow"
            the acceptance bar asks for, matching sketch mode's own status strip in spirit. */}
        {arrowConnect ? (
          <div
            data-testid="note-arrow-status"
            aria-live="polite"
            style={{
              position: "absolute", left: 16, top: 8, zIndex: 70, pointerEvents: "none",
              background: "var(--accent-notes)", color: "var(--on-accent)", fontSize: 12, fontWeight: 700,
              padding: "4px 10px", borderRadius: RADIUS.pill,
            }}
          >
            {arrowConnect.from == null ? "Click the box the arrow starts from." : "Click the box the arrow points to."}
          </div>
        ) : null}
        {/* ⛔ THE RIGHT-SIDE REACH SPACER IS GONE (NEW-1, 2026-09-21) — and so is `MAT_EXTRA_RIGHT`
            and `matReachWidth` with it. It existed to extend a bounded scroller's `scrollWidth` so
            there was somewhere off the page's right edge to drag a box to. The workspace is
            unbounded now: there is reach in every direction, always, with nothing to manufacture. */}
      </div>
      {/* ⛔ NEW-3 — THE ZOOM PILL. It used to be a toolbar chip that only rendered once the view
          drifted off 100% (PANEL-BREVITY — "100%" forever is furniture); as a permanent floating
          control that reasoning no longer applies (a control that vanishes right when someone
          reaches for it is worse than one that is merely often at its default), so it is always
          on screen now, bottom-right of the canvas, the way every other drawing tool anchors its
          zoom control. */}
      <ZoomPill
        pct={zoomPct}
        onZoomOut={() => zoomTo(stepZoom(viewRef.current.z, -1))}
        onZoomIn={() => zoomTo(stepZoom(viewRef.current.z, 1))}
        onPick={(z) => zoomTo(z)}
        onReset={resetView}
        onFitWidth={fitWidth}
      />
      {pageSetupOpen ? (
        <PageSetupPopover editor={editor} onClose={() => onClosePageSetup?.()} />
      ) : null}
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
          narrow={narrow}
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
          onClose={() => onCloseHistory?.()}
          narrow={narrow}
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
});

export default NoteEditor;
