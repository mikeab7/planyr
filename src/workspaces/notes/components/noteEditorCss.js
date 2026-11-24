/* noteEditorCss — the editor surface stylesheet, moved verbatim out of NoteEditor.jsx (audit batch L1). */
import { indentCssRules, listMarkerCssRules } from "../lib/notesIndentLevel.js";
import { RADIUS } from "../lib/notesControls.js";
import { FILL_INK } from "../lib/notesFormatPalette.js";
import { PASTE_ICON_CSS } from "./PasteIcons.jsx";

/* Editor surface styling. It lives here (rather than in src/index.css) so it rides the lazy
 * editor chunk instead of the app's first-paint stylesheet, and it is written entirely
 * against theme tokens so the document themes with the app.
 *
 * PDF-PARITY: lib/notesPrint.js mirrors this list construct for construct, on paper.
 * Add a construct here and add it there in the same commit. */

export const NOTE_BODY_FONT_PX = 11;

export const EDITOR_CSS = `
${PASTE_ICON_CSS}
/* ⛔ THE PASTE-OPTIONS FLYOUT (NEW-1, Office-style): square corners, a thin grey border, a small shadow; square icon
   buttons that go light blue when applied; a tooltip that names the option the way Word does. The halo behind each
   mark follows the button's own background (--paste-halo), so a hover or the pressed blue never leaves a white
   ring. Thumb-sized targets on a touch screen. No backticks in this comment. */
.planyr-paste-tab { display: flex; align-items: center; gap: 3px; padding: 1px 5px 1px 3px; border: none; background: transparent; color: var(--text-secondary); font: inherit; cursor: pointer; --paste-halo: var(--surface-raised); }
.planyr-paste-head { font-size: 12px; font-weight: 600; color: var(--text-primary); padding: 0 0 5px; }
.planyr-paste-group { font-size: 10.5px; font-weight: 700; color: var(--text-primary); padding: 5px 0 3px; }
.planyr-paste-row { display: flex; gap: 2px; flex-wrap: nowrap; }
.planyr-paste-btn { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 1px solid transparent; background: transparent; color: var(--text-primary); cursor: pointer; --paste-halo: var(--surface-raised); }
.planyr-paste-btn:hover, .planyr-paste-btn:focus-visible { background: var(--surface-page); border-color: var(--border-strong); outline: none; --paste-halo: var(--surface-page); }
.planyr-paste-btn[aria-pressed="true"] { background: var(--info-bg); border-color: var(--info-text); --paste-halo: var(--info-bg); }
.planyr-paste-tip { position: absolute; margin-top: 4px; padding: 3px 7px; background: var(--surface-raised); border: 1px solid var(--border-strong); color: var(--text-primary); font-size: 12px; white-space: nowrap; pointer-events: none; z-index: 41; }
@media (pointer: coarse) { .planyr-paste-btn { width: 44px; height: 44px; } .planyr-paste-tab { min-height: 44px; padding-left: 6px; padding-right: 8px; } }
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
/* A CELL FILL (NEW-2) is a solid content colour — the same in every theme — so a cell that carries one forces a
   dark ink on its unmarked text, or light-theme-pale-on-dark-theme-light-text would be unreadable. Text with its
   own colour mark is untouched (the mark is more specific than inheritance). "transparent" is not a fill. */
.planyr-note .ProseMirror table td[data-cell-fill]:not([data-cell-fill="transparent"]), .planyr-note .ProseMirror table th[data-cell-fill]:not([data-cell-fill="transparent"]) { color: ${FILL_INK}; }
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
/* ⛔ SELECTED IS A BORDER AND HANDLES, NEVER A FILL (NEW-3, owner 2026-10-30: clicking a box tinted
   the whole thing pink; he wants only the border and the handles). B421494 had added a faint wash
   so a set of nine read as one thing; the solid ring alone does that, and a wash also tinted the
   text under the selection highlight. It is a BORDER COLOUR on the existing border rather than an outline
   or a box-shadow: both of those paint outside the element's box, which would put chrome over the
   neighbouring box's controls and re-create the press-swallowing defect this module keeps hitting. */
.planyr-note .ProseMirror .planyr-anchor[data-selected="1"] { border-color: var(--accent-notes); border-style: solid; }
/* ⛔ A COPIED BOX WEARS EXCEL'S MOVING DASHED OUTLINE (NEW-1, 2026-11-15) — "marching ants", drawn on the box and only on a BOX copy (a text copy draws nothing).
   One pseudo-element hung just outside the frame: it takes no press (pointer-events none) and changes no layout. The dashes alternate the text colour and
   the page colour so they read on any theme; under reduced motion they hold still but stay dashed. No backticks in this block. */
.planyr-note .ProseMirror .planyr-anchor[data-copied="1"]::after { content: ""; position: absolute; inset: -4px; pointer-events: none; z-index: 4; border-radius: 6px;
  background:
    linear-gradient(90deg, var(--text-primary) 50%, var(--surface-raised) 0) 0 0 / 10px 2px repeat-x,
    linear-gradient(90deg, var(--text-primary) 50%, var(--surface-raised) 0) 0 100% / 10px 2px repeat-x,
    linear-gradient(0deg, var(--text-primary) 50%, var(--surface-raised) 0) 0 0 / 2px 10px repeat-y,
    linear-gradient(0deg, var(--text-primary) 50%, var(--surface-raised) 0) 100% 0 / 2px 10px repeat-y;
  animation: planyr-ants 0.5s linear infinite; }
@keyframes planyr-ants { to { background-position: 10px 0, -10px 100%, 0 -10px, 100% 10px; } }
@media (prefers-reduced-motion: reduce) { .planyr-note .ProseMirror .planyr-anchor[data-copied="1"]::after { animation: none; } }
/* ⛔ SELECTED AND EDITING MUST NOT LOOK IDENTICAL (B1555152 part 1, owner report 2026-09-11:
   "sometimes it takes a double click, sometimes it takes a click, it's actually kinda odd").
   Measured: before this rule, selected-alone and selected-plus-editing painted the exact same
   border colour/style and the exact same background wash — the ONLY difference anywhere was the
   mouse cursor glyph (grab vs text), which needs the pointer hovering the box to see and says
   nothing once the mouse has moved on. A box picked up (stage 1, Delete removes it) and a box you
   are actively typing in (stage 2) are two different things to be IN, and a glance has to be able
   to tell them apart without touching anything. Since NEW-3 (no fill on a selected box) editing is
   told apart by its heavier border alone — never a fill, never outline/box-shadow (see the note above: both paint outside the box and would swallow a
   neighbour's controls). */
.planyr-note .ProseMirror .planyr-anchor[data-editing="1"] { border-width: 2px; }
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"] { border-color: var(--border-default); border-style: dashed; }
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"]:focus-within { border-color: var(--accent-notes); }
.planyr-note .ProseMirror .planyr-anchor[data-empty="1"]:focus-within .planyr-anchor-content::after { content: "Type here"; position: absolute; left: 16px; top: 3px; pointer-events: none; color: var(--text-tertiary); font-style: italic; }
.planyr-note .ProseMirror .planyr-anchor-content { position: relative; }
/* ⛔ THE BORDER IS THE MOVE HANDLE (B2426788, owner decision 2026-10-27, "A" of four mockups: *"I
   like it that it only interacts by the edges"*). Four strips, one per side, each straddling the
   outline: 5 px outside the line, the line, 3 px inside it. A RING, never a filled rectangle — the
   middle of the box keeps select / enter / pan exactly as before — and the inside depth stays
   within the box's own padding (3 px top and bottom, 6 right, 16 left), so no strip ever covers a
   letter. The cursor is move (four arrows) over the whole band. It is there whether or not the box
   is selected or has the caret, which is the grip's whole old job: a box you have just typed into
   is still movable without pressing Escape. The resize handles paint ABOVE the strips (z-index 2
   vs 1), so each handle keeps its press and its directional cursor; everywhere else along the edge
   moves. Nothing is drawn off hover — the box looks as clean as before. touch-action: none so a
   finger on the band is a drag, not a page scroll. */
.planyr-note .ProseMirror .planyr-anchor-edge { position: absolute; z-index: 1; cursor: move; touch-action: none; }
.planyr-note .ProseMirror .planyr-anchor-edge-n { left: -6px; right: -6px; top: -6px; height: 9px; }
.planyr-note .ProseMirror .planyr-anchor-edge-s { left: -6px; right: -6px; bottom: -6px; height: 9px; }
.planyr-note .ProseMirror .planyr-anchor-edge-w { top: -6px; bottom: -6px; left: -6px; width: 9px; }
.planyr-note .ProseMirror .planyr-anchor-edge-e { top: -6px; bottom: -6px; right: -6px; width: 9px; }
/* Hover feedback: the pointer is on the band, so the outline thickens and darkens in the accent
   colour — "you have caught the edge". An INSET shadow adds the second pixel INSIDE the border
   box, so nothing reflows and nothing paints outside the box over a neighbour's controls (the
   reason outline / outer box-shadow are banned in this file). Held for the whole drag too. */
.planyr-note .ProseMirror .planyr-anchor:has(> .planyr-anchor-edge:hover),
.planyr-note .ProseMirror .planyr-anchor[data-edge-press="1"] { border-color: var(--accent-notes); border-style: solid; box-shadow: inset 0 0 0 1px var(--accent-notes); }
/* ⛔ THE CURSOR SAYS WHAT A PRESS ON THE BOX WILL DO (owner convention 2026-10-20, docs/DESIGN.md
   "Cursor convention"; it REPLACES NEW-2 point 3's open hand for a box's body). The four-arrow MOVE
   cursor belongs to a body that really drags, and keeps it for the whole drag (notesAnchorNode.js
   and NoteEditor pin it): that is a member of a MULTI-SELECTION (data-movable, painted beside
   data-selected). A single box's body does not drag on this build — press 1 selects, press 2 enters
   it, and a drag from an unselected body pans the page (B2156912, "click and drag should ALWAYS
   pan") — so an unselected box keeps the open hand, and it is the BORDER band (B2426788; always a drag,
   always a move) that carries the four-arrow cursor. The text cursor is for the one state where a press is about
   words rather than position: while the caret is inside this box. data-editing is painted from
   the editor's own two-stage state, and a box being edited is never also drawn as movable. */
.planyr-note .ProseMirror .planyr-anchor { cursor: grab; }
/* A SELECTED single box with words in it: the next press ENTERS it and puts the caret where it lands. */
.planyr-note .ProseMirror .planyr-anchor[data-selected="1"]:not([data-movable="1"]):has(.planyr-anchor-content p) { cursor: text; }
.planyr-note .ProseMirror .planyr-anchor[data-movable="1"] { cursor: move; }
.planyr-note .ProseMirror .planyr-anchor[data-selected="1"]:not([data-movable="1"]):has(.planyr-anchor-content p) .planyr-anchor-content { cursor: text; }
.planyr-note .ProseMirror .planyr-anchor[data-movable="1"] .planyr-anchor-content { cursor: move; }
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
.planyr-note .ProseMirror .planyr-anchor-h { z-index: 2; }   /* above the border band (z-index 1): a handle keeps its own press */
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
/* ⛔ ARMED CLICK-TO-CONNECT OWNS THE CURSOR OVER EVERYTHING IT CAN BE CLICKED ON — the mat, the sheet
   and every box on it (convention 2026-10-20). The rule used to name the mat alone, so the moment the
   pointer crossed onto a box or the page it read the box's own move/text/auto: crosshair on grey only. */
.planyr-note [data-testid="note-mat"][data-arrow-mode="1"],
.planyr-note [data-testid="note-mat"][data-arrow-mode="1"] * { cursor: crosshair !important; }
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
/* ⛔ SPACE HELD = THE HAND, BEFORE THE DRAG STARTS. data-space-pan was set on the mat and nothing read
   it, so the cursor stayed whatever the pointer was over until the first movement. Important, because
   the mat's descendants (boxes, sheet, edge grips) each set their own cursor. */
.planyr-note [data-testid="note-mat"][data-space-pan="1"],
.planyr-note [data-testid="note-mat"][data-space-pan="1"] * { cursor: grab !important; }
.planyr-note [data-testid="note-mat"][data-panning="1"],
.planyr-note [data-testid="note-mat"][data-panning="1"] * { cursor: grabbing !important; }
/* A TABLE'S COLUMN BORDER. ProseMirror-tables toggles resize-cursor on the editor root while the
   pointer is inside the border's hit zone, but nothing styled it, so the only cue was the 4px
   handle sliver (which also lost to the box's own cursor). Important: the box and its cells each
   set their own cursor. Not while a pan/arrow mode owns the pointer (their rules above are
   important too and come later in source order for panning; arrow mode never resizes). */
.planyr-note .ProseMirror.resize-cursor, .planyr-note .ProseMirror.resize-cursor * { cursor: col-resize !important; }
.planyr-note [data-testid="note-mat"][data-panning="1"] .ProseMirror.resize-cursor,
.planyr-note [data-testid="note-mat"][data-panning="1"] .ProseMirror.resize-cursor * { cursor: grabbing !important; }
/* A TABLE'S ROW LINE (NEW-3) — the horizontal twin of the rule above; the class is toggled by lib/notesTableRowHeight.js. */
.planyr-note .ProseMirror.planyr-row-resize, .planyr-note .ProseMirror.planyr-row-resize * { cursor: row-resize !important; }
.planyr-note [data-testid="note-mat"][data-panning="1"] .ProseMirror.planyr-row-resize,
.planyr-note [data-testid="note-mat"][data-panning="1"] .ProseMirror.planyr-row-resize * { cursor: grabbing !important; }

/* ⛔ NEW-6d — FINGER-SIZED TARGETS. On a coarse pointer the eight resize handles (10 px), the connect dot
   (11 px) and the sheet edge grips (left alone, see the note). The VISIBLE size is unchanged: each handle
   gets an invisible 44 px hit area centred on itself (a pseudo-element is part of its element for
   hit-testing). Mouse pointers never match this block. */
@media (pointer: coarse) {
  /* Halos exist only on the SELECTED box, and they must never sit over the box's TEXT: a tap on the first
     letters is a caret placement (NEW-3) and a tap on the grey is a pan (NEW-2). The resize / connect
     halos are centred on their dots, so they are off while the box is being edited. */
  .planyr-note .ProseMirror .planyr-anchor[data-selected="1"]:not([data-editing="1"]) .planyr-anchor-h::after,
  .planyr-note .ProseMirror .planyr-anchor[data-selected="1"]:not([data-editing="1"]) .planyr-anchor-connect::after {
    content: ""; position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; transform: translate(-50%, -50%);
  }
  /* The border band is the finger's way to move a box (B2426788), so on a SELECTED box it reaches
     further OUT onto the paper (15 px beyond the line) and no further in — never over the text. The
     handles' halos (z-index 2) outrank it at their own spots, so a corner still resizes. */
  .planyr-note .ProseMirror .planyr-anchor[data-selected="1"] .planyr-anchor-edge-n { top: -16px; height: 19px; }
  .planyr-note .ProseMirror .planyr-anchor[data-selected="1"] .planyr-anchor-edge-s { bottom: -16px; height: 19px; }
  .planyr-note .ProseMirror .planyr-anchor[data-selected="1"] .planyr-anchor-edge-w { left: -16px; width: 19px; }
  .planyr-note .ProseMirror .planyr-anchor[data-selected="1"] .planyr-anchor-edge-e { right: -16px; width: 19px; }
  /* The sheet's EDGE grips are deliberately NOT enlarged: they sit where a page-edge tap places a box, and
     every enlargement tried (44 px symmetric, then 36 px outward-only) moved a first letter off the finger
     by 5 px at 200% zoom in verify-notes-touch-landing. Resizing a page is a deliberate desktop-style act. */
}
`;
