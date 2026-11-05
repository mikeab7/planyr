/* NEW-1 — "this person arrived by a password-reset link and has not chosen the new password yet".
 *
 * After verifyOtp the browser holds a real session, so closing the set-new-password form (or reloading the
 * page) would leave them signed in with an unknown password and nothing prompting them. So the moment a
 * reset link is honoured we write this flag; the Shell reopens the form while it is set, and the form clears
 * it only when the password has actually been changed (or the person signs out). It expires on its own after
 * the same hour the link lasted. Storage can be blocked — every access is guarded, and the form still opens
 * once from the live event. */
const KEY = "planyr:auth:recoveryPending";
const TTL_MS = 60 * 60 * 1000;

export function markRecoveryPending(now = Date.now()) { try { localStorage.setItem(KEY, String(now)); } catch (_) { /* blocked */ } }
export function clearRecoveryPending() { try { localStorage.removeItem(KEY); } catch (_) { /* blocked */ } }
export function isRecoveryPending(now = Date.now()) {
  try {
    const t = Number(localStorage.getItem(KEY));
    if (!t) return false;
    if (now - t > TTL_MS || t > now + 60000) { localStorage.removeItem(KEY); return false; }
    return true;
  } catch (_) { return false; }
}
