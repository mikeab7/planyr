/* ⛔ NEW-1 / NEW-2 / NEW-3 — THE BARE-EARTH GROUND-ELEVATION LEG OF THE FLOOD/DRAINAGE CHECK.
 *
 * Measured live on the owner's own Bain plan, signed in, on the production build: the whole
 * re-check cost 3.6–8.5 s end to end and ONE call was 68–90% of it — a request to USGS 3DEP for
 * a physical constant it had already been told. Its geometry parameter is BYTE-IDENTICAL run to
 * run (a 126-character 9-sample polyline transect, sampleCount=9, RSP_BilinearInterpolation,
 * derived from the site's georeference — captured, re-run, compared: identical string), and three
 * samples of that identical query came back at 997 / 5,761 / 7,702 ms. An eight-fold swing on
 * BARE-EARTH GROUND ELEVATION, which changes when USGS re-flies a county — roughly once a decade.
 *
 * Three things live here, and they are three separate items on purpose:
 *
 *  NEW-1 — CACHE IT, KEYED ON THE EXACT REQUEST. `groundCacheKey` is built from
 *   `elevation.profileQuery`, the SAME derivation that builds the URL, so a change to the site's
 *   georeference, its parcels or the transect rule is automatically a cache MISS rather than a
 *   stale read. There is deliberately no looser key (no rounded lat/lng, no site id): the whole
 *   failure mode being guarded against is serving elevation for the wrong ground. The store is
 *   `gisCache`'s persistent tier — IndexedDB, so a reload does not pay again, and the LARGE tier
 *   because this is re-fetchable cache (/CLAUDE.md → TIER-BY-REBUILDABILITY; it must never
 *   compete with saved plans in the ~5 MB store). TTL is measured in months.
 *
 *  NEW-2 — IT MUST NOT GATE THE PANEL. The five county water-surface samplers answer in ~146 ms
 *   and used to wait behind this call because the Fort Bend routing needs the resolved county,
 *   which needs the drainage context, which awaited the transect. `beginGroundElevation` starts
 *   the request at t=0 and hands the caller a state it can PUBLISH IMMEDIATELY — the cached value
 *   when there is one, otherwise an honest `pending` once the publish budget is spent — plus a
 *   `fresh` promise that patches the number in when it lands. An unresolved elevation is
 *   `status: "pending"`, never 0 and never a dash: four states, never fewer (the B1442 discipline).
 *
 *  NEW-3 — BOUND IT, AND NAME THE SERVICE WHEN IT BLOWS. Two different numbers, deliberately:
 *   `GROUND_PUBLISH_BUDGET_MS` is how long the PANEL waits (past it, publish without the number);
 *   `GROUND_TIMEOUT_MS` is the REQUEST's hard ceiling (past it, a named failure —
 *   `status: "unavailable"` carrying `service`). ⛔ There is no default elevation and there must
 *   never be one: an assumed ground surface is how a detention volume comes out confidently wrong.
 *
 * ⛔ THE EXPLICIT ↻ BYPASSES THE CACHE — that is what the button is for, and it keeps a wrong
 * cached value one press from being corrected. It bypasses it as a STALE-WHILE-REVALIDATE force
 * refresh, not as a blocking re-read: the cached value still publishes instantly (so the press
 * costs ~2–3 s, not up to eight), the network call runs underneath it, and the fresh answer
 * patches the panel and the store when it arrives. That is the same shape /CLAUDE.md already
 * mandates for every other screening fetch, and it is the only way both of the owner's
 * requirements — "the button must bypass the cache" and "the common re-check gets fast" — are
 * true at once. A cache hit is LOUD: `groundElevNote` states it in the freshness hover, with its
 * age, so nobody debugs stale numbers blind.
 *
 * INSTRUMENT CAVEAT, recorded because it bounds what the numbers above prove: the owner's tab was
 * `document.visibilityState === "hidden"` while the timeline was captured. Resource Timing is
 * unaffected by that, so every NETWORK figure here is sound (FOREGROUND-OR-VOID clause 1 governs
 * wall-clock pacing, not PerformanceResourceTiming). No main-thread blocking figure is quoted.
 *
 * Pure except for the injected `sampler` and `cache` — Node-testable end to end.
 */
