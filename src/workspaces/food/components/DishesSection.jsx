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
import ScoreMeter from "./ScoreMeter.jsx";
import { formatVisitDate } from "../lib/dateFormat.js";
import {
  dishRowsForTable, theOrderEntries, theOrderTotalCents, theOrderAsText, formatCents,
  formatScore, dishScoreTier,
} from "../lib/dishAggregates.js";
import { noAutofill } from "../lib/noAutofill.js";
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
function OrderAgainControl({ value, onChange, isMobile }) {
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

/* One dish's history — every score over time as a small bar chart, every note with its date and
 * price, and what else was had at the same visit. Inline expansion, never a separate page/modal.
 * Reached from the row's kebab menu (NEW-1) rather than a row click, which now opens the editor. */
function DishHistoryPanel({ row, dishesAtSamePlace }) {
  const entries = [row, ...row.history];
  const maxScore = Math.max(1, ...entries.map((e) => Number(e.score) || 0));
  return (
    <div data-testid="dish-history-panel" style={{ padding: "8px 12px 12px", background: "var(--surface-page)", borderRadius: 8, margin: "0 4px 8px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 48, marginBottom: 8 }}>
        {[...entries].reverse().map((e) => (
          <div key={e.id} title={`${e.visited_on ? formatVisitDate(e.visited_on) : "undated"} · ${e.score ?? "—"}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto", width: 18 }}>
            <div style={{
              width: 12, borderRadius: 2, // design-exempt: sparkline bar corner (data-viz ink, not a chrome control)
              height: e.score != null ? `${(Number(e.score) / maxScore) * 40}px` : "2px",
              background: e.score != null ? "var(--accent-food)" : "var(--border-default)",
            }} />
          </div>
        ))}
      </div>
      {entries.map((e) => {
        const sameVisitOthers = dishesAtSamePlace.filter((d) => d.visit_id === e.visit_id && d.id !== e.id);
        return (
          <div key={e.id} style={{ padding: "6px 0", borderTop: "1px solid var(--border-default)", fontSize: FONT_SIZE.control }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{e.score != null ? `${formatScore(e.score)} / 10` : "Not scored"}</span>
              <span style={{ color: "var(--text-tertiary)" }}>{e.visited_on ? formatVisitDate(e.visited_on) : "Date unknown"}</span>
            </div>
            {e.price_cents != null && <div style={{ color: "var(--text-secondary)" }}>{formatCents(e.price_cents)}</div>}
            {e.note && <div style={{ color: "var(--text-secondary)" }}>{e.note}</div>}
            {sameVisitOthers.length > 0 && (
              <div style={{ color: "var(--text-tertiary)", marginTop: 2 }}>
                Also had: {sameVisitOthers.map((o) => o.name).join(", ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* The inline add/edit row — expands in place, never a dialog. Field order top to bottom (the
 * redesign's FIELD HIERARCHY): a "NEW DISH"/"EDIT DISH" label + close X, the dish name as the
 * page's one hero field, Course + Price sharing a row, the Score block, the Order-again block,
 * Note last. Enter commits (and, only when adding a NEW dish, reopens a blank row); Esc cancels. */
function DishEditRow({ initial, existingNames, openWishlistNames, onSave, onCancel, pending, isMobile }) {
  const [name, setName] = useState(initial?.name || "");
  const [course, setCourse] = useState(initial?.course || "");
  const [score, setScore] = useState(initial?.score != null ? Number(initial.score) : null);
  const [orderAgain, setOrderAgain] = useState(initial?.order_again || null);
  const [price, setPrice] = useState(initial?.price_cents != null ? (initial.price_cents / 100).toFixed(2) : "");
  const [note, setNote] = useState(initial?.note || "");
  const listId = `dish-name-suggestions-${initial?.id || "new"}`;
  const suggestions = [...new Set([...existingNames, ...openWishlistNames])];

  const reset = () => { setName(""); setCourse(""); setScore(null); setOrderAgain(null); setPrice(""); setNote(""); };

  const commit = async (andReopen) => {
    if (!name.trim()) return;
    const ok = await onSave({
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
      data-testid="dish-edit-row"
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); commit(!initial); }
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px", background: "var(--surface-raised)", border: "1px solid var(--accent-food)", borderRadius: RADIUS.lg, margin: "4px" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: FONT_SIZE.micro, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }} data-testid="dish-edit-heading">
          {initial ? "Edit dish" : "New dish"}
        </span>
        <button
          type="button" className="tap-target" onClick={onCancel} aria-label="Close" data-testid="dish-edit-close"
          style={{ border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 4, minWidth: 32, minHeight: 32 }} // design-exempt: a bare close-glyph needs to read clearly with no label beside it — above FONT_SIZE.control (12) by design
        >
          ✕
        </button>
      </div>

      {/* Dish name — the editor's hero field: large, transparent, no box, a 2px accent underline
          only. It shipped as a plain grey box identical to Note — the most important field looked
          exactly as important as the least. */}
      <input
        type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Dish name" list={listId}
        data-testid="dish-name-input" {...noAutofill("dish-title")} enterKeyHint="next" autoCapitalize="words"
        style={{
          width: "100%", boxSizing: "border-box", background: "transparent", border: "none",
          borderBottom: "2px solid var(--accent-food)", padding: "4px 2px",
          font: "inherit", fontSize: isMobile ? 20 : 19, fontWeight: 600, color: "var(--text-primary)",
        }}
      />
      <datalist id={listId}>
        {suggestions.map((n) => <option key={n} value={n} />)}
      </datalist>

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
        <div data-testid="dish-edit-buttons" style={{ position: "sticky", bottom: 0, background: "var(--surface-raised)", paddingTop: 4, display: "flex", gap: 8 }}>
          <button type="button" onClick={initial ? onCancel : () => commit(false)} data-testid={initial ? "dish-cancel-btn" : "dish-save-close-btn"} style={{
            flex: "0 0 auto", border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "0 16px", minHeight: 44,
            background: "transparent", color: "var(--text-secondary)", cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 600,
          }}>
            {initial ? "Cancel" : "Done"}
          </button>
          <button
            type="button" onClick={() => commit(!initial)} disabled={pending || !name.trim()} data-testid="dish-save-btn"
            style={{
              flex: 1, border: "none", borderRadius: RADIUS.md, padding: "0 12px", minHeight: 44, cursor: pending ? "default" : "pointer",
              background: "var(--accent-food)", color: "var(--on-accent-food)", font: "inherit", fontSize: 14, fontWeight: 700,
              opacity: pending || !name.trim() ? 0.6 : 1,
            }}
          >
            {initial ? "Save" : "Save & add another"}
          </button>
        </div>
      ) : (
        <div data-testid="dish-edit-buttons">
          <button
            type="button" onClick={() => commit(!initial)} disabled={pending || !name.trim()} data-testid="dish-save-btn"
            style={{
              width: "100%", border: "none", borderRadius: RADIUS.md, padding: "10px 0", minHeight: 44, cursor: pending ? "default" : "pointer",
              background: "var(--accent-food)", color: "var(--on-accent-food)", font: "inherit", fontSize: FONT_SIZE.display, fontWeight: 700,
              opacity: pending || !name.trim() ? 0.6 : 1,
            }}
          >
            {initial ? "Save" : "Save & add another"}
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
            <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", flex: "1 1 auto" }}>
              Enter saves{!initial ? " · starts another" : ""} · Esc cancels
            </span>
            {!initial && (
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

function DishKebabMenu({ row, hasHistory, onEdit, onToggleHistory, onDelete }) {
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
            {hasHistory && (
              <MenuItem data-testid="dish-row-history" onClick={() => { onToggleHistory(); close(); }}>History</MenuItem>
            )}
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
function DishDisplayRow({ row, open, onToggle, onOpenEdit, onDeleteDish, dishesAtSamePlace }) {
  const unscored = row.latestScore == null;
  const orderBadge = ORDER_AGAIN_OPTIONS.find((o) => o.value === row.order_again);
  const infoLine = unscored
    ? null
    : [COURSE_LABEL[row.course] || null, formatCents(row.price_cents), row.timesHad > 1 ? `had ${row.timesHad}×` : (row.note || null)]
        .filter(Boolean).join(" · ");

  return (
    <>
      <div
        data-testid="dish-row" data-dish-scored={unscored ? "false" : "true"} onClick={onOpenEdit} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") onOpenEdit(); }}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", cursor: "pointer", minHeight: 46,
          borderBottom: unscored ? DASHED_BORDER : "1px solid var(--border-default)",
        }}
      >
        <ScoreChip score={row.latestScore} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{row.name}</div>
          {unscored ? (
            <div style={{ fontSize: FONT_SIZE.label, color: "var(--accent-food-text)" }} data-testid="dish-unscored-caption">Not scored yet</div>
          ) : (
            infoLine && <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>{infoLine}</div>
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
          <DishKebabMenu
            row={row} hasHistory={row.history.length > 0} onEdit={onOpenEdit}
            onToggleHistory={onToggle} onDelete={onDeleteDish}
          />
        </span>
      </div>
      {open && <DishHistoryPanel row={row} dishesAtSamePlace={dishesAtSamePlace} />}
    </>
  );
}

const SORTS = {
  score: (a, b) => (Number(b.latestScore ?? -1) - Number(a.latestScore ?? -1)),
  name: (a, b) => a.name.localeCompare(b.name),
  price: (a, b) => (Number(b.price_cents ?? -1) - Number(a.price_cents ?? -1)),
  last: (a, b) => (b.visited_on || "").localeCompare(a.visited_on || ""),
};

export default function DishesSection({ dishesWithDate, visits, onSaveDish, onDeleteDish, pending, openWishlistNames = [] }) {
  const [sortKey, setSortKey] = useState("score");
  const [addingNew, setAddingNew] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [openHistoryKey, setOpenHistoryKey] = useState(null);
  const isMobile = useIsMobile();

  const rows = useMemo(() => dishRowsForTable(dishesWithDate), [dishesWithDate]);
  const sorted = useMemo(() => [...rows].sort(SORTS[sortKey] || SORTS.score), [rows, sortKey]);
  const orderEntries = useMemo(() => theOrderEntries(rows), [rows]);
  const orderTotal = theOrderTotalCents(orderEntries);
  const existingNames = useMemo(() => [...new Set(dishesWithDate.map((d) => d.name))], [dishesWithDate]);

  if (!visits || !visits.length) return null; // a place with zero visits has nothing to have had dishes at
  const targetVisitId = visits[0].id; // most recent visit — see file header for why

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

      <div style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.lg, overflow: "hidden" }}>
        {sorted.map((row) =>
          editingKey === row.key ? (
            <div key={row.key}>
              <DishEditRow
                initial={row} existingNames={existingNames} openWishlistNames={openWishlistNames}
                pending={pending} onCancel={() => setEditingKey(null)} isMobile={isMobile}
                onSave={(fields) => onSaveDish({ ...fields, id: row.id })}
              />
            </div>
          ) : (
            <DishDisplayRow
              key={row.key} row={row} dishesAtSamePlace={dishesWithDate}
              open={openHistoryKey === row.key}
              onToggle={() => setOpenHistoryKey((k) => (k === row.key ? null : row.key))}
              onOpenEdit={() => setEditingKey(row.key)}
              onDeleteDish={onDeleteDish}
            />
          )
        )}
        {addingNew ? (
          <DishEditRow
            existingNames={existingNames} openWishlistNames={openWishlistNames} pending={pending} isMobile={isMobile}
            onCancel={() => setAddingNew(false)}
            onSave={(fields) => onSaveDish({ ...fields, visit_id: targetVisitId })}
          />
        ) : (
          <button
            type="button" onClick={() => setAddingNew(true)} data-testid="food-add-dish-btn"
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
