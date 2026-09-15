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

/* B1461731 — a source that keeps answering just short of a timeout is exactly as unusable as one
 * that is erroring, and waiting for it to fully time out (PARCEL_FETCH_TIMEOUT_MS, 8000ms in
 * arcgis.js) before backing off wastes that same wait on every subsequent click. Measured during
 * the Nevada outage this was built for: one query took 18 SECONDS to return an error before the
 * host stopped responding entirely — a response this slow is a symptom of the same struggling host,
 * whether or not it happens to carry an error body. Set comfortably under the hard timeout so a
 * source trending slow trips the breaker before it starts timing out outright. */
export const SOURCE_SLOW_MS = 6000;

const _state = new Map(); // key -> { fails, openUntil }

/* Record the outcome of a query against a source. A success clears the source back
 * to healthy; a failure increments the streak and opens the breaker once it reaches
 * the threshold. Only pass `ok=false` for a genuine source FAILURE (server down /
 * timeout / HTTP or ArcGIS error) — never for a healthy "no parcel at this point",
 * which is a valid answer, not a failure (B245).
 *
 * `ms` (optional, B1461731) — how long the request took. A response that took ≥ SOURCE_SLOW_MS
 * counts toward the failure streak exactly like `ok=false` would, EVEN WHEN `ok` is true — three
 * consecutive slow-but-technically-successful responses open the breaker just as three outright
 * failures would, so a struggling host is backed off before it starts hard-timing-out. Omit `ms`
 * (or pass a value under the threshold) for the old ok/fail-only behavior. */
export function recordSourceResult(key, ok, now = Date.now(), { ms } = {}) {
  if (!key) return;
  const slow = ms != null && ms >= SOURCE_SLOW_MS;
  if (ok && !slow) { _state.delete(key); return; }
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

/* Decide whether a statewide (TxGIO) answer genuinely stood in for an UNAVAILABLE
 * county CAD — the only case the honest "statewide backup" badge should fire (B244/B630).
 *
 * The click path races the county CAD and the statewide layer IN PARALLEL and takes the
 * FIRST to answer (identifyParcelEager). So a statewide hit can mean either (a) the
 * county's own server was skipped/failed and TxGIO truly stood in [a real backup], or
 * (b) the county server is perfectly healthy and WAS queried, but statewide merely WON
 * THE RACE [NOT a backup]. Keying the badge off "the winner was statewide" alone cried
 * "Fort Bend county's server is unavailable" on every healthy Fort Bend click, because
 * FBCAD's Esri layer is a touch slower than TxGIO's identify (B630). The honest signal is
 * the county CAD's own availability: a backup only when NO real CAD for this point was
 * healthy enough to be queried (all had their breaker open and were dropped), so TxGIO was
 * the only source left to answer.
 *
 * `hitCounty` — the answering source's key. `realPrimaries` — the real-CAD candidates that
 * COULD cover this point (pre-breaker-filter). `queried` — the candidates actually queried
 * this click (post-filter). Both are arrays of `{ county }`. `statewideKeys` — the statewide
 * source keys. Pure. */
export function isStatewideBackup(hitCounty, { realPrimaries = [], queried = [], statewideKeys = [] } = {}) {
  const isStatewide = (k) => statewideKeys.includes(k);
  if (!isStatewide(hitCounty)) return false;             // a real CAD answered directly — not a backup
  if (!realPrimaries.length) return false;               // area is statewide-only — a plain answer, not a "backup"
  return !queried.some((c) => !isStatewide(c.county));   // backup ⇔ no real CAD was queryable this click
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

/* NEW-2 (2026-09-15, B1639697) — a single, HEALTHY real CAD is authoritative on its own; racing
 * the statewide fallback alongside it wins nothing but a second, redundant request against the
 * shared statewide host on every click in every one of the 8 dialed-in Houston-metro counties.
 * Measured live: searching "1200 McKinney St, Houston, TX" fired both HCAD's own query AND the
 * statewide layer's, even though HCAD alone always answers correctly — `isStatewideBackup` above
 * already proves the statewide hit is discarded whenever a real CAD also answers, so the second
 * request bought nothing but load on a shared government/ArcGIS-Online host.
 *
 * Drop the statewide candidate(s) ONLY when there is EXACTLY ONE real (non-statewide) primary for
 * this point AND it is currently healthy (i.e. it survived `filterHealthyCandidates` above) —
 * every other shape keeps the existing multi-candidate query, so the B130/B634 outage-resilience
 * behavior this repo has depended on is unchanged for exactly the cases it exists for:
 *   - a straddle (2+ real primaries near a shared county line) — still raced together;
 *   - an UNHEALTHY primary (its breaker is already open — `filterHealthyCandidates` already
 *     dropped it from `candidates`, so the statewide candidate is the ONLY one left and must
 *     stay, exactly as before);
 *   - any point with no real CAD at all (every derived/parked-on-composite Texas county) — those
 *     already resolve to a single statewide candidate by construction (`counties.js`'s
 *     `parkedOnComposite` dedup), untouched here.
 * Pure; takes the same candidate/key shapes `filterHealthyCandidates`/`isStatewideBackup` do. */
export function suppressRedundantStatewide(candidates, realPrimaries, statewideKeys = []) {
  const isStatewide = (k) => statewideKeys.includes(k);
  const primaries = realPrimaries || [];
  if (primaries.length !== 1) return candidates; // 0 (statewide-only) or 2+ (straddle): unchanged
  const primaryCounty = primaries[0].county;
  const primaryIsHealthy = (candidates || []).some((c) => c.county === primaryCounty);
  if (!primaryIsHealthy) return candidates; // breaker open — statewide is the only source left
  const out = (candidates || []).filter((c) => !isStatewide(c.county));
  return out.length ? out : candidates; // never drop to empty
}

// Test/teardown helper — wipe all tracked health.
export function resetSourceHealth() { _state.clear(); }
