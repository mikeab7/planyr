/* diagArm.js — ⛔ AN INSTRUMENT BUILT TO ANSWER "WHY DID IT FAIL ON HIS MACHINE" HAS TO BE ARMABLE
 * ON HIS MACHINE (B280403).
 *
 * THE GAP THIS CLOSES, and it nearly cost a whole round. `window.__plannerHitWhy` was built to
 * diagnose a defect that exists ONLY on the owner's signed-in production plan — and it was gated on
 * `window.__PLANYR_E2E`, which is false in production, installed in an effect with `[]` deps that
 * reads the flag AT MOUNT. So the one place the bug lives was the one place the instrument could not
 * be switched on. The session that needed it got there by setting the flag by hand and then forcing
 * a `SitePlanner` remount by switching plans and switching back. That worked, and it is FOLKLORE,
 * not a feature: it requires knowing the hook's dependency array.
 *
 * TWO CHANGES MAKE IT REACHABLE, and both matter:
 *  1. **The gate is read at CALL TIME, not at mount.** The hooks are installed unconditionally and
 *     answer `null` until armed, so arming can never require a remount and there is nothing to know
 *     about how they are wired.
 *  2. **There is a way in that needs no console and no source dive:** `?planyrDiag=1` on the URL
 *     (which latches into `sessionStorage` so it survives in-app navigation), or the session key
 *     directly. `window.__PLANYR_E2E` still works, so every existing harness is untouched.
 *
 * ⛔ WHAT ARMING DOES AND DOES NOT DO. It exposes READ-ONLY resolution diagnostics: what a
 * double-click at a point would address, and the facts behind that answer. It writes nothing, it
 * changes no behaviour, and it is scoped to the tab (sessionStorage, not localStorage) so it cannot
 * leak into a later session. It is NOT a debug mode and must never gate anything that mutates.
 *
 * Pure + Node-testable (test/diagArm.test.js) — it takes the window rather than reaching for it.
 */

export const DIAG_KEY = "planyr:diag";
export const DIAG_PARAM = "planyrDiag";

/* Is the read-only diagnostic surface armed for this tab? Every source is checked on every call,
 * because the whole point is that arming must not have to precede a mount. Every read is guarded:
 * `sessionStorage` throws outright in some privacy modes, and an instrument that crashes the app it
 * is meant to observe is worse than no instrument. */
export function isDiagArmed(win = typeof window === "undefined" ? undefined : window) {
  if (!win) return false;
  if (win.__PLANYR_E2E === true) return true;
  try {
    if (win.sessionStorage && win.sessionStorage.getItem(DIAG_KEY) === "1") return true;
  } catch (_) { /* storage unavailable — fall through to the URL */ }
  try {
    const q = `${win.location?.search || ""}${win.location?.hash || ""}`;
    if (new RegExp(`[?&#]${DIAG_PARAM}=1(?:&|$|#)`).test(q)) return true;
  } catch (_) { /* no location — not armed */ }
  return false;
}

/* Latch a URL-armed session so it survives in-app navigation (the planner switches plans by hash,
 * and losing the arming on the first switch is exactly the folklore this replaces). Returns whether
 * the tab is armed, so a caller can arm-and-check in one statement. */
export function latchDiagArm(win = typeof window === "undefined" ? undefined : window) {
  if (!win) return false;
  const armed = isDiagArmed(win);
  if (!armed) return false;
  try { win.sessionStorage?.setItem(DIAG_KEY, "1"); } catch (_) { /* best effort */ }
  return true;
}
