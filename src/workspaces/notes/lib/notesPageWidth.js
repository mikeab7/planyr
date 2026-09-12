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
 *  box and somewhere to drop one (MAT_GUTTER's own reasoning in NoteEditor.jsx, reused). */
export const FULL_WIDTH_GUTTER = 24;

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
