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
import { useCallback, useEffect, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import FileBrowser from "./components/FileBrowser.jsx";
import FolderTree from "./components/FolderTree.jsx";
import { autofilingProvider } from "../doc-review/lib/autofiling.js";
import { cloudReady } from "../doc-review/lib/reviewStore.js";
import { onAuthChange } from "../site-planner/lib/auth.js";
import { listProjects as listLocalProjects } from "../../shared/projects/projects.js";

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
  useEffect(() => {
    let live = true;
    const r = () => cloudReady().then((v) => live && setSignedIn(v));
    r();
    const off = onAuthChange(r);
    return () => { live = false; off && off(); };
  }, []);

  // Unified-view wiring: FolderTree publishes its rows up; FileBrowser places files by those
  // rows and publishes rolled-up per-folder counts back down. Selection filters the list.
  const [folderRows, setFolderRows] = useState([]);
  const [selectedFolderId, setSelectedFolderId] = useState(null); // null = All files
  const [folderCounts, setFolderCounts] = useState(null); // Map folderId → n (null key = total)
  const onRowsChange = useCallback((rows) => setFolderRows(rows), []);
  const onFolderCounts = useCallback((counts) => setFolderCounts(counts), []);

  // Selection is per project — switching projects resets to "All files".
  useEffect(() => { setSelectedFolderId(null); setFolderRows([]); setFolderCounts(null); }, [projectId]);

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

      <div data-testid={folderMode ? "library-unified" : undefined} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
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
            />
          ) : null}
        />
      </div>
    </div>
  );
}
