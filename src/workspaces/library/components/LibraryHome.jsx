/* LibraryHome — the Library's landing surface (owner request, 2026-07-05): a File-Explorer-
 * style "main menu" with Pinned favorites and Recent drawings, instead of dropping straight
 * into a giant tree + drag area. Renders when the Library opens with NO project selected
 * (the surface that used to be a bare "Pick a project" note).
 *
 *   • PINNED — folders (☆ star on a tree row) and files (☆ on a file card) the user chose.
 *     A pin whose target no longer resolves shows loudly as "missing" with an unpin — never
 *     silently dropped.
 *   • RECENT — drawings recently OPENED in Review (local opened-list, not updated_at).
 *   • PROJECTS — every project as a card; click = open that project's Library view.
 *
 *   • UNFILED (NEW-2) — files saved from Review with no project selected. They belong to no project's view, so
 *     this is the one place they are listed: open one, or "Move to project…" to file it for real.
 *
 *   • DELETE (B2086368) — Recent and Unfiled rows carry the same ✕ the project folder tree has, and a "Recently deleted"
 *     bin (Restore / Delete forever) is reachable from here too. One shared implementation: ./ReviewTrash.jsx.
 *
 * Adding files still happens inside a project (auto-filing never guesses a project), so the
 * import affordance here is a pointer, not a drop zone.
 */
import { useEffect, useState } from "react";
import { listPins, removePin, subscribePins, pinnedFolderLabel } from "../../../shared/pins/pinStore.js";
import { listFolders } from "../lib/folders.js";
import { listRecents } from "../../../shared/recents/recentDocs.js";
import { listReviews, listDeletedReviews } from "../../doc-review/lib/reviewStore.js";
import { useReviewTrash, TrashNotice, UndoToast, RecentlyDeletedList, DeleteButton } from "./ReviewTrash.jsx";
import { listProjects as listLocalProjects } from "../../../shared/projects/projects.js";
import { liveProjectIds } from "../../../shared/projects/docProjectLiveness.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { unfiledRows } from "../../doc-review/lib/unfiled.js";
import { fileReviewIntoProject } from "../lib/fileIntoProject.js";
import { subscribeLibraryChanged } from "../../../shared/library/libraryChanged.js";
import { fileTypeTag } from "../lib/fileTypeTag.js";

const SectionHead = ({ children }) => (
  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-tertiary)", margin: "18px 2px 8px" }}>{children}</div>
);

const cardBase = {
  display: "flex", alignItems: "center", gap: 9, textAlign: "left",
  border: "1px solid var(--border-default)", borderRadius: 9, padding: "9px 11px",
  background: "var(--surface-raised)", color: "var(--text-primary)",
  cursor: "pointer", fontFamily: "inherit", minWidth: 0,
};

const starBtn = {
  flex: "none", border: "none", background: "transparent", cursor: "pointer",
  color: "var(--accent-library-text)", fontSize: 14, padding: 2, lineHeight: 1,
};

const fmtWhen = (ms) => { try { return ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; } catch (_) { return ""; } };

/* One pinned/recent FILE row-card. `doc` is the matched doc_reviews row (null = missing).
 * `missing` defaults to `!doc` but the caller may pass an explicit override — a pin whose doc
 * resolves fine but is filed under a DEAD project (B1340368) is just as unopenable and gets
 * the identical "missing" treatment, not a silent difference the caller would have to repeat. */
