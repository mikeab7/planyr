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
import { useEffect, useRef, useState } from "react";
import { RADIUS } from "../shared/ui/radius.js";
import { MenuTrigger } from "../shared/ui/controls.jsx";
import { supabase, supabaseConfigured } from "../workspaces/site-planner/lib/supabase.js";
import { signOut } from "../workspaces/site-planner/lib/auth.js";
import { checkIsAdmin } from "../workspaces/admin/lib/adminAccess.js";
import AnchoredMenu from "../shared/ui/AnchoredMenu.jsx";

// Chrome tokens (theme-aware — the account surface themes WITH the app, B318/B341).
// NEW-1 (B982400) — `LINE` (--chrome-divider) is now hardcoded inside the shared MenuTrigger
// primitive every chip in this file uses, so this file no longer needs its own copy.
const MUTED = "var(--chrome-muted)";

// ── Account pill + dropdown styling (B298). The dropdown reuses AnchoredMenu — the
// same portal menu primitive as the project breadcrumb — so it escapes the header's
// stacking/clipping context and lines up under the pill, consistent with that menu.
// ⛔ NEW-1 (B982400) — the hand-rolled `pill` shape this comment used to describe is GONE; the
// account/sign-in pills below are now the shared `MenuTrigger` primitive (controls.jsx), which
// draws the identical border/background/font this object did (still `RADIUS.control`, same value
// as the `RADIUS.md` this history describes — see controls.jsx's own SIZE bundle header) plus a
// LOCKED height (30) neither this object nor its B972096 predecessor ever pinned. The history
// below is kept because it's still why the shape is what it is; the object itself is deleted
// rather than left as dead code.
// NEW-1 (B972096) — was RADIUS.pill. Per docs/DESIGN.md's own shape rule, `pill` is reserved for
// a CONTAINER that holds other controls (a segmented shell, a toggle bar whose height IS its
// shape); this chip is a single control that opens a menu, exactly like the row-1 "File ▾"
// button — it was a pill by habit (it happens to hold an avatar + a name + a caret), not by
// decision. `RADIUS.md` converges it with every other standalone control in row-1's right zone
// (FullscreenButton, SettingsMenu, CloudSyncBadge, the presence chip) onto one family, closing
// out the owner's third report of the same visual mismatch (B950320/B958466 each "fixed" their
// own narrow pair — a divider, a token reclassification — without ever converging the row).
const avatar = (signedIn, size = 20) => ({
  width: size, height: size, borderRadius: RADIUS.pill, flex: "none",
  display: "grid", placeItems: "center",
  fontSize: size >= 28 ? 12.5 : 10.5, fontWeight: 800,
  // Signed-in: white initial on the green gradient. Signed-out: the badge sits on the
  // light/elevated pill, so it must use chrome tokens — a hardcoded white "›" was
  // invisible on the now-light chrome (same theme-flip trap as B341).
  color: signedIn ? "#fff" : "var(--chrome-text)",
  background: signedIn ? "linear-gradient(150deg,#16a34a,#15803d)" : "var(--chrome-bg)",
});
const acctPanel = {
  padding: 6, borderRadius: RADIUS.lg, background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", boxShadow: "0 14px 34px rgba(0,0,0,0.28)",
  fontFamily: "system-ui, sans-serif",
};
const acctRow = {
  display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
  padding: "8px 9px", borderRadius: RADIUS.sm, border: "none", background: "transparent",
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
  admin:    (<><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" /></>),
  signout:  (<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>),
};

export default function AccountControl({ user, profileApi, onOpenAuth, onOpenAccount }) {
  const [acctOpen, setAcctOpen] = useState(false);  // account dropdown (signed-in pill, B298)
  const [cloudNote, setCloudNote] = useState(false); // "Cloud off" explainer popover
  const acctAnchor = useRef(null);
  const who = profileApi?.displayName;

  // NEW-1 (B711904 follow-up) — reuses the EXISTING admin gate (checkIsAdmin / is_admin()),
  // never a second access mechanism. Fails closed and starts false, so there is nothing to
  // flash: the Admin row below only ever APPEARS once a confirmed `true` comes back, it is
  // never rendered greyed/disabled/pending. This is a CONVENIENCE link, not a security
  // boundary — the route and every RPC behind it stay server-gated (admin_users keeps its
  // zero-policy RLS; is_admin() is the only door), so a non-admin who types #/admin still
  // gets the ordinary app exactly as before this link existed.
  const [isAdmin, setIsAdmin] = useState(false);
  const userId = user?.id || null;
  useEffect(() => {
    let live = true;
    if (!userId) { setIsAdmin(false); return; }
    checkIsAdmin(supabase).then((ok) => { if (live) setIsAdmin(ok); });
    return () => { live = false; };
  }, [userId]);

  // Close the dropdown on ANY workspace navigation. Every module switch — a tab click, a
  // programmatic navigate, AND browser Back/Forward — goes through window.location.hash and
  // fires `hashchange` (see app/route.js). The dropdown is a portal-to-body flyout (AnchoredMenu),
  // and every kept-alive header renders its own AccountControl instance, so a menu left open while
  // the user navigates via Back/Forward — the one nav path the click-away backdrop can't intercept —
  // would leave THIS (now display:none) instance's portal hanging over the newly-active workspace.
  // Closing on hashchange collapses it cleanly. In-page actions (Profile/Team/Settings open a modal,
  // Sign out) don't change the hash, so they don't trip this. (B734 follow-up; broader AnchoredMenu
  // class tracked in B735.) The listener is attached only while open.
  useEffect(() => {
    if (!acctOpen) return;
    const close = () => setAcctOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, [acctOpen]);

  if (!supabaseConfigured()) {
    // Cloud not configured — show a "Cloud off" pill with an explanatory popover.
    return (
      <div style={{ position: "relative" }}>
        {/* NEW-1 (B982400) — was a hand-rolled chip (RADIUS.md, an asymmetric "4px 10px 4px 6px"
            pad, an auto height around 30px); now the shared MenuTrigger (size="md"), which is
            the same locked (radius, height, padding, font) bundle the account/sign-in pills below
            use — one family for the whole "opens something" row-1 chip class, not three
            independently hand-tuned near-matches. `caret={false}`: this opens a popover
            explainer, not a menu. `textColor=MUTED` keeps the deliberate "quieter than an active
            account" reading — a real, kept distinction, not a geometry override. */}
        <MenuTrigger
          onClick={() => setCloudNote((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={cloudNote}
          title="Cloud sync isn't set up — your work is saved on this device only"
          caret={false}
          textColor={MUTED}
          leading={
            <span
              style={{
                width: 20, height: 20, borderRadius: RADIUS.pill, flex: "none",
                display: "grid", placeItems: "center",
                fontSize: 12, fontWeight: 800, color: MUTED,
                background: "var(--chrome-divider)",
              }}
            >
              ⊘
            </span>
          }
        >
          Cloud off
        </MenuTrigger>
        {cloudNote && (
          <>
            <div onClick={() => setCloudNote(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
            <div
              role="dialog"
              style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 41,
                width: 256, padding: "11px 13px", borderRadius: RADIUS.lg,
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
    // NEW-1 (B982400) — was a hand-rolled `pill` (see the shared style object above, now unused
    // by this file — MenuTrigger is the same shape, byte-for-byte). `caret={false}`: this opens a
    // modal, not a menu.
    return (
      <MenuTrigger onClick={onOpenAuth} title="Sign in or create an account" caret={false} leading={<span style={avatar(false)}>›</span>}>
        Sign in
      </MenuTrigger>
    );
  }

  // Signed in — the pill shows the user's name and opens an account dropdown (B298).
  // NEW-1 (B982400) — was the hand-rolled `pill` shape; MenuTrigger draws the same border/
  // background/radius/font, with its own trailing ▾ caret replacing the inline one below.
  return (
    <>
      <MenuTrigger
        ref={acctAnchor}
        onClick={() => setAcctOpen((o) => !o)}
        open={acctOpen}
        title={`Signed in as ${user?.email || "(no email)"}`}
        leading={<span style={avatar(true)}>{profileApi.initial}</span>}
      >
        {who}
      </MenuTrigger>
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
        {isAdmin && (
          <>
            <div style={acctDivider} />
            <button
              data-testid="account-admin-row"
              style={acctRow}
              onClick={() => { setAcctOpen(false); window.location.hash = "#/admin"; }}
              onMouseEnter={hoverOn} onMouseLeave={hoverOff}
            >
              <RowIcon d={ICON.admin} /> Admin
            </button>
          </>
        )}
        <div style={acctDivider} />
        <button style={acctRow} onClick={async () => { setAcctOpen(false); await signOut(); }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
          <RowIcon d={ICON.signout} /> Sign out
        </button>
      </AnchoredMenu>
    </>
  );
}
