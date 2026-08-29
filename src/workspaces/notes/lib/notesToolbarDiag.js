/* notesToolbarDiag.js — READ-ONLY diagnostic for B831600 ×3 (the table-toolbar-jump bug that
 * this sandbox could not reproduce). It exists to turn "guessing from outside" into a
 * measurement: every call to `NoteEditor.jsx`'s `applyToolbarDelta` — from either the
 * `useLayoutEffect` or the `ResizeObserver` fallback — is recorded when armed, so the owner can
 * capture the REAL call sequence on his own machine instead of either side inferring it.
 *
 * ⛔ WHAT THIS DOES AND DOES NOT DO, the same contract `site-planner/lib/diagArm.js` established
 * for exactly this reason (B280403 — an instrument built to answer "why did it fail on his
 * machine" has to be armable on HIS machine): it exposes READ-ONLY facts about calls that
 * already happened, writes nothing, changes no behaviour, and is scoped to the tab
 * (`sessionStorage`, not `localStorage`, so it cannot leak into a later session). No telemetry
 * leaves the browser — the log lives only in `window`, for the owner to read back himself.
 *
 * ⛔ THE GATE IS READ AT CALL TIME, NOT AT MOUNT — the same reason as `diagArm.js`: this bug's
 * own first-ever-call behaviour is exactly what needs capturing, so arming has to work from a
 * FRESH page load, before any React effect has run. `?toolbarDiag=1` on the URL latches into
 * `sessionStorage` so it survives the reload the repro itself needs, and a plain
 * `window.__PLANYR_TOOLBAR_DIAG_ARM = true` from the console works for a page already open.
 *
 * Pure + Node-testable — takes the window rather than reaching for it.
 */

export const TOOLBAR_DIAG_STORAGE_KEY = "planyr:notes:toolbarDiag";
export const TOOLBAR_DIAG_PARAM = "toolbarDiag";
export const TOOLBAR_DIAG_LOG_KEY = "__PLANYR_TOOLBAR_DIAG";

export function isToolbarDiagArmed(win = typeof window === "undefined" ? undefined : window) {
  if (!win) return false;
  if (win.__PLANYR_TOOLBAR_DIAG_ARM === true) return true;
  try {
    if (win.sessionStorage && win.sessionStorage.getItem(TOOLBAR_DIAG_STORAGE_KEY) === "1") return true;
  } catch (_) { /* storage unavailable — fall through to the URL */ }
  try {
    const q = `${win.location?.search || ""}${win.location?.hash || ""}`;
    if (new RegExp(`[?&#]${TOOLBAR_DIAG_PARAM}=1(?:&|$|#)`).test(q)) return true;
  } catch (_) { /* no location — not armed */ }
  return false;
}

/* Latch a URL-armed session so it survives the reload the repro itself needs. Returns whether
 * the tab is armed, so a caller can arm-and-check in one statement. */
export function latchToolbarDiag(win = typeof window === "undefined" ? undefined : window) {
  if (!win) return false;
  const armed = isToolbarDiagArmed(win);
  if (!armed) return false;
  try { win.sessionStorage?.setItem(TOOLBAR_DIAG_STORAGE_KEY, "1"); } catch (_) { /* best effort */ }
  return true;
}

/* Push one call record. Never throws — a diagnostic that can crash the thing it observes is
 * worse than no diagnostic. */
export function recordToolbarDiag(entry, win = typeof window === "undefined" ? undefined : window) {
  if (!win) return;
  try {
    if (!Array.isArray(win[TOOLBAR_DIAG_LOG_KEY])) win[TOOLBAR_DIAG_LOG_KEY] = [];
    win[TOOLBAR_DIAG_LOG_KEY].push(entry);
  } catch (_) { /* best effort */ }
}
