/* activeUser.js — WHICH ACCOUNT the shared project store is bound to (B927105).
 *
 * Split out of storage.js so this one piece of state — and the handful of callers that only
 * ever need to READ or SET it — don't have to load the whole site-model / cloud-sync engine.
 * storage.js still owns everything else (the actual site records); it imports and re-exports
 * these three so every existing caller (SitePlanner.jsx, SitePlannerApp.jsx, …) is unaffected.
 *
 * ⛔ Keep this file free of any import into siteModel.js / cloudSync.js / elementSync.js (or
 * anything that imports THOSE) — that is the entire reason it exists. `clearSiteVersions()` is
 * the one exception: it lives in cloudSync.js, so it's reached through a dynamic import rather
 * than a static one. That cache is only ever populated once cloudSync.js has already run a
 * cloud read/write in this tab, so on any tab where it's still empty the dynamic import resolves
 * to nothing worth clearing; on a tab where it does hold something, cloudSync.js is already
 * loaded and the import resolves from the module cache. Either way there is no synchronous
 * consumer of the cleared cache — every reader of it is itself behind a network call.
 */

/* Cloud backend (Phase 4). When a user is signed in, `activeUser` holds their id:
 * the working store switches to a per-user local cache (pulled from Supabase on
 * login) and writes mirror to Supabase (RLS-scoped to them). Logged out,
 * activeUser is null and everything stays 100% localStorage (the legacy store). */
let activeUser = null;
export function setActiveUser(uid) {
  const next = uid || null;
  if (next !== activeUser) {
    // don't carry one user's optimistic-version tokens into another's session (B314)
    import("./cloudSync.js").then((m) => m.clearSiteVersions()).catch(() => {});
  }
  activeUser = next;
}
export const isCloudActive = () => !!activeUser;
export const activeUid = () => activeUser; // signed-in user's id, or null (B475 — warm the project cache)
export const cloudSitesKey = (uid) => "planarfit:sites:cloud:" + uid;
