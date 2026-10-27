/* VisitPanel — the restaurant panel: tap a pin (or drop a new one), see the place, its dishes and visits, log another.
 *
 * ⛔ REDESIGNED (NEW-1 / NEW-2, owner-approved mockup 2026-10-20: "i like it all as is, send it"; built on PR #2366's sheet
 * drag + dish flow, which are untouched). The panel, top to bottom, on every layout (bottom sheet upright, side dock
 * sideways, right rail on desktop — same `body`, only the container differs):
 *  1. HEADER — the name large with the plain close ✕ on the SAME line (no dead space under the drag handle); under it
 *     "<cuisine> · <city> · <price level>" (the word "Restaurant" dropped; the price level is a tappable $…$$$$ control,
 *     filled dark up to the level, the rest light grey, all grey when unset, tapping the current one clears it —
 *     stored per restaurant in food_place_prefs); the address in NEUTRAL GREY reading "<street> · Directions".
 *  2. SCORE PILLS — "8.25 Food" · "8.0 Ambiance" as small light-grey pills + the "+ List" pill (the add-to-list chooser) on
 *     the right. No VISITS tile (the count is in the Visits header), no COST tile, no best-dish line. ONE NUMBER, ONE
 *     PRECISION: every rating is restaurantPanel.formatRating (= dishAggregates.formatScore), so the pill and the visit
 *     row can never disagree ("Food 8.3" vs "8.25" was the shipped defect).
 *  3. THE DISH LIST IS THE ORDER (DishesSection.jsx): WHAT TO ORDER · MAYBE · "Skip · N dishes ▾" (collapsed), each by
 *     score; a row opens the DISH SHEET (DishSheet — back / Done, editable name, the one shared slider, Yes / Maybe / No,
 *     note, history only with 2+ ratings, Rate again + Delete at the bottom); "+ Add a dish" stays at the bottom.
 *  4. VISITS · N — one compact row per visit ("<date> · Food 8.25 · Ambiance 8.0" + chevron; "No date" when undated),
 *     newest first, two shown + "Show N more"; tap = edit inline (VisitForm, Delete inside it behind an inline confirm).
 *  5. "LOG A VISIT" — pinned to the bottom (the LAST thing in the body + sticky), always visible while the sheet scrolls.
 *
 * ⛔ RULES THAT PREDATE THE REDESIGN AND STILL HOLD (each with its guard in test/foodModule.test.js):
 *  · ONE rating control (RatingSlider, 1-10 in QUARTER steps, "Not rated" until touched — owner constraint #16); the
 *    display trims nothing it shouldn't: 8.25 reads "8.25".
 *  · The date is NEVER pre-filled on a fresh log ("Date unknown" is an honest state); Clear link beside it.
 *  · B668194 CLEAR-ON-SAVE: VisitForm clears / closes only on a CONFIRMED save; a failed write keeps everything typed and the
 *    error banner says why (LOUD-FAILURE). B2268433: a confirmed save CLOSES the form and shows "✓ Visit saved · N dishes ·
 *    Edit visit" — never a cleared form inviting another visit.
 *  · Editing a past visit reuses VisitForm (`initial` + `submitLabel`), inline in place — never a modal, never a dialog box;
 *    only one form is open at a time (`editingVisitId` vs `adding`).
 *  · NO "What I had" / "What was good" inputs (owner, 2026-10-03 / 2026-10-11); an old visit's saved text is shown
 *    read-only above its edit form and never rewritten.
 *  · "Want to try" (B669312) sits beside Log a visit only on a never-visited place; Log a visit is ALWAYS primary (B1022960).
 *  · Sticky header (2026-08-28) inside peekRef; the sheet's peek snap is measured from that block, never guessed.
 *  · Drafts survive a rotation (lib/draftStore.js): the panel owns ONE store above all three containers.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import BottomSheet, { FORM_OPEN_CSS } from "./BottomSheet.jsx";
import SideDock from "./SideDock.jsx";
import { useLandscapePhone } from "../lib/phoneLayout.js";
import DishesSection, { DishNameField, DishSheet } from "./DishesSection.jsx";
import { computeVisitAggregates } from "../lib/visitAggregates.js";
import { dishRowsForTable } from "../lib/dishAggregates.js";
import { formatRating, PRICE_LEVELS, nextPriceLevel, headerSubline, visitRowLabel, visitRowParts, visitsToShow } from "../lib/restaurantPanel.js";
import { formatVisitDate } from "../lib/dateFormat.js";
import { directionsUrl } from "../lib/directions.js";
import { formatCuisine, formatAddress, formatCityFromAddress } from "../lib/formatPlace.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { FOOD_TYPE, COLUMN_X, GROUP_STEP, ITEM_STEP } from "../lib/foodType.js";
import SectionLabel from "./SectionLabel.jsx";
import ScoreMeter from "./ScoreMeter.jsx";
import CloseX from "./CloseX.jsx";
import { OrderAgainControl } from "./DishesSection.jsx";
import RatingSlider from "./RatingSlider.jsx";
import { cleanDraftDishes, newDraftDish } from "../lib/draftDishes.js";
import { noAutofill } from "../lib/noAutofill.js";
import { chipBox } from "../lib/chipStyle.js";
import { createDraftStore, DraftStoreContext, useDraftStore, useDraftField } from "../lib/draftStore.js";

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
const SAVE_CONFIRMATION_MS = 7000; // long enough to reach the Edit button; still never needs dismissing (no modal)

/** Scroll whichever ancestor is this panel's scroller (the sheet's list on a phone, the rail on desktop) back to its top. */
function scrollPanelToTop(el) {
  for (let n = el && el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) { n.scrollTop = 0; return; }
  }
}

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

