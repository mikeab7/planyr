/* App shell — the top-level surface that hosts each workspace. A workspace
 * registry maps an id to a LAZY-LOADED workspace component (its code is only
 * fetched when that workspace is first opened). The header has the brand + a
 * workspace switcher (left) and the global account control (right).
 * Auth lives here so the account control is global across workspaces; each
 * workspace still subscribes to Supabase auth independently for its own needs
 * (e.g. the planner's cloud storage switching).
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { supabaseConfigured } from "../workspaces/site-planner/lib/supabase.js";
import { onAuthChange } from "../workspaces/site-planner/lib/auth.js";
import AuthPanel from "../workspaces/site-planner/components/AuthPanel.jsx";

// Workspace registry. Each `load` is a dynamic import → its own lazy chunk.
const WORKSPACES = [
  { id: "site-planner", label: "Site Planyr", Comp: lazy(() => import("../workspaces/site-planner/SitePlannerApp.jsx")) },
  { id: "doc-review", label: "Document Review", Comp: lazy(() => import("../workspaces/doc-review/DocReview.jsx")) },
];

const PAL = { chrome: "#14110e", line: "#2e2a23", ink: "#ece7db", muted: "#9b9482", ember: "#e8590c" };

export default function Shell() {
  const [active, setActive] = useState("site-planner");
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    return onAuthChange((event, u) => {
      setUser(u);
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); setAuthOpen(true); }
    });
  }, []);

  const current = WORKSPACES.find((w) => w.id === active) || WORKSPACES[0];
  const Active = current.Comp;
  const tab = (on) => ({
    padding: "5px 12px", fontSize: 12.5, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
    border: "1px solid " + (on ? PAL.ember : "transparent"), background: on ? "rgba(232,89,12,0.16)" : "transparent",
    color: on ? "#fff" : PAL.muted,
  });
  const meta = (user && user.user_metadata) || {};
  const who = [meta.first_name, meta.last_name].filter(Boolean).join(" ") || (user && user.email) || "";

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: PAL.chrome }}>
      <header style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, height: 38, padding: "0 12px", background: PAL.chrome, borderBottom: `1px solid ${PAL.line}` }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 800, fontSize: 13, color: "#fff", letterSpacing: "-0.01em" }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, background: `linear-gradient(150deg, ${PAL.ember}, #c2410c)`, display: "grid", placeItems: "center" }}>
            <svg width="9" height="9" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="7" height="12" rx="1" fill="#fff" opacity="0.95" /><rect x="10.5" y="2" width="3.5" height="6.5" rx="0.8" fill="#fff" opacity="0.6" /></svg>
          </span>
          Planyr
        </span>
        <nav style={{ display: "flex", gap: 4, marginLeft: 4 }}>
          {WORKSPACES.map((w) => (
            <button key={w.id} style={tab(w.id === active)} onClick={() => setActive(w.id)}>{w.label}</button>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        {/* global account control (top-right) */}
        {supabaseConfigured() && (
          <button onClick={() => { setRecovery(false); setAuthOpen(true); }} title={user ? `Signed in as ${user.email}` : "Sign in or create an account"}
            style={{ display: "flex", alignItems: "center", gap: 7, maxWidth: 220, padding: "4px 9px 4px 5px", borderRadius: 99, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
              border: `1px solid ${PAL.line}`, background: "rgba(255,255,255,0.06)", color: PAL.ink }}>
            <span style={{ width: 20, height: 20, borderRadius: 99, flex: "none", display: "grid", placeItems: "center", fontSize: 10.5, fontWeight: 800, color: "#fff",
              background: user ? "linear-gradient(150deg,#16a34a,#15803d)" : "rgba(255,255,255,0.12)" }}>
              {user ? (who.trim()[0] || "•").toUpperCase() : "›"}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user ? who : "Sign in"}</span>
          </button>
        )}
      </header>
      <main style={{ flex: 1, minHeight: 0, position: "relative", background: "#efeadf" }}>
        <Suspense fallback={<div style={{ height: "100%", display: "grid", placeItems: "center", color: PAL.muted, fontFamily: "system-ui, sans-serif", fontSize: 13 }}>Loading workspace…</div>}>
          <Active />
        </Suspense>
      </main>
      {authOpen && <AuthPanel user={user} recovery={recovery} onClose={() => { setAuthOpen(false); setRecovery(false); }} />}
    </div>
  );
}
