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
 * Adding files still happens inside a project (auto-filing never guesses a project), so the
 * import affordance here is a pointer, not a drop zone.
 */
import { useEffect, useState } from "react";
import { listPins, removePin, subscribePins } from "../../../shared/pins/pinStore.js";
import { listRecents } from "../../../shared/recents/recentDocs.js";
import { listReviews } from "../../doc-review/lib/reviewStore.js";
import { listProjects as listLocalProjects } from "../../../shared/projects/projects.js";

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

/* One pinned/recent FILE row-card. `doc` is the matched doc_reviews row (null = missing). */
function FileCard({ pin, doc, projectName, when, onOpen, onUnpin }) {
  const missing = !doc;
  const title = doc ? (doc.title || doc.item || "Untitled drawing") : (pin?.label || "Missing drawing");
  return (
    <div style={{ ...cardBase, cursor: "default" }}>
      <button onClick={missing ? undefined : onOpen} disabled={missing} title={missing ? undefined : "Open in Review"}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9, textAlign: "left", border: "none", background: "transparent", padding: 0, fontFamily: "inherit", cursor: missing ? "default" : "pointer" }}>
        <span aria-hidden style={{ flex: "none", color: "var(--accent-library-text)" }}>📄</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: missing ? "var(--text-secondary)" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </span>
          <span style={{ display: "block", fontSize: 10.5, color: missing ? "var(--danger-text)" : "var(--text-tertiary)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {missing ? "Can't find this drawing anymore — it may have been deleted." : [projectName, doc.discipline, when].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      {onUnpin && <button onClick={onUnpin} title="Unpin" style={starBtn}>★</button>}
    </div>
  );
}

/* One pinned FOLDER chip-card. Existence is validated on click (the Library's ghost-
 * selection guard falls back to "All files" if the folder is gone). */
function FolderCard({ pin, projectName, onOpen, onUnpin }) {
  return (
    <div style={{ ...cardBase, cursor: "default", padding: "7px 9px" }}>
      <button onClick={onOpen} title="Open this folder in its project"
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, textAlign: "left", border: "none", background: "transparent", padding: 0, fontFamily: "inherit", cursor: "pointer" }}>
        <span aria-hidden style={{ flex: "none", color: "var(--accent-library-text)" }}>📁</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pin.label || "Folder"}</span>
          {projectName && <span style={{ display: "block", fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectName}</span>}
        </span>
      </button>
      <button onClick={onUnpin} title="Unpin" style={starBtn}>★</button>
    </div>
  );
}

export default function LibraryHome({ uid = null, active = true, onOpenFile, onOpenFolder, onPickProject }) {
  const [pins, setPins] = useState([]);
  const [recents, setRecents] = useState([]);
  const [reviews, setReviews] = useState([]);   // doc_reviews rows, for names/projects on cards
  const [loading, setLoading] = useState(true);

  // Local, instant; the per-user cloud cache feeds it.
  let projects = [];
  try { projects = listLocalProjects(); } catch (_) { projects = []; }
  const projName = (id) => { const p = projects.find((x) => x.id === id); return p ? p.name : ""; };

  useEffect(() => {
    if (!active) return; // keep-alive: reload pins/recents/names each time Home comes back on screen
    let live = true;
    const load = async () => {
      const [p, r] = await Promise.all([listPins(uid), Promise.resolve(listRecents(uid))]);
      if (!live) return;
      setPins(p); setRecents(r);
    };
    load();
    const off = subscribePins(load);
    (async () => {
      try { const rows = await listReviews(); if (live) setReviews(rows || []); }
      catch (_) { /* names degrade to pin labels; cards still render */ }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; off(); };
  }, [uid, active]);

  const byId = new Map(reviews.map((r) => [r.id, r]));
  const docProject = (doc, fallback) => (doc && (doc.project_id || doc.projectId)) || fallback || null;
  const openDoc = (id, fallbackProjectId) => {
    const doc = byId.get(id);
    onOpenFile?.(doc || { id, project_id: fallbackProjectId || null });
  };

  const pinnedFolders = pins.filter((p) => p.type === "folder");
  const pinnedFiles = pins.filter((p) => p.type === "file");
  // Recents: skip entries that no longer resolve to a review (deleted docs age out silently
  // here — unlike pins, recents are transient, not user-curated).
  const recentCards = recents.map((r) => ({ ...r, doc: byId.get(r.id) })).filter((r) => r.doc).slice(0, 10);
  const nothingSaved = !pinnedFolders.length && !pinnedFiles.length && !recentCards.length;

  return (
    <div data-testid="library-home" style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--surface-page)", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "10px 20px 28px" }}>

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
                  <FolderCard key={`folder:${p.id}`} pin={p} projectName={projName(p.projectId)}
                    onOpen={() => onOpenFolder?.({ projectId: p.projectId, folderId: p.id })}
                    onUnpin={() => removePin(uid, { type: "folder", id: p.id })} />
                ))}
              </div>
            )}
            {pinnedFiles.map((p) => {
              const doc = byId.get(p.id) || null;
              return (
                <div key={`file:${p.id}`} style={{ marginBottom: 6 }}>
                  <FileCard pin={p} doc={doc} projectName={projName(docProject(doc, p.projectId))}
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
                  when={fmtWhen(r.openedAt)} onOpen={() => openDoc(r.id, r.projectId)} />
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
      </div>
    </div>
  );
}
