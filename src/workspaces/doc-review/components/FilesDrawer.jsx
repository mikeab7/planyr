/* Project Files drawer (B180 / NEW-1) — the app-wide file shelf, opened from Row 1 in
 * any workspace (not a module tab). Supersedes ProjectLibrary: same Supabase-backed file
 * index + drag-drop filing + lifecycle-status editing, now driven by the tagged-index
 * view-model (lib/fileIndex.js) so "folders" are SAVED VIEWS (queries), with two document
 * classes (spatial / reference / both), per-file Filed-vs-On-map state, a needs-filing
 * holding area with one-click confirm, and an honest "Place on map" readiness surface
 * (the NEW-3 cascade plan, computed from the file's facts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { listProjects, listReviews, fileNewReview, refileReview, setProjectStatus, deleteReview, DISCIPLINES, STATUSES, STATUS_META } from "../lib/reviewStore.js";
import { buildIndex, runView, viewCounts, SAVED_VIEWS, viewById, needsFiling, fileState, DOC_CLASS } from "../lib/fileIndex.js";
import { makeFileFacts, classifyDocClass, placementReadiness } from "../../../shared/files/fileFacts.js";

const PAL = { paper: "#efeadf", ink: "#2c2a26", muted: "#8a8473", line: "#e7e2d6", accent: "#c2410c" };
const STATUS_COLOR = { pursuit: "#d97706", active: "#15803d", onhold: "#6366f1", complete: "#9ca3af", dead: "#9ca3af" };
const CLASS_META = {
  [DOC_CLASS.SPATIAL]:   { color: "#0d9488", label: "Spatial — can live on the map" },
  [DOC_CLASS.REFERENCE]: { color: "#9ca3af", label: "Reference — read only" },
  [DOC_CLASS.BOTH]:      { color: "#d97706", label: "Title commitment — reference + boundary/easement source" },
};
const UNFILED = "__unfiled__";
const fmtDate = (e) => { const s = e.docDate || e.updatedAt; try { return s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""; } catch (_) { return ""; } };
const isSpatial = (e) => e.docClass === DOC_CLASS.SPATIAL || e.docClass === DOC_CLASS.BOTH;

export default function FilesDrawer({ open, onClose, onOpenReview, signedIn = false, defaultProjectId = null }) {
  const [projects, setProjects] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("all");
  const [projectFilter, setProjectFilter] = useState(defaultProjectId);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});
  const [openDisc, setOpenDisc] = useState({});
  const [dropTarget, setDropTarget] = useState(null);
  const [placeFor, setPlaceFor] = useState(null);   // entry id whose placement plan is shown
  const [refile, setRefile] = useState({});          // entryId -> { projectId, discipline }

  const reqRef = useRef(0); // in-flight token so a late refresh can't clobber newer state (B44)
  const refresh = async () => {
    const tok = ++reqRef.current;
    setBusy(true);
    try { const [p, r] = await Promise.all([listProjects(), listReviews()]); if (tok !== reqRef.current) return; setProjects(p); setReviews(r); }
    finally { if (tok === reqRef.current) setBusy(false); }
  };
  useEffect(() => { if (open && signedIn) refresh(); }, [open, signedIn]);
  useEffect(() => { setProjectFilter(defaultProjectId); }, [defaultProjectId, open]);

  const index = useMemo(() => buildIndex(reviews), [reviews]);
  const counts = useMemo(() => viewCounts(index, { projectId: projectFilter }), [index, projectFilter]);
  const extra = useMemo(() => { const q = search.trim().toLowerCase(); return q ? (e) => `${e.item} ${e.title} ${e.project}`.toLowerCase().includes(q) : null; }, [search]);
  const results = useMemo(() => runView(view, index, { projectId: projectFilter, extra }), [view, index, projectFilter, extra]);

  // Project→discipline tree (the familiar browse, used by the "All files" view).
  const tree = useMemo(() => {
    const m = {};
    const src = projectFilter ? index.filter((e) => (e.projectId || UNFILED) === projectFilter) : index;
    for (const e of src) { const pid = e.projectId || UNFILED; (m[pid] = m[pid] || {}); (m[pid][e.discipline] = m[pid][e.discipline] || []).push(e); }
    return m;
  }, [index, projectFilter]);
  const projectRows = useMemo(() => {
    let rows = projects.map((p) => ({ ...p, fileCount: Object.values(tree[p.id] || {}).reduce((n, a) => n + a.length, 0) }));
    if (projectFilter) rows = rows.filter((p) => p.id === projectFilter);
    if (tree[UNFILED]) rows.push({ id: UNFILED, name: "Unfiled", status: null, fileCount: Object.values(tree[UNFILED]).reduce((n, a) => n + a.length, 0) });
    return rows;
  }, [projects, tree, projectFilter]);

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
    } finally { setBusy(false); refresh(); }
    if (failed.length) window.alert("Some files had problems:\n• " + failed.join("\n• "));
  };
  const onStatus = async (e, projectId) => { const v = e.target.value; e.stopPropagation(); await setProjectStatus(projectId, v); refresh(); };
  const del = async (id) => { if (!window.confirm("Delete this file/review and its stored PDF?")) return; await deleteReview(id); refresh(); };
  const doRefile = async (entry) => {
    const sel = refile[entry.id] || {};
    const proj = projects.find((p) => p.id === sel.projectId);
    const res = await refileReview(entry.id, { projectId: sel.projectId || null, project: proj ? proj.name : "", discipline: sel.discipline || entry.discipline });
    if (res.ok) { setRefile((s) => { const n = { ...s }; delete n[entry.id]; return n; }); refresh(); }
    else window.alert("Couldn't file: " + (res.error || "unknown error"));
  };

  const dt = (key) => (dropTarget === key ? { outline: `2px dashed ${PAL.accent}`, background: "#fbf3ee" } : null);
  const chip = (active) => ({ border: `1px solid ${active ? PAL.accent : PAL.line}`, background: active ? "#fbf3ee" : "#fff", color: active ? PAL.accent : PAL.ink, borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" });

  // Placement-readiness surface (NEW-3 honest browser-first): which rung the cascade
  // would use for this file + why each higher rung isn't available yet.
  const placementPlan = (entry) => {
    const facts = makeFileFacts({ docClass: classifyDocClass({ discipline: entry.discipline, item: entry.item, title: entry.title }) });
    const r = placementReadiness(facts);
    const order = [["embedded", "Embedded coordinates"], ["boundary", "Fit to known boundary"], ["graphic", "Measure a graphic"], ["manual", "Manual calibration"]];
    const chosen = order.find(([id]) => r[id].ready) || ["manual", "Manual calibration"];
    return { chosen, rungs: order.map(([id, label]) => ({ id, label, ...r[id] })) };
  };

  const FileRow = ({ e, showProject }) => {
    const cm = CLASS_META[e.docClass] || CLASS_META[DOC_CLASS.REFERENCE];
    const onMap = fileState(e) === "on-map";
    const showPlace = isSpatial(e);
    const planOpen = placeFor === e.id;
    return (
      <div style={{ borderRadius: 5 }}>
        <div onClick={() => { onOpenReview?.(e.raw || e); onClose?.(); }}
          style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 6px 5px 8px", cursor: "pointer", borderRadius: 5 }}
          onMouseEnter={(ev) => (ev.currentTarget.style.background = "#fbf3ee")} onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}>
          <span title={cm.label} style={{ flex: "none", width: 9, height: 9, borderRadius: 99, background: cm.color }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.kind === "stitch" ? "▦ " : "▧ "}{e.item || e.title || "Untitled"}{e.revision ? ` · ${e.revision}` : ""}
            </div>
            <div style={{ fontSize: 10, color: PAL.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {showProject ? `${e.project || "Unfiled"} · ${e.discipline} · ` : ""}{fmtDate(e)}
            </div>
          </div>
          {onMap && <span title="Calibrated onto the map" style={{ flex: "none", fontSize: 9.5, fontWeight: 700, color: "#0d9488", border: "1px solid #99f6e4", background: "#f0fdfa", borderRadius: 999, padding: "1px 6px" }}>On map</span>}
          {showPlace && <button onClick={(ev) => { ev.stopPropagation(); setPlaceFor(planOpen ? null : e.id); }} title="How this would place on the map" style={{ flex: "none", border: `1px solid ${PAL.line}`, background: "#fff", color: PAL.ink, borderRadius: 6, cursor: "pointer", fontSize: 10.5, padding: "2px 6px" }}>⊕ Map</button>}
          <button onClick={(ev) => { ev.stopPropagation(); del(e.id); }} title="Delete" style={{ flex: "none", border: "none", background: "transparent", color: "#b3361b", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 3 }}>×</button>
        </div>
        {planOpen && (() => { const { chosen, rungs } = placementPlan(e); return (
          <div style={{ margin: "0 6px 6px 24px", padding: "7px 9px", border: `1px solid ${PAL.line}`, borderRadius: 7, background: "#faf7f0" }}>
            <div style={{ fontSize: 11, color: PAL.ink, fontWeight: 700, marginBottom: 4 }}>Place on map → <span style={{ color: PAL.accent }}>{chosen[1]}</span></div>
            {rungs.map((rg) => (
              <div key={rg.id} style={{ display: "flex", gap: 6, fontSize: 10.5, color: rg.ready ? PAL.ink : PAL.muted, lineHeight: 1.4 }}>
                <span style={{ flex: "none" }}>{rg.ready ? "✓" : "·"}</span><span style={{ fontWeight: 600, flex: "none", width: 96 }}>{rg.label}</span><span style={{ flex: 1 }}>{rg.why}</span>
              </div>
            ))}
            <div style={{ fontSize: 10, color: PAL.muted, marginTop: 5, lineHeight: 1.4 }}>Auto-placement (embedded coords / fit-to-boundary / scale-bar) lands with the title-block read pass. Manual placement is available now in the Site Planner's Overlay tool.</div>
          </div>
        ); })()}
        {view === "needs-filing" && (
          <div style={{ display: "flex", gap: 5, alignItems: "center", margin: "0 6px 6px 24px" }}>
            <select value={(refile[e.id] || {}).projectId || ""} onChange={(ev) => setRefile((s) => ({ ...s, [e.id]: { ...s[e.id], projectId: ev.target.value } }))} style={{ fontSize: 10.5, fontFamily: "inherit", borderRadius: 5, border: `1px solid ${PAL.line}`, padding: "2px 4px", maxWidth: 120 }}>
              <option value="">Project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={(refile[e.id] || {}).discipline || e.discipline} onChange={(ev) => setRefile((s) => ({ ...s, [e.id]: { ...s[e.id], discipline: ev.target.value } }))} style={{ fontSize: 10.5, fontFamily: "inherit", borderRadius: 5, border: `1px solid ${PAL.line}`, padding: "2px 4px" }}>
              {DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <button onClick={() => doRefile(e)} disabled={!(refile[e.id] || {}).projectId} style={{ fontSize: 10.5, fontWeight: 700, fontFamily: "inherit", borderRadius: 6, border: `1px solid ${PAL.accent}`, background: (refile[e.id] || {}).projectId ? PAL.accent : "#e7e2d6", color: "#fff", padding: "2px 8px", cursor: (refile[e.id] || {}).projectId ? "pointer" : "default" }}>File</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 70, display: "flex" }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
      <div style={{ position: "relative", width: 400, maxWidth: "88%", height: "100%", background: "#fff", borderRight: `1px solid ${PAL.line}`, boxShadow: "4px 0 24px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${PAL.line}` }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: PAL.ink, flex: 1 }}>Project Files</div>
          {busy && <span style={{ fontSize: 11, color: PAL.muted }}>…</span>}
          <button onClick={refresh} title="Refresh" style={{ border: `1px solid ${PAL.line}`, background: "#fff", borderRadius: 6, cursor: "pointer", fontSize: 12, padding: "3px 7px", color: PAL.ink }}>↻</button>
          <button onClick={onClose} title="Close" style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, lineHeight: 1, color: PAL.muted }}>×</button>
        </div>

        {!signedIn ? (
          <div style={{ fontSize: 12, color: "#b45309", padding: 14, lineHeight: 1.5 }}>Sign in (in the Site Planner workspace) to browse your project files.</div>
        ) : (
          <>
            {/* Saved-view chips + project filter — folders are queries, not a fixed tree */}
            <div style={{ flex: "none", padding: "8px 10px", borderBottom: `1px solid ${PAL.line}`, display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {SAVED_VIEWS.map((v) => (
                  <button key={v.id} onClick={() => { setView(v.id); setPlaceFor(null); }} style={chip(view === v.id)} title={v.scope === "project" ? "Per-project view (uses the filter)" : "Cross-project view"}>
                    {v.label}{counts[v.id] ? ` ${counts[v.id]}` : ""}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select value={projectFilter || ""} onChange={(e) => setProjectFilter(e.target.value || null)} style={{ fontSize: 11, fontFamily: "inherit", borderRadius: 6, border: `1px solid ${PAL.line}`, padding: "3px 6px", flex: "none", maxWidth: 150 }}>
                  <option value="">All projects</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files…" style={{ flex: 1, fontSize: 11, fontFamily: "inherit", borderRadius: 6, border: `1px solid ${PAL.line}`, padding: "3px 7px", minWidth: 0 }} />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
              {/* Drop zone — auto-file by title block (browser: lands in "needs filing") */}
              <div onDragOver={(e) => { e.preventDefault(); setDropTarget("zone"); }} onDragLeave={() => setDropTarget(null)} onDrop={(e) => fileDrop(e, projectFilter || UNFILED, "", "Other")}
                style={{ border: `1.5px dashed ${dropTarget === "zone" ? PAL.accent : PAL.line}`, borderRadius: 8, padding: "9px 10px", textAlign: "center", fontSize: 11, color: PAL.muted, marginBottom: 8, background: dropTarget === "zone" ? "#fbf3ee" : "#faf7f0" }}>
                Drop a PDF to file it{projectFilter ? " under this project" : " (lands in “Needs filing” until matched)"}
              </div>

              {view === "all" ? (
                projectRows.length === 0
                  ? <div style={{ fontSize: 12, color: PAL.muted, padding: 12 }}>No files yet. Drop a PDF above, or create a site in the Site Planner.</div>
                  : projectRows.map((p) => {
                    const isOpen = !!expanded[p.id] || !!projectFilter;
                    return (
                      <div key={p.id} style={{ marginBottom: 4, border: `1px solid ${PAL.line}`, borderRadius: 8, ...dt("p:" + p.id) }}
                        onDragOver={(e) => { e.preventDefault(); setDropTarget("p:" + p.id); }} onDragLeave={() => setDropTarget(null)} onDrop={(e) => fileDrop(e, p.id, p.name, "Other")}>
                        <div onClick={() => setExpanded((s) => ({ ...s, [p.id]: !isOpen }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer" }}>
                          <span style={{ fontSize: 11, color: PAL.muted, width: 10 }}>{isOpen ? "▾" : "▸"}</span>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                          <span style={{ fontSize: 10.5, color: PAL.muted }}>{p.fileCount}</span>
                          {p.status == null ? <span style={{ fontSize: 10, color: PAL.muted, fontStyle: "italic" }}>no project</span>
                            : (() => { const known = STATUSES.includes(p.status); return (
                              <select value={known ? p.status : ""} onClick={(e) => e.stopPropagation()} onChange={(e) => onStatus(e, p.id)} title={known ? "Project status" : "Status unknown — pick one to set it"}
                                style={{ fontSize: 10.5, fontWeight: 700, fontFamily: "inherit", border: `1px solid ${STATUS_COLOR[p.status] || PAL.line}`, color: STATUS_COLOR[p.status] || PAL.ink, background: "#fff", borderRadius: 999, padding: "2px 6px", cursor: "pointer" }}>
                                {!known && <option value="" disabled>Status?</option>}
                                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
                              </select>); })()}
                        </div>
                        {isOpen && (
                          <div style={{ padding: "0 8px 8px 22px" }}>
                            {DISCIPLINES.map((d) => {
                              const files = (tree[p.id] && tree[p.id][d]) || [];
                              const dkey = p.id + "/" + d;
                              const dOpen = !!openDisc[dkey] || files.length <= 6;
                              return (
                                <div key={d} style={{ borderRadius: 6, ...dt("d:" + dkey) }}
                                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget("d:" + dkey); }} onDragLeave={() => setDropTarget(null)} onDrop={(e) => fileDrop(e, p.id, p.name, d)}>
                                  <div onClick={() => setOpenDisc((s) => ({ ...s, [dkey]: !dOpen }))} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", cursor: "pointer", color: files.length ? PAL.ink : PAL.muted }}>
                                    <span style={{ fontSize: 10, width: 9 }}>{files.length ? (dOpen ? "▾" : "▸") : "·"}</span>
                                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{d}</span>
                                    <span style={{ fontSize: 10 }}>{files.length || ""}</span>
                                  </div>
                                  {dOpen && files.map((e) => <FileRow key={e.id} e={e} showProject={false} />)}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
              ) : (
                <>
                  {view === "needs-filing" && results.length > 0 && <div style={{ fontSize: 11, color: "#b45309", padding: "2px 6px 8px", lineHeight: 1.4 }}>Pick a project + discipline and confirm. A misfiled drawing is worse than an unfiled one, so nothing is auto-guessed.</div>}
                  {results.length === 0 ? <div style={{ fontSize: 12, color: PAL.muted, padding: 12 }}>No files match “{viewById(view).label}”{projectFilter ? " in this project" : ""}.</div>
                    : results.map((e) => <FileRow key={e.id} e={e} showProject />)}
                </>
              )}
            </div>
          </>
        )}
        <div style={{ flex: "none", padding: "7px 12px", borderTop: `1px solid ${PAL.line}`, fontSize: 10.5, color: PAL.muted, lineHeight: 1.45 }}>
          Folders are saved views (queries) over your file index. Drop a PDF to file it; files stay attached regardless of project status.
        </div>
      </div>
    </div>
  );
}
