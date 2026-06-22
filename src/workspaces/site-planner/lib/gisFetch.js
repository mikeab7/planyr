/* Shared GIS fetch resilience + honest error taxonomy (B366).
 *
 * THE BUG THIS FIXES: the Site Analysis screen fired ~8–10 ArcGIS /query calls all at
 * once. Under that burst, hosts — even Esri-hosted ones that essentially never go down —
 * intermittently return HTTP 503 ("I'm overloaded"). With no retry, one transient blip
 * froze a layer at UNKNOWN; and EVERY failure was mislabeled "network or CORS" even
 * though CORS is fine on every endpoint. (A 503 whose error response lacks the CORS
 * header surfaces to `fetch` as an opaque "Failed to fetch" — which is exactly why the
 * old catch-all blamed CORS. The honest answer is "the source was temporarily
 * unavailable," and a retry usually clears it.)
 *
 * This module is the shared substrate for the screen + the jurisdiction identify:
 *   • classifyGisError  — turn an error into an honest { kind, message, retryable }.
 *   • fetchArcgisJson   — one resilient fetch: AbortController timeout + jittered
 *                         exponential backoff retry on transient failures + automatic
 *                         GET→POST for an over-long geometry URL.
 *   • pLimit            — a tiny concurrency limiter so the WHOLE fan-out runs through a
 *                         small pool (2–3) instead of bursting every request at once.
 *
 * Pure-ish + injectable (fetch impl, sleep, clock) so it unit-tests in Node with no
 * network and no real timers.
 */

// Default screening-fetch knobs. A burst-503 clears on a retry within a couple seconds;
// 3 attempts total with jittered backoff covers it without making a real outage drag.
export const GIS_FETCH_TIMEOUT_MS = 9000;
export const GIS_FETCH_RETRIES = 2; // retries AFTER the first try (so 3 attempts total)
// Above this GET-URL length we POST the query instead (some ArcGIS servers cap the URL
// well below the browser's ~64k, and a 48-vertex parcel polygon can get long).
export const GIS_MAX_GET_URL = 3500;

/* A typed GIS fetch failure. `kind`:
 *   'timeout'  — the request was aborted at the timeout cap (retryable)
 *   'http-5xx' — server returned 5xx / 429 (retryable; overloaded / rate-limited)
 *   'http-4xx' — server returned a 4xx other than 429 (NOT retryable; a real reject)
 *   'arcgis'   — HTTP 200 but a JSON {error} body (e.g. bad field name; NOT retryable)
 *   'network'  — fetch threw (offline / DNS / connection / possibly CORS) (retryable once)
 */
export class GisFetchError extends Error {
  constructor(kind, message, { status = null, arcgisCode = null, url = null, retryable = false } = {}) {
    super(message);
    this.name = "GisFetchError";
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
    // `diag` is what logQueryFailure surfaces to the console — the REAL reason, so an
    // opaque failure is debuggable even though the UI shows a clean message.
    this.diag = { httpStatus: status, arcgisCode, url };
  }
}

/* Classify ANY thrown error (a GisFetchError, a raw fetch TypeError, an AbortError, or a
 * plain Error from a test fake) into an honest, user-facing taxonomy. Never blames CORS
 * blindly: a bare "Failed to fetch" is reported as "couldn't reach / temporarily
 * unavailable," because in the browser a transient 503 (no CORS header on the error
 * page) is indistinguishable from a real CORS block — and 99% of the time it's the
 * former and a retry fixes it. Pure. */
export function classifyGisError(e) {
  if (e instanceof GisFetchError) {
    return { kind: e.kind, message: e.message, retryable: e.retryable, status: e.status };
  }
  const name = String(e?.name || "");
  const msg = String(e?.message || e || "");
  if (name === "AbortError" || /aborted|time(d? ?out)/i.test(msg)) {
    return { kind: "timeout", message: "The GIS source didn't respond in time — it may be busy.", retryable: true, status: null };
  }
  // A raw browser fetch rejection. `navigator.onLine === false` is the one reliable
  // signal we have; otherwise stay honest about the ambiguity (down OR blocking), never
  // a confident "CORS."
  if (/failed to fetch|networkerror|load failed|cors/i.test(msg)) {
    const offline = typeof navigator !== "undefined" && navigator && navigator.onLine === false;
    return offline
      ? { kind: "offline", message: "You appear to be offline — reconnect and retry.", retryable: true, status: null }
      : { kind: "network", message: "Couldn't reach the GIS source (it may be temporarily down or blocking the request).", retryable: true, status: null };
  }
  return { kind: "error", message: msg || "Request failed.", retryable: false, status: null };
}

