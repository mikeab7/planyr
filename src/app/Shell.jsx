/* App shell — the top-level surface that hosts each workspace. The shared
 * two-row AppHeader is now rendered by each workspace (so it has access to
 * workspace-specific toolbar content). The shell's job is auth, module
 * switching state, and building the auth-control slot that AppHeader needs.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { supabaseConfigured } from "../workspaces/site-planner/lib/supabase.js";
import { onAuthChange, signOut } from "../workspaces/site-planner/lib/auth.js";
import { setScheduleLink } from "../workspaces/site-planner/lib/storage.js";
import AuthPanel from "../workspaces/site-planner/components/AuthPanel.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import ModuleLoader from "../shared/ui/ModuleLoader.jsx";
import AnchoredMenu from "../shared/ui/AnchoredMenu.jsx";
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

// Chrome colors are theme tokens so the shell themes WITH the app (B318).
const CHROME = "var(--chrome-bg)";
const LINE   = "var(--chrome-divider)";
const MUTED  = "var(--chrome-muted)";

// ── Account pill + dropdown styling (B298). The dropdown reuses AnchoredMenu — the
// same portal menu primitive as the project breadcrumb — so it escapes the header's
// stacking/clipping context and lines up under the pill, consistent with that menu.
const pill = {
  display: "flex", alignItems: "center", gap: 7,
  maxWidth: 220, padding: "4px 9px 4px 5px", borderRadius: 99,
  cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
  border: `1px solid ${LINE}`, background: "var(--chrome-bg-elev)", color: "var(--chrome-text)",
};
const avatar = (signedIn, size = 20) => ({
  width: size, height: size, borderRadius: 99, flex: "none",
  display: "grid", placeItems: "center",
  fontSize: size >= 28 ? 12.5 : 10.5, fontWeight: 800,
  // Signed-in: white initial on the green gradient. Signed-out: the badge sits on the
  // light/elevated pill, so it must use chrome tokens — a hardcoded white "›" was
  // invisible on the now-light chrome (same theme-flip trap as B341).
  color: signedIn ? "#fff" : "var(--chrome-text)",
  background: signedIn ? "linear-gradient(150deg,#16a34a,#15803d)" : "var(--chrome-bg)",
});
const acctPanel = {
  padding: 6, borderRadius: 10, background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
  fontFamily: "system-ui, sans-serif",
};
const acctRow = {
  display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
  padding: "8px 9px", borderRadius: 7, border: "none", background: "transparent",
  cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, color: "var(--text-primary)",
};
const acctDivider = { height: 1, background: "var(--border-default)", margin: "4px 4px" };
const hoverOn  = (e) => { e.currentTarget.style.background = "var(--hover-ghost)"; };
const hoverOff = (e) => { e.currentTarget.style.background = "transparent"; };

// Tiny 14px line icons for the dropdown rows.
const RowIcon = ({ d, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", color: "var(--text-tertiary)" }}>
    {d}
  </svg>
);
const ICON = {
  profile:  (<><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></>),
  team:     (<><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.2 2.7-5 6-5s6 1.8 6 5" /><path d="M16 5.5a3 3 0 0 1 0 5.5M17.5 19c0-2.6-1.3-4.2-3-4.8" /></>),
  settings: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>),
  signout:  (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>),
};

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
  const [cloudNote, setCloudNote] = useState(false); // "Cloud off" explainer popover
  const [acctOpen,  setAcctOpen]  = useState(false); // account dropdown (signed-in pill, B298)
  const [authTab,   setAuthTab]   = useState("profile"); // which tab the account modal opens on
  const acctAnchor = useRef(null);
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
  const who = profileApi.displayName;

  const openAuth    = () => { setRecovery(false); setAuthOpen(true); };
  const openAccount = (tab) => { setAcctOpen(false); setRecovery(false); setAuthTab(tab); setAuthOpen(true); };

  // Build the auth-control slot once per render; passed to every workspace so
  // AppHeader always has the current user state without needing its own auth hook.
  const authControl = supabaseConfigured() ? (
    user ? (
      // Signed in — the pill shows the user's name and opens an account dropdown (B298).
      <>
        <button
          ref={acctAnchor}
          onClick={() => setAcctOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={acctOpen}
          title={`Signed in as ${user?.email || "(no email)"}`}
          style={pill}
        >
          <span style={avatar(true)}>{profileApi.initial}</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</span>
          <span style={{ opacity: 0.6, fontSize: 11, flex: "none" }}>▾</span>
        </button>
        <AnchoredMenu
          open={acctOpen}
          onClose={() => setAcctOpen(false)}
          anchorRef={acctAnchor}
          placement="below-right"
          width={236}
          gap={8}
          panelStyle={acctPanel}
        >
          {/* Identity header — avatar + name + email */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 9px 10px" }}>
            <span style={avatar(true, 30)}>{profileApi.initial}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who}</div>
              {profileApi.org && <div style={{ fontSize: 11.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profileApi.org}</div>}
              <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email || ""}</div>
            </div>
          </div>
          <div style={acctDivider} />
          <button style={acctRow} onClick={() => openAccount("profile")} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
            <RowIcon d={ICON.profile} /> Profile
          </button>
          <button style={acctRow} onClick={() => openAccount("team")} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
            <RowIcon d={ICON.team} /> Team
          </button>
          <button style={acctRow} onClick={() => openAccount("settings")} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
            <RowIcon d={ICON.settings} /> Settings
          </button>
          <div style={acctDivider} />
          <button style={acctRow} onClick={async () => { setAcctOpen(false); await signOut(); }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
            <RowIcon d={ICON.signout} /> Sign out
          </button>
        </AnchoredMenu>
      </>
    ) : (
      // Logged out — a "Sign in" pill that opens the auth modal directly.
      <button onClick={openAuth} title="Sign in or create an account" style={pill}>
        <span style={avatar(false)}>›</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Sign in</span>
      </button>
    )
  ) : (
    // Cloud not configured — show a "Cloud off" pill with an explanatory popover.
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setCloudNote((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={cloudNote}
        title="Cloud sync isn't set up — your work is saved on this device only"
        style={{
          display: "flex", alignItems: "center", gap: 7,
          padding: "4px 10px 4px 6px", borderRadius: 99,
          cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
          border: `1px solid ${LINE}`, background: "var(--chrome-bg-elev)",
          color: MUTED,
        }}
      >
        <span
          style={{
            width: 20, height: 20, borderRadius: 99, flex: "none",
            display: "grid", placeItems: "center",
            fontSize: 12, fontWeight: 800, color: MUTED,
            background: "var(--chrome-divider)",
          }}
        >
          ⊘
        </span>
        <span style={{ whiteSpace: "nowrap" }}>Cloud off</span>
      </button>
      {cloudNote && (
        <>
          <div onClick={() => setCloudNote(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div
            role="dialog"
            style={{
              position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 41,
              width: 256, padding: "11px 13px", borderRadius: 10,
              background: "var(--surface-raised)", color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Cloud sync is off</div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
              Your work is saved on <b>this device only</b> (in this browser).
              Signing in and syncing across your devices need the cloud connection
              to be set up for this site.
            </p>
          </div>
        </>
      )}
    </div>
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
