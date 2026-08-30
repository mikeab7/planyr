/* App shell — the top-level surface that hosts each workspace. The shared
 * two-row AppHeader is now rendered by each workspace (so it has access to
 * workspace-specific toolbar content). The shell's job is auth, module
 * switching state, and building the auth-control slot that AppHeader needs.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { supabaseConfigured } from "../workspaces/site-planner/lib/supabase.js";
import { onAuthChange } from "../workspaces/site-planner/lib/auth.js";
import { setScheduleLink, setActiveUser } from "../workspaces/site-planner/lib/storage.js";
import AuthPanel from "../workspaces/site-planner/components/AuthPanel.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import ModuleLoader from "../shared/ui/ModuleLoader.jsx";
import AccountControl from "./AccountControl.jsx";
import { useProfile } from "../shared/profile/useProfile.js";
import { setTelemetryModule } from "../shared/telemetry/clientErrors.js";
import { useHashRoute, unknownModuleSlug, isAdminRoute, readRoute, buildHash, INITIAL_HASH_EMPTY } from "./route.js";
import { pageTitle } from "./pageTitle.js";
import { writeLastRoute, seedBootRoute } from "./lastRoute.js";
import { installBuildSkewWatch, shouldOfferReload, fetchServedBuild, isBuildSkewed, LOADED_BUILD } from "./buildSkew.js";
import { reloadFresh } from "./chunkReload.js";
import { RADIUS } from "../shared/ui/radius.js";
import { mayResumeLastSite } from "../workspaces/site-planner/lib/bootResume.js";

const AdminGate = lazy(() => import("../workspaces/admin/AdminGate.jsx"));

// "Open where I left off": on an empty-hash boot, seed the URL from the stored last-route
// pointer BEFORE the first render (so useHashRoute's initial read sees it). Runs at module
// scope — after route.js captured INITIAL_HASH_EMPTY, so deep links (incl. "#/") still win
// and resumeAllowed stays true for the Site Planner's own plan-level resume.
seedBootRoute();

// B881664 — the route the app's BOOT actually resolved to (after the seed above), captured
// once. `mayResumeLastSite` compares a later mount's own projectId against this to tell "the
// Site Planner is mounting as part of processing the boot route" from "the Site Planner is
// mounting because the user just navigated to a project-less route" — see bootResume.js.
const INITIAL_ROUTE = readRoute();

// Workspace registry — each Comp is lazy-loaded (separate bundle chunk).
const WORKSPACES = [
  { id: "site-planner", label: "Site Planyr",     Comp: lazy(() => import("../workspaces/site-planner/SitePlannerApp.jsx")) },
  { id: "doc-review",   label: "Review", Comp: lazy(() => import("../workspaces/doc-review/DocReview.jsx")) },
  { id: "library",      label: "Library", Comp: lazy(() => import("../workspaces/library/Library.jsx")) },
  { id: "scheduler",    label: "Sequence Planyr",  Comp: lazy(() => import("../workspaces/scheduler/Scheduler.jsx")) },
  { id: "notes",        label: "Notes", Comp: lazy(() => import("../workspaces/notes/Notes.jsx")) },
  { id: "food",         label: "Food", Comp: lazy(() => import("../workspaces/food/FoodApp.jsx")) },
];

// Chrome color is a theme token so the shell themes WITH the app (B318). (The account
// pill/dropdown styling moved into AccountControl.jsx with the control itself — B734.)
const CHROME = "var(--chrome-bg)";

/** "A newer version of Planyr is available" (B1373) — module scope, per
 *  MODULE-SCOPE-COMPONENTS.
 *
 *  Deliberately a THIN STRIP, not a modal: it must be impossible for this to interrupt
 *  someone mid-sentence or to hide behind an overlay, and it must be dismissible in one
 *  click. It does not reload on its own — a forced reload of an app someone is typing into
 *  is a worse bug than the staleness it cures. `reloadFresh` is the same cache-busting
 *  reload the stale-chunk guard uses, so the reload actually lands on the new build rather
 *  than re-serving the cached index.html. */
