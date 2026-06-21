/* Project Library (B14) — a browseable file explorer for Document Review.
 *
 * Project (Site/Project record, with a lifecycle-status badge) → discipline folder →
 * files newest-first → click to open in the viewer / stitcher. Drag-drop a PDF onto a
 * project (files under "Other") or a discipline folder to file it there. Reuses the
 * existing Supabase backend; reads the project list + status from the Site Planner's
 * sites (one source of truth) and the file index from doc_reviews. Self-contained.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { listProjects, listReviews, fileNewReview, setProjectStatus, deleteReview, DISCIPLINES, STATUSES, STATUS_META } from "../lib/reviewStore.js";

const PAL = { paper: "var(--surface-raised)", ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)", accent: "var(--accent)" };
// Canonical status palette via CSS vars (B234/B277): matches the rest of the app and
// themes live (light↔dark). Replaces the old local drift (#d97706/#15803d/…).
const STATUS_COLOR = { pursuit: "var(--status-pursuit)", active: "var(--status-active)", onhold: "var(--status-onhold)", complete: "var(--status-complete)", dead: "var(--status-dead)" };
const UNFILED = "__unfiled__";

const discOf = (r) => r.discipline || "Other";
const fileTime = (r) => (r.doc_date ? new Date(r.doc_date).getTime() : 0) || new Date(r.updated_at || 0).getTime();
const fmtDate = (r) => { const s = r.doc_date || r.updated_at; try { return s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""; } catch (_) { return ""; } };

export default function ProjectLibrary({ open, onClose, onOpenReview, signedIn = false }) {
  const [projects, setProjects] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [expanded, setExpanded] = useState({});   // projectId -> bool
  const [openDisc, setOpenDisc] = useState({});    // `${projectId}/${discipline}` -> bool
  const [dropTarget, setDropTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const reqRef = useRef(0); // in-flight token so an overlapping / late refresh can't clobber newer state (B44)
  const refresh = async () => {
    const tok = ++reqRef.current;
    setBusy(true);
    try { const [p, r] = await Promise.all([listProjects(), listReviews()]); if (tok !== reqRef.current) return; setProjects(p); setReviews(r); }
    finally { if (tok === reqRef.current) setBusy(false); }
  };
  useEffect(() => { if (open && signedIn) refresh(); }, [open, signedIn]);

  // Group reviews by project then discipline (an "Unfiled" bucket for unlinked ones).
  const tree = useMemo(() => {
    const m = {};
    for (const r of reviews) {
      const pid = r.project_id || UNFILED;
      (m[pid] = m[pid] || {});
      const d = discOf(r);
      (m[pid][d] = m[pid][d] || []).push(r);
    }
    for (const pid of Object.keys(m)) for (const d of Object.keys(m[pid])) m[pid][d].sort((a, b) => fileTime(b) - fileTime(a));
    return m;
  }, [reviews]);

  const projectRows = useMemo(() => {
    const rows = projects.map((p) => ({ ...p, fileCount: Object.values(tree[p.id] || {}).reduce((n, a) => n + a.length, 0) }));
    if (tree[UNFILED]) rows.push({ id: UNFILED, name: "Unfiled", status: null, fileCount: Object.values(tree[UNFILED]).reduce((n, a) => n + a.length, 0) });
    return rows;
  }, [projects, tree]);

  if (!open) return null;

  const fileDrop = async (e, projectId, project, discipline) => {
    e.preventDefault(); e.stopPropagation(); setDropTarget(null);
    const files = [...(e.dataTransfer?.files || [])].filter((f) => /pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!files.length) return;
    setBusy(true);
    const failed = [];
    try {
      for (const f of files) {
        const r = await fileNewReview({ projectId: projectId === UNFILED ? null : projectId, project: project === "Unfiled" ? "" : project, discipline, blob: f, fileName: f.name });
        if (!r || !r.ok) failed.push(`${f.name} — couldn't file`);
        else if (r.uploadFailed) failed.push(`${f.name} — filed, but the upload failed (re-drop it on open to view)`);
      }
    }
    finally { setBusy(false); refresh(); }
    if (failed.length) window.alert("Some files had problems:\n• " + failed.join("\n• "));
  };
  const onStatus = async (e, projectId) => { const v = e.target.value; e.stopPropagation(); await setProjectStatus(projectId, v); refresh(); };
  const del = async (e, id) => { e.stopPropagation(); if (!window.confirm("Delete this file/review and its stored PDF?")) return; await deleteReview(id); refresh(); };

  const dt = (key) => (dropTarget === key ? { outline: `2px dashed ${PAL.accent}`, background: "#fbf3ee" } : null);

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 60, display: "flex" }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
      <div style={{ position: "relative", width: 380, maxWidth: "85%", height: "100%", background: "#fff", borderRight: `1px solid ${PAL.line}`, boxShadow: "4px 0 24px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${PAL.line}` }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: PAL.ink, flex: 1 }}>Project Library</div>
          {busy && <span style={{ fontSize: 11, color: PAL.muted }}>…</span>}
          <button onClick={refresh} title="Refresh" style={{ border: `1px solid ${PAL.line}`, background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, padding: "3px 7px", color: PAL.ink }}>↻</button>
          <button onClick={onClose} title="Close" style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, lineHeight: 1, color: PAL.muted }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {!signedIn && <div style={{ fontSize: 12, color: "#b45309", padding: 12, lineHeight: 1.5 }}>Sign in (in the Site Planner workspace) to browse your project library.</div>}
          {signedIn && projectRows.length === 0 && <div style={{ fontSize: 12, color: PAL.muted, padding: 12 }}>No projects yet. Create a site in the Site Planner, or drop a PDF here once you do.</div>}

          {signedIn && projectRows.map((p) => {
            const isOpen = !!expanded[p.id];
            return (
              <div key={p.id} style={{ marginBottom: 4, border: `1px solid ${PAL.line}`, borderRadius: 8, ...dt("p:" + p.id) }}
                onDragOver={(e) => { e.preventDefault(); setDropTarget("p:" + p.id); }} onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => fileDrop(e, p.id, p.name, "Other")}>
                <div onClick={() => setExpanded((s) => ({ ...s, [p.id]: !isOpen }))}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer" }}>
                  <span style={{ fontSize: 11, color: PAL.muted, width: 10 }}>{isOpen ? "▾" : "▸"}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ fontSize: 10.5, color: PAL.muted }}>{p.fileCount}</span>
                  {p.status == null
                    ? <span style={{ fontSize: 10, color: PAL.muted, fontStyle: "italic" }}>no project</span>
                    : (() => { const known = STATUSES.includes(p.status); return (
                        <select value={known ? p.status : ""} onClick={(e) => e.stopPropagation()} onChange={(e) => onStatus(e, p.id)}
                          title={known ? "Project status" : "Status unknown — pick one to set it"} style={{ fontSize: 10.5, fontWeight: 700, fontFamily: "inherit", border: `1px solid ${STATUS_COLOR[p.status] || PAL.line}`, color: STATUS_COLOR[p.status] || PAL.ink, background: "#fff", borderRadius: 999, padding: "2px 6px", cursor: "pointer" }}>
                          {!known && <option value="" disabled>Status?</option>}
                          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
                        </select>); })()}
                </div>

                {isOpen && (
                  <div style={{ padding: "0 8px 8px 22px" }}>
                    {DISCIPLINES.map((d) => {
                      const files = (tree[p.id] && tree[p.id][d]) || [];
                      const dkey = p.id + "/" + d;
                      const dOpen = !!openDisc[dkey];
                      return (
                        <div key={d} style={{ borderRadius: 6, ...dt("d:" + dkey) }}
                          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget("d:" + dkey); }} onDragLeave={() => setDropTarget(null)}
                          onDrop={(e) => fileDrop(e, p.id, p.name, d)}>
                          <div onClick={() => setOpenDisc((s) => ({ ...s, [dkey]: !dOpen }))}
                            style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", cursor: "pointer", color: files.length ? PAL.ink : PAL.muted }}>
                            <span style={{ fontSize: 10, width: 9 }}>{files.length ? (dOpen ? "▾" : "▸") : "·"}</span>
                            <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{d}</span>
                            <span style={{ fontSize: 10 }}>{files.length || ""}</span>
                          </div>
                          {dOpen && files.map((r) => (
                            <div key={r.id} onClick={() => { onOpenReview?.(r); onClose?.(); }}
                              style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px 5px 22px", cursor: "pointer", borderRadius: 5 }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = "#fbf3ee")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {r.kind === "stitch" ? "▦ " : "▧ "}{r.title || r.item || "Untitled"}{r.revision ? ` · ${r.revision}` : ""}
                                </div>
                                <div style={{ fontSize: 10, color: PAL.muted }}>{fmtDate(r)}</div>
                              </div>
                              <button onClick={(e) => del(e, r.id)} title="Delete" style={{ flex: "none", border: "none", background: "transparent", color: "#b3361b", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 3 }}>×</button>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ flex: "none", padding: "7px 12px", borderTop: `1px solid ${PAL.line}`, fontSize: 10.5, color: PAL.muted, lineHeight: 1.45 }}>
          Drop a PDF on a project or discipline to file it. Files stay attached regardless of project status.
        </div>
      </div>
    </div>
  );
}
