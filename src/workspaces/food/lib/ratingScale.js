/* ratingScale — the Food / Ambiance / dish-score rating scale, in ONE place.
 *
 * ⛔ PRODUCT DECISION (owner, 2026-10-11, CLAUDE.md "Owner product constraints" #16): EVERY rating in
 * /food (a visit's Food and Ambiance, and each dish's score) is ONE slider, 1 to 10 in QUARTER-point
 * steps, "Not rated" until touched, and all of them are the same component (components/RatingSlider.jsx).
 * Never tap buttons, a stepper, +/- nudges or whole numbers without his say-so.
 * test/foodRatingSlider.test.js fails if any of the numbers below change.
 *
 * HISTORY (so it is not re-litigated): quarter steps shipped 2026-08-28 (PR 1209, B829616); the
 * 2026-10-04 "half-step slider restored + locked in" PR (PR 2001, B626576 x2) re-locked ONLY the
 * restaurant Food/Ambiance slider to 0.5 while the separate dish ScoreMeter stayed at 0.25; this
 * file puts every slider back on 0.25. Saved half-step and whole-number ratings load unchanged. */
export const RATING_MIN = 1;
export const RATING_MAX = 10;
export const RATING_STEP = 0.25;
export const RATING_TICKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // evenly spaced, whole numbers, every slider
export const RATING_SLIDER_REST = 5.5; // purely the thumb's visual resting spot before any touch — never committed as a value
export const THUMB_PX = 24; // thumb width; the track and the tick row both inset by half of it so a tick sits exactly under the thumb centre

/** Clamp + snap to the nearest quarter point. */
export function snapRating(n) {
  const stepped = Math.round(n / RATING_STEP) * RATING_STEP;
  return Math.min(RATING_MAX, Math.max(RATING_MIN, stepped));
}

/** 0..1 position of a value along the thumb's travel (the thumb CENTRE, not the box edge). */
export function ratingFraction(v) {
  return (v - RATING_MIN) / (RATING_MAX - RATING_MIN);
}

/** The rating under a pointer at `clientX`, given the slider's bounding box. Same inset geometry as the CSS. */
export function ratingFromClientX(clientX, rect) {
  const travel = Math.max(1, rect.width - THUMB_PX);
  const f = Math.min(1, Math.max(0, (clientX - rect.left - THUMB_PX / 2) / travel));
  return snapRating(RATING_MIN + f * (RATING_MAX - RATING_MIN));
}
