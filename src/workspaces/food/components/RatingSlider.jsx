/* RatingSlider — THE one rating control in /food (NEW-2, 2026-10-11): a visit's Food, its Ambiance and
 * every dish's score. One readout pill, one Clear position (right of the readout), one tick row.
 *
 * ⛔ Still a NATIVE range input underneath (keyboard arrows move one step, screen readers get the role
 * and value for free, Playwright can .fill() it) — restyled in index.css (.food-rating-slider) so that:
 *  - the whole 48px row is the grab target while the visible track stays slim, and a press anywhere on it
 *    jumps the thumb there and drags on from that point;
 *  - the thumb travels exactly between inset(THUMB/2) ends, and the tick row uses the SAME inset, so each
 *    number is centred under the thumb's position for that value at every width (NEW-3);
 *  - no - / + buttons (owner: not needed).
 * A vertical swipe that starts on it scrolls the card and leaves the value alone (sliderScrollGuard.js).
 * Scale: lib/ratingScale.js (1-10, step 0.25). Owner constraint #16. */
import { useScrollSafeSlider } from "../lib/sliderScrollGuard.js";
import { colorForRating, textColorForRating } from "../lib/ratingColor.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import {
  RATING_MIN, RATING_MAX, RATING_STEP, RATING_TICKS, RATING_SLIDER_REST, THUMB_PX, ratingFraction, ratingFromClientX,
} from "../lib/ratingScale.js";

export default function RatingSlider({
  value, onChange, label, isMobile = false,
  testIds = {}, // dish scoring keeps its own ids; the visit sliders use the defaults
}) {
  const ids = { root: "rating-slider-root", slider: "rating-slider", readout: "rating-slider-readout", clear: "rating-slider-clear", ...testIds };
  const active = value != null;
  const shown = active ? value : RATING_SLIDER_REST;
  const color = active ? (colorForRating(shown) || "var(--accent-food)") : "var(--border-default)";
  const scrollGuard = useScrollSafeSlider(value, onChange);
  const rowPx = isMobile ? 52 : 44; // the whole row is the grab target (the thumb is centred in it by --rs-h)
  // A tap that lands exactly on the idle thumb changes nothing natively, so no change event would fire — rate it on release.
  const rateOnTap = (e) => { if (!active) onChange(ratingFromClientX(e.clientX, e.currentTarget.getBoundingClientRect())); };
  return (
    <div data-testid={ids.root} data-no-sheet-drag="">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", minHeight: 24 }}>
        <span
          aria-live="polite" data-testid={ids.readout} data-score-state={active ? "set" : "unset"}
          style={{
            fontSize: FONT_SIZE.emphasis, fontWeight: 700, lineHeight: 1,
            color: active ? textColorForRating(shown) : "var(--text-tertiary)",
            background: active ? color : "transparent", borderRadius: 6,
            padding: active ? "3px 8px" : 0,
          }}
        >
          {active ? `${shown} / ${RATING_MAX}` : "Not rated"}
        </span>
        {active && (
          <button type="button" onClick={() => onChange(null)} data-testid={ids.clear} style={{
            border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer",
            font: "inherit", fontSize: FONT_SIZE.label, padding: "4px 0 4px 12px", textDecoration: "underline",
          }}>
            Clear
          </button>
        )}
      </div>
      <input
        className="food-rating-slider" data-active={active ? "1" : "0"}
        type="range" min={RATING_MIN} max={RATING_MAX} step={RATING_STEP}
        value={shown} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={rateOnTap}
        aria-label={label} aria-valuetext={active ? `${shown} out of ${RATING_MAX}` : "not rated"}
        data-testid={ids.slider} {...scrollGuard}
        style={{ "--rs-color": color, "--rs-frac": ratingFraction(shown), "--rs-thumb": `${THUMB_PX}px`, "--rs-h": `${rowPx}px`, height: rowPx }}
      />
      <div aria-hidden="true" data-testid="rating-slider-ticks" style={{ position: "relative", height: 14, marginTop: -2 }}>
        {RATING_TICKS.map((t) => (
          <span key={t} data-tick={t} style={{
            position: "absolute", left: `calc(${THUMB_PX / 2}px + ${ratingFraction(t)} * (100% - ${THUMB_PX}px))`,
            transform: "translateX(-50%)", fontSize: FONT_SIZE.micro, lineHeight: "14px", color: "var(--text-tertiary)",
          }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
