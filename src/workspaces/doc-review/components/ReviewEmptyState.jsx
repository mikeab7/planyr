/* Review's "nothing open" screen (NEW-1) — a project-aware sheet index.
 *   State 1 (no project): "Pick a project" — each project as a full-width tappable card + drawing count.
 *   State 2 (a project):  "Current set" — latest revision per sheet, grouped by discipline; tap opens it
 *                         on the canvas through the same `openReview` path Library's open intent uses.
 * Touch-first: rows ≥ touch height, title ellipsises, nothing forces horizontal scroll at phone width.
 * Data: the same metadata-only reads Library uses (fetchReviews + fetchFileFacts, merged) — no bytes.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchReviews, fetchFileFacts } from "../lib/reviewStore.js";
import { mergeFactsIntoReviews } from "../lib/fileIndex.js";
import { buildFileFacts } from "../../../shared/files/fileFacts.js";
import { buildSheetIndex, drawingCountLabel } from "../../../shared/files/sheetIndex.js";
import { listProjects as listLocalProjects, onProjectsChanged } from "../../../shared/projects/projects.js";
import { useProjectName } from "../../../shared/names/names.js";
import { FONT_SIZE, CONTROL_H, SPACE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";

const linkBtn = { background: "transparent", border: "none", padding: `${SPACE.md}px 0`, minHeight: CONTROL_H.touch, cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, color: "var(--accent-review-text, var(--accent))", textDecoration: "underline" };
const rowBase = { display: "flex", alignItems: "center", gap: SPACE.lg, width: "100%", minHeight: CONTROL_H.touch, boxSizing: "border-box", textAlign: "left", fontFamily: "inherit", cursor: "pointer", color: "var(--text-primary)" };
const revText = (r) => (/^rev/i.test(r) ? r : `Rev ${r}`);

export default function ReviewEmptyState(props) {
  const [projects, setProjects] = useState(() => { try { return listLocalProjects(); } catch (_) { return []; } });
  const [reviews, setReviews] = useState(null); // null = not read yet
  const [readFailed, setReadFailed] = useState(false);

  useEffect(() => onProjectsChanged(() => { try { setProjects(listLocalProjects()); } catch (_) { /* keep last */ } }), []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [r, ff] = await Promise.all([fetchReviews(), fetchFileFacts()]);
        if (!live) return;
        if (r.ok && ff.ok) { setReviews(mergeFactsIntoReviews(r.rows, ff.rows)); setReadFailed(false); }
        else setReadFailed(true); // a failed read is said out loud — never rendered as "no drawings"
      } catch (_) { if (live) setReadFailed(true); }
    })();
    return () => { live = false; };
  }, []);

  return <ReviewEmptyStateView {...props} projects={projects} reviews={reviews} readFailed={readFailed} />;
}

/* Presentational half — pure of I/O so the empty-state contract is testable by static render. */
export function ReviewEmptyStateView({ projectId = null, org = false, busy = false, err = "", onSelectProject, onOpenRow, onUpload, projects = [], reviews = null, readFailed = false }) {
  const facts = useMemo(() => buildFileFacts(reviews || []), [reviews]);
  const inScope = !!projectId || org; // State 2 needs a project (or the Organization's own files)
  const scoped = useMemo(() => (org ? facts.filter((f) => f.orgScope) : projectId ? facts.filter((f) => f.projectId === projectId) : []), [facts, projectId, org]);
  const index = useMemo(() => buildSheetIndex(scoped), [scoped]);
  const counts = useMemo(() => {
    const by = new Map();
    for (const f of facts) { if (f.projectId) { if (!by.has(f.projectId)) by.set(f.projectId, []); by.get(f.projectId).push(f); } }
    const out = new Map();
    for (const [id, list] of by) out.set(id, buildSheetIndex(list).total);
    return out;
  }, [facts]);
  const projectName = useProjectName(projectId, "this project");

  const shell = { maxWidth: 640, width: "100%", margin: "0 auto", boxSizing: "border-box", padding: `${SPACE.xxl}px`, textAlign: "left" };
  const heading = { fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)", margin: 0 };
  const note = (txt, tid) => <div data-testid={tid} style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", padding: `${SPACE.lg}px 0` }}>{txt}</div>;
  const status = (
    <>
      {busy && note("Opening…", "empty-busy")}
      {readFailed && <div role="alert" style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)", padding: `${SPACE.md}px 0` }}>Couldn’t load your drawings just now — check your connection and reopen this tab.</div>}
      {err && <div role="alert" style={{ color: "var(--danger-text)", fontSize: FONT_SIZE.control, padding: `${SPACE.md}px 0` }}>{err}</div>}
    </>
  );

  if (!inScope) {
    return (
      <div data-testid="review-empty" data-state="pick-project" style={shell}>
        <h2 style={heading}>Pick a project</h2>
        <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", marginBottom: SPACE.xl }}>to see its drawings</div>
        <div style={{ display: "flex", flexDirection: "column", gap: SPACE.md }}>
          {projects.map((p) => {
            const n = counts.get(p.id) || 0;
            return (
              <button key={p.id} type="button" data-testid="empty-project-card" data-project-id={p.id} onClick={() => onSelectProject?.(p.id)}
                style={{ ...rowBase, flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: SPACE.xxs, padding: `${SPACE.lg}px ${SPACE.xl}px`, border: "1px solid var(--border-default)", borderRadius: RADIUS.md, background: "var(--surface-raised)" }}>
                <span style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || "Untitled project"}</span>
                <span style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>{reviews == null && !readFailed ? " " : drawingCountLabel(n)}</span>
              </button>
            );
          })}
        </div>
        {!projects.length && note("No projects yet.", "empty-no-projects")}
        {status}
        <div style={{ marginTop: SPACE.xl, textAlign: "center" }}>
          <button type="button" data-testid="empty-upload-no-project" onClick={onUpload} style={linkBtn}>Upload a file without a project</button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="review-empty" data-state="current-set" style={shell}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: SPACE.lg }}>
        <h2 style={heading}>Current set</h2>
        <button type="button" data-testid="empty-upload" onClick={onUpload} style={linkBtn}>Upload file</button>
      </div>
      {org ? null : <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", marginBottom: SPACE.md, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectName}</div>}
      {status}
      {reviews == null && !readFailed ? note("Loading drawings…", "empty-loading")
        : !index.total && !readFailed ? note("No drawings in this project yet", "empty-no-drawings")
        : index.groups.map((g) => (
          <section key={g.label} data-testid="sheet-group" data-group={g.label} style={{ marginTop: SPACE.xl }}>
            <div style={{ fontSize: FONT_SIZE.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-secondary)", marginBottom: SPACE.sm }}>{g.label}</div>
            <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border-default)", borderRadius: RADIUS.md, overflow: "hidden", background: "var(--surface-raised)" }}>
              {g.rows.map((r, i) => (
                <button key={r.id} type="button" data-testid="sheet-row" data-review-id={r.id} onClick={() => onOpenRow?.(r.fact)}
                  style={{ ...rowBase, padding: `${SPACE.md}px ${SPACE.xl}px`, border: "none", borderTop: i ? "1px solid var(--border-default)" : "none", background: "transparent", fontSize: FONT_SIZE.emphasis }}>
                  {r.sheetNumber && <span style={{ flex: "none", fontWeight: 700 }}>{r.sheetNumber}</span>}
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: r.sheetNumber ? 400 : 600 }}>{r.title}</span>
                  {r.revision && <span style={{ flex: "none", fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>{revText(r.revision)}</span>}
                </button>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
