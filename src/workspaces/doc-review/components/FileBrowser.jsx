/* FileBrowser (Work Item B) — the Document Review landing surface.
 *
 * The old flat chip row jammed three axes (what kind / what state / how used) into one
 * list, so nothing nested. This separates them:
 *   • a CATEGORY TREE (left) — the one true hierarchy, "what kind of document it is":
 *     canonical top-level (code-defined, stable, always a manual-file target) → data-driven
 *     subcategories (the disciplines actually present). Empty categories don't render.
 *   • a FACET ROW (right) — All · On the map · Reference · Needs filing(n) — filters over
 *     the current node, not folders. Needs filing is loud (a stuck/invisible one is a
 *     silent failure).
 *   • a badged FILE LIST — each row shows its subcategory / state / on-map badge.
 *   • a persistent DROP STRIP (bottom) + drop-anywhere. The title block is read and the
 *     file files itself; no-match → Needs filing for a one-click confirm. Nothing
 *     auto-guesses a project (misfiled is worse than unfiled).
 *
 * Counts + the tree are metadata-only queries (listReviews + listFileFacts); file bytes
 * load only when a file is opened. Reuses the existing reviewStore / uploadQueue plumbing.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  listProjects, listReviews, listFileFacts, fileNewReview, refileReview,
  upsertFileFacts, deleteReview, DISCIPLINES,
} from "../lib/reviewStore.js";
import { toFactsRow, mergeFactsIntoReviews } from "../lib/fileIndex.js";
import {
  buildFileFacts, deriveTree, browseFiles, holdingArea, CATEGORIES,
  categoryOf, subcategoryOf, stateOf, FILE_STATES, FACETS, onMap, isReference, isSpatial,
} from "../../../shared/files/fileFacts.js";
import {
  QUEUE_STATUS, makeQueueItems, splitQueue, runPool,
} from "../../../shared/files/uploadQueue.js";

const fmtDate = (f) => { const s = f.docDate || f.updatedAt; try { return s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""; } catch (_) { return ""; } };

// ---- small styled atoms (theme tokens only — WCAG AA in light + dark) ----
const chip = (active, accent) => ({
  fontSize: 11.5, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 999,
  padding: "4px 11px", whiteSpace: "nowrap",
  border: `1px solid ${active ? "var(--accent-markup)" : "var(--border-default)"}`,
  background: active ? "var(--accent-markup)" : "var(--surface-raised)",
  color: active ? "var(--on-accent)" : "var(--text-secondary)",
});
const Badge = ({ children, tone = "neutral", title }) => {
  const tones = {
    neutral: { bg: "var(--hover-ghost)", fg: "var(--text-secondary)", bd: "var(--border-default)" },
    map: { bg: "rgba(34,197,94,0.14)", fg: "var(--success-text, #15803d)", bd: "rgba(34,197,94,0.4)" },
    ref: { bg: "var(--hover-ghost)", fg: "var(--text-tertiary)", bd: "var(--border-default)" },
    old: { bg: "var(--hover-ghost)", fg: "var(--text-tertiary)", bd: "var(--border-default)" },
  }[tone] || {};
  return (
    <span title={title} style={{ flex: "none", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.03em",
      textTransform: "uppercase", padding: "1px 6px", borderRadius: 5, lineHeight: 1.5,
      background: tones.bg, color: tones.fg, border: `1px solid ${tones.bd}` }}>{children}</span>
  );
};

const FileTypeIcon = ({ kind }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", color: "var(--text-tertiary)" }}>
    {kind === "stitch"
      ? <><rect x="2" y="3" width="5.5" height="10" rx="1" /><rect x="8.5" y="3" width="5.5" height="10" rx="1" /></>
      : <><path d="M4 1.7h5l3 3v9.6H4z" /><path d="M9 1.7v3h3" /></>}
  </svg>
);

export default function FileBrowser({
  projectId = null, projectName = "", signedIn = false, cross = false,
  onOpenReview, onNavigate, indexProvider = null,
}) {
  const [projects, setProjects] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [busy, setBusy] = useState(false);
  const [node, setNode] = useState({ category: null, subcategory: null }); // selected tree node (null = all)
  const [facet, setFacet] = useState("all");
  const [showHolding, setShowHolding] = useState(false);   // "Needs filing" view active
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [openCats, setOpenCats] = useState({});            // category -> expanded?
  const [dropOver, setDropOver] = useState(false);
  const [queue, setQueue] = useState([]);
  const [refileSel, setRefileSel] = useState({});          // fileId -> { category, discipline }
  const [pendingDel, setPendingDel] = useState(null);
  const fileInputRef = useRef(null);
  const reqRef = useRef(0);

  const refresh = async () => {
    if (!signedIn) return;
    const tok = ++reqRef.current;
    setBusy(true);
    try {
      const [p, r, ff] = await Promise.all([listProjects(), listReviews(), listFileFacts()]);
      if (tok !== reqRef.current) return;
      setProjects(p); setReviews(mergeFactsIntoReviews(r, ff));
    } finally { if (tok === reqRef.current) setBusy(false); }
  };
  useEffect(() => { refresh(); }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const projName = (id) => (projects.find((p) => p.id === id) || {}).name || projectName || "";

  // Project-scoped facts (or all, in cross-project mode). Metadata only.
  const facts = useMemo(() => {
    const all = buildFileFacts(reviews);
    if (cross) return all;
    return all.filter((f) => f.projectId === projectId);
  }, [reviews, projectId, cross]);

  const tree = useMemo(() => deriveTree(facts, { includeSuperseded: showSuperseded }), [facts, showSuperseded]);
  const holding = useMemo(() => holdingArea(facts), [facts]);
  const filed = useMemo(() => facts.filter((f) => stateOf(f) !== FILE_STATES.NEEDS_FILING).length, [facts]);
  const shown = useMemo(() => showHolding
    ? holding
    : browseFiles(facts, { ...node, facet, includeSuperseded: showSuperseded }),
    [facts, node, facet, showHolding, showSuperseded, holding]);

  // ---- drop / file pipeline ------------------------------------------------
  const patchItem = (uploadId, patch) => setQueue((q) => q.map((it) => (it.uploadId === uploadId ? { ...it, ...patch } : it)));
  const removeItem = (uploadId) => setQueue((q) => q.filter((it) => it.uploadId !== uploadId));

  const processItem = async (item) => {
    patchItem(item.uploadId, { status: QUEUE_STATUS.PROCESSING, error: null, warn: null });
    try {
      let route = null;
      if (indexProvider && indexProvider.autofileReady && indexProvider.autofile) {
        try { const a = await indexProvider.autofile(item.file, projects); if (a && a.ok) route = a; } catch (_) { route = null; }
      }
      const decision = route ? route.decision : null;
      // We're inside a project → file into it (an explicit act, never a guess). In cross
      // mode, only a confident title-block match routes; else it goes to the holding area.
      const pid = cross ? (decision && decision.matched ? decision.projectId : null) : projectId;
      const discipline = (decision && decision.discipline) || "Other";
      const item_ = (decision && decision.item) || "";
      const docDate = decision ? decision.docDate : null;
      // Low-confidence classify (no project, or no readable discipline) → Needs filing for a
      // one-click confirm — never a guessed category (misfiled is worse than unfiled).
      const needsFiling = !pid || !discipline || discipline === "Other";
      const r = await fileNewReview({ projectId: pid, project: pid ? projName(pid) : "", discipline, item: item_, docDate, blob: item.file, fileName: item.name });
      if (!r || !r.ok) { patchItem(item.uploadId, { status: QUEUE_STATUS.FAILED, error: (r && r.error) || "Couldn't file." }); return; }
      const factsIn = (route && route.facts) ? { ...route.facts } : { discipline, item: item_, docDate };
      factsIn.projectId = pid; factsIn.needsFiling = needsFiling;
      try { await upsertFileFacts(toFactsRow(factsIn, { id: r.id, reviewId: r.id, sourceFile: item.name })); } catch (_) { /* index is best-effort */ }
      let warn = null;
      if (r.oversize) warn = "too large to store (50 MB cap) — re-drop on open";
      else if (r.uploadFailed) warn = "couldn’t be stored — re-drop on open";
      else if (r.driveError) warn = "filed; Drive copy failed";
      patchItem(item.uploadId, { status: needsFiling ? QUEUE_STATUS.NEEDS_FILING : QUEUE_STATUS.DONE, reviewId: r.id, filedAt: Date.now(), warn, target: pid ? projName(pid) : "Holding area" });
    } catch (e) {
      patchItem(item.uploadId, { status: QUEUE_STATUS.FAILED, error: (e && e.message) || "Couldn't file." });
    }
  };

  const ingest = async (fileList) => {
    if (!projectId && !cross) return; // drop gated until a project is chosen (no auto-guess)
    const items = makeQueueItems(fileList);
    if (!items.length) return;
    setQueue((q) => [...items, ...q]);
    const accepted = items.filter((it) => it.status === QUEUE_STATUS.PROCESSING);
    if (accepted.length) { await runPool(accepted, processItem, 3); refresh(); }
  };
  const onDrop = (e) => { e.preventDefault(); e.stopPropagation(); setDropOver(false); ingest(e.dataTransfer?.files); };
  const onPick = (e) => { ingest(e.target.files); e.target.value = ""; };

  const open = (f) => { const r = reviews.find((x) => x.id === f.id); onOpenReview?.(r || f); };
  const del = async (id) => { setPendingDel(null); await deleteReview(id); refresh(); };
  const doRefile = async (f) => {
    const sel = refileSel[f.id] || {};
    const discipline = sel.discipline || f.discipline || "Civil";
    const res = await refileReview(f.id, { projectId: f.projectId || projectId, project: projName(f.projectId || projectId), discipline });
    // Update the index row's category/state too so the tree moves it immediately.
    try { await upsertFileFacts(toFactsRow({ projectId: f.projectId || projectId, discipline, item: f.item, category: sel.category || undefined, needsFiling: false }, { id: f.id, reviewId: f.id, sourceFile: f.title })); } catch (_) {}
    if (res.ok) { setRefileSel((s) => { const n = { ...s }; delete n[f.id]; return n; }); refresh(); }
  };

  // ---- empty / no-project states ------------------------------------------
  if (!signedIn) {
    return <Centered title="Sign in to see your files"
      body="Document files live in your account (sign in from the Site Planner). Until then, open a PDF directly to mark it up." />;
  }
  if (!projectId && !cross) {
    return <Centered title="Pick a project to see its files"
      body="Choose a project from the breadcrumb above to open its file browser. (Dropping a file needs a project so it never has to guess where it belongs.)" />;
  }

  const holdingCount = holding.length;

  return (
    <div onDragOver={(e) => { if (Array.from(e.dataTransfer?.types || []).includes("Files")) { e.preventDefault(); setDropOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropOver(false); }}
      onDrop={onDrop}
      style={{ flex: 1, display: "flex", minHeight: 0, position: "relative", background: "var(--surface-page)", fontFamily: "system-ui, sans-serif" }}>

      {/* ---- LEFT: category tree ---- */}
      <div style={{ flex: "none", width: 244, borderRight: "1px solid var(--border-default)", background: "var(--surface-raised)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "11px 10px 7px 14px" }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {cross ? "All projects" : projName(projectId) || "Project"} · Files
          </span>
          {/* Cross-project mode (Work Item A): browse the tree across every project. Off by
              default; exit by picking a single project in the breadcrumb. */}
          {onNavigate && !cross && projectId && (
            <button onClick={() => onNavigate({ cross: true })} title="Browse files across ALL your projects"
              style={{ flex: "none", fontSize: 9.5, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", border: "1px solid var(--border-default)", borderRadius: 6, background: "var(--surface-page)", color: "var(--text-secondary)", padding: "2px 7px", whiteSpace: "nowrap" }}>
              ⊞ All
            </button>
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 8px" }}>
          <TreeRow label="All files" count={filed} active={!showHolding && !node.category}
            onClick={() => { setShowHolding(false); setNode({ category: null, subcategory: null }); }} bold />
          {tree.length === 0 && (
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", padding: "8px 10px", lineHeight: 1.5 }}>
              No filed documents yet. Drop a PDF below — it reads its own title block and files itself.
            </div>
          )}
          {tree.map((n) => {
            const expanded = openCats[n.category] ?? true;
            const catActive = !showHolding && node.category === n.category && !node.subcategory;
            return (
              <div key={n.category}>
                <TreeRow label={n.category} count={n.count} active={catActive} caret={expanded ? "▾" : "▸"}
                  onCaret={() => setOpenCats((o) => ({ ...o, [n.category]: !expanded }))}
                  onClick={() => { setShowHolding(false); setNode({ category: n.category, subcategory: null }); }} bold />
                {expanded && n.subs.map((s) => (
                  <TreeRow key={s.name} label={s.name} count={s.count} indent
                    active={!showHolding && node.category === n.category && node.subcategory === s.name}
                    onClick={() => { setShowHolding(false); setNode({ category: n.category, subcategory: s.name }); }} />
                ))}
              </div>
            );
          })}
        </div>
        <label style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderTop: "1px solid var(--border-default)", fontSize: 11, color: "var(--text-secondary)", cursor: "pointer" }}
          title="Show files that have been replaced by a newer revision">
          <input type="checkbox" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} /> Show superseded
        </label>
      </div>

      {/* ---- RIGHT: facets + list + drop strip ---- */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {/* facet row (state + usage) */}
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderBottom: "1px solid var(--border-default)", flexWrap: "wrap" }}>
          {FACETS.map((f) => (
            <button key={f.id} onClick={() => { setShowHolding(false); setFacet(f.id); }} style={chip(!showHolding && facet === f.id)}>{f.label}</button>
          ))}
          <span style={{ flex: 1 }} />
          {/* Needs filing — separate + loud (a to-do; a stuck one is a silent failure) */}
          <button onClick={() => setShowHolding((v) => !v)} title="Files that couldn't be confidently classified — one click each to confirm"
            style={{ fontSize: 11.5, fontFamily: "inherit", fontWeight: 800, cursor: "pointer", borderRadius: 999, padding: "4px 12px", whiteSpace: "nowrap",
              border: `1px solid ${holdingCount ? "var(--warn-border, #d6a64a)" : "var(--border-default)"}`,
              background: showHolding ? "var(--warn-text)" : (holdingCount ? "var(--warn-bg, #fef3c7)" : "var(--surface-raised)"),
              color: showHolding ? "var(--on-accent)" : (holdingCount ? "var(--warn-text)" : "var(--text-tertiary)") }}>
            ⚑ Needs filing{holdingCount ? ` · ${holdingCount}` : ""}
          </button>
        </div>

        {/* file list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px 4px" }}>
          {busy && shown.length === 0 && <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: 12 }}>Loading…</div>}
          {!busy && shown.length === 0 && (
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", padding: 16, lineHeight: 1.55 }}>
              {showHolding ? "Nothing waiting to be filed — every document is sorted." : "No files here yet. Drop a PDF below to file it."}
            </div>
          )}
          {shown.map((f) => {
            const st = stateOf(f);
            const mapped = onMap(f), ref = isReference(f), spatial = isSpatial(f);
            const needs = st === FILE_STATES.NEEDS_FILING;
            return (
              <div key={f.id} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", marginBottom: 6, background: "var(--surface-raised)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <button onClick={() => open(f)} title="Open to review / mark up"
                    style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                    <FileTypeIcon kind={f.kind} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.title || f.item}{f.revision ? ` · ${f.revision}` : ""}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                        <Badge title="Subcategory (discipline)">{subcategoryOf(f)}</Badge>
                        {st === FILE_STATES.SUPERSEDED && <Badge tone="old" title="Replaced by a newer revision">superseded</Badge>}
                        {needs && <Badge title="Couldn’t classify confidently">needs filing</Badge>}
                        {mapped && <Badge tone="map" title="Placed on the shared map">on the map</Badge>}
                        {ref && !mapped && <Badge tone="ref" title="Read-only reference — not a map object">reference</Badge>}
                        <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>{fmtDate(f)}</span>
                      </span>
                    </span>
                  </button>
                  {spatial && !mapped && <button onClick={() => onOpenReview && open(f)} title="Open to place this drawing on the map"
                    style={{ flex: "none", fontSize: 10.5, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 6, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-secondary)", padding: "3px 8px" }}>Place</button>}
                  {pendingDel === f.id ? (
                    <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--text-secondary)" }}>
                      <button onClick={() => del(f.id)} title="Confirm delete" style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 2 }}>✓</button>
                      <button onClick={() => setPendingDel(null)} title="Cancel" style={{ border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13, padding: 2 }}>✕</button>
                    </span>
                  ) : (
                    <button onClick={() => setPendingDel(f.id)} title="Delete" style={{ flex: "none", border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: 14, padding: 3 }}>×</button>
                  )}
                </div>
                {/* re-file (re-assign category/subcategory) — inline, never auto-guesses */}
                {(needs || refileSel[f.id]) && (
                  <RefileRow value={refileSel[f.id]} discipline={f.discipline}
                    onChange={(v) => setRefileSel((s) => ({ ...s, [f.id]: v }))} onFile={() => doRefile(f)} />
                )}
              </div>
            );
          })}
        </div>

        {/* persistent processing queue (B260 lean) */}
        <DropQueue queue={queue} onDismiss={removeItem} onTriage={(id) => { setShowHolding(true); removeItem(id); }} />

        {/* persistent drop strip */}
        <input ref={fileInputRef} type="file" accept="application/pdf" multiple style={{ display: "none" }} onChange={onPick} />
        <button onClick={() => fileInputRef.current?.click()}
          style={{ flex: "none", margin: "0 12px 12px", padding: "9px 12px", borderRadius: 9, textAlign: "center", cursor: "pointer", fontFamily: "inherit",
            border: `1.5px dashed ${dropOver ? "var(--accent-markup)" : "var(--border-default)"}`,
            background: dropOver ? "var(--hover-ghost)" : "var(--surface-raised)", color: "var(--text-secondary)" }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Drop, paste, or click to add PDFs</span>
          <span style={{ display: "block", fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 2 }}>
            The title block is read and the file files itself{cross ? "" : ` into ${projName(projectId) || "this project"}`}. Anything it can’t place lands in Needs filing.
          </span>
        </button>
      </div>

      {/* drop-anywhere overlay hint */}
      {dropOver && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", border: "2.5px dashed var(--accent-markup)", borderRadius: 4, background: "rgba(239,159,39,0.06)", display: "grid", placeItems: "center" }}>
          <span style={{ background: "var(--surface-raised)", color: "var(--text-primary)", fontWeight: 700, fontSize: 13, padding: "8px 16px", borderRadius: 999, border: "1px solid var(--border-default)" }}>Drop to file into {cross ? "the matched project" : (projName(projectId) || "this project")}</span>
        </div>
      )}
    </div>
  );
}