/* Convenience: the honest one-line message for an error (replaces the old "network or
 * CORS" catch-all). */
export function gisErrorMessage(e) {
  return classifyGisError(e).message;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Jittered exponential backoff for attempt N (0-based): ~300ms, ~700ms, … with jitter.
export function backoffMs(attempt, base = 300, rng = Math.random) {
  const exp = base * Math.pow(2, attempt);
  return Math.round(exp + rng() * base); // full-ish jitter so a burst doesn't resync
}

/* One ArcGIS JSON request with timeout + transient-retry + automatic GET→POST.
 *
 *   url      — the full GET /query URL (params already in the querystring), OR the
 *              bare /query URL when `opts.body` (a params object) is given to POST.
 *   opts:
 *     fetchImpl   — injectable fetch (default global fetch)
 *     body        — params object → force a POST (form-encoded) instead of GET
 *     timeoutMs   — abort cap (default GIS_FETCH_TIMEOUT_MS)
 *     retries     — transient retries (default GIS_FETCH_RETRIES)
 *     sleepImpl/rng — injectable for tests (no real timers / deterministic jitter)
 *     signal      — optional external AbortSignal (chained with the timeout)
 *
 * Throws a typed GisFetchError on failure (carrying `.diag` for the console). Validates
 * the RESPONSE BODY too: ArcGIS returns HTTP 200 with a JSON {error} body for a bad
 * query — that's a failure, not a silent success. */
export async function fetchArcgisJson(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!fetchImpl) throw new GisFetchError("error", "No fetch implementation available.");
  const timeoutMs = opts.timeoutMs ?? GIS_FETCH_TIMEOUT_MS;
  const retries = opts.retries ?? GIS_FETCH_RETRIES;
  const napFor = opts.sleepImpl || sleep;
  const rng = opts.rng || Math.random;

  // Decide GET vs POST. An over-long GET (a dense parcel polygon) is POSTed to dodge
  // server URL-length caps — the brief's "switch large geometries to POST."
  let target = url;
  let init = { method: "GET" };
  if (opts.body || url.length > GIS_MAX_GET_URL) {
    const qIdx = url.indexOf("?");
    const base = opts.body ? url : url.slice(0, qIdx < 0 ? url.length : qIdx);
    const form = new URLSearchParams();
    if (opts.body) {
      for (const [k, v] of Object.entries(opts.body)) if (v != null) form.set(k, String(v));
    } else if (qIdx >= 0) {
      for (const [k, v] of new URLSearchParams(url.slice(qIdx + 1))) form.set(k, v);
    }
    target = base;
    init = { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() };
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await napFor(backoffMs(attempt - 1, 300, rng));
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    if (ctrl && opts.signal) {
      if (opts.signal.aborted) ctrl.abort();
      else opts.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
    try {
      const res = await fetchImpl(target, ctrl ? { ...init, signal: ctrl.signal } : init);
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429;
        const kind = retryable ? "http-5xx" : "http-4xx";
        const msg = retryable
          ? `The GIS source returned HTTP ${res.status} — temporarily unavailable.`
          : `The GIS source rejected the request (HTTP ${res.status}).`;
        const err = new GisFetchError(kind, msg, { status: res.status, url: target, retryable });
        if (retryable && attempt < retries) { lastErr = err; continue; }
        throw err;
      }
      const j = await res.json();
      if (j && j.error) {
        // HTTP 200 + a JSON error body (e.g. code 400 "Failed to execute query." for a
        // bad field). A real reject — not retryable, surfaced with the code.
        const code = j.error.code != null ? ` (code ${j.error.code})` : "";
        throw new GisFetchError("arcgis", (j.error.message || "ArcGIS query error.") + code, {
          status: j.error.code ?? null, arcgisCode: j.error.code ?? null, url: target,
        });
      }
      return j;
    } catch (e) {
      const info = classifyGisError(e);
      const err = e instanceof GisFetchError ? e : new GisFetchError(info.kind, info.message, { url: target, retryable: info.retryable });
      if (info.retryable && attempt < retries) { lastErr = err; continue; }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr || new GisFetchError("error", "Request failed.");
}

/* A tiny promise concurrency limiter. `const lim = pLimit(3); await lim(() => task())`
 * runs at most `concurrency` tasks at once, queueing the rest in FIFO order — so the
 * whole screening fan-out goes through a small pool instead of bursting every request.
 * Pure (no timers); unit-tested for the max-in-flight invariant. */
export function pLimit(concurrency) {
  const n = Math.max(1, concurrency | 0);
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => { active--; next(); });
  };
  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}
