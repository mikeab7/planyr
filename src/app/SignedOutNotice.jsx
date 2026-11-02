/* "You were signed out. Sign in to continue." (NEW-1 point 5, follow-up to B2619760)
 *
 * Shown when the session ended without the person asking — a refresh token the server no longer honours
 * (revoked, expired, "sign out on all devices" from another machine) or a boot that found a stored session
 * and could not keep it. It used to be silent: the open plan closed to the map and nothing said why. A
 * deliberate Sign out shows nothing (sessionIntent.js tells them apart). The route is NOT touched, so signing
 * back in returns to the same plan. Floating through the shared FloatingNotice (docs/DESIGN.md), module scope. */
import FloatingNotice from "../shared/ui/FloatingNotice.jsx";
import { RADIUS } from "../shared/ui/radius.js";
import { FONT_SIZE } from "../shared/ui/designTokens.js";
import { SIGNED_OUT_NOTICE } from "../shared/auth/sessionIntent.js";

const MAX_WIDTH = "min(480px, calc(100vw - 16px))";

export default function SignedOutNotice({ onSignIn, onDismiss }) {
  return (
    <FloatingNotice maxWidth={MAX_WIDTH}>
      <div
        role="status" data-testid="signed-out-notice"
        style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 14px",
          background: "var(--warn-bg)", border: "1px solid var(--warn-border)", borderRadius: RADIUS.lg,
          color: "var(--warn-text)", fontSize: FONT_SIZE.emphasis, fontWeight: 600,
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>{SIGNED_OUT_NOTICE}</span>
        <button type="button" onClick={onSignIn} style={{ flex: "0 0 auto", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill, background: "transparent", color: "var(--warn-text)", font: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700, padding: "2px 12px", cursor: "pointer" }}>Sign in</button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" style={{ flex: "0 0 auto", border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, background: "transparent", color: "var(--text-tertiary)", font: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700, padding: "2px 10px", cursor: "pointer" }}>Dismiss</button>
      </div>
    </FloatingNotice>
  );
}