// iOS Safari zooms the whole page when a field under 16 px takes focus — on a phone that shoves the
// sheet sideways and the form out of view. Fields in the visit form are therefore 16 px.
const INPUT_FONT_PX = 16; // design-exempt: iOS Safari's focus-zoom threshold — below 16 px the page zooms on every field tap
// The scale lives in lib/ratingScale.js; the control in components/RatingSlider.jsx (one component for Food, Ambiance and dish scores).
export { RatingSlider };

function fieldStyle() {
  return {
    width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8,
    border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)",
    font: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 400, minHeight: 40, // fontWeight 400: fields sit inside bold labels and `font: inherit` would carry the bold in
    // NEW-3: a text or date field (the iOS date control above all) has an intrinsic minimum width wider than a narrow flex/label cell and
    // pushes its row past the screen edge — let it shrink to the cell and never exceed it.
    minWidth: 0, maxWidth: "100%", display: "block",
  };
}

/* The dishes typed into a NEW visit — one row per dish: its name and a tap-to-set rating. Adding a
 * restaurant takes dish ratings as part of the same flow (owner direction 2026-10-03: "adding a
 * restaurant should take dish ratings as part of it, and should NOT ask 'what did you eat'"), so
 * this block replaces the old free-text "What I had" box. Rows are drafts until Save; FoodApp's
 * submitVisit writes the visit and then each dish (a dish needs its visit's id). Each row's rating
 * is the same ScoreMeter the place-detail dish editor uses. */
function DraftDishes({ rows, setRows, isMobile, knownRows = [] }) {
  const update = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // Picking a dish already saved here fills the exact saved name (so the rating lands on it, never on a twin) and carries its note + eat-again forward.
  const pick = (key, k) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, name: k.name, note: r.note || k.note || "", order_again: r.order_again ?? k.order_again ?? null } : r)));
  return (
    <div data-testid="visit-dishes" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div data-section-label="" style={FOOD_TYPE.label}>Dishes</div>
      {rows.map((r, i) => (
        <div key={r.key} data-testid="visit-dish-row" data-edit-card="" style={{
          display: "flex", flexDirection: "column", gap: 8, padding: "10px 10px 12px", borderRadius: RADIUS.lg, minWidth: 0,
          border: "1px solid var(--border-default)", background: "var(--surface-page)",
        }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <DishNameField
              value={r.name} onChange={(name) => update(r.key, { name })} rows={knownRows} onPick={(k) => pick(r.key, k)}
              ariaLabel={`Dish ${i + 1}`} testId="visit-dish-name"
              inputStyle={{ ...fieldStyle(), fontSize: INPUT_FONT_PX, minHeight: 44 }}
            />
            {rows.length > 1 && (
              <CloseX onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} label={`Remove dish ${i + 1}`} testId="visit-dish-remove" />
            )}
          </div>
          <ScoreMeter value={r.score} onChange={(score) => update(r.key, { score })} label="Dish score" isMobile={isMobile} />
          <OrderAgainControl value={r.order_again ?? null} onChange={(order_again) => update(r.key, { order_again })} isMobile={isMobile} />
          <input
            type="text" value={r.note || ""} onChange={(e) => update(r.key, { note: e.target.value })}
            placeholder="Note (optional) — e.g. ask for extra sauce" aria-label={`Note for dish ${i + 1}`} data-testid="visit-dish-note"
            enterKeyHint="done" {...noAutofill("dish-remarks")}
            style={{ ...fieldStyle(), fontSize: INPUT_FONT_PX, minHeight: 44 }}
          />
        </div>
      ))}
      <button type="button" onClick={() => setRows((rs) => [...rs, newDraftDish()])} data-testid="visit-dish-add"
        style={{
          minHeight: 44, border: "1px dashed var(--border-default)", borderRadius: RADIUS.md, background: "transparent",
          color: "var(--accent-food)", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 700,
        }}>
        + Add another dish
      </button>
    </div>
  );
}

