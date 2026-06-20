/* App shell — the top-level surface that hosts each workspace. The shared
 * two-row AppHeader is now rendered by each workspace (so it has access to
 * workspace-specific toolbar content). The shell's job is auth, module
 * switching state, and building the auth-control slot that AppHeader needs.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { supabaseConfigured } from "../workspaces/site-planner/lib/supabase.js";
import { onAuthChange } from "../workspaces/site-planner/lib/auth.js";
import AuthPanel from "../workspaces/site-planner/components/AuthPanel.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import ModuleLoader from "../shared/ui/ModuleLoader.jsx";
import { prefetchOnIdle } from "./modulePrefetch.js";

// Workspace registry — each Comp is lazy-loaded (separate bundle chunk).
const WORKSPACES = [
  { id: "site-planner", label: "Site Planyr",     Comp: lazy(() => import("../workspaces/site-planner/SitePlannerApp.jsx")) },
  { id: "doc-review",   label: "Document Review", Comp: lazy(() => import("../workspaces/doc-review/DocReview.jsx")) },
  { id: "scheduler",    label: "Sequence Planyr",  Comp: lazy(() => import("../workspaces/scheduler/Scheduler.jsx")) },
];

const CHROME = "#14110e";
const LINE   = "#2e2a23";
const MUTED  = "#9b9482";

export default function Shell() {
  const [active,    setActive]    = useState("site-planner");
  const [user,      setUser]      = useState(null);
  const [authOpen,  setAuthOpen]  = useState(false);
  const [recovery,  setRecovery]  = useState(false);
  const [cloudNote, setCloudNote] = useState(false); // "Cloud off" explainer popover
  // Cross-workspace navigation (B191–B193). The project breadcrumb lives in every
  // workspace's header; "Dashboard" and "open/new project" from Schedule or Markup
  // must route into the Site Planner (where projects open). The Shell switches the
  // active module and hands the Site Planner a one-shot `navIntent` (token-stamped so
  // each click re-fires even if the kind repeats); the Site Planner consumes it.
  const [navIntent, setNavIntent] = useState(null);
  const goDashboard         = () => { setNavIntent({ kind: "dashboard",    token: Date.now() }); setActive("site-planner"); };
  const openProjectInPlanner = (id) => { setNavIntent({ kind: "open-project", projectId: id, token: Date.now() }); setActive("site-planner"); };
  const newProjectInPlanner  = () => { setNavIntent({ kind: "new-project",  token: Date.now() }); setActive("site-planner"); };

  useEffect(() => {
    if (!supabaseConfigured()) return;
    return onAuthChange((event, u) => {
      setUser(u);
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); setAuthOpen(true); }
    });
  }, []);

  // B221 — once boot is idle, quietly warm the non-active workspaces (chunk +,
  // for Schedule, the heavy /sequence/ iframe doc) so switching to them feels
  // instant. Lazy-loading still gates the first paint; this only runs after.
  useEffect(() => { prefetchOnIdle(["scheduler", "doc-review"]); }, []);

  const current = WORKSPACES.find((w) => w.id === active) || WORKSPACES[0];
  const Active  = current.Comp;

  const meta = (user && user.user_metadata) || {};
  const who  = [meta.first_name, meta.last_name].filter(Boolean).join(" ")
    || (user && user.email) || "";

  const openAuth = () => { setRecovery(false); setAuthOpen(true); };

  // Build the auth-control slot once per render; passed to every workspace so
  // AppHeader always has the current user state without needing its own auth hook.
  const authControl = supabaseConfigured() ? (
    <button
      onClick={openAuth}
      title={user ? `Signed in as ${user.email}` : "Sign in or create an account"}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        maxWidth: 220, padding: "4px 9px 4px 5px", borderRadius: 99,
        cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
        border: `1px solid ${LINE}`, background: "rgba(255,255,255,0.06)",
        color: "#ece7db",
      }}
    >
      <span
        style={{
          width: 20, height: 20, borderRadius: 99, flex: "none",
          display: "grid", placeItems: "center",
          fontSize: 10.5, fontWeight: 800, color: "#fff",
          background: user ? "linear-gradient(150deg,#16a34a,#15803d)" : "rgba(255,255,255,0.12)",
        }}
      >
        {user ? (who.trim()[0] || "•").toUpperCase() : "›"}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {user ? who : "Sign in"}
      </span>
    </button>
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
          border: `1px solid ${LINE}`, background: "rgba(255,255,255,0.04)",
          color: MUTED,
        }}
      >
        <span
          style={{
            width: 20, height: 20, borderRadius: 99, flex: "none",
            display: "grid", placeItems: "center",
            fontSize: 12, fontWeight: 800, color: MUTED,
            background: "rgba(255,255,255,0.08)",
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
              background: "#fff", color: "#2c2a26",
              border: "1px solid #e7e2d6",
              boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4 }}>Cloud sync is off</div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "#6b6557" }}>
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
      <main style={{ flex: 1, minHeight: 0, position: "relative", zIndex: 0, background: "#efeadf" }}>
        {/* Each workspace gets its own error boundary, keyed by id so switching
            modules gives a fresh boundary — a render crash in one workspace is
            contained (shell and the other workspaces keep working). */}
        <ErrorBoundary key={active} label={current.label}>
          <Suspense fallback={<ModuleLoader module={active} />}>
            <Active
              shellModule={active}
              onShellSwitch={setActive}
              authControl={authControl}
              navIntent={navIntent}
              onGoDashboard={goDashboard}
              onOpenProject={openProjectInPlanner}
              onNewProject={newProjectInPlanner}
            />
          </Suspense>
        </ErrorBoundary>
      </main>
      {authOpen && (
        <AuthPanel
          user={user}
          recovery={recovery}
          onClose={() => { setAuthOpen(false); setRecovery(false); }}
        />
      )}
    </div>
  );
}
