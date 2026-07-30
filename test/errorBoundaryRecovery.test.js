/* B1189 layer 2 — a transient render-loop crash must NOT be a dead end.
 *
 * The loop itself is fixed in SitePlanner.jsx and guarded live by e2e/panel-escape-race.spec.js.
 * This suite guards the second, independent requirement: even if some future measurement cycle
 * trips React's nested-update circuit breaker again, the boundary must degrade rather than
 * replace a working planner with a terminal error card. That policy is pure, so it is asserted
 * here without a browser — and it keeps holding after the specific loop that motivated it is
 * long gone.
 *
 * The two properties that matter, and the trade-off between them:
 *   • a recoverable crash is retried automatically (the user keeps working), and
 *   • the retries are BOUNDED, so a genuinely repeating crash still surfaces instead of
 *     spinning forever.
 */
import { describe, it, expect } from "vitest";
import {
  isUpdateDepthError,
  isRecoverableRenderError,
  planRecovery,
  MAX_AUTO_RECOVERIES,
  RECOVERY_WINDOW_MS,
} from "../src/app/recoverableError.js";

const devError = new Error("Maximum update depth exceeded. This can happen when a component repeatedly calls setState…");
// The exact string B1189 produced in a production build — the spelling users actually hit.
const prodError = new Error("Minified React error #185; visit https://reactjs.org/docs/error-decoder.html?invariant=185 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.");

describe("classifying the nested-update circuit breaker", () => {
  it("recognises the development spelling", () => {
    expect(isUpdateDepthError(devError)).toBe(true);
  });

  it("recognises the MINIFIED code — the one that actually shipped", () => {
    // This is the whole reason the classifier exists: React strips invariant text in production,
    // so matching only the readable message would make the recovery dead code exactly where the
    // crash happens.
    expect(isUpdateDepthError(prodError)).toBe(true);
    expect(isRecoverableRenderError(prodError)).toBe(true);
  });

  it("does not mistake a NEIGHBOURING React error code for #185", () => {
    expect(isUpdateDepthError(new Error("Minified React error #18; visit …"))).toBe(false);
    expect(isUpdateDepthError(new Error("Minified React error #1850; visit …"))).toBe(false);
  });

  it("treats ordinary crashes as NOT recoverable", () => {
    // A dangling reference throws identically on remount, so auto-retrying it would spin. The
    // card is the correct answer for these.
    expect(isRecoverableRenderError(new TypeError("cfgOf is not defined"))).toBe(false);
    expect(isRecoverableRenderError(new Error("Failed to fetch dynamically imported module"))).toBe(false);
    expect(isRecoverableRenderError(null)).toBe(false);
    expect(isRecoverableRenderError(undefined)).toBe(false);
    expect(isRecoverableRenderError({})).toBe(false);
  });
});

describe("what the boundary does with a caught error", () => {
  it("recovers a first transient crash instead of showing a dead end", () => {
    expect(planRecovery({ error: prodError, attempts: 0, lastRecoveryAt: 0, now: 1_000 }))
      .toEqual({ action: "recover", attempts: 1 });
  });

  it("shows the card immediately for an unrecoverable crash", () => {
    expect(planRecovery({ error: new TypeError("boom"), attempts: 0, now: 1_000 }).action).toBe("show");
  });

  it("bounds the automatic retries, so a REPEATING crash still surfaces", () => {
    let attempts = 0;
    let last = 0;
    let now = 1_000;
    const seen = [];
    for (let i = 0; i < MAX_AUTO_RECOVERIES + 2; i++) {
      const plan = planRecovery({ error: prodError, attempts, lastRecoveryAt: last, now });
      seen.push(plan.action);
      attempts = plan.attempts;
      if (plan.action === "recover") last = now;
      now += 50; // a tight loop: every retry lands well inside the window
    }
    expect(seen.slice(0, MAX_AUTO_RECOVERIES)).toEqual(Array(MAX_AUTO_RECOVERIES).fill("recover"));
    expect(seen.slice(MAX_AUTO_RECOVERIES)).toEqual(["show", "show"]);
  });

  it("gives a LATER, unrelated crash its full budget back", () => {
    // Otherwise a boundary that recovered twice at 9am would show a dead end for an unrelated
    // blip at 5pm — the count is meant to identify one incident, not to ration the session.
    const spent = { error: prodError, attempts: MAX_AUTO_RECOVERIES, lastRecoveryAt: 1_000 };
    expect(planRecovery({ ...spent, now: 1_000 + RECOVERY_WINDOW_MS }).action).toBe("show");
    expect(planRecovery({ ...spent, now: 1_000 + RECOVERY_WINDOW_MS + 1 }))
      .toEqual({ action: "recover", attempts: 1 });
  });
});