function VisitForm({ onSubmit, onCancel, pending, onSaved, initial, knownRows, submitLabel = "Log this visit", onDelete }) {
  // `initial` (the visit being edited) is a lazy-initializer READ ONCE at mount — VisitCard
  // unmounts/remounts this form every time editing toggles off then on again, so re-opening edit
  // always starts from the CURRENT saved row, never a stale in-progress edit from before a Cancel.
  // rating/rating_ambiance are Postgres `numeric` -> PostgREST strings ("8.25"), same Number()
  // coercion every other read site in this module already applies.
  const narrowForm = useIsMobile();
  const landscapeForm = useLandscapePhone();
  const isMobile = narrowForm || landscapeForm; // a phone held sideways is a touch screen too
  // Every field below is KEPT across a remount of the card (rotating the phone swaps SideDock <-> BottomSheet, which remounts this
  // form): `useDraftField` is `useState` that reads/writes the panel's draft store. See lib/draftStore.js (V1476080 step 6).
  const drafts = useDraftStore();
  const draftKey = initial ? `edit:${initial.id}` : "new";
  const cancel = () => { drafts?.clear(draftKey); onCancel?.(); }; // an explicit Cancel starts the next open fresh (never a stale draft)
  const [rating, setRating] = useDraftField(draftKey, "rating", () => (initial?.rating != null ? Number(initial.rating) : null));
  const [ratingAmbiance, setRatingAmbiance] = useDraftField(draftKey, "ratingAmbiance", () => (initial?.rating_ambiance != null ? Number(initial.rating_ambiance) : null));
  const [cost, setCost] = useDraftField(draftKey, "cost", () => (initial?.cost != null ? String(initial.cost) : ""));
  const [visitedOn, setVisitedOn] = useDraftField(draftKey, "visitedOn", () => initial?.visited_on || ""); // never pre-filled on a FRESH log — see header comment
  // NEW-1 (Food on a phone): there is no "What I had" box any more. A NEW visit captures dishes
  // (below); an EXISTING visit keeps whatever it already had in `what_i_had` — shown read-only in
  // the edit form and never rewritten (see the header's "WHAT I HAD" note).
  const [dishRows, setDishRows] = useDraftField(draftKey, "dishRows", () => (initial ? [] : [newDraftDish()]));
  const [dishError, setDishError] = useState(null);
  const [notes, setNotes] = useDraftField(draftKey, "notes", () => initial?.notes || "");
  const [wouldReturn, setWouldReturn] = useDraftField(draftKey, "wouldReturn", () => initial?.would_return ?? null);
  const [confirmingDelete, setConfirmingDelete] = useState(false); // NEW-1: Delete moved here from the visit row's old ··· menu — inline confirm, never a dialog

  const submit = async (e) => {
    e.preventDefault();
    const fields = {
      rating,
      rating_ambiance: ratingAmbiance,
      cost: cost === "" ? null : Number(cost),
      visited_on: visitedOn || null,
      notes: notes || null,
      would_return: wouldReturn,
    };
    if (!initial) {
      const { dishes, error } = cleanDraftDishes(dishRows);
      if (error) { setDishError(error); return; }
      setDishError(null);
      fields.dishes = dishes;
    }
    const saved = await onSubmit(fields);
    // Only on a CONFIRMED save (B668194, see header comment) — a failed write leaves everything
    // typed so nothing is lost, and the panel's own error banner already says why.
    if (saved) {
      setRating(null);
      setRatingAmbiance(null);
      setCost("");
      setVisitedOn("");
      setDishRows(initial ? [] : [newDraftDish()]);
      setNotes("");
      setWouldReturn(null);
      // NEW-1 (2026-08-27 owner block) — the SAME confirmed-save gate B668194 already uses for
      // clearing the form; the "✓ Visit saved" banner (VisitPanel, above) must never fire on a
      // failed save (the error banner already covers that case).
      onSaved?.(saved);
    }
  };

  // ONE label style for every field heading in the form (Food, Ambiance, Dishes, Date, Cost, Notes) — NEW-6 (2026-10-23): "Food" and
  // "Date" were 12 px regular while "Dishes" was 12 px bold, so the form read as two dialects.
  const groupLabel = { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 };
  return (
    <form onSubmit={submit} data-sheet-form="" style={{ display: "flex", flexDirection: "column", gap: 10, padding: `${GROUP_STEP}px ${COLUMN_X}px 0`, minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}>
      {initial?.what_i_had && (
        <div data-testid="visit-legacy-had" style={{ fontSize: FONT_SIZE.emphasis, color: "var(--text-secondary)" }}>
          <span style={{ fontWeight: 700 }}>What I had (saved earlier):</span> {initial.what_i_had}
        </div>
      )}
      {/* NEW-4 (2026-10-23, owner): the order is Food, Ambiance, THEN the dishes, then Date, then the rest and the actions — rate the
          place first, then the plate. Same order when editing a past visit (which has no dish rows here). */}
      {/* div, not label: a <label> around a button group forwards a tap on its text to the FIRST
          button inside it, which would set the rating to 1 on a stray tap. */}
      <div role="group" aria-label="Food" data-testid="visit-food-group" style={groupLabel}>
        <span style={FOOD_TYPE.label}>Food</span>
        <RatingSlider value={rating} onChange={setRating} label="Food rating" isMobile={isMobile} />
      </div>
      <div role="group" aria-label="Ambiance" data-testid="visit-ambiance-group" style={groupLabel}>
        <span style={FOOD_TYPE.label}>Ambiance</span>
        <RatingSlider value={ratingAmbiance} onChange={setRatingAmbiance} label="Ambiance rating" isMobile={isMobile} />
      </div>
      {!initial && <DraftDishes rows={dishRows} setRows={setDishRows} isMobile={isMobile} knownRows={knownRows} />}
      {dishError && <div role="alert" data-testid="visit-dish-error" style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text, var(--danger))" }}>{dishError}</div>}
      <label data-edit-card="" style={groupLabel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 20 }}>
          <span style={FOOD_TYPE.label}>Date</span>
          {/* Explicit clear affordance, matching the rating slider's own "Clear" link — a native
           * date input's built-in clear gesture isn't reliably reachable on every platform (a
           * concern that matters for editing: "date (including clearing it back to unknown)"). */}
          {visitedOn && (
            <button type="button" onClick={() => setVisitedOn("")} style={{
              border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer",
              font: "inherit", fontSize: FONT_SIZE.label, fontWeight: 400, padding: "4px 0 4px 12px", textDecoration: "underline",
            }}>
              Clear
            </button>
          )}
        </div>
        <input type="date" value={visitedOn} onChange={(e) => setVisitedOn(e.target.value)} {...noAutofill("visit-day")} data-testid="visit-date-input" className="food-date-input" style={{ ...fieldStyle(), fontSize: INPUT_FONT_PX, minHeight: 44 }} />
      </label>
      <label data-edit-card="" style={groupLabel}>
        <span style={FOOD_TYPE.label}>Cost</span>
        <input type="number" step="0.01" min="0" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" {...noAutofill("visit-total")} data-testid="visit-cost-input" style={{ ...fieldStyle(), fontSize: INPUT_FONT_PX }} />
      </label>
      <label data-edit-card="" style={groupLabel}>
        <span style={FOOD_TYPE.label}>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} {...noAutofill("visit-notes")} data-testid="visit-notes-input" style={{ ...fieldStyle(), fontSize: INPUT_FONT_PX, resize: "vertical" }} />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={FOOD_TYPE.label}>Would return?</span>
        <button type="button" onClick={() => setWouldReturn(wouldReturn === true ? null : true)}
          style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, padding: "6px 12px", minHeight: 44, cursor: "pointer",
            background: wouldReturn === true ? "var(--accent-food)" : "transparent",
            color: wouldReturn === true ? "var(--on-accent-food)" : "var(--text-primary)", font: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700 }}>
          Yes
        </button>
        <button type="button" onClick={() => setWouldReturn(wouldReturn === false ? null : false)}
          style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, padding: "6px 12px", minHeight: 44, cursor: "pointer",
            background: wouldReturn === false ? "var(--chrome-muted)" : "transparent",
            color: "var(--text-primary)", font: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700 }}>
          No
        </button>
      </div>
      {/* Pinned to the bottom of whichever scroller holds the form (the sheet's content area on a
          phone), so Save stays on screen while typing — with the keyboard up the sheet itself rides
          above the keyboard (BottomSheet), and this keeps Save inside the visible part of it. */}
      <div data-testid="visit-form-actions" data-sheet-sticky="bottom" style={{
        position: "sticky", bottom: 0, zIndex: 1, display: "flex", gap: 8, padding: "10px 0 14px",
        background: "var(--surface-raised)", borderTop: "1px solid var(--border-default)",
      }}>
        <button type="submit" disabled={pending} style={{
          flex: 1, border: "none", borderRadius: RADIUS.md, padding: "10px 0", minHeight: 44, cursor: pending ? "default" : "pointer",
          background: "var(--accent-food)", color: "var(--on-accent-food)", font: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 700,
          opacity: pending ? 0.6 : 1,
        }}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={cancel} style={{
          border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "10px 14px", minHeight: 44, cursor: "pointer",
          background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: FONT_SIZE.emphasis,
        }}>
          Cancel
        </button>
      </div>
      {initial && onDelete && (
        <div data-testid="visit-delete-row" style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 0 12px" }}>
          {confirmingDelete ? (
            <>
              <span style={{ flex: 1, fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>Delete this visit?</span>
              <button type="button" onClick={() => setConfirmingDelete(false)} style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.md, minHeight: 44, padding: "0 12px", background: "transparent", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.control }}>Keep</button>
              <button type="button" onClick={() => onDelete(initial.id)} data-testid="food-visit-delete-confirm" style={{ border: "1px solid var(--danger-border, var(--danger))", borderRadius: RADIUS.md, minHeight: 44, padding: "0 12px", background: "transparent", color: "var(--danger-text, var(--danger))", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700 }}>Delete</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} data-testid="food-visit-delete-menu-item" style={{ border: "none", background: "none", color: "var(--danger-text, var(--danger))", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 600, minHeight: 44, padding: 0 }}>Delete visit</button>
          )}
        </div>
      )}
    </form>
  );
}

