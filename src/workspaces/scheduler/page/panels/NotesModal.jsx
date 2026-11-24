import { parseFlexDate } from "../../../../shared/schedule/engine/tasks.js";
import { NOW } from "../../../../shared/schedule/engine/calendar.js";
import { NOTE_SIZES } from "../grid/headers.jsx";
import { exposeToHarness } from "../harnessGlobals.js";

const { useState, useEffect, useRef } = React;



// ── NotesModal — per-task running log (B613 rebuild) ──────────────────
// A clean per-task running log. Each note is a two-column row: a compact M/D date in a fixed
// left rail (plain Schedule-purple text, click to edit) │ hairline divider │ the note body
// (click to edit in place). Newest first, no sort toggle. Add-at-top composer. Inline CRUD that
// never strands you — commit-on-Enter/blur SAVES and stays open; the panel closes ONLY on ✕ or a
// click that both STARTS and LANDS on the backdrop itself (defeats the old "editing dismisses the
// panel" bug + native-picker/portal clicks reaching the backdrop). All CRUD rides
// updateTask → setData, the same autosave/cloudSync path every task edit uses (B210/B212/B566).
const SCHED_ACCENT = "#7F77DD";        // Schedule module accent — chrome / solid fills only
const SCHED_ACCENT_TEXT = "#534AB7";   // AA-safe purple for small accent TEXT (the date) on white
const NOTE_RAIL_W = 54;

// Compact M/D for the rail — DISPLAY ONLY. The stored value stays a real, sortable ISO date
// ("YYYY-MM-DD"); this just trims it so the running log reads cleanly. A bare M/D can't tell the
// same day apart across years — acceptable for now (add a 2-digit year later only if it matters).
const noteShortMD = s => { if (!s) return ""; const [_y, m, d] = String(s).split("-"); return (m && d) ? `${+m}/${+d}` : ""; };
// Normalize any stored note date to the ISO a native <input type=date> needs. Every date the app
// writes is already ISO (parseFlexDate / fdLocal output); this is just defensive for legacy values.
const noteISO = s => parseFlexDate(s) || "";

// Shared inline-editor styles. The native date input pops wider than the compact rail while
// editing — that's fine (spec): the resting display stays compact, only the editor is wide.
const noteDateInputStyle = {
  width: 132, background: "var(--bg)", border: `1px solid ${SCHED_ACCENT}`, borderRadius: 5,
  padding: "3px 6px", fontSize: 12, fontFamily: "inherit", outline: "none",
  color: "var(--txt)", boxSizing: "border-box",
};
const noteDateBtnStyle = {
  background: "transparent", border: "none", padding: "0 2px", cursor: "pointer",
  color: SCHED_ACCENT_TEXT, fontWeight: 600, fontSize: 12, fontFamily: "inherit",
  lineHeight: 1.4, whiteSpace: "nowrap",
};

// One note row — MODULE SCOPE, never defined inside NotesModal: an inner-defined component
// remounts every render and drops the caret/focus (the B247/B258 trap). Fully controlled by the
// parent, so the editable text/date inputs keep focus across the parent's re-renders.
function NoteRow({ note, bodyFs, editingText, editingDate, textValue, dateValue,
                   onTextChange, onDateChange, onStartText, onStartDate, onCommit, onCancel, onDelete }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", alignItems: "flex-start", gap: 10,
        padding: "9px 2px", borderBottom: "1px solid var(--bd)", position: "relative" }}>
      {/* left rail — compact date, click to edit (native picker) */}
      <div style={{ minWidth: NOTE_RAIL_W, flexShrink: 0, paddingTop: 1 }}>
        {editingDate
          ? <input type="date" autoFocus value={dateValue}
              onChange={e => onDateChange(e.target.value)}
              onBlur={onCommit}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onCommit(); }
                                if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
              style={noteDateInputStyle} />
          : <button onClick={() => onStartDate()} style={noteDateBtnStyle}
              title="Click to change the date">{noteShortMD(note.date) || "—"}</button>}
      </div>
      {/* hairline divider */}
      <div style={{ width: 1, alignSelf: "stretch", background: "var(--bd)", flexShrink: 0 }} />
      {/* body — click to edit in place */}
      <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
        {editingText
          ? <textarea autoFocus value={textValue}
              onChange={e => onTextChange(e.target.value)}
              onBlur={onCommit}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); onCommit(); }
                                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } }}
              style={{ width: "100%", background: "var(--bg)", border: `1px solid ${SCHED_ACCENT}`,
                borderRadius: 5, padding: "6px 8px", color: "var(--txt)", fontSize: bodyFs,
                lineHeight: 1.55, fontFamily: "inherit", resize: "vertical", minHeight: 46, outline: "none" }} />
          : <div onClick={() => onStartText()}
              style={{ color: "var(--txt)", fontSize: bodyFs, lineHeight: 1.55, cursor: "text",
                whiteSpace: "pre-wrap", wordBreak: "break-word", minHeight: 18 }}>{note.text}</div>}
      </div>
      {/* delete — reveals on row hover */}
      {!editingText && !editingDate && (
        <span onClick={() => onDelete()} title="Delete note"
          style={{ position: "absolute", top: 8, right: 2, cursor: "pointer", fontSize: 13, lineHeight: 1,
            color: hover ? "#dc2626" : "transparent", transition: "color .12s", userSelect: "none" }}>✕</span>
      )}
    </div>
  );
}

