/* notesPageHeight — SET A NOTE PAGE'S OWN HEIGHT BY HAND (NEW-1, owner decision 2026-09-12,
 * after seeing the side-edge width drag ship in B1561104, PR 1662): *"If the sides are
 * draggable the top and bottom should too."* That PR deliberately left the bottom edge
 * undraggable, citing B391073 ("a text box's height is its words") as needing an owner
 * conversation first — B391073 governs a placed TEXT BOX, never the page sheet itself, and the
 * owner has now settled the question for the sheet.
 *
 * ⛔ IT RIDES THE EXACT SAME MECHANISM THE WIDTH PIN DOES, DELIBERATELY (notesPageWidth.js's own
 * header, reused rather than re-argued): a `doc`-level ProseMirror attribute, set through
 * `setDocAttribute`, is saved, synced, printed and exported for free — see notesExtensions.js's
 * `pageHeight` attribute and `setNotePageHeight` command. `null` is Fit to content (the
 * pre-existing, unchanged behaviour — the body's own `max(46vh, need)` floor in
 * NoteEditor.jsx); a plain number is a pinned floor, in the SAME screen-CSS-pixel coordinate
 * space `anchorExtent`'s own `need` already lives in (NoteEditor.jsx sets `dom.style.minHeight`
 * directly, so the pin is expressed in exactly the units that property already takes).
 *
 * ⛔ THERE IS DELIBERATELY NO PRESET LADDER HERE, UNLIKE WIDTH — the owner did not ask for one
 * ("Fit to content plus Custom is enough"), so this module is smaller than notesPageWidth.js on
 * purpose: no `PAGE_HEIGHT_PRESETS`, no `"full"` literal, no pane-relative resolution. Fit to
 * content (`null`) and a dragged Custom number are the whole vocabulary.
 *
 * ⛔ A PIN IS A FLOOR, NEVER A CAP — same rule the width pin already follows. Content taller than
 * the pin (an anchored box needing more room than the pin allows) still grows the page past it;
 * NoteEditor.jsx's measurement effect takes `Math.max(pinnedHeight, need)`, the vertical twin of
 * the width effect's `Math.max(effectivePageWidth, needX)`.
 *
 * Pure and DOM-free on purpose, mirroring notesPageWidth.js: NoteEditor.jsx uses it live, and
 * lib/notesPrint.js (which must stay free of `@tiptap/*`) uses the same numbers for PDF-PARITY.
 */

/** The shortest a hand-dragged height may resolve to — short enough to still be a page, not so
 *  short it reads as a sliver. Real flowing text is never clipped by this (a CSS `min-height`
 *  only ever holds a SHORT page open; it cannot shrink one that is already taller), so this only
 *  ever bounds how far a drag may shrink an otherwise-empty page. */
export const PAGE_HEIGHT_MIN = 160;

/** A ceiling so a stray huge drag (or a corrupted stored value) cannot wedge a page absurdly
 *  tall forever — generous past any real working page, so it never fires in ordinary use. */
export const PAGE_HEIGHT_MAX = 8000;

const clampHeight = (n) => Math.round(Math.max(PAGE_HEIGHT_MIN, Math.min(PAGE_HEIGHT_MAX, n)));

/** The short word a closed menu trigger shows (PANEL-BREVITY) — mirrors `pageWidthLabel`, minus
 *  the preset names this module does not have. */
export function pageHeightLabel(pageHeight) {
  return pageHeight == null ? "Fit to content" : "Custom";
}

/** ⛔ THE ONE ANSWER NoteEditor.jsx's MEASUREMENT EFFECT NEEDS: given the stored attribute, what
 *  floor (if any) should stand in for the unpinned `max(46vh, need)` default this run? `null` —
 *  unpinned, "Fit to content" — is passed straight back so the caller's own existing default is
 *  untouched. */
export function resolvePinnedBaseHeight(pageHeight) {
  if (pageHeight == null) return null;
  const n = typeof pageHeight === "number" ? pageHeight : parseFloat(pageHeight);
  return Number.isFinite(n) ? clampHeight(n) : null;
}

/** A live drag's pointer delta → the height it is asking for, floored/ceilinged the same way a
 *  commit will be. Kept as one function so the live preview and the eventual commit can never
 *  disagree about where the limits are — the same reasoning `dragWidthFromDelta` uses. */
export function dragHeightFromDelta(startHeight, deltaPx) {
  return clampHeight(startHeight + deltaPx);
}

export { clampHeight };