/* The header (block 1 — NEW-1, owner-approved mockup): the name large with the plain close ✕ on the SAME line, top right;
 * under it "<cuisine> · <city> · <price level>" (the word "Restaurant" dropped from the category, the price level a tappable
 * $…$$$$ control — filled ones dark, the rest light grey, all grey when unset, tapping the current level clears it); then the
 * address in NEUTRAL GREY reading "<street> · Directions" — the whole line is the directions link (a plain maps URL, no SDK). */
function PriceLevelControl({ level, onChange }) {
  const set = PRICE_LEVELS.includes(level);
  return (
    <span role="group" aria-label={set ? `Price level ${"$".repeat(level)}` : "Price level not set"} data-testid="food-price-level" data-level={set ? level : ""} style={{ display: "inline-flex", alignItems: "center", marginLeft: -2 }}>
      {PRICE_LEVELS.map((n) => {
        const filled = set && n <= level;
        return (
          <button
            key={n} type="button" onClick={() => onChange(nextPriceLevel(set ? level : null, n))} aria-pressed={set && level === n} aria-label={`${"$".repeat(n)}${set && level === n ? " (tap to clear)" : ""}`}
            data-testid={`food-price-level-${n}`} data-filled={filled ? "true" : "false"}
            style={{
              border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 700, lineHeight: 1,
              padding: "12px 1px", margin: "-12px 0", minWidth: 0, color: filled ? "var(--text-primary)" : "var(--text-tertiary)",
            }}
          >
            $
          </button>
        );
      })}
    </span>
  );
}

