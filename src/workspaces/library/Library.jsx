/* Library — the project document library workspace.
 *
 * File storage used to live INSIDE Review (FileBrowser was Review's landing screen),
 * which overloaded a module whose job is marking up one drawing. The Library is now its
 * own top-level tab: browse a project's files by discipline, drop PDFs to auto-file them,
 * the upload tray, the "needs filing" holding area. Clicking a file opens it in Review
 * (cross-workspace, via the Shell's onOpenReviewInDocReview intent — the SAME handler the
 * Site Planner's files drawer already uses).
 *
 * The file-storage data layer (reviewStore / auto-filing / file-facts index) stays in
 * doc-review/lib — it is project-scoped and canvas-independent, and both Review (canvas
 * persistence) and the Library (browsing/filing) legitimately share it. Lazy-loaded by
 * the shell, so opening Review never pulls the Library in and vice-versa.
 */
import { useEffect, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import FileBrowser from "./components/FileBrowser.jsx";
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

  // The breadcrumb project name resolves from the local site list (instant; the per-user
  // cloud cache feeds it), falling back to the id. { id, name } | null.
  let projectName = "";
  if (projectId) {
    try { const p = listLocalProjects().find((pp) => pp.id === projectId); if (p) projectName = p.name; } catch (_) {}
  }
  const libraryProject = projectId ? { id: projectId, name: projectName || "Project" } : null;

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
      />
    </div>
  );
}
