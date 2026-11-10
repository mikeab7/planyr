/* The ONE way the browser calls our own /api/* with the signed-in person's token (NEW-1, 2026-11-09).
 *
 * WHY THIS EXISTS. Eight files each did `supabase.auth.getSession()` → `Authorization: Bearer <token>` and
 * sent it as-is. `getSession()` hands back whatever access token it holds — it does NOT promise one that is
 * still good a minute from now, and it cannot know the server has since refused it. A tab left open over a
 * weekend then sent a stale token, the server answered 401 ("Invalid or expired session"), and the Library's
 * one-time folder organizer printed that, naming a project the person was not even looking at. Nothing in the
 * app ever refreshed the session or retried.
 *
 * THE RULE (this file is the only place that implements it — never write a second bare getSession → Bearer):
 *   1. get a token that is NOT expired: if the held one is at or near its expiry, refresh the session first;
 *   2. send the request; if the API answers 401, refresh the session ONCE and send the request ONCE more;
 *   3. a second 401 is returned to the caller as the answer (it is a real "sign in again"); a refresh that is
 *      itself refused means the person is signed out — reported as a failure, never retried in a loop.
 *   4. (NEW-1, 2026-11-10) EITHER of those ends is a SIGN-IN FAILURE, and the helper says so: `authedFetch`
 *      returns `signIn: true`, and `signInMessage(action)` is the one sentence every surface shows for it
 *      ("Your sign-in expired — sign in again to <action>."). A surface never prints the server's raw string or a
 *      status code for it ("Invalid or expired session (403)." was reaching the Library's Drive footer);
 *      `apiErrorText(status, serverError, fallback)` is the one place a non-ok answer becomes words.
 *
 * Not for: PostgREST / Storage calls made through supabase-js (it manages its own token), nor the
 * unload-time keepalive pushes (`optimisticUpsert`, `elementApi` — they must read a token synchronously and
 * cannot await a refresh while the page is leaving), nor the one-shot mailbox-proof call (it is handed the
 * token of the session an emailed link has JUST minted).
 */
import { supabase as defaultClient } from "../../workspaces/site-planner/lib/supabase.js";

// A token with less than this left is refreshed BEFORE it is used, so it cannot expire in flight.
export const NEAR_EXPIRY_MS = 60 * 1000;

// Why no token could be had. "signed-out": there is no session, or the server refused to renew it.
// "unreachable": the renewal could not be asked (offline) — says nothing about the sign-in itself.
export const FAIL_SIGNED_OUT = "signed-out";
export const FAIL_UNREACHABLE = "unreachable";

import { signInMessage, isSignInAnswer, apiErrorText } from "./signInText.js";
export { signInMessage, isSignInAnswer, apiErrorText };

const inflight = new WeakMap(); // client -> the one refreshSession() in flight (single-flight)

function classifyRefreshError(error) {
  const name = error && error.name;
  const status = error && error.status;
  // supabase-js: a request that never got an answer is AuthRetryableFetchError (status 0 / 5xx-ish).
  if (name === "AuthRetryableFetchError" || status === 0 || status >= 500) return FAIL_UNREACHABLE;
  return FAIL_SIGNED_OUT;
}

async function refreshOnce(client) {
  if (inflight.has(client)) return inflight.get(client);
  const run = (async () => {
    try {
      const { data, error } = await client.auth.refreshSession();
      const token = data && data.session && data.session.access_token;
      if (error || !token) return { token: null, failure: error ? classifyRefreshError(error) : FAIL_SIGNED_OUT };
      return { token, failure: null };
    } catch (_) {
      return { token: null, failure: FAIL_UNREACHABLE };
    }
  })();
  inflight.set(client, run);
  try { return await run; } finally { inflight.delete(client); }
}

/* A usable access token. `refresh: true` forces a renewal (the 401 path). Never throws.
 * → { token, refreshed, failure } — `token` is null exactly when `failure` is set. */
