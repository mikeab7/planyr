/* DishesSection — the place-detail "Dishes" block (B1873008; editor/row REDESIGN, NEW-1,
 * 2026-09-28 — a second pass on the same feature, owner-approved against a mockup): every dish
 * rated at this place (or manual pin), sortable, with an inline add/edit row (NO DIALOG BOX —
 * this repo's own house rule), "The order" (every dish worth getting again, with a copy-as-text
 * button), and a small per-dish history view.
 *
 * ⛔ INLINE EDITORS ONLY. Adding or editing a dish never opens a modal — the "+ Add a dish" ghost
 * row and every existing row both expand IN PLACE into the same DishEditRow.
 *
 * A NEW dish added from PLACE DETAIL attaches to the MOST RECENT visit at this place —
 * `food_dishes.visit_id` is required, and picking a specific visit for a place with many visits
 * is out of scope; the per-visit dish-adding flow (VisitForm's own dish rows) is the precise way
 * to log a dish against a PARTICULAR visit.
 *
 * ⛔ TWO OWNER DECISIONS FROM THIS REDESIGN'S DISPATCH, recorded here so a future session doesn't
 * relitigate them: (1) the per-dish HISTORY view (score-over-time + past notes) is NOT cut — a
 * dish's record over time is the point of the feature — it moved from "click the row" (which now
 * opens the editor, per the brief) into the row's own kebab menu, shown only when the dish has
 * been had more than once (nothing to show for a first-time dish). (2) EDITING an existing dish
 * gets exactly one primary action ("Save") plus Cancel — "Save & add another" / "Save & close"
 * exist only in the ADD flow, where there are genuinely two different next steps; editing has one.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useDraftField, useDraftStore } from "../lib/draftStore.js";
import ScoreMeter from "./ScoreMeter.jsx";
import CloseX from "./CloseX.jsx";
import { formatVisitDate } from "../lib/dateFormat.js";
import {
  dishRowsForTable, theOrderEntries, theOrderTotalCents, theOrderAsText, formatCents,
  formatScore, dishScoreTier, dishDate,
} from "../lib/dishAggregates.js";
import { noAutofill } from "../lib/noAutofill.js";
import { suggestDishes, sameDishName } from "../lib/dishSuggest.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { MenuItem } from "../../../shared/ui/controls.jsx";

const COURSES = [
  { value: "", label: "Course…" },
  { value: "starter", label: "Starter" },
  { value: "entree", label: "Entrée" },
  { value: "side", label: "Side" },
  { value: "dessert", label: "Dessert" },
  { value: "drink", label: "Drink" },
];
const COURSE_LABEL = Object.fromEntries(COURSES.map((c) => [c.value, c.label]));

const ORDER_AGAIN_OPTIONS = [
  { value: "yes", label: "Yes", glyph: "✓" },
  { value: "maybe", label: "Maybe", glyph: "~" },
  { value: "no", label: "No", glyph: "✕" },
];

// The same breakpoint VisitPanel.jsx already uses for its own "mobile" layout switch — module-
// private duplicate rather than a shared hook (no shared hook module exists for this yet; see
// this app's own established convention of per-file icon/hook duplicates, e.g. ScheduleOwnerList's
// PencilIcon/TrashIcon note).
const MOBILE_BREAKPOINT = "(max-width: 760px)";
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

// Every field label in the redesigned editor shares this one look (the brief: "small-caps, 10px,
// letter-spaced, in the secondary text token — not the faded-grey-on-white the contrast audit
// rejects"). FONT_SIZE.micro is exactly 10.
const FIELD_LABEL_STYLE = {
  display: "block", fontSize: FONT_SIZE.micro, fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.08em", color: "var(--text-secondary)", marginBottom: 3,
};
const FILLED_FIELD_STYLE = {
  width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8,
  border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)",
  font: "inherit", fontSize: 13, minHeight: 40,
};
// The dashed treatment shared by a "not scored yet" row and the "+ Add a dish" ghost row — both
// are deliberately-unfinished states, visually distinct from a normal committed row.
const DASHED_BORDER = "1px dashed var(--border-default)";

/* Order-again — a three-way segmented control, glyph AND fill (never colour alone — "no" is
 * neutral, never red; red stays reserved for genuine danger per this app's own colour rule).
 * NEW-1: now carries its own "ORDER IT AGAIN?" label (previously unlabeled — nothing said what
 * the three buttons answered) and every state uses the SAME accent fill when selected (previously
 * "maybe"/"no" used a neutral fill when active, which read as though only "yes" was a real answer). */
