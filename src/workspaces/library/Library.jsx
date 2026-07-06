/* Library — the project document library workspace.
 *
 * File storage used to live INSIDE Review (FileBrowser was Review's landing screen),
 * which overloaded a module whose job is marking up one drawing. The Library is now its
 * own top-level tab, and since the B650 unification it is ONE view per project (owner
 * call, 2026-07-05 — no Files/Folders tab split):
 *
 *   • LEFT — the project's REAL folder tree (FolderTree, embedded): the standard
 *     01. Hillwood … 12. Bldg Acq skeleton the user edits (add / rename / move / delete),
 *     mirrored one-way into Google Drive. Selecting a folder filters the file list.
 *   • RIGHT — the file list + drop zone + upload tray + "needs filing" holding area
 *     (FileBrowser in folder mode). Files display inside the SAME tree folders the server
 *     files their bytes into (Design → Drawings → discipline → Current/Archive), via one
 *     shared resolver — the screen and Drive can't disagree.
 *
 * Cross-project ("All projects") browsing keeps the classic derived category tree — a
 * folder tree belongs to one project. Clicking a file opens it in Review (cross-workspace,
 * via the Shell's onOpenReviewInDocReview intent).
 *
 * The file-storage data layer (reviewStore / auto-filing / file-facts index) stays in
 * doc-review/lib — it is project-scoped and canvas-independent, and both Review (canvas
 * persistence) and the Library (browsing/filing) legitimately share it. Lazy-loaded by
 * the shell, so opening Review never pulls the Library in and vice-versa.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import FileBrowser from "./components/FileBrowser.jsx";
import FolderTree from "./components/FolderTree.jsx";
import LibraryHome from "./components/LibraryHome.jsx";
import { autofilingProvider } from "../doc-review/lib/autofiling.js";
import { cloudReady, listProjects as listCloudProjects } from "../doc-review/lib/reviewStore.js";
import { onAuthChange, getUser } from "../site-planner/lib/auth.js";
import { listProjects as listLocalProjects } from "../../shared/projects/projects.js";
import { migrateAllProjects } from "./lib/folders.js";
import { listPins, togglePin, subscribePins } from "../../shared/pins/pinStore.js";

// One-time account migration marker (B663): "this account's existing projects were organized
// into the standard tree on this device". Everything the migration does is idempotent server-
// side, so a fresh device re-running it is harmless — the marker only avoids wasted work.
const MIGRATE_KEY = (uid) => `planyr:treeMigrateV1:${uid}`;
// StrictMode double-mount / remount guard — PER ACCOUNT, so signing out and into a different
// account in the same tab still runs that account's one-time migration.
const migrationStartedFor = new Set();

export default function Library({
  shellModule, onShellSwitch, authControl, accountActive = false, onGoDashboard, onNewProject,
  onOpenReviewInDocReview,
  // The active project comes from the URL route (Work Item A) so it survives a module
  // switch; `projectId` is the route's Site-group id (null = pick-a-project), `crossProject`
  // is the all-projects browse mode, and `onNavigate` writes the hash to change either.
  projectId = null, onNavigate, crossProject = false,
} = {}) {
  // Cloud-readiness drives whether the browser can list files (it lives in the account).
  // Re-checks on auth changes so a sign-in/out flips the surface without a reload.
  const [signedIn, setSignedIn] = useState(false);
  const [uid, setUid] = useState(null);
  useEffect(() => {
    let live = true;
    const r = () => cloudReady().then(async (v) => {
      if (!live) return;
      setSignedIn(v);
      try { const u = await getUser(); if (live) setUid((u && u.id) || null); } catch (_) { if (live) setUid(null); }
    });
    r();
    const off = onAuthChange(r);
    return () => { live = false; off && off(); };
  }, []);

  // Pinned folders/files (Library Home). One live list here feeds the ☆ toggles in the
  // folder tree + file cards AND the Home surface (which subscribes on its own too).
  const [pins, setPins] = useState([]);
  useEffect(() => {
    let live = true;
    const load = () => listPins(uid).then((p) => { if (live) setPins(p); });
    load();
    const off = subscribePins(load);
    return () => { live = false; off(); };
  }, [uid]);
  const onTogglePinFolder = useCallback((node) => {
    togglePin(uid, { type: "folder", id: node.id, projectId, label: node.name || "Folder" });
  }, [uid, projectId]);
  const onTogglePinFile = useCallback((f) => {
    togglePin(uid, { type: "file", id: f.id, projectId: f.projectId || projectId || null, label: f.title || f.item || "Drawing" });
  }, [uid, projectId]);

  // Unified-view wiring: FolderTree publishes its rows up; FileBrowser places files by those
  // rows and publishes rolled-up per-folder counts back down. Selection filters the list.
  const [folderRows, setFolderRows] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null); // null = All files
  const [folderCounts, setFolderCounts] = useState(null); // Map folderId → n (null key = total)
  const onRowsChange = useCallback((rows) => setFolderRows(rows), []);
  const onFolderCounts = useCallback((counts) => setFolderCounts(counts), []);

  // Selection is per project — switching projects resets to "All files".
  useEffect(() => { setSelectedFolderId(null); setFolderRows([]); setFolderCounts(null); }, [projectId]);

  // A pinned-folder click from Home lands in two steps: navigate to the folder's project,
  // then select the folder once its tree rows publish. The pending id rides a ref so the
  // reset effect above (which clears selection on the project change) can't wipe it.
  const pendingSelectRef = useRef(null);
  useEffect(() => {
    const want = pendingSelectRef.current;
    if (!want || !folderRows.length) return;
    pendingSelectRef.current = null;
    const row = folderRows.find((r) => r.id === want && !r.trashed);
    // Folder gone (deleted since it was pinned): fall to "All files" — the project still
    // opens, and the pin card on Home is where the user unpins it.
    setSelectedFolderId(row ? want : null);
  }, [folderRows]);
  const openPinnedFolder = useCallback(({ projectId: pid, folderId }) => {
    if (!pid || !folderId) return;
    pendingSelectRef.current = folderId;
    onNavigate?.({ projectId: pid, cross: false });
  }, [onNavigate]);

  // A selection must never point at a deleted/vanished folder (B662 review #6): deleting the
  // selected folder — or an ancestor — republishes rows without it; fall back to "All files"
  // instead of filtering the list by a ghost.
  useEffect(() => {
    if (selectedFolderId == null || !folderRows.length) return;
    const row = folderRows.find((r) => r.id === selectedFolderId);
    if (!row || row.trashed) setSelectedFolderId(null);
  }, [folderRows, selectedFolderId]);

  // ── One-time migration (B663, owner-requested): organize EVERY existing project into the
  // standard tree + move its already-uploaded files into the right Drive folders. Runs once
  // per account (marker), automatically, the first time the Library opens signed-in; honest
  // progress + a Retry on failure (LOUD-FAILURE — never a silent half-migration).
  const [migrate, setMigrate] = useState({ status: "idle", text: "" });
  const runMigration = useCallback(async () => {
    // Pin the identity for the whole run (B663 review #9): the walk stops — and the done-
    // marker is never written — if a different account signs in mid-run.
    let uid = null;
    try { const u = await getUser(); uid = u && u.id; } catch (_) { /* keep null */ }
    if (!uid) return;
    const sameUser = async () => {
      try { const u = await getUser(); return !!u && u.id === uid; } catch (_) { return false; }
    };
    setMigrate({ status: "running", text: "Organizing your projects into folders…" });
    let projects = [];
    try { projects = await listCloudProjects(); } catch (_) { projects = []; }
    // Zero projects = either a truly empty account or a FAILED listing (listProjects swallows
    // errors into []). Either way there is nothing safe to celebrate and nothing was done —
    // do NOT write the permanent marker, do NOT claim success (B663 review #2). The next
    // Library open re-checks cheaply.
    if (!projects.length) { setMigrate({ status: "idle", text: "" }); return; }
    const r = await migrateAllProjects(projects, {
      checkIdentity: sameUser,
      onProgress: ({ index, total, project, phase, mirrorDone, mirrorTotal, moved }) => {
        const step = `${index + 1} of ${total}`;
        const detail = phase === "mirror" && mirrorTotal ? ` — mirroring folders ${mirrorDone} of ${mirrorTotal}`
          : phase === "files" ? ` — moving files${moved ? ` (${moved})` : "…"}` : "";
        setMigrate({ status: "running", text: `Organizing ${project} (${step})${detail}` });
      },
    });
    if (r.ok && (await sameUser())) {
      try { localStorage.setItem(MIGRATE_KEY(uid), new Date().toISOString()); } catch (_) { /* full/blocked storage just means a harmless re-run later */ }
      setMigrate({ status: "done", text: `All ${r.projects} project${r.projects === 1 ? "" : "s"} organized${r.movedFiles ? ` · ${r.movedFiles} file${r.movedFiles === 1 ? "" : "s"} moved into folders` : ""}.` });
    } else if (r.ok) {
      setMigrate({ status: "idle", text: "" }); // account changed right at the end — no marker, no claim
    } else {
      setMigrate({ status: "error", text: r.errors[0] || "The one-time folder organization hit a problem." });
    }
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    (async () => {
      let uid = null;
      try { const u = await getUser(); uid = u && u.id; } catch (_) { /* keep null */ }
      // Per-ACCOUNT session guard (not per component instance): a second account signing in
      // on the same mounted Library still gets its own one-time run (B663 review #6).
      if (!live || !uid || migrationStartedFor.has(uid)) return;
      let done = null;
      try { done = localStorage.getItem(MIGRATE_KEY(uid)); } catch (_) { done = null; }
      if (done) return;
      migrationStartedFor.add(uid);
      runMigration();
    })();
    return () => { live = false; };
  }, [signedIn, runMigration]);

  // The breadcrumb project name resolves from the local site list (instant; the per-user
  // cloud cache feeds it), falling back to the id. { id, name } | null.
  let projectName = "";
  if (projectId) {
    try { const p = listLocalProjects().find((pp) => pp.id === projectId); if (p) projectName = p.name; } catch (_) {}
  }
  const libraryProject = projectId ? { id: projectId, name: projectName || "Project" } : null;

  // Folder mode only makes sense with a project + signed in; FileBrowser gates its own
  // signed-out / pick-a-project states, so the rail simply doesn't mount there.
  const folderMode = !crossProject && !!projectId && signedIn;

  return (
    <div data-testid="library-root" style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--surface-page)", position: "relative" }}>
      <AppHeader
        module={shellModule || "library"}
        onSwitch={onShellSwitch}
        onDashboard={onGoDashboard}
        currentProject={libraryProject}
        cross={crossProject}
        onSelectProject={(id) => onNavigate?.({ projectId: id })}
        onNewProject={onNewProject}
        authControl={authControl}
        accountActive={accountActive}
      />

      {migrate.status !== "idle" && (
        <div role={migrate.status === "error" ? "alert" : "status"} style={{
          flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", fontSize: 12,
          borderBottom: "1px solid var(--border-default)",
          color: migrate.status === "error" ? "var(--danger-text)" : migrate.status === "done" ? "var(--text-secondary)" : "var(--text-secondary)",
          background: "var(--surface-raised)",
        }}>
          <span>{migrate.status === "running" ? "↻" : migrate.status === "done" ? "✓" : "⚠"}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{migrate.text}</span>
          {migrate.status === "error" && (
            <button onClick={runMigration} style={{ flex: "none", border: "none", background: "none", color: "var(--accent-library-text)", cursor: "pointer", font: "inherit", fontWeight: 700 }}>Retry</button>
          )}
          {migrate.status === "done" && (
            <button onClick={() => setMigrate({ status: "idle", text: "" })} title="Dismiss" style={{ flex: "none", border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 13 }}>✕</button>
          )}
        </div>
      )}

      <div data-testid={folderMode ? "library-unified" : undefined} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {signedIn && !projectId && !crossProject ? (
          // The Library HOME (owner request, 2026-07-05): pinned folders/files + recent
          // drawings + project cards — replaces the bare "pick a project" dead end.
          <LibraryHome
            uid={uid}
            onOpenFile={(row) => onOpenReviewInDocReview?.(row)}
            onOpenFolder={openPinnedFolder}
            onPickProject={(id) => onNavigate?.({ projectId: id, cross: false })}
          />
        ) : (
        <FileBrowser
          projectId={projectId}
          projectName={projectName}
          signedIn={signedIn}
          cross={crossProject}
          indexProvider={autofilingProvider}
          // Click a file → open it in Review (cross-workspace). The Shell intent switches the
          // tab AND hands Review the row, which DocReview's docIntent effect consumes on mount.
          onOpenReview={(row) => onOpenReviewInDocReview?.(row)}
          onNavigate={onNavigate}
          folderMode={folderMode}
          folderRows={folderRows}
          selectedFolderId={selectedFolderId}
          onFolderCounts={onFolderCounts}
          pinnedFileIds={new Set(pins.filter((p) => p.type === "file").map((p) => p.id))}
          onTogglePinFile={onTogglePinFile}
          folderRail={folderMode ? (
            <FolderTree
              embedded
              projectId={projectId}
              signedIn={signedIn}
              projectName={projectName}
              selectedId={selectedFolderId}
              onSelect={setSelectedFolderId}
              onRowsChange={onRowsChange}
              fileCounts={folderCounts}
              pinnedIds={new Set(pins.filter((p) => p.type === "folder").map((p) => p.id))}
              onTogglePin={onTogglePinFolder}
            />
          ) : null}
        />
        )}
      </div>
    </div>
  );
}
