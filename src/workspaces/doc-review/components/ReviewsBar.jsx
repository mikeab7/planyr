/* Reviews toolbar control (Document Review) — shared by the single-sheet viewer and
 * the stitcher. Shows an honest save badge and a dropdown to FILE the current review:
 * link it to a Project/Site, set discipline / item / revision / date (the name defaults
 * to "<Project> - <Item> - YYYY.MM.DD", each piece editable), start a new one, and open
 * or delete saved reviews. Self-contained — it fetches the project + review lists itself
 * when the menu opens. Cloud writes are RLS-scoped to the signed-in user.
 */
import { useEffect, useRef, useState } from "react";
import { listReviews, deleteReview, listProjects, composeTitle, DISCIPLINES } from "../lib/reviewStore.js";

const PAL = { ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)", accent: "var(--accent)", chromeInk: "var(--chrome-text)", chromeMuted: "var(--chrome-muted)" };

const BADGE = {
  saving:  { text: "Saving…", color: "#fbbf24", dot: "#f59e0b" },
  saved:   { text: "Saved ✓", color: "#86efac", dot: "#22c55e" },
  unsaved: { text: "Unsaved", color: "#fbbf24", dot: "#f59e0b" },
  local:   { text: "Not saved", color: "#9b9482", dot: "#9b9482" },
};

const fmtWhen = (s) => {
  try { return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch (_) { return ""; }
};

export default function ReviewsBar({ status = "local", signedIn = false, meta = {}, onMeta, onOpen, onNew }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);     // saved reviews (null = not loaded)
  const [projects, setProjects] = useState([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const reqRef = useRef(0); // in-flight token: a newer refresh supersedes an older slow one (B44)

  const refresh = async () => {
    const tok = ++reqRef.current;
    setBusy(true);
    try { const [r, p] = await Promise.all([listReviews(), listProjects()]); if (tok !== reqRef.current) return; setRows(r); setProjects(p); }
    finally { if (tok === reqRef.current) setBusy(false); }
  };

  useEffect(() => { // fetch the lists when the menu opens / auth flips (refresh is token-guarded)
    if (!open) return;
    if (signedIn) refresh(); else { setRows([]); setProjects([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, signedIn]);
  useEffect(() => { // outside-click to close — its own effect so it isn't rebound on every fetch (B44)
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const badge = BADGE[status] || BADGE.local;
  const fld = { width: "100%", padding: "5px 7px", fontSize: 12, fontFamily: "inherit", border: `1px solid ${PAL.line}`, borderRadius: 6, color: PAL.ink, marginTop: 4, boxSizing: "border-box", background: "#fff" };
  const lbl = { fontSize: 10, color: PAL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" };

  const onProject = (id) => { const p = projects.find((x) => x.id === id); onMeta?.("projectId", id || null); onMeta?.("project", p ? p.name : ""); };
  const del = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Delete this review and its stored PDFs? This can't be undone.")) return;
    await deleteReview(id);
    refresh();
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
      <span title="Save state" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: badge.color, fontWeight: 600, minWidth: 60, justifyContent: "flex-end" }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: badge.dot, flex: "none" }} />{badge.text}</span>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "6px 10px", fontSize: 11.5, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: "1px solid #2e2a23", background: "rgba(255,255,255,0.06)", color: PAL.chromeInk }}
      >Reviews ▾</button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 300, maxHeight: 460, overflowY: "auto", background: "#fff", border: `1px solid ${PAL.line}`, borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.25)", zIndex: 50, padding: 12, fontFamily: "system-ui, sans-serif", color: PAL.ink }}>
          {!signedIn && (
            <div style={{ fontSize: 11.5, color: "#b45309", lineHeight: 1.5, marginBottom: 10 }}>
              Sign in (in the Site Planner workspace) to save & file reviews to the cloud. Your work stays in memory until then.
            </div>
          )}

          <div style={lbl}>File this review</div>
          <select value={meta.projectId || ""} onChange={(e) => onProject(e.target.value)} style={fld}>
            <option value="">Unfiled (no project)</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={meta.discipline || ""} onChange={(e) => onMeta?.("discipline", e.target.value)} style={fld}>
            <option value="">Discipline…</option>
            {DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={meta.item || ""} placeholder="Item / type" onChange={(e) => onMeta?.("item", e.target.value)} style={fld} />
            <input value={meta.revision || ""} placeholder="Rev" onChange={(e) => onMeta?.("revision", e.target.value)} style={{ ...fld, width: 80 }} />
          </div>
          <input type="date" value={meta.docDate || ""} onChange={(e) => onMeta?.("docDate", e.target.value)} style={fld} />
          <div style={{ ...lbl, marginTop: 8 }}>Name</div>
          <input value={meta.title || ""} placeholder={composeTitle(meta)} onChange={(e) => onMeta?.("title", e.target.value)} style={fld} />

          <button onClick={() => { onNew?.(); setOpen(false); }} style={{ marginTop: 10, width: "100%", padding: "7px 10px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", borderRadius: 7, border: `1px solid ${PAL.accent}`, background: "#fff", color: PAL.accent }}>＋ New review</button>

          <div style={{ borderTop: `1px solid ${PAL.line}`, margin: "12px -12px 0", padding: "10px 12px 0" }}>
            <div style={lbl}>Saved reviews</div>
            {busy && <div style={{ fontSize: 11.5, color: PAL.muted, marginTop: 6 }}>Loading…</div>}
            {!busy && rows && rows.length === 0 && <div style={{ fontSize: 11.5, color: PAL.muted, marginTop: 6 }}>{signedIn ? "No saved reviews yet." : "—"}</div>}
            {!busy && rows && rows.map((r) => (
              <div key={r.id} onClick={() => { onOpen?.(r); setOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 6px", borderRadius: 7, cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fbf3ee")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "Untitled review"}</div>
                  <div style={{ fontSize: 10.5, color: PAL.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.kind === "stitch" ? "Stitched set" : "Single sheet"}{r.project ? ` · ${r.project}` : ""}{r.discipline ? ` · ${r.discipline}` : ""} · {fmtWhen(r.updated_at)}
                  </div>
                </div>
                <button onClick={(e) => del(e, r.id)} title="Delete review" style={{ flex: "none", border: "none", background: "transparent", color: "#b3361b", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 4 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