// The add-at-top composer — also MODULE SCOPE. Body textarea always live; the date defaults to
// today and is click-to-edit like a row. Enter (no Shift) adds; the note prepends (today = newest
// under the descending sort) and the composer clears for the next entry.
function AddNoteComposer({ text, onText, dateISO, onDate, onAdd, bodyRef }) {
  const [dateEdit, setDateEdit] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 2px 12px" }}>
      <div style={{ minWidth: NOTE_RAIL_W, flexShrink: 0, paddingTop: 6 }}>
        {dateEdit
          ? <input type="date" autoFocus value={dateISO}
              onChange={e => onDate(e.target.value)}
              onBlur={() => setDateEdit(false)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setDateEdit(false); } }}
              style={noteDateInputStyle} />
          : <button onClick={() => setDateEdit(true)} style={noteDateBtnStyle}
              title="Click to change the date">{noteShortMD(dateISO) || "—"}</button>}
      </div>
      <div style={{ width: 1, alignSelf: "stretch", background: "var(--bd)", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
        <textarea ref={bodyRef} value={text} onChange={e => onText(e.target.value)}
          placeholder="Add a note…"
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); onAdd(); } }}
          style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--bd2)", borderRadius: 5,
            padding: "7px 9px", color: "var(--txt)", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit",
            resize: "vertical", minHeight: 44, outline: "none", transition: "border-color .15s" }}
          onFocus={e => e.target.style.borderColor = SCHED_ACCENT}
          onBlur={e => e.target.style.borderColor = "var(--bd2)"} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={() => onAdd()}
            style={{ padding: "5px 16px", background: SCHED_ACCENT, color: "#fff", border: "none",
              borderRadius: 6, fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
            Add note
          </button>
        </div>
      </div>
    </div>
  );
}

