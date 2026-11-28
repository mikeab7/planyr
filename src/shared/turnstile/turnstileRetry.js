/* Silent retry rules for the Turnstile widget (NEW-1, 2026-11-28 — "the security check didn't finish" appeared
 * while Michael was still typing, before he had touched anything).
 *
 * Cause (measured: `auth-captcha-widget-error {"code":"300010"}` from his work laptop, seconds before he used the
 * emailed code): Cloudflare reports TRANSIENT client errors (3xxxxx / 6xxxxx "generic client execution error",
 * 1060xx initialisation hiccups) through the same `error-callback` as permanent ones, and the widget used to turn
 * every one of them straight into the red "didn't finish" banner. A corporate machine (TLS inspection, a slow proxy,
 * an extension) produces these routinely, and they usually clear on a second try.
 *
 * Rule: a transient error is retried SILENTLY (reset the widget after a short wait, up to MAX_SILENT_RETRIES times)
 * and the person sees nothing; only a PERMANENT error (wrong domain / key, unsupported browser, clock wrong,
 * bad parameters) or an exhausted budget is reported. The bot check itself is untouched: a token is still required
 * before any submit. Pure, so it is unit-tested in Node (test/turnstileRetry.test.js). */

export const MAX_SILENT_RETRIES = 3;
const BACKOFF_MS = [1500, 3000, 6000];

/** Cloudflare error codes that retrying cannot fix: config (110xxx), parameters (400xxx), cache/clock (200xxx). */
export function isPermanentWidgetError(code) {
  return /^(110|200|400)/.test(String(code == null ? "" : code));
}

/** Wait before silent retry number `attempt` (0-based); null once the budget is spent. */
export function silentRetryDelay(attempt) {
  return attempt >= 0 && attempt < MAX_SILENT_RETRIES ? BACKOFF_MS[attempt] : null;
}

/** What to do with an error code after `retriesUsed` silent retries: "retry" (wait `ms`) or "report". */
export function decideWidgetError(code, retriesUsed) {
  if (isPermanentWidgetError(code)) return { action: "report" };
  const ms = silentRetryDelay(retriesUsed);
  return ms == null ? { action: "report" } : { action: "retry", ms };
}