import { sampleProfile, profileQuery, DEP_SERVICE_LABEL, DEFAULT_INTERPOLATION } from "./elevation.js";

export const GROUND_SERVICE = DEP_SERVICE_LABEL;
/* The transect: a short east–west line through the point, sampled at 9 stations. These three
 * numbers ARE part of the cache key — changing any of them is a miss for every stored answer,
 * which is correct and is why they live beside the key builder. */
export const GROUND_HALF_SPAN_DEG = 0.0004;
export const GROUND_SAMPLE_COUNT = 9;
export const GROUND_INTERPOLATION = DEFAULT_INTERPOLATION;
/* Months, not hours. 3DEP is re-flown per county on a multi-year cycle; the TTL exists so a
 * county that IS re-flown eventually reaches a plan that was checked before, not to chase drift. */
export const GROUND_TTL_MS = 180 * 24 * 3600 * 1000;
/* The REQUEST's hard ceiling. 8 s matches the FBCDD/EBFE point samplers and sits comfortably
 * inside the check's own 30 s outer race (B874). The old 12 s default is what let one leg spend
 * most of an eight-second check. */
export const GROUND_TIMEOUT_MS = 8000;
/* How long the PANEL waits for it before publishing the flood answers without it (NEW-2b). The
 * county water-surface samplers land in ~146 ms; 1.5 s is generous against that and still an order
 * of magnitude under the worst measured elevation call. */
export const GROUND_PUBLISH_BUDGET_MS = 1500;
/* The cache-key namespace. Bump the version suffix if the STORED SHAPE changes (not the query —
 * the query is already in the key). */
export const GROUND_KEY_PREFIX = "3dep:ground:v1:";

/* The transect for a WGS84 point. Pure. */
export function groundTransectPath(lng, lat, halfSpanDeg = GROUND_HALF_SPAN_DEG) {
  return [[lng - halfSpanDeg, lat], [lng + halfSpanDeg, lat]];
}

/* ⛔ The cache key: the EXACT geometry string the request carries, plus sampleCount and
 * interpolation. Built through `profileQuery` so it cannot drift from the URL. Pure. */
export function groundCacheKey(lng, lat, opts = {}) {
  const sampleCount = opts.sampleCount ?? GROUND_SAMPLE_COUNT;
  const interpolation = opts.interpolation || GROUND_INTERPOLATION;
  const halfSpanDeg = opts.halfSpanDeg ?? GROUND_HALF_SPAN_DEG;
  const q = profileQuery(groundTransectPath(lng, lat, halfSpanDeg), sampleCount, interpolation);
  return `${GROUND_KEY_PREFIX}${q.geometry}|n=${sampleCount}|i=${interpolation}`;
}

/* Median of the finite samples — the same reduction the drainage check has always used (a median
 * shrugs off a stray no-data station). Null when nothing finite came back: 3DEP has no bare-earth
 * value here (open water, a void), which is an ANSWER, not a failure. Pure. */
export function medianElevation(elev) {
  const vals = (elev || []).filter((v) => v != null && isFinite(v)).sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length / 2)] : null;
}

/* Resolve the budget race without leaving a dangling timer. `p` never rejects (the fetch wrapper
 * below catches), but the reject arm is wired anyway so this helper is safe to reuse. */
function raceBudget(p, ms, fallback) {
  if (!(ms > 0)) return p;
  return new Promise((resolve) => {
    let done = false;
    const settle = (v) => { if (done) return; done = true; clearTimeout(t); resolve(v); };
    const t = setTimeout(() => settle(fallback), ms);
    p.then(settle, () => settle(fallback));
  });
}

const reasonOf = (e) => (e && e.message ? String(e.message) : String(e || "unknown"));

