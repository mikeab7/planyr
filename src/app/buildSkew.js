/* buildSkew — "this tab is running an older Planyr than the one that is deployed" (B1373).
 *
 * ═══ WHY THIS EXISTS, AND WHY IT IS LOAD-BEARING RATHER THAN A NICETY ═══════════════════
 *
 * A tab holds the index.html it was served, and that HTML names the hashed chunk files of
 * ONE build, forever. Nothing re-reads it while the tab lives. So a machine left open across
 * a deploy keeps running the old app indefinitely — and the old app does not merely lack a
 * fix, it lacks whole MODULES: it has no Notes tab because its workspace registry has no
 * Notes, and its router has no `notes` slug, so `#/notes` resolves to nothing and falls
 * silently back to the Site route. That is what happened on the owner's second machine on
 * 2026-07-31: the feature was live, the page showed no sign of it, and the only cure was a
 * hard reload nobody had a reason to try.
 *
 * The cost of that is not one confused morning. It makes every ship UNVERIFIABLE from the
 * owner's side: told a thing is live, he opens the app, sees no trace of it, and correctly
 * concludes it is not. A product that cannot tell you it is out of date cannot be checked.
 *
 * ═══ WHAT IT DOES ═══════════════════════════════════════════════════════════════════════
 *
 * The build bakes its id into the bundle (`__BUILD_ID__`) and ALSO writes it to
 * `/version.json`, served no-store. This module re-reads that file — on a delay after boot,
 * when the tab is looked at again, and on a slow interval — and compares. Different id =
 * the server has moved on = say so.
 *
 * Two rules it must obey, both of them about NOT being annoying or wrong:
 *   • It is NON-BLOCKING and DISMISSIBLE. A notice, never a takeover. The user's work is
 *     mid-sentence; the app has no business deciding for them when to reload.
 *   • It is SILENT WHEN IT CANNOT KNOW. A missing file, a 404, an offline network, a body
 *     that is not JSON, or a dev build all resolve to "no opinion" — never to a false
 *     "you are out of date". A skew notice that cries wolf is worse than none, because the
 *     one that matters gets dismissed by reflex.
 *
 * The DECISIONS here are pure and unit-tested (test/buildSkew.test.js); the wiring is the
 * thin part at the bottom.
 */

/* global __BUILD_ID__ */

/** The build this tab is actually running. "dev" under dev/test, where the define is absent
 *  — and a "dev" loaded build never reports skew (see `isBuildSkewed`). */
export const LOADED_BUILD = typeof __BUILD_ID__ !== "undefined" ? String(__BUILD_ID__) : "dev";

export const VERSION_URL = "/version.json";
/** Slow on purpose. A deploy is a once-a-day-ish event and this is a courtesy notice, not a
 *  heartbeat; the visibility/focus check below is what actually catches the common case (a
 *  laptop reopened the next morning). */
export const SKEW_POLL_MS = 15 * 60 * 1000;
/** Long enough after boot that the check never competes with first paint or the first
 *  workspace chunk for the network. */
export const SKEW_FIRST_CHECK_MS = 20 * 1000;

/** PURE. Is the served build meaningfully different from the one this tab is running?
 *
 *  Deliberately conservative — every "I don't know" answers false:
 *    • no served id (fetch failed, 404, junk body, offline)  → no opinion
 *    • the tab is running a dev build                        → no opinion
 *    • the ids match                                         → up to date
 *  Only two real, different, non-empty ids count as skew. */
export function isBuildSkewed(loaded, served) {
  const a = typeof loaded === "string" ? loaded.trim() : "";
  const b = typeof served === "string" ? served.trim() : "";
  if (!a || !b) return false;
  if (a === "dev" || b === "dev") return false;
  return a !== b;
}

/** PURE. Should the notice be shown, given what we know and what the user has dismissed?
 *
 *  A dismissal is scoped to the build it was dismissed FOR. Dismissing "1.2 is out" must not
 *  also silence "1.3 is out" three deploys later — that would turn one shrug into permanent
 *  deafness, which is the failure mode this whole module exists to prevent.
 *
 *  ⛔ B881667 — `routeMissed` alone is NOT sufficient, and used to be treated as "the definitive
 *  stale-build signal" on its own, with no version check. That conflates two different things
 *  that look identical from the inside: a slug shipped in a build newer than this tab's (a
 *  reload genuinely fixes it), and a slug that never existed in ANY build — a stale bookmark, an
 *  old shared link, a renamed route (a reload can NEVER fix it, because the newest possible
 *  build still won't recognize it). Owner repro: a hard-reloaded, confirmed-current tab visiting
 *  an unrecognized `/project/<id>/review` (the real route is `/markup`) still read "That part of
 *  Planyr is newer than the copy this tab has open" — false, since this tab already WAS the
 *  newest build. A route miss is now reserved for cases where it's ALSO true that the served
 *  build is confirmed to differ (`isBuildSkewed`) — the same evidence every other reason here
 *  already requires, matching this module's own "silent when it cannot know" contract. */
export function shouldOfferReload({ loaded, served, dismissedFor, routeMissed = false }) {
  if (!isBuildSkewed(loaded, served)) return false;
  if (routeMissed) return dismissedFor !== "route-miss" && dismissedFor !== served;
  return dismissedFor !== served;
}

/** Read the deployed build id. Resolves to null for EVERY failure — that is the contract the
 *  purity of `isBuildSkewed` depends on, and the reason there is no throw path here. */
export async function fetchServedBuild(fetchImpl, url = VERSION_URL) {
  const f = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!f) return null;
  try {
    const res = await f(url, { cache: "no-store", credentials: "omit" });
    if (!res || !res.ok) return null;
    const body = await res.json();
    const id = body && typeof body.build === "string" ? body.build.trim() : "";
    return id || null;
  } catch (_) {
    // Offline, blocked, or not JSON. "I don't know" — never "you are stale".
    return null;
  }
}

/* ---- wiring ----------------------------------------------------------------------------
 *
 * Thin by design: the interesting parts are above. `onServed` is called with the deployed
 * build id (or null) each time we manage to look; the caller decides what to render. Returns
 * an unsubscribe. */
export function installBuildSkewWatch({
  onServed,
  win = typeof window !== "undefined" ? window : null,
  fetchImpl = null,
  firstCheckMs = SKEW_FIRST_CHECK_MS,
  pollMs = SKEW_POLL_MS,
} = {}) {
  if (!win || typeof win.addEventListener !== "function") return () => {};
  let live = true;
  let inFlight = false;

  const look = async () => {
    // One at a time, and never while the tab is hidden — a backgrounded tab polling a
    // server it is not being looked at is pure waste.
    if (!live || inFlight) return;
    if (win.document && win.document.visibilityState === "hidden") return;
    inFlight = true;
    const served = await fetchServedBuild(fetchImpl);
    inFlight = false;
    if (live) onServed?.(served);
  };

  const first = win.setTimeout(look, firstCheckMs);
  const timer = win.setInterval(look, pollMs);
  // The case that actually matters: a machine woken up the next morning, on a build from
  // before the deploy. Looking at the tab again is the moment to find out.
  win.addEventListener("focus", look);
  win.document?.addEventListener?.("visibilitychange", look);

  return () => {
    live = false;
    win.clearTimeout(first);
    win.clearInterval(timer);
    win.removeEventListener("focus", look);
    win.document?.removeEventListener?.("visibilitychange", look);
  };
}
