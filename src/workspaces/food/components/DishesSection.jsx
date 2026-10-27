/* DishesSection — the restaurant panel's dish list, which IS the order (NEW-1 / NEW-2, owner-approved mockup
 * 2026-10-20: "i like it all as is, send it"; B1873008 / B2268434 history below).
 *
 * ⛔ THE DISH LIST IS THE ORDER. There is no separate "The order" card, no Copy button, no Sort control and no per-row
 * kebab any more. A dish's eat-again answer places it: WHAT TO ORDER (yes) · MAYBE (maybe or unanswered) · "Skip · N
 * dishes ▾" (no, collapsed until tapped) — each sorted by score, highest first; an empty section is not drawn
 * (lib/restaurantPanel.js `dishSections`). A row is: a NEUTRAL score badge (dark for the order, light grey for maybe /
 * skip — never red), the name, one grey line (the note on one truncated line, or "Was 7.5 · up from last time" once it
 * has two ratings and no note, or "Add a note"), and a chevron; the WHOLE row opens the dish sheet.
 *
 * ⛔ THE DISH SHEET (`DishSheet`, NEW-2) replaces the row's kebab + the inline history panel: "‹ <restaurant>" back on the
 * left, Done (saves) on the right, the name as an editable title (the existing rename path — a rename reaches every
 * rating), SCORE (the one shared quarter-step slider), WOULD I EAT IT AGAIN (Yes / Maybe / No), NOTE ("How to order it
 * next time"), the rating history ONLY when there are two or more, and at the bottom the actions the kebab used to
 * hold: Rate again (a NEW rating dated today, history kept) and Delete (inline confirm, never a dialog).
 * Changing the eat-again answer moves the dish between sections the moment Done lands.
 *
 * ⛔ INLINE EDITORS ONLY. "+ Add a dish" still expands IN PLACE into DishEditRow (unchanged add flow: name focused
 * first, saved-dish suggestions, score, eat-again, note; a new dish from the place page attaches to the MOST RECENT
 * visit and is dated today via `rated_on`). Never a dialog box.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useDraftField, useDraftStore } from "../lib/draftStore.js";
import ScoreMeter from "./ScoreMeter.jsx";
import CloseX from "./CloseX.jsx";
import { formatVisitDate } from "../lib/dateFormat.js";
import { dishRowsForTable, formatCents, formatScore, dishScoreTier, dishDate } from "../lib/dishAggregates.js";
import { dishSections, dishSubline, dishHistoryEntries } from "../lib/restaurantPanel.js";
import RatingSlider from "./RatingSlider.jsx";
import { noAutofill } from "../lib/noAutofill.js";
import { chipBox } from "../lib/chipStyle.js";
import { suggestDishes, sameDishName } from "../lib/dishSuggest.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import SectionLabel from "./SectionLabel.jsx";
import { FOOD_TYPE, ITEM_STEP } from "../lib/foodType.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

const COURSES = [
  { value: "", label: "Course…" },
  { value: "starter", label: "Starter" },
  { value: "entree", label: "Entrée" },
  { value: "side", label: "Side" },
  { value: "dessert", label: "Dessert" },
  { value: "drink", label: "Drink" },
];

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
const FIELD_LABEL_STYLE = { display: "block", ...FOOD_TYPE.label, marginBottom: 3 }; // NEW-1 (2026-10-27): the ONE caps label (lib/foodType.js) — no second dialect
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
export function OrderAgainControl({ value, onChange, isMobile, label = "Order it again?" }) {
  const minH = isMobile ? 54 : 46;
  return (
    <div>
      <span style={FIELD_LABEL_STYLE}>{label}</span>
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

  const committing = useRef(false); // a second tap while the first save is still in flight must never write a second rating
  const commit = async (andReopen) => {
    if (!name.trim() || committing.current) return;
    committing.current = true;
    let ok = false;
    try { ok = await onSave({ ...(isRerate ? { _rerate: true } : {}),
      name: name.trim(),
      course: course || null,
      score,
      order_again: orderAgain,
      price_cents: price === "" ? null : Math.round(Number(price) * 100),
      note: note || null,
    }); } finally { committing.current = false; }
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
        <span style={FOOD_TYPE.label} data-testid="dish-edit-heading">
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

/* The score BADGE — neutral, never red (the mockup; red stays reserved for genuine danger per this app's colour rule):
 * DARK for a dish in the order, LIGHT GREY for a maybe / skip row, a dashed em-dash for a dish not scored yet.
 * `data-score-tier` (dishAggregates.dishScoreTier) rides along as data only — it no longer picks a colour. */
