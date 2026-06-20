/* Per-source circuit breaker for county parcel servers (B244).
 *
 * County appraisal-district endpoints go down (FBCAD's whole ArcGIS server was
 * unreachable on 2026-06-19 — 503s then total timeouts). Once we know a source is
 * dead, re-querying it on every map click just re-incurs the (now time-boxed, but
 * still wasteful) failure and slows the fallback. This tracks consecutive failures
 * per source key and, after a threshold, "opens the breaker" — callers skip that
 * source for a cooldown and go straight to the statewide fallback — then auto-resume
 * (half-open) once the cooldown elapses so a recovered server is picked back up
 * without a reload.
 *
 * Pure + in-memory (a session-lifetime Map); `now` is injectable so it's testable
 * without real timers. A success always resets the source to healthy.
 */

export const SOURCE_FAIL_THRESHOLD = 3; // consecutive failures before the breaker opens
export const SOURCE_COOLDOWN_MS = 5 * 60_000; // skip-the-primary window (5 min), then retry

const _state = new Map(); // key -> { fails, openUntil }

/* Record the outcome of a query against a source. A success clears the source back
 * to healthy; a failure increments the streak and opens the breaker once it reaches
 * the threshold. Only pass `ok=false` for a genuine source FAILURE (server down /
 * timeout / HTTP or ArcGIS error) — never for a healthy "no parcel at this point",
 * which is a valid answer, not a failure (B245). */
export function recordSourceResult(key, ok, now = Date.now()) {
  if (!key) return;
  if (ok) { _state.delete(key); return; }
  const s = _state.get(key) || { fails: 0, openUntil: 0 };
  s.fails += 1;
  if (s.fails >= SOURCE_FAIL_THRESHOLD) s.openUntil = now + SOURCE_COOLDOWN_MS;
  _state.set(key, s);
}

// Is this source's breaker currently open (failing, still inside its cooldown)?
export function isSourceOpen(key, now = Date.now()) {
  const s = _state.get(key);
  return !!(s && s.openUntil > now);
}

// Milliseconds left in the cooldown (0 if closed/healthy) — for an honest "retrying
// the county server in N min" hint.
export function sourceCooldownMs(key, now = Date.now()) {
  const s = _state.get(key);
  return s && s.openUntil > now ? s.openUntil - now : 0;
}

/* Drop candidates whose breaker is open — EXCEPT any key in `alwaysKeep` (the
 * statewide fallback), which must never be filtered out or a click could lose all
 * coverage. Returns a new array, order preserved. Each candidate is { county, ... }. */
export function filterHealthyCandidates(candidates, alwaysKeep = [], now = Date.now()) {
  const keep = new Set(alwaysKeep);
  const out = (candidates || []).filter((c) => keep.has(c.county) || !isSourceOpen(c.county, now));
  // Safety net: never return empty if we were given candidates (keep the statewide
  // ones, or fall back to the original list) so a click always has something to try.
  return out.length ? out : (candidates || []);
}

// Test/teardown helper — wipe all tracked health.
export function resetSourceHealth() { _state.clear(); }