/* Start the ground-elevation leg. Returns SYNCHRONOUSLY (the network call is already in flight
 * for a forced run) with:
 *   key    — the cache key, for telemetry/diagnosis
 *   state  — Promise of the state to PUBLISH NOW (cached value, or `pending` past the budget)
 *   fresh  — Promise of the state a live fetch settled to, or null when none was needed. Awaiting
 *            it is how the caller patches the panel; a cache hit with no force resolves to null.
 *
 * A state is { status, ft, ts, ageMs, fromCache, refreshing, service, reason?, timedOut? } with
 * status one of "value" | "void" | "pending" | "unavailable". There is NO fifth state and no
 * fabricated ft — a caller that cannot render one of these four has a bug, not a formatting gap.
 */
export function beginGroundElevation({
  lng, lat, force = false, cache = null, sampler = sampleProfile,
  now = Date.now, ttlMs = GROUND_TTL_MS, timeoutMs = GROUND_TIMEOUT_MS,
  budgetMs = GROUND_PUBLISH_BUDGET_MS, halfSpanDeg, sampleCount, interpolation,
  onFetchSettled = null,
} = {}) {
  const n = sampleCount ?? GROUND_SAMPLE_COUNT;
  const interp = interpolation || GROUND_INTERPOLATION;
  const path = groundTransectPath(lng, lat, halfSpanDeg ?? GROUND_HALF_SPAN_DEG);
  const key = groundCacheKey(lng, lat, { sampleCount: n, interpolation: interp, halfSpanDeg });

  let fetchP = null;
  const runFetch = () => {
    const t0 = now();
    /* Called SYNCHRONOUSLY, not off a microtask: on a forced run the request must be on the wire
     * before the IndexedDB read is even issued, or the ↻ spends part of its budget on a cache it
     * has already decided to bypass. */
    let started;
    try { started = Promise.resolve(sampler(path, n, timeoutMs, { interpolation: interp })); }
    catch (e) { started = Promise.reject(e); }
    return started
      .then((elev) => {
        const ft = medianElevation(elev);
        // Store the VOID answer too: "3DEP has no bare-earth value at this point" is a stable
        // fact about the ground, and re-asking for it every check is the same waste.
        if (cache) { try { cache.write(key, { ft, v: 1 }); } catch (_) { /* a cache write is never loud */ } }
        const st = ft == null
          ? { status: "void", ft: null, ts: now(), ageMs: 0, fromCache: false, refreshing: false, service: GROUND_SERVICE }
          : { status: "value", ft, ts: now(), ageMs: 0, fromCache: false, refreshing: false, service: GROUND_SERVICE };
        if (onFetchSettled) { try { onFetchSettled({ ms: now() - t0, ok: true, status: st.status, key }); } catch (_) {} }
        return st;
      })
      .catch((e) => {
        // LOUD-FAILURE, and NEVER a default elevation: an assumed ground surface is how a
        // detention volume comes out confidently wrong. The service is named so the owner can
        // tell a slow federal host from a broken app.
        const st = {
          status: "unavailable", ft: null, ts: null, ageMs: null, fromCache: false, refreshing: false,
          service: (e && e.service) || GROUND_SERVICE, reason: reasonOf(e), timedOut: !!(e && e.timedOut),
        };
        if (onFetchSettled) { try { onFetchSettled({ ms: now() - t0, ok: false, status: "unavailable", reason: st.reason, key }); } catch (_) {} }
        return st;
      });
  };

  // A FORCED run starts the network before anything else — including before the cache read — so
  // the ↻ press spends none of its budget waiting on IndexedDB.
  if (force) fetchP = runFetch();

  const state = (async () => {
    let stored = null;
    if (cache && cache.readAsync) { try { stored = await cache.readAsync(key); } catch (_) { stored = null; } }
    const rec = stored && stored.data && typeof stored.data === "object" ? stored.data : null;
    const usable = rec && (rec.ft == null || Number.isFinite(rec.ft)) ? rec : null;
    const ageMs = usable ? Math.max(0, now() - stored.ts) : null;
    const expired = !usable || ageMs > ttlMs;
    if (!fetchP && expired) fetchP = runFetch();
    if (usable) {
      // Serve it INSTANTLY — with its age, and saying out loud whether a refresh is running
      // underneath it (stale-while-revalidate; the ↻ force lands here too).
      return usable.ft == null
        ? { status: "void", ft: null, ts: stored.ts, ageMs, fromCache: true, refreshing: !!fetchP, service: GROUND_SERVICE }
        : { status: "value", ft: usable.ft, ts: stored.ts, ageMs, fromCache: true, refreshing: !!fetchP, service: GROUND_SERVICE };
    }
    // Nothing stored: wait for the network, but only for the publish budget. Past it the check
    // publishes its flood answers and the late elevation patches in (NEW-2b).
    return raceBudget(fetchP, budgetMs, {
      status: "pending", ft: null, ts: null, ageMs: null, fromCache: false, refreshing: true,
      service: GROUND_SERVICE, budgetMs,
    });
  })();

  /* ⛔ THE NOTE TRAVELS WITH THE STATE. This module is reached ONLY by a dynamic import from the
   * check (it is not on the Site route's static graph — the bundle audit charges that route for
   * anything static, and this feature breached the largest-chunk ceiling when it was), so the
   * render must never need to call back into it. Composing the sentence HERE, once, is what keeps
   * that true — and it also honours PANEL-BREVITY rule 5: the sentence exists in one place. */
  const withNote = (p) => p.then((st) => (st ? { ...st, note: groundElevNote(st) } : st));
  const stateWithNote = withNote(state);
  return {
    key,
    state: stateWithNote,
    fresh: stateWithNote.then(() => (fetchP ? withNote(fetchP) : null), () => (fetchP ? withNote(fetchP) : null)),
  };
}

