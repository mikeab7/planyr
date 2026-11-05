/* Model workspace — "who is signed in on this device?", answered SYNCHRONOUSLY from the stored session (NEW-1, B2607857).
 *
 * The pre-built grid needs the stored workbook of the project the pointer is aimed at, and the device copy is keyed by the account
 * (`planyr:model:sheet:v1:<userId|local>:<projectId>`, lib/modelStore.js). The real answer to "who" comes from the auth client, asynchronously, long after the
 * hover. supabase-js keeps its session in localStorage (`sb-<ref>-auth-token`), so a hover can read the id straight from it. A WRONG guess here
 * costs nothing: the workbook it finds either equals the one the grid mounts with (adopted) or differs (the normal load runs).
 * Dependency-free on purpose (the shell-side warm-up may import it). Never throws; null = signed out / unreadable. */
const AUTH_KEY = /^sb-.*-auth-token$/;

const jwtSub = (token) => {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = JSON.parse(json).sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch (_) { return null; }
};

/** The signed-in user's id from the stored session, or null. */
export function deviceUserId(storage = typeof localStorage === "undefined" ? null : localStorage) {
  if (!storage) return null;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || !AUTH_KEY.test(k)) continue;
      try {
        const v = JSON.parse(storage.getItem(k) || "null");
        const s = v && (v.currentSession || v);
        const id = (s && s.user && s.user.id) || jwtSub(s && s.access_token);
        if (id) return String(id);
      } catch (_) { /* a corrupt entry: keep scanning (B539's rule) */ }
    }
  } catch (_) { /* storage blocked */ }
  return null;
}
