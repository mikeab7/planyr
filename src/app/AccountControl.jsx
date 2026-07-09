/* AccountControl — the header's right-edge auth surface: the signed-in account pill + its
 * dropdown (Profile / Team / Settings / Sign out), the signed-out "Sign in" pill, and the
 * "Cloud off" explainer when Supabase isn't configured.
 *
 * WHY THIS IS ITS OWN COMPONENT (B734). Shell builds ONE authControl element and passes it to
 * every kept-alive workspace's AppHeader — so several copies of the trigger button mount at
 * once (Site map header + Site plan header + DocReview + Library + Scheduler), most of them
 * display:none. When the anchor ref + open state lived in Shell and were shared across all those
 * copies, the ref resolved to whichever copy React committed last — usually a hidden one, whose
 * getBoundingClientRect() is all zeros — so the AnchoredMenu clamped to the top-left corner.
 * Making this a component means each mounted instance owns its OWN ref + open state (independent
 * hooks per fiber position), so the visible instance's menu anchors under its own pill — the same
 * pattern SettingsMenu / ProjectBreadcrumb already use. Defined at module scope
 * (MODULE-SCOPE-COMPONENTS), never inside Shell's render.
 *
 * Props: user, profileApi, onOpenAuth(), onOpenAccount(tab). Everything else (the configured
 * gate, sign-out, the menu primitive) is imported directly — this file is app-shell chrome, at
 * the same import depth Shell uses, so src/shared/ui stays free of workspace-lib imports.
 */
import { useRef, useState } from "react";
import { supabaseConfigured } from "../workspaces/site-planner/lib/supabase.js";
import { signOut } from "../workspaces/site-planner/lib/auth.js";
import AnchoredMenu from "../shared/ui/AnchoredMenu.jsx";

// Chrome tokens (theme-aware — the account surface themes WITH the app, B318/B341).
const LINE  = "var(--chrome-divider)";
const MUTED = "var(--chrome-muted)";

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

export default function AccountControl({ user, profileApi, onOpenAuth, onOpenAccount }) {
  const [acctOpen, setAcctOpen] = useState(false);  // account dropdown (signed-in pill, B298)
  const [cloudNote, setCloudNote] = useState(false); // "Cloud off" explainer popover
  const acctAnchor = useRef(null);
  const who = profileApi?.displayName;

  if (!supabaseConfigured()) {
    // Cloud not configured — show a "Cloud off" pill with an explanatory popover.
    return (
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
  }

  if (!user) {
    // Logged out — a "Sign in" pill that opens the auth modal directly.
    return (
      <button onClick={onOpenAuth} title="Sign in or create an account" style={pill}>
        <span style={avatar(false)}>›</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Sign in</span>
      </button>
    );
  }

  // Signed in — the pill shows the user's name and opens an account dropdown (B298).
  return (
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
        <button style={acctRow} onClick={() => { setAcctOpen(false); onOpenAccount("profile"); }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
          <RowIcon d={ICON.profile} /> Profile
        </button>
        <button style={acctRow} onClick={() => { setAcctOpen(false); onOpenAccount("team"); }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
          <RowIcon d={ICON.team} /> Team
        </button>
        <button style={acctRow} onClick={() => { setAcctOpen(false); onOpenAccount("settings"); }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
          <RowIcon d={ICON.settings} /> Settings
        </button>
        <div style={acctDivider} />
        <button style={acctRow} onClick={async () => { setAcctOpen(false); await signOut(); }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
          <RowIcon d={ICON.signout} /> Sign out
        </button>
      </AnchoredMenu>
    </>
  );
}
