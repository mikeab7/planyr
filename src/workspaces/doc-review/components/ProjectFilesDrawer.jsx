/* Project Files (B180 / NEW-1) — the tagged-index drawer with saved views.
 *
 * Opened from Row 1 (the project-name area), NOT a fourth module tab: tabs are
 * workspaces (modes of working); Files is a shelf every workspace reaches into. The
 * "folders" here are SAVED VIEWS over a tagged index (see shared/files/fileFacts.js) —
 * "All surveys", "Title commitments", "Civil set" are all queries, not a hand-kept tree.
 * A per-project view can be widened to cross-project (the same query, project filter
 * dropped) with the toggle.
 *
 * Each file carries its document class (spatial = can live on the map / reference = read
 * only) and its state (Filed automatically / On map once calibrated). Spatial files get a
 * "Place on map" action that runs the NEW-3 cascade (choosePlacement) and surfaces the
 * chosen method + why higher methods were skipped — honest about what's automatic today
 * vs. what waits on the auto-filing backend. Reuses the existing reviewStore plumbing;
 * the auto-filing index is stubbed behind the index-provider interface.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { listProjects, listReviews, fileNewReview, deleteReview, refileReview, DISCIPLINES } from "../lib/reviewStore.js";
import {
  buildFileFacts, runView, groupByDiscipline, needsFiling, SAVED_VIEWS,
  DOC_CLASS, isSpatial, fileState, FILE_STATE, stubIndexProvider,
} from "../../../shared/files/fileFacts.js";
import { choosePlacement, METHOD } from "../../../shared/placement/placeOnMap.js";

const PAL = { paper: "#efeadf", ink: "#2c2a26", muted: "#8a8473", line: "#e7e2d6", accent: "#c2410c" };
const CLASS_TAG = {
  [DOC_CLASS.SPATIAL]: { label: "spatial", color: "#15803d" },
  [DOC_CLASS.REFERENCE]: { label: "reference", color: "#6b6557" },
  [DOC_CLASS.BOTH]: { label: "spatial + reference", color: "#1d4ed8" },
};
const fmtDate = (f) => { const s = f.docDate || f.updatedAt; try { return s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""; } catch (_) { return ""; } };

export default function ProjectFilesDrawer({ open, onClose, onOpenReview, onPlaceOnMap, signedIn = false, projectId = null, indexProvider = stubIndexProvider }) {
  const [projects, setProjects] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [view, setView] = useState("all");
  const [crossProject, setCrossProject] = useState(false);
  const [activeProject, setActiveProject] = useState(projectId);
  const [dropTarget, setDropTarget] = useState(false);
  const [busy, setBusy] = useState(false);
  const [placePlan, setPlacePlan] = useState(null); // { fileId, plan } — the cascade result to show
  const [refileSel, setRefileSel] = useState({});   // fileId -> { projectId, discipline } for the one-click confirm

  const reqRef = useRef(0); // in-flight token (B44)
  const refresh = async () => {
    const tok = ++reqRef.current;
    setBusy(true);
    try { const [p, r] = await Promise.all([listProjects(), listReviews()]); if (tok !== reqRef.current) return; setProjects(p); setReviews(r); }
    finally { if (tok === reqRef.current) setBusy(false); }
  };
  useEffect(() => { if (open && signedIn) refresh(); }, [open, signedIn]);
  useEffect(() => { setActiveProject(projectId); }, [projectId]);

  const facts = useMemo(() => buildFileFacts(reviews), [reviews]);
  const shown = useMemo(() => runView(facts, view, { projectId: activeProject, crossProject }), [facts, view, activeProject, crossProject]);
  const groups = useMemo(() => groupByDiscipline(shown), [shown]);
  const unfiled = useMemo(() => needsFiling(facts), [facts]);

  if (!open) return null;

  const projName = (id) => (projects.find((p) => p.id === id) || {}).name || "";

  const drop = async (e) => {
    e.preventDefault(); e.stopPropagation(); setDropTarget(false);
    const files = [...(e.dataTransfer?.files || [])].filter((f) => /pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!files.length) return;
    setBusy(true);
    const failed = [];
    try {
      for (const f of files) {
        // Auto-file by title block is the backend tranche; until then, file under the
        // active project (or the holding area when none is selected). The index provider
        // captures placement facts at filing time through the same interface.
        const r = await fileNewReview({ projectId: activeProject || null, project: projName(activeProject), discipline: "Other", blob: f, fileName: f.name });
        if (!r || !r.ok) failed.push(`${f.name} — couldn't file`);
        else if (r.uploadFailed) failed.push(`${f.name} — filed, but the upload failed (re-drop on open to view)`);
      }
    } finally { setBusy(false); refresh(); }
    if (failed.length) window.alert("Some files had problems:\n• " + failed.join("\n• "));
  };
  const del = async (e, id) => { e.stopPropagation(); if (!window.confirm("Delete this file and its stored PDF?")) return; await deleteReview(id); refresh(); };

  // One-click confirm out of the "needs filing" holding area: assign a project +
  // discipline to an unfiled file. Never auto-guesses (a misfiled drawing is worse than
  // an unfiled one) — the user confirms each. (B189)
  const doRefile = async (f) => {
    const sel = refileSel[f.id] || {};
    if (!sel.projectId) return;
    const res = await refileReview(f.id, { projectId: sel.projectId, project: projName(sel.projectId), discipline: sel.discipline || "Other" });
    if (res.ok) { setRefileSel((s) => { const n = { ...s }; delete n[f.id]; return n; }); refresh(); }
    else window.alert("Couldn't file: " + (res.error || "unknown error"));
  };

  // NEW-3: run the placement cascade against the file's captured facts. Backend isn't
  // wired yet, so the facts are empty and the cascade honestly lands on manual
  // calibration — but it surfaces the rung order + reasons so the path is real now.
  const planPlacement = (f) => {
    const ctx = { canReproject: false, targetBoundary: null }; // capabilities arrive with the backend/EPSG spine
    const plan = choosePlacement(f.placement, ctx);
    setPlacePlan({ fileId: f.id, plan });
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 70, display: "flex" }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
      <div style={{ position: "relative", width: 400, maxWidth: "88%", height: "100%", background: "#fff", borderRight: `1px solid ${PAL.line}`, boxShadow: "4px 0 24px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
        {/* header */}
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
            {/* project + scope */}
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${PAL.line}` }}>
              <select value={activeProject || ""} onChange={(e) => setActiveProject(e.target.value || null)}
                style={{ flex: 1, fontSize: 12, fontFamily: "inherit", border: `1px solid ${PAL.line}`, borderRadius: 6, padding: "4px 6px", color: PAL.ink, background: "#fff" }}>
                <option value="">All projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <label style={{ fontSize: 11, color: PAL.muted, display: "flex", alignItems: "center", gap: 4, cursor: "pointer", whiteSpace: "nowrap" }} title="Run the current view across every project, not just this one">
                <input type="checkbox" checked={crossProject} onChange={(e) => setCrossProject(e.target.checked)} /> cross-project
              </label>
            </div>

            {/* saved-view chips (queries, not folders) */}
            <div style={{ flex: "none", display: "flex", flexWrap: "wrap", gap: 5, padding: "8px 12px", borderBottom: `1px solid ${PAL.line}` }}>
              {SAVED_VIEWS.map((v) => (
                <button key={v.id} onClick={() => setView(v.id)}
                  title={v.scope === "global" ? "Spans all projects" : "Filtered to the selected project"}
                  style={{ fontSize: 11, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 999, padding: "3px 9px",
                    border: `1px solid ${view === v.id ? PAL.accent : PAL.line}`, background: view === v.id ? PAL.accent : "#fff", color: view === v.id ? "#fff" : PAL.ink }}>
                  {v.label}
                </button>
              ))}
            </div>

            {/* drop zone */}
            <div onDragOver={(e) => { e.preventDefault(); setDropTarget(true); }} onDragLeave={() => setDropTarget(false)} onDrop={drop}
              style={{ flex: "none", margin: "8px 12px", padding: "10px", borderRadius: 8, textAlign: "center", fontSize: 11.5, lineHeight: 1.4,
                border: `2px dashed ${dropTarget ? PAL.accent : PAL.line}`, background: dropTarget ? "#fbf3ee" : "#faf8f3", color: PAL.muted }}>
              Drop a PDF to file it {activeProject ? `under "${projName(activeProject)}"` : "(into the holding area)"}.
              <div style={{ fontSize: 10, marginTop: 2 }}>Auto-file by title block arrives with the filing backend.</div>
            </div>

            {/* file list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
              {shown.length === 0 && <div style={{ fontSize: 12, color: PAL.muted, padding: 12 }}>No files match this view.</div>}
              {groups.map((g) => (
                <div key={g.discipline} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted, padding: "6px 6px 3px" }}>{g.discipline} · {g.files.length}</div>
                  {g.files.map((f) => {
                    const tag = CLASS_TAG[f.docClass];
                    const onMap = fileState(f) === FILE_STATE.ON_MAP;
                    const showPlan = placePlan && placePlan.fileId === f.id;
                    return (
                      <div key={f.id} style={{ border: `1px solid ${PAL.line}`, borderRadius: 7, padding: "6px 8px", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div onClick={() => { const r = reviews.find((x) => x.id === f.id); onOpenReview?.(r || f); onClose?.(); }} style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                            <div style={{ fontSize: 12, color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {f.kind === "stitch" ? "▦ " : "▧ "}{f.title || f.item}{f.revision ? ` · ${f.revision}` : ""}
                            </div>
                            <div style={{ fontSize: 10, color: PAL.muted, display: "flex", gap: 7, alignItems: "center" }}>
                              <span>{fmtDate(f)}</span>
                              <span style={{ color: tag.color, fontWeight: 600 }}>{tag.label}</span>
                              <span style={{ fontWeight: 600, color: onMap ? "#15803d" : PAL.muted }}>{onMap ? "● on map" : "○ filed"}</span>
                            </div>
                          </div>
                          {isSpatial(f) && <button onClick={() => planPlacement(f)} title="Place this drawing on the map (auto-placement cascade)"
                            style={{ flex: "none", fontSize: 10.5, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 6, border: `1px solid ${PAL.line}`, background: "#fff", color: PAL.ink, padding: "3px 7px" }}>Place on map</button>}
                          <button onClick={(e) => del(e, f.id)} title="Delete" style={{ flex: "none", border: "none", background: "transparent", color: "#b3361b", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 3 }}>×</button>
                        </div>
                        {f.unfiled && <RefileRow projects={projects} value={refileSel[f.id]} onChange={(v) => setRefileSel((s) => ({ ...s, [f.id]: v }))} onFile={() => doRefile(f)} />}
                        {showPlan && <PlacePlan plan={placePlan.plan} onGo={() => { onPlaceOnMap?.(reviews.find((x) => x.id === f.id) || f, placePlan.plan); setPlacePlan(null); onClose?.(); }} onDismiss={() => setPlacePlan(null)} />}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* needs-filing holding area */}
              {unfiled.length > 0 && view !== "needs-filing" && (
                <div style={{ marginTop: 8, padding: "8px", borderRadius: 8, border: `1px dashed #d6a64a`, background: "#fffbeb" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#92400e", marginBottom: 4 }}>⚠ Needs filing · {unfiled.length}</div>
                  <div style={{ fontSize: 10.5, color: "#92400e", lineHeight: 1.4 }}>Low-confidence / no-match files. Pick a project + discipline on each to file it — open the “Needs filing” view to triage them together.</div>
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ flex: "none", padding: "7px 12px", borderTop: `1px solid ${PAL.line}`, fontSize: 10.5, color: PAL.muted, lineHeight: 1.45 }}>
          Folders are saved views — queries over a tagged index. Files stay attached regardless of project status.
        </div>
      </div>
    </div>
  );
}

