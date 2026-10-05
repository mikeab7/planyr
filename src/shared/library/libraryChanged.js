/* libraryChanged — "the Library's file list just changed" (B2084480).
 *
 * Review writes a file (save / save-as-new / refile / delete) and the Library tab, which stays mounted and only
 * refetches when it is activated or the window regains focus, kept showing the list it loaded BEFORE the write
 * landed. One tiny signal closes that: every writer announces, every Library surface re-reads.
 *
 * Same document: a plain listener set (BroadcastChannel never delivers to the posting instance itself).
 * Other tabs of this browser: a BroadcastChannel message. Where BroadcastChannel is missing it degrades to the
 * same-document set — the focus/visibility refetch the Library already has still covers other tabs eventually.
 * Carries NO data (a re-read is the one source of truth), so there is nothing to go stale in transit.
 */
const CHANNEL = "planyr-library-changed-v1";
const listeners = new Set();
let bc = null;
let bcTried = false;

function channel() {
  if (bcTried) return bc;
  bcTried = true;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = () => fire();
    }
  } catch (_) { bc = null; }
  return bc;
}

function fire() {
  for (const fn of [...listeners]) { try { fn(); } catch (_) { /* one bad listener must not mute the rest */ } }
}

/** Announce that Library-visible data changed (here and in every other tab of this browser). */
export function notifyLibraryChanged() {
  fire();
  try { const c = channel(); if (c) c.postMessage({ t: Date.now() }); } catch (_) { /* closed channel — same-document fire already ran */ }
}

/** Subscribe; returns the unsubscribe. */
export function subscribeLibraryChanged(fn) {
  channel(); // arm the cross-tab receiver as soon as anyone listens
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
