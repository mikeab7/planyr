/* DishesSection — the place-detail "Dishes" block (B1873008): every dish rated at this place
 * (or manual pin), sortable, with an inline add/edit row (NO DIALOG BOX — this repo's own
 * house rule), "The order" (every dish worth getting again, with a copy-as-text button), and a
 * small per-dish history view.
 *
 * ⛔ INLINE EDITORS ONLY. Adding or editing a dish never opens a modal — the "+ Add a dish" ghost
 * row and every existing row both expand IN PLACE into the same DishEditRow, exactly the pattern
 * VisitPanel's own VisitCard already uses for editing a past visit.
 *
 * A NEW dish added from PLACE DETAIL (as opposed to under a specific visit in the visit editor)
 * attaches to the MOST RECENT visit at this place — `food_dishes.visit_id` is required (a dish
 * always belongs to some visit), and picking a specific visit for a place with many visits is out
 * of scope for this pass; the per-visit dish-adding flow (VisitForm's own dish rows) is the
 * precise way to log a dish against a PARTICULAR visit.
 */
import { useMemo, useState } from "react";
import ScoreMeter from "./ScoreMeter.jsx";
import { colorForRating, textColorForRating } from "../lib/ratingColor.js";
import { formatVisitDate } from "../lib/dateFormat.js";
import { dishRowsForTable, theOrderEntries, theOrderTotalCents, theOrderAsText, formatCents } from "../lib/dishAggregates.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

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

function fieldStyle() {
  return {
    width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8,
    border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)",
    font: "inherit", fontSize: 13, minHeight: 40,
  };
}

/* Order-again — a three-way segmented control, glyph AND fill (never colour alone — "no" is
 * neutral gray, never red; red stays reserved for genuine danger per this app's own colour rule). */
