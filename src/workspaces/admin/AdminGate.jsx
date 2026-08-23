/* AdminGate (B711904 / NEW-1) — the ONLY place in the app that decides whether to render
 * the admin page for the currently signed-in user.
 *
 * Deliberately fails toward rendering NOTHING: while the check hasn't resolved, and for
 * every denied/errored/signed-out case, this renders null so Shell.jsx falls through to
 * the ordinary workspace it would show for any other unrecognized route — the "404, not a
 * permission error" requirement. Only a confirmed `true` from checkIsAdmin ever mounts
 * AdminApp. No RPC call is made at all while signed out — there is nothing to check.
 */
import { useEffect, useState } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { checkIsAdmin } from "./lib/adminAccess.js";
import AdminApp from "./AdminApp.jsx";

export default function AdminGate({ user, onExit }) {
  const [allowed, setAllowed] = useState(false);
  const userId = user?.id || null;

  useEffect(() => {
    let live = true;
    if (!userId) { setAllowed(false); return; }
    checkIsAdmin(supabase).then((ok) => { if (live) setAllowed(ok); });
    return () => { live = false; };
  }, [userId]);

  if (!allowed) return null;
  return <AdminApp onExit={onExit} />;
}
