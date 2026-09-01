/* B1020930 — the org-scoped agenda body. Renders BESIDE the shared AppHeader (never inside the
 * embedded Gantt iframe — see Scheduler.jsx's `org` branch), so this file has zero knowledge of
 * `public/sequence/index.html` and never will.
 *
 * Every field on a row is a native control doing double duty as BOTH its display and its editor
 * (a date input, a `<select>`) — no click-to-edit state machine, no dialog box, and it writes
 * through on every change (B400176's "the stored copy is never staler than the screen"
 * discipline, applied here rather than re-argued: these lists are small, so a write per edit is
 * negligible — Notes' own measurement of the identical pattern is in that file's header).
 */
import { useEffect, useMemo, useState } from "react";
import { Button, IconButton, RADIUS } from "../../../shared/ui/controls.jsx";
import {
  RECURRENCE_PRESETS, presetIdFor, recurrenceForPresetId, todayISO, bucketFor,
  createAgendaItem, toggleAgendaItem, updateAgendaItem, deleteAgendaItem, sortAgendaItems,
} from "../lib/agendaModel.js";
import { readAgenda, writeAgenda } from "../lib/agendaStore.js";

const BUCKET_LABEL = { overdue: "Overdue", today: "Today", upcoming: "Upcoming", someday: "Someday" };
const BUCKET_ORDER = ["overdue", "today", "upcoming", "someday"];

function rowStyle() {
  return {
    display: "flex", alignItems: "center", gap: 8, padding: "6px 4px",
    borderBottom: "1px solid var(--border-default)",
  };
}

function TextField({ value, onCommit, placeholder }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <input
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() && draft !== value) onCommit(draft.trim()); else setDraft(value); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); }
      }}
      style={{
        flex: "1 1 auto", minWidth: 0, height: 28, padding: "0 8px", borderRadius: RADIUS.control,
        border: "1px solid var(--border-default)", background: "var(--surface-page)",
        color: "var(--text-primary)", font: "inherit", fontSize: 13,
      }}
    />
  );
}