/* B2084481 - the file's type (DOC / DOCX / TXT / PDF…), so a .doc and the .docx saved from it never read alike. */
function TypeTag({ doc }) {
  const tag = fileTypeTag(doc);
  return (
    <span data-testid="file-type-tag" title="File type"
      style={{ marginLeft: 7, padding: "1px 6px", borderRadius: RADIUS.sm, border: "1px solid var(--border-default)", background: "var(--hover-ghost)", color: "var(--text-secondary)", fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.03em", verticalAlign: "1px" }}>{tag}</span>
  );
}

export function FileCard({ pin, doc, missing = !doc, projectName, when, onOpen, onUnpin, trash }) {
  const title = doc ? (doc.title || doc.item || "Untitled drawing") : (pin?.label || "Missing drawing");
  return (
    <div style={{ ...cardBase, cursor: "default" }}>
      <button onClick={missing ? undefined : onOpen} disabled={missing} title={missing ? undefined : "Open in Review"}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9, textAlign: "left", border: "none", background: "transparent", padding: 0, fontFamily: "inherit", cursor: missing ? "default" : "pointer" }}>
        <span aria-hidden style={{ flex: "none", color: "var(--accent-library-text)" }}>📄</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: missing ? "var(--text-secondary)" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}{doc && <TypeTag doc={doc} />}
          </span>
          <span style={{ display: "block", fontSize: 10.5, color: missing ? "var(--danger-text)" : "var(--text-tertiary)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {missing
              ? (doc ? "Can't open this — its project has been deleted." : "Can't find this drawing anymore — it may have been deleted.")
              : [projectName, doc.discipline, when].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      {onUnpin && <button onClick={onUnpin} title="Unpin" style={starBtn}>★</button>}
      {trash && <DeleteButton id={doc.id} label={title} {...trash} />}
    </div>
  );
}

/* One pinned FOLDER chip-card. Existence is validated on click (the Library's ghost-
 * selection guard falls back to "All files" if the folder is gone). */
function FolderCard({ pin, label, projectName, onOpen, onUnpin }) {
  return (
    <div style={{ ...cardBase, cursor: "default", padding: "7px 9px" }}>
      <button onClick={onOpen} title="Open this folder in its project"
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left", border: "none", background: "transparent", padding: 0, fontFamily: "inherit", cursor: "pointer" }}>
        <span aria-hidden style={{ flex: "none", color: "var(--accent-library-text)" }}>📁</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label || pin.label || "Folder"}</span>
          {projectName && <span style={{ display: "block", fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectName}</span>}
        </span>
      </button>
      <button onClick={onUnpin} title="Unpin" style={starBtn}>★</button>
    </div>
  );
}

/* One Unfiled row: the file (opens in Review) + a "Move to project…" picker that files it for real. */
export function UnfiledCard({ doc, projects = [], busy = false, onOpen, onMove, onHistory, trash }) {
  const title = doc.title || doc.sfile || doc.item || "Untitled file";
  return (
    <div data-testid="unfiled-row" data-review-id={doc.id} style={{ ...cardBase, cursor: "default", flexWrap: "wrap" }}>
      <button onClick={onOpen} title="Open in Review"
        style={{ flex: "1 1 160px", minWidth: 0, display: "flex", alignItems: "center", gap: 9, textAlign: "left", border: "none", background: "transparent", padding: 0, fontFamily: "inherit", cursor: "pointer", color: "inherit" }}>
        <span aria-hidden style={{ flex: "none", color: "var(--accent-library-text)" }}>📄</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: FONT_SIZE.emphasis, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}<TypeTag doc={doc} /></span>
          <span style={{ display: "block", fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", marginTop: 2 }}>{[doc.discipline, fmtWhen(Date.parse(doc.updated_at || "") || 0)].filter(Boolean).join(" · ")}</span>
        </span>
      </button>
      {onHistory && <button onClick={onHistory} title="Version history — see earlier saved versions" data-testid="library-version-history"
        style={{ flex: "none", fontSize: FONT_SIZE.label, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: RADIUS.sm, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-secondary)", padding: "3px 8px" }}>Versions</button>}
      <select aria-label={`Move “${title}” to a project`} data-testid="unfiled-move" disabled={busy || !projects.length} value=""
        onChange={(e) => { if (e.target.value) onMove?.(e.target.value); }}
        style={{ flex: "0 1 170px", minWidth: 0, maxWidth: "100%", minHeight: 30, fontSize: FONT_SIZE.control, fontFamily: "inherit", borderRadius: RADIUS.sm, border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)" }}>
        <option value="">{busy ? "Moving…" : projects.length ? "Move to project…" : "No projects yet"}</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name || "Untitled project"}</option>)}
      </select>
      {trash && <DeleteButton id={doc.id} label={title} {...trash} />}
    </div>
  );
}

export default function LibraryHome({ uid = null, active = true, onOpenFile, onOpenHistory, onOpenFolder, onPickProject }) {
  const [pins, setPins] = useState([]);
  const [recents, setRecents] = useState([]);
  const [reviews, setReviews] = useState([]);   // doc_reviews rows, for names/projects on cards
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(null);   // review id mid-move
  const [deletedRows, setDeletedRows] = useState([]); // soft-deleted reviews — the Recently deleted bin
  const [showDeleted, setShowDeleted] = useState(false);
  const [moveNote, setMoveNote] = useState(null); // { ok, text } — said out loud either way, never silent
  // B1953793 — pinned folders show their LIVE name (a rename must not leave a stale pin-time
  // snapshot); `pin.label` is only the fallback when the folder can't be resolved.
  const [folderNames, setFolderNames] = useState(() => new Map());
  // B1340368 — a resolved doc's OWN project can be dead (soft-deleted or fully purged) even
  // though the doc_reviews row itself is fine, exactly the "Last document" card's own bug on
  // this workspace's own Pinned/Recent surfaces: a pin or recent whose doc resolves fine still
  // dead-ends on click if what it's filed under is gone. `deadProjectIds` is the Set of project
  // ids referenced here that are confirmed NOT live; empty (never marks anything dead) until
  // the check resolves, and stays empty on a failed/inconclusive check — fail OPEN, same as the
  // Dashboard card, never hide a pin/recent on a maybe.
  const [deadProjectIds, setDeadProjectIds] = useState(new Set());

  // Local, instant; the per-user cloud cache feeds it.
  let projects = [];
  try { projects = listLocalProjects(); } catch (_) { projects = []; }
  const projName = (id) => { const p = projects.find((x) => x.id === id); return p ? p.name : ""; };

  useEffect(() => {
    if (!active) return; // keep-alive: reload pins/recents/names each time Home comes back on screen
    let live = true;
    const load = async () => {
      // A cloud read failure REJECTS (distinct from an empty account) — keep the currently
      // shown pins/recents rather than blanking the Pinned section on a transient blip.
      try {
        const [p, r] = await Promise.all([listPins(uid), Promise.resolve(listRecents(uid))]);
        if (!live) return;
        setPins(p); setRecents(r);
      } catch (_) { /* transient cloud read failure (already reported): keep prior */ }
    };
    load();
    const off = subscribePins(load);
    const loadReviews = async () => {
      try { const rows = await listReviews(); if (live) setReviews(rows || []); }
      catch (_) { /* names degrade to pin labels; cards still render */ }
      try { const dead = await listDeletedReviews(); if (live && dead !== null) setDeletedRows(dead); } // null = failed read → keep the last-known bin
      catch (_) { /* the bin keeps its last-known contents */ }
      finally { if (live) setLoading(false); }
    };
    loadReviews();
    // B2084480 - a save/refile/delete made in Review (this tab or another) re-reads the shelf without a reload.
    const offLib = subscribeLibraryChanged(() => { load(); loadReviews(); });
    return () => { live = false; off(); offLib(); };
  }, [uid, active]);

  const byId = new Map(reviews.map((r) => [r.id, r]));
  // Delete / undo / restore / delete-forever — the SAME code the project folder tree runs. Every one announces via
  // libraryChanged (reviewStore), which re-reads this surface; the explicit refresh covers the bin read too.
  const reloadAll = async () => {
    try { const rows = await listReviews(); setReviews(rows || []); } catch (_) { /* keep last list */ }
    try { const dead = await listDeletedReviews(); if (dead !== null) setDeletedRows(dead); } catch (_) { /* keep last bin */ }
  };
  const trash = useReviewTrash({ titleOf: (id) => { const d = byId.get(id); return d && (d.title || d.sfile || d.item); }, refresh: reloadAll });
  const rowTrash = (id) => ({ armed: trash.pendingDel === id, onArm: trash.setPendingDel, onCancel: () => trash.setPendingDel(null), onConfirm: trash.del });
  const docProject = (doc, fallback) => (doc && (doc.project_id || doc.projectId)) || fallback || null;
  const openHistory = (id) => { const doc = byId.get(id); onOpenHistory?.(doc || { id, project_id: null }); }; // B2034128
  const openDoc = (id, fallbackProjectId) => {
    const doc = byId.get(id);
    onOpenFile?.(doc || { id, project_id: fallbackProjectId || null });
  };

  // B1340368 — check liveness for every project id this screen's pins/recents actually
  // reference, once `reviews` has resolved them to real project ids (pins/recents alone only
  // carry a FALLBACK id from before the doc loaded). Re-runs whenever the candidate set changes.
  useEffect(() => {
    if (!active) return;
    let live = true;
    const ids = new Set();
    for (const p of pins) { const pid = docProject(byId.get(p.id), p.projectId); if (pid) ids.add(pid); }
    for (const r of recents) { const pid = docProject(byId.get(r.id), r.projectId); if (pid) ids.add(pid); }
    if (!ids.size) { setDeadProjectIds(new Set()); return; }
    liveProjectIds([...ids])
      .then((liveSet) => { if (live) setDeadProjectIds(new Set([...ids].filter((id) => !liveSet.has(id)))); })
      .catch(() => { if (live) setDeadProjectIds(new Set()); }); // inconclusive → fail open
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, recents, reviews, active]);

  const pinnedFolders = pins.filter((p) => p.type === "folder");
  const pinnedFolderProjectKey = [...new Set(pinnedFolders.map((p) => p.projectId).filter(Boolean))].sort().join(",");
  useEffect(() => {
    if (!active || !pinnedFolderProjectKey) return;
    let live = true;
    Promise.all(pinnedFolderProjectKey.split(",").map((pid) => listFolders(pid).catch(() => [])))
      .then((lists) => { if (live) setFolderNames(new Map(lists.flat().map((f) => [f.id, f]))); })
      .catch(() => { /* fallback to the pin-time label */ });
    return () => { live = false; };
  }, [pinnedFolderProjectKey, active, pins]);
  const pinnedFiles = pins.filter((p) => p.type === "file");
  const projectIsDead = (pid) => !!pid && deadProjectIds.has(pid);
  // Recents: skip entries that no longer resolve to a review, OR whose filed project is dead
  // (deleted docs — and now dead-project docs — age out silently here — unlike pins, recents
  // are transient, not user-curated).
  const recentCards = recents.map((r) => ({ ...r, doc: byId.get(r.id) }))
    .filter((r) => r.doc && !projectIsDead(docProject(r.doc, r.projectId)))
    .slice(0, 10);
  const unfiled = unfiledRows(reviews);
  const nothingSaved = !pinnedFolders.length && !pinnedFiles.length && !recentCards.length && !unfiled.length;
  const moveUnfiled = async (doc, pid) => {
    const proj = projects.find((p) => p.id === pid);
    setMoving(doc.id); setMoveNote(null);
    try {
      const res = await fileReviewIntoProject({ f: { id: doc.id, item: doc.item || "", sourceFile: doc.sfile || "" }, projectId: pid, projectName: (proj && proj.name) || "", discipline: doc.discipline || "Other" });
      if (!res.ok) { setMoveNote({ ok: false, text: `Couldn’t move “${doc.title || doc.sfile || "this file"}” — ${res.error}. Nothing was changed.` }); return; }
      setReviews((rs) => rs.filter((r) => r.id !== doc.id));
      setMoveNote({ ok: true, text: `Moved “${doc.title || doc.sfile || "the file"}” to ${(proj && proj.name) || "the project"}.${res.notice ? " " + res.notice : ""}` });
    } catch (e) {
      setMoveNote({ ok: false, text: `Couldn’t move that file — ${(e && e.message) || "the save failed"}. Nothing was changed.` });
    } finally { setMoving(null); }
  };

  return (
    <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
    <div data-testid="library-home" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--surface-page)", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "10px 20px 56px" }}>{/* NEW-3 — bottom room: last card scrolls clear of the Help "?" */}

        <TrashNotice notice={trash.delNotice} onDismiss={() => trash.setDelNotice(null)} style={{ margin: "8px 2px 0" }} />
        {(deletedRows.length > 0 || showDeleted) && (
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setShowDeleted((v) => !v)} data-testid="library-home-recently-deleted"
              title="Deleted files wait here ~30 days — restore them or delete them forever"
              style={{ fontSize: FONT_SIZE.control, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: RADIUS.pill, padding: "4px 12px", whiteSpace: "nowrap",
                border: "1px solid var(--border-default)", background: showDeleted ? "var(--hover-menu)" : "var(--surface-raised)", color: "var(--text-secondary)" }}>
              ↺ Recently deleted · {deletedRows.length}
            </button>
          </div>
        )}
        {showDeleted ? (
          <div style={{ marginTop: 10 }}>
            <RecentlyDeletedList rows={deletedRows} pendingPurge={trash.pendingPurge} setPendingPurge={trash.setPendingPurge} onRestore={trash.restoreRow} onPurge={trash.purgeRow} />
          </div>
        ) : (<>

        {nothingSaved && !loading && (
          <div style={{ margin: "26px 2px 4px", color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
            <b style={{ color: "var(--text-primary)", fontSize: 15 }}>Your Library home</b>
            <p style={{ margin: "6px 0 0" }}>
              Pin the folders and drawings you use most — click the <span style={{ color: "var(--accent-library-text)", fontWeight: 700 }}>☆ star</span> on
              any folder row or file card inside a project — and they'll live here. Drawings you open in Review show up under Recent automatically.
            </p>
          </div>
        )}

        {(pinnedFolders.length > 0 || pinnedFiles.length > 0) && (
          <>
            <SectionHead>Pinned</SectionHead>
            {pinnedFolders.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8, marginBottom: pinnedFiles.length ? 8 : 0 }}>
                {pinnedFolders.map((p) => (
                  <FolderCard key={`folder:${p.id}`} pin={p} label={pinnedFolderLabel(p, folderNames)} projectName={projName(p.projectId)}
                    onOpen={() => onOpenFolder?.({ projectId: p.projectId, folderId: p.id })}
                    onUnpin={() => removePin(uid, { type: "folder", id: p.id })} />
                ))}
              </div>
            )}
            {pinnedFiles.map((p) => {
              const doc = byId.get(p.id) || null;
              const pid = docProject(doc, p.projectId);
              return (
                <div key={`file:${p.id}`} style={{ marginBottom: 6 }}>
                  <FileCard pin={p} doc={doc} missing={!doc || projectIsDead(pid)} projectName={projName(pid)}
                    when={doc ? fmtWhen(Date.parse(doc.updated_at || "") || 0) : ""}
                    onOpen={() => openDoc(p.id, p.projectId)}
                    onUnpin={() => removePin(uid, { type: "file", id: p.id })} />
                </div>
              );
            })}
          </>
        )}

        {recentCards.length > 0 && (
          <>
            <SectionHead>Recent</SectionHead>
            {recentCards.map((r) => (
              <div key={`recent:${r.id}`} style={{ marginBottom: 6 }}>
                <FileCard doc={r.doc} projectName={projName(docProject(r.doc, r.projectId))}
                  when={fmtWhen(r.openedAt)} onOpen={() => openDoc(r.id, r.projectId)} trash={rowTrash(r.id)} />
              </div>
            ))}
          </>
        )}

        {(unfiled.length > 0 || moveNote) && (
          <>
            <SectionHead>Unfiled</SectionHead>
            {moveNote && <div role={moveNote.ok ? "status" : "alert"} data-testid="unfiled-note" style={{ fontSize: FONT_SIZE.control, margin: "0 2px 8px", color: moveNote.ok ? "var(--text-secondary)" : "var(--danger-text)" }}>{moveNote.text}</div>}
            {unfiled.length > 0 && (
              <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", margin: "0 2px 8px" }}>
                Saved from Review with no project selected. Open one, or move it into a project.
              </div>
            )}
            {unfiled.map((d) => (
              <div key={`unfiled:${d.id}`} style={{ marginBottom: 6 }}>
                <UnfiledCard doc={d} projects={projects} busy={moving === d.id}
                  onOpen={() => openDoc(d.id, null)} onMove={(pid) => moveUnfiled(d, pid)} onHistory={onOpenHistory ? () => openHistory(d.id) : undefined} trash={rowTrash(d.id)} />
              </div>
            ))}
          </>
        )}

        <SectionHead>Projects</SectionHead>
        {projects.length === 0 ? (
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5, padding: "4px 2px" }}>
            No projects yet — start one in the Site Planyr tab and its files will live here.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
            {projects.map((p) => (
              <button key={p.id} onClick={() => onPickProject?.(p.id)} title="Open this project's files" style={cardBase}>
                <span aria-hidden style={{ flex: "none", width: 26, height: 26, borderRadius: 7, display: "grid", placeItems: "center", background: "var(--accent-library)", color: "var(--on-accent-library)", fontSize: 12, fontWeight: 800 }}>
                  {(p.name || "P").trim().charAt(0).toUpperCase()}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || "Project"}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 1 }}>Open files</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div style={{ marginTop: 22, padding: "9px 12px", borderRadius: 9, border: "1.5px dashed var(--border-default)", color: "var(--text-tertiary)", fontSize: 11.5, textAlign: "center" }}>
          To add drawings, open a project — files are dropped there so each one lands in the right place (nothing auto-guesses a project).
        </div>
        </>)}
      </div>
    </div>
    <UndoToast undo={trash.undoDel} onUndo={trash.undoDelete} onDismiss={() => trash.setUndoDel(null)} />
    </div>
  );
}
