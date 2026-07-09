/* App shell — the top-level surface that hosts each workspace. The shared
 * two-row AppHeader is now rendered by each workspace (so it has access to
 * workspace-specific toolbar content). The shell's job is auth, module
 * switching state, and building the auth-control slot that AppHeader needs.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { supabaseConfigured } from "../workspaces/site-planner/lib/supabase.js";
import { onAuthChange } from "../workspaces/site-planner/lib/auth.js";
import { setScheduleLink } from "../workspaces/site-planner/lib/storage.js";
import AuthPanel from "../workspaces/site-planner/components/AuthPanel.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import ModuleLoader from "../shared/ui/ModuleLoader.jsx";
import AccountControl from "./AccountControl.jsx";
import { useProfile } from "../shared/profile/useProfile.js";
import { prefetchOnIdle } from "./modulePrefetch.js";
import { setTelemetryModule } from "../shared/telemetry/clientErrors.js";
import { useHashRoute, INITIAL_HASH_EMPTY } from "./route.js";
import { writeLastRoute, seedBootRoute } from "./lastRoute.js";

// "Open where I left off": on an empty-hash boot, seed the URL from the stored last-route
// pointer BEFORE the first render (so useHashRoute's initial read sees it). Runs at module
// scope — after route.js captured INITIAL_HASH_EMPTY, so deep links (incl. "#/") still win
// and resumeAllowed stays true for the Site Planner's own plan-level resume.
seedBootRoute();

// Workspace registry — each Comp is lazy-loaded (separate bundle chunk).
const WORKSPACES = [
  { id: "site-planner", label: "Site Planyr",     Comp: lazy(() => import("../workspaces/site-planner/SitePlannerApp.jsx")) },
  { id: "doc-review",   label: "Review", Comp: lazy(() => import("../workspaces/doc-review/DocReview.jsx")) },
  { id: "library",      label: "Library", Comp: lazy(() => import("../workspaces/library/Library.jsx")) },
  { id: "scheduler",    label: "Sequence Planyr",  Comp: lazy(() => import("../workspaces/scheduler/Scheduler.jsx")) },
];

// Chrome color is a theme token so the shell themes WITH the app (B318). (The account
// pill/dropdown styling moved into AccountControl.jsx with the control itself — B734.)
const CHROME = "var(--chrome-bg)";

export default function Shell() {
  // The active project + workspace now live in the URL hash (Work Item A), so the
  // project survives a module switch, deep-links, and refreshes — instead of being
  // module-local state that's lost on the way into Document Review. The breadcrumb and
  // every workspace read the project from here, not from their own state.
  const [route, navigate] = useHashRoute();
  const active    = route.module;     // workspace id
  const projectId = route.projectId;  // active Site-group id | null
  const cross     = route.cross;      // cross-project mode
  const [user,      setUser]      = useState(null);
  const [authOpen,  setAuthOpen]  = useState(false);
  const [recovery,  setRecovery]  = useState(false);
  const [authTab,   setAuthTab]   = useState("profile"); // which tab the account modal opens on
  // The account pill/dropdown + "Cloud off" popover now live in AccountControl, which owns its
  // own anchor ref + open state per mounted header instance (B734) — Shell only drives the modal.
  // Cross-workspace navigation (B191–B193, now URL-driven for project context). The
  // breadcrumb's "Dashboard" / "select project" simply change the hash; only the two
  // *side-effecting* actions still need a signal: creating a new project (born in the
  // Site Planner) and opening a specific review file (Document Review is lazy-mounted).
  const switchModule = (id) => navigate({ module: id });
  const goDashboard  = () => navigate({ module: "site-planner", projectId: null, cross: false });
  // "New project" from anywhere: land in the Site Planner and tell it to start a blank
  // site. A monotonic tick (not a project id — the blank isn't saved yet) re-fires on
  // each click; the Site Planner writes the real id into the URL once it exists.
  const [newProjectTick, setNewProjectTick] = useState(0);
  const newProject = () => { navigate({ module: "site-planner", projectId: null, cross: false }); setNewProjectTick((n) => n + 1); };
  // Cross-workspace "open this file" intent (NEW-1). The global Project Files panel is
  // reachable from every workspace, but Document Review is lazy-mounted — so a file clicked
  // from the Site side can't be handed to a component that doesn't exist yet. We route to
  // Document Review WITH the file's project (so the breadcrumb + browser land on it), and
  // stash the requested review (token-stamped so a repeat click re-fires) for DR to open
  // once it mounts. Without this the open is dropped and DR boots to its placeholder.
  const [docIntent, setDocIntent] = useState(null);
  const openReviewInDocReview = (row) => {
    const pid = row && (row.project_id ?? row.projectId ?? null);
    setDocIntent({ kind: "open-review", row, token: Date.now() });
    navigate({ module: "doc-review", projectId: pid || null, cross: false });
  };
  // Cross-module schedule link (the Schedule + the Site Planner live in SEPARATE cloud backends
  // and can't read each other). When the embedded Schedule app reports a link set/created, mirror
  // the lightweight hint onto the Site Planner side so the Site dashboard can show "has a schedule"
  // without booting the iframe. The Schedule record stays the source of truth; this is the copy.
  const scheduleLinkChanged = (groupId, info) => {
    if (!groupId) return; // a clear with no group can't be mirrored; the stale hint self-heals on relink
    try { setScheduleLink(groupId, info || {}); } catch (_) {}
  };

  useEffect(() => {
    if (!supabaseConfigured()) return;
    return onAuthChange((event, u) => {
      setUser(u);
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); setAuthOpen(true); }
    });
  }, []);

  // B223 — once boot is idle, quietly warm the non-active workspaces (chunk +,
  // for Schedule, the heavy /sequence/ iframe doc) so switching to them feels
  // instant. Lazy-loading still gates the first paint; this only runs after.
  useEffect(() => { prefetchOnIdle(["scheduler", "doc-review", "library"]); }, []);

  // B279 — tag telemetry rows with the workspace the user is in, so a reported error
  // says WHERE it happened (site-planner / doc-review / scheduler).
  useEffect(() => { setTelemetryModule(active); }, [active]);

  // "Open where I left off" — persist every route change as the last-route pointer.
  // Single choke point: catches tab clicks, breadcrumb picks, and programmatic navigates.
  useEffect(() => { writeLastRoute(route); }, [route]);

  // Keep-alive (owner request, 2026-07-05: "cleaner/faster switch between modules"): every
  // workspace the user has VISITED stays mounted, hidden with display:none, instead of being
  // torn down on each tab switch. Switching back is instant — the open drawing, map view,
  // file list, and the booted Schedule iframe all survive. Hidden workspaces still follow
  // the route's project (their route→state effects stay live); writing to the URL and global
  // keyboard handling are gated on the `isActive` prop each workspace now receives.
  const [visited, setVisited] = useState(() => new Set([active]));
  useEffect(() => { setVisited((v) => (v.has(active) ? v : new Set(v).add(active))); }, [active]);

  // Profile (name/org) for the signed-in user — sourced from the profiles table via
  // the useProfile hook, with a never-blank display name (B297/B298).
  const profileApi = useProfile(user);

  const openAuth    = () => { setRecovery(false); setAuthOpen(true); };
  const openAccount = (tab) => { setRecovery(false); setAuthTab(tab); setAuthOpen(true); };

  // Build the auth-control slot once per render; passed to every workspace so AppHeader always
  // has the current user state. AccountControl is a self-contained component (own anchor ref +
  // open state per mounted instance), so the same element rendered into several kept-alive
  // headers no longer shares one ref and mis-anchors the dropdown to the corner (B734).
  const authControl = (
    <AccountControl
      user={user}
      profileApi={profileApi}
      onOpenAuth={openAuth}
      onOpenAccount={openAccount}
    />
  );

  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", background: CHROME }}>
      {/* No shell-level header — each workspace renders AppHeader internally
          so it can own its toolbar-slot content without prop-drilling through here. */}
      <main style={{ flex: 1, minHeight: 0, position: "relative", zIndex: 0, background: "var(--surface-page)" }}>
        {/* Keep-alive render: every visited workspace stays mounted in an absolutely-
            positioned wrapper; only the active one is displayed. Each gets its OWN error
            boundary (stable key — a crash in one is contained and shows only when that tab
            is active; "Try again" resets in place) and its own Suspense (the per-module
            loader shows only on the first visit, while the lazy chunk loads). */}
        {WORKSPACES.filter((w) => visited.has(w.id) || w.id === active).map((w) => {
          const isActive = w.id === active;
          const Comp = w.Comp;
          return (
            <div key={w.id} style={{ position: "absolute", inset: 0, display: isActive ? "flex" : "none", flexDirection: "column" }}>
              <ErrorBoundary label={w.label}>
                <Suspense fallback={<ModuleLoader module={w.id} />}>
                  <Comp
                    isActive={isActive}
                    shellModule={w.id}
                    onShellSwitch={switchModule}
                    authControl={authControl}
                    accountActive={!!user}
                    projectId={projectId}
                    crossProject={cross}
                    onNavigate={navigate}
                    onProjectChange={(gid) => navigate({ projectId: gid || null, cross: false })}
                    resumeAllowed={INITIAL_HASH_EMPTY}
                    newProjectTick={newProjectTick}
                    docIntent={docIntent}
                    onGoDashboard={goDashboard}
                    onNewProject={newProject}
                    onOpenReviewInDocReview={openReviewInDocReview}
                    onScheduleLinkChanged={scheduleLinkChanged}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          );
        })}
      </main>
      {authOpen && (
        <AuthPanel
          user={user}
          recovery={recovery}
          profileApi={profileApi}
          initialTab={authTab}
          onClose={() => { setAuthOpen(false); setRecovery(false); }}
        />
      )}
    </div>
  );
}