/* THE HOVER SENTENCE — the one place a ground-elevation state becomes words (NEW-1's "a cache hit
 * must be visible in the freshness hover, never silent"; NEW-3's "SAY SO … name the service").
 * Hover copy, so PANEL-BREVITY's budget does not apply to it and honesty stays reachable rather
 * than visible. Returns null when there is nothing worth saying. Pure. */
export function groundElevNote(state) {
  if (!state || !state.status) return null;
  const age = (ms) => {
    if (!Number.isFinite(ms)) return "";
    const d = ms / 86400000;
    if (d < 1) return "today";
    if (d < 45) return `${Math.round(d)}d old`;
    return `${Math.round(d / 30)}mo old`;
  };
  const ft = Number.isFinite(state.ft) ? `${state.ft.toFixed(1)} ft NAVD88` : null;
  switch (state.status) {
    case "value":
      if (state.fromCache) {
        return `Ground elevation ${ft} — held from an earlier ${GROUND_SERVICE} read (${age(state.ageMs)}); bare-earth ground does not move.`
          + (state.refreshing ? " Re-checking it now; the number updates if it changed." : " ↻ Re-check pulls it fresh.");
      }
      return `Ground elevation ${ft} — ${GROUND_SERVICE}, bare-earth, pulled just now.`;
    case "void":
      return `${GROUND_SERVICE} publishes no bare-earth value at this point (open water or a void). Nothing was assumed in its place.`;
    case "pending":
      return `Ground elevation is still loading from ${GROUND_SERVICE}${Number.isFinite(state.budgetMs) ? ` (past ${Math.round(state.budgetMs / 100) / 10}s)` : ""} — the flood answers below are complete; anything that needs site grade reads as unresolved until it lands.`;
    case "unavailable":
      return `Ground elevation unavailable — ${state.service || GROUND_SERVICE}${state.timedOut ? " did not answer in time" : " failed"}${state.reason ? `: ${state.reason}` : ""}. Nothing was assumed in its place, so anything that needs site grade stays unresolved.`;
    default:
      return null;
  }
}
