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
 *
 * Ingestion (B260, arrived as "NEW-1"): the drop zone is a persistent processing queue.
 *  - Multi-file is first-class (Amendment A): drop, the native picker, OR a clipboard
 *    paste can carry many files at once — each becomes ONE independent queue item with its
 *    own uploadId, run through a small concurrency pool (8 files => 8 concurrent rows, not
 *    a batch row and not a serial chain). Non-PDFs get a clear per-file rejection row.
 *  - The tray is persistent, not a vanishing toast (Amendment B): a filed row goes to a
 *    calm "done" state, lingers a beat, then demotes into a collapsible "Recently filed"
 *    trail — never an abrupt removal. Exceptions (needs-filing / failed / rejected) stay in
 *    the active group until the user acts. Both groups are a DERIVED view over one queue
 *    array (see shared/files/uploadQueue.js), not two separate lists.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { listProjects, listReviews, fileNewReview, deleteReview, refileReview, DISCIPLINES } from "../lib/reviewStore.js";
import {
  buildFileFacts, runView, groupByDiscipline, needsFiling, SAVED_VIEWS,
  DOC_CLASS, isSpatial, fileState, FILE_STATE, stubIndexProvider,
} from "../../../shared/files/fileFacts.js";
import { choosePlacement, METHOD } from "../../../shared/placement/placeOnMap.js";
import {
  QUEUE_STATUS, RECENT_COLLAPSE_AT,
  makeQueueItems, splitQueue, hasPendingDemote, runPool,
} from "../../../shared/files/uploadQueue.js";

