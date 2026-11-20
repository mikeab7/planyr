/* Did the person sign out, or did the session die under them? (NEW-1, follow-up to B2619760)
 *
 * supabase-js emits SIGNED_OUT for BOTH: a person pressing Sign out, and a refresh token that the
 * server no longer honours (revoked, expired, "sign out on all devices" from another machine). The app
 * used to treat them identically — the open plan closed to the map and nothing said why. This module
 * is the one place that tells them apart, and it adds a third fact the boot needs:
 *
 *   pending  INITIAL_SESSION came back EMPTY while a session is still in storage — the stored token
 *            could not be refreshed yet (no network). That is "not known", not "signed out": the
 *            header must not show a Sign in pill, and a later TOKEN_REFRESHED will deliver the user.
 *            (A token the server refused is REMOVED from storage before the event fires, so a dead
 *            session never reads as pending.)
 *   lost     the session ended without the person asking: a SIGNED_OUT nobody here caused, or a boot
 *            that found a stored session and ended up with none.
 *   deliberate  Sign out / Sign out on all devices was pressed in THIS tab (`markDeliberateSignOut`,
 *            called by the auth wrappers before they talk to Supabase). Cleared by the next sign-in.
 *
 * Pure decision (`authEventMeta`) + a few lines of state. Dependency-free: it is in the entry chunk. */

const KEY_RE = /^sb-.*-auth-token$/;

/** Is a Supabase session stored on this device (localStorage `sb-<ref>-auth-token`)? Never throws. */
export function hasStoredSessionKey(storage) {
  try {
    const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!s) return false;
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && KEY_RE.test(k) && s.getItem(k)) return true; }
  } catch (_) { /* storage blocked — no stored session we can see */ }
  return false;
}

/** Captured once at module load: did this page START with a stored session? */
export const bootHadStoredSession = hasStoredSessionKey();

let deliberate = false;
export const markDeliberateSignOut = () => { deliberate = true; };
export const clearSignOutIntent = () => { deliberate = false; };
export const signOutWasDeliberate = () => deliberate;

/** Pure: the facts about one auth event. `storedNow` / `bootHadStored` / `deliberate` are passed in. */
export function authEventMeta(event, user, { storedNow = false, bootHadStored = false, deliberate: d = false } = {}) {
  if (user) return { deliberate: false, pending: false, lost: false };
  const pending = event === "INITIAL_SESSION" && storedNow;
  const lost = !d && (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && bootHadStored && !storedNow));
  return { deliberate: d, pending, lost };
}

/** The meta for an event happening now (reads storage + module state). A user event ends the sign-out intent. */
export function currentAuthEventMeta(event, user) {
  const meta = authEventMeta(event, user, { storedNow: hasStoredSessionKey(), bootHadStored: bootHadStoredSession, deliberate });
  if (user) clearSignOutIntent();
  return meta;
}

export const SIGNED_OUT_NOTICE = "You were signed out. Sign in to continue.";