function UpdateBanner({ reason, onReload, onDismiss }) {
  if (!reason) return null;
  return (
    <div
      role="status"
      data-testid="app-update-banner"
      data-reason={reason}
      style={{
        flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "6px 14px",
        background: "var(--warn-bg)", borderBottom: "1px solid var(--border-default)",
        color: "var(--warn-text)", fontSize: 12.5, fontWeight: 600,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        {reason === "route-miss"
          ? "That part of Planyr is newer than the copy this tab has open — reload to get it."
          : "A newer version of Planyr is available. Reload when you're ready — your work is saved."}
      </span>
      <button
        type="button" data-testid="app-update-reload" onClick={onReload}
        style={{
          flex: "0 0 auto", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--warn-text)", font: "inherit",
          fontSize: 11.5, fontWeight: 700, padding: "2px 12px", cursor: "pointer",
        }}
      >Reload</button>
      <button
        type="button" data-testid="app-update-dismiss" onClick={onDismiss}
        style={{
          flex: "0 0 auto", border: "1px solid var(--border-default)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--text-tertiary)", font: "inherit",
          fontSize: 11.5, fontWeight: 700, padding: "2px 10px", cursor: "pointer",
        }}
      >Dismiss</button>
    </div>
  );
}

export default function Shell() {
  // The active project + workspace now live in the URL hash (Work Item A), so the
  // project survives a module switch, deep-links, and refreshes — instead of being
  // module-local state that's lost on the way into Document Review. The breadcrumb and
  // every workspace read the project from here, not from their own state.
  const [route, navigate] = useHashRoute();
  const active    = route.module;     // workspace id
  const projectId = route.projectId;  // active Site-group id | null
  const cross     = route.cross;      // cross-project mode
  // B711904 (NEW-1) — "admin" is deliberately NOT a module slug (see route.js), so it never
  // shows up in `route.module`; it's read straight off the live hash instead, the same way
  // `routeMiss` below already has to be. Recomputed on every hashchange (the `route` state
  // object is fresh each time, so this effect always fires even when the parsed route didn't
  // change) so leaving/entering #/admin is always caught.
  const [isAdminHash, setIsAdminHash] = useState(() => (typeof window !== "undefined" ? isAdminRoute(window.location.hash) : false));
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsAdminHash(isAdminRoute(window.location.hash));
  }, [route]);
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

  /* ⛔ WHO THE PROJECT STORE BELONGS TO IS THE SHELL'S JOB, NOT THE SITE PLANNER'S (B482 ×2).
   *
   * `setActiveUser` is what switches the shared project store from the logged-out legacy cache
   * to the signed-in user's own (`planarfit:sites:cloud:<uid>`). It used to be called in exactly
   * ONE place — SitePlannerApp's auth effect — and SitePlannerApp is a lazy workspace that only
   * mounts once you visit it. "Open where I left off" now routinely boots straight into Notes,
   * Review or Library, and on those boots the Site Planner never mounts, so the store stayed
   * bound to nobody: `isCloudActive()` was false, every warm no-opped instantly, and every
   * project read silently returned whatever stale LOGGED-OUT data that particular machine
   * happened to hold. That is why one account gave two answers on two computers — the office
   * machine had a few legacy sites to show, the home machine had none.
   *
   * The Shell always mounts and already owns auth, so the binding lives here. The Site Planner
   * still calls it (and still runs its own pull) — the call is idempotent, and its own
   * same-user re-emit guard is keyed on its own ref, so nothing there changes. */
  useEffect(() => {
    if (!supabaseConfigured()) return;
    return onAuthChange((event, u) => {
      try { setActiveUser((u && u.id) || null); } catch (_) {}
      setUser(u);
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); setAuthOpen(true); }
    });
  }, []);

  // NEW-9 — the B223 boot-time idle warm of scheduler/doc-review/library was REMOVED.
  // Its requestIdleCallback fired at ~t=304ms, ahead of first-contentful-paint at ~328ms,
  // so it raced the critical path instead of following it: a Site-only session fetched AND
  // evaluated ~805 KB of chunks it never uses. Warming now happens on navigation intent
  // only (AppHeader module-tab hover / pointerdown → prefetchModule), which keeps the
  // instant-switch feel without taxing a session that never leaves the Site route.

  // B279 — tag telemetry rows with the workspace the user is in, so a reported error
  // says WHERE it happened (site-planner / doc-review / scheduler). "admin" resolves as its
  // own module here even though it's not in `route.module` (see isAdminHash above), so a
  // crash inside the admin page is never mislabeled as a Site Planner error.
  useEffect(() => { setTelemetryModule(isAdminHash ? "admin" : active); }, [active, isAdminHash]);

  // NEW-1 (2026-08-28) — the browser tab title names the module you're in, using the
  // SAME label the nav tabs render (pageTitle.js reads moduleTabLabel.js, the nav's own
  // source), so it updates on every client-side route change with no reload.
  useEffect(() => { document.title = pageTitle({ module: active, isAdmin: isAdminHash }); }, [active, isAdminHash]);

  // "Open where I left off" — persist every route change as the last-route pointer.
  // Single choke point: catches tab clicks, breadcrumb picks, and programmatic navigates.
  // writeLastRoute() itself declines a few cases (B710736 — Food, and any other module
  // sitting on no project/cross view) so a visit there can't clobber the pointer to
  // wherever the professional tool was actually left; see lastRoute.js. #/admin resolves
  // (via parseRoute's tolerant fallback) to the default module with no project — a real
  // pointer, indistinguishable from "on the plain dashboard" — so it's excluded the same way
  // Food is: a visit to /admin must never clobber the pointer to whatever project was
  // actually open before it (B711904).
  useEffect(() => { if (!isAdminHash) writeLastRoute(route); }, [route, isAdminHash]);

  // Keep-alive (owner request, 2026-07-05: "cleaner/faster switch between modules"): every
  // workspace the user has VISITED stays mounted, hidden with display:none, instead of being
  // torn down on each tab switch. Switching back is instant — the open drawing, map view,
  // file list, and the booted Schedule iframe all survive. Hidden workspaces still follow
  // the route's project (their route→state effects stay live); writing to the URL and global
  // keyboard handling are gated on the `isActive` prop each workspace now receives.
  const [visited, setVisited] = useState(() => new Set([active]));
  useEffect(() => { setVisited((v) => (v.has(active) ? v : new Set(v).add(active))); }, [active]);

  /* DEPLOY SKEW (B1373) — two independent signals, one banner.
   *
   *  `servedBuild` is what the SERVER says is current (null while unknown / offline / dev);
   *  `routeMiss` is the definitive one — this build was handed a route slug it has no module
   *  for, which is what a link to a workspace shipped after this tab loaded looks like from
   *  the inside. The route signal is read from the live hash, not from `route`, because
   *  parseRoute has already resolved the miss away by then. */
  const [servedBuild, setServedBuild] = useState(null);
  const [dismissedFor, setDismissedFor] = useState(null);
  const [routeMiss, setRouteMiss] = useState(() => (typeof window !== "undefined" ? !!unknownModuleSlug(window.location.hash) : false));
  useEffect(() => installBuildSkewWatch({ onServed: setServedBuild }), []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setRouteMiss(!!unknownModuleSlug(window.location.hash));
  }, [route]);
  // B881667 — `shouldOfferReload` now requires CONFIRMED skew before a route miss shows the
  // reload banner (see its own header), so the routine watch's up-to-20s-after-boot first check
  // is too slow a way to learn "no, this build is already current" — the whole reason a route
  // miss is uninformative until then. Fire one extra, immediate check the moment a miss is seen;
  // the routine watch's own poll/focus checks are untouched and keep running regardless.
  useEffect(() => {
    if (!routeMiss) return;
    let live = true;
    fetchServedBuild().then((served) => { if (live) setServedBuild(served); });
    return () => { live = false; };
  }, [routeMiss]);
  // B881667 — a route miss silently left the URL bar naming the unresolved slug forever (the
  // owner's exact complaint: "the URL keeps saying /review"), with the resolved fallback module
  // rendered underneath. Correct the visible URL to what's actually rendered — but ONLY once the
  // immediate check above has PROVEN this tab is already on the current build: while skew is
  // still possible, rewriting the URL would silently throw away a deep link a reload could
  // actually resolve (exactly the case this mechanism exists to protect, per buildSkew.js's own
  // header). `replaceState`, never a real navigation — no wasted history entry, no re-render
  // (parseRoute already resolved `route` to the same fallback the render already used).
  useEffect(() => {
    if (!routeMiss || typeof window === "undefined" || !window.history) return;
    if (servedBuild == null || isBuildSkewed(LOADED_BUILD, servedBuild)) return;
    try {
      const url = window.location.pathname + window.location.search + buildHash(route);
      window.history.replaceState(window.history.state, "", url);
    } catch (_) { /* history API unavailable — leave the URL as-is */ }
    setRouteMiss(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMiss, servedBuild]);
  const updateReason = shouldOfferReload({ loaded: LOADED_BUILD, served: servedBuild, dismissedFor, routeMissed: routeMiss })
    ? (routeMiss && dismissedFor !== "route-miss" ? "route-miss" : "newer-build")
    : null;

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
      <UpdateBanner
        reason={updateReason}
        onReload={() => reloadFresh()}
        onDismiss={() => setDismissedFor(updateReason === "route-miss" ? "route-miss" : servedBuild)}
      />
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
                    // The signed-in user's id, so a workspace can SCOPE its own per-account
                    // storage without importing the auth/Supabase client onto its route.
                    // Notes keys its notebooks by this (or `local` when signed out), so two
                    // accounts on one machine never read each other's notes.
                    userId={user?.id || null}
                    projectId={projectId}
                    crossProject={cross}
                    onNavigate={navigate}
                    onProjectChange={(gid) => navigate({ projectId: gid || null, cross: false })}
                    resumeAllowed={mayResumeLastSite({ initialHashEmpty: INITIAL_HASH_EMPTY, projectId, initialProjectId: INITIAL_ROUTE.projectId })}
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
        {/* B711904 (NEW-1) — the admin page. Only mounted (lazy chunk + the allowlist RPC
            call) while the hash actually reads #/admin, so a normal session never pays for
            either. AdminGate itself renders null for anyone not on the allowlist, which lets
            the ordinary workspace underneath show through unblocked — the "404, not a
            permission page" requirement — rather than this overlay needing its own denied
            state. */}
        {isAdminHash && (
          <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
            <Suspense fallback={null}>
              <AdminGate user={user} onExit={goDashboard} />
            </Suspense>
          </div>
        )}
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