function TreeRow({ label, count, active, indent, bold, caret, onCaret, onClick }) {
  return (
    <div style={{ display: "flex", alignItems: "center", borderRadius: 7, background: active ? "var(--hover-menu)" : "transparent", marginBottom: 1 }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--hover-ghost)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
      {caret ? (
        <button onClick={onCaret} aria-label="Toggle" style={{ flex: "none", width: 18, border: "none", background: "transparent", cursor: "pointer", color: "var(--text-tertiary)", fontSize: 10, padding: "6px 0 6px 6px" }}>{caret}</button>
      ) : <span style={{ width: indent ? 26 : 18, flex: "none" }} />}
      <button onClick={onClick} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", padding: "6px 8px 6px 0" }}>
        <span style={{ fontSize: 12.5, fontWeight: bold ? 700 : 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ flex: "none", fontSize: 11, color: "var(--text-tertiary)", fontWeight: 600 }}>{count}</span>
      </button>
    </div>
  );
}

/* Re-file a file: pick a category + discipline (subcategory). A NEW subcategory can be
 * typed, not just chosen. Never auto-guesses. */
function RefileRow({ value = {}, discipline, onChange, onFile }) {
  const ctl = { fontSize: 11, fontFamily: "inherit", border: "1px solid var(--border-default)", borderRadius: 6, padding: "3px 5px", color: "var(--text-primary)", background: "var(--surface-page)" };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 7, paddingTop: 7, borderTop: "1px solid var(--border-default)", flexWrap: "wrap" }}>
      <span style={{ fontSize: 10.5, color: "var(--warn-text)", fontWeight: 700, flex: "none" }}>File as:</span>
      <select value={value.category || ""} onChange={(e) => onChange({ ...value, category: e.target.value })} style={{ ...ctl, flex: "none" }} title="Category (top-level folder)">
        <option value="">Auto</option>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input list="dr-disciplines" value={value.discipline ?? discipline ?? ""} placeholder="Discipline…"
        onChange={(e) => onChange({ ...value, discipline: e.target.value })} style={{ ...ctl, flex: 1, minWidth: 90 }} title="Subcategory (type a new one if needed)" />
      <datalist id="dr-disciplines">{DISCIPLINES.map((d) => <option key={d} value={d} />)}</datalist>
      <button onClick={onFile} title="File this document" style={{ flex: "none", fontSize: 11, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: 6, border: "1px solid var(--accent-markup)", background: "var(--accent-markup)", color: "var(--on-accent)", padding: "3px 11px" }}>File</button>
    </div>
  );
}