/* One-click confirm for an unfiled file (B189): pick a project + discipline and file it.
 * Inline on every unfiled row so the "needs filing" holding area is actionable, not just
 * a label. Never auto-guesses — a misfiled drawing is worse than an unfiled one. */
function RefileRow({ projects, value = {}, onChange, onFile }) {
  const ready = !!value.projectId;
  const ctl = { fontSize: 10.5, fontFamily: "inherit", border: `1px solid ${PAL.line}`, borderRadius: 5, padding: "2px 4px", color: PAL.ink, background: "#fff" };
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 6, paddingTop: 6, borderTop: `1px solid ${PAL.line}` }}>
      <span style={{ fontSize: 10, color: "#92400e", fontWeight: 700, flex: "none" }}>File to:</span>
      <select value={value.projectId || ""} onChange={(e) => onChange({ ...value, projectId: e.target.value })} style={{ ...ctl, flex: 1, minWidth: 0 }}>
        <option value="">Project…</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select value={value.discipline || "Civil"} onChange={(e) => onChange({ ...value, discipline: e.target.value })} style={{ ...ctl, flex: "none" }}>
        {DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <button onClick={onFile} disabled={!ready} title={ready ? "File this document" : "Pick a project first"}
        style={{ flex: "none", fontSize: 10.5, fontFamily: "inherit", fontWeight: 700, cursor: ready ? "pointer" : "default", borderRadius: 6, border: `1px solid ${ready ? "#15803d" : PAL.line}`, background: ready ? "#15803d" : "#eee", color: ready ? "#fff" : PAL.muted, padding: "2px 9px" }}>File</button>
    </div>
  );
}