const PAL = { paper: "var(--surface-raised)", ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)", accent: "var(--accent)" };
const MINI_BTN = { flex: "none", fontSize: 10, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: 5, border: `1px solid ${PAL.line}`, background: "var(--surface-raised)", color: PAL.ink, padding: "2px 8px" };
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
  const [pendingDel, setPendingDel] = useState(null); // fileId armed for inline delete-confirm

  // Persistent processing queue (B260). One flat array; the active/recently-filed split is
  // a derived view over it (splitQueue), never two lists.
  const [queue, setQueue] = useState([]);
  const [recentOpen, setRecentOpen] = useState(false); // user-expanded the collapsed trail?
  const [tick, setTick] = useState(0);                 // re-render pulse so done rows demote on time
  const fileInputRef = useRef(null);

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

  // Keep re-rendering while a freshly-filed row is inside its confirmation beat, so it
  // demotes into the "Recently filed" trail on time even with no further user action. The
  // loop self-stops the moment nothing is pending (tick is in the deps to re-arm).
  useEffect(() => {
    if (!hasPendingDemote(queue)) return undefined;
    const t = setTimeout(() => setTick((n) => n + 1), 400);
    return () => clearTimeout(t);
  }, [queue, tick]);

  if (!open) return null;

  const projName = (id) => (projects.find((p) => p.id === id) || {}).name || "";

  const patchItem = (uploadId, patch) => setQueue((q) => q.map((it) => (it.uploadId === uploadId ? { ...it, ...patch } : it)));
  const removeItem = (uploadId) => setQueue((q) => q.filter((it) => it.uploadId !== uploadId));
  const clearRecent = () => setQueue((q) => {
    const ids = new Set(splitQueue(q, Date.now()).recent.map((it) => it.uploadId));
    return q.filter((it) => !ids.has(it.uploadId));
  });

  // Run one queue item through the filing pipeline. Each file has its own row, so every
  // outcome lands on THAT row — no shared window.alert (KEY DECISION: no dialog boxes).
  const processItem = async (item) => {
    patchItem(item.uploadId, { status: QUEUE_STATUS.PROCESSING, error: null, warn: null });
    const proj = activeProject || null;
    const target = proj ? projName(proj) : "Holding area";
    try {
      // Auto-file by title block is the backend tranche; until then, file under the active
      // project (or the holding area when none is selected). fileNewReview stores the bytes
      // (Drive-first, Supabase fallback — the B207 cutover) and captures placement facts
      // through the index provider; a Drive failure never blocks filing.
      const r = await fileNewReview({ projectId: proj, project: proj ? projName(proj) : "", discipline: "Other", blob: item.file, fileName: item.name });
      if (!r || !r.ok) { patchItem(item.uploadId, { status: QUEUE_STATUS.FAILED, error: (r && r.error) || "Couldn't file." }); return; }
      // Filed. A degraded byte-store is non-fatal — flag it on the row, don't fail it.
      let warn = null;
      if (r.oversize) warn = "too large to store (50 MB cap) — re-drop on open to view";
      else if (r.uploadFailed) warn = "couldn’t be stored — re-drop on open to view";
      else if (r.driveError) warn = "filed; Drive copy failed";
      patchItem(item.uploadId, {
        status: proj ? QUEUE_STATUS.DONE : QUEUE_STATUS.NEEDS_FILING,
        reviewId: r.id, filedAt: Date.now(), warn, target,
      });
    } catch (e) {
      patchItem(item.uploadId, { status: QUEUE_STATUS.FAILED, error: (e && e.message) || "Couldn't file." });
    }
  };

  // The single ingestion path: drop / native picker / clipboard paste all funnel through
  // here. Every file becomes its own independent queue row up front (8 files => 8 rows at
  // once), then the accepted PDFs run through a small concurrency pool — concurrent, not a
  // serial chain. Unsupported types are already REJECTED rows, so they explain themselves.
  const ingest = async (fileList) => {
    const items = makeQueueItems(fileList);
    if (!items.length) return;
    setQueue((q) => [...items, ...q]); // newest on top
    const accepted = items.filter((it) => it.status === QUEUE_STATUS.PROCESSING);
    if (!accepted.length) return;
    await runPool(accepted, processItem, 3);
    refresh(); // pull the filed rows into the discipline list / holding area
  };

  const drop = (e) => { e.preventDefault(); e.stopPropagation(); setDropTarget(false); ingest(e.dataTransfer?.files); };
  const onPick = (e) => { ingest(e.target.files); e.target.value = ""; };
  const onPaste = (e) => { const f = e.clipboardData?.files; if (f && f.length) { e.preventDefault(); ingest(f); } };
  const retry = (item) => { runPool([item], processItem, 1); };
  const triage = (uploadId) => { setView("needs-filing"); removeItem(uploadId); }; // hand off to the holding-area flow
  // Delete uses an INLINE confirm (the × arms a ✓/✕ in place), never window.confirm:
  // a native modal blocks the main thread, which hard-freezes the tab when it's already
  // memory-pressured from a large rendered PDF — and dialog boxes are banned by rule.
  const del = async (id) => { setPendingDel(null); await deleteReview(id); refresh(); };

  // One-click confirm out of the "needs filing" holding area: assign a project +
  // discipline to an unfiled file. Never auto-guesses (a misfiled drawing is worse than
  // an unfiled one) — the user confirms each. (B217)
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
      <div onPaste={onPaste} style={{ position: "relative", width: 400, maxWidth: "88%", height: "100%", background: "#fff", borderRight: `1px solid ${PAL.line}`, boxShadow: "4px 0 24px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
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

            {/* drop zone — drop, paste, or click; multiple files at once (B260) */}
            <input ref={fileInputRef} type="file" accept="application/pdf" multiple style={{ display: "none" }} onChange={onPick} />
            <div onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(true); }} onDragLeave={() => setDropTarget(false)} onDrop={drop}
              style={{ flex: "none", margin: "8px 12px", padding: "10px", borderRadius: 8, textAlign: "center", fontSize: 11.5, lineHeight: 1.4, cursor: "pointer",
                border: `2px dashed ${dropTarget ? PAL.accent : PAL.line}`, background: dropTarget ? "#fbf3ee" : "#faf8f3", color: PAL.muted }}>
              Drop, paste, or click to add PDFs {activeProject ? `to "${projName(activeProject)}"` : "(they’ll go to the holding area)"}.
              <div style={{ fontSize: 10, marginTop: 2 }}>Several at once is fine. Auto-file by title block arrives with the filing backend.</div>
            </div>

            {/* processing tray (B260): persistent — filed rows stay accountable, never vanish */}
            <UploadTray queue={queue} recentOpen={recentOpen} onToggleRecent={() => setRecentOpen((o) => !o)}
              onRetry={retry} onTriage={triage} onDismiss={removeItem} onClearRecent={clearRecent} />

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
                          {pendingDel === f.id ? (
                            <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: PAL.muted }}>
                              <span>Delete?</span>
                              <button onClick={(e) => { e.stopPropagation(); del(f.id); }} title="Confirm delete" style={{ border: "none", background: "transparent", color: "#b3361b", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 2, fontWeight: 700 }}>✓</button>
                              <button onClick={(e) => { e.stopPropagation(); setPendingDel(null); }} title="Cancel" style={{ border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 2 }}>✕</button>
                            </span>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); setPendingDel(f.id); }} title="Delete" style={{ flex: "none", border: "none", background: "transparent", color: "#b3361b", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 3 }}>×</button>
                          )}
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

