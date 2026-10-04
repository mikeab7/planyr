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
 * ⛔ PHONE: TAP, DON'T DRAG (NEW-1, "Food on a phone", owner direction 2026-10-03 — "ratings are hard
 * to set with a thumb"). A native range slider inside a scrolling bottom sheet is the worst shape
 * for a thumb: the same finger that scrolls the sheet lands on the track and moves the value, and
 * the 37 stops are far narrower than a fingertip. At phone width (`isMobile`) the slider is
 * replaced by `ScoreTapGrid`: ten big whole-point buttons (1-10) in two rows — ONE tap sets the
 * rating, and a tap is only delivered if the finger did NOT scroll, so a scroll can never set one —
 * with the existing minus/plus quarter-point nudges kept for the fine part. This is NOT the
 * rejected "individual buttons for 20 options" shape (that was 37 quarter-point stops; this is
 * ten whole points plus the nudges). Desktop keeps the slider, unchanged.
 *
 * STEP CHANGED 0.5 -> 0.25 (NEW-1) — the scale is still 1.0-10.0; only the resolution moved,
 * matching db/food.sql's food_dishes_score_check widen to numeric(4,2)/quarter-point.
 */
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

const TAP_POINTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Ten whole-point tap targets, 5 across x 2 down, each at least 48 CSS px tall and 44 wide. The
 *  selected point is the one the value equals when it is a whole number; a quarter-point value
 *  (set with the nudges) highlights nothing and the numeral above shows the exact value. */
export function ScoreTapGrid({ value, onChange, label = "Score" }) {
  return (
    <div role="group" aria-label={label} data-testid="score-tap-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
      {TAP_POINTS.map((n) => {
        const on = value != null && Number(value) === n;
        return (
          <button
            key={n} type="button" aria-pressed={on} aria-label={`${label} ${n}`} data-testid={`score-tap-${n}`}
            onClick={() => onChange(n)}
            style={{
              minHeight: 48, minWidth: 44, padding: 0, borderRadius: RADIUS.md, cursor: "pointer", font: "inherit",
              fontSize: 17, fontWeight: 700, touchAction: "manipulation", // design-exempt: the tap digit — a score numeral on a thumb-sized button, above FONT_SIZE's ceiling by design
              border: on ? "1px solid var(--accent-food)" : "1px solid var(--border-default)",
              background: on ? "var(--accent-food)" : "var(--surface-raised)",
              color: on ? "var(--on-accent-food)" : "var(--text-primary)",
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

export default function ScoreMeter({ value, onChange, label = "Score", isMobile = false }) {
  const active = value != null;
  const shown = active ? value : DISH_SCORE_MIN;
  const color = active ? (colorForRating(shown) || "var(--accent-food)") : "var(--border-default)";
  const nudgeStyle = isMobile ? NUDGE_BTN_STYLE_PHONE : NUDGE_BTN_STYLE;

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
      {isMobile ? (
        <>
          <ScoreTapGrid value={value} onChange={onChange} label={label} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <button
              type="button" className="tap-target" onClick={() => onChange(nudgeScore(value, -DISH_SCORE_STEP))}
              aria-label="Decrease score by a quarter point" data-testid="dish-score-minus" style={nudgeStyle}
            >
              −
            </button>
            <span style={{ flex: 1, textAlign: "center", fontSize: FONT_SIZE.micro, color: "var(--text-tertiary)" }}>fine-tune by a quarter</span>
            <button
              type="button" className="tap-target" onClick={() => onChange(nudgeScore(value, DISH_SCORE_STEP))}
              aria-label="Increase score by a quarter point" data-testid="dish-score-plus" style={nudgeStyle}
            >
              +
            </button>
          </div>
        </>
      ) : (
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
            data-testid="dish-score-slider"
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
      )}
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