export function NotesModal({ task, projectId, updateTask, onClose, initChar }) {
  const [draftText, setDraftText] = useState(() => initChar || "");
  const [draftDate, setDraftDate] = useState(() => NOW);   // ISO; defaults to today
  const [edit, setEdit] = useState(null);                  // { id, field:'text'|'date' } | null
  const [editText, setEditText] = useState("");
  const [editDate, setEditDate] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Body text size honors the per-note stamp (set from the Notes column-header control), else the
  // saved default, else Small — so the existing "Text size" preference keeps working.
  const defSize = (() => { try { return localStorage.getItem("planar_noteSize") || "sm"; } catch { return "sm"; } })();
  const noteFs = n => NOTE_SIZES.find(s => s.k === (n.size || defSize))?.px ?? 13;

  const taRef = useRef(null);
  const backdropRef = useRef(null);
  const downOnBackdropRef = useRef(false);
  const editRef = useRef(null);
  useEffect(() => { editRef.current = edit; }, [edit]);

  // Focus the composer on open; caret at end so an initChar keystroke continues seamlessly.
  useEffect(() => {
    const ta = taRef.current;
    if (ta) { const len = ta.value.length; ta.focus(); ta.selectionStart = ta.selectionEnd = len; }
  }, []);

  // Escape cancels an active inline edit; otherwise closes the panel. Capture phase so it wins
  // over the inputs' own handlers — but it only CLOSES when nothing is being edited, so a stray
  // Escape while editing a note can never dismiss the whole panel.
  useEffect(() => {
    const handler = e => {
      if (e.key !== "Escape") return;
      // Escape backs out one level: cancel an active row edit → close a composer date-picker →
      // else dismiss the panel. Never dismiss the panel out from under an open inline editor.
      if (editRef.current) { e.preventDefault(); e.stopPropagation(); editRef.current = null; setEdit(null); return; }
      const ae = document.activeElement;
      if (ae && ae.tagName === "INPUT" && ae.type === "date" && backdropRef.current && backdropRef.current.contains(ae)) return;
      onClose();
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const notes = task.notes || [];
  // Descending by parsed date (newest first); stable tiebreak on id so same-day notes hold order.
  const sorted = [...notes].sort((a, b) => {
    const da = noteISO(a.date) || "", db = noteISO(b.date) || "";
    if (da !== db) return da < db ? 1 : -1;
    return (b.id || 0) - (a.id || 0);
  });

  const addDraft = () => {
    const v = (draftText || "").trim();
    if (!v) return;                                   // empty draft → nothing persisted
    const iso = noteISO(draftDate) || NOW;
    updateTask(task.id, { notes: [...notes, { id: Date.now(), date: iso, text: v }] }, projectId);
    setDraftText("");
    setDraftDate(NOW);
    if (taRef.current) taRef.current.focus();
  };

  const startText = n => { editRef.current = { id: n.id, field: "text" }; setEdit({ id: n.id, field: "text" }); setEditText(n.text || ""); };
  const startDate = n => { editRef.current = { id: n.id, field: "date" }; setEdit({ id: n.id, field: "date" }); setEditDate(noteISO(n.date) || NOW); };
  const cancelEdit = () => { editRef.current = null; setEdit(null); };
  const commitEdit = () => {
    const cur = editRef.current;
    if (!cur) return;                                 // guard re-entrant blur (Enter → setEdit(null) → blur)
    editRef.current = null;
    setEdit(null);
    const n = (task.notes || []).find(x => x.id === cur.id);
    if (!n) return;
    if (cur.field === "text") {
      const v = editText.trim();                      // empty edit leaves the note unchanged (never silently wipes)
      if (v && v !== n.text) updateTask(task.id, { notes: notes.map(x => x.id === cur.id ? { ...x, text: v } : x) }, projectId);
    } else {
      const iso = noteISO(editDate);
      if (iso && iso !== n.date) updateTask(task.id, { notes: notes.map(x => x.id === cur.id ? { ...x, date: iso } : x) }, projectId);
    }
  };

  const del = id => { if (editRef.current && editRef.current.id === id) { editRef.current = null; setEdit(null); } updateTask(task.id, { notes: notes.filter(n => n.id !== id) }, projectId); };
  const clearAll = () => { updateTask(task.id, { notes: [] }, projectId); setConfirmClear(false); setMenuOpen(false); };

  return (
    <div ref={backdropRef}
      onMouseDown={e => { downOnBackdropRef.current = (e.target === backdropRef.current); }}
      onClick={e => { const hit = e.target === backdropRef.current && downOnBackdropRef.current; downOnBackdropRef.current = false; if (hit) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "#00000090", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onMouseDown={e => e.stopPropagation()}
        style={{ background: "var(--bg)", border: "1px solid var(--bd2)", borderTop: `2px solid ${SCHED_ACCENT}`,
          borderRadius: 8, width: 560, maxWidth: "94vw", maxHeight: "78vh",
          display: "flex", flexDirection: "column", boxShadow: "0 12px 40px rgba(0,0,0,.22)" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          padding: "16px 18px 12px", borderBottom: "1px solid var(--bd)" }}>
          <div>
            <div style={{ color: SCHED_ACCENT_TEXT, fontWeight: 700, fontSize: 10, letterSpacing: ".08em", marginBottom: 3 }}>NOTES</div>
            <div style={{ color: "var(--txt)", fontSize: 14, fontWeight: 600 }}>{task.name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ position: "relative" }}>
              {menuOpen && <div style={{ position: "fixed", inset: 0, zIndex: 998 }} onClick={() => { setMenuOpen(false); setConfirmClear(false); }} />}
              <button onClick={() => { setMenuOpen(o => !o); setConfirmClear(false); }}
                style={{ background: menuOpen ? "var(--surf)" : "transparent", border: "none", cursor: "pointer",
                  borderRadius: 5, padding: "3px 7px", fontSize: 16, lineHeight: 1, color: "var(--mut)", fontFamily: "inherit" }}>···</button>
              {menuOpen && (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--bg)",
                  border: "1px solid var(--bd2)", borderRadius: 8, boxShadow: "0 4px 18px rgba(0,0,0,.14)",
                  zIndex: 999, minWidth: 200, padding: 6 }}>
                  {notes.length === 0
                    ? <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--mut)" }}>No notes yet.</div>
                    : confirmClear
                      ? <div style={{ padding: "4px 6px" }}>
                          <div style={{ fontSize: 12, color: "var(--txt)", marginBottom: 8 }}>Delete all {notes.length} notes?</div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={clearAll} style={{ flex: 1, padding: "6px 0", background: "#dc2626", color: "#fff", border: "none", borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Delete all</button>
                            <button onClick={() => setConfirmClear(false)} style={{ flex: 1, padding: "6px 0", background: "var(--surf)", color: "var(--txt)", border: "1px solid var(--bd2)", borderRadius: 5, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                          </div>
                        </div>
                      : <div onClick={() => setConfirmClear(true)}
                          style={{ padding: "8px 10px", cursor: "pointer", fontSize: 12, color: "#dc2626", borderRadius: 5 }}
                          onMouseEnter={e => e.currentTarget.style.background = "#fff5f5"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>Clear all notes</div>}
                </div>
              )}
            </div>
            <span onClick={onClose} title="Close"
              style={{ color: "var(--mut)", cursor: "pointer", fontSize: 17, lineHeight: 1, padding: "2px 4px" }}>✕</span>
          </div>
        </div>

        {/* add-at-top composer */}
        <div style={{ padding: "0 18px", borderBottom: "1px solid var(--bd)" }}>
          <AddNoteComposer text={draftText} onText={setDraftText} dateISO={draftDate} onDate={setDraftDate} onAdd={addDraft} bodyRef={taRef} />
        </div>

        {/* running log — newest first */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 18px 6px" }}>
          {sorted.length === 0
            ? <div style={{ color: "var(--mut)", fontSize: 13, textAlign: "center", padding: "28px 0" }}>No notes yet — add one above.</div>
            : sorted.map(n => (
                <NoteRow key={n.id} note={n} bodyFs={noteFs(n)}
                  editingText={!!edit && edit.id === n.id && edit.field === "text"}
                  editingDate={!!edit && edit.id === n.id && edit.field === "date"}
                  textValue={editText} dateValue={editDate}
                  onTextChange={setEditText} onDateChange={setEditDate}
                  onStartText={() => startText(n)} onStartDate={() => startDate(n)}
                  onCommit={commitEdit} onCancel={cancelEdit} onDelete={() => del(n.id)} />
              ))}
        </div>
      </div>
    </div>
  );
}

// harness compatibility — the old classic-script page made every top-level binding a global, and the ui-audit / e2e
// drivers call them by bare name from page.evaluate (GanttView, buildGanttSVG, COLS, showToast, …). Same names, same values.
exposeToHarness({
  SCHED_ACCENT: [() => SCHED_ACCENT],
  SCHED_ACCENT_TEXT: [() => SCHED_ACCENT_TEXT],
  NOTE_RAIL_W: [() => NOTE_RAIL_W],
  noteShortMD: [() => noteShortMD],
  noteISO: [() => noteISO],
  noteDateInputStyle: [() => noteDateInputStyle],
  noteDateBtnStyle: [() => noteDateBtnStyle],
  NoteRow: [() => NoteRow],
  AddNoteComposer: [() => AddNoteComposer],
  NotesModal: [() => NotesModal],
});
