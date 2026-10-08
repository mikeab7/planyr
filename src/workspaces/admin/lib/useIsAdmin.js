/* useIsAdmin(user) — React face of adminStatus.js. `isAdmin` is true ONLY after a confirmed
 * "admin" for THIS user id; `recheck()` re-asks (the account menu calls it on open when the last
 * answer was an error). Starts false, so nothing ever flashes. */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../site-planner/lib/supabase.js";
import { adminStatusStore } from "./adminStatus.js";

export function useIsAdmin(user) {
  const userId = user?.id || null;
  // The answer is stored WITH the user id it belongs to, so a render right after an account switch
  // can never read the previous account's "admin".
  const [answer, setAnswer] = useState(() => ({ uid: userId, status: adminStatusStore.peek(userId) }));
  const status = answer.uid === userId ? answer.status : "unknown";

  const ask = useCallback((force) => {
    if (!userId) { adminStatusStore.reset(); setAnswer({ uid: null, status: "unknown" }); return () => {}; }
    let live = true;
    adminStatusStore.get(supabase, userId, { force }).then((s) => { if (live) setAnswer({ uid: userId, status: s }); });
    return () => { live = false; };
  }, [userId]);

  useEffect(() => { return ask(false); }, [userId, ask]);

  const recheck = useCallback(() => {
    if (adminStatusStore.peek(userId) === "error") ask(true);
  }, [userId, ask]);

  return { isAdmin: userId != null && status === "admin", status, recheck };
}
