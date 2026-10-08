/* ScoreMeter — the per-dish score control (B1873008; redesigned NEW-1, 2026-09-28).
 *
 * ⛔ THE BUG THIS REDESIGN KILLS. The shipped control rendered the words "Not rated" above a
 * track that was ALREADY VISUALLY FILLED to its resting spot (a fixed mid-scale value the thumb
 * sat at before any touch) — two contradictory claims in one control, and there was no numeral
 * at all once a score WAS set beyond the pill hiding under it, so there was no way to read what
 * the slider was actually set to. Fixed at the root: the "unset" state now shows the thumb at
 * the scale's own floor (DISH_SCORE_MIN) with a neutral (non-accent) track colour, so there is
 * nothing filled to contradict the em-dash numeral, and a SET score always shows as a large
 * right-aligned numeral above the track.
 *
 * ⛔ STILL A NATIVE RANGE SLIDER, NOT A BUTTON GRID — checked first, unchanged from the original
 * ship. VisitPanel.jsx's RatingSlider settled this exact question 2026-08-18 (owner, verbatim:
 * "obviously there shouldn't be individual buttons for 20 options"). The redesign's own minus/
 * plus NUDGE buttons are not that rejected shape — they step the existing slider by one quarter
 * point each, they don't offer 37 individual stops to pick from.
 *
 * ⛔ PHONE: THE SAME SLIDER (2026-10-05, owner: ratings are one slider each, never tap buttons). PR 1941
 * (B2057920) had replaced the slider with a 1-10 whole-point tap grid on phones; the owner got whole
 * numbers back and wants the slider, so the phone renders the SAME range slider as desktop (taller
 * track, finger-sized nudges). Dragging it never moves the sheet or scrolls the list
 * (BottomSheet ignores a touch that starts on a range input).
 *
 * STEP CHANGED 0.5 -> 0.25 (NEW-1) — the scale is still 1.0-10.0; only the resolution moved,
 * matching db/food.sql's food_dishes_score_check widen to numeric(4,2)/quarter-point.
 */
import { useScrollSafeSlider } from "../lib/sliderScrollGuard.js";
import { colorForRating } from "../lib/ratingColor.js";
import { formatScore } from "../lib/dishAggregates.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";

export const DISH_SCORE_MIN = 1;
export const DISH_SCORE_MAX = 10;
export const DISH_SCORE_STEP = 0.25;
export const DISH_SCORE_TICKS = [1, 3, 5, 7, 9, 10];
const STOP_COUNT = Math.round((DISH_SCORE_MAX - DISH_SCORE_MIN) / DISH_SCORE_STEP); // 36 quarter-point steps, 37 stops

/** Clamp + snap to the nearest quarter point — the one place both the slider's own onChange and
 *  the nudge buttons funnel through, so "the value only ever moves in exact 0.25 steps, and
 *  never leaves [1, 10]" is true by construction rather than by every caller remembering it. */
export function clampScore(n) {
  const stepped = Math.round(n / DISH_SCORE_STEP) * DISH_SCORE_STEP;
  return Math.min(DISH_SCORE_MAX, Math.max(DISH_SCORE_MIN, stepped));
}

/** The minus/plus nudge step (pure — no DOM, so a test can call it directly rather than
 *  simulating a click). From an UNSET score, either button ESTABLISHES a rating at the scale's
 *  floor rather than jumping straight past it (there is no meaningful "one quarter point below
 *  nothing"); from a SET score, it steps by exactly one quarter point and clamps at both ends. */
export function nudgeScore(value, delta) {
  if (value == null) return DISH_SCORE_MIN;
  return clampScore(value + delta);
}