/* The persistent processing queue: a row per in-flight / needs-attention file. Filed rows
 * fade out shortly (splitQueue's recent group); exceptions stay until acted on. Never a
 * vanishing toast — a silent processing state is a failure. */
function DropQueue({ queue, onDismiss, onTriage }) {
  const { active } = splitQueue(queue, Date.now());
  if (!active.length) return null;
  const S = QUEUE_STATUS;
  const meta = (it) => ({
    [S.PROCESSING]: { color: "var(--text-secondary)", label: "Reading title block…" },
    [S.DONE]: { color: "var(--success-text, #15803d)", label: it.target ? `Filed · ${it.target}` : "Filed" },
    [S.NEEDS_FILING]: { color: "var(--warn-text)", label: "Needs filing — confirm a discipline" },
    [S.FAILED]: { color: "var(--danger-text)", label: it.error || "Failed" },
    [S.REJECTED]: { color: "var(--danger-text)", label: it.error || "Not a PDF" },
  })[it.status] || { color: "var(--text-secondary)", label: it.status };
  return (
    <div style={{ flex: "none", margin: "0 12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
      {active.map((it) => {
        const m = meta(it);
        return (
          <div key={it.uploadId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", borderRadius: 7, border: "1px solid var(--border-default)", background: "var(--surface-raised)" }}>
            <span style={{ flex: "none", width: 12, textAlign: "center", color: m.color, fontSize: 12 }}>
              {it.status === S.PROCESSING
                ? <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid var(--border-default)", borderTopColor: "var(--text-secondary)", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                : it.status === S.DONE ? "✓" : "⚠"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
              <div style={{ fontSize: 10, color: m.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}{it.warn ? ` · ${it.warn}` : ""}</div>
            </div>
            {it.status === S.NEEDS_FILING && <button onClick={() => onTriage(it.uploadId)} style={miniBtn}>Triage</button>}
            {(it.status === S.FAILED || it.status === S.REJECTED) && <button onClick={() => onDismiss(it.uploadId)} style={miniBtn}>Dismiss</button>}
          </div>
        );
      })}
    </div>
  );
}
const miniBtn = { flex: "none", fontSize: 10, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: 5, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-secondary)", padding: "2px 8px" };

function Centered({ title, body }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 28, background: "var(--surface-page)", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  );
}
