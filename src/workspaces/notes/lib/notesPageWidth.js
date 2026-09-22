/* notesPageWidth — SET A NOTE PAGE'S OWN WIDTH BY HAND (NEW-1, owner report 2026-09-11).
 *
 * ⛔ HIS ASK: *"I want to be able to just expand the page itself by, like, clicking something or,
 * like, maybe there's borders on it that I can hover over and drag."* Two entry points into ONE
 * stored value: a page menu preset (Narrow/Normal/Wide/Full/Fit to content) and dragging either
 * side edge of the sheet.
 *
 * ⛔ IT RIDES THE DOCUMENT, THE SAME WAY DENSITY DOES (NEW-SPACING-3's own reasoning, reused
 * rather than re-argued): a `doc`-level ProseMirror attribute, set through `setDocAttribute`, is
 * saved, synced, printed and exported for free, and needs no tree schema, no
 * `migratePageNode` entry and no cloud-merge change. See notesExtensions.js's `pageWidth`
 * attribute and `setNotePageWidth` command.
 *
 * ⛔ THE STORED VALUE IS THE SHEET'S OWN TARGET WIDTH, IN THE SAME SCREEN-CSS-PIXEL UNITS
 * `SHEET_MAX_WIDTH` already uses in NoteEditor.jsx — `null` (Fit to content, the default: the
 * unpinned 580px baseline, still free to grow further for an overflowing box or table exactly as
 * it does today), the literal string `"full"` (fill the pane, resolved against whatever width the
 * pane actually has right now), or a plain number (a preset's own px, or whatever a drag last
 * committed).
 *
 * ⛔ A PIN IS A FLOOR, NEVER A CAP — the owner's own instruction, verbatim in the brief: content
 * wider than the pin still pushes the sheet wider, exactly as an overhanging box or a wide table
 * already does against the unpinned 580px baseline. This module only answers "what is the
 * BASELINE before that existing growth math runs" — NoteEditor.jsx's page-growth measurement
 * effect substitutes `resolvePinnedBaseWidth`'s answer for the constant `SHEET_MAX_WIDTH` it used
 * to use unconditionally, and every downstream computation (`anchorExtentX`, a table's own
 * `anchorExtentX`-style extent, `anchorExtentLeft`) is completely unchanged — the same
 * NOTES-PAGE-GROWTH / NOTES-FREE-PLACEMENT machinery this module deliberately does not duplicate.
 *
 * Pure and DOM-free on purpose, mirroring `notesBoxResize.js`/`notesTableWidth.js`: NoteEditor.jsx
 * uses it live, and lib/notesPrint.js (which must stay free of `@tiptap/*`) uses the same numbers
 * for PDF-PARITY.
 */

/** The narrowest a hand-dragged or preset-picked width may resolve to — a column somebody can
 *  still comfortably write in, the same reasoning `ANCHOR_MIN_WIDTH` uses for a placed box
 *  (notesBoxResize.js), just wider: a whole PAGE reads as broken far sooner than a small box does. */
export const PAGE_WIDTH_MIN = 320;

/** A ceiling so a stray huge drag (or a corrupted stored value) cannot wedge a page absurdly
 *  wide forever — chosen generously past anything a real "Full width" resolves to on any
 *  realistic monitor, so it never fires in ordinary use. */
export const PAGE_WIDTH_MAX = 2400;

/** How much clear grey pane must remain on each side of a "Full width" page — it fills the pane,
 *  it does not press its own edges against it, so there is still somewhere to double-click a new
 *  box and somewhere to drop one (MAT_GUTTER's own reasoning in NoteEditor.jsx, reused).
 *
 *  ⛔ SHRUNK 24 → 8 (B1344624, owner report 2026-09-15). At the owner's own ~1191px working
 *  window (pane ≈ 923px with the Pages rail open, Outline closed), the OLD 24px×2 = 48px gutter
 *  put "Full width"'s own computed number (paneWidth − 48 ≈ 875) BELOW `FULL_WIDTH_FLOOR` (900,
 *  Wide's own fixed width) on nearly every ordinary window — so `resolvePresetPx`'s floor always
 *  won, and Full width rendered at the EXACT SAME 900px as Wide, every time: "the two presets are
 *  indistinguishable on every page tried." The floor (below) is still correct and still the right
 *  safety net for a genuinely narrow pane — this only narrows the gutter it has to overcome, so a
 *  pane with real room to give (923 − 16 = 907) reports a genuinely different, genuinely
 *  pane-tracking number instead of silently falling back to the same constant Wide already is. An
 *  8px margin is still enough to land a double-click and to drop a dragged box — it was never
 *  load-bearing for more than "not flush against the glass." */
