/* ScoreMeter — the per-dish score control. Since NEW-2 (2026-10-11) it is just RatingSlider with the dish
 * test ids and a small "Score" caption: the same slider, readout, Clear and ticks as the visit's Food and
 * Ambiance, quarter-point steps, no - / + buttons (owner constraint #16). All behaviour lives in RatingSlider. */
import RatingSlider from "./RatingSlider.jsx";
import { RATING_MIN, RATING_MAX, RATING_STEP, RATING_TICKS, snapRating } from "../lib/ratingScale.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

export const DISH_SCORE_MIN = RATING_MIN;
export const DISH_SCORE_MAX = RATING_MAX;
export const DISH_SCORE_STEP = RATING_STEP;
export const DISH_SCORE_TICKS = RATING_TICKS;
/** Clamp + snap to the nearest quarter point. */
export const clampScore = snapRating;

const DISH_IDS = { root: "dish-score-meter", slider: "dish-score-slider", readout: "dish-score-numeral", clear: "dish-score-clear" };

export default function ScoreMeter({ value, onChange, label = "Score", isMobile = false }) {
  return (
    <div>
      <div style={{ fontSize: FONT_SIZE.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)", marginBottom: 4 }}>
        Score
      </div>
      <RatingSlider value={value} onChange={onChange} label={label} isMobile={isMobile} testIds={DISH_IDS} />
    </div>
  );
}
