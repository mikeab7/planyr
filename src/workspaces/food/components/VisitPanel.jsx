/* VisitPanel — the place detail panel: click a pin (or drop a new one), see the aggregate story
 * of every visit here, log another, or flag it as somewhere you want to try.
 *
 * ⛔ REBUILT (NEW-2, owner, 2026-08-22, verbatim: "Make this a world class interface for when you
 * click on a restaurant. Right now, it's lacking" — judged on his phone, in Safari, which is
 * where he uses this). The old panel was a right-hand drawer that, on mobile, buried the map
 * behind a ~22% sliver and ran floor-to-ceiling with roughly half the screen left blank under a
 * one-visit place's entire content — a rating badge, a raw ISO date, and a red "Delete" link as
 * the single most prominent thing on screen, no confirmation. This rewrite keeps the SAME
 * content, in the SAME order, on both breakpoints — only the CONTAINER changes: a bottom sheet
 * (BottomSheet.jsx) on mobile (map stays visible and pannable above it), the same right rail as
 * before on desktop. See each block's own comment below for what changed and why.
 *
 * RATING CONTROL, DATE FIELD, AMBIANCE, "WHAT WAS GOOD" INPUT, and THE B668194 CLEAR-ON-SAVE
 * CONTRACT ARE ALL UNCHANGED — VisitForm itself is untouched by this rewrite (see its own
 * preserved header comments below); only what surrounds it (the panel's layout, the past-visits
 * list, the toggle) was rebuilt.
 *
 * ⛔ RATING CONTROL (owner correction, 2026-08-18: "obviously there shouldn't be individual
 * buttons for 20 options"). ONE control: a native range slider, min 1 max 10.
 *
 * ⛔ QUARTER-POINT STEPS (owner chat block, 2026-08-27/28: "quarter-point ratings, not just half
 * points"). RATING_STEP is now 0.25 (37 stops across 1-10), not 0.5. The native HTML range input
 * already does the two things the brief asked for at this stop count without any extra JS: it
 * snaps to the nearest valid step as you drag (never a pixel-perfect requirement) and its arrow
 * keys move by exactly `step` — both are documented browser behaviour, not something this file
 * has to implement. So this stays the SAME single control (never a row of buttons, never a
 * second widget) — only the step size and the display formatting below changed.
 *
 * ⛔ DISPLAY, NATURAL PRECISION (same owner block: "8.25, 8.5, 9... not padded to a fixed
 * decimal count — '9.00' reads like a spreadsheet"). The old `shown.toFixed(1)` forced exactly
 * one decimal always ("9.0"); dropped in favour of the bare JS number in the template string,
 * which already prints its natural precision (no floating-point risk here — every reachable
 * value is an exact multiple of 0.25, which is an exact binary fraction, so `9`, `8.5`, `8.25`
 * are all exact, never `8.24999999999998`). The aggregate averages in ScoreStrip below
 * deliberately keep their existing ONE-decimal display (`avgFood.toFixed(1)`) — an average of
 * quarter points doesn't need quarter-point display precision, and a stray "8.4375 avg" would
 * read worse, not better.
 *
 * ⛔ SCHEMA (same block): `food_visits.rating`/`rating_ambiance` were widened from numeric(3,1)
 * (one decimal, half-point-capable) to numeric(4,2) (two decimals, quarter-point-capable) — see
 * db/food.sql's own migration comment for why numeric(4,2) and not the brief's suggested
 * numeric(3,2) (the latter overflows on a rating of exactly 10 — proven live against production,
 * which already held one). Verified non-destructive: a scale-independent checksum over all 174
 * existing rows matched exactly before and after the ALTER.
 *
 * ⛔ DATE FIELD (owner correction, 2026-08-18: never pre-filled with today, stays optional.
 *
 * ⛔ B668194 — CLEAR THE FORM ON A CONFIRMED SAVE, NEVER BEFORE. `onSubmit` (FoodApp's
 * `submitVisit`) returns a boolean — VisitForm resets its own fields only on `true`, and stays
 * OPEN (not collapsed) after a successful save.
 *
 * ⛔ "WANT TO TRY" (B669312) — now block 4 (Actions), not a standalone pill under the title: see
 * ActionsRow below. FoodApp still owns the actual flag state; this file only renders `wishlisted`
 * and calls `onToggleWishlist`.
 *
 * ⛔ EDIT A PAST VISIT (owner block, 2026-08-28, verbatim: "I should be able to edit previous
 * visits" — the ··· menu offered only Delete, so a mistyped rating or a date remembered later
 * meant destroying the record and re-entering it). VisitForm now takes an `initial` prop (the
 * visit being edited, or undefined for a fresh log) and a `submitLabel` — otherwise it is the
 * EXACT SAME component/logic for both paths, never a second form, so the 0.25-step slider,
 * natural-precision display, and every other VisitForm behavior apply identically to editing.
 * `VisitCard` renders VisitForm INLINE in place of its own content while editing (never a modal),
 * reachable via a new "Edit" menu item AND by tapping the card itself. Cancel is free: nothing is
 * written until Save, so discarding the form's local state is the whole "restore" story. On
 * Save, FoodApp's `editVisit` uses the identical optimistic-update/rollback shape `submitVisit`
 * already uses for a new visit — see its own header comment for why that's also this table's
 * "op-envelope" equivalent. On FAILURE, the edit form stays open with the typed values intact
 * (VisitForm's own B668194 clear-only-on-confirmed-save gate already does this for free — the
 * SAME mechanism, not a new one) — so nothing typed is lost and the card's own DISPLAY view never
 * shows an edited value that isn't actually in the database yet.
 *
 * ⛔ VISIT CARD LAYOUT (owner block, 2026-08-28, verbatim: "I feel like the three dots and date
 * should be more in line with the rest of the info" — on his screenshot, the date/··· sat flush
 * against the far edge, ~600px from the rating chips on a 390pt screen). The date now lives
 * INSIDE the same flex-wrap row as the chips, in the same muted secondary-text style, so it
 * reads as one connected line of metadata rather than two disconnected halves of the card. The
 * ··· button is its OWN fixed-size flex item in the row's rightmost column — no longer grouped
 * with the date, so its x-position no longer shifts with the date text's length ("Date unknown"
 * vs "Aug 15" are different widths) — and the row's `alignItems: "center"` keeps ··· vertically
 * centred against however tall that card's own chip+date content happens to be, whether it wraps
 * to one line or two.
 *
 * ⛔ STICKY HEADER (owner block, 2026-08-28 — flagged from a screenshot, NOT reported as a bug;
 * checked before acting). Before this, PanelHeader was a plain first child of the panel's one
 * scrolling container (BottomSheet's contentRef on mobile, this file's own overflowY:auto div on
 * desktop) — nothing made it sticky, and no comment anywhere in this file or BottomSheet.jsx ever
 * claimed that was deliberate (contrast ActionsRow just below, which IS deliberately sticky, WITH
 * its own reasoning). That is a genuine, unflagged gap, not an intentional choice caught mid-
 * scroll — so it's fixed: PanelHeader is now wrapped in its own `position: sticky; top: 0` div,
 * INSIDE the same `peekRef` block whose height already drives the sheet's "peek" snap sizing (a
 * sticky child still contributes its normal-flow height to `offsetHeight`, so that measurement is
 * unaffected). Deliberately NOT the whole peekRef block (header + score strip) — pinning the score
 * strip too would permanently eat a large share of the "half" snap's limited height for no benefit
 * the screenshot asked for.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import BottomSheet from "./BottomSheet.jsx";
import { colorForRating, textColorForRating } from "../lib/ratingColor.js";
import { computeVisitAggregates, orderAgainEntries } from "../lib/visitAggregates.js";
import { formatVisitDate, formatRelativeDate, formatMonthYear } from "../lib/dateFormat.js";
import { directionsUrl } from "../lib/directions.js";
import { formatCategory, formatAddress, formatCityFromAddress } from "../lib/formatPlace.js";
import { RADIUS } from "../../../shared/ui/radius.js";

// var(--accent-food) — a real DOM/CSS element (unlike FoodMap's canvas-drawn pin, which must use
// the literal hex because a 2D canvas context has no cascade to resolve var() against), so this
// uses the theme token like every other piece of chrome in this app. It resolves to the exact
// same colour as FoodMap.jsx's SELECTED_ACCENT at runtime — that's what ties the two together.
const SELECTED_ACCENT = "var(--accent-food)";

// The same breakpoint AppHeader.jsx already uses for its own "narrow" layout switch — reused
// verbatim rather than picking a second number, so the whole app agrees on what "mobile" means.
const MOBILE_BREAKPOINT = "(max-width: 760px)";
// NEW-1 (2026-08-27 owner block) — long enough to register as a real confirmation, short enough
// to never feel like something that needs dismissing (it never does — no button, no modal).
const SAVE_CONFIRMATION_MS = 2500;

function useIsMobile() {
  const [mobile, setMobile] = useState(() => {
    try { return window.matchMedia(MOBILE_BREAKPOINT).matches; } catch (_) { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia(MOBILE_BREAKPOINT); } catch (_) { return undefined; }
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange));
  }, []);
  return mobile;
}

const RATING_MAX = 10;
const RATING_MIN = 1;
const RATING_STEP = 0.25;
const RATING_SLIDER_REST = 5.5; // purely the thumb's visual resting spot before any touch — never committed as a value

function RatingSlider({ value, onChange, label }) {
  const active = value != null;
  const shown = active ? value : RATING_SLIDER_REST;
  const color = colorForRating(shown) || "var(--accent-food)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span
          aria-live="polite"
          style={{
            fontSize: 18, fontWeight: 700, lineHeight: 1,
            color: active ? textColorForRating(shown) : "var(--text-tertiary)",
            background: active ? color : "transparent", borderRadius: 6,
            padding: active ? "2px 8px" : 0,
          }}
        >
          {active ? `${shown} / ${RATING_MAX}` : "Not rated"}
        </span>
        {active && (
          <button type="button" onClick={() => onChange(null)} style={{
            border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer",
            font: "inherit", fontSize: 11.5, padding: 0, textDecoration: "underline",
          }}>
            Clear
          </button>
        )}
      </div>
      <input
        type="range" min={RATING_MIN} max={RATING_MAX} step={RATING_STEP}
        value={shown} onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label} aria-valuetext={active ? `${shown} out of ${RATING_MAX}` : "not rated"}
        style={{ width: "100%", accentColor: color, cursor: "pointer" }}
      />
    </div>
  );
}

function fieldStyle() {
  return {
    width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8,
    border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)",
    font: "inherit", fontSize: 13, minHeight: 40,
  };
}

function VisitForm({ onSubmit, onCancel, pending, onSaved, initial, submitLabel = "Log this visit" }) {
  // `initial` (the visit being edited) is a lazy-initializer READ ONCE at mount — VisitCard
  // unmounts/remounts this form every time editing toggles off then on again, so re-opening edit
  // always starts from the CURRENT saved row, never a stale in-progress edit from before a Cancel.
  // rating/rating_ambiance are Postgres `numeric` -> PostgREST strings ("8.25"), same Number()
  // coercion every other read site in this module already applies.
  const [rating, setRating] = useState(() => (initial?.rating != null ? Number(initial.rating) : null));
  const [ratingAmbiance, setRatingAmbiance] = useState(() => (initial?.rating_ambiance != null ? Number(initial.rating_ambiance) : null));
  const [cost, setCost] = useState(() => (initial?.cost != null ? String(initial.cost) : ""));
  const [visitedOn, setVisitedOn] = useState(() => initial?.visited_on || ""); // never pre-filled on a FRESH log — see header comment
  const [whatIHad, setWhatIHad] = useState(() => initial?.what_i_had || "");
  const [whatWasGood, setWhatWasGood] = useState(() => initial?.what_was_good || "");
  const [notes, setNotes] = useState(() => initial?.notes || "");
  const [wouldReturn, setWouldReturn] = useState(() => initial?.would_return ?? null);

  const submit = async (e) => {
    e.preventDefault();
    const saved = await onSubmit({
      rating,
      rating_ambiance: ratingAmbiance,
      cost: cost === "" ? null : Number(cost),
      visited_on: visitedOn || null,
      what_i_had: whatIHad || null,
      what_was_good: whatWasGood || null,
      notes: notes || null,
      would_return: wouldReturn,
    });
    // Only on a CONFIRMED save (B668194, see header comment) — a failed write leaves everything
    // typed so nothing is lost, and the panel's own error banner already says why.
    if (saved) {
      setRating(null);
      setRatingAmbiance(null);
      setCost("");
      setVisitedOn("");
      setWhatIHad("");
      setWhatWasGood("");
      setNotes("");
      setWouldReturn(null);
      // NEW-1 (2026-08-27 owner block) — the SAME confirmed-save gate B668194 already uses for
      // clearing the form; the "✓ Visit saved" banner (VisitPanel, above) must never fire on a
      // failed save (the error banner already covers that case).
      onSaved?.();
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 16px 14px" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
        Food
        <RatingSlider value={rating} onChange={setRating} label="Food rating" />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
        Ambiance
        <RatingSlider value={ratingAmbiance} onChange={setRatingAmbiance} label="Ambiance rating" />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span>Date</span>
          {/* Explicit clear affordance, matching the rating slider's own "Clear" link — a native
           * date input's built-in clear gesture isn't reliably reachable on every platform (a
           * concern that matters for editing: "date (including clearing it back to unknown)"). */}
          {visitedOn && (
            <button type="button" onClick={() => setVisitedOn("")} style={{
              border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer",
              font: "inherit", fontSize: 11.5, padding: 0, textDecoration: "underline",
            }}>
              Clear
            </button>
          )}
        </div>
        <input type="date" value={visitedOn} onChange={(e) => setVisitedOn(e.target.value)} style={fieldStyle()} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
        What I had
        <input type="text" value={whatIHad} onChange={(e) => setWhatIHad(e.target.value)} placeholder="Brisket plate, queso…" style={fieldStyle()} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
        What was good
        <input type="text" value={whatWasGood} onChange={(e) => setWhatWasGood(e.target.value)} placeholder="The hamachi, the agedashi…" style={fieldStyle()} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
        Cost
        <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" style={fieldStyle()} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...fieldStyle(), resize: "vertical" }} />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--text-secondary)" }}>
        Would return?
        <button type="button" onClick={() => setWouldReturn(wouldReturn === true ? null : true)}
          style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, padding: "6px 12px", minHeight: 32, cursor: "pointer",
            background: wouldReturn === true ? "var(--accent-food)" : "transparent",
            color: wouldReturn === true ? "var(--on-accent-food)" : "var(--text-primary)", font: "inherit", fontSize: 12, fontWeight: 700 }}>
          Yes
        </button>
        <button type="button" onClick={() => setWouldReturn(wouldReturn === false ? null : false)}
          style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, padding: "6px 12px", minHeight: 32, cursor: "pointer",
            background: wouldReturn === false ? "var(--chrome-muted)" : "transparent",
            color: "var(--text-primary)", font: "inherit", fontSize: 12, fontWeight: 700 }}>
          No
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button type="submit" disabled={pending} style={{
          flex: 1, border: "none", borderRadius: RADIUS.md, padding: "10px 0", minHeight: 44, cursor: pending ? "default" : "pointer",
          background: "var(--accent-food)", color: "var(--on-accent-food)", font: "inherit", fontSize: 13.5, fontWeight: 700,
          opacity: pending ? 0.6 : 1,
        }}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} style={{
          border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "10px 14px", minHeight: 44, cursor: "pointer",
          background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 13,
        }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Chip({ label, value }) {
  return (
    <span style={{
      display: "inline-block", borderRadius: 5, padding: "2px 7px", fontWeight: 700, fontSize: 11.5,
      background: colorForRating(value), color: textColorForRating(value),
    }}>
      {label} {Number(value)}/{RATING_MAX}
    </span>
  );
}

function WouldReturnChip() {
  return (
    <span style={{
      display: "inline-block", borderRadius: 5, padding: "2px 7px", fontWeight: 700, fontSize: 11.5,
      background: "var(--surface-page)", border: "1px solid var(--border-default)", color: "var(--text-secondary)",
    }}>
      Would return
    </span>
  );
}

/* Header (block 1). Name at ~20px/680 wraps to two lines rather than truncating; line 2 is
 * category + city/neighbourhood ("French Restaurant · River Oaks"); line 3 is the address as a
 * TAPPABLE directions link (NEW-2: "It should be tappable and open directions" — a plain maps
 * URL, no SDK/key, Apple Maps on iOS/Safari, Google Maps' directions URL elsewhere). Close is a
 * circular icon button, not a bare glyph, and is >=44px either way (min-width/min-height win over
 * the smaller visual width/height, satisfying NEW-2's tap-target rule without a second style). */
function PanelHeader({ manualNameEditable, manualName, onManualNameChange, name, category, address, lat, lon, onClose }) {
  const city = formatCityFromAddress(address);
  const categoryLine = [formatCategory(category), city].filter(Boolean).join(" · ");
  const formattedAddress = formatAddress(address);
  const mapsUrl = directionsUrl(lat, lon);
  return (
    <div style={{ padding: "14px 16px 8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        {manualNameEditable ? (
          <input
            type="text" autoFocus value={manualName} onChange={(e) => onManualNameChange(e.target.value)}
            placeholder="Name this place" style={{ ...fieldStyle(), fontSize: 17, fontWeight: 700 }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0, flex: 1 }}>
            <span data-testid="food-panel-accent-dot" aria-hidden="true" style={{
              display: "inline-block", width: 9, height: 9, borderRadius: "50%", marginTop: 8,
              background: SELECTED_ACCENT, flex: "0 0 auto",
            }} />
            <div style={{
              fontSize: 20, fontWeight: 680, letterSpacing: "-0.01em", lineHeight: 1.22,
              color: "var(--text-primary)", overflowWrap: "anywhere",
            }}>
              {name}
            </div>
          </div>
        )}
        <button
          type="button" onClick={onClose} aria-label="Close" data-testid="food-panel-close"
          style={{
            flex: "0 0 auto", width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: "50%",
            border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-secondary)",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15, padding: 0,
          }}
        >
          ✕
        </button>
      </div>
      {categoryLine && <div style={{ marginTop: 3, marginLeft: 17, fontSize: 13, color: "var(--text-secondary)" }}>{categoryLine}</div>}
      {formattedAddress && mapsUrl && (
        <a
          href={mapsUrl} target="_blank" rel="noopener noreferrer" data-testid="food-directions-link"
          style={{ display: "block", marginTop: 2, marginLeft: 17, fontSize: 12.5, color: "var(--accent-food)", textDecoration: "none" }}
        >
          {formattedAddress}
        </a>
      )}
    </div>
  );
}