function DishBadge({ score, section }) {
  const dark = section === "order";
  const base = {
    ...chipBox(26, 6), minWidth: 38, // NEW-3: the shared centred chip box (lib/chipStyle.js)
    borderRadius: RADIUS.sm, fontWeight: 700, fontSize: FONT_SIZE.control, flex: "none", fontVariantNumeric: "tabular-nums",
  };
  if (score == null) {
    return <span data-chip="" data-testid="dish-score-chip" data-score-tier="unset" data-badge="unset" style={{ ...base, border: DASHED_BORDER, color: "var(--text-tertiary)" }}>—</span>;
  }
  return (
    <span data-chip="" data-testid="dish-score-chip" data-score-tier={dishScoreTier(score)} data-badge={dark ? "dark" : "light"} style={{
      ...base,
      background: dark ? "var(--text-primary)" : "var(--hover-ghost)", // --hover-ghost: the light grey fill in both themes (--chrome-muted is a dark fill)
      color: dark ? "var(--surface-raised)" : "var(--text-secondary)",
    }}>
      {formatScore(score)}
    </span>
  );
}

const CHEVRON = <span aria-hidden="true" style={{ flex: "none", color: "var(--text-tertiary)", fontSize: FONT_SIZE.display, lineHeight: 1 }}>›</span>;

/* A dish row: badge · name + one grey line · chevron. The whole row is the tap target and opens the dish sheet
 * (no kebab, no eat-again circle — both moved into the sheet). */