/* One-click confirm for an unfiled file (B217): pick a project + discipline and file it.
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

/* The persistent upload tray (B260, arrived as "NEW-1"). Two groups, but ONE source array
 * (splitQueue is a derived view):
 *   • active — in-flight + exceptions; the live to-do list. Filed items linger here a beat.
 *   • recently filed — the calm, accountable trail; collapses once it grows past a few.
 * Filed rows never auto-vanish (the user, not a timer, clears the trail). Exceptions
 * (needs-filing / failed / rejected) stay in the active group until the user acts. */
function UploadTray({ queue, recentOpen, onToggleRecent, onRetry, onTriage, onDismiss, onClearRecent }) {
  const { active, recent } = splitQueue(queue, Date.now());
  if (!active.length && !recent.length) return null;
  const collapsible = recent.length > RECENT_COLLAPSE_AT;
  const showRecent = collapsible ? recentOpen : true;
  return (
    <div style={{ flex: "none", margin: "0 12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
      {active.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted, padding: "2px 2px 0" }}>Processing · {active.length}</div>
          {active.map((it) => <QueueRow key={it.uploadId} item={it} onRetry={() => onRetry(it)} onTriage={() => onTriage(it.uploadId)} onDismiss={() => onDismiss(it.uploadId)} />)}
        </>
      )}
      {recent.length > 0 && (
        <div style={{ marginTop: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 2px 0" }}>
            <button onClick={collapsible ? onToggleRecent : undefined}
              style={{ flex: 1, textAlign: "left", border: "none", background: "transparent", cursor: collapsible ? "pointer" : "default", padding: 0,
                fontSize: 10, fontFamily: "inherit", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted }}>
              {collapsible ? (showRecent ? "▾ " : "▸ ") : ""}Recently filed · {recent.length}
            </button>
            <button onClick={onClearRecent} title="Clear the recently-filed trail" style={{ fontSize: 10, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", color: PAL.muted, border: "none", background: "transparent", padding: "2px 4px" }}>Clear</button>
          </div>
          {showRecent && recent.map((it) => <QueueRow key={it.uploadId} item={it} recent />)}
        </div>
      )}
    </div>
  );
}

/* One queue row. Self-explaining: the status icon + sub-label say exactly what happened to
 * THIS file (filed where, needs filing, failed why, not a PDF) — no shared dialog box. */
function QueueRow({ item, recent = false, onRetry, onTriage, onDismiss }) {
  const S = QUEUE_STATUS;
  const meta = ({
    [S.PROCESSING]: { color: PAL.muted, label: "Filing…" },
    [S.DONE]: { icon: "✓", color: "#15803d", label: item.target ? `Filed · ${item.target}` : "Filed" },
    [S.NEEDS_FILING]: { icon: "⚠", color: "#92400e", label: "Needs filing — pick a project" },
    [S.FAILED]: { icon: "⚠", color: "#b3361b", label: item.error || "Failed" },
    [S.REJECTED]: { icon: "⦸", color: "#b3361b", label: item.error || "Unsupported file" },
  })[item.status] || { icon: "•", color: PAL.muted, label: item.status };
  return (
    <div className={`pf-queue-row${recent ? " pf-queue-recent" : ""}`}
      style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 6, border: `1px solid ${PAL.line}`, background: recent ? "#faf9f5" : "#fff", opacity: recent ? 0.92 : 1 }}>
      <span style={{ flex: "none", width: 14, textAlign: "center", color: meta.color, fontSize: 12, lineHeight: 1 }}>
        {item.status === S.PROCESSING
          ? <span style={{ display: "inline-block", width: 10, height: 10, border: `2px solid ${PAL.line}`, borderTopColor: PAL.muted, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
          : meta.icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
        <div style={{ fontSize: 10, color: meta.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {meta.label}{item.warn ? ` · ${item.warn}` : ""}
        </div>
      </div>
      {item.status === S.FAILED && <button onClick={onRetry} style={MINI_BTN}>Retry</button>}
      {item.status === S.NEEDS_FILING && <button onClick={onTriage} style={MINI_BTN}>Triage</button>}
      {item.status === S.REJECTED && <button onClick={onDismiss} title="Dismiss" style={{ ...MINI_BTN, fontSize: 13, lineHeight: 1, color: "#b3361b", padding: "0 6px" }}>×</button>}
    </div>
  );
}
