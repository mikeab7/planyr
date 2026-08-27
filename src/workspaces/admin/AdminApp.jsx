/* AdminApp (B711904 / NEW-1) — Michael's own internal operator page.
 *
 * NOT a workspace: it carries no header tab, isn't in the module switcher, and mounts only
 * when Shell.jsx has already confirmed (via AdminGate) that the signed-in user is on the
 * admin allowlist. Four empty sections today — Usage / Issues / Support / Ops — each a
 * placeholder for NEW-2..NEW-5, which render their real content inside these same section
 * shells and read through this same gated access path. See CLAUDE.md's "No admin /
 * cross-user data access" decision: this is Michael's own view of the product he runs,
 * gated to his own account, never a support-agent view over customer data.
 */
import { SECTIONS } from "./lib/adminSections.js";
import { RADIUS } from "../../shared/ui/radius.js";

function Section({ title, blurb }) {
  return (
    <section
      style={{
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 6,
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{title}</h2>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-tertiary)" }}>{blurb}</p>
    </section>
  );
}

export default function AdminApp({ onExit }) {
  return (
    <div
      data-testid="admin-app"
      style={{
        height: "100%", overflow: "auto", background: "var(--surface-page)",
        display: "flex", flexDirection: "column",
      }}
    >
      <header
        style={{
          flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "10px 18px",
          background: "var(--chrome-bg)", borderBottom: "1px solid var(--chrome-divider)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--chrome-text)" }}>Admin</h1>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onExit}
          style={{
            border: "1px solid var(--border-strong)", borderRadius: RADIUS.md, background: "transparent",
            color: "var(--chrome-muted)", font: "inherit", fontSize: 12, fontWeight: 600,
            padding: "5px 12px", cursor: "pointer",
          }}
        >
          Back to Planyr
        </button>
      </header>
      <div style={{ flex: 1, minHeight: 0, padding: 18, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {SECTIONS.map((s) => (
          <Section key={s.id} title={s.title} blurb={s.blurb} />
        ))}
      </div>
    </div>
  );
}
