/* VisitPanel — click a pin (or drop a new one), log what you had, rate it, note the cost.
 * A right-side panel, never a dialog box. Shows every past visit at this place first (the
 * "click an existing restaurant" convenience the brief asks for), then a form to add another.
 *
 * ⛔ RATING CONTROL (owner correction, 2026-08-18: "obviously there shouldn't be individual
 * buttons for 20 options" — after asking for half-point steps, which a 1-10 button row can't
 * hold without becoming 19-20 tap targets). ONE control: a native range slider, min 1 max 10
 * step 0.5 — the obvious one-thumbed-usable fit on a phone, and `accent-color` lets it preview
 * the exact ramp colour the chosen number will paint on the map (lib/ratingColor.js) without
 * hand-rolling a custom widget. The current value is always shown as a number next to the
 * slider, never only as a thumb position. Stays OPTIONAL, same as before: the slider only
 * commits a value once the user actually moves it (tracked by `rating` staying `null` in form
 * state until `onChange` fires), and a "Clear" link reverts to unrated — nothing is silently
 * defaulted onto an unrated visit, same principle as the date field below.
 *
 * ⛔ DATE FIELD (owner correction, 2026-08-18: "don't default to have a date, i want to rate
 * restaurants i've been to before and don't remember the date i visited"). Starts EMPTY —
 * never pre-filled with today — and stays optional; see VisitForm's `visitedOn` state below.
 *
 * ⛔ AMBIANCE RATING (B634978, owner, 2026-08-19: "add an ambiance rating too, matching scale"). A SECOND,
 * independent RatingSlider — same control, same scale, stacked directly under the food one. Once
 * there are two sliders, "Rating" alone is ambiguous, so both are labelled explicitly: "Food" and
 * "Ambiance". THE MAP PIN STAYS KEYED TO FOOD ONLY — this file never feeds rating_ambiance into
 * anything that touches pin colour (that logic lives entirely in foodStore.js and never reads
 * this column); ambiance only ever renders here and in VisitList.
 *
 * ⛔ SELECTION TIE + ESCAPE (B634976, owner, 2026-08-19: "tie the panel to the pin so the eye connects
 * them — at minimum a shared colour accent" — see FoodMap.jsx's SELECTED_ACCENT, the identical
 * hex, for the pin side of this; and "closing the panel or pressing Escape clears the selection").
 * The small accent dot before the title is that shared colour; the window-level Escape listener
 * below is the second half — it calls the same `onClose` the ✕ button does, so both routes clear
 * `selected` in FoodApp identically (no separate "escape state" to keep in sync).
 *
 * ⛔ B668194 — CLEAR THE FORM ON A CONFIRMED SAVE, NEVER BEFORE (owner report: after logging a
 * visit, the fields still held what was just submitted, reading as though the save hadn't taken
 * — and the NEXT visit started pre-filled with the previous one's text, a live trap for logging
 * two visits back to back). `onSubmit` (FoodApp's `submitVisit`) now RETURNS a boolean — `true`
 * only once the write actually succeeded and the visit list has been reloaded, `false` on any
 * early-return or a failed write. `VisitForm.submit` awaits that result and resets every field
 * (both rating sliders back to "Not rated", the date back to empty, every text field back to
 * blank) ONLY on `true` — a failed save leaves exactly what was typed so nothing is lost, and the
 * existing error banner above already surfaces the failure. The form stays OPEN (not collapsed
 * back to "+ Log another visit") after a successful save, ready for the next entry in the row.
 *
 * ⛔ "WHAT WAS GOOD" — liked dishes, ACCUMULATED across every visit (B634979, owner chat block, 2026-08-19:
 * "add a place where I can log the food that I liked... deliberately SEPARATE from 'What I had'
 * — 'What I had' is the record of the meal; this is the shortlist of what was actually GOOD").
 * Free text, same weight as `what_i_had`, sitting directly under it in the form — never merged
 * into that field. THE PART THAT MAKES IT USEFUL: `LikedDishes` below reads every past visit's
 * `what_was_good` and surfaces them as ONE summary at the TOP of the panel, before "Past visits"
 * — not buried one visit deep ("when he is standing outside Soto for the third time, the panel
 * should already be telling him 'you liked: the hamachi, the agedashi'"). Kept deliberately
 * unparsed: each visit's own text is joined with the next by "; ", never split on commas or
 * de-duplicated — that starts to be a dish taxonomy, which the brief explicitly says not to
 * build. Renders nothing at all when no past visit has one set (owner: "handle the empty case
 * quietly — shows nothing rather than an empty heading").
 *
 * ⛔ "WANT TO TRY" TOGGLE (B669312, owner chat block, 2026-08-22: "flag places he has not been to
 * yet... a single toggle in the place detail panel, working with zero visits. One click on, one
 * click off"). Rendered right under the title/subtitle, ABOVE the past-visits list and the visit
 * form, so it's reachable and visibly stateful whether or not `pastVisits` is empty — the whole
 * point is that it works for a place with none. FoodApp owns the actual flag state (which table,
 * which key) — this file only renders `wishlisted` and calls `onToggleWishlist`.
 */