function DishDisplayRow({ row, section, onOpen }) {
  const sub = dishSubline(row);
  return (
    <div
      data-testid="dish-row" data-dish-section={section} data-dish-scored={row.latestScore == null ? "false" : "true"} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", cursor: "pointer", minHeight: 48, boxSizing: "border-box", borderBottom: "1px solid var(--border-default)" }} // NEW-1: flat on the column edge — no rounded box pushing the badge in
    >
      <DishBadge score={row.latestScore} section={section} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...FOOD_TYPE.body, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{row.name}</div>
        {sub.kind === "note" ? (
          // One truncated line; the full text is in the dish sheet a tap on the row opens.
          <div data-testid="dish-row-note" data-subline-kind="note" style={{ ...FOOD_TYPE.caption, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub.text}</div>
        ) : (
          <div data-testid="dish-row-subline" data-subline-kind={sub.kind} style={{ ...FOOD_TYPE.caption, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: sub.kind === "empty" ? "var(--text-tertiary)" : "var(--text-secondary)" }}>{sub.text}</div>
        )}
      </div>
      {CHEVRON}
    </div>
  );
}


/* ── The dish sheet (NEW-2) ──────────────────────────────────────────────────────────────────────────────────────── */
export function DishSheet({ row, restaurantName, visits, onBack, onSaveDish, onDeleteDish, pending, isMobile, scope = "place" }) {
  const drafts = useDraftStore();
  const draftKey = `dish-sheet:${scope}:${row.key}`;
  const [name, setName] = useDraftField(draftKey, "name", () => row.name || "");
  const [score, setScore] = useDraftField(draftKey, "score", () => (row.latestScore != null ? Number(row.latestScore) : null));
  const [orderAgain, setOrderAgain] = useDraftField(draftKey, "orderAgain", () => row.order_again || null);
  const [note, setNote] = useDraftField(draftKey, "note", () => row.note || "");
  const [rerate, setRerate] = useDraftField(draftKey, "rerate", false); // Rate again: Done writes a NEW rating (dated today) instead of editing the latest
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const committing = useRef(false);
  const history = dishHistoryEntries(row);
  const close = () => { drafts?.clear(draftKey); onBack(); };

  const done = async () => {
    if (committing.current || !name.trim()) return;
    committing.current = true;
    let ok = false;
    try {
      if (rerate) {
        // The same rule the add flow uses: a page-made rating hangs off the most recent visit and is dated the day it was given.
        ok = await onSaveDish({ name: name.trim(), course: row.course || null, price_cents: row.price_cents ?? null, score, order_again: orderAgain, note: note || null, visit_id: visits[0].id, rated_on: todayLocal() });
      } else {
        ok = await onSaveDish({ id: row.id, name: name.trim(), score, order_again: orderAgain, note: note || null });
      }
    } finally { committing.current = false; }
    if (ok) close();
  };
  const startRerate = () => { setRerate(true); setScore(null); };

  const topBtn = { border: "none", background: "none", cursor: "pointer", font: "inherit", minHeight: 44, padding: "0 4px", color: "var(--accent-food)", fontSize: FONT_SIZE.display, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, maxWidth: "70%" };
  return (
    <div data-testid="dish-sheet" data-sheet-form="" data-edit-card="" data-dish-mode={rerate ? "rerate" : "edit"} style={{ display: "flex", flexDirection: "column", gap: 14, padding: "6px 16px 16px", minWidth: 0 }}>
      <div data-sheet-grab="" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button type="button" onClick={close} data-testid="dish-sheet-back" aria-label={`Back to ${restaurantName || "the restaurant"}`} style={topBtn}>
          <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>‹</span>{/* design-exempt: a chevron glyph, not text — drawn one step larger than the label beside it */}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{restaurantName}</span>
        </button>
        <button type="button" onClick={done} disabled={pending || !name.trim()} data-testid="dish-sheet-done" style={{ ...topBtn, fontWeight: 700, opacity: pending || !name.trim() ? 0.6 : 1, maxWidth: "none" }}>
          Done
        </button>
      </div>
      {/* The name is the title and is editable in place (the existing rename path: FoodApp.saveDish rewrites every rating row). */}
      <input
        type="text" value={name} onChange={(e) => setName(e.target.value)} aria-label="Dish" data-testid="dish-sheet-name"
        enterKeyHint="done" autoCapitalize="words" {...noAutofill("dish-pick")}
        style={{
          width: "100%", boxSizing: "border-box", background: "transparent", border: "none", borderBottom: "1px solid var(--border-default)", padding: "2px 0 6px",
          font: "inherit", fontSize: 20, fontWeight: 700, color: "var(--text-primary)", // design-exempt: the sheet's title — the one hero line, matching the restaurant name's size
        }}
      />
      {rerate && <div data-testid="dish-sheet-rerate-note" style={{ fontSize: FONT_SIZE.label, color: "var(--accent-food-text)", fontWeight: 700 }}>New rating · dated today · the earlier one stays in the history</div>}
      <div>
        <span style={FIELD_LABEL_STYLE}>Score</span>
        <RatingSlider value={score} onChange={setScore} label="Dish score" isMobile={isMobile} testIds={{ root: "dish-score-meter", slider: "dish-score-slider", readout: "dish-score-numeral", clear: "dish-score-clear" }} />
      </div>
      <OrderAgainControl value={orderAgain} onChange={setOrderAgain} isMobile={isMobile} label="Would I eat it again" />
      <div>
        <span style={FIELD_LABEL_STYLE}>Note</span>
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)} placeholder="How to order it next time" rows={3} data-testid="dish-sheet-note"
          {...noAutofill("dish-remarks")} style={{ ...FILLED_FIELD_STYLE, fontSize: 16, resize: "vertical" }} // design-exempt: iOS Safari zooms the page on a field under 16 px
        />
      </div>
      {history.length >= 2 && (
        <div data-testid="dish-sheet-history">
          <span style={FIELD_LABEL_STYLE}>History</span>
          {history.map((e) => (
            <div key={e.id} data-testid="dish-history-entry" style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderTop: "1px solid var(--border-default)", fontSize: FONT_SIZE.control }}>
              <span style={{ color: "var(--text-secondary)" }}>{dishDate(e) ? formatVisitDate(dishDate(e)) : "No date"}</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{e.score != null ? formatScore(e.score) : "—"}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6, borderTop: "1px solid var(--border-default)", paddingTop: 12 }}>
        {!rerate && (
          <button type="button" onClick={startRerate} data-testid="dish-rate-again-btn" style={{
            border: "1px solid var(--border-default)", borderRadius: RADIUS.md, minHeight: 44, background: "transparent", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 700,
          }}>Rate again</button>
        )}
        {confirmingDelete ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ flex: 1, fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>Delete this dish and its {history.length || 1} rating{(history.length || 1) === 1 ? "" : "s"}?</span>
            <button type="button" onClick={() => setConfirmingDelete(false)} data-testid="dish-row-delete-cancel" style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.md, minHeight: 44, padding: "0 12px", background: "transparent", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.control }}>Cancel</button>
            <button type="button" onClick={async () => { for (const e of [row, ...(row.history || [])]) await onDeleteDish(e.id); close(); }} data-testid="dish-row-delete-confirm" style={{ border: "1px solid var(--danger-border, var(--danger))", borderRadius: RADIUS.md, minHeight: 44, padding: "0 12px", background: "transparent", color: "var(--danger-text, var(--danger))", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700 }}>Delete</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmingDelete(true)} data-testid="dish-row-delete" style={{
            border: "none", borderRadius: RADIUS.md, minHeight: 44, background: "transparent", color: "var(--danger-text, var(--danger))", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 600,
          }}>Delete dish</button>
        )}
      </div>
    </div>
  );
}

