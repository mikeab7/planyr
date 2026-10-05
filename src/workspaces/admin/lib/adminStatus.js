/* Admin status store (B711904 follow-up, NEW-2) — ONE is_admin() answer per signed-in user,
 * shared by every surface that asks (each kept-alive header's account menu + AdminGate), instead
 * of one RPC per mount.
 *
 *  · A definite answer ("admin" / "not-admin") is remembered for THAT user id only, so signing out
 *    and into a different account can never inherit the previous account's answer (either way).
 *  · An ERROR is never remembered: the next ask (the account menu opening, a Retry) calls again,
 *    so one failed network call cannot lock an admin out for the whole visit. While errored the
 *    answer is "not admin" — the Admin row stays hidden (fail closed).
 *  · Concurrent asks for the same user share one in-flight call.
 * Pure + injectable (`createAdminStatusStore(check)`) so the sign-in/sign-out matrix is unit-tested. */
import { checkAdminStatus } from "./adminAccess.js";

export function createAdminStatusStore(check = checkAdminStatus) {
  let userId = null;
  let status = "unknown"; // unknown | admin | not-admin | error
  let inflight = null;    // { userId, promise }

  function peek(forUserId) {
    if (!forUserId || forUserId !== userId) return "unknown";
    return status;
  }

  /** Resolve the admin status for `forUserId` using `client`. `force` re-asks even after a definite answer. */
  async function get(client, forUserId, { force = false } = {}) {
    if (!forUserId) { reset(); return "not-admin"; }
    if (forUserId !== userId) { userId = forUserId; status = "unknown"; inflight = null; }
    if (!force && (status === "admin" || status === "not-admin")) return status;
    if (inflight && inflight.userId === forUserId) return inflight.promise;
    const mine = { userId: forUserId };
    mine.promise = Promise.resolve(check(client)).then((answer) => {
      if (userId !== forUserId) return answer === "admin" ? "not-admin" : answer; // account changed mid-flight: drop
      status = answer;
      if (inflight === mine) inflight = null;
      return answer;
    });
    inflight = mine;
    return mine.promise;
  }

  function reset() { userId = null; status = "unknown"; inflight = null; }

  return { get, peek, reset };
}

export const adminStatusStore = createAdminStatusStore();