/* The cascade result panel (NEW-3): names the chosen method and lists, plainly, which
 * higher methods were skipped and why — never a silent fall-through. */
function PlacePlan({ plan, onGo, onDismiss }) {
  const auto = plan.confident;
  return (
    <div style={{ marginTop: 6, padding: "7px 8px", borderRadius: 6, background: "#f3f6f4", border: "1px solid #d7e3dc", fontSize: 11, color: "#2c2a26" }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{auto ? "Auto-placement" : "Manual placement"}: {plan.label}</div>
      <div style={{ color: "#4b5563", lineHeight: 1.4 }}>{plan.reason}</div>
      {plan.skipped.length > 0 && (
        <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: "#6b7280" }}>
          {plan.skipped.map((s) => <li key={s.method}>{s.label}: {s.reason}</li>)}
        </ul>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button onClick={onGo} style={{ fontSize: 11, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 6, border: "1px solid #15803d", background: "#15803d", color: "#fff", padding: "3px 9px" }}>
          {plan.method === METHOD.MANUAL ? "Open & calibrate" : "Place"}
        </button>
        <button onClick={onDismiss} style={{ fontSize: 11, fontFamily: "inherit", cursor: "pointer", borderRadius: 6, border: "1px solid #d7e3dc", background: "#fff", color: "#4b5563", padding: "3px 9px" }}>Cancel</button>
      </div>
    </div>
  );
}