export async function getApiToken({ client = defaultClient, now = Date.now, refresh = false } = {}) {
  if (!client || !client.auth) return { token: null, refreshed: false, failure: FAIL_SIGNED_OUT };
  if (refresh) {
    const r = await refreshOnce(client);
    return { token: r.token, refreshed: !!r.token, failure: r.failure };
  }
  let session = null;
  try { const { data } = await client.auth.getSession(); session = data && data.session; } catch (_) { session = null; }
  const held = session && session.access_token;
  if (!held) return { token: null, refreshed: false, failure: FAIL_SIGNED_OUT };
  const expiresAtMs = Number(session.expires_at) * 1000;
  const knownExpiry = Number.isFinite(expiresAtMs) && expiresAtMs > 0;
  if (!knownExpiry || expiresAtMs - now() > NEAR_EXPIRY_MS) return { token: held, refreshed: false, failure: null };
  // At or near expiry: renew first. If the renewal cannot be asked but the held token still has life, use it.
  const r = await refreshOnce(client);
  if (r.token) return { token: r.token, refreshed: true, failure: null };
  if (r.failure === FAIL_UNREACHABLE && expiresAtMs > now()) return { token: held, refreshed: false, failure: null };
  return { token: null, refreshed: false, failure: r.failure };
}

/* fetch() an /api/* route as the signed-in person.
 * → { resp, refreshed, failure }
 *     resp    the final Response (the retry's, when one was sent); null only when no token could be had
 *     failure null | "signed-out" | "unreachable" — set when there is no usable sign-in. When the 401 retry's
 *             renewal fails, `resp` is still the original 401 so the caller can read its body.
 *     refreshed true when the request that produced `resp` carried a renewed token
 *     signIn    true exactly when the SIGN-IN is the cause: no session, a refused renewal, or a 401 that survived the
 *               renewal. Show `signInMessage(...)` (and offer sign-in); never `resp`'s own error text.
 * Never throws for auth reasons; a network error from fetch itself propagates (callers already catch it). */
export async function authedFetch(url, init = {}, { client = defaultClient, fetchImpl, now } = {}) {
  const doFetch = fetchImpl || ((u, i) => fetch(u, i));
  const send = (token) => doFetch(url, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token}` } });

  const first = await getApiToken({ client, now });
  if (!first.token) return { resp: null, refreshed: false, failure: first.failure, signIn: first.failure === FAIL_SIGNED_OUT };
  const resp = await send(first.token);
  if (resp.status !== 401) return { resp, refreshed: first.refreshed, failure: null, signIn: false };

  // The server refused this token. Renew the session ONCE and ask ONCE more — no loop.
  const second = await getApiToken({ client, now, refresh: true });
  if (!second.token) return { resp, refreshed: false, failure: second.failure, signIn: second.failure === FAIL_SIGNED_OUT };
  const retry = await send(second.token);
  // A second 401 is the server still refusing a freshly renewed token: a real "sign in again".
  return { resp: retry, refreshed: true, failure: null, signIn: retry.status === 401 };
}

/* For code that already speaks in thrown errors and a bare Response (the chunked uploader's `fetchImpl`):
 * resolves a Response, or throws a SignInError when there is no usable sign-in. A signed-out failure carries
 * `sessionLost = true`, which the uploader treats as "retrying cannot help" (no 5× backoff on a dead sign-in). */
export class SignInError extends Error {
  constructor(failure) {
    super(failure === FAIL_UNREACHABLE
      ? "Couldn't reach Planyr — check your connection and try again."
      : "Your sign-in expired — sign in again, then try again.");
    this.name = "SignInError";
    this.failure = failure;
    this.sessionLost = failure !== FAIL_UNREACHABLE;
  }
}

export async function authedFetchResponse(url, init = {}, opts = {}) {
  const r = await authedFetch(url, init, opts);
  // A 401 that survived the renewal is also a dead sign-in: throw it (sessionLost → the uploader stops, no 5× backoff,
  // and the person reads the sign-in sentence instead of the server's "Invalid or expired session (403)").
  if (!r.resp || r.signIn) throw new SignInError(r.failure || FAIL_SIGNED_OUT);
  return r.resp;
}
