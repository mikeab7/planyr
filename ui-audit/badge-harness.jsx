/* Headless harness for the app-wide CloudSyncBadge (NEW-1). Renders the REAL component
 * (real CSS tokens, real error boundary) in every state so verify-new1-cloud-badge.mjs
 * can prove: each state is visually distinct, the loud error is clickable→detail+retry,
 * null shows nothing, and — the headline guardrail — a render crash falls back to the
 * LOUD error glyph instead of silently vanishing. Served by `vite` dev. */
import { createRoot } from "react-dom/client";
import CloudSyncBadge, { CloudBadgeBoundary } from "../src/shared/ui/CloudSyncBadge.jsx";

// A component that throws on render — stands in for "the sync subsystem / save hook threw".
function Boom() { throw new Error("simulated sync-subsystem crash"); }

function Cell({ name, children }) {
  return (
    <div data-cell={name} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--border-default)" }}>
      <code style={{ width: 130, fontFamily: "system-ui, sans-serif", fontSize: 13, color: "var(--text-primary)" }}>{name}</code>
      <div data-slot={name} style={{ display: "flex", alignItems: "center" }}>{children}</div>
    </div>
  );
}

function App() {
  let retried = "no";
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", color: "var(--text-primary)", maxWidth: 520 }}>
      <h2 style={{ fontSize: 15 }}>CloudSyncBadge — all states (NEW-1)</h2>
      <Cell name="synced"><CloudSyncBadge state="synced" /></Cell>
      <Cell name="saving"><CloudSyncBadge state="saving" /></Cell>
      <Cell name="offline"><CloudSyncBadge state="offline" /></Cell>
      <Cell name="error"><CloudSyncBadge state="error" onRetry={() => { window.__retried = "yes"; }} /></Cell>
      <Cell name="local"><CloudSyncBadge state="local" /></Cell>
      <Cell name="null"><CloudSyncBadge state={null} /></Cell>
      {/* The guardrail: the badge's own boundary catches a render crash and shows the loud
          error glyph rather than rendering nothing. */}
      <Cell name="crashed"><CloudBadgeBoundary><Boom /></CloudBadgeBoundary></Cell>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
