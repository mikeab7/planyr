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

/** ⛔ THE TOP EDGE'S "THE OTHER EDGE HOLDS" RULE, AS ONE ANSWER (B1605664 ×2, 2026-09-15 — round 2 of that item).
 *
 *  The page only ever grows DOWNWARD (`dom.style.minHeight`), so a TOP-edge drag has to move
 *  something else to keep its promise that the edge you grabbed follows the pointer while the
 *  opposite edge stays put. Which "something else" is not a preference — each direction has
 *  exactly one thing that CAN move:
 *
 *   GROWING   the taller page has just made room BELOW, so scrolling the mat down by the growth
 *             puts the bottom edge back where it was and carries the top edge up with the
 *             pointer. Never clamped: the room provably exists, it was just created.
 *   SHRINKING the same trick backwards needs the mat to scroll UP past its own top, and a note
 *             page sits at `scrollTop === 0` essentially always. `scrollTop = -20` does not
 *             throw, it silently becomes 0 — which is the whole of B1605664: the height changed
 *             and the compensation didn't, so the page looked like it shrank from the bottom.
 *             So shrinking opens real space ABOVE the page instead (`topPad`, rendered as
 *             `note-sheet`'s own margin-top), which has no floor to clamp against.
 *
 *  ⛔ AND THEY ARE ONE LINE, NOT TWO CASES. Growing HANDS BACK any gap an earlier shrink opened
 *  before it spends a single pixel of scroll, so shrink-then-regrow lands exactly back where it
 *  started — no leftover gap above the page, no leftover scroll under it. Two independent
 *  branches would accumulate both, and the accumulation only shows up after the third or fourth
 *  gesture, which is exactly the kind of drift nobody reports as a bug.
 *
 *  @param startTopPad   the gap already open above the page when this drag began
 *  @param startScrollTop the mat's scroll position when this drag began
 *  @param delta         live height − height at drag start (positive grew, negative shrank)
 *  @returns {{ topPad: number, scrollTop: number }} both absolute, never deltas. */
export function topEdgeCompensation({ startTopPad = 0, startScrollTop = 0, delta = 0 } = {}) {
  const pad = Math.max(0, startTopPad || 0);
  return {
    topPad: Math.max(0, pad - delta),
    scrollTop: Math.max(0, (startScrollTop || 0) + Math.max(0, delta - pad)),
  };
}

/** ⛔ THE EDGE YOU JUST DRAGGED HAS TO STILL BE THERE TO GRAB (B1609184, 2026-09-15).
 *
 *  Growing from the top scrolls the mat, and a big enough grow scrolls the page's top edge — and
 *  the grip that lives on it — clean out of the visible area, where it cannot be grabbed again
 *  without scrolling back by hand. This gives back the LEAST scroll that brings the grip fully
 *  into view, and exactly nothing when it is already there, so a drag that ends in view never
 *  moves the picture. Scrolling up moves content down the screen, hence the subtraction.
 *
 *  It deliberately runs at RELEASE and never mid-gesture: the drag itself has to stay 1:1 with
 *  the pointer (that half is what the owner verified as correct), and the promise being kept is
 *  "the edge you are dragging stays reachable when the drag ends".
 *
 *  @param visibleTop the first row a person can actually SEE — the intersection of the scroller
 *                    and the window, never the scroller's own rect, which at a short window can
 *                    run off the bottom of the screen. */
export function scrollToReach({ scrollTop = 0, gripTop = 0, visibleTop = 0, gap = 0 } = {}) {
  const short = (visibleTop + gap) - gripTop;
  return short > 0 ? Math.max(0, scrollTop - short) : scrollTop;
}

export { clampHeight };