function PanelHeader({ manualNameEditable, manualName, onManualNameChange, name, category, address, lat, lon, onClose, priceLevel, onSetPriceLevel }) {
  const city = formatCityFromAddress(address);
  const subline = headerSubline({ cuisine: formatCuisine(category), city });
  const formattedAddress = formatAddress(address);
  const mapsUrl = directionsUrl(lat, lon);
  const showPrice = !!onSetPriceLevel && !manualNameEditable;
  return (
    <div data-edit-card={manualNameEditable ? "" : undefined} data-sheet-grab="" style={{ padding: `4px ${COLUMN_X}px 0` }}>
      {/* NEW-2 (2026-10-23): the ✕ is centred on the title's FIRST line (flex-start + its own -10 overhang), so a long name that wraps
          leaves the ✕ beside the first line like an iOS sheet, not floating at the middle of two. The place-name input keeps centring. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: manualNameEditable ? "center" : "flex-start", gap: 8 }}>
        {manualNameEditable ? (
          <input
            type="text" autoFocus value={manualName} onChange={(e) => onManualNameChange(e.target.value)}
            placeholder="What's this place called?" aria-label="Place" data-testid="pin-label-input" {...noAutofill("pin-label")} enterKeyHint="done" autoCapitalize="words"
            style={{ ...fieldStyle(), fontSize: 17, fontWeight: 700 }}
          />
        ) : (
          <div style={{ position: "relative", minWidth: 0, flex: 1 }}>
            {/* NEW-1 (2026-10-27): the dot HANGS in the gutter left of the column (absolute, 4 px in from the card's edge) so the name, subtitle, address, chips and
                every row below start on one edge — it used to sit inline and push the whole header 17 px right of everything else. */}
            <span data-testid="food-panel-accent-dot" aria-hidden="true" style={{
              position: "absolute", left: -12, top: 8, width: 8, height: 8, borderRadius: "50%", // top 8 = half of the title's 24-high first line less half the dot
              background: SELECTED_ACCENT,
            }} />
            <div data-testid="food-panel-title" style={{ ...FOOD_TYPE.title, color: "var(--text-primary)", overflowWrap: "anywhere" }}>
              {name}
            </div>
          </div>
        )}
        {/* The 44-square touch target overhangs the name row (negative margins) so the row is as tall as the NAME, not the ✕ — no dead space under the handle. */}
        <CloseX onClick={onClose} label="Close" testId="food-panel-close" style={{ margin: "-10px -8px -10px 0" }} />
      </div>
      {(subline || showPrice) && (
        <div data-testid="food-panel-subline" style={{ marginTop: 2, ...FOOD_TYPE.body, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
          {subline && <span>{subline}</span>}
          {subline && showPrice && <span aria-hidden="true">&nbsp;·&nbsp;</span>}
          {showPrice && <PriceLevelControl level={priceLevel} onChange={onSetPriceLevel} />}
        </div>
      )}
      {formattedAddress && mapsUrl && (
        <a
          href={mapsUrl} target="_blank" rel="noopener noreferrer" data-testid="food-directions-link"
          style={{ display: "block", margin: "-4px 0 -8px", padding: "8px 0", ...FOOD_TYPE.caption, color: "var(--text-secondary)", textDecoration: "none" }} // padding + opposite margin = a ~32 tall tap target without moving the line
        >
          {formattedAddress} · <span style={{ fontWeight: 700 }}>Directions</span>
        </a>
      )}
    </div>
  );
}

/* Score pills (block 2) — only once there is a visit: "8.25 Food" and "8.0 Ambiance" as small light-grey pills, and the
 * "+ List" pill (the existing add-to-list choice, FoodApp's `listsControl`) on the right of the same row. The VISITS tile
 * is gone (the count lives in the Visits header), so is the COST tile (the price level in the header replaces it) and the
 * old best-dish line. Every number here is formatRating — the same string the visit rows show (one number, one precision). */
