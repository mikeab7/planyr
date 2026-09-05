/* One string shared between the Postgres trigger that enforces the signup rate limit
 * (src/shared/auth/db/signup_rate_limit.sql) and the client code that DETECTS it
 * (auth.js) — the same "one constant, kept honest across a boundary a test can pin"
 * shape authMail.js uses for the confirmation-email sender. A wording change to the
 * trigger's RAISE EXCEPTION message must update this constant (and the .sql file) in the
 * SAME commit, or the client-side telemetry below silently stops firing — it's
 * best-effort visibility only, never the enforcement itself (the DB trigger is that, and
 * cannot be bypassed by a client that never imports this file at all). */
export const SIGNUP_RATE_LIMIT_MESSAGE_FRAGMENT = "Too many accounts have been created recently";
