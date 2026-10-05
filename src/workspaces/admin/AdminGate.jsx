/* AdminGate (B711904 / NEW-1) — the ONLY place in the app that decides whether to render
 * the admin page for the currently signed-in user.
 *
 * Deliberately fails toward rendering NOTHING: while the check hasn't resolved, and for
 * every denied/errored/signed-out case, this renders null so Shell.jsx falls through to
 * the ordinary workspace it would show for any other unrecognized route — the "404, not a
 * permission error" requirement. Only a confirmed "admin" ever mounts AdminApp. No RPC call
 * is made at all while signed out — there is nothing to check.
 *
 * NEW-2: the answer comes from the shared per-user store (lib/adminStatus.js), so the account
 * menu and this gate agree and ask once. A genuine ERROR (as opposed to an honest "no") is
 * retried a couple of times so a cold load of #/admin on a flaky connection still lets an
 * allowlisted account in; a definite "not-admin" is never retried.
 */
import { useEffect } from "react";
import { useIsAdmin } from "./lib/useIsAdmin.js";
import AdminApp from "./AdminApp.jsx";

const RETRY_DELAYS_MS = [2000, 5000];

export default function AdminGate({ user, onExit, onShownChange }) {
  const { isAdmin, status, recheck } = useIsAdmin(user);
  const userId = user?.id || null;

  useEffect(() => {
    if (!userId || status !== "error") return undefined;
    let n = 0;
    let timer = null;
    const tick = () => {
      if (n >= RETRY_DELAYS_MS.length) return;
      timer = setTimeout(() => { n += 1; recheck(); tick(); }, RETRY_DELAYS_MS[n]);
    };
    tick();
    return () => clearTimeout(timer);
  }, [userId, status, recheck]);

  // Tell the shell whether the admin page is really on screen (see Shell.jsx `adminShown`); always
  // reset on unmount so leaving #/admin can never strand the workspaces inactive.
  useEffect(() => {
    if (!onShownChange) return undefined;
    onShownChange(isAdmin);
    return () => onShownChange(false);
  }, [isAdmin, onShownChange]);

  if (!isAdmin) return null;
  return <AdminApp onExit={onExit} user={user} />;
}
