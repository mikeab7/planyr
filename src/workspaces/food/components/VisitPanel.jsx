/* VisitPanel — click a pin (or drop a new one), log what you had, rate it, note the cost.
 * A right-side panel, never a dialog box. Shows every past visit at this place first (the
 * "click an existing restaurant" convenience the brief asks for), then a form to add another.
 */
import { useState } from "react";

const STAR = "★";
const STAR_EMPTY = "☆";

function Stars({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2 }} role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n} type="button" onClick={() => onChange(n === value ? null : n)}
          aria-pressed={n <= (value || 0)} title={`${n} star${n > 1 ? "s" : ""}`}
          style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: 2, color: "var(--warn-text)" }}
        >
          {n <= (value || 0) ? STAR : STAR_EMPTY}
        </button>
      ))}
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
  const [cost, setCost] = useState("");
  const [visitedOn, setVisitedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [whatIHad, setWhatIHad] = useState("");
  const [notes, setNotes] = useState("");
  const [wouldReturn, setWouldReturn] = useState(null);

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      rating,
      cost: cost === "" ? null : Number(cost),
      visited_on: visitedOn || null,
      what_i_had: whatIHad || null,
      notes: notes || null,
      would_return: wouldReturn,
    });
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 0" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
        Rating
        <Stars value={rating} onChange={setRating} />
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
            background: wouldReturn === true ? "var(--accent-food, #E2572B)" : "transparent",
            color: wouldReturn === true ? "#fff" : "var(--text-primary)", font: "inherit", fontSize: 12, fontWeight: 700 }}>
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
          background: "var(--accent-food, #E2572B)", color: "#fff", font: "inherit", fontSize: 13, fontWeight: 700,
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

function VisitRow({ visit, onDelete }) {
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--border-default)", fontSize: 12.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ color: "var(--warn-text)" }}>
          {visit.rating ? STAR.repeat(visit.rating) + STAR_EMPTY.repeat(5 - visit.rating) : "—"}
        </span>
        <span style={{ color: "var(--text-tertiary)" }}>{visit.visited_on || ""}</span>
      </div>
      {visit.what_i_had && <div style={{ marginTop: 2 }}>{visit.what_i_had}</div>}
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

export default function VisitPanel({
  title, subtitle, pastVisits, onClose, onSubmitVisit, onDeleteVisit, pending, error,
  manualNameEditable, manualName, onManualNameChange,
}) {
  const [adding, setAdding] = useState((pastVisits || []).length === 0);

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
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{title}</div>
        )}
        <button type="button" onClick={onClose} aria-label="Close" style={{
          border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 16, padding: 2,
        }}>
          ✕
        </button>
      </div>
      {subtitle && <div style={{ marginTop: 2, fontSize: 12, color: "var(--text-secondary)" }}>{subtitle}</div>}

      {error && (
        <div role="alert" style={{ marginTop: 8, padding: "6px 10px", borderRadius: 8, background: "var(--danger-bg, rgba(220,38,38,0.1))", color: "var(--danger-text, var(--danger))", fontSize: 12 }}>
          {error}
        </div>
      )}

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
