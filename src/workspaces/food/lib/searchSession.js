/* searchSession — the request side of the Food search box (NEW-1 perf, 2026-10-04). Pure JS: no
 * React, no Supabase import (the caller hands in `run`).
 *
 * Three jobs, none of which changes WHAT a search returns — only how fast and how safely it lands:
 *   · CANCEL — a newer query aborts the in-flight one (AbortController), so a slow answer for "ta"
 *     never occupies the connection while "tacos" is waiting, and never lands at all.
 *   · IGNORE OUT-OF-ORDER — every search is numbered; a response that is not the latest one comes
 *     back `stale: true` and the caller drops it. (Aborting is best-effort — a response can already
 *     be on the wire — so the number, not the abort, is what guarantees correctness.)
 *   · CACHE — recent answers for the SAME query AND the SAME map centre are kept for the session
 *     (backspace, retype, flick back to a query). The centre is part of the key because the server
 *     breaks name-ties by distance from it, so an answer is only reusable where that is unchanged.
 *     Errors and aborted calls are never cached.
 */
export const CACHE_MAX = 40;

export function searchKey(query, center) {
  const q = (query || "").trim().toLowerCase();
  const c = center && Number.isFinite(center.lat) && Number.isFinite(center.lon)
    ? `${center.lat.toFixed(5)},${center.lon.toFixed(5)}` : "none";
  return `${q}@${c}`;
}

export function createSearchSession({ run, max = CACHE_MAX } = {}) {
  const cache = new Map(); // insertion order = recency (re-set on hit)
  let latest = 0;
  let controller = null;

  const remember = (key, data) => {
    cache.delete(key);
    cache.set(key, data);
    while (cache.size > max) cache.delete(cache.keys().next().value);
  };

  return {
    /** The cached rows for this exact query + centre, or undefined. Never starts a request. */
    peek(query, center) {
      const key = searchKey(query, center);
      if (!cache.has(key)) return undefined;
      const hit = cache.get(key);
      remember(key, hit);
      return hit;
    },
    /** Supersede whatever is in flight (a query that no longer needs the server, or an unmount). */
    cancel() {
      latest += 1;
      if (controller) controller.abort();
      controller = null;
    },
    /** → { data, error, stale, cached }. `stale` means a newer search superseded this one: drop it. */
    async search(query, center) {
      const key = searchKey(query, center);
      const mine = ++latest;
      if (controller) controller.abort();
      controller = null;
      if (cache.has(key)) return { data: this.peek(query, center), error: null, stale: false, cached: true };
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      controller = ctl;
      let res;
      try {
        res = await run(query, center, ctl?.signal);
      } catch (error) {
        res = { data: [], error };
      }
      const stale = mine !== latest;
      if (!stale && controller === ctl) controller = null;
      if (!res?.error && !ctl?.signal?.aborted && Array.isArray(res?.data)) remember(key, res.data);
      return { data: res?.data || [], error: res?.error || null, stale, cached: false };
    },
  };
}

/** The snapshot rows to SHOW while a newer query's answer is still on its way: the rows already
 *  loaded, narrowed to the ones whose name still contains what is now typed (typing "tac" → "taco"
 *  keeps the rows that still fit, instantly). Once the server answers for the current query its
 *  rows replace these. `nameMatches(name, q)` is the box's own punctuation/case-blind test. */
export function carryOverRows(rows, answeredFor, current, nameMatches) {
  if (!rows || rows.length === 0) return [];
  if (answeredFor === current) return rows;
  const q = (current || "").toLowerCase();
  return rows.filter((r) => nameMatches(r.name, q));
}
