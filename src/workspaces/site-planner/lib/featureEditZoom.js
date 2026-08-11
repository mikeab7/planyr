/* NEW-1 — WHEN THE ON-BUILDING EDIT CONTROLS MAY EXIST AT ALL. It is a ZOOM question, and the
 * threshold is derived from the SMALLEST THING THEY EDIT — never from how big the building is.
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
 * ⛔ THE THRESHOLD WAS RIGHT IN KIND AND WRONG IN VALUE, AND THIS IS THE CORRECTED DERIVATION
 * (owner, on the shipped #990 build: "you did go a little too far… now you really have to zoom in,
 * but way too much to where the building almost becomes most of the screen by the time that you can
 * increase or decrease it"). The first cut required the bump-out's short side to reach **44 px** —
 * a MINIMUM-TOUCH-TARGET figure. **The bump-out is not the touch target.** The +/− disc is, and its
 * size is governed by `FEAT_BTN_MIN_PX` (B225), which this file does not touch. So the bump-out only
 * has to be IDENTIFIABLE — recognisable as the thing the control is about to place — not comfortably
 * clickable, and the criterion is re-derived on that basis:
 *
 *   THE PLACED FEATURE IS NEVER SMALLER ON SCREEN THAN THE CONTROL THAT PLACES IT, KEYLINE INCLUDED.
 *
 * That is the honest half of the original rule — the half that made the old number defensible —
 * kept, with the touch-target inflation removed. The control is a `FEAT_CTRL_R` = 9 px disc drawn
 * with a `FEAT_CTRL_STROKE` = 1.75 px white keyline, so its full outer width is 19.75 px, and:
 *   19.75 px ÷ 55 ft = 0.359 px per foot, i.e. 2.78 FEET PER PIXEL.
 * Both constants are exported and the planner's control renders FROM them, so if the disc ever
 * changes size the threshold moves with it instead of drifting apart from it.
 *
 * WHAT THAT MEASURES OUT AS on the owner's own plan, which is the check he asked for: Building 3 is
 * 788 ft × 260 ft, so at this floor it renders about **283 px** long — near a third of his canvas,
 * inside the 250–350 px band he named, against the 630 px (about two thirds of it) the 0.80 floor
 * produced. A bump-out's short side is 19.75 px and its depth 21.5 px: small, and unmistakably a
 * rectangle rather than a mark. At the whole-site zoom of his original report (≈0.2 px/ft off the
 * scale bar) the controls are still gone, which is the property this gate exists for.
 *
 * ⛔ TWO PROPERTIES #990 GOT RIGHT AND THIS AMENDMENT KEEPS. (1) The gate is ABSOLUTE — a zoom, not
 * a fraction of the building — so it reads the same on a 30-acre site and a 900-acre one, which is
 * what the owner asked for by name. (2) FADE, NOT POP: above the threshold the controls ramp to full
 * strength over the next `FEAT_EDIT_FADE_SPAN` of zoom, and they are fully interactive the whole
 * time they are on screen — opacity is presentation, never a hit-test gate, and a half-faded control
 * that ignored a press would be its own bug.
 */
import { DOGEAR_W } from "./dogEar.js";

/** Radius, in px, of the +/− control disc — the planner renders from this. */
export const FEAT_CTRL_R = 9;
/** Width, in px, of that disc's white keyline (centred on the circle, so it straddles the edge). */
export const FEAT_CTRL_STROKE = 1.75;
/**
 * On-screen size, in px, the smallest edited feature must reach before its control appears:
 * the control's own full outer width, so the control can never be wider than its own subject.
 */
export const FEAT_EDIT_MIN_PX = FEAT_CTRL_R * 2 + FEAT_CTRL_STROKE;
/** The derived zoom floor, in px per foot: 19.75 px across a 55 ft bump-out. */
export const FEAT_EDIT_MIN_PPF = FEAT_EDIT_MIN_PX / DOGEAR_W;
/** …and the same number the way a scale bar reads it, for anything that talks in feet per pixel. */
export const FEAT_EDIT_MAX_FT_PER_PX = 1 / FEAT_EDIT_MIN_PPF;
/** Fraction of zoom above the floor over which the controls ramp from faint to full. */
export const FEAT_EDIT_FADE_SPAN = 0.35;
/** Opacity the controls first appear at, so the threshold is a fade-in rather than a pop. */
export const FEAT_EDIT_MIN_OPACITY = 0.45;

/**
 * How strongly the on-building edit controls should render at this zoom.
 * @param {number} ppf px per foot of the RENDER view (`rppf` — the frame the render body reasons
 *   at, so a mid-gesture zoom fades with the picture rather than with the settled view).
 * @returns {number} 0 ⇒ do not render them at all; otherwise the opacity to draw them at.
 */
export function featureEditOpacity(ppf) {
  if (!Number.isFinite(ppf) || ppf < FEAT_EDIT_MIN_PPF) return 0;
  const over = (ppf / FEAT_EDIT_MIN_PPF - 1) / FEAT_EDIT_FADE_SPAN; // 0 at the floor, 1 at the top of the ramp
  const t = over <= 0 ? 0 : over >= 1 ? 1 : over;
  return FEAT_EDIT_MIN_OPACITY + (1 - FEAT_EDIT_MIN_OPACITY) * t;
}