function OrderAgainControl({ value, onChange }) {
  return (
    <div role="group" aria-label="Order again" style={{ display: "flex", gap: 4 }}>
      {ORDER_AGAIN_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value} type="button" aria-pressed={active}
            onClick={() => onChange(active ? null : opt.value)}
            data-testid={`dish-order-again-${opt.value}`}
            style={{
              flex: 1, border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, cursor: "pointer",
              minHeight: 36, padding: "6px 4px", font: "inherit", fontSize: 12, fontWeight: 700,
              background: active ? (opt.value === "yes" ? "var(--accent-food)" : "var(--chrome-muted)") : "transparent",
              color: active ? (opt.value === "yes" ? "var(--on-accent-food)" : "var(--text-primary)") : "var(--text-secondary)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            }}
          >
            <span aria-hidden="true">{opt.glyph}</span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* One dish's history — every score over time as a small bar chart, every note with its date and
 * price, and what else was had at the same visit. Inline expansion, never a separate page/modal. */
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
              background: e.score != null ? (colorForRating(e.score) || "var(--accent-food)") : "var(--border-default)",
            }} />
          </div>
        ))}
      </div>
      {entries.map((e) => {
        const sameVisitOthers = dishesAtSamePlace.filter((d) => d.visit_id === e.visit_id && d.id !== e.id);
        return (
          <div key={e.id} style={{ padding: "6px 0", borderTop: "1px solid var(--border-default)", fontSize: FONT_SIZE.control }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{e.score != null ? `${Number(e.score)} / 10` : "Not rated"}</span>
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

/* The inline add/edit row — expands in place, never a dialog. Enter commits and (when adding a
 * fresh dish) reopens a blank row so several dishes can be logged back to back; Esc cancels. */
function DishEditRow({ initial, existingNames, openWishlistNames, onSave, onCancel, onDelete, pending }) {
  const [name, setName] = useState(initial?.name || "");
  const [course, setCourse] = useState(initial?.course || "");
  const [score, setScore] = useState(initial?.score != null ? Number(initial.score) : null);
  const [orderAgain, setOrderAgain] = useState(initial?.order_again || null);
  const [price, setPrice] = useState(initial?.price_cents != null ? (initial.price_cents / 100).toFixed(2) : "");
  const [note, setNote] = useState(initial?.note || "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
      style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", background: "var(--surface-raised)", border: "1px solid var(--accent-food)", borderRadius: RADIUS.lg, margin: "4px" }}
    >
      <input
        type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Dish name" list={listId} style={{ ...fieldStyle(), fontWeight: 700 }}
        data-testid="dish-name-input"
      />
      <datalist id={listId}>
        {suggestions.map((n) => <option key={n} value={n} />)}
      </datalist>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={course} onChange={(e) => setCourse(e.target.value)} style={{ ...fieldStyle(), flex: 1 }} data-testid="dish-course-select">
          {COURSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input
          type="number" step="0.01" min="0" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
          placeholder="Price" style={{ ...fieldStyle(), flex: 1 }} data-testid="dish-price-input"
        />
      </div>
      <ScoreMeter value={score} onChange={setScore} label="Dish score" />
      <OrderAgainControl value={orderAgain} onChange={setOrderAgain} />
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={fieldStyle()} data-testid="dish-note-input" />
      <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>Enter saves{!initial ? " and starts another" : ""} · Esc cancels</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => commit(!initial)} disabled={pending || !name.trim()} data-testid="dish-save-btn" style={{
          flex: 1, border: "none", borderRadius: RADIUS.md, padding: "10px 0", minHeight: 44, cursor: pending ? "default" : "pointer",
          background: "var(--accent-food)", color: "var(--on-accent-food)", font: "inherit", fontSize: FONT_SIZE.display, fontWeight: 700,
          opacity: pending || !name.trim() ? 0.6 : 1,
        }}>
          {initial ? "Save changes" : "Save & add another"}
        </button>
        <button type="button" onClick={onCancel} data-testid="dish-cancel-btn" style={{
          border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "10px 14px", minHeight: 44, cursor: "pointer",
          background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 13,
        }}>
          Cancel
        </button>
      </div>
      {initial && onDelete && (
        confirmingDelete ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Delete this dish?</span>
            <button type="button" onClick={() => onDelete(initial.id)} data-testid="dish-delete-confirm" style={{
              border: "1px solid var(--danger-border, var(--danger))", borderRadius: RADIUS.sm, padding: "6px 10px", minHeight: 36,
              background: "transparent", color: "var(--danger-text, var(--danger))", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 700,
            }}>
              Delete
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} style={{
              border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, padding: "6px 10px", minHeight: 36,
              background: "transparent", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontSize: 12,
            }}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmingDelete(true)} data-testid="dish-delete-btn" style={{
            alignSelf: "flex-start", border: "none", background: "none", color: "var(--danger-text, var(--danger))",
            cursor: "pointer", font: "inherit", fontSize: 12, padding: 0, textDecoration: "underline",
          }}>
            Delete dish
          </button>
        )
      )}
    </div>
  );
}

function DishDisplayRow({ row, open, onToggle, onOpenEdit }) {
  return (
    <>
      <div
        data-testid="dish-row" onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") onToggle(); }}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid var(--border-default)", cursor: "pointer", minHeight: 44 }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{row.name}</div>
          <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" }}>
            {[COURSE_LABEL[row.course] || null, row.timesHad > 1 ? `had ${row.timesHad}×` : null, row.visited_on ? `last ${formatVisitDate(row.visited_on)}` : null].filter(Boolean).join(" · ")}
          </div>
        </div>
        {row.price_cents != null && <span style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{formatCents(row.price_cents)}</span>}
        {row.order_again && (
          <span aria-hidden="true" title={`Order again: ${row.order_again}`} style={{
            fontSize: 12, fontWeight: 700, width: 20, textAlign: "center",
            color: row.order_again === "yes" ? "var(--accent-food)" : "var(--text-tertiary)",
          }}>
            {ORDER_AGAIN_OPTIONS.find((o) => o.value === row.order_again)?.glyph}
          </span>
        )}
        <span style={{
          display: "inline-block", minWidth: 34, textAlign: "center", borderRadius: RADIUS.sm, padding: "2px 6px", fontWeight: 700, fontSize: FONT_SIZE.control,
          background: row.latestScore != null ? colorForRating(row.latestScore) : "var(--surface-page)",
          color: row.latestScore != null ? textColorForRating(row.latestScore) : "var(--text-tertiary)",
          border: row.latestScore != null ? "none" : "1px solid var(--border-default)",
        }}>
          {row.latestScore != null ? Number(row.latestScore) : "—"}
        </span>
        <button
          type="button" onClick={(e) => { e.stopPropagation(); onOpenEdit(); }} aria-label={`Edit ${row.name}`}
          data-testid="dish-row-edit-btn"
          style={{ border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: FONT_SIZE.display, minWidth: 32, minHeight: 32, padding: 0 }}
        >
          ✎
        </button>
      </div>
      {open && <DishHistoryPanel row={row} dishesAtSamePlace={open.dishesAtSamePlace} />}
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
                pending={pending} onCancel={() => setEditingKey(null)}
                onSave={(fields) => onSaveDish({ ...fields, id: row.id })}
                onDelete={(id) => { onDeleteDish(id); setEditingKey(null); }}
              />
            </div>
          ) : (
            <DishDisplayRow
              key={row.key} row={row}
              open={openHistoryKey === row.key ? { dishesAtSamePlace: dishesWithDate } : null}
              onToggle={() => setOpenHistoryKey((k) => (k === row.key ? null : row.key))}
              onOpenEdit={() => setEditingKey(row.key)}
            />
          )
        )}
        {addingNew ? (
          <DishEditRow
            existingNames={existingNames} openWishlistNames={openWishlistNames} pending={pending}
            onCancel={() => setAddingNew(false)}
            onSave={(fields) => onSaveDish({ ...fields, visit_id: targetVisitId })}
          />
        ) : (
          <button
            type="button" onClick={() => setAddingNew(true)} data-testid="food-add-dish-btn"
            style={{
              display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent",
              padding: "11px 12px", minHeight: 44, cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 700,
              color: "var(--accent-food)",
            }}
          >
            + Add a dish
          </button>
        )}
      </div>
    </div>
  );
}
