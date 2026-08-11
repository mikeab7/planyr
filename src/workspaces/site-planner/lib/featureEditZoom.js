/* NEW-1 — WHEN THE ON-BUILDING EDIT CONTROLS MAY EXIST AT ALL.
 *
 * THE ORIGINAL REPORT (owner, on Bain / "Concept - Original", 109 acres, the whole site in the
 * viewport with the scale bar reading 0–1,000 ft): "the plus and minus buttons here show up way too
 * early… I shouldn't be zoomed out this far and they show up. I should have to zoom in more." The
 * green + and red − sat at full size over Buildings 3 and 4 — the largest objects on a plan he was
 * trying to READ — while the bump-out one of them adds was a few pixels wide.
 *
 * ⛔ WHY THE EXISTING GATE COULD NOT SEE THIS. `FEAT_BTN_MIN_PX` (B225) asks whether the building's
 * own wall is big enough on screen to seat the cluster without it spilling past the footprint. That
 * is a real question and it still holds — it is just a question about the CONTAINER. A 900 ft
 * building clears a 72 px wall at almost any zoom a site plan is read at, so on a large industrial
 * building B225's gate is satisfied from the moment the plan fits the screen. The two gates measure
 * different things and BOTH must pass:
 *   B225   — is there room on this building for the control?   (footprint px, relative)
 *   NEW-1  — is the EDIT this control makes legible yet?       (feet per pixel, absolute)
 *
 * ⛔⛔ THE FLOOR IS OWNER-SET. IT IS NOT DERIVED, AND IT MUST NOT BE RE-DERIVED — TWO DERIVATIONS IN
 * A ROW ERRED THE SAME WAY AND BOTH WERE SENT BACK. This is the third value, and the reason it is
 * stated rather than computed is that the thing every derivation reached for — the 55 ft bump-out —
 * has now twice produced a number the owner had to correct downward:
 *
 *   #990  0.80  px/ft — "44 px across the bump-out's short side": a MINIMUM-TOUCH-TARGET figure,
 *                       and the bump-out is not the touch target. TOO LATE. His verdict on the
 *                       shipped build: "now you really have to zoom in, but way too much to where
 *                       the building almost becomes most of the screen by the time that you can
 *                       increase or decrease it."
 *   #994  0.359 px/ft — "the placed feature is never smaller on screen than the control that places
 *                       it, keyline included" (19.75 px ÷ 55 ft). Defensible, and STILL TOO LATE:
 *                       "it still shows up for the Zoom and the plus minus. Let's make it available
 *                       a little bit sooner."
 *   NOW   0.25  px/ft — 4 FEET PER PIXEL. An OWNER-SET FLOOR. Building 3 on his own plan (788 ft)
 *                       renders about 197 px at it.
 *
 * ⛔ STOP DERIVING FROM THE BUMP-OUT. `FEAT_CTRL_R` / `FEAT_CTRL_STROKE` are still exported and the
 * planner's control still renders from them — they are the CONTROL'S SIZE, which is a real fact —
 * but they no longer feed this threshold, and neither does `DOGEAR_W`. A future session that finds
 * the number "arbitrary" and re-derives it from the feature being placed is repeating the mistake
 * this block exists to record.
 *
 * ⛔ AND THE THING BOTH DERIVATIONS MISSED, which may be the actual cause of the feel: A GATE THAT
 * IS PURELY ABSOLUTE IN px/ft PUTS A BIGGER SHARE OF A SMALLER SCREEN UNDER THE BUILDING. At the
 * 0.359 floor Building 3 rendered 283 px — about a third of the ~945 px canvas on the owner's
 * 1600 px monitor, but closer to HALF of the ~566 px canvas of the 1191 px laptop viewport he now
 * works on. SITE-size independence was the property #990 was asked to protect and it is protected
 * here unchanged; SCREEN-size independence was never checked, and it is not the same variable.
 *
 * So the floor is the EARLIER of two conditions — "whichever arms first":
 *   (a) the ABSOLUTE floor           `FEAT_EDIT_MIN_PPF` = 0.25 px/ft, and
 *   (b) a VIEWPORT CAP: the zoom at which a reference industrial building span
 *       (`FEAT_EDIT_REF_SPAN_FT` = 800 ft, near his own Building 3) would reach
 *       `FEAT_EDIT_MAX_CANVAS_FRAC` = a QUARTER of the canvas width.
 *
 * ⛔ THE GATE IS THEREFORE NO LONGER PURELY ABSOLUTE, AND THAT IS DELIBERATE. Say it plainly: it
 * now reads the canvas width. It is STILL SITE-SIZE INDEPENDENT, which is the property that was
 * actually asked for — nothing here reads the plan, the site, the selected building or any drawn
 * geometry, so a 30-acre site and a 900-acre site on the same screen arm at the identical zoom.
 * The reference span is a CONSTANT, not a measurement of anything on the drawing.
 *
 * WHAT IT MEASURES OUT AS, which is the check that matters:
 *   canvas ~945 px (his 1600 px monitor)  → cap 0.295, floor stays 0.25   → B3 197 px, 21% of canvas
 *   canvas ~566 px (his 1191 px laptop)   → cap 0.177 ARMS FIRST          → B3 139 px, 25% of canvas
 * against 30% / 50% at the superseded 0.359 floor. The two screens now agree about SHARE, which is
 * what he was reacting to. Arithmetically the cap binds on any canvas narrower than 800 px and on
 * none wider, because `ABS × REF ÷ FRAC` = 800 px.
 *
 * ⛔ AND THE ORIGINAL DEFECT CANNOT RETURN THROUGH THE VIEWPORT TERM, at any canvas width. Whole-site
 * zoom is itself `canvasW ÷ siteSpanFt`, so BOTH sides scale with the canvas and their ratio is a
 * constant: the cap sits `siteSpanFt ÷ 3200` tighter than whole-site zoom — 1.48× on the owner's
 * ≈4,725 ft Bain frontage, on a phone exactly as on a monitor. A narrower screen never drags the
 * controls back to the overview zoom he complained about; it moves the floor and the overview zoom
 * together.
 *
 * ⛔ TWO PROPERTIES #990 GOT RIGHT AND THIS KEEPS. (1) It is a ZOOM question, not a fraction of the
 * building — the answer never depends on how big the drawn object is. (2) FADE, NOT POP: above the
 * floor the controls ramp to full strength over the next `FEAT_EDIT_FADE_SPAN` of zoom, and they
 * are FULLY INTERACTIVE THE WHOLE TIME THEY ARE ON SCREEN — opacity is presentation, never a
 * hit-test gate, and a half-faded control that ignored a press would be its own bug.
 */