/* `hideAdd` (NEW-2, 2026-10-27): a Log-a-visit / edit-a-visit form is open and carries its OWN "add a dish" — so the place card's steps aside (the
 * open add-row draft stays in the panel's draft store and is back when the form closes). Never two add-a-dish controls on screen. */
export default function DishesSection({ dishesWithDate, visits, onSaveDish, onDeleteDish, pending, openWishlistNames = [], scope = "place", onOpenDish, hideAdd = false }) {
  // Which add row is open survives the card remounting (lib/draftStore.js); `scope` keeps the place-wide section and the one inside an editing visit apart.
  const [addingNew, setAddingNew] = useDraftField(`dishes-ui:${scope}`, "addingNew", false);
  const [skipOpen, setSkipOpen] = useState(false); // "Skip · N dishes ▾" — collapsed by default, one tap expands
  const isMobile = useIsMobile();

  const rows = useMemo(() => dishRowsForTable(dishesWithDate), [dishesWithDate]);
  const sections = useMemo(() => dishSections(rows), [rows]);

  if (!visits || !visits.length) return null; // a place with zero visits has nothing to have had dishes at
  const targetVisitId = visits[0].id; // most recent visit — see file header for why
  // A rating given from the PLACE page is dated today (`rated_on`); one made inside an editing visit belongs to that visit's own day.
  const saveNew = (fields) => { const { _rerate, ...rest } = fields; return onSaveDish({ ...rest, visit_id: targetVisitId, ...(scope === "place" ? { rated_on: todayLocal() } : {}) }); };
  const open = (row) => onOpenDish?.(row.key);

  const list = (sectionRows, section) => sectionRows.map((row) => <DishDisplayRow key={row.key} row={row} section={section} onOpen={() => open(row)} />);

  const dishCount = (n) => `${n} ${n === 1 ? "dish" : "dishes"}`;
  const group = (rowsIn, section) => <div>{list(rowsIn, section)}</div>;

  return (
    <div data-testid="food-dishes-section" style={{ margin: "0 16px" }}>
      {sections.order.length > 0 && (
        <div data-testid="food-dishes-order">
          <SectionLabel inset={0} count={dishCount(sections.order.length)}>What to order</SectionLabel>
          {group(sections.order, "order")}
        </div>
      )}
      {sections.maybe.length > 0 && (
        <div data-testid="food-dishes-maybe">
          <SectionLabel inset={0} count={dishCount(sections.maybe.length)}>Maybe</SectionLabel>
          {group(sections.maybe, "maybe")}
        </div>
      )}
      {sections.skip.length > 0 && (
        <div data-testid="food-dishes-skip" data-open={skipOpen ? "true" : "false"}>
          <SectionLabel inset={0} count={dishCount(sections.skip.length)} open={skipOpen} onToggle={() => setSkipOpen((o) => !o)} testId="food-dishes-skip-toggle">Skip</SectionLabel>
          {skipOpen && group(sections.skip, "skip")}
        </div>
      )}

      {!hideAdd && (
        <div style={{ marginTop: ITEM_STEP * 2 }}>
          {addingNew ? (
            <div style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.lg,
              // clip, not hidden: `hidden` makes this box a scroll container, so the open form's sticky Save bar
              // pinned to THIS box (it scrolled away with the form) instead of the bottom of the sheet (NEW-2).
              overflow: "clip" }}>
              <DishEditRow
                rows={rows} openWishlistNames={openWishlistNames} pending={pending} isMobile={isMobile}
                onCancel={() => setAddingNew(false)} scope={scope}
                onSave={saveNew}
              />
            </div>
          ) : (
            <button
              type="button" onClick={() => setAddingNew(true)} data-testid="food-add-dish-btn"
              style={{
                display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", background: "transparent", boxSizing: "border-box",
                border: "none", borderBottom: "1px solid var(--border-default)", padding: 0, minHeight: 44, cursor: "pointer",
                font: "inherit", ...FOOD_TYPE.body, fontWeight: 700, color: "var(--accent-food)",
              }}
            >
              <span aria-hidden="true">+</span> Add a dish
            </button>
          )}
        </div>
      )}
    </div>
  );
}
