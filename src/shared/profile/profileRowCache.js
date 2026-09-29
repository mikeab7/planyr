/* Session-scoped cache for a signed-in user's ONE `public.profiles` row (NEW-1 — a project-open
 * perf report measured this table's `prefs` column alone fetched 5-8 times on a single cold
 * load, because several independent modules — `profile.js`, `userPrefs.js`,
 * `compsRatePeriodPrefs.js`, the dashboard's own two prefs stores — each read the SAME row with
 * their own direct `supabase.from("profiles").select(...)` call, usually within the same tick
 * (several components mounting at once: MapFinder, SitePlanner and CompsPanel all read some
 * slice of this row on mount, independently).
 *
 * This is the one place that actually talks to the table for a casual LOAD. Every SAVE path
 * does its own fresh read-modify-write immediately before its upsert (B1953793: `updatePrefs`
 * in userPrefsStore.js joined the dashboard/comps writers here — the older `savePrefsRaw` wrote
 * a whole in-memory bag and was the lost-update bug; it is no longer used by UI writers) —
 * correctness there (merging a patch into whatever the row currently holds, NEVER this cache)
 * matters more than sharing a cache would help, so writes bypass it — and each save calls `invalidateProfileRow` after a
 * successful write so the NEXT load is never served a pre-write value for the rest of the
 * cache window.
 *
 * Concurrent callers for the SAME uid share ONE in-flight request; the resolved row is then kept
 * for `PROFILE_ROW_TTL_MS` so components that mount a few seconds apart (not just the same tick)
 * still share one fetch. A failed read REJECTS (every existing caller already wraps its own read
 * in a try/catch with its own fallback — collapsing that to a bare `null` here would have thrown
 * away the "offline, fall back to the local mirror" distinction `userPrefs.js` /
 * `compsRatePeriodPrefs.js` depend on) and is evicted immediately rather than cached, so the next
 * call retries instead of being stuck failing for the rest of the TTL window.
 */
import { supabase } from "../../workspaces/site-planner/lib/supabase.js";

// Long enough to absorb a burst of independently-mounted components (the measured case — several
// components reading this row within the same project-open); short enough that a stale read past
// a missed invalidation call self-heals well within a session.
const PROFILE_ROW_TTL_MS = 30_000;

const entries = new Map(); // uid -> { promise, expiresAt }

async function fetchRow(uid) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
  if (error) throw error;
  return data || null;
}

/** The signed-in user's `profiles` row, or `null` signed out / no row yet. Coalesces concurrent
 *  callers for the same uid into one request and caches the settled result for a short session
 *  window. REJECTS on a real fetch error (offline, RLS, a thrown error) — same as a direct
 *  Supabase call would — so a caller that needs to tell "no row" apart from "the read failed"
 *  still can. */
export function getProfileRow(uid) {
  if (!supabase || !uid) return Promise.resolve(null);
  const now = Date.now();
  const hit = entries.get(uid);
  if (hit && hit.expiresAt > now) return hit.promise;
  const promise = fetchRow(uid);
  entries.set(uid, { promise, expiresAt: now + PROFILE_ROW_TTL_MS });
  // Don't hold a FAILED read for the whole TTL — evict it immediately so the next caller
  // retries instead of being stuck failing until the window expires.
  promise.catch(() => { entries.delete(uid); });
  return promise;
}

/** Call after any write to this user's `profiles` row (prefs, name/org, …) so the NEXT load is
 *  fresh rather than serving a pre-write value for the rest of the cache window. Omit `uid` to
 *  clear every cached row (e.g. on sign-out). */
export function invalidateProfileRow(uid) {
  if (uid) entries.delete(uid);
  else entries.clear();
}
