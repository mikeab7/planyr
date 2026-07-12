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

// The save chip that used to live here was retired (NEW-1): the save/sync state is now
// shown once, app-wide, by the shared CloudSyncBadge — in AppHeader Row 1 for the single
// sheet viewer, and in the Stitcher's own toolbar. So ReviewsBar is purely the filing
// control now (link to a project, set discipline/item/revision, open/delete reviews) and
// no longer renders a second, competing save indicator.

const fmtWhen = (s) => {
  try { return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch (_) { return ""; }
};

export default function ReviewsBar({ signedIn = false, meta = {}, onMeta, onOpen, onNew }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);     // saved reviews (null = not loaded)
  const [projects, setProjects] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pendingDel, setPendingDel] = useState(null); // inline two-step delete arm (NEW-F3 — no window.confirm)
  const ref = useRef(null);
  const reqRef = useRef(0); // in-flight token: a newer refresh supersedes an older slow one (B44)

  const refresh = async () => {
    const tok = ++reqRef.current;
    setBusy(true);
    try { const [r, p] = await Promise.all([listReviews(), listProjects()]); if (tok !== reqRef.current) return; setRows(r); setProjects(p); }
    finally { if (tok === reqRef.current) setBusy(false); }
  };

  useEffect(() => { // fetch the lists when the menu opens / auth flips (refresh is token-guarded)
    if (!open) { setPendingDel(null); return; } // closing the menu disarms any pending delete confirm
    if (signedIn) refresh(); else { setRows([]); setProjects([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, signedIn]);
  useEffect(() => { // outside-click to close — its own effect so it isn't rebound on every fetch (B44)
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const fld = { width: "100%", padding: "5px 7px", fontSize: 12, fontFamily: "inherit", border: `1px solid ${PAL.line}`, borderRadius: 6, color: PAL.ink, marginTop: 4, boxSizing: "border-box", background: "var(--surface-raised)" };
  const lbl = { fontSize: 10, color: PAL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" };

  const onProject = (id) => { const p = projects.find((x) => x.id === id); onMeta?.("projectId", id || null); onMeta?.("project", p ? p.name : ""); };
  // Inline two-step delete (NEW-F3): first click arms the row, second confirms — the
  // window.confirm dialog is gone (owner rule: no dialog-box edits/confirms). The delete
  // itself is SOFT (Recently deleted, ~30-day restore in the Library), so the light inline
  // confirm matches the stakes.
  const del = async (e, id) => {
    e.stopPropagation();
    if (pendingDel !== id) { setPendingDel(id); return; }
    setPendingDel(null);
    await deleteReview(id);
    refresh();
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "6px 10px", fontSize: 11.5, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)", color: PAL.chromeInk }}
      >Reviews ▾</button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, width: 300, maxHeight: 460, overflowY: "auto", background: "var(--surface-raised)", border: `1px solid ${PAL.line}`, borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.25)", zIndex: 50, padding: 12, fontFamily: "system-ui, sans-serif", color: PAL.ink }}>
          {!signedIn && (
            <div style={{ fontSize: 11.5, color: "var(--warn-text)", lineHeight: 1.5, marginBottom: 10 }}>
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

          <button onClick={() => { onNew?.(); setOpen(false); }} style={{ marginTop: 10, width: "100%", padding: "7px 10px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", borderRadius: 7, border: `1px solid ${PAL.accent}`, background: "var(--surface-raised)", color: PAL.accent }}>＋ New review</button>

          <div style={{ borderTop: `1px solid ${PAL.line}`, margin: "12px -12px 0", padding: "10px 12px 0" }}>
            <div style={lbl}>Saved reviews</div>
            {busy && <div style={{ fontSize: 11.5, color: PAL.muted, marginTop: 6 }}>Loading…</div>}
            {!busy && rows && rows.length === 0 && <div style={{ fontSize: 11.5, color: PAL.muted, marginTop: 6 }}>{signedIn ? "No saved reviews yet." : "—"}</div>}
            {!busy && rows && rows.map((r) => (
              <div key={r.id} onClick={() => { onOpen?.(r); setOpen(false); }}
                role="button" tabIndex={0} aria-label={`Open ${r.title || "untitled review"}`}
                onKeyDown={(e) => { if (e.target !== e.currentTarget) return; /* a child button (delete confirm ✓/✕) handles its own Enter/Space — the row must not hijack it and open the review mid-confirm */ if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(r); setOpen(false); } }} /* B531: keyboard-reachable row */
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 6px", borderRadius: 7, cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-ghost)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "Untitled review"}</div>
                  <div style={{ fontSize: 10.5, color: PAL.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.kind === "stitch" ? "Stitched set" : "Single sheet"}{r.project ? ` · ${r.project}` : ""}{r.discipline ? ` · ${r.discipline}` : ""} · {fmtWhen(r.updated_at)}
                  </div>
                </div>
                {pendingDel === r.id ? (
                  <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: PAL.muted, fontWeight: 700, whiteSpace: "nowrap" }}
                    onClick={(e) => e.stopPropagation()}>
                    Move to Recently deleted?
                    <button onClick={(e) => del(e, r.id)} title="Yes — restorable ~30 days from the Library" style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 2 }}>✓</button>
                    <button onClick={(e) => { e.stopPropagation(); setPendingDel(null); }} title="Cancel" style={{ border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", fontSize: 13, padding: 2 }}>✕</button>
                  </span>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); setPendingDel(r.id); }} title="Delete (moves to Recently deleted)" style={{ flex: "none", border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 4 }}>×</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
