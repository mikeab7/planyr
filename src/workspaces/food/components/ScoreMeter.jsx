/* ScoreMeter — the per-dish score control (B1873008).
 *
 * ⛔ CHECKED FIRST, per the brief's own instruction to reuse/extend the visit rating's existing
 * control rather than build a second, unrelated one. VisitPanel.jsx's RatingSlider already
 * settled this exact design question on 2026-08-18 (owner, verbatim: "obviously there shouldn't
 * be individual buttons for 20 options") — ONE native range slider, not a row of clickable
 * options. The dish brief's own "a 20-segment meter... click a segment to set it" describes
 * exactly the button-grid shape that correction rejected, so this control keeps RatingSlider's
 * proven shape (a native `<input type="range">`, a colour-coded numeral badge via
 * colorForRating/textColorForRating, a "Clear" link, "Not rated" as the unset state) and adds
 * only what's genuinely new to the brief: a striped "meter" track so it READS as segmented, tick
 * labels at 1/3/5/7/9/10, and HALF-POINT steps (not the visit rating's quarter-point steps — this
 * is the owner's own original 185-real-rating scale, per the brief). Clicking anywhere on the
 * track still jumps the native thumb to the nearest half-point stop, and arrow keys move by
 * exactly one stop — both are the browser's own built-in range-input behaviour, not something
 * this file implements.
 *
 * Kept as its OWN component rather than folded into RatingSlider in VisitPanel.jsx: that control
 * is heavily source-scanned by existing tests (quarter-point step, "Not rated" text, the exact
 * RATING_STEP constant) and settled/owner-approved — extracting it risks regressing a working,
 * tested surface for no behavioural gain, since the two controls now have genuinely different
 * steps and tick requirements. Same interaction family, deliberately a sibling, not a duplicate.
 */
import { colorForRating, textColorForRating } from "../lib/ratingColor.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";

export const DISH_SCORE_MIN = 1;
export const DISH_SCORE_MAX = 10;
export const DISH_SCORE_STEP = 0.5;
export const DISH_SCORE_TICKS = [1, 3, 5, 7, 9, 10];
const DISH_SCORE_REST = 5.5; // purely the thumb's visual resting spot before any touch — never committed as a value
const STOP_COUNT = Math.round((DISH_SCORE_MAX - DISH_SCORE_MIN) / DISH_SCORE_STEP); // 18 half-point steps, 19 stops

function meterTrackBackground() {
  // A striped background — one visual stripe per half-point stop — so the slider READS as a
  // segmented meter even though a single native range input still drives it underneath.
  const stops = [];
  for (let i = 0; i < STOP_COUNT; i++) {
    const from = (i / STOP_COUNT) * 100;
    const to = ((i + 1) / STOP_COUNT) * 100;
    const shade = i % 2 === 0 ? "var(--chrome-divider)" : "transparent";
    stops.push(`${shade} ${from}%`, `${shade} ${to}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
const METER_TRACK_BG = meterTrackBackground();

export default function ScoreMeter({ value, onChange, label = "Score" }) {
  const active = value != null;
  const shown = active ? value : DISH_SCORE_REST;
  const color = colorForRating(shown) || "var(--accent-food)";
  return (
    <div data-testid="dish-score-meter">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span aria-live="polite" style={{
          fontSize: FONT_SIZE.display, fontWeight: 700, lineHeight: 1,
          color: active ? textColorForRating(shown) : "var(--text-tertiary)",
          background: active ? color : "transparent", borderRadius: 6,
          padding: active ? "2px 8px" : 0,
        }}>
          {active ? `${shown} / ${DISH_SCORE_MAX}` : "Not rated"}
        </span>
        {active && (
          <button type="button" onClick={() => onChange(null)} data-testid="dish-score-clear" style={{
            border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer",
            font: "inherit", fontSize: FONT_SIZE.label, padding: 0, textDecoration: "underline",
          }}>
            Clear
          </button>
        )}
      </div>
      <input
        type="range" min={DISH_SCORE_MIN} max={DISH_SCORE_MAX} step={DISH_SCORE_STEP}
        value={shown} onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label} aria-valuetext={active ? `${shown} out of ${DISH_SCORE_MAX}` : "not rated"}
        style={{ width: "100%", accentColor: color, cursor: "pointer", background: METER_TRACK_BG, borderRadius: RADIUS.sm, minHeight: 32 }}
      />
      <div style={{ position: "relative", height: 12, marginTop: 1 }}>
        {DISH_SCORE_TICKS.map((t) => (
          <span key={t} style={{
            position: "absolute", left: `${((t - DISH_SCORE_MIN) / (DISH_SCORE_MAX - DISH_SCORE_MIN)) * 100}%`,
            transform: "translateX(-50%)", fontSize: FONT_SIZE.micro, color: "var(--text-tertiary)",
          }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
