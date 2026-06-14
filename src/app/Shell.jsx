/* App shell — the top-level surface that hosts each workspace. A workspace
 * registry maps an id to a LAZY-LOADED workspace component (its code is only
 * fetched when that workspace is first opened), and a slim header switches
 * between them. Adding a workspace = one registry entry; workspaces live in
 * src/workspaces/<id>/ and don't depend on each other.
 */
import { lazy, Suspense, useState } from "react";

// Workspace registry. Each `load` is a dynamic import → its own lazy chunk.
const WORKSPACES = [
  { id: "site-planner", label: "Site Planner", Comp: lazy(() => import("../workspaces/site-planner/SitePlannerApp.jsx")) },
  { id: "doc-review", label: "Document Review", Comp: lazy(() => import("../workspaces/doc-review/DocReview.jsx")) },
];

const PAL = { chrome: "#14110e", line: "#2e2a23", ink: "#ece7db", muted: "#9b9482", ember: "#e8590c" };

export default function Shell() {
  const [active, setActive] = useState("site-planner");
  const current = WORKSPACES.find((w) => w.id === active) || WORKSPACES[0];
  const Active = current.Comp;
  const tab = (on) => ({
    padding: "5px 12px", fontSize: 12.5, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
    border: "1px solid " + (on ? PAL.ember : "transparent"), background: on ? "rgba(232,89,12,0.16)" : "transparent",
    color: on ? "#fff" : PAL.muted,
  });
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
      </header>
      <main style={{ flex: 1, minHeight: 0, position: "relative", background: "#efeadf" }}>
        <Suspense fallback={<div style={{ height: "100%", display: "grid", placeItems: "center", color: PAL.muted, fontFamily: "system-ui, sans-serif", fontSize: 13 }}>Loading workspace…</div>}>
          <Active />
        </Suspense>
      </main>
    </div>
  );
}
