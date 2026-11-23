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

/* THE one serialized writer of the `public.profiles.prefs` blob (B2 audit 2026-11-20, item 1).
 *
 * Several modules own a key inside that one jsonb bag (site-planner prefs, dashboard layout,
 * dashboard project order, since-last-here, comps rate period). Each used to run its own
 * read -> merge -> upsert with its OWN write queue (or none), so two saves from different modules
 * could interleave: both read the same old row, each wrote its own key back over the other's —
 * a lost update (dashboard layout / Review tabs reverting).
 *
 * Every writer now goes through `updateProfilePrefs`: ONE module-level queue for all of them, and
 * each step does a FRESH read of the row immediately before its upsert. Dependency-light on purpose
 * (no site-planner prefs/normalizer code) so the dashboard chunk stays lean.
 *
 * LOUD-FAILURE: resolves { ok:false, error } — never throws, never reports a silent success.
 */
let writeChain = Promise.resolve();

/** `reducer(rawPrefsObject) -> nextPrefsObject`, applied to the account row read fresh right now. */
export function updateProfilePrefs(uid, reducer) {
  if (!supabase || !uid) return Promise.resolve({ ok: false, error: "not signed in" });
  const run = async () => {
    try {
      const { data: row, error: readErr } = await supabase.from("profiles").select("prefs").eq("id", uid).maybeSingle();
      if (readErr) return { ok: false, error: readErr.message };
      const prev = (row?.prefs && typeof row.prefs === "object" && !Array.isArray(row.prefs)) ? row.prefs : {};
      const next = reducer(prev);
      const { error } = await supabase.from("profiles").upsert({ id: uid, prefs: next, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) return { ok: false, error: error.message };
      invalidateProfileRow(uid); // the next load must see this write, not a cached pre-write row
      return { ok: true, prefs: next };
    } catch (e) {
      return { ok: false, error: e?.message || "prefs save failed" };
    }
  };
  const p = writeChain.then(run, run);
  writeChain = p.catch(() => {});
  return p;
}
