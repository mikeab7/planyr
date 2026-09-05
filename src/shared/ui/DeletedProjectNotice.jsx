/* DeletedProjectNotice (NEW-2/B848833) — the BLOCKED-ROUTE state Shell.jsx renders in place of a
 * workspace when the routed project is confirmed soft-deleted, or the id names no row at all.
 *
 * Why a blocked route rather than a read-only mode: this is the one fix that also satisfies "the
 * write path must refuse" for free — the workspace component for a blocked project is never
 * rendered (Shell.jsx swaps this in for that slot instead of `<Comp>`), so there is no editor
 * mounted to write through, and no server-side change was needed to enforce it.
 *
 * Two distinct states, never conflated (a nonexistent id is not the same fact as a deleted one):
 *   status="deleted" — the project existed and was removed; offers Restore.
 *   status="missing" — the id names no row this account can see at all; Dashboard only.
 */
import { useState } from "react";
import { RADIUS } from "./radius.js";
import { relTime, DELETED_RETENTION_DAYS } from "../projects/projectModel.js";

// FONT_SIZE.display/emphasis/control (designTokens.js) LITERALLY DUPLICATED as 14/13/12, not
// imported — this file is reached from Shell.jsx, which every route's chunk graph goes through,
// and a second import point into designTokens.js tips Rollup into extracting it as its own shared
// chunk that then rides onto every route (measured: it appeared on the Site Planner route's
// chunk allowlist). Same literal-duplicate pattern SheetView.jsx's own HEADER_H and
// ProjectBreadcrumb.jsx's own CHROME_FONT_CONTROL already use for the identical reason.
const FONT_DISPLAY = 14, FONT_EMPHASIS = 13, FONT_CONTROL = 12;

// Plain <button>s rather than the shared `Button` primitive — this component is reached only via
// a lazy import from Shell.jsx (the app-shell entry chunk every route downloads), and pulling in
// controls.jsx for one button pair would hoist that whole module onto the boot path for a screen
// almost nobody ever sees. Same reasoning as this file's own sibling, Shell.jsx's UpdateBanner.
const btnBase = { height: 28, padding: "0 14px", borderRadius: RADIUS.md, fontFamily: "inherit", fontSize: FONT_CONTROL, fontWeight: 700, cursor: "pointer" };
const secondaryBtn = { ...btnBase, border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)" };
const primaryBtn = { ...btnBase, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent)" };

export default function DeletedProjectNotice({ status, name, deletedAt, onRestore, onDashboard }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const deleted = status === "deleted";
  const restore = async () => {
    setBusy(true); setError(null);
    try {
      const res = await onRestore();
      if (res && res.ok === false) setError(res.error || "That project couldn't be restored — check your connection and try again.");
    } catch (e) {
      setError((e && e.message) || "That project couldn't be restored — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      data-testid="deleted-project-notice"
      data-status={status}
      style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--surface-page)", padding: 24,
      }}
    >
      <div style={{
        maxWidth: 440, width: "100%", padding: 24, borderRadius: RADIUS.lg,
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        boxShadow: "0 8px 28px rgba(0,0,0,0.16)", textAlign: "left", // design-exempt: no shadow-color token yet repo-wide
      }}>
        <div style={{ fontSize: FONT_DISPLAY, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
          {deleted ? "This project was deleted" : "This project doesn't exist"}
        </div>
        <div style={{ fontSize: FONT_EMPHASIS, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 16 }}>
          {deleted ? (
            <>
              <strong style={{ color: "var(--text-primary)" }}>{name || "Untitled project"}</strong> was moved to
              Recently deleted{deletedAt ? ` ${relTime(deletedAt)}` : ""}. Restore it to keep working here, or head
              back to your projects — it stays restorable for {DELETED_RETENTION_DAYS} days from when it was deleted.
            </>
          ) : (
            "The link may be out of date, or the project may already have been permanently removed."
          )}
        </div>
        {error && (
          <div style={{ fontSize: FONT_CONTROL, color: "var(--warn-text)", marginBottom: 12 }}>{error}</div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={secondaryBtn} onClick={onDashboard}>Go to Dashboard</button>
          {deleted && (
            <button type="button" style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={restore}>
              {busy ? "Restoring…" : "Restore project"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
