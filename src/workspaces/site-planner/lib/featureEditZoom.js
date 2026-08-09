/* NEW-2 — WHEN THE ON-BUILDING EDIT CONTROLS MAY EXIST AT ALL. It is a ZOOM question, and the
 * threshold is derived from the SMALLEST THING THEY EDIT — never from how big the building is.
 *
 * THE REPORT (owner, on Bain / "Concept - Original", 109 acres, the whole site in the viewport with
 * the scale bar reading 0–1,000 ft): "the plus and minus buttons here show up way too early… I
 * shouldn't be zoomed out this far and they show up. I should have to zoom in more." The green +
 * and red − sat at full size over Buildings 3 and 4 — the largest objects on a plan he was trying
 * to READ — while the bump-out one of them adds was a few pixels wide.
 *
 * ⛔ WHY THE EXISTING GATE COULD NOT SEE THIS. `FEAT_BTN_MIN_PX` (B225) asks whether the building's
 * own wall is big enough on screen to seat the cluster without it spilling past the footprint. That
 * is a real question and it still holds — it is just a question about the CONTAINER. A 900 ft
 * building clears a 72 px wall at almost any zoom a site plan is read at, so on a large industrial
 * building B225's gate is satisfied from the moment the plan fits the screen. The two gates measure
 * different things and BOTH must pass:
 *   B225   — is there room on this building for the control?   (footprint px, relative)
 *   NEW-2  — is the EDIT this control makes legible yet?       (feet per pixel, absolute)
 *
 * THE NUMBER, and it is stated rather than tuned. The smallest feature these controls place is a
 * corner bump-out, `DOGEAR_W` × `DOGEAR_D` = 55 ft × 60 ft. Require its short side to render at
 * `FEAT_EDIT_MIN_PX` = 44 px — comfortably larger than the 18 px control disc that edits it, so the
 * control can never be wider than its own subject. That fixes the threshold at
 *   44 px ÷ 55 ft = 0.80 px per foot, i.e. 1.25 FEET PER PIXEL.
 * At the owner's whole-site view (well under half that) they are gone; at 1.25 ft/px a bump-out is
 * 44 × 48 px and a 500 ft building spans about 400 px, which is a zoom at which placing a dock zone
 * or a bump-out is a meaningful act. Because the rule is absolute zoom rather than a fraction of
 * the building, it reads the same on a 30-acre site and a 900-acre one — which is what the owner
 * asked for by name.
 *
 * FADE, NOT POP. Above the threshold the controls ramp to full strength over the next
 * `FEAT_EDIT_FADE_SPAN` of zoom, so they arrive softly instead of snapping on at one wheel notch.
 * They are fully interactive the whole time they are on screen: opacity is presentation, never a
 * hit-test gate, and a half-faded control that ignores a press would be its own bug.
 */
import { DOGEAR_W } from "./dogEar.js";

/** On-screen size, in px, the smallest edited feature must reach before its control appears. */
export const FEAT_EDIT_MIN_PX = 44;
/** The derived zoom floor, in px per foot: 44 px across a 55 ft bump-out. */
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