export function OrderAgainControl({ value, onChange, isMobile }) {
  const minH = isMobile ? 54 : 46;
  return (
    <div>
      <span style={FIELD_LABEL_STYLE}>Order it again?</span>
      <div role="group" aria-label="Order again" style={{ display: "flex", gap: 6 }}>
        {ORDER_AGAIN_OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value} type="button" aria-pressed={active}
              onClick={() => onChange(active ? null : opt.value)}
              data-testid={`dish-order-again-${opt.value}`}
              style={{
                flex: 1, borderRadius: RADIUS.sm, cursor: "pointer", minHeight: minH, padding: "6px 4px",
                font: "inherit", fontSize: 12, fontWeight: 700,
                border: active ? "1px solid var(--accent-food)" : "1px solid var(--border-default)",
                background: active ? "var(--accent-food)" : "var(--surface-raised)",
                color: active ? "var(--on-accent-food)" : "var(--text-primary)",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              }}
            >
              <span aria-hidden="true">{opt.glyph}</span>
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Today as the local calendar day (YYYY-MM-DD) — a rating given from the place page is dated the day it was given, never the
 * day of the (possibly months-old) visit it hangs off. */
export function todayLocal(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/* The dish name box with its own suggestions (B2268434): type "pad thia" and "Pad Thai · last 8.5" is offered right under the
 * field, so a re-rate lands on the dish already saved here instead of minting a twin. Our own list, not a native <datalist> (iOS
 * shows those as a tiny keyboard-bar strip and never tolerates a misspelling). `rows` are dishRowsForTable rows. */
export function DishNameField({ value, onChange, rows, onPick, inputStyle, autoFocus, testId = "dish-name-input", ariaLabel = "Dish", placeholder = "Dish" }) {
  const hits = suggestDishes(value, rows);
  const exact = rows.find((r) => sameDishName(r.name, value));
  const showList = hits.length > 0 && !(hits.length === 1 && exact);
  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <input
        type="text" autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} aria-label={ariaLabel} data-testid={testId}
        enterKeyHint="next" autoCapitalize="words" {...noAutofill("dish-pick")} style={inputStyle}
      />
      {showList && (
        <div data-testid="dish-suggestions" role="listbox" aria-label="Dishes already saved here" style={{ display: "flex", flexDirection: "column", marginTop: 4, border: "1px solid var(--border-default)", borderRadius: RADIUS.md, overflow: "clip", background: "var(--surface-raised)" }}>
          {hits.map((r) => (
            <button key={r.key} type="button" role="option" data-testid="dish-suggestion" onClick={() => onPick(r)} style={{
              display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", textAlign: "left", minHeight: 44, padding: "6px 10px",
              border: "none", borderBottom: "1px solid var(--border-default)", background: "transparent", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontSize: 14,
            }}>
              <span style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{r.name}</span>
              <span style={{ flex: "none", fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>{r.latestScore != null ? `last ${formatScore(r.latestScore)}` : "saved"}</span>
            </button>
          ))}
        </div>
      )}
      {exact && (
        <div data-testid="dish-rerate-hint" style={{ marginTop: 4, fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>
          Already saved here{exact.latestScore != null ? ` (last ${formatScore(exact.latestScore)})` : ""} — this adds a new rating to it.
        </div>
      )}
    </div>
  );
}

/* One dish's history — every score over time as a small bar chart, every note with its date and
 * price, and what else was had at the same visit. Inline expansion, never a separate page/modal.
 * Reached from the row's kebab menu (NEW-1) rather than a row click, which now opens the editor. */
function DishHistoryPanel({ row, dishesAtSamePlace, onRateAgain, onEdit }) {
  const entries = [row, ...row.history];
  const maxScore = Math.max(1, ...entries.map((e) => Number(e.score) || 0));
  return (
    <div data-testid="dish-history-panel" style={{ padding: "8px 12px 12px", background: "var(--surface-page)", borderRadius: 8, margin: "0 4px 8px" }}>
      {row.note && (
        <div data-testid="dish-full-note" style={{ marginBottom: 8, fontSize: FONT_SIZE.emphasis, color: "var(--text-primary)", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
          <span style={{ fontSize: FONT_SIZE.micro, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)", display: "block" }}>Note</span>
          {row.note}
        </div>
      )}
      {entries.length > 1 && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 48, marginBottom: 8 }}>
          {[...entries].reverse().map((e) => (
            <div key={e.id} title={`${dishDate(e) ? formatVisitDate(dishDate(e)) : "undated"} · ${e.score ?? "—"}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto", width: 18 }}>
              <div style={{
                width: 12, borderRadius: 2, // design-exempt: sparkline bar corner (data-viz ink, not a chrome control)
                height: e.score != null ? `${(Number(e.score) / maxScore) * 40}px` : "2px",
                background: e.score != null ? "var(--accent-food)" : "var(--border-default)",
              }} />
            </div>
          ))}
        </div>
      )}
      {entries.map((e) => {
        const sameVisitOthers = dishesAtSamePlace.filter((d) => d.visit_id === e.visit_id && d.id !== e.id);
        return (
          <div key={e.id} data-testid="dish-history-entry" style={{ padding: "6px 0", borderTop: "1px solid var(--border-default)", fontSize: FONT_SIZE.control }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{e.score != null ? `${formatScore(e.score)} / 10` : "Not scored"}</span>
              <span style={{ color: "var(--text-tertiary)" }}>{dishDate(e) ? formatVisitDate(dishDate(e)) : "Date unknown"}</span>
            </div>
            {e.price_cents != null && <div style={{ color: "var(--text-secondary)" }}>{formatCents(e.price_cents)}</div>}
            {e.note && e !== row && <div style={{ color: "var(--text-secondary)", overflowWrap: "anywhere" }}>{e.note}</div>}
            {sameVisitOthers.length > 0 && (
              <div style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
                Also had: {sameVisitOthers.map((o) => o.name).join(", ")}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {onRateAgain && (
          <button type="button" onClick={onRateAgain} data-testid="dish-rate-again-btn" style={{
            flex: 1, border: "none", borderRadius: RADIUS.md, minHeight: 44, background: "var(--accent-food)", color: "var(--on-accent-food)", cursor: "pointer", font: "inherit", fontSize: 14, fontWeight: 700,
          }}>Rate again</button>
        )}
        <button type="button" onClick={onEdit} data-testid="dish-detail-edit-btn" style={{
          flex: "0 0 auto", border: "1px solid var(--border-default)", borderRadius: RADIUS.md, minHeight: 44, padding: "0 16px", background: "transparent", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 600,
        }}>Edit</button>
      </div>
    </div>
  );
}

/* The inline add/edit row — expands in place, never a dialog. Field order top to bottom (the
 * redesign's FIELD HIERARCHY): a "NEW DISH"/"EDIT DISH" label + close X, the dish name as the
 * page's one hero field, Course + Price sharing a row, the Score block, the Order-again block,
 * Note last. Enter commits (and, only when adding a NEW dish, reopens a blank row); Esc cancels. */
function DishEditRow({ initial, mode = initial ? "edit" : "new", rows = [], openWishlistNames, onSave, onCancel: onCancelRaw, pending, isMobile, scope = "place" }) {
  const isEdit = mode === "edit", isRerate = mode === "rerate";
  // Kept across the card remounting (rotate the phone — lib/draftStore.js); an explicit close/cancel/save-and-close clears it.
  const drafts = useDraftStore();
  const draftKey = `dish:${scope}:${mode}:${initial?.id || "new"}`;
  const onCancel = () => { drafts?.clear(draftKey); onCancelRaw(); };
  const [name, setName] = useDraftField(draftKey, "name", () => initial?.name || "");
  const [course, setCourse] = useDraftField(draftKey, "course", () => initial?.course || "");
  const [score, setScore] = useDraftField(draftKey, "score", () => (!isRerate && initial?.score != null ? Number(initial.score) : null)); // a re-rate starts UNSET: the new score is the point
  const [orderAgain, setOrderAgain] = useDraftField(draftKey, "orderAgain", () => initial?.order_again || null);
  const [price, setPrice] = useDraftField(draftKey, "price", () => (initial?.price_cents != null ? (initial.price_cents / 100).toFixed(2) : ""));
  const [note, setNote] = useDraftField(draftKey, "note", () => initial?.note || "");
  // Names he wants to try but has not had yet are offered too (struck done on save by FoodApp), after the dishes already saved.
  const pickRows = [...rows, ...openWishlistNames.filter((n) => !rows.some((r) => sameDishName(r.name, n))).map((n) => ({ key: `wish:${n}`, name: n, latestScore: null }))];
  const pickRow = (r) => {
    setName(r.name);
    if (r.course != null || r.price_cents != null || r.note != null || r.order_again != null) { // an already-saved dish: carry its facts forward
      if (!course) setCourse(r.course || "");
      if (price === "") setPrice(r.price_cents != null ? (r.price_cents / 100).toFixed(2) : "");
      if (!note) setNote(r.note || "");
      if (!orderAgain) setOrderAgain(r.order_again || null);
    }
  };

  const reset = () => { setName(""); setCourse(""); setScore(null); setOrderAgain(null); setPrice(""); setNote(""); };

  const commit = async (andReopen) => {
    if (!name.trim()) return;
    const ok = await onSave({ ...(isRerate ? { _rerate: true } : {}),
      name: name.trim(),
      course: course || null,
      score,
      order_again: orderAgain,
      price_cents: price === "" ? null : Math.round(Number(price) * 100),
      note: note || null,
    });
    if (ok && andReopen) reset(); // stay open, ready for the next dish — "save-and-add-another"
    else if (ok) onCancel();
  };

  return (
    <div
      data-testid="dish-edit-row" data-edit-card="" data-sheet-form=""
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); commit(!isEdit && !isRerate); }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px", background: "var(--surface-raised)", border: "1px solid var(--accent-food)", borderRadius: RADIUS.lg, margin: "4px" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: FONT_SIZE.micro, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }} data-testid="dish-edit-heading">
          {isRerate ? "Rate again" : isEdit ? "Edit dish" : "New dish"}
        </span>
        <CloseX onClick={onCancel} label="Close" testId="dish-edit-close" size={44} />
      </div>

      {/* Dish name — the editor's hero field: large, transparent, no box, a 2px accent underline only. A re-rate shows the name as
          the title (it is the same dish); a new dish / an edit gets the field, name first, with saved-dish suggestions under it. */}
      {isRerate ? (
        <div data-testid="dish-rerate-name" style={{ fontSize: isMobile ? 20 : 19, fontWeight: 600, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{name}</div>
      ) : (
        <DishNameField
          value={name} onChange={setName} rows={isEdit ? [] : pickRows} onPick={pickRow} autoFocus
          inputStyle={{
            width: "100%", boxSizing: "border-box", background: "transparent", border: "none",
            borderBottom: "2px solid var(--accent-food)", padding: "4px 2px",
            font: "inherit", fontSize: isMobile ? 20 : 19, fontWeight: 600, color: "var(--text-primary)",
          }}
        />
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={FIELD_LABEL_STYLE}>Course</span>
          <select value={course} onChange={(e) => setCourse(e.target.value)} style={FILLED_FIELD_STYLE} data-testid="dish-course-select">
            {COURSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div style={{ flex: "0 0 92px" }}>
          <span style={FIELD_LABEL_STYLE}>Price</span>
          <input
            type="number" step="0.01" min="0" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
            placeholder="$" style={FILLED_FIELD_STYLE} data-testid="dish-price-input" {...noAutofill("dish-price")}
          />
        </div>
      </div>

      <ScoreMeter value={score} onChange={setScore} label="Dish score" isMobile={isMobile} />

      <OrderAgainControl value={orderAgain} onChange={setOrderAgain} isMobile={isMobile} />

      <div>
        <span style={FIELD_LABEL_STYLE}>Note</span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" style={FILLED_FIELD_STYLE} data-testid="dish-note-input" {...noAutofill("dish-remarks")} enterKeyHint="done" />
      </div>

      {isMobile ? (
        // Phone: pinned to the bottom of the editor, a narrow secondary action on the left and
        // the primary solid action wide on the right — no hint line, no room for it.
        <div data-testid="dish-edit-buttons" data-sheet-sticky="bottom" style={{ position: "sticky", bottom: 0, background: "var(--surface-raised)", paddingTop: 4, display: "flex", gap: 8 }}>
          <button type="button" onClick={isEdit || isRerate ? onCancel : () => commit(false)} data-testid={isEdit || isRerate ? "dish-cancel-btn" : "dish-save-close-btn"} style={{
            flex: "0 0 auto", border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "0 16px", minHeight: 44,
            background: "transparent", color: "var(--text-secondary)", cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 600,
          }}>
            {isEdit || isRerate ? "Cancel" : "Done"}
          </button>
          <button
            type="button" onClick={() => commit(!isEdit && !isRerate)} disabled={pending || !name.trim()} data-testid="dish-save-btn"
            style={{
              flex: 1, border: "none", borderRadius: RADIUS.md, padding: "0 12px", minHeight: 44, cursor: pending ? "default" : "pointer",
              background: "var(--accent-food)", color: "var(--on-accent-food)", font: "inherit", fontSize: 14, fontWeight: 700,
              opacity: pending || !name.trim() ? 0.6 : 1,
            }}
          >
            {isEdit || isRerate ? "Save" : "Save & add another"}
          </button>
        </div>
      ) : (
        <div data-testid="dish-edit-buttons">
          <button
            type="button" onClick={() => commit(!isEdit && !isRerate)} disabled={pending || !name.trim()} data-testid="dish-save-btn"
            style={{
              width: "100%", border: "none", borderRadius: RADIUS.md, padding: "10px 0", minHeight: 44, cursor: pending ? "default" : "pointer",
              background: "var(--accent-food)", color: "var(--on-accent-food)", font: "inherit", fontSize: FONT_SIZE.display, fontWeight: 700,
              opacity: pending || !name.trim() ? 0.6 : 1,
            }}
          >
            {isEdit || isRerate ? "Save" : "Save & add another"}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", flex: "1 1 auto" }}>
              Enter saves{!isEdit && !isRerate ? " · starts another" : ""} · Esc cancels
            </span>
            {!isEdit && !isRerate && (
              <button type="button" onClick={() => commit(false)} data-testid="dish-save-close-btn" style={{
                flex: "none", border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "6px 12px", minHeight: 32,
                background: "transparent", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600,
              }}>
                Save & close
              </button>
            )}
            <button type="button" onClick={onCancel} data-testid="dish-cancel-btn" style={{
              flex: "none", border: "none", background: "none", color: "var(--text-secondary)", cursor: "pointer",
              font: "inherit", fontSize: 12, padding: 0,
            }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* The score CHIP — dish rows' own three-tier ramp (dishScoreTier), never ratingColor.js's 10-step
 * place ramp (see dishAggregates.js's own header on why the two are deliberately different). An
 * unscored dish gets the dashed em-dash chip instead. */
function ScoreChip({ score }) {
  if (score == null) {
    return (
      <span data-testid="dish-score-chip" data-score-tier="unset" style={{
        display: "flex", alignItems: "center", justifyContent: "center", minWidth: 34, height: 26,
        borderRadius: RADIUS.sm, border: DASHED_BORDER, fontWeight: 700, fontSize: FONT_SIZE.control,
        color: "var(--text-tertiary)", flex: "none",
      }}>
        —
      </span>
    );
  }
  const tier = dishScoreTier(score);
  const skin = {
    high: { background: "var(--accent-food)", color: "var(--on-accent-food)", border: "none" },
    mid: { background: "color-mix(in srgb, var(--accent-food) 16%, var(--surface-page))", color: "var(--accent-food-text)", border: "1px solid var(--border-default)" },
    low: { background: "var(--chrome-muted)", color: "var(--text-secondary)", border: "none" },
  }[tier];
  return (
    <span data-testid="dish-score-chip" data-score-tier={tier} style={{
      display: "flex", alignItems: "center", justifyContent: "center", minWidth: 34, height: 26,
      borderRadius: RADIUS.sm, fontWeight: 700, fontSize: FONT_SIZE.control, flex: "none", ...skin,
    }}>
      {formatScore(score)}
    </span>
  );
}

function DishKebabMenu({ row, onEdit, onRateAgain, onDelete }) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const anchorRef = useRef(null);
  const close = () => { setOpen(false); setConfirmingDelete(false); };
  return (
    <div style={{ position: "relative", flex: "none" }}>
      <button
        type="button" className="tap-target" ref={anchorRef} data-testid="dish-row-kebab" aria-haspopup="menu" aria-expanded={open}
        aria-label={`More actions for ${row.name}`} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", flex: "none",
          width: 28, height: 28, padding: 0, borderRadius: RADIUS.sm, border: "none",
          background: open ? "var(--hover-ghost)" : "transparent", color: "var(--text-secondary)", cursor: "pointer",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: "block" }}>
          <circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" />
        </svg>
      </button>
      <AnchoredMenu open={open} onClose={close} anchorRef={anchorRef} placement="below-right" width={180}>
        {confirmingDelete ? (
          <div style={{ padding: "6px 8px" }}>
            <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", marginBottom: 6 }}>Delete this dish?</div>
            <div style={{ display: "flex", gap: 6 }}>
              <MenuItem data-testid="dish-row-delete-confirm" onClick={() => { onDelete(row.id); close(); }} style={{ color: "var(--danger-text)" }}>
                Delete
              </MenuItem>
              <MenuItem data-testid="dish-row-delete-cancel" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </MenuItem>
            </div>
          </div>
        ) : (
          <>
            <MenuItem data-testid="dish-row-edit" onClick={() => { onEdit(); close(); }}>Edit</MenuItem>
            <MenuItem data-testid="dish-row-rate-again" onClick={() => { onRateAgain(); close(); }}>Rate again</MenuItem>
            <MenuItem data-testid="dish-row-delete" onClick={() => setConfirmingDelete(true)} style={{ color: "var(--danger-text)" }}>
              Delete
            </MenuItem>
          </>
        )}
      </AnchoredMenu>
    </div>
  );
}

/* A dish row: the SCORE CHIP is now far left (the list sorts by score, so the numbers form a
 * readable column), then the dish name + a compact info line, an order-again badge, and the
 * kebab menu at the right edge. The row itself opens the editor on click — the standalone pencil
 * button and the bare delete ✕ are both GONE (delete now lives only in the kebab menu, alongside
 * Edit and, when the dish has been had more than once, History). */
function DishDisplayRow({ row, open, onToggle, onOpenEdit, onRateAgain, onDeleteDish, dishesAtSamePlace }) {
  const unscored = row.latestScore == null;
  const orderBadge = ORDER_AGAIN_OPTIONS.find((o) => o.value === row.order_again);
  const infoLine = [COURSE_LABEL[row.course] || null, formatCents(row.price_cents), row.timesHad > 1 ? `had ${row.timesHad}×` : null]
    .filter(Boolean).join(" · ");

  return (
    <>
      <div
        data-testid="dish-row" data-dish-scored={unscored ? "false" : "true"} aria-expanded={open} onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") onToggle(); }}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", cursor: "pointer", minHeight: 46,
          borderBottom: unscored ? DASHED_BORDER : "1px solid var(--border-default)",
        }}
      >
        <ScoreChip score={row.latestScore} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{row.name}</div>
          {unscored && <div style={{ fontSize: FONT_SIZE.label, color: "var(--accent-food-text)" }} data-testid="dish-unscored-caption">Not scored yet</div>}
          {!unscored && infoLine && <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>{infoLine}</div>}
          {row.note && (
            // One truncated line; the full text is in the panel a tap on the row opens.
            <div data-testid="dish-row-note" style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.note}</div>
          )}
        </div>
        {orderBadge && (
          <span
            aria-hidden="true" title={`Order again: ${orderBadge.label}`} data-testid="dish-order-again-badge"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", flex: "none", width: 20, height: 20,
              borderRadius: RADIUS.pill, background: "var(--chrome-muted)", fontSize: FONT_SIZE.micro, fontWeight: 700,
              color: row.order_again === "yes" ? "var(--accent-food-text)" : "var(--text-tertiary)",
            }}
          >
            {orderBadge.glyph}
          </span>
        )}
        {unscored && (
          <button
            type="button" className="tap-target" onClick={(e) => { e.stopPropagation(); onOpenEdit(); }} data-testid="dish-score-it-btn"
            style={{
              flex: "none", border: "none", borderRadius: RADIUS.sm, padding: "5px 9px", minHeight: 32,
              background: "var(--accent-food)", color: "var(--on-accent-food)", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.micro, fontWeight: 700,
            }}
          >
            Score it
          </button>
        )}
        <span onClick={(e) => e.stopPropagation()}>
          <DishKebabMenu row={row} onEdit={onOpenEdit} onRateAgain={onRateAgain} onDelete={onDeleteDish} />
        </span>
      </div>
      {open && <DishHistoryPanel row={row} dishesAtSamePlace={dishesAtSamePlace} onRateAgain={onRateAgain} onEdit={onOpenEdit} />}
    </>
  );
}

const SORTS = {
  score: (a, b) => (Number(b.latestScore ?? -1) - Number(a.latestScore ?? -1)),
  name: (a, b) => a.name.localeCompare(b.name),
  price: (a, b) => (Number(b.price_cents ?? -1) - Number(a.price_cents ?? -1)),
  last: (a, b) => (b.visited_on || "").localeCompare(a.visited_on || ""),
};

export default function DishesSection({ dishesWithDate, visits, onSaveDish, onDeleteDish, pending, openWishlistNames = [], scope = "place" }) {
  const [sortKey, setSortKey] = useState("score");
  // Which add/edit row is open survives the card remounting (lib/draftStore.js); `scope` keeps the place-wide section and the one inside an editing visit apart.
  const [addingNew, setAddingNew] = useDraftField(`dishes-ui:${scope}`, "addingNew", false);
  const [editingKey, setEditingKey] = useDraftField(`dishes-ui:${scope}`, "editingKey", null);
  const [rerateKey, setRerateKey] = useDraftField(`dishes-ui:${scope}`, "rerateKey", null);
  const [openHistoryKey, setOpenHistoryKey] = useState(null);
  const isMobile = useIsMobile();

  const rows = useMemo(() => dishRowsForTable(dishesWithDate), [dishesWithDate]);
  const sorted = useMemo(() => [...rows].sort(SORTS[sortKey] || SORTS.score), [rows, sortKey]);
  const orderEntries = useMemo(() => theOrderEntries(rows), [rows]);
  const orderTotal = theOrderTotalCents(orderEntries);

  if (!visits || !visits.length) return null; // a place with zero visits has nothing to have had dishes at
  const targetVisitId = visits[0].id; // most recent visit — see file header for why
  // A rating given from the PLACE page is dated today (`rated_on`); one made inside an editing visit belongs to that visit's own day.
  const saveNew = (fields) => { const { _rerate, ...rest } = fields; return onSaveDish({ ...rest, visit_id: targetVisitId, ...(scope === "place" ? { rated_on: todayLocal() } : {}) }); };

  const copyOrder = () => {
    const text = theOrderAsText(orderEntries);
    if (navigator?.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <div data-testid="food-dishes-section" style={{ margin: "8px 16px 0" }}>
      {orderEntries.length > 0 && (
        <div data-testid="food-the-order" style={{
          padding: "9px 11px", borderRadius: RADIUS.lg, marginBottom: 8,
          background: "color-mix(in srgb, var(--accent-food) 12%, var(--surface-page))", border: "1px solid var(--border-default)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: FONT_SIZE.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-tertiary)" }}>The order</span>
            <button type="button" onClick={copyOrder} data-testid="food-the-order-copy" style={{
              border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, background: "transparent", color: "var(--text-primary)",
              cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.label, padding: "4px 8px", minHeight: 32,
            }}>
              Copy
            </button>
          </div>
          <div style={{ marginTop: 3, fontSize: FONT_SIZE.emphasis, color: "var(--text-primary)" }}>{orderEntries.map((r) => r.name).join(", ")}</div>
          {orderTotal > 0 && <div style={{ marginTop: 2, fontSize: 12, color: "var(--text-secondary)" }}>Total {formatCents(orderTotal)}</div>}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
        <span style={{ fontSize: FONT_SIZE.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-tertiary)" }}>
          Dishes · {rows.length}
        </span>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} data-testid="food-dishes-sort" style={{
          border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, background: "var(--surface-page)", color: "var(--text-primary)",
          font: "inherit", fontSize: FONT_SIZE.control, padding: "4px 6px", minHeight: 32,
        }}>
          <option value="score">Sort: score</option>
          <option value="name">Sort: name</option>
          <option value="price">Sort: price</option>
          <option value="last">Sort: last had</option>
        </select>
      </div>

      <div style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.lg,
        // clip, not hidden: `hidden` makes this box a scroll container, so the open form's sticky Save bar
        // pinned to THIS box (it scrolled away with the form) instead of the bottom of the sheet (NEW-2).
        overflow: "clip" }}>
        {sorted.map((row) =>
          editingKey === row.key || rerateKey === row.key ? (
            <div key={row.key}>
              <DishEditRow
                initial={row} mode={rerateKey === row.key ? "rerate" : "edit"} openWishlistNames={openWishlistNames}
                pending={pending} onCancel={() => { setEditingKey(null); setRerateKey(null); }} isMobile={isMobile} scope={scope}
                onSave={(fields) => (rerateKey === row.key ? saveNew(fields) : onSaveDish({ ...fields, id: row.id }))}
              />
            </div>
          ) : (
            <DishDisplayRow
              key={row.key} row={row} dishesAtSamePlace={dishesWithDate}
              open={openHistoryKey === row.key}
              onToggle={() => setOpenHistoryKey((k) => (k === row.key ? null : row.key))}
              onOpenEdit={() => { setAddingNew(false); setRerateKey(null); setEditingKey(row.key); }}
              onRateAgain={() => { setAddingNew(false); setEditingKey(null); setOpenHistoryKey(null); setRerateKey(row.key); }}
              onDeleteDish={onDeleteDish}
            />
          )
        )}
        {addingNew ? (
          <DishEditRow
            rows={rows} openWishlistNames={openWishlistNames} pending={pending} isMobile={isMobile}
            onCancel={() => setAddingNew(false)} scope={scope}
            onSave={saveNew}
          />
        ) : (
          <button
            type="button" onClick={() => { setEditingKey(null); setRerateKey(null); setAddingNew(true); }} data-testid="food-add-dish-btn"
            style={{
              display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", background: "transparent",
              border: "none", borderTop: DASHED_BORDER, padding: "11px 12px", minHeight: 44, cursor: "pointer",
              font: "inherit", fontSize: 13, fontWeight: 700, color: "var(--accent-food)",
            }}
          >
            <span aria-hidden="true">+</span> Add a dish
          </button>
        )}
      </div>
    </div>
  );
}
