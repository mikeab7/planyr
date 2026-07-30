/* Which render crashes are RECOVERABLE — pure, so it can be unit-tested without a browser (B1189).
 *
 * React throws "Maximum update depth exceeded" as a CIRCUIT BREAKER, not as a diagnosis of
 * corrupt state: it has counted ~50 nested updates, decided the tree is in a feedback cycle, and
 * aborted the render to stop it. Nothing is damaged — the loop is already broken by the time the
 * error reaches a boundary, and the plan itself lives in storage, not in the aborted render.
 *
 * That matters because the failure this class produces is wildly disproportionate: B1189's
 * runaway layout-measurement loop replaced the ENTIRE planner — canvas, rails, the user's drawing
 * — with a terminal error card, over a transient measurement cycle. Remounting the subtree clears
 * it outright. So the boundary treats this class as "retry once or twice", and only falls through
 * to the visible card if it keeps recurring.
 *
 * Deliberately NARROW. Only errors that are self-limiting AND fixed by a remount belong here; a
 * TypeError from a dangling reference recurs identically on remount, so auto-retrying it would
 * spin. When in doubt an error is NOT recoverable — the card is the safe answer.
 *
 * Minified builds are the ones users actually run, and there the message is only an error CODE
 * (React strips invariant text in production), so both spellings have to match or this is dead
 * code in production — which is precisely where B1189 fired.
 */

/** React's "Maximum update depth exceeded" invariant, dev spelling and minified code #185. */
export const UPDATE_DEPTH_CODE = 185;

/** Is this the nested-update circuit breaker? */
export function isUpdateDepthError(error) {
  const msg = (error && (error.message || error.toString())) || "";
  if (typeof msg !== "string" || !msg) return false;
  if (/Maximum update depth exceeded/i.test(msg)) return true;
  // Production: "Minified React error #185; visit https://reactjs.org/docs/error-decoder…".
  return new RegExp(`Minified React error #${UPDATE_DEPTH_CODE}(?!\\d)`, "i").test(msg);
}

/** Errors the boundary may clear by remounting the subtree instead of showing a dead end. */
export function isRecoverableRenderError(error) {
  return isUpdateDepthError(error);
}

/** How many automatic remounts a boundary may spend before it gives up and shows the card. */
export const MAX_AUTO_RECOVERIES = 2;

/** A recovery this long after the previous one is a fresh incident, not the same loop retrying. */
export const RECOVERY_WINDOW_MS = 30_000;

/* Decide what a boundary should do with a caught error.
 *
 * Pure so the policy is testable on its own: given the error, how many automatic recoveries this
 * boundary has already spent, when the last one was, and the current time, either "recover" (with
 * the attempt counter to carry forward) or "show" the fallback card.
 */
export function planRecovery({ error, attempts = 0, lastRecoveryAt = 0, now = 0 }) {
  if (!isRecoverableRenderError(error)) return { action: "show", attempts };
  // A crash long after the last one is a new incident — spend a fresh budget on it rather than
  // holding an hours-old count against it.
  const spent = lastRecoveryAt && now - lastRecoveryAt <= RECOVERY_WINDOW_MS ? attempts : 0;
  if (spent >= MAX_AUTO_RECOVERIES) return { action: "show", attempts: spent };
  return { action: "recover", attempts: spent + 1 };
}