export const FULL_WIDTH_GUTTER = 8;

/** The menu's fast path. `px` is a plain number for every preset except `full`, which has no
 *  fixed number — it is resolved against the pane at render time. `normal` intentionally matches
 *  the unpinned default (`SHEET_MAX_WIDTH` in NoteEditor.jsx) so picking it is a real, persistent
 *  pin rather than a no-op with a different name — the difference from "Fit to content" is that a
 *  Normal pin stays put even if a later session's default ever changes, while "Fit to content"
 *  always tracks whatever the app currently calls normal. */
export const PAGE_WIDTH_PRESETS = [
  { id: "narrow", label: "Narrow", px: 440 },
  { id: "normal", label: "Normal", px: 580 },
  { id: "wide", label: "Wide", px: 900 },
  { id: "full", label: "Full width", px: "full" },
];

/** ⛔ FULL WIDTH MUST NEVER READ NARROWER THAN THE WIDEST FIXED PRESET (B1561105, owner report
 *  2026-09-11). Every fixed preset (Narrow/Normal/Wide) ignores the pane entirely — `resolvePresetPx`
 *  said so on purpose — while "Full width" independently computed `paneWidth - gutter`. On a
 *  window only a little wider than Wide's own fixed 900, that pane-relative number came out
 *  SMALLER than 900: measured live at a ~1190px browser window, Wide rendered its column at
 *  818 while Full width rendered 793 — narrower, so the last option in the menu read as a step
 *  DOWN from the one above it. Derived from `PAGE_WIDTH_PRESETS` itself (never a second literal
 *  900) so a future preset wider than today's Wide stays the floor automatically. Below this
 *  floor, "Full width" overflows the pane exactly the way an oversized box or table already
 *  does — `note-mat`'s own `overflow: auto` already scrolls for that case, so this is not a new
 *  mechanism, only a new place that reaches it. */
export const FULL_WIDTH_FLOOR = Math.max(
  ...PAGE_WIDTH_PRESETS.filter((p) => typeof p.px === "number").map((p) => p.px),
);

const clampWidth = (n) => Math.round(Math.max(PAGE_WIDTH_MIN, Math.min(PAGE_WIDTH_MAX, n)));

/** The preset row a stored value matches exactly, or `null` for "Fit to content" (`pageWidth ==
 *  null`) or a custom (dragged) width — a menu control needs this to know which row, if any, to
 *  highlight. */
export function pageWidthPresetId(pageWidth) {
  if (pageWidth == null) return null;
  const hit = PAGE_WIDTH_PRESETS.find((p) => p.px === pageWidth);
  return hit ? hit.id : null;
}

/** The short word a closed menu trigger shows (PANEL-BREVITY) — a real preset's own name, "Fit to
 *  content" for `null`, or "Custom" for a dragged width that does not match any preset. */
export function pageWidthLabel(pageWidth) {
  if (pageWidth == null) return "Fit to content";
  const preset = pageWidthPresetId(pageWidth);
  if (preset) return PAGE_WIDTH_PRESETS.find((p) => p.id === preset).label;
  return "Custom";
}

/** Resolve a preset's own `px` (a number, or the string `"full"`) against the space this
 *  particular pane actually has right now. `null`/`"full"` need `paneWidth`; every other preset's
 *  `px` is already the answer. Used by BOTH the toolbar (to compute what a click should commit)
 *  and the measurement effect (to compute what is already committed).
 *
 *  ⛔ "full" IS FLOORED AT `FULL_WIDTH_FLOOR` (B1561105) — see that constant's own header. Without
 *  it, a pane only a little wider than Wide's own fixed width made `paneWidth - gutter` smaller
 *  than Wide, inverting the last two rows of the menu. */
