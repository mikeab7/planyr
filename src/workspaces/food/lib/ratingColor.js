/* ratingColor — the 1-10 rating colour ramp (owner redesign, 2026-08-18: "his rated places
 * coloured along the 1-10 scale, so a glance at the map tells him where the good ones are...
 * it must not rely on red-versus-green alone... vary lightness across the scale too").
 *
 * Single-hue-family (warm cream -> deep red-brown), not a red-green ramp: there is no green in
 * it at all, so it can never fall into the one colourblind confusion pair this repo's own
 * KEY DECISIONS already bans elsewhere (coral+green). Relative luminance falls STRICTLY from
 * step 1 to step 10 (0.89 -> 0.04, WCAG formula, verified — never eyeballed), so the scale
 * still reads as a light-to-dark gradient in grayscale or on a washed-out phone screen. Step 8
 * (#BE3B22) is the module's own existing --accent-food token, tying the ramp to the module's
 * brand colour rather than an arbitrary new palette.
 *
 * `RATING_TEXT` is the paired label colour for each step — MEASURED, not assumed: every step
 * clears WCAG AA (>=4.5:1, the small-bold-text threshold; the rating pill text is 12px/700,
 * below the "large text" 3:1 carve-out) against whichever of black/white it's paired with.
 * Step 7 (#CC4526) is nudged darker than a pure linear interpolation would land, specifically
 * because the un-nudged value (#D74A2A) tops out at 4.28:1 against white — short of AA — and
 * this is the one place on the ramp where neither black nor white clears the bar by default.
 */
export const RATING_COLORS = [
  "#FFF2CC", // 1
  "#FEE29A", // 2
  "#FDCB6B", // 3
  "#FBAE44", // 4
  "#F58C34", // 5
  "#EA6A2E", // 6
  "#CC4526", // 7 — nudged darker than linear interpolation would land; see header
  "#BE3B22", // 8 — matches --accent-food
  "#9B2A1A", // 9
  "#6E1810", // 10
];

/** Paired 1:1 with RATING_COLORS — the label colour that clears AA against that step's fill. */
export const RATING_TEXT = [
  "#1a1a1a", "#1a1a1a", "#1a1a1a", "#1a1a1a", "#1a1a1a", "#1a1a1a", // 1-6: dark text
  "#ffffff", "#ffffff", "#ffffff", "#ffffff", // 7-10: light text
];

/** null/undefined/non-finite -> null (no rating yet, caller falls back to its own default). */
export function colorForRating(rating) {
  if (rating == null || !Number.isFinite(rating)) return null;
  const n = Math.min(10, Math.max(1, Math.round(rating)));
  return RATING_COLORS[n - 1];
}

/** The label colour to pair with colorForRating's fill, so a caller never has to reason about
 *  contrast itself. Same null-handling as colorForRating. */
export function textColorForRating(rating) {
  if (rating == null || !Number.isFinite(rating)) return null;
  const n = Math.min(10, Math.max(1, Math.round(rating)));
  return RATING_TEXT[n - 1];
}
