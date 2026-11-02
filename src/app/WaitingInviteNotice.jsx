/* WaitingInviteNotice — "an invitation is waiting; use the link in your email" (NEW-1, 2026-11-02, item 6).
 *
 * Someone signed up with an address a team had already invited, without using the invite link. Email confirmation is off,
 * so the address alone proves nothing and they are NOT on the team (and a stranger who typed that address is not either).
 * Right after sign-in this tells them an invitation is waiting and to open the link in the email, with a resend. Shown
 * ONCE per account per browser session; the account menu's "waiting" card stays for later.
 *
 * WHAT IT NEVER SAYS: the team's name, who invited them, or the role. The mailbox is not proven, and naming the team would
 * tell a stranger who typed someone else's address which team wanted that person. (An invitation that arrives by the link
 * itself is handled by InviteLanding, not here.) Module-scope component only. */
import { useEffect, useState } from "react";
import FloatingNotice from "../shared/ui/FloatingNotice.jsx";
import { Button } from "../shared/ui/controls.jsx";
import { RADIUS } from "../shared/ui/radius.js";
import { FONT_SIZE } from "../shared/ui/designTokens.js";
import { useTeamInvites } from "./teamInvites.js";

const KEY = (uid) => `planyr:waitingInviteNotice:${uid}`;
const seen = (uid) => { try { return sessionStorage.getItem(KEY(uid)) === "1"; } catch (_) { return false; } };
const markSeen = (uid) => { try { sessionStorage.setItem(KEY(uid), "1"); } catch (_) { /* private mode — it may show once more */ } };

export default function WaitingInviteNotice({ user }) {
  const uid = user ? user.id : null;
  const { waiting, status, sentTo, resend } = useTeamInvites(user);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const show = !!uid && !hidden && status === "ok" && waiting > 0 && !seen(uid);
  // Record that it was shown, so a reload in the same session does not nag again.
  useEffect(() => { if (show) markSeen(uid); }, [show, uid]);
  if (!show) return null;
  const address = user.email || "your email";
  const go = async () => { setBusy(true); setErr(""); const r = await resend(); setBusy(false); if (!r.ok) setErr(r.text); };
  return (
    <FloatingNotice testId="waiting-invite-notice">
      <div role="status" style={{
        padding: "12px 14px", borderRadius: RADIUS.md, background: "var(--surface-raised, var(--surface))", color: "var(--text)",
        border: "1px solid var(--border-default)", fontSize: FONT_SIZE.control, lineHeight: 1.45,
      }}>
        <div style={{ fontWeight: 700, fontSize: FONT_SIZE.emphasis, overflowWrap: "anywhere" }}>A team invitation is waiting for {address}.</div>
        <div style={{ color: "var(--text-secondary)", marginTop: 2, overflowWrap: "anywhere" }}>
          {sentTo ? `We sent a confirmation to ${sentTo}. Open the link in it to accept.` : "Open the link in your invitation email to accept it."}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <Button size="sm" data-testid="waiting-invite-resend" disabled={busy} onClick={go}>{busy ? "Sending…" : sentTo ? "Resend" : "Email it to me again"}</Button>
          <Button size="sm" variant="ghost" data-testid="waiting-invite-dismiss" onClick={() => setHidden(true)}>Dismiss</Button>
        </div>
        {err && <div role="alert" style={{ marginTop: 6, color: "var(--danger-text)" }}>{err}</div>}
      </div>
    </FloatingNotice>
  );
}