/* Score strip (block 2) — only when pastVisits.length > 0 (NEW-2: "No aggregates at all. He
 * cannot see his average food score, his ambiance average, how many times he has been, when he
 * last went, or what he typically spends"). Four tiles, tabular-nums so digits don't jitter as
 * they change; a missing ambiance/cost average reads as an em dash, never a misleading 0. */
function ScoreStrip({ aggregates }) {
  const { avgFood, avgAmbiance, visitCount, avgCost, lastVisitDate, firstVisitDate } = aggregates;
  const tiles = [
    { key: "food", label: "Food", hero: true, text: avgFood == null ? "—" : avgFood.toFixed(1) },
    { key: "ambiance", label: "Ambiance", text: avgAmbiance == null ? "—" : avgAmbiance.toFixed(1) },
    { key: "visits", label: "Visits", text: String(visitCount) },
    { key: "cost", label: "Cost", text: avgCost == null ? "—" : `$${avgCost.toFixed(2)}` },
  ];
  const lastLine = lastVisitDate ? `Last ${formatVisitDate(lastVisitDate)} · ${formatRelativeDate(lastVisitDate)}` : null;
  const firstLine = firstVisitDate ? `Since ${formatMonthYear(firstVisitDate)}` : null;
  return (
    <div data-testid="food-score-strip" style={{ padding: "6px 16px 4px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 7 }}>
        {tiles.map((t) => (
          <div key={t.key} style={{
            borderRadius: 10, padding: "8px 4px", textAlign: "center", border: "1px solid var(--border-default)",
            background: t.hero ? "color-mix(in srgb, var(--accent-food) 14%, var(--surface-page))" : "var(--surface-page)",
          }}>
            <div style={{
              fontSize: 17, fontWeight: 750, fontVariantNumeric: "tabular-nums",
              color: t.hero ? "var(--accent-food)" : "var(--text-primary)",
            }}>
              {t.text}
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-tertiary)", marginTop: 2 }}>
              {t.label}
            </div>
          </div>
        ))}
      </div>
      {(lastLine || firstLine) && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-tertiary)" }}>
          {[lastLine, firstLine].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

/* Order again (block 3) — only when at least one visit has what_was_good, ABOVE Past visits, not
 * inside it ("the thing he opens the app for while standing at the door"). Newest-first, deduped
 * on identical text — still deliberately UNPARSED (never split on commas into a dish taxonomy),
 * same principle the original what_was_good feature established. */
function OrderAgain({ entries }) {
  if (!entries.length) return null;
  return (
    <div data-testid="food-order-again" style={{
      margin: "6px 16px 0", padding: "9px 11px", borderRadius: 10,
      background: "color-mix(in srgb, var(--accent-food) 10%, var(--surface-page))", border: "1px solid var(--border-default)",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-tertiary)" }}>
        Order again
      </div>
      <div style={{ marginTop: 3, fontSize: 13.5, color: "var(--text-primary)" }}>{entries.join("; ")}</div>
    </div>
  );
}

/* Actions (block 4) — "Log a visit" full-width primary + "Want to try" secondary toggle beside
 * it; on a NEVER-VISITED place the roles swap (want-to-try becomes primary). Sticky to the
 * bottom of whichever scroll container holds it (the sheet's content area on mobile, the
 * desktop panel's own scroll region) so it stays reachable once Past visits grows past the fold
 * — NEW-2: "On mobile it stays reachable - pin it to the bottom of the sheet when the history
 * scrolls." Filled-with-a-check when the flag is on, outline when off. */
function ActionsRow({ everVisited, onOpenForm, wishlisted, onToggleWishlist, wishlistDisabled }) {
  const base = {
    border: "1px solid var(--border-default)", borderRadius: 10, cursor: "pointer",
    font: "inherit", fontWeight: 700, minHeight: 44,
  };
  const primary = { ...base, flex: 1, border: "none", padding: "11px 0", fontSize: 14, background: "var(--accent-food)", color: "var(--on-accent-food)" };
  const secondary = { ...base, flex: "0 0 auto", padding: "11px 16px", fontSize: 13, background: "transparent", color: "var(--text-primary)" };
  const wishActive = { background: "var(--accent-food)", color: "var(--on-accent-food)", border: "none" };

  // The wishlist toggle only renders when a handler is actually provided (signed out /
  // not applicable) — independent of `onSubmitVisit`'s own gating one level up, so this stays
  // true even if a future change ever lets the two diverge. When it's absent, "Log a visit"
  // takes the full-width primary slot on its own rather than being stranded as a lone secondary.
  const logIsPrimary = everVisited || !onToggleWishlist;
  const logBtn = (
    <button key="log" type="button" onClick={onOpenForm} data-testid="food-log-visit-btn" style={logIsPrimary ? primary : secondary}>
      Log a visit
    </button>
  );
  // NEW-1 (2026-08-27 owner block, part of the save-confirmation item) — a place-level "want to
  // try" is meaningless once he's actually been (owner: "remove the want to try option from a
  // restaurant I've already visited"). Gone entirely once visited, not just demoted to secondary
  // — a stale control here is exactly the "did this actually do something" ambiguity this same
  // item is fixing elsewhere. `logIsPrimary` already treats `everVisited` the same as "no wishlist
  // handler at all", so `logBtn` correctly takes the full-width primary slot the instant this
  // disappears — no extra branch needed there. (Dish-level want-to-try on a visited place is
  // B707842's own, separately-tracked follow-up — this only removes the now-meaningless
  // PLACE-level control; it doesn't replace it with anything.)
  const wishBtn = onToggleWishlist && !everVisited && (
    <button
      key="wish" type="button" onClick={onToggleWishlist} disabled={wishlistDisabled} aria-pressed={wishlisted}
      data-testid="food-wishlist-toggle"
      style={{
        ...primary,
        ...(wishlisted ? wishActive : {}),
        opacity: wishlistDisabled ? 0.5 : 1,
        cursor: wishlistDisabled ? "default" : "pointer",
      }}
    >
      {wishlisted ? "✓ Want to try" : "Want to try"}
    </button>
  );

  return (
    <div data-testid="food-actions-row" style={{
      position: "sticky", bottom: 0, display: "flex", gap: 8, padding: "10px 16px",
      background: "var(--surface-raised)", borderTop: "1px solid var(--border-default)",
    }}>
      {(everVisited ? [logBtn, wishBtn] : [wishBtn, logBtn]).filter(Boolean)}
    </div>
  );
}

/* Past visits (block 5) — one card per visit. Chips (Food/Ambiance/Would return) AND the date
 * share one flex-wrap row (owner block, 2026-08-28 — see the file header comment on VISIT CARD
 * LAYOUT for why), a "···" overflow button sits in its own fixed-position column. Only non-empty
 * lines render ("Had X" / "Good X" / cost) — never an empty labelled row. Delete AND Edit live
 * behind the overflow menu; Delete keeps its INLINE confirm (no window.confirm — this module's
 * own house rule), through AnchoredMenu (the SAME portal-based menu SearchBox already uses)
 * because this button sits inside a scrolling list — a plain absolutely-positioned dropdown here
 * would hit the exact clipping bug AnchoredMenu was built to fix (B632176). Undated visits render
 * at reduced emphasis and sort last (already true of the incoming pastVisits order —
 * foodStore.fetchAllVisits orders nullsFirst:false).
 *
 * EDIT (owner block, 2026-08-28) — tapping the card itself OR the new "Edit" menu item opens
 * `VisitForm` inline, replacing the card's own content in place (never a modal). `editing` is
 * OWNED BY THE PARENT (PastVisitsSection/VisitPanel), not local state here, so VisitPanel can
 * enforce "only one form open at a time" against the log-a-new-visit form. */
function VisitCard({ visit, onDelete, editing, onOpenEdit, onCloseEdit, onSubmitEdit, pending }) {
  const menuBtnRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dateless = !visit.visited_on;
  const hasRating = visit.rating != null;
  const hasAmbiance = visit.rating_ambiance != null;
  const hasWouldReturn = visit.would_return === true;

  const closeMenu = () => { setMenuOpen(false); setConfirming(false); };

  if (editing) {
    return (
      <div data-testid="food-visit-card-editing" style={{ borderBottom: "1px solid var(--border-default)" }}>
        <VisitForm
          initial={visit} submitLabel="Save changes" pending={pending}
          onCancel={onCloseEdit} onSubmit={onSubmitEdit} onSaved={onCloseEdit}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="food-visit-card" onClick={onOpenEdit} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpenEdit(); }}
      style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-default)", opacity: dateless ? 0.65 : 1, cursor: "pointer" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", flex: 1, minWidth: 0 }}>
          {hasRating && <Chip label="Food" value={visit.rating} />}
          {hasAmbiance && <Chip label="Ambiance" value={visit.rating_ambiance} />}
          {hasWouldReturn && <WouldReturnChip />}
          {!hasRating && !hasAmbiance && !hasWouldReturn && <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>—</span>}
          <span style={{ fontSize: 12, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>{formatVisitDate(visit.visited_on)}</span>
        </div>
        <button
          ref={menuBtnRef} type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }} aria-label="Visit options"
          data-testid="food-visit-menu-btn"
          style={{
            flex: "0 0 auto", border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 17,
            minWidth: 44, minHeight: 44, lineHeight: 1, padding: 0,
          }}
        >
          ···
        </button>
        <AnchoredMenu
          open={menuOpen} onClose={closeMenu} anchorRef={menuBtnRef} placement="below-right" width={190} gap={4}
          panelStyle={{
            background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: 10,
            boxShadow: "0 10px 28px rgba(0,0,0,0.22)", padding: 6,
          }}
        >
          {!confirming ? (
            <div onClick={(e) => e.stopPropagation()}>
              <button
                type="button" onClick={() => { closeMenu(); onOpenEdit(); }} data-testid="food-visit-edit-menu-item"
                style={{
                  display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent",
                  borderRadius: RADIUS.sm, padding: "9px 10px", minHeight: 44, cursor: "pointer", font: "inherit", fontSize: 13,
                  color: "var(--text-primary)",
                }}
              >
                Edit
              </button>
              <button
                type="button" onClick={() => setConfirming(true)} data-testid="food-visit-delete-menu-item"
                style={{
                  display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent",
                  borderRadius: RADIUS.sm, padding: "9px 10px", minHeight: 44, cursor: "pointer", font: "inherit", fontSize: 13,
                  color: "var(--danger-text, var(--danger))",
                }}
              >
                Delete
              </button>
            </div>
          ) : (
            <div style={{ padding: "6px 4px" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 7 }}>Delete this visit?</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button" onClick={closeMenu}
                  style={{
                    flex: 1, border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, padding: "7px 0", minHeight: 36,
                    background: "transparent", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontSize: 12.5,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button" onClick={() => { onDelete(visit.id); closeMenu(); }} data-testid="food-visit-delete-confirm"
                  style={{
                    flex: 1, border: "1px solid var(--danger-border, var(--danger))", borderRadius: RADIUS.sm, padding: "7px 0", minHeight: 36,
                    background: "transparent", color: "var(--danger-text, var(--danger))", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 700,
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </AnchoredMenu>
      </div>
      {visit.what_i_had && <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-primary)" }}>Had {visit.what_i_had}</div>}
      {visit.what_was_good && <div style={{ marginTop: 2, fontSize: 13, color: "var(--text-secondary)" }}>Good {visit.what_was_good}</div>}
      {visit.cost != null && <div style={{ marginTop: 2, fontSize: 13, color: "var(--text-secondary)" }}>${Number(visit.cost).toFixed(2)}</div>}
      {visit.notes && <div style={{ marginTop: 2, fontSize: 12.5, color: "var(--text-tertiary)" }}>{visit.notes}</div>}
    </div>
  );
}

function PastVisitsSection({ pastVisits, onDelete, onEditVisit, editingVisitId, onOpenEdit, onCloseEdit, pending }) {
  if (!pastVisits.length) return null;
  return (
    <div data-testid="food-past-visits">
      <div style={{ padding: "12px 16px 2px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-tertiary)" }}>
        Past visits · {pastVisits.length}
      </div>
      {pastVisits.map((v) => (
        <VisitCard
          key={v.id} visit={v} onDelete={onDelete}
          editing={editingVisitId === v.id} pending={pending}
          onOpenEdit={() => onOpenEdit(v.id)} onCloseEdit={onCloseEdit}
          onSubmitEdit={onEditVisit ? (fields) => onEditVisit(v.id, fields) : undefined}
        />
      ))}
    </div>
  );
}

/* Empty state (block 6, replaces 2-5 entirely) — never visited: no score strip, no "Past visits
 * (0)" header, no empty tiles. Just the header, the swapped actions row, and one explanatory
 * line (NEW-2). */
function EmptyStateNote() {
  return (
    <div style={{ padding: "2px 16px 12px", fontSize: 12.5, color: "var(--text-tertiary)" }}>
      Shows as a hollow pin on the map until you log a visit here.
    </div>
  );
}

export default function VisitPanel({
  place, pastVisits, onClose, onSubmitVisit, onDeleteVisit, onEditVisit, pending, error,
  manualNameEditable, manualName, onManualNameChange,
  wishlisted, onToggleWishlist, onSheetHeightChange,
}) {
  const isMobile = useIsMobile();
  const [adding, setAdding] = useState(false); // NEW-2: never auto-opens, even on a never-visited place
  // Edit-a-visit (owner block, 2026-08-28) — which existing visit's card (if any) is showing its
  // edit form inline, in place of the card. Lifted here rather than local to VisitCard so this
  // panel can enforce "only one form open at a time" against the log-a-new-visit form above —
  // opening one closes the other, so `pending`/`error` (both FoodApp-global) always describe the
  // ONE write actually in flight.
  const [editingVisitId, setEditingVisitId] = useState(null);
  const handleOpenEdit = useCallback((id) => { setAdding(false); setEditingVisitId(id); }, []);
  const handleCloseEdit = useCallback(() => setEditingVisitId(null), []);
  const peekRef = useRef(null);
  const [peekHeight, setPeekHeight] = useState(140);

  const visits = useMemo(() => pastVisits || [], [pastVisits]);
  const everVisited = visits.length > 0;
  const aggregates = useMemo(() => computeVisitAggregates(visits), [visits]);
  const orderAgain = useMemo(() => orderAgainEntries(visits), [visits]);
  const wishlistDisabled = manualNameEditable && !(manualName || "").trim();

  // NEW-1 (2026-08-27 owner block) — "when I click log this visit, it should not make it seem
  // like nothing happened." Saving already updates the list/aggregates/panel-state/map-pin (all
  // derive from FoodApp's own `visits` state — see FoodApp.jsx's submitVisit for the optimistic
  // add that makes those land in the SAME beat as the click), but nothing EXPLICITLY said "saved"
  // — a cleared form reads as "did nothing" as easily as "it worked." `savedNonce` increments on
  // every confirmed save (VisitForm calls `onSaved` only when `onSubmit` resolved true, mirroring
  // the B668194 field-clear contract exactly), and the banner auto-dismisses — never a modal, never
  // something to dismiss by hand.
  const [savedNonce, setSavedNonce] = useState(0);
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (savedNonce === 0) return undefined; // never shown on mount, only on a REAL save
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), SAVE_CONFIRMATION_MS);
    return () => clearTimeout(t);
  }, [savedNonce]);
  const handleSaved = useCallback(() => setSavedNonce((n) => n + 1), []);

  // Escape clears the selection exactly like the close button.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The bottom sheet's "peek" snap is sized to exactly this block (header + score strip, or
  // header + empty-state note when there's nothing to score yet) — measured here, not guessed,
  // so BottomSheet never has to know what "peek" means content-wise. Deliberately no deps array
  // (re-measures after every render, since the block's content can change in ways this component
  // has no single dependency to name — manualName length wrapping the header, aggregates text
  // changing digit count, error banner appearing) — safe against a render loop because
  // setPeekHeight with the SAME number is a no-op in React (Object.is bails the re-render).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (peekRef.current) setPeekHeight(peekRef.current.offsetHeight);
  });

  // Opening the log-a-new-visit form also closes any in-progress edit — see the state comment
  // above on why only one form is ever open at once.
  const handleOpenForm = () => { setEditingVisitId(null); setAdding(true); };

  const body = (
    <>
      <div ref={peekRef}>
        {/* Sticky header (owner block, 2026-08-28 — see the file header comment on STICKY HEADER
         * for why this was a genuine gap, not a deliberate choice). Wrapped here, INSIDE peekRef,
         * so the sheet's peek-height measurement (unchanged, above) still sees this block's real
         * height — position:sticky doesn't remove an element from normal flow. */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--surface-raised)" }}>
          <PanelHeader
            manualNameEditable={manualNameEditable} manualName={manualName} onManualNameChange={onManualNameChange}
            name={place?.name} category={place?.category} address={place?.address} lat={place?.lat} lon={place?.lon}
            onClose={onClose}
          />
        </div>
        {showSaved && (
          // NEW-1 — deliberately INSIDE peekRef's own measured div, not an absolute overlay: it
          // never covers the close button or the title, and BottomSheet's own "peek" height
          // effect (see the header comment above) already re-measures on every render with no
          // deps, so the sheet smoothly grows to reveal this and settles back when it clears —
          // reusing the existing smooth-resettle machinery instead of fighting it with a new one.
          <div role="status" data-testid="food-save-confirmation" style={{
            margin: "0 16px 8px", padding: "7px 10px", borderRadius: 8,
            background: "var(--success-bg)", color: "var(--success-text)", border: "1px solid var(--success-border)",
            fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6,
          }}>
            ✓ Visit saved
          </div>
        )}
        {everVisited && <ScoreStrip aggregates={aggregates} />}
        {!everVisited && !adding && <EmptyStateNote />}
      </div>

      {everVisited && <OrderAgain entries={orderAgain} />}

      {error && (
        <div role="alert" style={{ margin: "8px 16px 0", padding: "8px 10px", borderRadius: 8, background: "var(--danger-bg, rgba(220,38,38,0.1))", color: "var(--danger-text, var(--danger))", fontSize: 12 }}>
          {error}
        </div>
      )}

      {onSubmitVisit && (adding ? (
        <VisitForm pending={pending} onCancel={() => setAdding(false)} onSubmit={onSubmitVisit} onSaved={handleSaved} />
      ) : (
        <ActionsRow
          everVisited={everVisited} onOpenForm={handleOpenForm}
          wishlisted={wishlisted} onToggleWishlist={onToggleWishlist} wishlistDisabled={wishlistDisabled}
        />
      ))}

      <PastVisitsSection
        pastVisits={visits} onDelete={onDeleteVisit} onEditVisit={onEditVisit} pending={pending}
        editingVisitId={editingVisitId} onOpenEdit={handleOpenEdit} onCloseEdit={handleCloseEdit}
      />
    </>
  );

  if (isMobile) {
    return (
      <BottomSheet open onDismiss={onClose} initialSnap="half" peekHeight={peekHeight} onHeightChange={onSheetHeightChange}>
        {body}
      </BottomSheet>
    );
  }

  return (
    <div data-testid="food-visit-panel" style={{
      position: "absolute", top: 0, right: 0, bottom: 0, width: 340, maxWidth: "90vw", // matches FoodMap.jsx's own PANEL_WIDTH (its fly-to pan-offset assumes this)
      background: "var(--surface-raised)", borderLeft: "1px solid var(--border-default)",
      boxShadow: "-8px 0 24px rgba(0,0,0,0.18)", zIndex: 600, display: "flex", flexDirection: "column",
      overflowY: "auto",
    }}>
      {body}
    </div>
  );
}
