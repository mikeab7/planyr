/* The words for a dead sign-in (NEW-1, 2026-11-10) — a dependency-free leaf, so a pure module (driveSyncRun, a parser) can
 * use it without pulling in supabase. src/shared/auth/apiAuth.js re-exports all of it; callers import from there.
 *
 * WHY: the server answers a refused token with 401 and the text "Invalid or expired session (403)." — the 403 is
 * SUPABASE's status echoed inside our own string. Surfaces that printed `jr.error` verbatim showed that to a person
 * (the Library's Drive footer, the share link, auto-filing, the uploader). A dead sign-in is one sentence, everywhere. */

export function signInMessage(action) {
  return action ? `Your sign-in expired \u2014 sign in again to ${action}.` : "Your sign-in expired \u2014 sign in again.";
}

// The server's own words for a refused token (server/auth/supabaseAuth.js) — never shown to a person.
const SERVER_SIGNIN_RE = /invalid or expired session|missing bearer token|session did not resolve|\bjwt\b/i;

/* Is this non-ok API answer "your sign-in is the problem"? A 401 is; so is the server's refused-token text on any status. */
export function isSignInAnswer(status, serverError) {
  return status === 401 || SERVER_SIGNIN_RE.test(String(serverError || ""));
}

/* The one place a non-ok /api answer becomes words for a person: the sign-in sentence when the sign-in is the cause,
 * else the server's own message, else `fallback`. Never "HTTP 401", never "(403)". */
export function apiErrorText(status, serverError, { action, fallback } = {}) {
  if (isSignInAnswer(status, serverError)) return signInMessage(action);
  return serverError || fallback || `HTTP ${status}`;
}
