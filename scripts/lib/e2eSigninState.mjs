/* e2eSigninState — the REAL state of the signed-in half of the scheduled e2e run, as a sentence + a verdict (NEW-1,
 * 2026-11-02, after B2619760).
 *
 * WHY. e2e.yml's scheduled run is red every weekday (253 failing cases on 2026-10-30), and the one thing a reader could
 * not tell from that is whether the SIGN-IN step itself works: `e2e/auth.setup.js` ("authenticate once") signs in once
 * and every signed-in spec reuses it, and a skip there reads exactly like a pass (`spec.ok: true`, B1857904). Worse, since
 * captcha went on (2026-10-04) the password route goes through the real Turnstile form, which a datacenter browser may be
 * refused — and the workflow never passed the session-door key (E2E_LOGIN_KEY) that exists for exactly that reason.
 * This reduces the report to: which door was used, and did "authenticate once" PASS, FAIL or get SKIPPED.
 * A skipped setup is stated as a skip — never "green". A FAILED setup is its own named failure, not one of 253. */
import { collectCases } from "./e2eDrift.mjs";

/** door: { key: bool, password: bool } from which secrets reached the job. */
export function describeDoor({ key, password }) {
  if (key) return { door: "key", text: "the session door (/api/auth/e2e-session) — skips the real sign-in form, so it proves the suite, NOT sign-in" };
  if (password) return { door: "password", text: "the real sign-in form with the test account's password — Cloudflare's bot check may refuse a datacenter browser" };
  return { door: "none", text: "NO account is configured — every auth-gated spec skips" };
}

export function signinState(report, env = {}) {
  const door = describeDoor({ key: !!env.E2E_LOGIN_KEY, password: !!(env.E2E_EMAIL && env.E2E_PASSWORD) });
  const cases = collectCases(report);
  const setup = cases.filter((c) => /auth\.setup\.js/.test(c.file) || /authenticate once/.test(c.id));
  let setupStatus = "absent";
  if (setup.some((c) => c.status === "failed")) setupStatus = "failed";
  else if (setup.length && setup.every((c) => c.status === "skipped")) setupStatus = "skipped";
  else if (setup.length) setupStatus = "passed";
  const total = cases.length;
  const counts = { total, failed: cases.filter((c) => c.status === "failed").length, skipped: cases.filter((c) => c.status === "skipped").length, passed: cases.filter((c) => c.status === "passed" || c.status === "flaky").length };
  const verdict = setupStatus === "failed" ? "fail" : "ok";
  const line = {
    failed: `SIGN-IN SETUP FAILED via ${door.text}. Every signed-in spec reuses that session, so the failures below are not independent.`,
    skipped: `Sign-in setup was SKIPPED (${door.text}). Signed-in specs did not run signed in; this is not a pass.`,
    passed: `Sign-in setup passed via ${door.text}.`,
    absent: `The report has no sign-in setup case at all (a filtered or partial run?). Door: ${door.text}.`,
  }[setupStatus];
  return { door: door.door, setupStatus, counts, verdict, line };
}