function ScorePills({ aggregates, listsControl }) {
  const { avgFood, avgAmbiance } = aggregates;
  // --hover-ghost is the one LIGHT grey fill that stays light in the light theme and subtle in the dark one (--chrome-muted is a dark fill).
  const pill = chipBox(28, 10, { gap: 4, borderRadius: RADIUS.pill, background: "var(--hover-ghost)", color: "var(--text-secondary)", ...FOOD_TYPE.caption }); // NEW-3: centred on both axes (lib/chipStyle.js)
  return (
    <div data-testid="food-score-pills" style={{ padding: `${GROUP_STEP}px ${COLUMN_X}px 0`, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {avgFood != null && (
        <span style={pill} data-chip="" data-testid="food-score-pill-food"><b style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{formatRating(avgFood)}</b> Food</span>
      )}
      {avgAmbiance != null && (
        <span style={pill} data-chip="" data-testid="food-score-pill-ambiance"><b style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{formatRating(avgAmbiance)}</b> Ambiance</span>
      )}
      {listsControl}
    </div>
  );
}

/* Actions — "Log a visit" full-width primary + "Want to try" secondary toggle beside it. PINNED to the bottom of the
 * sheet / card (NEW-1: "always visible, not mid-scroll"): it is the LAST thing in the body on every layout and
 * `position: sticky; bottom: 0`, so it sits on the bottom edge whether the content is shorter or longer than the sheet.
 *
 * ⛔ B1022960 (2026-09-01 owner report, verbatim: "log a visit should be the main button, not
 * want to try") — Log a visit is now ALWAYS the primary (full-width, filled) action; Want to try
 * is ALWAYS the secondary (outlined) one. `RADIUS.md` replaces the raw `10` literal. */
function ActionsRow({ everVisited, onOpenForm, wishlisted, onToggleWishlist, wishlistDisabled }) {
  const base = {
    border: "1px solid var(--border-default)", borderRadius: RADIUS.md, cursor: "pointer",
    font: "inherit", fontWeight: 700, minHeight: 44,
  };
  const primary = { ...base, flex: 1, border: "none", padding: "11px 0", ...FOOD_TYPE.body, background: "var(--accent-food)", color: "var(--on-accent-food)" };
  const secondary = { ...base, flex: "0 0 auto", padding: "11px 16px", ...FOOD_TYPE.body, background: "transparent", color: "var(--text-primary)" };
  // ⛔ B1022960 round 2 — never filled: mirrors the SAME "want to try" flag's OWN established look elsewhere in this module
  // (outlined, transparent, accent text/border) so the active state reads as "flagged" without competing with the primary CTA.
  const wishActive = { background: "transparent", color: "var(--accent-food)", border: "1px solid var(--accent-food)" };

  const logBtn = (
    <button key="log" type="button" onClick={onOpenForm} data-testid="food-log-visit-btn" style={primary}>
      Log a visit
    </button>
  );
  // NEW-1 (2026-08-27 owner block) — a place-level "want to try" is meaningless once he's actually been: gone entirely once visited.
  const wishBtn = onToggleWishlist && !everVisited && (
    <button
      key="wish" type="button" onClick={onToggleWishlist} disabled={wishlistDisabled} aria-pressed={wishlisted}
      data-testid="food-wishlist-toggle"
      style={{
        ...secondary,
        ...(wishlisted ? wishActive : {}),
        opacity: wishlistDisabled ? 0.5 : 1,
        cursor: wishlistDisabled ? "default" : "pointer",
      }}
    >
      {wishlisted ? "✓ Want to try" : "Want to try"}
    </button>
  );

  return (
    <div data-testid="food-actions-row" data-sheet-sticky="bottom" data-hide-while-typing="" data-hide-while-form="" style={{
      position: "sticky", bottom: 0, marginTop: "auto", display: "flex", gap: 8, padding: `10px ${COLUMN_X}px`,
      background: "var(--surface-raised)", borderTop: "1px solid var(--border-default)",
    }}>
      {[logBtn, wishBtn].filter(Boolean)}
    </div>
  );
}

/* Visits (NEW-1) — "VISITS · N", each visit ONE compact row: "<date> · Food 8.25 · Ambiance 8.0" with a chevron; tapping it
 * opens that visit for editing INLINE (the card becomes VisitForm — never a modal; `editing` is owned by the parent so only one
 * form is ever open). No dish list and no "dishes avg" in the row; a missing date reads "No date". Delete lives inside the
 * edit form (the old ··· menu is gone). Newest first (foodStore.fetchAllVisits already orders that way). */
function VisitCard({ visit, onDelete, editing, onOpenEdit, onCloseEdit, onSubmitEdit, pending, dishesWithDate, onSaveDish, onDeleteDish, dishPending, onOpenDish }) {
  if (editing) {
    return (
      <div data-testid="food-visit-card-editing" data-sheet-form="" style={{ borderBottom: "1px solid var(--border-default)" }}>
        {/* NEW-1 (2026-10-20): the visit ROW is one compact line now, so an old visit's saved free text is read here, above its form — never an input, never rewritten. */}
        {visit.what_was_good && (
          <div data-testid="visit-legacy-good" style={{ padding: `10px ${COLUMN_X}px 0`, ...FOOD_TYPE.body, color: "var(--text-secondary)" }}>
            <span style={{ fontWeight: 700 }}>What was good (saved earlier):</span> {visit.what_was_good}
          </div>
        )}
        <VisitForm
          initial={visit} submitLabel="Save changes" pending={pending}
          onCancel={onCloseEdit} onSubmit={onSubmitEdit} onSaved={onCloseEdit} onDelete={onDelete}
        />
        {onSaveDish && (
          <DishesSection
            dishesWithDate={(dishesWithDate || []).filter((d) => d.visit_id === visit.id)}
            visits={[visit]} onSaveDish={onSaveDish} onDeleteDish={onDeleteDish} pending={dishPending}
            scope={`visit:${visit.id}`} onOpenDish={onOpenDish}
          />
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="food-visit-card" onClick={onOpenEdit} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpenEdit(); }}
      aria-label={visitRowLabel(visit, formatVisitDate)}
      style={{ display: "flex", alignItems: "center", gap: 8, margin: `0 ${COLUMN_X}px`, minHeight: 44, boxSizing: "border-box", borderBottom: "1px solid var(--border-default)", cursor: "pointer" }}
    >
      {/* NEW-1 (2026-10-27): the DATE is the quiet part (secondary, regular — "No date" included); the scores are the answer (the number bold, primary), the same
          pairing as the score pills above. The row's accessible name is the plain one-line label. */}
      <span data-testid="food-visit-row-label" style={{ flex: 1, minWidth: 0, ...FOOD_TYPE.body, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {visitRowParts(visit, formatVisitDate).map((p, i) => (
          <span key={i}>
            {i > 0 && " · "}
            {p.kind === "date" ? p.text : <>{p.label} <b style={{ color: "var(--text-primary)", fontWeight: 700 }}>{p.value}</b></>}
          </span>
        ))}
      </span>
      <span aria-hidden="true" style={{ flex: "none", color: "var(--text-tertiary)", fontSize: FONT_SIZE.display, lineHeight: 1 }}>›</span>
    </div>
  );
}

function PastVisitsSection({ pastVisits, onDelete, onEditVisit, editingVisitId, onOpenEdit, onCloseEdit, pending, dishesWithDate, onSaveDish, onDeleteDish, dishPending, onOpenDish }) {
  const [expanded, setExpanded] = useState(false);
  if (!pastVisits.length) return null;
  // The visit being edited always stays in view, even when it sits past the two most recent.
  const { shown, hidden } = visitsToShow(pastVisits, expanded || (editingVisitId && !pastVisits.slice(0, 2).some((v) => v.id === editingVisitId)));
  return (
    <div data-testid="food-past-visits">
      <SectionLabel count={pastVisits.length}>Visits</SectionLabel>
      {shown.map((v) => (
        <VisitCard
          key={v.id} visit={v} onDelete={onDelete}
          editing={editingVisitId === v.id} pending={pending}
          onOpenEdit={() => onOpenEdit(v.id)} onCloseEdit={onCloseEdit}
          onSubmitEdit={onEditVisit ? (fields) => onEditVisit(v.id, fields) : undefined}
          dishesWithDate={dishesWithDate} onSaveDish={onSaveDish} onDeleteDish={onDeleteDish} dishPending={dishPending} onOpenDish={onOpenDish}
        />
      ))}
      {hidden > 0 && (
        <button type="button" onClick={() => setExpanded(true)} data-testid="food-visits-more" style={{
          display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", padding: `0 ${COLUMN_X}px`, minHeight: 44,
          cursor: "pointer", font: "inherit", ...FOOD_TYPE.body, fontWeight: 700, color: "var(--accent-food)",
        }}>
          Show {hidden} more
        </button>
      )}
    </div>
  );
}

/* Empty state — never visited: no score pills, no "Visits · 0" header. Just the header, the actions row, and one line. */
function EmptyStateNote() {
  return (
    <div style={{ padding: `${ITEM_STEP}px ${COLUMN_X}px ${GROUP_STEP}px`, ...FOOD_TYPE.caption, color: "var(--text-secondary)" }}>
      Shows as a hollow pin on the map until you log a visit here.
    </div>
  );
}

export default function VisitPanel({
  place, pastVisits, onClose, onSubmitVisit, onDeleteVisit, onEditVisit, pending, error,
  manualNameEditable, manualName, onManualNameChange,
  wishlisted, onToggleWishlist, onSheetHeightChange, onSideWidthChange,
  dishesWithDate, onSaveDish, onDeleteDish, dishPending, openDishWishlistNames, listsControl, savedNotice,
  priceLevel, onSetPriceLevel,
}) {
  const narrowPhone = useIsMobile();
  // B2046224 ×4 — a phone held sideways docks the card to the right edge instead of a bottom sheet.
  const landscape = useLandscapePhone();
  const isMobile = narrowPhone && !landscape;
  // Half-typed forms survive the card changing parent (rotate the phone: SideDock <-> BottomSheet remounts everything below). Lives
  // exactly as long as this panel does — a different place, or the close ✕, drops it. lib/draftStore.js.
  const [drafts] = useState(createDraftStore);
  const [adding, setAdding] = useState(false); // NEW-2: never auto-opens, even on a never-visited place
  // Edit-a-visit (owner block, 2026-08-28) — which existing visit's card (if any) is showing its edit form inline. Lifted here so
  // this panel can enforce "only one form open at a time" against the log-a-new-visit form.
  const [editingVisitId, setEditingVisitId] = useState(null);
  // NEW-2 — the dish sheet: which dish row (by its case-blind name key) is open as its own view in place of the panel body.
  const [dishSheetKey, setDishSheetKey] = useState(null);
  // Opening a form always starts it from the CURRENT saved row / a blank log — never from a draft left by a closed one.
  const handleOpenEdit = useCallback((id) => { drafts.clear("new"); drafts.clear(`edit:${id}`); setAdding(false); setEditingVisitId(id); }, [drafts]);
  const handleCloseEdit = useCallback(() => setEditingVisitId(null), []);
  const peekRef = useRef(null);
  const [peekHeight, setPeekHeight] = useState(140);

  const visits = useMemo(() => pastVisits || [], [pastVisits]);
  const everVisited = visits.length > 0;
  const aggregates = useMemo(() => computeVisitAggregates(visits), [visits]);
  const knownDishRows = useMemo(() => dishRowsForTable(dishesWithDate || []), [dishesWithDate]);
  const openDishRow = dishSheetKey ? knownDishRows.find((r) => r.key === dishSheetKey) || null : null;
  const wishlistDisabled = manualNameEditable && !(manualName || "").trim();

  // NEW-2 (B2268433): after a confirmed save the form CLOSES and the place's own page shows what was just logged. FoodApp owns the
  // notice; it only shows for a visit this place actually holds, and for a few seconds.
  const [showSaved, setShowSaved] = useState(false);
  const noticeAt = savedNotice?.at;
  const noticeHere = !!savedNotice && visits.some((v) => v.id === savedNotice.visitId);
  useEffect(() => {
    if (!savedNotice || !noticeHere) return undefined;
    const left = SAVE_CONFIRMATION_MS - (Date.now() - savedNotice.at);
    if (left <= 0) return undefined;
    setShowSaved(true);
    const id = requestAnimationFrame(() => { if (savedNotice.kind === "new") scrollPanelToTop(peekRef.current); });
    const t = setTimeout(() => setShowSaved(false), left);
    return () => { cancelAnimationFrame(id); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noticeAt, noticeHere]);
  const handleSaved = useCallback(() => { drafts.clear("new"); setAdding(false); }, [drafts]);

  // Escape: the dish sheet goes back first; otherwise clears the selection exactly like the close button.
  useEffect(() => {
    const onKey = (e) => { if (e.key !== "Escape") return; if (dishSheetKey) setDishSheetKey(null); else onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dishSheetKey]);

  // The bottom sheet's "peek" snap is sized to exactly this block (header + score pills, or header + empty-state note) — measured
  // here, not guessed. No deps array on purpose (re-measures after every render); safe because setPeekHeight with the SAME number
  // is a no-op in React.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (peekRef.current) setPeekHeight(peekRef.current.offsetHeight);
  });

  // Opening the log-a-new-visit form also closes any in-progress edit — only one form is ever open at once.
  const handleOpenForm = () => { if (editingVisitId) drafts.clear(`edit:${editingVisitId}`); drafts.clear("new"); setEditingVisitId(null); setAdding(true); };
  const openDish = useCallback((key) => { scrollPanelToTop(peekRef.current); setDishSheetKey(key); }, []);
  const closeDish = useCallback(() => { setDishSheetKey(null); requestAnimationFrame(() => scrollPanelToTop(peekRef.current)); }, []);

  const actionsRow = onSubmitVisit && !adding ? (
    <ActionsRow
      everVisited={everVisited} onOpenForm={handleOpenForm}
      wishlisted={wishlisted} onToggleWishlist={onToggleWishlist} wishlistDisabled={wishlistDisabled}
    />
  ) : null;

  const body = openDishRow ? (
    // NEW-2 — the dish sheet takes the whole panel (its own "‹ <restaurant>" bar is the way back). Inside peekRef so the sheet's
    // peek measurement still sees a real block.
    <div ref={peekRef}>
      <DishSheet
        key={openDishRow.key} row={openDishRow} restaurantName={place?.name || manualName} visits={visits}
        onBack={closeDish} onSaveDish={onSaveDish} onDeleteDish={onDeleteDish} pending={dishPending} isMobile={narrowPhone || landscape}
      />
    </div>
  ) : (
    <>
      <div ref={peekRef}>
        {/* Sticky header (owner block, 2026-08-28). Wrapped INSIDE peekRef so the sheet's peek-height measurement still sees this
         * block's real height — position:sticky doesn't remove an element from normal flow. */}
        <div data-sheet-sticky="top" style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--surface-raised)" }}>
          <PanelHeader
            manualNameEditable={manualNameEditable} manualName={manualName} onManualNameChange={onManualNameChange}
            name={place?.name} category={place?.category} address={place?.address} lat={place?.lat} lon={place?.lon}
            onClose={onClose} priceLevel={priceLevel} onSetPriceLevel={onSetPriceLevel}
          />
        </div>
        {showSaved && savedNotice && (
          // Inside peekRef's own measured div (not an overlay): never covers the close button or the title, and the sheet re-measures to it.
          <div role="status" data-testid="food-save-confirmation" style={{
            margin: "0 16px 8px", padding: "7px 10px", borderRadius: 8,
            background: "var(--success-bg)", color: "var(--success-text)", border: "1px solid var(--success-border)",
            ...FOOD_TYPE.caption, fontWeight: 700, display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ flex: 1, minWidth: 0 }}>{savedNotice.kind === "edit" ? "✓ Changes saved" : `✓ Visit saved${savedNotice.dishes ? ` · ${savedNotice.dishes} ${savedNotice.dishes === 1 ? "dish" : "dishes"}` : ""}`}</span>
            {savedNotice.kind !== "edit" && (
              <button type="button" data-testid="food-saved-edit-btn" onClick={() => { setShowSaved(false); handleOpenEdit(savedNotice.visitId); }} style={{
                flex: "none", minHeight: 44, padding: "0 12px", border: "none", background: "none", color: "inherit", cursor: "pointer", font: "inherit", fontWeight: 700, textDecoration: "underline",
              }}>Edit visit</button>
            )}
          </div>
        )}
        {everVisited && <ScorePills aggregates={aggregates} listsControl={listsControl} />}
        {!everVisited && listsControl && <div style={{ padding: `${GROUP_STEP}px ${COLUMN_X}px 0`, display: "flex" }}>{listsControl}</div>}
        {!everVisited && !adding && <EmptyStateNote />}
      </div>

      {everVisited && onSaveDish && (
        <DishesSection
          dishesWithDate={dishesWithDate || []} visits={visits}
          onSaveDish={onSaveDish} onDeleteDish={onDeleteDish} pending={dishPending}
          openWishlistNames={openDishWishlistNames} onOpenDish={openDish} hideAdd={adding || !!editingVisitId}
        />
      )}

      {error && (
        <div role="alert" style={{ margin: "8px 16px 0", padding: "8px 10px", borderRadius: 8, background: "var(--danger-bg, rgba(220,38,38,0.1))", color: "var(--danger-text, var(--danger))", ...FOOD_TYPE.caption }}>
          {error}
        </div>
      )}

      {onSubmitVisit && adding && (
        <VisitForm pending={pending} onCancel={() => setAdding(false)} onSubmit={onSubmitVisit} onSaved={handleSaved} knownRows={knownDishRows} />
      )}

      <PastVisitsSection
        pastVisits={visits} onDelete={onDeleteVisit} onEditVisit={onEditVisit} pending={pending}
        editingVisitId={editingVisitId} onOpenEdit={handleOpenEdit} onCloseEdit={handleCloseEdit}
        dishesWithDate={dishesWithDate} onSaveDish={onSaveDish} onDeleteDish={onDeleteDish} dishPending={dishPending} onOpenDish={openDish}
      />
      {/* NEW-1 — the bar is the LAST thing in the body on EVERY layout (sheet, side card, desktop rail) and sticky to the bottom,
          so "Log a visit" is always on the bottom edge: when the content is shorter than the sheet the content-driven height puts
          it there, and when the list is longer than the sheet sticky holds it there while the list scrolls under it. */}
      {actionsRow}
    </>
  );

  if (landscape) {
    return <DraftStoreContext.Provider value={drafts}><SideDock onWidthChange={onSideWidthChange}>{body}</SideDock></DraftStoreContext.Provider>;
  }

  if (isMobile) {
    return (
      <DraftStoreContext.Provider value={drafts}>
        <BottomSheet open onDismiss={onClose} initialSnap="half" peekHeight={peekHeight} onHeightChange={onSheetHeightChange}>
          {body}
        </BottomSheet>
      </DraftStoreContext.Provider>
    );
  }

  return (
    <DraftStoreContext.Provider value={drafts}>
    <div data-testid="food-visit-panel" data-food-panel="" style={{
      position: "absolute", top: 0, right: 0, bottom: 0, width: 340, maxWidth: "90vw", // matches FoodMap.jsx's own PANEL_WIDTH (its fly-to pan-offset assumes this)
      background: "var(--surface-raised)", borderLeft: "1px solid var(--border-default)",
      boxShadow: "-8px 0 24px rgba(0,0,0,0.18)", zIndex: 600, display: "flex", flexDirection: "column",
      overflowY: "auto",
    }}>
      <style>{FORM_OPEN_CSS}</style>
      {body}
    </div>
    </DraftStoreContext.Provider>
  );
}