function meterTrackBackground() {
  // A striped background — one visual stripe per quarter-point stop — so the slider READS as a
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

const NUDGE_BTN_STYLE = {
  flex: "none", width: 32, height: 32, minWidth: 32, minHeight: 32, padding: 0,
  display: "flex", alignItems: "center", justifyContent: "center",
  border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, background: "var(--surface-page)",
  color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontWeight: 700, lineHeight: 1,
  fontSize: 16, // design-exempt: the minus/plus GLYPH size, scaled to its own 32px button — above FONT_SIZE's ceiling by design
};
// Phone width (B1873008 redesign spec): every nudge/order-again control grows to a real finger-
// sized target — this file has no CSS media query today, so the phone variant is a second literal
// style object selected by the same matchMedia read DishesSection/VisitPanel already use, rather
// than a new mechanism.
const NUDGE_BTN_STYLE_PHONE = { ...NUDGE_BTN_STYLE, width: 50, height: 50, minWidth: 50, minHeight: 50, fontSize: 20 }; // design-exempt: same glyph-scaled-to-button reasoning, scaled again for the 50px phone target

export default function ScoreMeter({ value, onChange, label = "Score", isMobile = false }) {
  const active = value != null;
  const shown = active ? value : DISH_SCORE_MIN;
  const color = active ? (colorForRating(shown) || "var(--accent-food)") : "var(--border-default)";
  const nudgeStyle = isMobile ? NUDGE_BTN_STYLE_PHONE : NUDGE_BTN_STYLE;
  const scrollGuard = useScrollSafeSlider(value, onChange); // a vertical swipe that starts on the slider scrolls the card and leaves the score alone

  return (
    <div data-testid="dish-score-meter">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontSize: FONT_SIZE.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>
            Score
          </span>
          {/* The caption itself is the fix for "the caption says nothing is set" — it reads
              "quarter steps" while a score is set, and swaps to a plain unset statement instead
              of staying silent while the numeral shows an em dash. */}
          <span data-testid="dish-score-caption" style={{ fontSize: FONT_SIZE.micro, color: "var(--text-tertiary)" }}>
            {active ? "quarter steps" : "not set yet"}
          </span>
        </span>
        <span
          data-testid="dish-score-numeral" data-score-state={active ? "set" : "unset"}
          aria-live="polite" style={{ display: "flex", alignItems: "baseline", gap: 3 }}
        >
          <span style={{
            fontSize: 22, // design-exempt: the redesign's own "large numeral" requirement — the control's hero value, above FONT_SIZE's 14px display ceiling by design
            fontWeight: 700, lineHeight: 1, color: active ? "var(--text-primary)" : "var(--text-tertiary)",
          }}>
            {active ? formatScore(shown) : "—"}
          </span>
          {active && <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>/ {DISH_SCORE_MAX}</span>}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button" className="tap-target" onClick={() => onChange(nudgeScore(value, -DISH_SCORE_STEP))}
          aria-label="Decrease score by a quarter point" data-testid="dish-score-minus" style={nudgeStyle}
        >
          −
        </button>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <input
            type="range" min={DISH_SCORE_MIN} max={DISH_SCORE_MAX} step={DISH_SCORE_STEP}
            value={shown} onChange={(e) => onChange(clampScore(Number(e.target.value)))}
            aria-label={label} aria-valuetext={active ? `${formatScore(shown)} out of ${DISH_SCORE_MAX}` : "not scored"}
            data-testid="dish-score-slider" {...scrollGuard}
            style={{
              width: "100%", accentColor: color, cursor: "pointer", borderRadius: RADIUS.sm,
              minHeight: isMobile ? 40 : 32, height: isMobile ? 40 : undefined,
              // The unset (neutral) track — a flat border-colour fill, never the striped accent
              // meter, so nothing here contradicts the em-dash numeral above it.
              background: active ? METER_TRACK_BG : "var(--border-default)",
            }}
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
        <button
          type="button" className="tap-target" onClick={() => onChange(nudgeScore(value, DISH_SCORE_STEP))}
          aria-label="Increase score by a quarter point" data-testid="dish-score-plus" style={nudgeStyle}
        >
          +
        </button>
      </div>
      {active && (
        <button type="button" onClick={() => onChange(null)} data-testid="dish-score-clear" style={{
          border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer",
          font: "inherit", fontSize: FONT_SIZE.label, padding: "4px 0 0", textDecoration: "underline",
        }}>
          Clear
        </button>
      )}
    </div>
  );
}