function AgendaRow({ item, onToggle, onEdit, onDelete }) {
  return (
    <div style={rowStyle()} data-testid={`agenda-row-${item.id}`}>
      <input
        type="checkbox"
        checked={item.done}
        onChange={onToggle}
        aria-label={item.done ? "Mark not done" : "Mark done"}
        style={{ flex: "none", width: 16, height: 16, cursor: "pointer" }}
      />
      <TextField value={item.text} onCommit={(text) => onEdit({ text })} placeholder="Untitled item" />
      <input
        type="date"
        value={item.date || ""}
        onChange={(e) => onEdit({ date: e.target.value || null })}
        style={{
          flex: "0 0 auto", height: 28, padding: "0 6px", borderRadius: RADIUS.control,
          border: "1px solid var(--border-default)", background: "var(--surface-page)",
          color: "var(--text-primary)", font: "inherit", fontSize: 12,
        }}
      />
      <select
        value={presetIdFor(item.recurrence)}
        onChange={(e) => onEdit({ recurrence: recurrenceForPresetId(e.target.value) })}
        title="How often this repeats"
        style={{
          flex: "0 0 auto", height: 28, padding: "0 6px", borderRadius: RADIUS.control,
          border: "1px solid var(--border-default)", background: "var(--surface-page)",
          color: "var(--text-secondary)", font: "inherit", fontSize: 12,
        }}
      >
        {RECURRENCE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <IconButton size={26} onClick={onDelete} title="Delete" aria-label="Delete">×</IconButton>
    </div>
  );
}

/** `scope` is the account id (or "local" signed out) — one list per account, never per project;
 *  this view only ever renders when the app is at org scope. */
export default function AgendaView({ scope }) {
  const [items, setItems] = useState(() => readAgenda(scope));
  const [showDone, setShowDone] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftRecurrence, setDraftRecurrence] = useState("none");

  // A scope change (sign-in/out, or account switch) re-seeds from THAT account's own list —
  // never carries the previous account's items over in memory.
  useEffect(() => { setItems(readAgenda(scope)); }, [scope]);

  const persist = (next) => { setItems(next); writeAgenda(next, scope); };

  const addItem = () => {
    if (!draftText.trim()) return;
    const item = createAgendaItem({ text: draftText, date: draftDate || null, recurrence: recurrenceForPresetId(draftRecurrence) });
    persist([...items, item]);
    setDraftText(""); setDraftDate(""); setDraftRecurrence("none");
  };

  const today = useMemo(() => todayISO(), []);
  const open = useMemo(() => sortAgendaItems(items.filter((it) => !it.done)), [items]);
  const done = useMemo(() => sortAgendaItems(items.filter((it) => it.done)), [items]);
  const buckets = useMemo(() => {
    const g = { overdue: [], today: [], upcoming: [], someday: [] };
    for (const it of open) g[bucketFor(it.date, today)].push(it);
    return g;
  }, [open, today]);

  return (
    <div data-testid="agenda-view" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 20px", background: "var(--surface-page)" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Agenda</h1>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          Operational items that aren't tied to any one project — dated, and can repeat. Not a
          project schedule: no dependencies, no roll-ups.
        </p>

        {/* Add row */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18, alignItems: "center" }}>
          <input
            type="text"
            data-testid="agenda-add-text"
            value={draftText}
            placeholder="Submit expenses, meet the BD contact…"
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
            style={{
              flex: "1 1 auto", minWidth: 0, height: 32, padding: "0 10px", borderRadius: RADIUS.control,
              border: "1px solid var(--border-default)", background: "var(--surface-raised)",
              color: "var(--text-primary)", font: "inherit", fontSize: 13,
            }}
          />
          <input
            type="date"
            data-testid="agenda-add-date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            style={{
              flex: "0 0 auto", height: 32, padding: "0 8px", borderRadius: RADIUS.control,
              border: "1px solid var(--border-default)", background: "var(--surface-raised)",
              color: "var(--text-primary)", font: "inherit", fontSize: 13,
            }}
          />
          <select
            data-testid="agenda-add-recurrence"
            value={draftRecurrence}
            onChange={(e) => setDraftRecurrence(e.target.value)}
            style={{
              flex: "0 0 auto", height: 32, padding: "0 8px", borderRadius: RADIUS.control,
              border: "1px solid var(--border-default)", background: "var(--surface-raised)",
              color: "var(--text-secondary)", font: "inherit", fontSize: 13,
            }}
          >
            {RECURRENCE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <Button size="md" data-testid="agenda-add-submit" onClick={addItem} accent="var(--accent-schedule)" onAccent="var(--on-accent-schedule)">＋ Add</Button>
        </div>

        {items.length === 0 && (
          <p data-testid="agenda-empty" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Nothing here yet. Add a line above — it's visible to your whole organization, in
            every project.
          </p>
        )}

        {BUCKET_ORDER.filter((b) => buckets[b].length > 0).map((b) => (
          <div key={b} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: b === "overdue" ? "var(--danger-text)" : "var(--text-secondary)", margin: "0 0 4px" }}>
              {BUCKET_LABEL[b]} · {buckets[b].length}
            </div>
            {buckets[b].map((it) => (
              <AgendaRow
                key={it.id}
                item={it}
                onToggle={() => persist(items.map((x) => (x.id === it.id ? toggleAgendaItem(x) : x)))}
                onEdit={(patch) => persist(updateAgendaItem(items, it.id, patch))}
                onDelete={() => persist(deleteAgendaItem(items, it.id))}
              />
            ))}
          </div>
        ))}

        {done.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              data-testid="agenda-toggle-done"
              onClick={() => setShowDone((v) => !v)}
              style={{
                border: "none", background: "none", padding: 0, font: "inherit", fontSize: 12,
                fontWeight: 650, color: "var(--text-secondary)", cursor: "pointer",
              }}
            >{showDone ? "▾" : "▸"} Done · {done.length}</button>
            {showDone && done.map((it) => (
              <AgendaRow
                key={it.id}
                item={it}
                onToggle={() => persist(items.map((x) => (x.id === it.id ? toggleAgendaItem(x) : x)))}
                onEdit={(patch) => persist(updateAgendaItem(items, it.id, patch))}
                onDelete={() => persist(deleteAgendaItem(items, it.id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
