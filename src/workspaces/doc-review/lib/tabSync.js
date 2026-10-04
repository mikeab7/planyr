/* tabSync — the open-tab set follows the ACCOUNT (owner correction, 2026-10-04).
 * Stored in the existing per-user sync row (`profiles.prefs`, key `reviewTabs`) — the same row, read/write path and
 * LOUD-FAILURE contract as every other account preference (userPrefsStore.js). No new table, no migration: a new
 * preference is a new key.
 * LAST CHANGE WINS (a timestamp on the whole set). Pull when Review opens and when the window regains focus / the
 * network returns; push (debounced by the caller) whenever the local set changes. Signed out or offline: the local copy
 * (DocReview's localStorage cache) is the source and `push` reports { ok:false } — the caller retries on the next
 * focus / online, and `pull` pushes a NEWER local copy instead of overwriting it with an older account copy.
 * The controller is backend-injectable so two simulated devices can share one account in a test.
 */
import { buildSyncDoc, parseSyncDoc, syncSig, applyRemote } from "./reviewTabs.js";

export function createTabSync({ backend, uid, now = Date.now }) {
  let appliedAt = 0;   // timestamp of the newest account copy this device has applied or written
  let pushedSig = null; // what the account is known to hold, as far as this device knows
  return {
    get appliedAt() { return appliedAt; },
    /** Pull the account copy and fold it in. `snap` = { tabs, activeId, states, at } (at = when this device last changed it). */
    async pull(snap, { adoptActive = false, isDirty } = {}) {
      let raw;
      try { raw = await backend.read(uid); } catch (e) { return { ok: false, changed: false, error: (e && e.message) || "offline" }; }
      const remote = parseSyncDoc(raw);
      if (!remote) { // nothing in the account yet — whatever this device has becomes it (if it has anything)
        if (snap.tabs.length) return { ...(await this.push(snap)), changed: false };
        return { ok: true, changed: false };
      }
      if ((snap.at || 0) > remote.at && syncSig(snap) !== syncSig({ tabs: remote.tabs, activeId: remote.active, states: Object.fromEntries(remote.tabs.map((t) => [t.id, t.state])) })) {
        return { ...(await this.push(snap)), changed: false, pushedNewerLocal: true }; // offline edits made here are NEWER: they win
      }
      if (remote.at <= appliedAt && !adoptActive) return { ok: true, changed: false };
      const res = applyRemote(snap, remote, { isDirty, adoptActive });
      appliedAt = remote.at;
      pushedSig = syncSig(res);
      return { ok: true, ...res, at: remote.at };
    },
    /** Write the local set to the account. Skips when it is what the account already holds. */
    async push(snap) {
      const sig = syncSig(snap);
      if (sig === pushedSig) return { ok: true, skipped: true };
      const at = Math.max(now(), appliedAt + 1);
      try { await backend.write(uid, buildSyncDoc({ ...snap, at })); } catch (e) { return { ok: false, error: (e && e.message) || "offline" }; }
      pushedSig = sig; appliedAt = at;
      return { ok: true, at };
    },
  };
}

/** The real backend: the signed-in user's `profiles.prefs.reviewTabs`, via the one shared prefs store (loaded lazily so
 *  Review's chunk does not pull the Site planner's style modules at boot). A read that could only reach the on-device
 *  mirror is an ERROR here — an offline read must never look like "the account has no tabs". */
export const prefsBackend = {
  async read(uid) {
    const [store, cache] = await Promise.all([import("../../site-planner/lib/userPrefsStore.js"), import("../../../shared/profile/profileRowCache.js")]);
    cache.invalidateProfileRow(uid); // a focus-time pull must see the other device's latest write, not a cached row
    const { prefs, source, error } = await store.loadPrefsRaw(uid);
    if (source !== "cloud") throw new Error(error || "offline");
    return prefs.reviewTabs || null;
  },
  async write(uid, doc) {
    const store = await import("../../site-planner/lib/userPrefsStore.js");
    const r = await store.updatePrefs(uid, (p) => ({ ...p, reviewTabs: doc }));
    if (!r.ok) throw new Error(r.error || "save failed");
  },
};