export function resolvePresetPx(px, { paneWidth = 0 } = {}) {
  if (px === "full") return clampWidth(Math.max(paneWidth - FULL_WIDTH_GUTTER * 2, FULL_WIDTH_FLOOR));
  return clampWidth(px);
}

/** ⛔ THE ONE ANSWER NoteEditor.jsx's MEASUREMENT EFFECT NEEDS: given the stored attribute and the
 *  pane's current width, what SHEET width should stand in for the unpinned `SHEET_MAX_WIDTH`
 *  constant this run? `null` — unpinned, "Fit to content" — is passed straight back so the
 *  caller's own existing `SHEET_MAX_WIDTH` fallback is untouched.
 *
 *  ⛔ CORRECTED (B1561105) — an earlier version of this comment claimed every pin "never returns
 *  wider than the pane allows." That was never true of a NUMERIC pin (Narrow/Normal/Wide, or a
 *  completed drag): those ignore the pane entirely, by design — `resolvePresetPx`'s own test
 *  pins it as "a plain-number preset ignores the pane entirely." A pin is a FLOOR the same way
 *  real content already is (see this file's own header): the numeric presets are meant to hold
 *  their literal width and let the pane's own scrolling (already wired for an oversized box or
 *  table) take up any slack, never quietly shrink themselves. Only `"full"` is genuinely
 *  pane-relative, and even it now has its own floor — see `FULL_WIDTH_FLOOR`. */
export function resolvePinnedBaseWidth(pageWidth, { paneWidth = 0 } = {}) {
  if (pageWidth == null) return null;
  if (pageWidth === "full") return resolvePresetPx("full", { paneWidth });
  const n = typeof pageWidth === "number" ? pageWidth : parseFloat(pageWidth);
  return Number.isFinite(n) ? clampWidth(n) : null;
}

/** A live drag's pointer delta → the width it is asking for, floored/ceilinged the same way a
 *  commit will be. Kept as one function so the live preview and the eventual commit can never
 *  disagree about where the limits are. */
export function dragWidthFromDelta(startWidth, deltaPx) {
  return clampWidth(startWidth + deltaPx);
}


/* ═══ THE TWO EDGE-DRAG DECISIONS (NEW-2, fourth round, 2026-09-21) ═══════════════════════════
 *
 * ⛔ THESE REPLACE `leftWidthGripPad` AND `matSidePads`, AND THE REPLACEMENT IS THE FIX — read
 * `notesViewport.js`'s header before changing either of them.
 *
 * Both of those functions existed to answer one question: *how do we hold the words still while
 * the sheet's own position inside a SCROLLER changes underneath them?* The answer was always a
 * compensation — first a raw scroll (round 2, double-applied, read as judder), then a scroll plus
 * a gutter raid plus a right-padding top-up (round 3, clamped at zero on a narrow page, read as
 * creep). **On a transform workspace the question does not arise**: the sheet is absolutely
 * positioned at a workspace coordinate, so moving its left edge and growing its left padding by
 * the same amount leaves the body's workspace position *arithmetically unchanged*. There is
 * nothing to compensate, so these two functions decide geometry only and never touch the view.
 *
 * ⛔ THE PAGE HAS TWO INDEPENDENT NUMBERS NOW, AND SEPARATING THEM IS WHAT MAKES THE LEFT EDGE
 * EXPRESSIBLE AT ALL:
 *   · `pageWidth`      — the COLUMN: how wide the writing area is. What every stored page already
 *                        means by this attribute, unchanged, so nothing migrates.
 *   · `pageMarginLeft` — the BLANK PAPER to the left of the column. New, defaults to 0, so a page
 *                        written before it existed parses back byte-identical.
 * The sheet's rendered width is their sum. A left-edge drag spends the margin; a right-edge drag
 * spends the column. That is the whole model.
 *
 * ⛔ AND IT IS PERSISTED, WHICH THE OLD PAD WAS NOT. `widthDragLeftPadRef` was a React ref: the
 * blank margin a drag opened vanished on reload and the page silently re-rendered narrower than
 * the owner left it. As a doc attribute it rides storage, sync, print and export for free —
 * `pageWidth`'s own reasoning, reused rather than re-argued.
 */

