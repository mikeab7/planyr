/* App shell — the top-level surface that hosts each workspace. The shared
 * two-row AppHeader is now rendered by each workspace (so it has access to
 * workspace-specific toolbar content). The shell's job is auth, module
 * switching state, and building the auth-control slot that AppHeader needs.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { supabaseConfigured } from "../workspaces/site-planner/lib/supabase.js";
import { onAuthChange, signOut } from "../workspaces/site-planner/lib/auth.js";
import AuthPanel from "../workspaces/site-planner/components/AuthPanel.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import ModuleLoader from "../shared/ui/ModuleLoader.jsx";
import AnchoredMenu from "../shared/ui/AnchoredMenu.jsx";
import { useProfile } from "../shared/profile/useProfile.js";
import { prefetchOnIdle } from "./modulePrefetch.js";
import { setTelemetryModule } from "../shared/telemetry/clientErrors.js";

// Workspace registry — each Comp is lazy-loaded (separate bundle chunk).
const WORKSPACES = [
  { id: "site-planner", label: "Site Planyr",     Comp: lazy(() => import("../workspaces/site-planner/SitePlannerApp.jsx")) },
  { id: "doc-review",   label: "Document Review", Comp: lazy(() => import("../workspaces/doc-review/DocReview.jsx")) },
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
  const [active,    setActive]    = useState("site-planner");
  const [user,      setUser]      = useState(null);
  const [authOpen,  setAuthOpen]  = useState(false);
  const [recovery,  setRecovery]  = useState(false);
  const [cloudNote, setCloudNote] = useState(false); // "Cloud off" explainer popover
  const [acctOpen,  setAcctOpen]  = useState(false); // account dropdown (signed-in pill, B298)
  const [authTab,   setAuthTab]   = useState("profile"); // which tab the account modal opens on
  const acctAnchor = useRef(null);
  // Cross-workspace navigation (B191–B193). The project breadcrumb lives in every
  // workspace's header; "Dashboard" and "open/new project" from Schedule or Markup
  // must route into the Site Planner (where projects open). The Shell switches the
  // active module and hands the Site Planner a one-shot `navIntent` (token-stamped so
  // each click re-fires even if the kind repeats); the Site Planner consumes it.
  const [navIntent, setNavIntent] = useState(null);
  const goDashboard         = () => { setNavIntent({ kind: "dashboard",    token: Date.now() }); setActive("site-planner"); };
  const openProjectInPlanner = (id) => { setNavIntent({ kind: "open-project", projectId: id, token: Date.now() }); setActive("site-planner"); };
  const newProjectInPlanner  = () => { setNavIntent({ kind: "new-project",  token: Date.now() }); setActive("site-planner"); };
  // Cross-workspace "open this file" intent (NEW-1). The global Project Files panel is
  // reachable from every workspace, but Document Review is lazy-mounted — so a file clicked
  // from the Site side can't be handed to a component that doesn't exist yet. We stash the
  // requested review (token-stamped so a repeat click re-fires), switch to Document Review,
  // and DR consumes the pending intent once it mounts. Without this the open is dropped and
  // DR boots to its empty placeholder until a second click.
  const [docIntent, setDocIntent] = useState(null);
  const openReviewInDocReview = (row) => { setDocIntent({ kind: "open-review", row, token: Date.now() }); setActive("doc-review"); };

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
  useEffect(() => { prefetchOnIdle(["scheduler", "doc-review"]); }, []);

  // B279 — tag telemetry rows with the workspace the user is in, so a reported error
  // says WHERE it happened (site-planner / doc-review / scheduler).
  useEffect(() => { setTelemetryModule(active); }, [active]);

  const current = WORKSPACES.find((w) => w.id === active) || WORKSPACES[0];
  const Active  = current.Comp;

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
          title={`Signed in as ${user.email}`}
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
              <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
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
        {/* Each workspace gets its own error boundary, keyed by id so switching
            modules gives a fresh boundary — a render crash in one workspace is
            contained (shell and the other workspaces keep working). */}
        <ErrorBoundary key={active} label={current.label}>
          <Suspense fallback={<ModuleLoader module={active} />}>
            <Active
              shellModule={active}
              onShellSwitch={setActive}
              authControl={authControl}
              accountActive={!!user}
              navIntent={navIntent}
              docIntent={docIntent}
              onGoDashboard={goDashboard}
              onOpenProject={openProjectInPlanner}
              onNewProject={newProjectInPlanner}
              onOpenReviewInDocReview={openReviewInDocReview}
            />
          </Suspense>
        </ErrorBoundary>
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