/** Radius, in px, of the +/− control disc — the planner renders from this. */
export const FEAT_CTRL_R = 9;
/** Width, in px, of that disc's white keyline (centred on the circle, so it straddles the edge). */
export const FEAT_CTRL_STROKE = 1.75;
/**
 * On-screen size, in px, of the control's own full outer width. Kept because the cluster is laid
 * out from it; it is NO LONGER the source of the zoom threshold (see the header — that derivation
 * was tried and sent back).
 */
export const FEAT_EDIT_MIN_PX = FEAT_CTRL_R * 2 + FEAT_CTRL_STROKE;

/**
 * THE OWNER-SET absolute zoom floor, in px per foot. 0.25 px/ft = 4 FEET PER PIXEL.
 * Not derived. See the header for the two derivations this replaces.
 */
export const FEAT_EDIT_MIN_PPF = 0.25;
/** …and the same number the way a scale bar reads it, for anything that talks in feet per pixel. */
export const FEAT_EDIT_MAX_FT_PER_PX = 1 / FEAT_EDIT_MIN_PPF;

/**
 * The VIEWPORT half of the floor. A reference industrial building span (a constant — never
 * anything measured off the drawing, which is what keeps this site-size independent) may not be
 * asked to fill more than `FEAT_EDIT_MAX_CANVAS_FRAC` of the canvas width before the controls are
 * available.
 */
export const FEAT_EDIT_REF_SPAN_FT = 800;
export const FEAT_EDIT_MAX_CANVAS_FRAC = 0.25;
/**
 * A guard rail, not a design point: below this the reference span is a few dozen pixels and nothing
 * on the drawing is identifiable at all. It binds only on a canvas narrower than 320 px — narrower
 * than any real one — and exists so a degenerate/zero measurement can never open the gate wide.
 */
export const FEAT_EDIT_FLOOR_MIN_PPF = 0.1;

/** Fraction of zoom above the floor over which the controls ramp from faint to full. */
export const FEAT_EDIT_FADE_SPAN = 0.35;
/** Opacity the controls first appear at, so the threshold is a fade-in rather than a pop. */
export const FEAT_EDIT_MIN_OPACITY = 0.45;

/**
 * The zoom floor in force on THIS canvas — the EARLIER of the owner-set absolute floor and the
 * viewport cap ("whichever arms first").
 * @param {number} [canvasW] canvas width in px. Absent / unreadable ⇒ the absolute floor alone,
 *   because a floor guessed from a missing measurement is worse than the stated one.
 * @returns {number} px per foot.
 */
export function featureEditFloorPpf(canvasW) {
  if (!Number.isFinite(canvasW) || canvasW <= 0) return FEAT_EDIT_MIN_PPF;
  const cap = (FEAT_EDIT_MAX_CANVAS_FRAC * canvasW) / FEAT_EDIT_REF_SPAN_FT;
  return Math.max(FEAT_EDIT_FLOOR_MIN_PPF, Math.min(FEAT_EDIT_MIN_PPF, cap));
}

/**
 * How strongly the on-building edit controls should render at this zoom.
 * @param {number} ppf px per foot of the RENDER view (`rppf` — the frame the render body reasons
 *   at, so a mid-gesture zoom fades with the picture rather than with the settled view).
 * @param {number} [canvasW] canvas width in px, for the viewport half of the floor.
 * @returns {number} 0 ⇒ do not render them at all; otherwise the opacity to draw them at.
 */
export function featureEditOpacity(ppf, canvasW) {
  const floor = featureEditFloorPpf(canvasW);
  if (!Number.isFinite(ppf) || ppf < floor) return 0;
  const over = (ppf / floor - 1) / FEAT_EDIT_FADE_SPAN; // 0 at the floor, 1 at the top of the ramp
  const t = over <= 0 ? 0 : over >= 1 ? 1 : over;
  return FEAT_EDIT_MIN_OPACITY + (1 - FEAT_EDIT_MIN_OPACITY) * t;
}