/** The narrowest the writing COLUMN may be squeezed to by a left-edge drag eating into it. Same
 *  reasoning and same number as `PAGE_WIDTH_MIN`, named separately only so a reader of
 *  `leftEdgeDrag` does not have to go and check that the two are meant to be the same thing. */
export const PAGE_COL_MIN = PAGE_WIDTH_MIN;

/** ⛔ THE LEFT BOUNDARY FOLLOWS THE POINTER, AND WHAT IT SPENDS DEPENDS ON WHAT IS THERE.
 *
 *  The owner's sentence, restated across all three prior rounds: *"only the left boundary line
 *  moves outward, opening new blank space to the left of the content."* Widening therefore opens
 *  BLANK PAPER and moves nothing else — not the words, not the boxes, not the right edge.
 *
 *  Narrowing is the same rule read backwards, and it has a second half the earlier rounds never
 *  stated: once the blank paper is used up the boundary has nowhere left to go but INTO the
 *  column, so the column narrows and the text goes with it. That is not a defect — it is what
 *  dragging a margin marker into your own text does in every word processor — but it IS a
 *  different promise from "nothing moves", so the amount is returned explicitly as
 *  `contentShift` rather than left for a caller to infer.
 *
 *  ⛔ WHAT THE PREVIOUS BEHAVIOUR DID INSTEAD, so this is not read as a gratuitous change:
 *  narrowing from the LEFT grip moved the RIGHT edge. Measured on `origin/main`, a 160px
 *  left-grip narrow on a 900 page: left edge unmoved, right edge 160px in. You grabbed one
 *  boundary and a different one moved — caught by the width matrix's own "the opposite edge
 *  holds" row (3a/3b), which no previous harness asked.
 *
 *  @param marginLeft the blank paper already open to the left (0 on a fresh page).
 *  @param colWidth   the writing column's current width.
 *  @param delta      how far the left boundary moved OUTWARD (+ widens, − narrows).
 *  @returns {{ marginLeft: number, colWidth: number, contentShift: number }} — `contentShift` is
 *  how far the body's own left edge moves RIGHT as a result, and is 0 for every widening and for
 *  every narrowing that still has blank paper to spend.
 */
export function leftEdgeDrag({ marginLeft = 0, colWidth = 0, delta = 0 } = {}) {
  const m0 = Math.max(0, num(marginLeft));
  const c0 = Math.max(0, num(colWidth));
  const d = num(delta);
  if (d >= 0) return { marginLeft: m0 + d, colWidth: c0, contentShift: 0 };
  const want = -d;
  const fromMargin = Math.min(want, m0);
  const rest = want - fromMargin;
  const col = Math.max(PAGE_COL_MIN, c0 - rest);
  return { marginLeft: m0 - fromMargin, colWidth: col, contentShift: c0 - col };
}

/** ⛔ THE RIGHT BOUNDARY SPENDS THE COLUMN, and the left edge never moves for it.
 *
 *  Symmetric to `leftEdgeDrag` in the property that matters (the edge you did not grab does not
 *  move) but deliberately NOT symmetric in what it spends: the page's blank paper is on the left,
 *  because that is the side the owner asked for it on. Widening rightward makes the writing
 *  column wider, which is what the width feature is for; it does not open blank paper on the
 *  right that nothing can ever be put in.
 *
 *  @param delta how far the right boundary moved OUTWARD (+ widens, − narrows).
 */
export function rightEdgeDrag({ colWidth = 0, delta = 0 } = {}) {
  const c0 = Math.max(0, num(colWidth));
  return { colWidth: clampWidth(c0 + num(delta)) };
}

/** The sheet's own rendered width, from the two numbers that decide it. One function so the
 *  live drag, the measurement pass and the print serializer can never disagree (PDF-PARITY). */
export function sheetWidthFor({ marginLeft = 0, colWidth = 0 } = {}) {
  return Math.max(0, num(marginLeft)) + Math.max(0, num(colWidth));
}

/** A stored left margin, normalised. `null`/absent/corrupt all mean "no blank paper", which is
 *  what every page written before this attribute existed has. Ceilinged so a corrupt value cannot
 *  push the column off the workspace entirely. */
export function normalizePageMargin(value) {
  const n = num(value, 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(PAGE_WIDTH_MAX, n));
}

function num(v, d = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : d;
}
