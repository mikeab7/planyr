/* ratingScale — the Food / Ambiance rating scale, in ONE place.
 *
 * ⛔ PRODUCT DECISION (owner, 2026-10-05; CLAUDE.md "Owner product constraints" #16): a visit's food
 * rating and ambiance rating are each ONE slider, 1 to 10 in HALF-point steps, "Not rated" until
 * touched. Do not replace it with tap buttons, a stepper or whole numbers without his say-so.
 * test/foodRatingSlider.test.js fails if any of the three numbers below change.
 *
 * (The database column still ACCEPTS quarter points — numeric(4,2) from the 2026-08-27 widening — so
 * a rating saved in that period, e.g. 8.75, loads and displays exactly as saved; only entry is halves.) */
export const RATING_MIN = 1;
export const RATING_MAX = 10;
export const RATING_STEP = 0.5;
export const RATING_SLIDER_REST = 5.5; // purely the thumb's visual resting spot before any touch — never committed as a value