import { useEffect, useState } from "react";
import { colorForRating, textColorForRating } from "../lib/ratingColor.js";

// var(--accent-food) — a real DOM/CSS element (unlike FoodMap's canvas-drawn pin, which must use
// the literal hex because a 2D canvas context has no cascade to resolve var() against), so this
// uses the theme token like every other piece of chrome in this app. It resolves to the exact
// same colour as FoodMap.jsx's SELECTED_ACCENT at runtime — that's what ties the two together.
const SELECTED_ACCENT = "var(--accent-food)";

const RATING_MAX = 10;
const RATING_MIN = 1;
const RATING_STEP = 0.5;
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
          {active ? `${shown.toFixed(1)} / ${RATING_MAX}` : "Not rated"}
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
        aria-label={label} aria-valuetext={active ? `${shown.toFixed(1)} out of ${RATING_MAX}` : "not rated"}
        style={{ width: "100%", accentColor: color, cursor: "pointer" }}
      />
    </div>
  );
}

function fieldStyle() {
  return {
    width: "100%", boxSizing: "border-box", padding: "7px 9px", borderRadius: 8,
    border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)",
    font: "inherit", fontSize: 13,
  };
}

function VisitForm({ onSubmit, onCancel, pending }) {
  const [rating, setRating] = useState(null);
  const [ratingAmbiance, setRatingAmbiance] = useState(null);
  const [cost, setCost] = useState("");
  const [visitedOn, setVisitedOn] = useState(""); // never pre-filled — see header comment
  const [whatIHad, setWhatIHad] = useState("");
  const [whatWasGood, setWhatWasGood] = useState("");
  const [notes, setNotes] = useState("");
  const [wouldReturn, setWouldReturn] = useState(null);

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
    // Only on a CONFIRMED save (see header comment) — a failed write leaves everything typed
    // so nothing is lost, and the panel's own error banner already says why.
    if (saved) {
      setRating(null);
      setRatingAmbiance(null);
      setCost("");
      setVisitedOn("");
      setWhatIHad("");
      setWhatWasGood("");
      setNotes("");
      setWouldReturn(null);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 0" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
        Food
        <RatingSlider value={rating} onChange={setRating} label="Food rating" />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
        Ambiance
        <RatingSlider value={ratingAmbiance} onChange={setRatingAmbiance} label="Ambiance rating" />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
        Date
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
          style={{ border: "1px solid var(--border-default)", borderRadius: 999, padding: "3px 10px", cursor: "pointer",
            background: wouldReturn === true ? "var(--accent-food)" : "transparent",
            color: wouldReturn === true ? "var(--on-accent-food)" : "var(--text-primary)", font: "inherit", fontSize: 12, fontWeight: 700 }}>
          Yes
        </button>
        <button type="button" onClick={() => setWouldReturn(wouldReturn === false ? null : false)}
          style={{ border: "1px solid var(--border-default)", borderRadius: 999, padding: "3px 10px", cursor: "pointer",
            background: wouldReturn === false ? "var(--chrome-muted)" : "transparent",
            color: "var(--text-primary)", font: "inherit", fontSize: 12, fontWeight: 700 }}>
          No
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button type="submit" disabled={pending} style={{
          flex: 1, border: "none", borderRadius: 8, padding: "8px 0", cursor: pending ? "default" : "pointer",
          background: "var(--accent-food)", color: "var(--on-accent-food)", font: "inherit", fontSize: 13, fontWeight: 700,
          opacity: pending ? 0.6 : 1,
        }}>
          {pending ? "Saving…" : "Log this visit"}
        </button>
        <button type="button" onClick={onCancel} style={{
          border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 14px", cursor: "pointer",
          background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 13,
        }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function RatingPill({ label, value }) {
  return (
    <span style={{
      display: "inline-block", borderRadius: 5, padding: "1px 6px", fontWeight: 700, fontSize: 11.5,
      background: colorForRating(value), color: textColorForRating(value),
    }}>
      {label} {Number(value)}/{RATING_MAX}
    </span>
  );
}

function VisitRow({ visit, onDelete }) {
  const hasRating = visit.rating != null;
  const hasAmbiance = visit.rating_ambiance != null;
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border-default)", fontSize: 12.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {hasRating && <RatingPill label="Food" value={visit.rating} />}
          {hasAmbiance && <RatingPill label="Ambiance" value={visit.rating_ambiance} />}
          {!hasRating && !hasAmbiance && <span style={{ color: "var(--text-tertiary)" }}>—</span>}
        </div>
        <span style={{ color: "var(--text-tertiary)" }}>{visit.visited_on || "date unknown"}</span>
      </div>
      {visit.what_i_had && <div style={{ marginTop: 2 }}>{visit.what_i_had}</div>}
      {visit.what_was_good && (
        <div style={{ marginTop: 2, color: "var(--text-secondary)" }}>Liked: {visit.what_was_good}</div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 2, color: "var(--text-secondary)" }}>
        {visit.cost != null && <span>${Number(visit.cost).toFixed(2)}</span>}
        {visit.would_return === true && <span>would return</span>}
        {visit.would_return === false && <span>wouldn't return</span>}
      </div>
      {visit.notes && <div style={{ marginTop: 2, color: "var(--text-secondary)" }}>{visit.notes}</div>}
      <button type="button" onClick={() => onDelete(visit.id)} style={{
        marginTop: 4, border: "none", background: "none", color: "var(--danger)", cursor: "pointer",
        font: "inherit", fontSize: 11.5, padding: 0,
      }}>
        Delete
      </button>
    </div>
  );
}

// Liked dishes, ACCUMULATED across every past visit at this place — see the header comment for
// why this is deliberately unparsed text, joined not split. Renders nothing when nothing to show.
function LikedDishes({ pastVisits }) {
  const entries = (pastVisits || []).map((v) => v.what_was_good).filter(Boolean);
  if (!entries.length) return null;
  return (
    <div style={{
      marginTop: 10, padding: "8px 10px", borderRadius: 8,
      background: "var(--surface-page)", border: "1px solid var(--border-default)",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-tertiary)" }}>
        You liked
      </div>
      <div style={{ marginTop: 2, fontSize: 13, color: "var(--text-primary)" }}>{entries.join("; ")}</div>
    </div>
  );
}

export default function VisitPanel({
  title, subtitle, pastVisits, onClose, onSubmitVisit, onDeleteVisit, pending, error,
  manualNameEditable, manualName, onManualNameChange,
  wishlisted, onToggleWishlist,
}) {
  const [adding, setAdding] = useState((pastVisits || []).length === 0);

  // Escape clears the selection exactly like the ✕ button — see header comment.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div data-testid="food-visit-panel" style={{
      position: "absolute", top: 0, right: 0, bottom: 0, width: 340, maxWidth: "90vw",
      background: "var(--surface-raised)", borderLeft: "1px solid var(--border-default)",
      boxShadow: "-8px 0 24px rgba(0,0,0,0.18)", zIndex: 600, display: "flex", flexDirection: "column",
      padding: "14px 16px", overflowY: "auto",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        {manualNameEditable ? (
          <input
            type="text" autoFocus value={manualName} onChange={(e) => onManualNameChange(e.target.value)}
            placeholder="Name this place" style={{ ...fieldStyle(), fontSize: 15, fontWeight: 700 }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
            <span data-testid="food-panel-accent-dot" aria-hidden="true" style={{
              display: "inline-block", width: 9, height: 9, borderRadius: "50%",
              background: SELECTED_ACCENT, flex: "0 0 auto",
            }} />
            {title}
          </div>
        )}
        <button type="button" onClick={onClose} aria-label="Close" style={{
          border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 16, padding: 2,
        }}>
          ✕
        </button>
      </div>
      {subtitle && <div style={{ marginTop: 2, fontSize: 12, color: "var(--text-secondary)" }}>{subtitle}</div>}

      {onToggleWishlist && (
        <button
          type="button" onClick={onToggleWishlist} aria-pressed={wishlisted} data-testid="food-wishlist-toggle"
          style={{
            marginTop: 8, alignSelf: "flex-start", border: "1px solid var(--border-default)", borderRadius: 999,
            padding: "4px 11px", cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 700,
            background: wishlisted ? "var(--accent-food)" : "transparent",
            color: wishlisted ? "var(--on-accent-food)" : "var(--text-secondary)",
          }}
        >
          {wishlisted ? "Flagged — want to try" : "Want to try"}
        </button>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: "var(--danger-bg, rgba(220,38,38,0.1))", color: "var(--danger-text, var(--danger))", fontSize: 12 }}>
          {error}
        </div>
      )}

      <LikedDishes pastVisits={pastVisits} />

      {(pastVisits || []).length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-tertiary)" }}>
            Past visits ({pastVisits.length})
          </div>
          {pastVisits.map((v) => <VisitRow key={v.id} visit={v} onDelete={onDeleteVisit} />)}
        </div>
      )}

      {onSubmitVisit && (adding ? (
        <VisitForm pending={pending} onCancel={() => setAdding(false)} onSubmit={onSubmitVisit} />
      ) : (
        <button type="button" onClick={() => setAdding(true)} style={{
          marginTop: 12, border: "1px dashed var(--border-default)", borderRadius: 8, padding: "9px 0",
          background: "transparent", color: "var(--text-primary)", font: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}>
          + Log another visit
        </button>
      ))}
    </div>
  );
}
